// Bridges over the Vltava (tools/places.mjs): Most Legií and the footbridge to Slovanský ostrov. A deck strip per
// OSM way segment (asphalt for roads and tracks, slabs for footways) on sandstone sides, a stone parapet along
// the road decks' outer edges and iron railings along the footways', stone piers down into the river.

import * as THREE from 'three/webgpu';
import { Kit, plain, ashlar, tiles, box, cyl, ball } from './kit.js';

const B = {
	road: plain( 0x47484a, { roughness: 0.85 } ),
	walk: plain( 0xb3ada1, { roughness: 0.9 } ),
	stone: ashlar( 0xa89f8c, 0xbdb4a1 ),
	iron: plain( 0x26292a, { metalness: 0.6, roughness: 0.45 } )
};

// A prism between two quads (top a b c d, bottom 0.9 m lower): the deck slab.
function slab( c, depth ) {

	const pos = [];
	const q = ( a, b, cc, d ) => pos.push( ...a, ...b, ...cc, ...a, ...cc, ...d );
	const down = p => [ p[ 0 ], p[ 1 ] - depth, p[ 2 ] ];
	const [ a, b, cc, d ] = c, [ A, Bb, C, D ] = c.map( down );
	q( a, d, cc, b ); // top (counter-clockwise from above)
	q( A, Bb, C, D );
	q( a, b, Bb, A ); q( b, cc, C, Bb ); q( cc, d, D, C ); q( d, a, A, D );
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Array( pos.length / 3 * 2 ).fill( 0 ), 2 ) );
	g.computeVertexNormals();
	return g;

}

// Along a segment: unit direction, and the right-hand normal.
const frame = s => {

	const len = Math.hypot( s.x1 - s.x0, s.z1 - s.z0 ), lx = ( s.x1 - s.x0 ) / len, lz = ( s.z1 - s.z0 ) / len;
	return { len, lx, lz, rx: - lz, rz: lx };

};

function onDeck( segs, self, x, z ) {

	return segs.some( s => {

		if ( s === self ) return false;
		const { len, lx, lz } = frame( s );
		const t = Math.max( 0, Math.min( len, ( x - s.x0 ) * lx + ( z - s.z0 ) * lz ) );
		return Math.hypot( x - s.x0 - lx * t, z - s.z0 - lz * t ) < s.w / 2 + 0.15;

	} );

}

