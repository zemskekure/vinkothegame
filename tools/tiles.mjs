// Cuts the built scene (tools/build-scene.mjs → data/scene/, the whole city in one piece) into the squares the game
// streams (src/stream.js): public/data/tiles/<i>_<j>.bin, one file a square with everything that lies in it, and a
// small index (public/data/scene.json) with what the whole game needs at once: the bounds, the list of squares, the
// hand-made places, the street names, the walk zones and barriers, the landmarks; plus the map (map.png, 1 px a
// metre, drawn here once for the minimap and the big map) and the ground's height every 8 m (heights.bin), for things
// far off whose square isn't in.
//
//   node tools/tiles.mjs            (after node tools/build-scene.mjs)
//
// A square is TILE metres a side (tools/area.mjs) from the area's north-west corner. Its file: 'VT01', the header's
// length (uint32), the header (JSON), then its sections, each starting on 4 bytes:
//   terrain       the ground: its corners as points of the square's 1 m grid (TILE + 1 a side) with their heights
//                 (cm over scene.terrain.min) and normals, its triangles (the drawn ones first; the rest, dropped at
//                 the retaining walls, only fill the walking heights), and the corners moved onto those walls
//   pavement      the raised pavements with their kerbs: corners (mm from the square's corner), normals, triangles
//   walls, wallTable, roofs, roofTable   the houses whose middle is in the square, as the whole city's walls.bin and
//                 roofs.bin (src/unpack.js), with tables of their own
//   surfaces      the two street maps over the square (1 m, as surfaces.bin)
//   footprints    the house mask over the square (0.5 m, a bit a cell)
//   detail        the aerial photo's ground detail over the square (1 m, a grey JPEG)
//   embankment    the river wall's stones (mm), its pillars, posts and railings in the header
// The header also carries the square's street furniture and trees (each tree with its number in the whole city, which
// turns its crown), and the garden and retaining walls.

import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { TILE } from './area.mjs';
import { packColumns, unpackColumns } from './pack.mjs';
import { unpackSurfaces } from '../src/unpack.js';

const SRC = new URL( '../data/scene/', import.meta.url );
const OUT = new URL( '../public/data/', import.meta.url );
const LOW = 8; // metres a sample of the coarse height grid

const t0 = Date.now();
const scene = JSON.parse( await readFile( new URL( 'scene.json', SRC ) ) );
const bin = async name => {

	const b = await readFile( new URL( name, SRC ) );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};
const columns = ( buf, name ) => unpackColumns( buf, scene.packed[ name ].lengths, scene.packed[ name ].deltas, scene.packed[ name ].bytes );

const B = scene.bounds, T = scene.terrain, SF = scene.surface, FP = scene.footprints;
const NX = Math.ceil( ( B.maxX - B.minX ) / TILE ), NZ = Math.ceil( ( B.maxZ - B.minZ ) / TILE );
const tileKey = ( i, j ) => j * NX + i;
const tileAt = ( x, z ) => tileKey( Math.min( NX - 1, Math.max( 0, Math.floor( ( x - B.minX ) / TILE ) ) ), Math.min( NZ - 1, Math.max( 0, Math.floor( ( z - B.minZ ) / TILE ) ) ) );
const tiles = Array.from( { length: NX * NZ }, ( _, k ) => ( { i: k % NX, j: Math.floor( k / NX ), sections: [], header: { furniture: {}, walls: [] } } ) );
const mm = v => Math.round( v * 1000 );
const i8 = v => Math.max( - 127, Math.min( 127, Math.round( v * 127 ) ) );
console.log( `tiles: ${NX} × ${NZ} squares of ${TILE} m` );

function section( tile, name, bytes, packed ) {

	tile.sections.push( { name, bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array( bytes.buffer, bytes.byteOffset, bytes.byteLength ) } );
	if ( packed ) ( tile.header.packed ||= {} )[ name ] = packed;

}

function packed( tile, name, cols, deltas ) {

	const p = packColumns( cols, deltas );
	section( tile, name, p.buffer, { lengths: p.lengths, deltas: p.deltas, bytes: p.bytes } );

}

