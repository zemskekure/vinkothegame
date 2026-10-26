// Off the main thread: fetches one of the city's squares (tools/tiles.mjs writes them, src/stream.js asks for them)
// and turns it into the arrays the renderer and the walking code take as they are, so a square coming in costs the
// game's frames only the meshes' creation and the upload.

import { unpackColumns } from '../tools/pack.mjs';
import { unpackWalls, unpackRoofs, unpackSurfaces } from './unpack.js';

// Area-weighted vertex normals over an index (three's computeVertexNormals); without an index, a face's own.
function normals( pos, index ) {

	const count = pos.length / 3, n = new Float32Array( pos.length );
	const tri = index ? index.length : count;
	for ( let t = 0; t < tri; t += 3 ) {

		const a = ( index ? index[ t ] : t ) * 3, b = ( index ? index[ t + 1 ] : t + 1 ) * 3, c = ( index ? index[ t + 2 ] : t + 2 ) * 3;
		const cx = pos[ c ] - pos[ b ], cy = pos[ c + 1 ] - pos[ b + 1 ], cz = pos[ c + 2 ] - pos[ b + 2 ];
		const ax = pos[ a ] - pos[ b ], ay = pos[ a + 1 ] - pos[ b + 1 ], az = pos[ a + 2 ] - pos[ b + 2 ];
		const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
		for ( const v of [ a, b, c ] ) {

			n[ v ] += nx;
			n[ v + 1 ] += ny;
			n[ v + 2 ] += nz;

		}

	}

	for ( let v = 0; v < n.length; v += 3 ) {

		const l = Math.hypot( n[ v ], n[ v + 1 ], n[ v + 2 ] ) || 1;
		n[ v ] /= l;
		n[ v + 1 ] /= l;
		n[ v + 2 ] /= l;

	}

	return n;

}

async function grey( bytes, w, h ) {

	const bitmap = await createImageBitmap( new Blob( [ bytes ], { type: 'image/jpeg' } ) );
	const canvas = new OffscreenCanvas( w, h ), ctx = canvas.getContext( '2d', { willReadFrequently: true } );
	ctx.drawImage( bitmap, 0, 0 );
	bitmap.close();
	const rgba = ctx.getImageData( 0, 0, w, h ).data, out = new Uint8Array( w * h );
	for ( let i = 0; i < out.length; i ++ ) out[ i ] = rgba[ i * 4 ];
	return out;

}