export function addBridges( scene, segs = [], piers = [], waterLevel = 0 ) {

	if ( ! segs.length ) return;
	const kit = new Kit();
	for ( const s of segs ) {

		const { len, lx, lz, rx, rz } = frame( s );
		const road = s.kind !== 'footway' && s.kind !== 'path' && s.kind !== 'cycleway' && s.kind !== 'pedestrian';
		const h = 0.9, W = s.w / 2, e = 0.15; // overlap the next segment a little
		const P = ( t, o, y ) => [ s.x0 + lx * t + rx * o, y, s.z0 + lz * t + rz * o ];
		const y = t => s.y0 + ( s.y1 - s.y0 ) * t / len;
		kit.add( road ? B.road : B.walk, slab( [ P( - e, - W, y( 0 ) ), P( len + e, - W, y( len ) ), P( len + e, W, y( len ) ), P( - e, W, y( 0 ) ) ], 0.25 ) );
		kit.add( B.stone, slab( [ P( - e, - W, y( 0 ) - 0.25 ), P( len + e, - W, y( len ) - 0.25 ), P( len + e, W, y( len ) - 0.25 ), P( - e, W, y( 0 ) - 0.25 ) ], h ) );

		// Outer edges: no other deck beside them.
		for ( const side of [ - 1, 1 ] ) {

			const runs = [];
			for ( let t = 0; t <= len; t += 1 ) {

				const [ px, , pz ] = P( t, side * ( W + 0.6 ), 0 );
				const open = ! onDeck( segs, s, px, pz );
				if ( open ) {

					if ( ! runs.length || runs[ runs.length - 1 ][ 1 ] < t - 1 ) runs.push( [ t, t ] );
					else runs[ runs.length - 1 ][ 1 ] = t;

				}

			}

			for ( const [ t0, t1raw ] of runs ) {

				const t1 = Math.min( len, t1raw + 1 );
				if ( t1 - t0 < 0.5 ) continue;
				const o = side * ( W - 0.15 );
				if ( road ) {

					// Sandstone parapet with a coping.
					kit.add( B.stone, slab( [ P( t0, o - 0.2, y( t0 ) + 1.0 ), P( t1, o - 0.2, y( t1 ) + 1.0 ), P( t1, o + 0.2, y( t1 ) + 1.0 ), P( t0, o + 0.2, y( t0 ) + 1.0 ) ], 1.0 ) );
					kit.add( B.stone, slab( [ P( t0, o - 0.28, y( t0 ) + 1.12 ), P( t1, o - 0.28, y( t1 ) + 1.12 ), P( t1, o + 0.28, y( t1 ) + 1.12 ), P( t0, o + 0.28, y( t0 ) + 1.12 ) ], 0.12 ) );

				} else {

					// Iron railing: posts every 2 m, top and middle rails.
					for ( let t = t0; t <= t1 + 0.01; t += 2 ) {

						const [ px, , pz ] = P( t, o, 0 );
						kit.add( B.iron, new THREE.BoxGeometry( 0.06, 1.05, 0.06 ).translate( px, y( t ) + 0.525, pz ) );

					}

					for ( const hh of [ 1.02, 0.5 ] ) {

						const a = P( t0, o, y( t0 ) + hh ), b = P( t1, o, y( t1 ) + hh );
						const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );
						const rail = new THREE.BoxGeometry( 0.05, 0.05, l );
						rail.lookAt( new THREE.Vector3( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ) );
						rail.translate( ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2, ( a[ 2 ] + b[ 2 ] ) / 2 );
						kit.add( B.iron, rail );

					}

				}

			}

		}

	}

	// Piers: sandstone, pointed upstream and downstream, from below the water up to the deck.
	for ( const [ x, z, top, rot ] of piers ) {

		const hgt = top - 1.1 - ( waterLevel - 3 );
		const shape = new THREE.Shape().moveTo( - 1.6, - 7 ).lineTo( 1.6, - 7 ).lineTo( 1.6, 7 ).lineTo( - 1.6, 7 ).lineTo( - 1.6, - 7 );
		const g = new THREE.ExtrudeGeometry( shape, { depth: hgt, bevelEnabled: false } ).rotateX( - Math.PI / 2 ).translate( 0, waterLevel - 3, 0 );
		const nose = new THREE.CylinderGeometry( 1.6, 1.6, hgt, 4, 1 ).scale( 1, 1, 1.6 ).rotateY( Math.PI / 4 );
		for ( const s of [ - 1, 1 ] ) kit.add( B.stone, nose.clone().translate( 0, waterLevel - 3 + hgt / 2, s * 7 ).rotateY( rot + Math.PI / 2 ).translate( x, 0, z ) );
		kit.add( B.stone, g.rotateY( rot + Math.PI / 2 ).translate( x, 0, z ) );

	}

	kit.build( scene );

}

// Most Legií (tools/places.mjs): the deck on the ZABAGED axis with its sett sidewalks behind granite kerbs, the
// asphalt carriageway with the two tram tracks, stone balustrades with pedestals and coping, the bays at the Národní
// end with the two domed tollhouses, segmental stone arches between piers with cutwaters (pointed upstream, round
// downstream), and the tall cast-iron poles with lanterns on the balustrade carrying the tram wires' cross spans
// (Street View 2017, 2019; aerial photo).
const LG = {
	road: plain( 0x4b4c4e, { roughness: 0.85 } ),
	sett: tiles( 0x9c968c, 0x8e887e, 0.12 ),
	kerb: plain( 0xa9a499, { roughness: 0.8 } ),
	rail: plain( 0x3c3a37, { metalness: 0.3, roughness: 0.5 } ),
	stone: ashlar( 0x8f897d, 0xa29b8d ),
	balustrade: plain( 0x9d978a, { roughness: 0.9 } ),
	house: ashlar( 0xc9bc9e, 0xd6caae ),
	dome: plain( 0x5f8a78, { metalness: 0.3, roughness: 0.55 } ),
	gold: plain( 0xc9a046, { metalness: 0.9, roughness: 0.3 } ),
	iron: plain( 0x2a2d2c, { metalness: 0.6, roughness: 0.45 } ),
	lamp: new THREE.MeshStandardNodeMaterial( { color: 0xfff2d0, emissive: 0xffe2a8, emissiveIntensity: 1.2, roughness: 0.4 } ),
	dark: plain( 0x2c2a27, { roughness: 0.8 } )
};