// Area-weighted vertex normals over a triangle list (as three's computeVertexNormals).
function normals( pos, index, count ) {

	const n = new Float32Array( count * 3 );
	for ( let t = 0; t < index.length; t += 3 ) {

		const a = index[ t ] * 3, b = index[ t + 1 ] * 3, c = index[ t + 2 ] * 3;
		// ( C − B ) × ( A − B ), as three does.
		const cx = pos[ c ] - pos[ b ], cy = pos[ c + 1 ] - pos[ b + 1 ], cz = pos[ c + 2 ] - pos[ b + 2 ];
		const ax = pos[ a ] - pos[ b ], ay = pos[ a + 1 ] - pos[ b + 1 ], az = pos[ a + 2 ] - pos[ b + 2 ];
		const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
		for ( const v of [ a, b, c ] ) {

			n[ v ] += nx;
			n[ v + 1 ] += ny;
			n[ v + 2 ] += nz;

		}

	}

	for ( let v = 0; v < count; v ++ ) {

		const l = Math.hypot( n[ v * 3 ], n[ v * 3 + 1 ], n[ v * 3 + 2 ] );
		if ( l ) for ( let k = 0; k < 3; k ++ ) n[ v * 3 + k ] /= l;
		else n[ v * 3 + 1 ] = 1;

	}

	return n;

}

// ---------------------------------------------------------------------------------------------------------------
// The ground

