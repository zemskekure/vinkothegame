// Petřín (tools/petrin.mjs):
//
//   - Petřínská rozhledna (1891), the little Eiffel tower: an octagonal steel lattice on its octagonal base, the
//     corner posts curving in as they rise, rings and cross-bracing on every side, the stair core in the middle; the
//     ticket hall between the feet, the lower gallery and the upper gallery under the small octagonal roof, the mast.
//     60 m to the roof (OSM height), 63.5 m with the mast; painted rust brown.
//   - The funicular's track: two rails on sleepers on a concrete bed, on its viaduct where OSM has it.

import * as THREE from 'three/webgpu';
import { Kit, plain, cyl } from './kit.js';
import { wire, beam } from './bridges.js';

const P = {
	steel: plain( 0x8a4b2e, { roughness: 0.6, metalness: 0.3 } ),
	dark: plain( 0x4a3022, { roughness: 0.7 } ),
	hall: plain( 0xc9bfa8, { roughness: 0.9 } ),
	roof: plain( 0x3e4a44, { roughness: 0.7, flatShading: true } ),
	floor: plain( 0x6d5a4a, { roughness: 0.9 } ),
	rail: plain( 0x5a5a58, { metalness: 0.6, roughness: 0.4 } ),
	sleeper: plain( 0x5b4a3a, { roughness: 0.9 } ),
	bed: plain( 0x9c968a, { roughness: 0.95 } )
};

function addTower( kit, T ) {

	const H = 52, R0 = Math.min( T.r - 0.3, 8.6 ), R1 = 2.6;
	const r = y => R1 + ( R0 - R1 ) * Math.pow( 1 - Math.min( y, H ) / H, 2.6 );
	const corner = ( k, y ) => {

		const a = T.rot + k * Math.PI / 4, rr = r( y );
		return [ T.x + Math.sin( a ) * rr, T.y + y, T.z + Math.cos( a ) * rr ];

	};

	const levels = [];
	for ( let y = 0; y < H; y += y < 18 ? 3 : 4 ) levels.push( y );
	levels.push( H );
	for ( let i = 1; i < levels.length; i ++ ) {

		const y0 = levels[ i - 1 ], y1 = levels[ i ];
		for ( let k = 0; k < 8; k ++ ) {

			const a0 = corner( k, y0 ), a1 = corner( k, y1 ), b0 = corner( k + 1, y0 ), b1 = corner( k + 1, y1 );
			kit.add( P.steel, wire( a0, a1, y0 < 18 ? 0.3 : 0.22 ) );
			kit.add( P.steel, wire( a1, b1, 0.11 ), wire( a0, b1, 0.075 ), wire( b0, a1, 0.075 ) );

		}

	}

	// The stair core.
	kit.add( P.dark, cyl( 0.5, 0.5, H, T.x, T.y, T.z, 8 ) );
	for ( let y = 2; y < H; y += 2.2 ) kit.add( P.dark, beam( [ T.x, T.y + y, T.z ], [ T.x + Math.sin( y ) * 1.6, T.y + y + 0.4, T.z + Math.cos( y ) * 1.6 ], 0.5, 0.06 ) );

	// The ticket hall between the feet: octagonal, a cornice, a low roof.
	const g = new THREE.CylinderGeometry( 6.0, 6.0, 4.2, 8 ).rotateY( T.rot + Math.PI / 8 ).translate( T.x, T.y + 2.1, T.z );
	kit.add( P.hall, g );
	kit.add( P.roof, new THREE.CylinderGeometry( 2.0, 6.6, 1.4, 8 ).rotateY( T.rot + Math.PI / 8 ).translate( T.x, T.y + 4.9, T.z ) );
	for ( let k = 0; k < 8; k ++ ) {

		const a = T.rot + ( k + 0.5 ) * Math.PI / 4;
		kit.add( P.dark, new THREE.BoxGeometry( 1.2, 2.2, 0.1 ).rotateY( a ).translate( T.x + Math.sin( a ) * 5.6, T.y + 1.6, T.z + Math.cos( a ) * 5.6 ) );

	}

	// The galleries: a deck sticking out of the lattice with a railing round it.
	const gallery = ( y, out ) => {

		const R = r( y ) + out;
		kit.add( P.floor, new THREE.CylinderGeometry( R, R, 0.25, 8 ).rotateY( T.rot + Math.PI / 8 ).translate( T.x, T.y + y, T.z ) );
		const pts = [];
		for ( let k = 0; k <= 8; k ++ ) {

			const a = T.rot + ( k + 0.5 ) * Math.PI / 4, rr = R / Math.cos( Math.PI / 8 );
			pts.push( [ T.x + Math.sin( a ) * rr, T.y + y + 0.12, T.z + Math.cos( a ) * rr ] );

		}

		for ( let k = 0; k < 8; k ++ ) {

			const a = pts[ k ], b = pts[ k + 1 ];
			kit.add( P.steel, wire( [ a[ 0 ], a[ 1 ] + 1.1, a[ 2 ] ], [ b[ 0 ], b[ 1 ] + 1.1, b[ 2 ] ], 0.04 ), wire( [ a[ 0 ], a[ 1 ] + 0.5, a[ 2 ] ], [ b[ 0 ], b[ 1 ] + 0.5, b[ 2 ] ], 0.025 ), wire( a, [ a[ 0 ], a[ 1 ] + 1.1, a[ 2 ] ], 0.035 ) );

		}

	};

	gallery( 18, 1.3 );
	gallery( H - 1, 1.4 );
	// The roof over the upper gallery on its posts, the lantern and the mast.
	for ( let k = 0; k < 8; k ++ ) {

		const [ x, , z ] = corner( k, H );
		kit.add( P.steel, wire( [ x, T.y + H, z ], [ x, T.y + H + 2.6, z ], 0.07 ) );

	}

	kit.add( P.roof, new THREE.ConeGeometry( r( H ) + 1.6, 3.4, 8 ).rotateY( T.rot + Math.PI / 8 ).translate( T.x, T.y + H + 4.3, T.z ) );
	kit.add( P.steel, cyl( 0.5, 0.5, 1.6, T.x, T.y + H + 5.6, T.z, 8 ), new THREE.ConeGeometry( 0.7, 1.2, 8 ).translate( T.x, T.y + H + 7.8, T.z ) );
	kit.add( P.dark, cyl( 0.05, 0.08, 3.2, T.x, T.y + H + 8.3, T.z, 5 ) );

}