// The deck's frame at a distance s from the Národní end: centre, road height, along and the across (o) directions.
function legieFrame( lg ) {

	const P = lg.pts, n = P.length, step = lg.step;
	return s => {

		const f = Math.min( n - 1.001, Math.max( 0, s / step ) ), i = Math.floor( f ), t = f - i;
		const a = P[ i ], b = P[ Math.min( n - 1, i + 1 ) ];
		const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, y = a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t;
		const k = Math.max( 0, i - 1 ), m = Math.min( n - 1, i + 2 ), l = Math.hypot( P[ m ][ 0 ] - P[ k ][ 0 ], P[ m ][ 1 ] - P[ k ][ 1 ] );
		const ux = ( P[ m ][ 0 ] - P[ k ][ 0 ] ) / l, uz = ( P[ m ][ 1 ] - P[ k ][ 1 ] ) / l;
		return { x, y, z, ux, uz, at: ( o, dy = 0 ) => [ x - uz * o, y + dy, z + ux * o ] };

	};

}

// Whether a point is on Most Legií's deck (the tram line's own poles stay off it: the bridge's poles carry the wires).
export function onLegie( lg, x, z ) {

	if ( ! lg ) return false;
	const P = lg.pts;
	for ( let i = 0; i + 1 < P.length; i ++ ) {

		const [ ax, az ] = P[ i ], [ bx, bz ] = P[ i + 1 ], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
		const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / l2 ) );
		const half = i * lg.step <= lg.bay.s1 ? lg.bay.half : lg.half;
		if ( Math.hypot( x - ax - t * dx, z - az - t * dz ) < half + 0.5 ) return true;

	}

	return false;

}

// A box from a to b (centre line), w wide, h high from the line up.
function beam( a, b, w, h ) {

	const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );
	const g = new THREE.BoxGeometry( w, h, l + 0.02 ).translate( 0, h / 2, 0 );
	g.applyMatrix4( new THREE.Matrix4().makeShear( 0, 0, 0, 0, 0, ( b[ 1 ] - a[ 1 ] ) / l ) );
	g.rotateY( Math.atan2( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] ) );
	g.translate( ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2, ( a[ 2 ] + b[ 2 ] ) / 2 );
	return g;

}

// A thin bar between two points.
function wire( a, b, r ) {

	const d = new THREE.Vector3( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ), l = d.length();
	const g = new THREE.CylinderGeometry( r, r, l, 4 ).translate( 0, l / 2, 0 );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), d.normalize() ) );
	return g.translate( ...a );

}

