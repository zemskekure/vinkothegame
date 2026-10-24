// Prague trams on the tram routes from tools/places.mjs, stylised after the two types seen on Národní and the
// embankments:
//   - Škoda 15T ForCity: the common modern car, about 31 m in four articulated sections; red below the windows,
//     a continuous black window band, light grey above with a white roof and roof-top equipment covers, a raked
//     black windscreen with a red nose, a single-arm pantograph;
//   - Tatra T3: the classic, running as a coupled pair of 14 m cars; red with a cream band under the windows and a
//     cream roof edge, rounded ends, a diamond pantograph.
// Every section rides on the track by its two ends, so a train bends through the curves. Trams brake into the
// stops, wait, pull away, and start again from the beginning of their route when they run off the end.
// The overhead line follows the tracks: a contact wire over each track on poles at the roadside with span arms.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF_W = 1.25;
const CRUISE = 9, ACCEL = 1.0, BRAKE = 1.3, DWELL = 12;
const WIRE_H = 5.7;

// Plan of a body section (x across, s along): cab ends drawn in to a rounded nose, joint ends square.
function plan( L, noseFront, noseBack, inset = 0 ) {

	const w = HALF_W - inset, h = L / 2 - inset, n = 0.8;
	const sh = new THREE.Shape().moveTo( - w, noseBack ? - h + n : - h );
	sh.lineTo( - w, noseFront ? h - n : h );
	if ( noseFront ) sh.quadraticCurveTo( - w, h, - w + n, h ).lineTo( w - n, h ).quadraticCurveTo( w, h, w, h - n );
	else sh.lineTo( w, h );
	sh.lineTo( w, noseBack ? - h + n : - h );
	if ( noseBack ) sh.quadraticCurveTo( w, - h, w - n, - h ).lineTo( - w + n, - h ).quadraticCurveTo( - w, - h, - w, - h + n );
	else sh.lineTo( - w, - h );
	return sh;

}

// A horizontal slab of a section between two heights (+z forward).
const band = ( L, nf, nb, y0, y1, inset = 0 ) => new THREE.ExtrudeGeometry( plan( L, nf, nb, inset ), { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 } )
	.rotateX( - Math.PI / 2 ).rotateY( Math.PI ).translate( 0, y0, 0 );

const mat = ( hex, opts = {} ) => new THREE.MeshStandardNodeMaterial( { color: hex, roughness: 0.5, ...opts } );
const MATS = {
	red: mat( 0xc8102e, { roughness: 0.35 } ),
	cream: mat( 0xefe5c8, { roughness: 0.4 } ),
	grey: mat( 0xd9dcde, { roughness: 0.4 } ),
	white: mat( 0xf4f4f2, { roughness: 0.5 } ),
	glass: mat( 0x15191d, { roughness: 0.06, metalness: 0.4 } ),
	dark: mat( 0x1b1c1e, { roughness: 0.8 } ),
	roof: mat( 0x8d9094, { roughness: 0.6 } ),
	light: new THREE.MeshStandardNodeMaterial( { color: 0xfff6dc, emissive: 0xfff0c8, emissiveIntensity: 1.2 } )
};

function destinationTexture( text ) {

	const c = document.createElement( 'canvas' );
	c.width = 512;
	c.height = 96;
	const g = c.getContext( '2d' );
	g.fillStyle = '#0d0d0d';
	g.fillRect( 0, 0, 512, 96 );
	g.fillStyle = '#ffae2b';
	g.font = '700 56px "Helvetica Neue", Arial, sans-serif';
	g.textBaseline = 'middle';
	g.fillText( text, 18, 50 );
	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	return t;

}

const LINES = [ '2 Petřiny', '9 Sídliště Řepy', '17 Libuš', '18 Vozovna Pankrác', '22 Bílá Hora', '23 Malovanka', '9 Spojovací', '22 Nádraží Hostivař', '17 Vozovna Kobylisy' ];

const bar = ( x0, y0, z0, x1, y1, z1, r = 0.025 ) => {

	const a = new THREE.Vector3( x0, y0, z0 ), b = new THREE.Vector3( x1, y1, z1 );
	const g = new THREE.CylinderGeometry( r, r, a.distanceTo( b ), 5 );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), b.clone().sub( a ).normalize() ) );
	return g.translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );

};

