// What the walls' arrays tell, without three: plain functions the game runs on the main thread or in the worker that
// unpacks the city's squares (src/tile-worker.js).

// Typical Prague plasters (sRGB), for walls with no measured colour; picked by the wall's seed.
export const PLASTER = [
	0xd9b56a, 0xe3cf9c, 0xd49a55, 0xc98a6c, 0xdcd3c2, 0xd4a28c, 0xbf8263,
	0xaebd98, 0xe6c47a, 0xc4b8a2, 0xd8ac97, 0xb89d72, 0xdcbd92, 0x9fb1b6,
	0xc99780, 0xdcc27e, 0xa9b78f, 0xcda97a, 0xb9c4a8, 0xe0b8a4
];

// Landmark facades (style 1 Národní divadlo sandstone, 2 Máj white panels, 3 Betlémská kaple white render).
const LANDMARK_COLOURS = { 1: 0xb59a74, 2: 0xe6e6e2, 3: 0xf1ede5 };
const linear = c => c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 );

// A wall corner's plaster colour (linear RGB, three per corner): measured from street photos when there is one,
// else a typical Prague plaster. Wall vertex layout: tools/build-scene.mjs WALL_STRIDE.
export function plasterColours( walls, stride ) {

	const n = walls.length / stride, out = new Float32Array( n * 3 );
	for ( let i = 0; i < n; i ++ ) {

		const r = walls[ i * stride + 10 ], hex = LANDMARK_COLOURS[ walls[ i * stride + 16 ] ] ?? ( r >= 0 ? null : PLASTER[ Math.floor( walls[ i * stride + 8 ] * PLASTER.length ) ] );
		const rgb = hex === null ? [ r, walls[ i * stride + 11 ], walls[ i * stride + 12 ] ] : [ ( hex >> 16 & 255 ) / 255, ( hex >> 8 & 255 ) / 255, ( hex & 255 ) / 255 ];
		out[ i * 3 ] = linear( rgb[ 0 ] );
		out[ i * 3 + 1 ] = linear( rgb[ 1 ] );
		out[ i * 3 + 2 ] = linear( rgb[ 2 ] );

	}

	return out;

}

// The street fronts' ground floors, taken from the wall quads while they are still in memory (src/main.js): for
// each street-front quad standing on the ground, [ x0, z0, x1, z1, y0, y1, top, u0, u1, nx, nz, ground-floor row,
// graffiti flag ]. Wall vertex layout: tools/build-scene.mjs WALL_STRIDE.
export function streetFronts( walls, stride, index ) {

	const out = [];
	for ( let q = 0, n = walls.length / stride / 4; q < n; q ++ ) {

		const o = q * 4 * stride, at = k => walls[ o + k ], up = k => walls[ o + 3 * stride + k ];
		const kind = at( 9 ), style = at( 16 );
		if ( kind > 0.5 || style > 0.5 ) continue; // street fronts of ordinary houses only
		if ( at( 1 ) - at( 5 ) > 0.6 ) continue; // a piece of wall above an opening
		const x0 = at( 0 ), z0 = at( 2 ), x1 = walls[ o + stride ], z1 = walls[ o + stride + 2 ];
		const len = Math.hypot( x1 - x0, z1 - z0 );
		if ( len < 0.05 ) continue;
		// Out of the wall: its triangles wind anticlockwise seen from outside unless flipped.
		const flip = index[ q * 6 + 1 ] === q * 4 + 2 ? - 1 : 1;
		const nx = - ( z1 - z0 ) / len * flip, nz = ( x1 - x0 ) / len * flip;
		const houseY = Math.floor( at( 21 ) + 0.5 ), houseW = Math.floor( at( 23 ) + 0.5 );
		const row = Math.floor( houseY / 2 ) - 1, last = out[ out.length - 1 ];
		// The walls come in strips a bay or so wide: a strip carrying straight on from the last is joined to it.
		if ( last && last[ 11 ] === row && Math.hypot( last[ 2 ] - x0, last[ 3 ] - z0 ) < 0.02 && last[ 9 ] * nx + last[ 10 ] * nz > 0.995 ) {

			last[ 2 ] = x1;
			last[ 3 ] = z1;
			last[ 5 ] = walls[ o + stride + 1 ];
			last[ 6 ] = Math.min( last[ 6 ], up( 1 ) );
			last[ 8 ] = walls[ o + stride + 3 ];
			continue;

		}

		out.push( [ x0, z0, x1, z1, at( 1 ), walls[ o + stride + 1 ], up( 1 ), at( 3 ), walls[ o + stride + 3 ], nx, nz, row, houseW % 2 ] );

	}

	return out;

}