// A strip between two across-offsets along the whole deck (or s0…s1), dy over the road, as one geometry.
function strip( F, s0, s1, o0, o1, dy0, dy1 = dy0, step = 2 ) {

	const pos = [], uv = [];
	for ( let s = s0; s < s1 - 1e-6; s += step ) {

		const t = Math.min( s1, s + step ), A = F( s ), B = F( t );
		const p = [ A.at( o0( s ), dy0 ), A.at( o1( s ), dy1 ), B.at( o1( t ), dy1 ), B.at( o0( t ), dy0 ) ];
		pos.push( ...p[ 0 ], ...p[ 1 ], ...p[ 2 ], ...p[ 0 ], ...p[ 2 ], ...p[ 3 ] );
		pos.push( ...p[ 0 ], ...p[ 2 ], ...p[ 1 ], ...p[ 0 ], ...p[ 3 ], ...p[ 2 ] );
		for ( let k = 0; k < 12; k ++ ) uv.push( 0, 0 );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.computeVertexNormals();
	return g;

}

export function addLegie( scene, lg, waterLevel = 0 ) {

	if ( ! lg || lg.pts.length < 3 ) return;
	const kit = new Kit();
	const F = legieFrame( lg ), L = ( lg.pts.length - 1 ) * lg.step;
	const KERB = 0.12, inner = s => ( s <= lg.bay.s1 ? lg.bay.half : lg.half ) - lg.rail, roadHalf = lg.half - lg.rail - lg.walk;
	const c = v => () => v;

	// Carriageway, the rails of the two tracks (1.5 m each side of the axis), kerbs and sidewalks.
	kit.add( LG.road, strip( F, 0, L, c( - roadHalf ), c( roadHalf ), 0.02 ) );
	for ( const track of [ - 1.5, 1.5 ] ) for ( const r of [ - 0.7175, 0.7175 ] ) kit.add( LG.rail, strip( F, 0, L, c( track + r - 0.04 ), c( track + r + 0.04 ), 0.035 ) );
	for ( const sgn of [ - 1, 1 ] ) {

		kit.add( LG.kerb, strip( F, 0, L, c( sgn * roadHalf ), c( sgn * roadHalf ), 0.02, KERB + 0.02 ) );
		kit.add( LG.kerb, strip( F, 0, L, c( sgn * roadHalf ), c( sgn * ( roadHalf + 0.25 ) ), KERB + 0.02 ) );
		kit.add( LG.sett, strip( F, 0, L, c( sgn * ( roadHalf + 0.25 ) ), s => sgn * ( inner( s ) + 0.05 ), KERB + 0.02, KERB + 0.02, 1 ) );

	}

	// The arches: per span between supports, a stone body across the deck with a segmental opening.
	const supports = [ 0, ...lg.piers, L ];
	const PIER = 2.2;
	for ( let k = 0; k + 1 < supports.length; k ++ ) {

		const sa = supports[ k ], sb = supports[ k + 1 ], len = sb - sa;
		if ( len < 6 ) continue;
		const A = F( sa ), B = F( sb );
		const cx = B.x - A.x, cz = B.z - A.z, cl = Math.hypot( cx, cz );
		const yAt = s => F( sa + s ).y;
		const half = Math.max( ...[ 0, 0.5, 1 ].map( t => inner( sa + len * t ) ) ) + lg.rail;
		const bottom = waterLevel - 1.5, top = s => yAt( s ) - 0.02;
		const body = new THREE.Shape().moveTo( 0, bottom );
		body.lineTo( len, bottom );
		for ( let s = len; s >= 0; s -= Math.min( 2, Math.max( 0.01, s ) ) ) {

			body.lineTo( s, top( s ) );
			if ( s === 0 ) break;

		}

		body.closePath();
		const a0 = k === 0 ? 1.0 : PIER, a1 = k + 2 === supports.length ? 1.0 : PIER;
		const chord = ( len - a0 - a1 ) / 2, mid = a0 + chord;
		if ( chord > 3 ) {

			const spring = waterLevel + 1.2, crown = Math.min( yAt( mid ) - 1.5, spring + chord * 0.55 ), rise = crown - spring;
			const R = ( chord * chord + rise * rise ) / ( 2 * rise ), cy = crown - R;
			const hole = new THREE.Path().moveTo( a0, bottom + 0.05 ).lineTo( a0, spring );
			for ( let i = 1; i < 24; i ++ ) {

				const x = - chord + 2 * chord * i / 24;
				hole.lineTo( mid + x, cy + Math.sqrt( R * R - x * x ) );

			}

			hole.lineTo( len - a1, spring ).lineTo( len - a1, bottom + 0.05 ).closePath();
			body.holes.push( hole );

		}

		const g = new THREE.ExtrudeGeometry( body, { depth: half * 2, bevelEnabled: false, curveSegments: 4 } ).translate( 0, 0, - half );
		// Shape x → along the chord, shape y → up, extrusion z → across.
		g.applyMatrix4( new THREE.Matrix4().set( cx / cl, 0, - cz / cl, 0, 0, 1, 0, 0, cz / cl, 0, cx / cl, 0, 0, 0, 0, 1 ) );
		g.translate( A.x, 0, A.z );
		kit.add( LG.stone, g );

	}

	// Piers: a pointed cutwater upstream (south, −o) and a rounded one downstream, up to under the cornice.
	for ( const s of lg.piers ) {

		const P = F( s ), h = P.y - 1.4 - ( waterLevel - 1.5 ), half = inner( s ) + lg.rail;
		const nose = new THREE.CylinderGeometry( 1.0, 1.0, h, 4, 1 ).scale( PIER, 1, 2.6 );
		const round = new THREE.CylinderGeometry( PIER, PIER, h, 16, 1, false, 0, Math.PI );
		const up = P.at( - half, 0 ), down = P.at( half, 0 );
		kit.add( LG.stone, nose.translate( 0, waterLevel - 1.5 + h / 2, 0 ).rotateY( Math.atan2( - P.uz, P.ux ) ).translate( up[ 0 ], 0, up[ 2 ] ) );
		kit.add( LG.stone, round.translate( 0, waterLevel - 1.5 + h / 2, 0 ).rotateY( Math.atan2( - P.ux, - P.uz ) ).translate( down[ 0 ], 0, down[ 2 ] ) );

	}

	// Cornice along both faces, under the balustrade.
	for ( const sgn of [ - 1, 1 ] ) kit.add( LG.balustrade, strip( F, 0, L, s => sgn * ( inner( s ) + lg.rail + 0.15 ), s => sgn * ( inner( s ) - 0.1 ), KERB, KERB, 1 ) );

	// Balustrades: along each side's outline (round the bays), plinth, balusters, pedestals every 4 m, coping.
	for ( const sgn of [ - 1, 1 ] ) {

		const o = s => sgn * ( inner( s ) + lg.rail / 2 );
		const runs = [];
		const bayEnd = lg.bay.s1;
		const pts = [];
		for ( let s = 0; s <= L + 1e-6; s += 1 ) {

			if ( s > bayEnd && pts.length && pts[ pts.length - 1 ].s <= bayEnd ) {

				pts.push( { s: bayEnd, p: F( bayEnd ).at( o( bayEnd ), KERB ) } );
				runs.push( [ ...pts ] );
				pts.length = 0;
				// The bay's end: across from the bay's line to the deck's.
				const B = F( bayEnd );
				runs.push( [ { s: bayEnd, p: B.at( sgn * ( lg.bay.half - lg.rail / 2 ), KERB ) }, { s: bayEnd, p: B.at( sgn * ( lg.half - lg.rail / 2 ), KERB ) } ] );
				pts.push( { s: bayEnd, p: B.at( sgn * ( lg.half - lg.rail / 2 ), KERB ) } );

			}

			pts.push( { s, p: F( s ).at( o( s ), KERB ) } );

		}

		runs.push( pts );
		for ( const run of runs ) {

			let since = 0;
			for ( let i = 1; i < run.length; i ++ ) {

				const a = run[ i - 1 ].p, b = run[ i ].p, l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );
				if ( l < 0.05 ) continue;
				kit.add( LG.balustrade, beam( a, b, 0.5, 0.25 ) );
				kit.add( LG.balustrade, beam( [ a[ 0 ], a[ 1 ] + 0.95, a[ 2 ] ], [ b[ 0 ], b[ 1 ] + 0.95, b[ 2 ] ], 0.55, 0.14 ) );
				for ( let t = 0.16; t < l; t += 0.32 ) {

					const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t / l, y = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t / l, z = a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t / l;
					kit.add( LG.balustrade, new THREE.CylinderGeometry( 0.06, 0.085, 0.7, 6 ).translate( x, y + 0.6, z ) );

				}

				since += l;
				if ( since >= 4 || i === 1 ) {

					kit.add( LG.balustrade, box( 0.6, 1.12, 0.6, b[ 0 ], b[ 1 ], b[ 2 ] ) );
					since = 0;

				}

			}

		}

	}

	// The tollhouses: square stone pavilions with arched openings, a cornice, a green copper dome, lantern and finial.
	for ( const { s, o } of lg.tollhouses ) {

		const P = F( s ), [ x, y, z ] = P.at( o, KERB ), rot = Math.atan2( P.ux, P.uz );
		const g = new THREE.Group();
		g.position.set( x, y, z );
		g.rotation.y = rot;
		const k2 = new Kit();
		k2.add( LG.house, box( 3.8, 0.5, 3.8 ), box( 3.4, 4.6, 3.4, 0, 0.5 ) );
		for ( const [ dx, dz ] of [ [ - 1, - 1 ], [ - 1, 1 ], [ 1, - 1 ], [ 1, 1 ] ] ) k2.add( LG.house, box( 0.5, 4.6, 0.5, dx * 1.65, 0.5, dz * 1.65 ) );
		k2.add( LG.house, box( 4.1, 0.45, 4.1, 0, 5.1 ), box( 3.6, 0.6, 3.6, 0, 5.55 ) );
		for ( const [ dx, dz, w, d ] of [ [ 0, 1.71, 1.1, 0.05 ], [ 0, - 1.71, 1.1, 0.05 ], [ 1.71, 0, 0.05, 1.1 ], [ - 1.71, 0, 0.05, 1.1 ] ] ) {

			k2.add( LG.dark, box( w, 2.4, d, dx, 1.0, dz ) );
			// The round head of the opening.
			k2.add( LG.dark, new THREE.CylinderGeometry( 0.55, 0.55, 0.06, 12, 1, false, - Math.PI / 2, Math.PI ).rotateX( Math.PI / 2 ).rotateY( dx ? Math.PI / 2 : 0 ).translate( dx, 3.4, dz ) );

		}

		k2.add( LG.dome, new THREE.SphereGeometry( 1.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2 ).scale( 1, 1.15, 1 ).translate( 0, 6.1, 0 ) );
		k2.add( LG.dome, cyl( 0.35, 0.4, 0.7, 0, 8.05 ), ball( 0.38, 0, 8.95, 0 ) );
		k2.add( LG.gold, cyl( 0.03, 0.05, 0.9, 0, 9.2 ), ball( 0.12, 0, 10.15, 0 ) );
		k2.build( g );
		scene.add( g );

	}

	// Poles on the balustrade, in pairs, with a lantern on a bracket over the deck, a cross span and droppers to the
	// contact wires 5.7 m over the tracks.
	for ( const s of lg.poles ) {

		const P = F( s ), ends = [];
		for ( const sgn of [ - 1, 1 ] ) {

			const [ x, y, z ] = P.at( sgn * ( inner( s ) + lg.rail / 2 ), KERB );
			kit.add( LG.balustrade, box( 0.75, 1.3, 0.75, x, y, z ) );
			kit.add( LG.iron, cyl( 0.2, 0.26, 1.2, x, y + 1.3, z, 10 ), cyl( 0.09, 0.15, 6.6, x, y + 2.5, z, 10 ) );
			kit.add( LG.iron, ball( 0.16, x, y + 9.2, z, 8 ), cyl( 0.02, 0.04, 0.6, x, y + 9.3, z, 6 ) );
			// Lantern on a scrolled bracket, reaching over the sidewalk.
			const [ lx, , lz ] = P.at( sgn * ( inner( s ) - 0.9 ), 0 );
			kit.add( LG.iron, wire( [ x, y + 6.4, z ], [ lx, y + 6.6, lz ], 0.035 ) );
			kit.add( LG.iron, cyl( 0.2, 0.12, 0.25, lx, y + 6.05, lz, 6 ), cyl( 0.12, 0.2, 0.18, lx, y + 6.75, lz, 6 ) );
			kit.add( LG.lamp, cyl( 0.16, 0.13, 0.45, lx, y + 6.3, lz, 6 ) );
			ends.push( [ x, y + 6.9, z ] );

		}

		kit.add( LG.iron, wire( ends[ 0 ], ends[ 1 ], 0.012 ) );
		for ( const track of [ - 1.5, 1.5 ] ) {

			const [ tx, ty, tz ] = P.at( track, 5.72 );
			const k = ( track - ( - inner( s ) - lg.rail / 2 ) ) / ( 2 * ( inner( s ) + lg.rail / 2 ) );
			const sy = ends[ 0 ][ 1 ] + ( ends[ 1 ][ 1 ] - ends[ 0 ][ 1 ] ) * k;
			kit.add( LG.iron, wire( [ tx, ty, tz ], [ tx, sy, tz ], 0.01 ) );

		}

	}

	kit.build( scene );

}

// Shared with Karlův most (src/karluv.js).
export { legieFrame as deckFrame, strip, beam, wire };