const fullHeights = new Float32Array( T.width * T.height );
{

	const [ grid, cm, idx ] = columns( await bin( 'terrain.bin' ), 'terrain.bin' );
	const W = T.width, nv = grid.length;
	const pos = new Float32Array( nv * 3 );
	for ( let v = 0; v < nv; v ++ ) {

		const c = grid[ v ] % W, r = ( grid[ v ] - c ) / W;
		pos[ v * 3 ] = B.minX + c * T.cell;
		pos[ v * 3 + 1 ] = T.min + cm[ v ] * T.scale;
		pos[ v * 3 + 2 ] = B.minZ + r * T.cell;

	}

	// The walking heights everywhere (as src/unpack.js fills them), for the map and the coarse grid below.
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ], b = idx[ t + 1 ], c = idx[ t + 2 ];
		const ax = grid[ a ] % W, az = ( grid[ a ] - ax ) / W, bx = grid[ b ] % W, bz = ( grid[ b ] - bx ) / W, cx = grid[ c ] % W, cz = ( grid[ c ] - cx ) / W;
		const det = ( bz - cz ) * ( ax - cx ) + ( cx - bx ) * ( az - cz );
		if ( ! det ) continue;
		for ( let z = Math.min( az, bz, cz ); z <= Math.max( az, bz, cz ); z ++ ) for ( let x = Math.min( ax, bx, cx ); x <= Math.max( ax, bx, cx ); x ++ ) {

			const l0 = ( ( bz - cz ) * ( x - cx ) + ( cx - bx ) * ( z - cz ) ) / det, l1 = ( ( cz - az ) * ( x - cx ) + ( ax - cx ) * ( z - cz ) ) / det, l2 = 1 - l0 - l1;
			if ( l0 < - 1e-6 || l1 < - 1e-6 || l2 < - 1e-6 ) continue;
			fullHeights[ z * W + x ] = l0 * pos[ a * 3 + 1 ] + l1 * pos[ b * 3 + 1 ] + l2 * pos[ c * 3 + 1 ];

		}

	}

	// Retaining walls (as src/main.js did on the whole mesh): grid points within 1.5 m of a wall line move onto it,
	// and triangles still spanning from its top to its foot are left out of the drawn ground.
	const vertexAt = new Map();
	for ( let v = 0; v < nv; v ++ ) vertexAt.set( grid[ v ], v );
	const mark = new Uint8Array( nv ), mids = new Float32Array( nv ), moved = new Uint8Array( nv );
	for ( const [ x0, z0, x1, z1, nx, nz, top, low ] of scene.cliffs || [] ) {

		const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz, mid = ( top + low ) / 2;
		if ( ! l2 ) continue;
		const c0 = Math.max( 0, Math.floor( ( Math.min( x0, x1 ) - 1.6 - B.minX ) / T.cell ) ), c1 = Math.min( W - 1, Math.ceil( ( Math.max( x0, x1 ) + 1.6 - B.minX ) / T.cell ) );
		const r0 = Math.max( 0, Math.floor( ( Math.min( z0, z1 ) - 1.6 - B.minZ ) / T.cell ) ), r1 = Math.min( T.height - 1, Math.ceil( ( Math.max( z0, z1 ) + 1.6 - B.minZ ) / T.cell ) );
		for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

			const i = vertexAt.get( r * W + c );
			if ( i === undefined || mark[ i ] ) continue;
			const x = B.minX + c * T.cell, z = B.minZ + r * T.cell;
			const t = ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / l2;
			if ( t < - 0.01 || t > 1.01 ) continue;
			const d = ( x - x0 ) * nx + ( z - z0 ) * nz, y = pos[ i * 3 + 1 ];
			if ( Math.abs( d ) >= 1.5 ) continue;
			const to = y > mid ? - 0.02 : 0.02;
			pos[ i * 3 ] = x - nx * ( d - to );
			pos[ i * 3 + 2 ] = z - nz * ( d - to );
			mark[ i ] = 1;
			moved[ i ] = 1;
			mids[ i ] = mid;

		}

	}

	const drawn = [], dropped = [];
	for ( let k = 0; k < idx.length; k += 3 ) {

		const v = [ idx[ k ], idx[ k + 1 ], idx[ k + 2 ] ], m = v.find( i => mark[ i ] );
		if ( m !== undefined && v.some( i => pos[ i * 3 + 1 ] > mids[ m ] ) && v.some( i => pos[ i * 3 + 1 ] < mids[ m ] ) ) dropped.push( k );
		else drawn.push( k );

	}

	const drawnIndex = new Uint32Array( drawn.length * 3 );
	drawn.forEach( ( k, n ) => drawnIndex.set( idx.subarray( k, k + 3 ), n * 3 ) );
	const nrm = normals( pos, drawnIndex, nv );

	// Into the squares, by the triangle's middle (every triangle lies within one: tools/rtin.mjs maxSize).
	const per = tiles.map( () => ( { drawn: [], dropped: [] } ) );
	let outside = 0;
	for ( const [ list, key ] of [ [ drawn, 'drawn' ], [ dropped, 'dropped' ] ] ) for ( const k of list ) {

		const g = [ 0, 1, 2 ].map( n => grid[ idx[ k + n ] ] );
		const cs = g.map( q => q % W ), rs = g.map( ( q, n ) => ( q - cs[ n ] ) / W );
		const i = Math.floor( ( cs[ 0 ] + cs[ 1 ] + cs[ 2 ] ) / 3 / ( TILE / T.cell ) ), j = Math.floor( ( rs[ 0 ] + rs[ 1 ] + rs[ 2 ] ) / 3 / ( TILE / T.cell ) );
		const ci = i * TILE / T.cell, rj = j * TILE / T.cell;
		if ( cs.some( c => c < ci || c > ci + TILE / T.cell ) || rs.some( r => r < rj || r > rj + TILE / T.cell ) ) outside ++;
		per[ tileKey( i, j ) ][ key ].push( k );

	}

	if ( outside ) console.warn( `terrain: ${outside} triangles cross a square's edge` );

	const G = TILE / T.cell + 1;
	tiles.forEach( ( tile, key ) => {

		const { drawn, dropped } = per[ key ];
		if ( ! drawn.length && ! dropped.length ) return;
		const local = new Map(), corners = [], index = [];
		for ( const k of [ ...drawn, ...dropped ] ) for ( let n = 0; n < 3; n ++ ) {

			const v = idx[ k + n ];
			if ( ! local.has( v ) ) {

				local.set( v, corners.length );
				corners.push( v );

			}

			index.push( local.get( v ) );

		}

		const ci = tile.i * TILE / T.cell, rj = tile.j * TILE / T.cell;
		const gl = Int32Array.from( corners, v => {

			const c = grid[ v ] % W, r = ( grid[ v ] - c ) / W;
			return ( r - rj ) * G + ( c - ci );

		} );
		const movedList = corners.flatMap( ( v, n ) => moved[ v ] ? [ n, mm( pos[ v * 3 ] - ( B.minX + ( grid[ v ] % W ) * T.cell ) ), mm( pos[ v * 3 + 2 ] - ( B.minZ + Math.floor( grid[ v ] / W ) * T.cell ) ) ] : [] );
		packed( tile, 'terrain', [ gl, Int32Array.from( corners, v => cm[ v ] ), Int32Array.from( index ),
			Int32Array.from( corners, v => i8( nrm[ v * 3 ] ) ), Int32Array.from( corners, v => i8( nrm[ v * 3 + 2 ] ) ),
			Int32Array.from( movedList.filter( ( _, k ) => k % 3 === 0 ) ), Int32Array.from( movedList.filter( ( _, k ) => k % 3 === 1 ) ), Int32Array.from( movedList.filter( ( _, k ) => k % 3 === 2 ) ) ],
		[ 1, 1, 1, 1, 1, 1, 0, 0 ] );
		tile.header.drawn = drawn.length * 3;

	} );
	console.log( `terrain: ${drawn.length} drawn and ${dropped.length} dropped triangles into squares` );

}

// ---------------------------------------------------------------------------------------------------------------
// Raised pavements

