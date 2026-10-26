// The city's packed buffers (tools/build-scene.mjs writes them with tools/pack.mjs) back into the arrays the
// renderer draws: millimetres to metres, the per-wall and per-roof tables spread over their corners again.

import { unpackColumns } from '../tools/pack.mjs';

const columns = ( buf, meta ) => unpackColumns( buf, meta.lengths, meta.deltas, meta.bytes );

// Walls: four corners a quad, 24 values a corner (x y z u, then the wall's 20 values from walls-table.bin), and
// two triangles a quad facing out.
export function unpackWalls( buf, tableBuf, meta, stride ) {

	const [ id, flip, px, pz, dx, dz, pyb, dyb, dpt, dyt, pu, du ] = columns( buf, meta );
	const table = new Float32Array( tableBuf ), T = stride - 4, quads = id.length;
	const walls = new Float32Array( quads * 4 * stride ), index = new Uint32Array( quads * 6 );
	for ( let q = 0; q < quads; q ++ ) {

		const x0 = px[ q ] / 1000, z0 = pz[ q ] / 1000, x1 = x0 + dx[ q ] / 1000, z1 = z0 + dz[ q ] / 1000;
		const yb0 = pyb[ q ] / 1000, yb1 = yb0 + dyb[ q ] / 1000, yt0 = yb0 + dpt[ q ] / 1000, yt1 = yt0 + dyt[ q ] / 1000;
		const u0 = pu[ q ] / 1000, u1 = u0 + du[ q ] / 1000;
		const corners = [ [ x0, yb0, z0, u0 ], [ x1, yb1, z1, u1 ], [ x1, yt1, z1, u1 ], [ x0, yt0, z0, u0 ] ];
		const row = table.subarray( id[ q ] * T, id[ q ] * T + T );
		for ( let k = 0; k < 4; k ++ ) {

			const o = ( q * 4 + k ) * stride;
			walls.set( corners[ k ], o );
			walls.set( row, o + 4 );

		}

		const v = q * 4;
		index.set( flip[ q ] ? [ v, v + 2, v + 1, v, v + 3, v + 2 ] : [ v, v + 1, v + 2, v, v + 2, v + 3 ], q * 6 );

	}

	return { walls, index };

}

// Roofs: x y z and the roof's kind, seed and colour (roofs-table.bin) a corner, 8 values; triangles by corner.
export function unpackRoofs( buf, tableBuf, meta, stride ) {

	const [ xs, ys, zs, ids, idx ] = columns( buf, meta );
	const table = new Float32Array( tableBuf ), T = stride - 3, n = xs.length;
	const roofs = new Float32Array( n * stride );
	for ( let i = 0; i < n; i ++ ) {

		roofs[ i * stride ] = xs[ i ] / 1000;
		roofs[ i * stride + 1 ] = ys[ i ] / 1000;
		roofs[ i * stride + 2 ] = zs[ i ] / 1000;
		roofs.set( table.subarray( ids[ i ] * T, ids[ i ] * T + T ), i * stride + 3 );

	}

	return { roofs, index: new Uint32Array( idx.buffer, idx.byteOffset, idx.length ) };

}

// The terrain mesh: its corners as grid points (row × width + column) with their heights (m, relative to the
// scene's base), its triangles by corner; and the 1 m grid's heights filled back in from the triangles.
export function unpackTerrain( buf, meta, terrain ) {

	const [ grid, cm, idx ] = columns( buf, meta ), W = terrain.width, H = terrain.height;
	const y = new Float32Array( grid.length );
	for ( let v = 0; v < grid.length; v ++ ) y[ v ] = terrain.min + cm[ v ] * terrain.scale;
	const index = new Uint32Array( idx.buffer, idx.byteOffset, idx.length );
	const heights = new Float32Array( W * H );
	for ( let t = 0; t < index.length; t += 3 ) {

		const a = index[ t ], b = index[ t + 1 ], c = index[ t + 2 ];
		const ax = grid[ a ] % W, az = ( grid[ a ] - ax ) / W, bx = grid[ b ] % W, bz = ( grid[ b ] - bx ) / W, cx = grid[ c ] % W, cz = ( grid[ c ] - cx ) / W;
		const det = ( bz - cz ) * ( ax - cx ) + ( cx - bx ) * ( az - cz );
		if ( ! det ) continue;
		for ( let z = Math.min( az, bz, cz ); z <= Math.max( az, bz, cz ); z ++ ) for ( let x = Math.min( ax, bx, cx ); x <= Math.max( ax, bx, cx ); x ++ ) {

			const l0 = ( ( bz - cz ) * ( x - cx ) + ( cx - bx ) * ( z - cz ) ) / det, l1 = ( ( cz - az ) * ( x - cx ) + ( ax - cx ) * ( z - cz ) ) / det, l2 = 1 - l0 - l1;
			if ( l0 < - 1e-6 || l1 < - 1e-6 || l2 < - 1e-6 ) continue;
			heights[ z * W + x ] = l0 * y[ a ] + l1 * y[ b ] + l2 * y[ c ];

		}

	}

	return { grid, y, index, heights };

}

export function unpackPavement( buf, meta ) {

	const [ xs, ys, zs, idx ] = columns( buf, meta );
	const positions = new Float32Array( xs.length * 3 );
	for ( let i = 0; i < xs.length; i ++ ) {

		positions[ i * 3 ] = xs[ i ] / 1000;
		positions[ i * 3 + 1 ] = ys[ i ] / 1000;
		positions[ i * 3 + 2 ] = zs[ i ] / 1000;

	}

	return { positions, index: new Uint32Array( idx.buffer, idx.byteOffset, idx.length ) };

}

// The two street surface maps (RGBA, 1 m), stored channel by channel as the change from the texel to the left.
export function unpackSurfaces( buf, width, height ) {

	const src = new Uint8Array( buf ), N = width * height, maps = [ new Uint8Array( N * 4 ), new Uint8Array( N * 4 ) ];
	for ( let m = 0; m < 2; m ++ ) for ( let c = 0; c < 4; c ++ ) {

		const plane = src.subarray( ( m * 4 + c ) * N, ( m * 4 + c + 1 ) * N ), map = maps[ m ];
		for ( let r = 0; r < height; r ++ ) for ( let x = 0; x < width; x ++ ) {

			const i = ( r * width + x ) * 4 + c, left = x ? map[ i - 4 ] : r ? map[ i - width * 4 ] : 0;
			map[ i ] = ( plane[ r * width + x ] + left ) & 255;

		}

	}

	return maps;

}