// One section as a group of meshes (one per material). kind: '15T' or 'T3'.
function section( kind, L, noseFront, noseBack, { pantograph = false, line = '' } = {} ) {

	const parts = { dark: [], red: [], cream: [], grey: [], white: [], glass: [], roof: [], light: [] };
	const nf = noseFront, nb = noseBack;
	if ( kind === '15T' ) {

		parts.dark.push( band( L, nf, nb, 0.12, 0.38, 0.12 ) );
		parts.red.push( band( L, nf, nb, 0.38, 1.05 ) );
		parts.glass.push( band( L, nf, nb, 1.05, 2.42, 0.02 ) );
		parts.grey.push( band( L, nf, nb, 2.42, 3.05 ) );
		parts.white.push( band( L, nf, nb, 3.05, 3.2, 0.2 ), new THREE.BoxGeometry( 1.6, 0.35, L * 0.55 ).translate( 0, 3.37, 0 ) );
		// Doors: grey-glass leaves on the right (−x), one per section.
		parts.grey.push( new THREE.BoxGeometry( 0.04, 2.05, 1.3 ).translate( - HALF_W - 0.01, 0.38 + 1.02, 0 ) );
		parts.glass.push( new THREE.BoxGeometry( 0.045, 1.4, 1.1 ).translate( - HALF_W - 0.015, 1.3, 0 ) );
		if ( nf ) {

			// Raked windscreen and the red nose.
			parts.glass.push( new THREE.BoxGeometry( 2.0, 1.55, 0.08 ).translate( 0, 1.85, L / 2 - 0.05 ).rotateX( 0 ) );
			parts.red.push( new THREE.BoxGeometry( 2.1, 0.75, 0.25 ).translate( 0, 0.7, L / 2 - 0.05 ) );
			parts.light.push( ...[ - 0.75, 0.75 ].map( x => new THREE.BoxGeometry( 0.32, 0.1, 0.05 ).translate( x, 0.95, L / 2 + 0.08 ) ) );

		}

		if ( pantograph ) {

			// Single-arm pantograph.
			parts.dark.push( bar( 0, 3.55, - 0.6, 0, 4.3, 0.5 ), bar( 0, 4.3, 0.5, 0, 4.95, - 0.4 ), new THREE.BoxGeometry( 1.4, 0.04, 0.1 ).translate( 0, 4.97, - 0.4 ) );

		}

	} else {

		parts.dark.push( band( L, nf, nb, 0.18, 0.62, 0.15 ) );
		parts.red.push( band( L, nf, nb, 0.62, 1.42 ), band( L, nf, nb, 2.5, 2.78 ) );
		parts.cream.push( band( L, nf, nb, 1.42, 1.58 ), band( L, nf, nb, 2.78, 2.98, 0.05 ) );
		parts.glass.push( band( L, nf, nb, 1.58, 2.5, 0.02 ) );
		parts.roof.push( band( L, nf, nb, 2.98, 3.08, 0.25 ) );
		for ( const s of [ L / 2 - 1.6, 0, - L / 2 + 1.6 ] ) parts.dark.push( new THREE.BoxGeometry( 0.04, 1.85, 1.25 ).translate( - HALF_W - 0.005, 0.62 + 0.92, s ) );
		if ( nf ) parts.light.push( ...[ - 0.6, 0.6 ].map( x => new THREE.CylinderGeometry( 0.11, 0.11, 0.06, 12 ).rotateX( Math.PI / 2 ).translate( x, 1.05, L / 2 + 0.01 ) ) );
		if ( pantograph ) {

			parts.roof.push( new THREE.BoxGeometry( 1.4, 0.25, 2.4 ).translate( 0, 3.2, 1.6 ) );
			for ( const x of [ - 0.45, 0.45 ] ) parts.dark.push( bar( x, 3.33, 0.8, x, 3.95, 1.6 ), bar( x, 3.95, 1.6, x, 4.45, 0.9 ) );
			parts.dark.push( new THREE.BoxGeometry( 1.5, 0.04, 0.12 ).translate( 0, 4.47, 0.9 ) );

		}

	}

	// Wheels under each end.
	for ( const s of [ L / 2 - 1.8, - L / 2 + 1.8 ] ) for ( const x of [ - 0.75, 0.75 ] ) parts.dark.push( new THREE.CylinderGeometry( 0.3, 0.3, 0.12, 10 ).rotateZ( Math.PI / 2 ).translate( x, 0.3, s ) );

	const group = new THREE.Group();
	for ( const [ name, list ] of Object.entries( parts ) ) {

		if ( ! list.length ) continue;
		const g = mergeGeometries( list.map( g => {

			const n = g.index ? g.toNonIndexed() : g;
			for ( const a of Object.keys( n.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( a ) ) n.deleteAttribute( a );
			if ( ! n.attributes.uv ) n.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( n.attributes.position.count * 2 ), 2 ) );
			return n;

		} ) );
		g.computeVertexNormals();
		const m = new THREE.Mesh( g, MATS[ name ] );
		m.castShadow = m.receiveShadow = true;
		group.add( m );

	}

	// Destination display at a cab end.
	if ( line && ( nf || nb ) ) {

		const front = nf;
		const d = new THREE.Mesh( new THREE.PlaneGeometry( 1.5, 0.27 ), new THREE.MeshStandardNodeMaterial( { map: destinationTexture( line ), emissive: 0xffffff, emissiveIntensity: 0.12 } ) );
		const y = kind === '15T' ? 2.72 : 2.35;
		d.position.set( 0, y, ( front ? 1 : - 1 ) * ( L / 2 + 0.03 ) );
		d.rotation.y = front ? 0 : Math.PI;
		group.add( d );

	}

	return group;

}

// A train: its sections with their lengths and the gaps between them, front first.
function train( kind, line ) {

	if ( kind === '15T' ) {

		const L = 7.6;
		return [ 0, 1, 2, 3 ].map( i => ( { L, gap: 0.25, model: section( '15T', L, i === 0, i === 3, { pantograph: i === 1, line: i === 0 || i === 3 ? line : '' } ) } ) );

	}

	return [ 0, 1 ].map( i => ( { L: 14, gap: 1.0, model: section( 'T3', 14, true, i === 1, { pantograph: true, line: i === 0 ? line : '' } ) } ) );

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

export function addTrams( scene, routes, groundHeight, isBlocked = () => false ) {

	if ( ! routes?.length ) return { update() {} };
	const paths = routes.map( r => makePath( r.pts ) );
	addCatenary( scene, paths, groundHeight, isBlocked );

	const trams = routes.map( ( r, i ) => {

		const path = paths[ i ];
		const kind = i % 3 === 2 ? 'T3' : '15T';
		const sections = train( kind, LINES[ i % LINES.length ] );
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
