// Right-triangulated irregular networks (RTIN, as in Evans, Kollar & Mitchell 2001 and Agafonkin's "Martini"):
// a height grid meshed with big triangles where the ground is flat and small ones where it bends, crack-free.
// The game's ground and pavements are drawn from these meshes instead of a triangle pair per grid cell: a flat
// street of 20 m becomes a handful of triangles, as a late-90s game would have drawn it.
//
// The grid is n × n points with n = 2^k + 1 (pad a smaller grid). heightAt( i, j ) gives the height of a point,
// tolerance( i, j ) how far (m) the mesh may stray from it there; force( i, j ) true keeps a point whatever the
// error (wall feet, the edges of holes). cellKind( i, j ) of the cell with corners (i, j)–(i + 1, j + 1): 0 a hole
// (nothing drawn), 1 drawn by the mesh, 2 drawn by the caller (its triangles are left out, its corners kept), 3 out
// of sight (inside a house): big triangles may run over it, and its own points don't count.

export function rtin( { n, heightAt, tolerance = () => 0.05, force = () => false, cellKind = () => 1 } ) {

	const size = n - 1;
	if ( size & ( size - 1 ) ) throw new Error( 'rtin: the grid must be 2^k + 1 points a side' );

	// Cells by kind, and a summed-area table of the drawn ones (to skip triangles over holes at once).
	const kinds = new Uint8Array( size * size );
	const sat = new Uint32Array( ( size + 1 ) * ( size + 1 ) );
	for ( let j = 0; j < size; j ++ ) {

		let row = 0;
		for ( let i = 0; i < size; i ++ ) {

			const k = kinds[ j * size + i ] = cellKind( i, j );
			row += k === 1 || k === 2 ? 1 : 0;
			sat[ ( j + 1 ) * ( size + 1 ) + i + 1 ] = sat[ j * ( size + 1 ) + i + 1 ] + row;

		}

	}

	const anyCell = ( i0, j0, i1, j1 ) => sat[ j1 * ( size + 1 ) + i1 ] - sat[ j0 * ( size + 1 ) + i1 ] - sat[ j1 * ( size + 1 ) + i0 ] + sat[ j0 * ( size + 1 ) + i0 ] > 0;
	const kindAt = ( i, j ) => i < 0 || j < 0 || i >= size || j >= size ? 0 : kinds[ j * size + i ];

	// Errors, as multiples of the tolerance, per point; points that must stay are infinitely wrong. The points of
	// cells drawn by the caller and the points where a hole meets drawn ground stay too.
	const heights = new Float32Array( n * n ), errors = new Float32Array( n * n ), hidden = new Uint8Array( n * n );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		const around = [ kindAt( i - 1, j - 1 ), kindAt( i, j - 1 ), kindAt( i - 1, j ), kindAt( i, j ) ];
		if ( around.every( k => k === 0 ) ) continue;
		heights[ j * n + i ] = heightAt( i, j, around.every( k => k === 0 || k === 3 ) );
		if ( around.includes( 2 ) || around.includes( 0 ) && around.some( k => k !== 0 ) || force( i, j ) ) errors[ j * n + i ] = Infinity;
		if ( around.every( k => k === 0 || k === 3 ) ) hidden[ j * n + i ] = 1;

	}

	const tol = new Float32Array( n * n );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) tol[ j * n + i ] = Math.max( 1e-4, tolerance( i, j ) );

	// Bottom-up: a triangle (a, b, c) with its right angle at c splits at m, the middle of a–b. The error at m is how
	// far the middle is off the line a–b, and the worst of everything below it.
	const pass = ( ax, ay, bx, by, cx, cy ) => {

		const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
		if ( mx % 1 || my % 1 ) return;
		pass( cx, cy, ax, ay, mx, my );
		pass( bx, by, cx, cy, mx, my );
		const m = my * n + mx;
		let e = hidden[ m ] ? 0 : Math.abs( ( heights[ ay * n + ax ] + heights[ by * n + bx ] ) / 2 - heights[ m ] ) / tol[ m ];
		const l = ( cx + ax ) / 2, lz = ( cy + ay ) / 2, r = ( bx + cx ) / 2, rz = ( by + cy ) / 2;
		if ( ! ( l % 1 || lz % 1 ) ) e = Math.max( e, errors[ lz * n + l ] );
		if ( ! ( r % 1 || rz % 1 ) ) e = Math.max( e, errors[ rz * n + r ] );
		if ( e > errors[ m ] ) errors[ m ] = e;

	};

	pass( 0, 0, size, size, size, 0 );
	pass( size, size, 0, 0, 0, size );

	// Top-down: split while the error is over 1; leaves are drawn by the kind of their cell.
	const triangles = [];
	const emit = ( ax, ay, bx, by, cx, cy ) => {

		const x0 = Math.min( ax, bx, cx ), x1 = Math.max( ax, bx, cx ), y0 = Math.min( ay, by, cy ), y1 = Math.max( ay, by, cy );
		if ( ! anyCell( x0, y0, x1, y1 ) ) return;
		const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
		if ( ! ( mx % 1 || my % 1 ) && errors[ my * n + mx ] > 1 ) {

			emit( cx, cy, ax, ay, mx, my );
			emit( bx, by, cx, cy, mx, my );
			return;

		}

		if ( x1 - x0 === 1 && y1 - y0 === 1 && kinds[ y0 * size + x0 ] !== 1 ) return;
		triangles.push( ay * n + ax, by * n + bx, cy * n + cx );

	};

	emit( 0, 0, size, size, size, 0 );
	emit( size, size, 0, 0, 0, size );
	return { triangles, heights, kinds };

}

// The smallest 2^k + 1 that is at least `points`.
export function rtinSize( points ) {

	let n = 2;
	while ( n + 1 < points ) n *= 2;
	return n + 1;

}
