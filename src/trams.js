// Prague trams on the tram routes from tools/places.mjs: the types that run through the Old Town, each as low-poly
// boxes (one per articulated section) wearing the owner's drawn pictures of it, late-90s console style. Lengths,
// widths and heights are the real ones; the section lengths follow the joints in the side pictures.
//   - Škoda 15T ForCity Alfa: 31.4 m, 2.46 m wide, 3.46 m high. The commonest.
//   - Tatra T3 (T3R.P and kin): 14 m, 2.5 m wide, 3.06 m high, mostly in coupled pairs.
//   - Tatra KT8D5: 30.3 m in three sections, 2.48 m wide.
//   - Škoda 14T: 31 m in five sections; Škoda 52T: 32.5 m in five sections.
//   - Now and then a historic T3 in the old cream-and-red livery.
// The pictures (public/models/vehicles/tram-atlas.png, made by tools/vehicles/tram-atlas.py) are cut into sections at
// the middle of each joint; a section is a box with its roof edges bevelled and its cab ends drawn in to a nose
// (the front picture wraps round the nose, raked back towards the top on the modern types), and the pantograph is
// a cut-out picture standing on the roof. One material for every tram, one draw per section.
// Every section rides on the track by its two ends, so a train bends through the curves. Trams brake into the
// stops, wait, pull away, and start again from the beginning of their route when they run off the end.
// The overhead line follows the tracks: a contact wire over each track on poles at the roadside with span arms.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { crispTexture, DIR } from './vehicles.js';

const CRUISE = 9, ACCEL = 1.0, BRAKE = 1.3, DWELL = 12;
const WIRE_H = 5.7;

// The fleet: real dimensions (m), how the body is shaped (roof bevel, nose bevel, windscreen rake), where the
// pantograph stands (fraction of the train from the front), how many cars run coupled, and how often the type turns
// up on the lines here.
const FLEET = {
	'15t': { length: 31.4, width: 2.46, height: 3.46, roof: 0.28, nose: 0.55, rake: 0.5, panto: 0.12, weight: 4 },
	t3: { length: 14, width: 2.5, height: 3.06, roof: 0.4, nose: 0.6, rake: 0.12, panto: 0.3, cars: 2, weight: 3 },
	kt8: { length: 30.3, width: 2.48, height: 3.15, roof: 0.3, nose: 0.45, rake: 0.06, panto: 0.16, weight: 1 },
	'14t': { length: 31, width: 2.46, height: 3.4, roof: 0.28, nose: 0.55, rake: 0.45, panto: 0.1, weight: 1 },
	'52t': { length: 32.5, width: 2.5, height: 3.45, roof: 0.28, nose: 0.55, rake: 0.45, panto: 0.08, weight: 1 },
	t3_historic: { length: 14, width: 2.5, height: 3.06, roof: 0.4, nose: 0.6, rake: 0.12, panto: 0.3, weight: 0.3 }
};

const mat = ( hex, opts = {} ) => new THREE.MeshStandardNodeMaterial( { color: hex, roughness: 0.5, ...opts } );

const bar = ( x0, y0, z0, x1, y1, z1, r = 0.025 ) => {

	const a = new THREE.Vector3( x0, y0, z0 ), b = new THREE.Vector3( x1, y1, z1 );
	const g = new THREE.CylinderGeometry( r, r, a.distanceTo( b ), 5 );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), b.clone().sub( a ).normalize() ) );
	return g.translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );

};

// Section boundaries from the front, as fractions of the train: the middle of each joint, the two side pictures'
// measurements averaged.
function bounds( joints ) {

	const r = joints.right, l = joints.left;
	return [ 0, ...r.map( ( j, i ) => ( j + l[ i ] ) / 2 ), 1 ];

}