async function load( { url, priority, C } ) {

	const res = await fetch( url, { priority } );
	if ( ! res.ok ) throw new Error( `${url}: ${res.status}` );
	const buf = await res.arrayBuffer();
	const bytes = new Uint8Array( buf );
	const view = new DataView( buf );
	if ( String.fromCharCode( ...bytes.subarray( 0, 4 ) ) !== 'VT01' ) throw new Error( `${url}: not a city square` );
	const length = view.getUint32( 4, true ), head = Math.ceil( ( 8 + length ) / 4 ) * 4;
	const h = JSON.parse( new TextDecoder().decode( bytes.subarray( 8, 8 + length ) ) );
	const part = name => h.sections[ name ] && buf.slice( head + h.sections[ name ][ 0 ], head + h.sections[ name ][ 0 ] + h.sections[ name ][ 1 ] );
	const cols = name => unpackColumns( part( name ), h.packed[ name ].lengths, h.packed[ name ].deltas, h.packed[ name ].bytes );
	const ox = C.minX + h.i * C.tile, oz = C.minZ + h.j * C.tile;
	const out = { i: h.i, j: h.j, x0: ox, z0: oz, header: h, bytes: buf.byteLength }, transfer = [];
	const give = ( key, value ) => {

		out[ key ] = value;
		if ( value?.buffer ) transfer.push( value.buffer );
		return value;

	};

	// The ground: corners on the square's 1 m grid, some moved onto the retaining walls; the walking heights filled
	// in from all the triangles at the grid points (the moved corners as they were on the grid).
	if ( h.sections.terrain ) {

		const [ grid, cm, idx, nx, nz, mv, mx, mz ] = cols( 'terrain' ), G = C.tile + 1, n = grid.length;
		const pos = new Float32Array( n * 3 ), nrm = new Float32Array( n * 3 ), ys = new Float32Array( n );
		for ( let v = 0; v < n; v ++ ) {

			const c = grid[ v ] % G, r = ( grid[ v ] - c ) / G;
			ys[ v ] = C.terrainMin + cm[ v ] * C.terrainScale;
			pos[ v * 3 ] = ox + c;
			pos[ v * 3 + 1 ] = ys[ v ];
			pos[ v * 3 + 2 ] = oz + r;
			const a = nx[ v ] / 127, b = nz[ v ] / 127;
			nrm[ v * 3 ] = a;
			nrm[ v * 3 + 1 ] = Math.sqrt( Math.max( 0, 1 - a * a - b * b ) );
			nrm[ v * 3 + 2 ] = b;

		}

		const heights = new Float32Array( G * G );
		for ( let t = 0; t < idx.length; t += 3 ) {

			const a = idx[ t ], b = idx[ t + 1 ], c = idx[ t + 2 ];
			const ax = grid[ a ] % G, az = ( grid[ a ] - ax ) / G, bx = grid[ b ] % G, bz = ( grid[ b ] - bx ) / G, cx = grid[ c ] % G, cz = ( grid[ c ] - cx ) / G;
			const det = ( bz - cz ) * ( ax - cx ) + ( cx - bx ) * ( az - cz );
			if ( ! det ) continue;
			for ( let z = Math.min( az, bz, cz ); z <= Math.max( az, bz, cz ); z ++ ) for ( let x = Math.min( ax, bx, cx ); x <= Math.max( ax, bx, cx ); x ++ ) {

				const l0 = ( ( bz - cz ) * ( x - cx ) + ( cx - bx ) * ( z - cz ) ) / det, l1 = ( ( cz - az ) * ( x - cx ) + ( ax - cx ) * ( z - cz ) ) / det, l2 = 1 - l0 - l1;
				if ( l0 < - 1e-6 || l1 < - 1e-6 || l2 < - 1e-6 ) continue;
				heights[ z * G + x ] = l0 * ys[ a ] + l1 * ys[ b ] + l2 * ys[ c ];

			}

		}

		for ( let k = 0; k < mv.length; k ++ ) {

			pos[ mv[ k ] * 3 ] += mx[ k ] / 1000;
			pos[ mv[ k ] * 3 + 2 ] += mz[ k ] / 1000;

		}

		give( 'terrain', { position: pos, normal: nrm, index: Uint32Array.from( idx.subarray( 0, h.drawn ) ) } );
		transfer.push( pos.buffer, nrm.buffer, out.terrain.index.buffer );
		give( 'heights', heights );

	}

	if ( h.sections.pavement ) {

		const [ xs, ys, zs, idx, nx, ny, nz ] = cols( 'pavement' ), n = xs.length;
		const pos = new Float32Array( n * 3 ), nrm = new Float32Array( n * 3 );
		for ( let v = 0; v < n; v ++ ) {

			pos[ v * 3 ] = ox + xs[ v ] / 1000;
			pos[ v * 3 + 1 ] = ys[ v ] / 1000;
			pos[ v * 3 + 2 ] = oz + zs[ v ] / 1000;
			const l = Math.hypot( nx[ v ], ny[ v ], nz[ v ] ) || 1;
			nrm[ v * 3 ] = nx[ v ] / l;
			nrm[ v * 3 + 1 ] = ny[ v ] / l;
			nrm[ v * 3 + 2 ] = nz[ v ] / l;

		}

		out.pavement = { position: pos, normal: nrm, index: Uint32Array.from( idx ) };
		transfer.push( pos.buffer, nrm.buffer, out.pavement.index.buffer );

	}

	if ( h.sections.walls ) {

		const { walls, index } = unpackWalls( part( 'walls' ), part( 'wallTable' ), h.packed.walls, C.wallStride );
		// Normals from the positions alone (every quad has corners of its own).
		const S = C.wallStride, pos = new Float32Array( walls.length / S * 3 );
		for ( let v = 0; v < pos.length / 3; v ++ ) pos.set( walls.subarray( v * S, v * S + 3 ), v * 3 );
		out.walls = { walls, index, normal: normals( pos, index ) };
		transfer.push( walls.buffer, index.buffer, out.walls.normal.buffer );

	}

	if ( h.sections.roofs ) {

		// Drawn flat (a face's own normal): the corners spread out per triangle.
		const { roofs, index } = unpackRoofs( part( 'roofs' ), part( 'roofTable' ), h.packed.roofs, C.roofStride );
		const S = C.roofStride, flat = new Float32Array( index.length * S ), pos = new Float32Array( index.length * 3 );
		for ( let k = 0; k < index.length; k ++ ) {

			flat.set( roofs.subarray( index[ k ] * S, index[ k ] * S + S ), k * S );
			pos.set( roofs.subarray( index[ k ] * S, index[ k ] * S + 3 ), k * 3 );

		}

		out.roofs = { roofs: flat, normal: normals( pos ), position: pos };
		transfer.push( flat.buffer, out.roofs.normal.buffer, pos.buffer );

	}

	if ( h.sections.surfaces ) {

		const [ w, hh ] = h.surface, [ s1, s2 ] = unpackSurfaces( part( 'surfaces' ), w, hh );
		// What the walking code reads: the kerb field (s2 blue) and how rough the street is under a scooter (0 asphalt,
		// ½ paving stones, 1 setts, a jolt over the tram rails: src/main.js roughAt).
		const fk = new Uint8Array( w * hh ), rough = new Uint8Array( w * hh );
		for ( let i = 0; i < w * hh; i ++ ) {

			fk[ i ] = s2[ i * 4 + 2 ];
			const code = s1[ i * 4 + 2 ] > 128 ? s2[ i * 4 ] : s2[ i * 4 + 1 ];
			const rails = s1[ i * 4 + 3 ] < 20 ? 0.6 : 0;
			rough[ i ] = Math.round( Math.max( rails, code === 40 ? 0.3 : 1 - code / 255 ) * 255 );

		}

		out.surface = { w, h: hh, s1, s2, fk, rough };
		transfer.push( s1.buffer, s2.buffer, fk.buffer, rough.buffer );

	}

	if ( h.sections.footprints ) {

		out.footprints = { w: h.footprints[ 0 ], h: h.footprints[ 1 ], bits: new Uint8Array( part( 'footprints' ) ) };
		transfer.push( out.footprints.bits.buffer );

	}

	if ( h.sections.detail ) {

		const [ w, hh ] = h.detail;
		out.detail = { w, h: hh, data: await grey( new Uint8Array( part( 'detail' ) ), w, hh ) };
		transfer.push( out.detail.data.buffer );

	}

	if ( h.sections.embankment ) {

		const [ xs, ys, zs ] = cols( 'embankment' ), pos = new Float32Array( xs.length * 3 );
		for ( let v = 0; v < xs.length; v ++ ) {

			pos[ v * 3 ] = ox + xs[ v ] / 1000;
			pos[ v * 3 + 1 ] = ys[ v ] / 1000;
			pos[ v * 3 + 2 ] = oz + zs[ v ] / 1000;

		}

		out.embankment = { position: pos, normal: normals( pos ) };
		transfer.push( pos.buffer, out.embankment.normal.buffer );

	}

	return { out, transfer };

}

self.onmessage = async e => {

	const { id } = e.data;
	try {

		const { out, transfer } = await load( e.data );
		self.postMessage( { id, tile: out }, [ ...new Set( transfer ) ] );

	} catch ( err ) {

		self.postMessage( { id, error: String( err?.message || err ) } );

	}

};