// Rails 1.435 m apart (OSM gauge) on sleepers every metre, on a concrete bed.
function addTrack( kit, way ) {

	const pts = way.pts;
	for ( let i = 1; i < pts.length; i ++ ) {

		const [ ax, az, ay ] = pts[ i - 1 ], [ bx, bz, by ] = pts[ i ];
		const l = Math.hypot( bx - ax, bz - az ), nx = - ( bz - az ) / l, nz = ( bx - ax ) / l;
		kit.add( P.bed, beam( [ ax, ay - 0.35, az ], [ bx, by - 0.35, bz ], 2.4, way.bridge ? 0.5 : 0.3 ) );
		for ( const s of [ - 0.72, 0.72 ] ) kit.add( P.rail, beam( [ ax + nx * s, ay + 0.05, az + nz * s ], [ bx + nx * s, by + 0.05, bz + nz * s ], 0.07, 0.13 ) );
		for ( const t of [ 0.25, 0.75 ] ) {

			const x = ax + ( bx - ax ) * t, y = ay + ( by - ay ) * t, z = az + ( bz - az ) * t;
			kit.add( P.sleeper, beam( [ x - nx * 1.2, y - 0.07, z - nz * 1.2 ], [ x + nx * 1.2, y - 0.07, z + nz * 1.2 ], 0.25, 0.12 ) );

		}

	}

	// The viaduct's piers down to the ground.
	if ( way.bridge ) for ( let i = 2; i + 1 < pts.length; i += 4 ) {

		const [ x, z, y ] = pts[ i ];
		kit.add( P.bed, cyl( 0.5, 0.6, 9, x, y - 9.3, z, 6 ) );

	}

}

export function addPetrin( scene, petrin ) {

	if ( ! petrin ) return;
	const kit = new Kit();
	if ( petrin.tower ) addTower( kit, petrin.tower );
	for ( const way of petrin.funicular || [] ) addTrack( kit, way );
	kit.build( scene );

}