// One section's geometry (+z forward, rails at y = 0). `sec`: its place in the train ({ k, n, f0, f1 } with the
// fractions of each side picture it wears), `atlas`: the type's rectangles in the atlas.
function sectionGeometry( spec, L, sec, atlas, info ) {

	const W = spec.width / 2, H = spec.height, r = spec.roof;
	const cabFront = sec.k === 0, cabBack = sec.k === sec.n - 1;
	const pos = [], uv = [];
	const lerp = ( a, b, t ) => a + ( b - a ) * t;

	// The cross-section: up the right side (−x), over the bevelled roof, down the left side.
	const profile = ( inset, drop ) => [ [ - W + inset, 0 ], [ - W + inset, H - r - drop ], [ - W + inset + r * 1.2, H - drop ], [ W - inset - r * 1.2, H - drop ], [ W - inset, H - r - drop ], [ W - inset, 0 ] ];
	// A ring of the profile at z (the nose's rake pulls the top back).
	const ring = ( z, inset = 0, drop = 0, rake = 0, dir = 1 ) => profile( inset, drop ).map( ( [ x, y ] ) => [ x, y, z - dir * rake * y / H ] );

	// Texture coordinates. Sides: along the train within this section's share of the picture, up by height; the
	// right picture has the front at its left, the left picture at its right. Roof: front at the left. Ends: the
	// picture projected straight on (seen from outside, the rear's left is +x).
	const sideUV = ( rect, [ a, b ], frontLeft ) => ( x, y, z ) => {

		const f = lerp( a, b, ( L / 2 - z ) / L );
		return [ lerp( rect[ 0 ], rect[ 2 ], frontLeft ? f : 1 - f ), lerp( rect[ 1 ], rect[ 3 ], y / H ) ];

	};
	const right = sideUV( atlas.side_right, sec.right, true ), left = sideUV( atlas.side_left, sec.left, false );
	const roofUV = ( x, y, z ) => {

		const f = lerp( sec.f0, sec.f1, ( L / 2 - z ) / L );
		return [ lerp( atlas.roof[ 0 ], atlas.roof[ 2 ], f ), lerp( atlas.roof[ 1 ], atlas.roof[ 3 ], 0.5 - x / ( 2 * W ) * 0.86 ) ];

	};
	const endUV = ( rect, front, w ) => ( x, y ) => [ lerp( rect[ 0 ], rect[ 2 ], ( ( front ? x : - x ) + w ) / ( 2 * w ) ), lerp( rect[ 1 ], rect[ 3 ], y / H ) ];
	const j = info.joint, jointUV = () => [ ( j[ 0 ] + j[ 2 ] ) / 2, ( j[ 1 ] + j[ 3 ] ) / 2 ];
	const faceUV = [ right, right, roofUV, left, left ];

	const tri = ( a, b, c, f ) => {

		for ( const p of [ a, b, c ] ) {

			pos.push( ...p );
			uv.push( ...f( ...p ) );

		}

	};
	// A strip between two rings (A behind B), each face with its own mapping.
	const strip = ( A, B, uvOf ) => {

		for ( let i = 0; i < 5; i ++ ) {

			const f = uvOf( i );
			tri( A[ i ], B[ i ], B[ i + 1 ], f );
			tri( A[ i ], B[ i + 1 ], A[ i + 1 ], f );

		}

	};
	const cap = ( C, front, f ) => {

		for ( let i = 1; i < 5; i ++ ) front ? tri( C[ 0 ], C[ i + 1 ], C[ i ], f ) : tri( C[ 0 ], C[ i ], C[ i + 1 ], f );

	};

	const nose = spec.nose;
	const zf = cabFront ? L / 2 - nose : L / 2, zb = cabBack ? - L / 2 + nose : - L / 2;
	strip( ring( zb ), ring( zf ), i => faceUV[ i ] );
	// The nose: the sides and roof run on round the drawn-in corners, and the end picture fills the end face.
	const tipInset = nose * 0.55;
	if ( cabFront ) {

		const tip = ring( L / 2, tipInset, 0.06, spec.rake, 1 );
		strip( ring( zf ), tip, i => faceUV[ i ] );
		cap( tip, true, endUV( atlas.front, true, W - tipInset ) );

	} else cap( ring( L / 2 ), true, jointUV );

	if ( cabBack ) {

		const tip = ring( - L / 2, tipInset, 0.06, spec.rake * 0.5, - 1 );
		strip( tip, ring( zb ), i => faceUV[ i ] );
		cap( tip, false, endUV( atlas.rear, false, W - tipInset ) );

	} else cap( ring( - L / 2 ), false, jointUV );

	// The pantograph: its cut-out picture standing on the roof along the track, both ways round.
	if ( sec.panto !== null ) {

		const p = info.pantograph, len = 2.1, h = len * info.pantographAspect, z = sec.panto, y = H - 0.02;
		const f = ( x, yy, zz ) => [ lerp( p[ 0 ], p[ 2 ], ( zz - z + len / 2 ) / len ), lerp( p[ 1 ], p[ 3 ], ( yy - y ) / h ) ];
		const a = [ 0, y, z - len / 2 ], b = [ 0, y, z + len / 2 ], c = [ 0, y + h, z + len / 2 ], d = [ 0, y + h, z - len / 2 ];
		tri( a, b, c, f ); tri( a, c, d, f );
		tri( a, c, b, f ); tri( a, d, c, f );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.computeVertexNormals();
	return g;

}

// A car of a type as its sections ({ L, geometry }, front first), the geometries shared between trams.
const built = new Map();
function car( type, info ) {

	if ( built.has( type ) ) return built.get( type );
	const spec = FLEET[ type ], atlas = info.types[ type ];
	const b = bounds( atlas.joints );
	const r = [ 0, ...atlas.joints.right, 1 ], l = [ 0, ...atlas.joints.left, 1 ];
	const sections = [];
	for ( let k = 0; k < b.length - 1; k ++ ) {

		const L = ( b[ k + 1 ] - b[ k ] ) * spec.length;
		const pantoIn = spec.panto >= b[ k ] && spec.panto < b[ k + 1 ];
		// The pantograph's place along this section (+z forward, from its middle).
		const panto = pantoIn ? L / 2 - ( spec.panto - b[ k ] ) * spec.length : null;
		const sec = { k, n: b.length - 1, f0: b[ k ], f1: b[ k + 1 ], right: [ r[ k ], r[ k + 1 ] ], left: [ l[ k ], l[ k + 1 ] ], panto };
		sections.push( { L, geometry: sectionGeometry( spec, L, sec, atlas, info ) } );

	}

	built.set( type, sections );
	return sections;

}

// A train: its sections with their lengths and the gaps between them, front first. Coupled cars stand a metre
// apart (the couplers); the sections of an articulated car meet at the joints' middles.
function train( type, info, material ) {

	const spec = FLEET[ type ], list = [];
	for ( let c = 0; c < ( spec.cars || 1 ); c ++ ) {

		car( type, info ).forEach( ( s, k ) => {

			const model = new THREE.Mesh( s.geometry, material );
			model.castShadow = model.receiveShadow = true;
			list.push( { L: s.L, gap: k === 0 && c > 0 ? 1.0 : 0, model } );

		} );

	}

	return list;

}

function makePath( flat ) {

	const pts = [];
	for ( let i = 0; i < flat.length; i += 2 ) pts.push( [ flat[ i ], flat[ i + 1 ] ] );
	const cum = [ 0 ];
	for ( let i = 1; i < pts.length; i ++ ) cum.push( cum[ i - 1 ] + Math.hypot( pts[ i ][ 0 ] - pts[ i - 1 ][ 0 ], pts[ i ][ 1 ] - pts[ i - 1 ][ 1 ] ) );
	return { pts, cum, length: cum[ cum.length - 1 ] };

}

function at( path, s ) {

	const { pts, cum } = path;
	s = Math.max( 0, Math.min( path.length, s ) );
	let lo = 0, hi = cum.length - 1;
	while ( hi - lo > 1 ) {

		const mid = ( lo + hi ) >> 1;
		if ( cum[ mid ] <= s ) lo = mid; else hi = mid;

	}

	const t = ( s - cum[ lo ] ) / ( cum[ hi ] - cum[ lo ] || 1 );
	return [ pts[ lo ][ 0 ] + ( pts[ hi ][ 0 ] - pts[ lo ][ 0 ] ) * t, pts[ lo ][ 1 ] + ( pts[ hi ][ 1 ] - pts[ lo ][ 1 ] ) * t ];

}

// The overhead line: a contact wire over each track (shared stretches drawn once), poles at the roadside every
// ~30 m with a span arm out to the wire.
function addCatenary( scene, paths, groundHeight, isBlocked ) {

	const wires = [], poles = [], seen = new Set(), poleAt = [];
	const iron = mat( 0x2b2e30, { metalness: 0.5, roughness: 0.5 } );
	for ( const path of paths ) {

		let lastPole = - 1e9;
		for ( let s = 0; s + 4 <= path.length; s += 4 ) {

			const [ ax, az ] = at( path, s ), [ bx, bz ] = at( path, s + 4 );
			const key = `${ Math.round( ( ax + bx ) / 2 ) },${ Math.round( ( az + bz ) / 2 ) }`;
			if ( ! seen.has( key ) ) {

				seen.add( key );
				const ya = groundHeight( ax, az ) + WIRE_H, yb = groundHeight( bx, bz ) + WIRE_H;
				wires.push( bar( ax, ya, az, bx, yb, bz, 0.012 ) );

			}

			if ( s - lastPole < 30 ) continue;
			// A pole 3.2 m out to the right of this track (the track's own side of the street).
			const l = Math.hypot( bx - ax, bz - az ) || 1, rx = - ( bz - az ) / l, rz = ( bx - ax ) / l;
			const px = ax + rx * 3.4, pz = az + rz * 3.4;
			if ( isBlocked( px, pz ) || poleAt.some( ( [ x, z ] ) => Math.hypot( x - px, z - pz ) < 12 ) ) continue;
			lastPole = s;
			poleAt.push( [ px, pz ] );
			const gy = groundHeight( px, pz );
			poles.push( new THREE.CylinderGeometry( 0.1, 0.14, 7.2, 8 ).translate( px, gy + 3.6, pz ) );
			poles.push( bar( px, gy + WIRE_H + 0.35, pz, ax, groundHeight( ax, az ) + WIRE_H + 0.05, az, 0.03 ) );
			poles.push( bar( px, gy + 6.6, pz, ax + ( px - ax ) * 0.35, gy + WIRE_H + 0.4, az + ( pz - az ) * 0.35, 0.015 ) );

		}

	}

	const clean = list => list.map( g => {

		const n = g.index ? g.toNonIndexed() : g;
		for ( const a of Object.keys( n.attributes ) ) if ( ! [ 'position', 'normal' ].includes( a ) ) n.deleteAttribute( a );
		return n;

	} );
	if ( wires.length ) scene.add( new THREE.Mesh( mergeGeometries( clean( wires ) ), iron ) );
	if ( poles.length ) {

		const m = new THREE.Mesh( mergeGeometries( clean( poles ) ), iron );
		m.castShadow = true;
		scene.add( m );

	}

}

export async function addTrams( scene, routes, groundHeight, isBlocked = () => false ) {

	if ( ! routes?.length ) return { update() {} };
	const paths = routes.map( r => makePath( r.pts ) );
	addCatenary( scene, paths, groundHeight, isBlocked );

	const info = await ( await fetch( DIR + 'tram-atlas.json' ) ).json();
	const material = new THREE.MeshStandardNodeMaterial( { map: crispTexture( 'tram-atlas.png' ), alphaTest: 0.5, roughness: 0.55, side: THREE.FrontSide } );
	// The types dealt out by their weights, in a fixed shuffled order so a reload looks the same.
	const types = Object.keys( FLEET ), total = types.reduce( ( n, t ) => n + FLEET[ t ].weight, 0 );
	const pick = i => {

		let x = ( ( i * 0.6180339887 + 0.137 ) % 1 ) * total;
		for ( const t of types ) if ( ( x -= FLEET[ t ].weight ) < 0 ) return t;
		return types[ 0 ];

	};

	const trams = routes.map( ( r, i ) => {

		const path = paths[ i ];
		const sections = train( pick( i ), info, material );
		for ( const sec of sections ) scene.add( sec.model );
		const length = sections.reduce( ( n, sec, k ) => n + sec.L + ( k ? sec.gap : 0 ), 0 );
		return { path, stops: r.stops, sections, length, s: length + 2 + ( ( i * 137 ) % Math.max( 1, path.length - length - 10 ) ), v: CRUISE * 0.6, dwell: 0, served: new Set() };

	} );

	function update( dt ) {

		for ( const t of trams ) {

			if ( t.dwell > 0 ) {

				t.dwell -= dt;

			} else {

				// Brake to stop with the middle of the train at the stop.
				const stopFront = s => s + t.length / 2;
				const next = t.stops.find( s => stopFront( s ) > t.s - 1 && ! t.served.has( s ) );
				let target = CRUISE;
				if ( next !== undefined ) {

					const gap = stopFront( next ) - t.s;
					if ( gap < t.v * t.v / ( 2 * BRAKE ) + 0.5 ) target = 0;
					if ( gap < 0.6 && t.v < 0.8 ) {

						t.served.add( next );
						t.dwell = DWELL;
						t.v = 0;

					}

				}

				t.v += Math.max( - BRAKE * dt, Math.min( ACCEL * dt, target - t.v ) );
				if ( target === 0 ) t.v = Math.max( t.v, 0.5 );
				t.s += t.v * dt;
				if ( t.s > t.path.length - 1 ) {

					t.s = t.length + 1;
					t.v = CRUISE * 0.5;
					t.served.clear();

				}

			}

			// Place each section by its two ends on the track.
			let front = t.s;
			for ( const sec of t.sections ) {

				const back = front - sec.L;
				const [ fx, fz ] = at( t.path, front ), [ bx, bz ] = at( t.path, back );
				sec.model.position.set( ( fx + bx ) / 2, Math.max( groundHeight( fx, fz ), groundHeight( bx, bz ) ), ( fz + bz ) / 2 );
				sec.model.rotation.y = Math.atan2( fx - bx, fz - bz );
				front = back - sec.gap;

			}

		}

	}

	update( 0 );
	return { update, trams };

}