{

	const [ xs, ys, zs, idx ] = columns( await bin( 'pavement.bin' ), 'pavement.bin' );
	const nv = xs.length, pos = new Float32Array( nv * 3 );
	for ( let v = 0; v < nv; v ++ ) {

		pos[ v * 3 ] = xs[ v ] / 1000;
		pos[ v * 3 + 1 ] = ys[ v ] / 1000;
		pos[ v * 3 + 2 ] = zs[ v ] / 1000;

	}

	const nrm = normals( pos, idx, nv );
	const per = tiles.map( () => [] );
	for ( let k = 0; k < idx.length; k += 3 ) {

		const x = ( pos[ idx[ k ] * 3 ] + pos[ idx[ k + 1 ] * 3 ] + pos[ idx[ k + 2 ] * 3 ] ) / 3;
		const z = ( pos[ idx[ k ] * 3 + 2 ] + pos[ idx[ k + 1 ] * 3 + 2 ] + pos[ idx[ k + 2 ] * 3 + 2 ] ) / 3;
		per[ tileAt( x, z ) ].push( k );

	}

	tiles.forEach( ( tile, key ) => {

		if ( ! per[ key ].length ) return;
		const local = new Map(), corners = [], index = [];
		for ( const k of per[ key ] ) for ( let n = 0; n < 3; n ++ ) {

			const v = idx[ k + n ];
			if ( ! local.has( v ) ) {

				local.set( v, corners.length );
				corners.push( v );

			}

			index.push( local.get( v ) );

		}

		const ox = B.minX + tile.i * TILE, oz = B.minZ + tile.j * TILE;
		packed( tile, 'pavement', [ Int32Array.from( corners, v => xs[ v ] - mm( ox ) ), Int32Array.from( corners, v => ys[ v ] ), Int32Array.from( corners, v => zs[ v ] - mm( oz ) ),
			Int32Array.from( index ), ...[ 0, 1, 2 ].map( k => Int32Array.from( corners, v => i8( nrm[ v * 3 + k ] ) ) ) ], [ 1, 1, 1, 1, 1, 1, 1 ] );

	} );
	console.log( `pavement: ${idx.length / 3} triangles into squares` );

}

// ---------------------------------------------------------------------------------------------------------------
// Houses: walls and roofs go with the square their house's middle is in.

const houseTile = owner => owner >= 0 && scene.buildings[ owner ] ? tileAt( scene.buildings[ owner ].x, scene.buildings[ owner ].z ) : - 1;
{

	const cols = columns( await bin( 'walls.bin' ), 'walls.bin' );
	const table = new Float32Array( await bin( 'walls-table.bin' ) ), TW = scene.wallStride - 4;
	const [ id, , px, pz, dx, dz ] = cols, owner = cols[ 12 ], quads = id.length;
	const per = tiles.map( () => [] );
	for ( let q = 0; q < quads; q ++ ) {

		let t = houseTile( owner ? owner[ q ] : - 1 );
		if ( t < 0 ) t = tileAt( ( px[ q ] + dx[ q ] / 2 ) / 1000, ( pz[ q ] + dz[ q ] / 2 ) / 1000 );
		per[ t ].push( q );

	}

	tiles.forEach( ( tile, key ) => {

		const list = per[ key ];
		if ( ! list.length ) return;
		const rows = new Map(), out = Array.from( { length: 12 }, () => new Int32Array( list.length ) );
		list.forEach( ( q, n ) => {

			if ( ! rows.has( id[ q ] ) ) rows.set( id[ q ], rows.size );
			out[ 0 ][ n ] = rows.get( id[ q ] );
			for ( let k = 1; k < 12; k ++ ) out[ k ][ n ] = cols[ k ][ q ];

		} );
		packed( tile, 'walls', out, scene.packed[ 'walls.bin' ].deltas.slice( 0, 12 ) );
		const tab = new Float32Array( rows.size * TW );
		for ( const [ g, l ] of rows ) tab.set( table.subarray( g * TW, g * TW + TW ), l * TW );
		section( tile, 'wallTable', tab );

	} );
	console.log( `walls: ${quads} quads into squares` );

}

