// Compact binary columns for the game's data (public/data/*.bin), shared by tools/build-scene.mjs (writing) and
// src/unpack.js (reading, the same format). A file is a run of integer columns; a column can be stored as the
// differences from one value to the next (small numbers for coordinates walked in order). Every value is folded to
// a small unsigned number (0, -1, 1, -2… → 0, 1, 2, 3…) and a column keeps only as many bytes a value as its
// largest needs, stored by significance (all lowest bytes first, then the next…), so the server's gzip finds long
// runs. Coordinates go in as whole millimetres (or centimetres), not floats.

const fold = v => ( v << 1 ) ^ ( v >> 31 );
const unfold = u => ( u >>> 1 ) ^ - ( u & 1 );

export function packColumns( columns, deltas ) {

	const parts = [], bytes = [];
	columns.forEach( ( column, k ) => {

		const n = column.length, folded = new Uint32Array( n );
		let prev = 0, max = 0;
		for ( let i = 0; i < n; i ++ ) {

			const v = Math.round( column[ i ] );
			folded[ i ] = fold( deltas[ k ] ? v - prev : v ) >>> 0;
			if ( folded[ i ] > max ) max = folded[ i ];
			prev = v;

		}

		const width = max < 256 ? 1 : max < 65536 ? 2 : max < 16777216 ? 3 : 4, out = new Uint8Array( n * width );
		for ( let b = 0; b < width; b ++ ) for ( let i = 0; i < n; i ++ ) out[ b * n + i ] = folded[ i ] >>> ( b * 8 ) & 255;
		parts.push( out );
		bytes.push( width );

	} );
	const buffer = new Uint8Array( parts.reduce( ( n, p ) => n + p.length, 0 ) );
	let o = 0;
	for ( const p of parts ) {

		buffer.set( p, o );
		o += p.length;

	}

	return { buffer, lengths: columns.map( c => c.length ), deltas, bytes };

}

export function unpackColumns( buffer, lengths, deltas, bytes ) {

	const src = new Uint8Array( buffer ), columns = [];
	let o = 0;
	lengths.forEach( ( n, k ) => {

		const width = bytes[ k ], column = new Int32Array( n );
		for ( let b = 0; b < width; b ++ ) {

			const plane = src.subarray( o + b * n, o + ( b + 1 ) * n ), shift = b * 8;
			for ( let i = 0; i < n; i ++ ) column[ i ] |= plane[ i ] << shift;

		}

		for ( let i = 0; i < n; i ++ ) column[ i ] = unfold( column[ i ] );
		if ( deltas[ k ] ) for ( let i = 1; i < n; i ++ ) column[ i ] += column[ i - 1 ];
		columns.push( column );
		o += n * width;

	} );
	return columns;

}
