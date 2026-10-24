// Bridges over the Vltava (tools/places.mjs): Most Legií and the footbridge to Slovanský ostrov. A deck strip per
// OSM way segment (asphalt for roads and tracks, slabs for footways) on sandstone sides, a stone parapet along
// the road decks' outer edges and iron railings along the footways', stone piers down into the river.

import * as THREE from 'three/webgpu';
import { Kit, plain, ashlar } from './kit.js';

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