{

	const cols = columns( await bin( 'roofs.bin' ), 'roofs.bin' );
	const table = new Float32Array( await bin( 'roofs-table.bin' ) ), TR = scene.roofStride - 3;
	const [ xs, ys, zs, ids, idx ] = cols, owner = cols[ 5 ];
	const per = tiles.map( () => [] );
	for ( let k = 0; k < idx.length; k += 3 ) {

		let t = houseTile( owner ? owner[ idx[ k ] ] : - 1 );
		if ( t < 0 ) t = tileAt( ( xs[ idx[ k ] ] + xs[ idx[ k + 1 ] ] + xs[ idx[ k + 2 ] ] ) / 3000, ( zs[ idx[ k ] ] + zs[ idx[ k + 1 ] ] + zs[ idx[ k + 2 ] ] ) / 3000 );
		per[ t ].push( k );

	}

	tiles.forEach( ( tile, key ) => {

		if ( ! per[ key ].length ) return;
		const local = new Map(), corners = [], index = [], rows = new Map();
		for ( const k of per[ key ] ) for ( let n = 0; n < 3; n ++ ) {

			const v = idx[ k + n ];
			if ( ! local.has( v ) ) {

				local.set( v, corners.length );
				corners.push( v );
				if ( ! rows.has( ids[ v ] ) ) rows.set( ids[ v ], rows.size );

			}

			index.push( local.get( v ) );

		}

		packed( tile, 'roofs', [ Int32Array.from( corners, v => xs[ v ] ), Int32Array.from( corners, v => ys[ v ] ), Int32Array.from( corners, v => zs[ v ] ), Int32Array.from( corners, v => rows.get( ids[ v ] ) ), Int32Array.from( index ) ], [ 1, 1, 1, 1, 1 ] );
		const tab = new Float32Array( rows.size * TR );
		for ( const [ g, l ] of rows ) tab.set( table.subarray( g * TR, g * TR + TR ), l * TR );
		section( tile, 'roofTable', tab );

	} );
	console.log( `roofs: ${idx.length / 3} triangles into squares` );

}

// ---------------------------------------------------------------------------------------------------------------
// Street maps, house mask, ground detail

const [ surface, surface2 ] = unpackSurfaces( await bin( 'surfaces.bin' ), SF.width, SF.height );
const mask = new Uint8Array( await bin( 'footprints.bin' ) );
const isHouseCell = ( c, r ) => {

	const i = r * FP.width + c;
	return c >= 0 && r >= 0 && c < FP.width && r < FP.height && ( mask[ i >> 3 ] >> ( i & 7 ) & 1 );

};
let detailRaw;
if ( existsSync( new URL( 'ground-detail-wide.raw', SRC ) ) ) detailRaw = new Uint8Array( await bin( 'ground-detail-wide.raw' ) );
else {

	const img = jpeg.decode( await readFile( new URL( 'ground-detail-wide.jpg', SRC ) ), { useTArray: true, maxMemoryUsageInMB: 2048 } );
	detailRaw = Uint8Array.from( { length: img.width * img.height }, ( _, i ) => img.data[ i * 4 ] );

}

const DW = Math.round( ( B.maxX - B.minX ) ), DH = Math.round( ( B.maxZ - B.minZ ) ); // the wide detail: 1 m a pixel
const ST = TILE / SF.cell, FT = TILE / FP.cell;
for ( const tile of tiles ) {

	// Street maps over the square, each channel as the change from the texel to the left (src/unpack.js).
	const c0 = tile.i * ST, r0 = tile.j * ST, w = Math.min( ST, SF.width - c0 ), h = Math.min( ST, SF.height - r0 );
	if ( w <= 0 || h <= 0 ) continue;
	tile.header.surface = [ w, h ];
	const out = new Uint8Array( w * h * 8 );
	[ surface, surface2 ].forEach( ( map, m ) => {

		for ( let c = 0; c < 4; c ++ ) for ( let r = 0; r < h; r ++ ) for ( let x = 0; x < w; x ++ ) {

			const at = ( rr, xx ) => map[ ( ( r0 + rr ) * SF.width + c0 + xx ) * 4 + c ];
			const left = x ? at( r, x - 1 ) : r ? at( r - 1, 0 ) : 0;
			out[ ( m * 4 + c ) * w * h + r * w + x ] = ( at( r, x ) - left ) & 255;

		}

	} );
	section( tile, 'surfaces', out );

	// The house mask, a bit a 0.5 m cell, row by row over the square.
	const f0 = tile.i * FT, g0 = tile.j * FT, fw = Math.min( FT, FP.width - f0 ), fh = Math.min( FT, FP.height - g0 );
	tile.header.footprints = [ fw, fh ];
	const bits = new Uint8Array( Math.ceil( fw * fh / 8 ) );
	for ( let r = 0; r < fh; r ++ ) for ( let c = 0; c < fw; c ++ ) if ( isHouseCell( f0 + c, g0 + r ) ) {

		const i = r * fw + c;
		bits[ i >> 3 ] |= 1 << ( i & 7 );

	}

	section( tile, 'footprints', bits );

	// The ground detail, a grey JPEG.
	const dw = Math.min( TILE, DW - tile.i * TILE ), dh = Math.min( TILE, DH - tile.j * TILE );
	const px = Buffer.alloc( dw * dh * 4 );
	for ( let r = 0; r < dh; r ++ ) for ( let c = 0; c < dw; c ++ ) {

		const v = detailRaw[ ( tile.j * TILE + r ) * DW + tile.i * TILE + c ];
		px[ ( r * dw + c ) * 4 ] = px[ ( r * dw + c ) * 4 + 1 ] = px[ ( r * dw + c ) * 4 + 2 ] = v;
		px[ ( r * dw + c ) * 4 + 3 ] = 255;

	}

	tile.header.detail = [ dw, dh ];
	section( tile, 'detail', new Uint8Array( jpeg.encode( { data: px, width: dw, height: dh }, 78 ).data ) );

}

// ---------------------------------------------------------------------------------------------------------------
// The river wall, street furniture, garden walls

{

	const stone = new Float32Array( await bin( 'embankment.bin' ) );
	const per = tiles.map( () => [] );
	for ( let t = 0; t < stone.length; t += 9 ) per[ tileAt( ( stone[ t ] + stone[ t + 3 ] + stone[ t + 6 ] ) / 3, ( stone[ t + 2 ] + stone[ t + 5 ] + stone[ t + 8 ] ) / 3 ) ].push( t );
	tiles.forEach( ( tile, key ) => {

		if ( ! per[ key ].length ) return;
		const ox = mm( B.minX + tile.i * TILE ), oz = mm( B.minZ + tile.j * TILE );
		const pick = k => Int32Array.from( per[ key ].flatMap( t => [ 0, 1, 2 ].map( v => mm( stone[ t + v * 3 + k ] ) - ( k === 0 ? ox : k === 2 ? oz : 0 ) ) ) );
		packed( tile, 'embankment', [ pick( 0 ), pick( 1 ), pick( 2 ) ], [ 1, 1, 1 ] );

	} );
	const { posts = [], rails = [] } = scene.embankment || {};
	for ( let p = 0; p < posts.length; p += 3 ) {

		const h = tiles[ tileAt( posts[ p ], posts[ p + 2 ] ) ].header;
		( h.posts ||= { pillars: [], thin: [] } )[ ( p / 3 ) % 2 ? 'thin' : 'pillars' ].push( posts[ p ], posts[ p + 1 ], posts[ p + 2 ] );

	}

	for ( let r = 0; r < rails.length; r += 6 ) ( tiles[ tileAt( ( rails[ r ] + rails[ r + 3 ] ) / 2, ( rails[ r + 2 ] + rails[ r + 5 ] ) / 2 ) ].header.rails ||= [] ).push( ...rails.slice( r, r + 6 ) );
	delete scene.embankment;

}

{

	let trees = 0;
	for ( const [ type, list ] of Object.entries( scene.furniture ) ) {

		for ( let k = 0; k < list.length; k += 5 ) {

			const h = tiles[ tileAt( list[ k ], list[ k + 2 ] ) ].header;
			( h.furniture[ type ] ||= [] ).push( ...list.slice( k, k + 5 ) );
			// A tree's crown is turned by its number in the whole city (src/furniture.js).
			if ( type === 'tree' ) ( h.furniture.treeIndex ||= [] ).push( k / 5 );
			if ( type === 'tree' ) trees ++;

		}

	}

	// Still read whole by the minimap's places (the chimney) and the pigeon's crumbs (benches, bins): kept in the
	// index as the few numbers they need.
	scene.furniture = { chimney: scene.furniture.chimney || [] };
	for ( const w of scene.places?.walls || [] ) tiles[ tileAt( ( w.x0 + w.x1 ) / 2, ( w.z0 + w.z1 ) / 2 ) ].header.walls.push( w );
	console.log( `furniture: ${trees} trees, ${scene.places?.walls?.length || 0} garden and retaining walls into squares` );
	if ( scene.places ) scene.places.walls = [];

}

// ---------------------------------------------------------------------------------------------------------------
// The map (1 px a metre, the minimap's colours: src/minimap.js) and the coarse height grid

const heightAt = ( x, z ) => {

	const fx = Math.min( Math.max( ( x - B.minX ) / T.cell, 0 ), T.width - 1.001 ), fz = Math.min( Math.max( ( z - B.minZ ) / T.cell, 0 ), T.height - 1.001 );
	const x0 = Math.floor( fx ), z0 = Math.floor( fz ), tx = fx - x0, tz = fz - z0, i = z0 * T.width + x0;
	return ( fullHeights[ i ] * ( 1 - tx ) + fullHeights[ i + 1 ] * tx ) * ( 1 - tz ) + ( fullHeights[ i + T.width ] * ( 1 - tx ) + fullHeights[ i + T.width + 1 ] * tx ) * tz;

};

{

	const COLOURS = [ [ 160, 156, 148 ], [ 214, 200, 180 ], [ 104, 149, 178 ], [ 151, 176, 120 ], [ 92, 96, 102 ], [ 186, 182, 172 ], [ 150, 138, 122 ], [ 70, 72, 76 ] ];
	const [ GROUND, HOUSE, RIVER, PARK, ROAD, PAVEMENT, OUTLINE, PARAPET ] = COLOURS.keys();
	const W = SF.width, H = SF.height, px = new Uint8Array( W * H );
	for ( let r = 0; r < H; r ++ ) for ( let c = 0; c < W; c ++ ) {

		const i = r * W + c, x = B.minX + ( c + 0.5 ) * SF.cell, z = B.minZ + ( r + 0.5 ) * SF.cell;
		const F = ( 128 - surface[ i * 4 + 2 ] ) / 25, Fk = ( 128 - surface2[ i * 4 + 2 ] ) / 25;
		px[ i ] = isHouseCell( Math.floor( ( x - B.minX ) / FP.cell ), Math.floor( ( z - B.minZ ) / FP.cell ) ) ? HOUSE : heightAt( x, z ) < scene.waterLevel ? RIVER
			: surface[ i * 4 + 1 ] > 128 ? PARK : F < 0 ? ROAD : Fk > 0 && Fk < 8.5 ? PAVEMENT : GROUND;

	}

	const edge = [];
	for ( let r = 1; r < H - 1; r ++ ) for ( let c = 1; c < W - 1; c ++ ) {

		const i = r * W + c;
		if ( px[ i ] === HOUSE && ( px[ i - 1 ] !== HOUSE || px[ i + 1 ] !== HOUSE || px[ i - W ] !== HOUSE || px[ i + W ] !== HOUSE ) ) edge.push( i );

	}

	for ( const i of edge ) px[ i ] = OUTLINE;

	// Bridges over the river (as src/main.js lists them): a darker parapet round each deck, then the deck.
	const P = scene.places || {}, bridges = [];
	if ( P.legie ) {

		const lg = P.legie, pts = lg.pts.map( p => [ p[ 0 ], p[ 1 ] ] );
		bridges.push( [ { pts: pts.slice( 0, Math.floor( lg.bay.s1 / lg.step ) + 1 ), w: lg.bay.half * 2, fill: PAVEMENT }, { pts, w: lg.half * 2, fill: PAVEMENT }, { pts, w: ( lg.half - lg.rail - lg.walk ) * 2, fill: ROAD, inner: true } ] );

	}

	if ( P.karluv ) bridges.push( [ { pts: P.karluv.pts.slice( 0, Math.floor( P.karluv.sTower / P.karluv.step ) + 1 ).map( p => [ p[ 0 ], p[ 1 ] ] ), w: P.karluv.half * 2, fill: PAVEMENT } ] );
	for ( const b of P.bridges || [] ) bridges.push( [ { pts: [ [ b.x0, b.z0 ], [ b.x1, b.z1 ] ], w: b.w, fill: /footway|path|pedestrian|cycleway/.test( b.kind ) ? PAVEMENT : ROAD } ] );
	const band = ( s, w, colour ) => {

		for ( let k = 1; k < s.pts.length; k ++ ) {

			const [ ax, az ] = s.pts[ k - 1 ], [ bx, bz ] = s.pts[ k ], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
			const c0 = Math.max( 0, Math.floor( Math.min( ax, bx ) - w - B.minX ) ), c1 = Math.min( W - 1, Math.ceil( Math.max( ax, bx ) + w - B.minX ) );
			const r0 = Math.max( 0, Math.floor( Math.min( az, bz ) - w - B.minZ ) ), r1 = Math.min( H - 1, Math.ceil( Math.max( az, bz ) + w - B.minZ ) );
			for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

				const x = B.minX + c + 0.5, z = B.minZ + r + 0.5, t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / l2 ) );
				if ( Math.hypot( x - ax - t * dx, z - az - t * dz ) <= w / 2 ) px[ r * W + c ] = colour;

			}

		}

	};

	for ( const s of bridges.flat() ) if ( ! s.inner ) band( s, s.w + 2 * SF.cell, PARAPET );
	for ( const s of bridges.flat() ) band( s, s.w, s.fill );
	await mkdir( OUT, { recursive: true } );
	await writeFile( new URL( 'map.png', OUT ), png( px, W, H, COLOURS ) );
	scene.map = { file: 'map.png', cell: SF.cell, width: W, height: H };

	// The ground every LOW metres (cm over terrain.min), for what is far off: trams, cars, the overhead line's poles.
	const lw = Math.ceil( ( B.maxX - B.minX ) / LOW ) + 1, lh = Math.ceil( ( B.maxZ - B.minZ ) / LOW ) + 1;
	const low = new Int16Array( lw * lh );
	for ( let r = 0; r < lh; r ++ ) for ( let c = 0; c < lw; c ++ ) low[ r * lw + c ] = Math.round( ( heightAt( B.minX + c * LOW, B.minZ + r * LOW ) - T.min ) * 100 );
	await writeFile( new URL( 'heights.bin', OUT ), new Uint8Array( low.buffer ) );
	scene.coarse = { file: 'heights.bin', cell: LOW, width: lw, height: lh, min: T.min, scale: 0.01 };

}

// A paletted PNG.
function png( pixels, width, height, palette ) {

	const crcTable = Array.from( { length: 256 }, ( _, n ) => {

		let c = n;
		for ( let k = 0; k < 8; k ++ ) c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
		return c >>> 0;

	} );
	const crc = buf => {

		let c = 0xffffffff;
		for ( const b of buf ) c = crcTable[ ( c ^ b ) & 255 ] ^ ( c >>> 8 );
		return ( c ^ 0xffffffff ) >>> 0;

	};
	const chunk = ( type, data ) => {

		const out = Buffer.alloc( 12 + data.length );
		out.writeUInt32BE( data.length, 0 );
		out.write( type, 4, 'latin1' );
		Buffer.from( data ).copy( out, 8 );
		out.writeUInt32BE( crc( out.subarray( 4, 8 + data.length ) ), 8 + data.length );
		return out;

	};
	const ihdr = Buffer.alloc( 13 );
	ihdr.writeUInt32BE( width, 0 );
	ihdr.writeUInt32BE( height, 4 );
	ihdr[ 8 ] = 8; // bit depth
	ihdr[ 9 ] = 3; // paletted
	const raw = Buffer.alloc( ( width + 1 ) * height );
	for ( let r = 0; r < height; r ++ ) Buffer.from( pixels.subarray( r * width, ( r + 1 ) * width ) ).copy( raw, r * ( width + 1 ) + 1 );
	return Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), chunk( 'IHDR', ihdr ), chunk( 'PLTE', Buffer.from( palette.flat() ) ), chunk( 'IDAT', deflateSync( raw, { level: 9 } ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );

}

// ---------------------------------------------------------------------------------------------------------------
// Write the squares and the index

await rm( new URL( 'tiles/', OUT ), { recursive: true, force: true } );
await mkdir( new URL( 'tiles/', OUT ), { recursive: true } );
const list = [];
let total = 0, largest = 0;
for ( const tile of tiles ) {

	if ( ! tile.sections.length && ! tile.header.walls.length ) continue;
	const h = tile.header;
	h.i = tile.i;
	h.j = tile.j;
	let offset = 0;
	h.sections = {};
	for ( const s of tile.sections ) {

		h.sections[ s.name ] = [ offset, s.bytes.length ];
		offset += Math.ceil( s.bytes.length / 4 ) * 4;

	}

	const json = Buffer.from( JSON.stringify( h ) );
	const head = Math.ceil( ( 8 + json.length ) / 4 ) * 4;
	const out = Buffer.alloc( head + offset );
	out.write( 'VT01', 0, 'latin1' );
	out.writeUInt32LE( json.length, 4 );
	json.copy( out, 8 );
	for ( const s of tile.sections ) Buffer.from( s.bytes.buffer, s.bytes.byteOffset, s.bytes.byteLength ).copy( out, head + h.sections[ s.name ][ 0 ] );
	await writeFile( new URL( `tiles/${tile.i}_${tile.j}.bin`, OUT ), out );
	list.push( [ tile.i, tile.j ] );
	total += out.length;
	largest = Math.max( largest, out.length );

}

// The index: the whole scene less what went into the squares.
delete scene.packed;
scene.tiles = { size: TILE, nx: NX, nz: NZ, list };
await writeFile( new URL( 'scene.json', OUT ), JSON.stringify( scene ) );
for ( const name of [ 'life.json', 'ground-detail.jpg' ] ) await writeFile( new URL( name, OUT ), await readFile( new URL( name, SRC ) ) );
// The single-file data of earlier builds.
for ( const name of [ 'walls.bin', 'walls-table.bin', 'roofs.bin', 'roofs-table.bin', 'terrain.bin', 'surfaces.bin', 'pavement.bin', 'footprints.bin', 'embankment.bin', 'ground-detail-wide.jpg' ] ) await rm( new URL( name, OUT ), { force: true } );
console.log( `tiles: ${list.length} squares, ${( total / 1e6 ).toFixed( 1 )} MB (largest ${( largest / 1e6 ).toFixed( 2 )} MB), index ${( ( await stat( new URL( 'scene.json', OUT ) ) ).size / 1e6 ).toFixed( 2 )} MB, in ${( ( Date.now() - t0 ) / 1000 ).toFixed( 0 )} s` );
