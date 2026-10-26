// Domes and towers that rise out of the houses' generic roofs, measured in the surface model (DMP 1G), coloured from
// the aerial photo (drawn by src/domes.js):
//
//   - Kostel sv. Mikuláše on Malostranské náměstí (RÚIAN 46698116): the dome over the crossing, 64 m over the
//     square to its lantern's top; its town belfry beside it (RÚIAN 21666342), a square tower 40 m to its cornice
//     with the tall copper helmet and lantern over it (to 63 m).
//   - Kostel sv. Františka z Assisi on Křižovnické náměstí (RÚIAN 48499013): the dome over the crossing, 42 m.
//   - Klementinum's Astronomical Tower (OSM building:part 382636013, "Astronomická věž"): the square tower out of
//     the college's roofs, its cupola and the lead Atlas carrying the sky on top, 38 m over the courtyards.
//
// A dome is found as the highest point inside the church's footprint, its drum as the area round that point the
// surface model holds within 15 m of the top; the drum stands on the church's roof (the median of the rest of the
// footprint). The churches' generic roofs are kept low (ROOF_CAP), else the hip over the crossing rose through the
// dome.

export const ROOF_CAP = { 46698116: 11, 48499013: 3 };
// Towers modelled whole by src/domes.js (no generic walls or roof).
export const DOME_TOWERS = [ 21666342 ];

const DOMES = [
	{ name: 'Kostel sv. Mikuláše', code: 46698116, kind: 'dome' },
	{ name: 'Kostel sv. Františka z Assisi', code: 48499013, kind: 'dome' },
	{ name: 'Svatomikulášská městská zvonice', code: 21666342, kind: 'belfry' },
	// The tower's corner in the scene frame, as the surface model has it (OSM's outline in the first area lies 10 m off).
	{ name: 'Astronomická věž', at: [ - 74, - 224 ], kind: 'astro' }
];

export function collectDomes( ctx, { L } ) {

	const { buildings, dsm, AREA, terrainAt, toLocal, photoAt, ORIGIN } = ctx;
	if ( ! dsm ) return [];
	const BASE = - toLocal( 0, 0, 0 )[ 1 ];
	const at = ( X, Y ) => {

		const c = Math.floor( ( X - AREA.xmin ) / dsm.cell ), r = Math.floor( ( AREA.ymax - Y ) / dsm.cell );
		return c < 0 || r < 0 || c >= dsm.width || r >= dsm.height ? - 1e9 : dsm.data[ r * dsm.width + c ] - BASE;

	};
	const inRing = ( ring, X, Y ) => {

		let c = false;
		for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) if ( ( ring[ i ][ 1 ] > Y ) !== ( ring[ j ][ 1 ] > Y ) && X < ( ring[ j ][ 0 ] - ring[ i ][ 0 ] ) * ( Y - ring[ i ][ 1 ] ) / ( ring[ j ][ 1 ] - ring[ i ][ 1 ] ) + ring[ i ][ 0 ] ) c = ! c;
		return c;

	};
	const colourAt = ( X, Y, R ) => {

		const px = [];
		for ( let dx = - R; dx <= R; dx += 0.5 ) for ( let dy = - R; dy <= R; dy += 0.5 ) if ( dx * dx + dy * dy <= R * R ) {

			const p = photoAt?.( X + dx, Y + dy );
			if ( p && p[ 0 ] + p[ 1 ] + p[ 2 ] > 120 && p[ 0 ] + p[ 1 ] + p[ 2 ] < 690 ) px.push( p );

		}

		if ( px.length < 4 ) return null;
		const med = k => px.map( p => p[ k ] ).sort( ( a, b ) => a - b )[ px.length >> 1 ];
		return '#' + [ 0, 1, 2 ].map( k => med( k ).toString( 16 ).padStart( 2, '0' ) ).join( '' );

	};
	const byCode = new Map( buildings.map( b => [ b.code, b ] ) );
	const out = [];
	for ( const d of DOMES ) {

		if ( d.kind === 'astro' ) {

			// The tower: the cells over 34 m round the given corner, its top the highest.
			const [ X0, Y0 ] = [ d.at[ 0 ] + ORIGIN.x, ORIGIN.y - d.at[ 1 ] ];
			const cells = [];
			let top = - 1e9, peak = null;
			for ( let dx = - 10; dx <= 10; dx += 0.5 ) for ( let dy = - 10; dy <= 10; dy += 0.5 ) {

				const h = at( X0 + dx, Y0 + dy );
				if ( h > top ) {

					top = h;
					peak = [ X0 + dx, Y0 + dy ];

				}

			}

			for ( let dx = - 8; dx <= 8; dx += 0.5 ) for ( let dy = - 8; dy <= 8; dy += 0.5 ) if ( at( peak[ 0 ] + dx, peak[ 1 ] + dy ) > top - 13 ) cells.push( [ peak[ 0 ] + dx, peak[ 1 ] + dy ] );
			const xs = cells.map( p => p[ 0 ] ), ys = cells.map( p => p[ 1 ] );
			const [ x, z ] = L( ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...ys ) + Math.max( ...ys ) ) / 2 );
			out.push( { kind: 'astro', name: d.name, x, z, w: + ( Math.max( ...xs ) - Math.min( ...xs ) + 0.5 ).toFixed( 2 ), d: + ( Math.max( ...ys ) - Math.min( ...ys ) + 0.5 ).toFixed( 2 ), ground: + terrainAt( ...peak ).toFixed( 2 ), top: + top.toFixed( 2 ), colour: colourAt( ...peak, 2 ) } );
			continue;

		}

		const b = byCode.get( d.code );
		if ( ! b ) continue;
		const ring = b.poly.outer;
		const xs = ring.map( p => p[ 0 ] ), ys = ring.map( p => p[ 1 ] );
		const inside = [];
		for ( let X = Math.min( ...xs ); X <= Math.max( ...xs ); X += 0.5 ) for ( let Y = Math.min( ...ys ); Y <= Math.max( ...ys ); Y += 0.5 ) if ( inRing( ring, X, Y ) ) inside.push( [ X, Y, at( X, Y ) ] );
		const peak = inside.reduce( ( a, p ) => p[ 2 ] > a[ 2 ] ? p : a );
		const ground = Math.min( ...ring.map( ( [ X, Y ] ) => terrainAt( X, Y ) ) );
		if ( d.kind === 'belfry' ) {

			// A square tower: its box from the footprint, the cornice where most of it stands, the helmet to the top.
			const hs = inside.map( p => p[ 2 ] ).sort( ( a, c ) => a - c );
			const [ x, z ] = L( ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...ys ) + Math.max( ...ys ) ) / 2 );
			out.push( { kind: 'belfry', name: d.name, ring: ring.map( ( [ X, Y ] ) => L( X, Y ) ), x, z, ground: + ground.toFixed( 2 ), eave: + hs[ Math.floor( hs.length * 0.5 ) ].toFixed( 2 ), top: + peak[ 2 ].toFixed( 2 ), colour: colourAt( peak[ 0 ], peak[ 1 ], 1.5 ) } );
			continue;

		}

		const disk = [];
		for ( const p of inside ) if ( Math.hypot( p[ 0 ] - peak[ 0 ], p[ 1 ] - peak[ 1 ] ) < 13 && p[ 2 ] > peak[ 2 ] - 15 ) disk.push( p );
		const cx = disk.reduce( ( a, p ) => a + p[ 0 ], 0 ) / disk.length, cy = disk.reduce( ( a, p ) => a + p[ 1 ], 0 ) / disk.length;
		const r = Math.sqrt( disk.length * 0.25 / Math.PI );
		const rest = inside.filter( p => Math.hypot( p[ 0 ] - cx, p[ 1 ] - cy ) > r + 2 ).map( p => p[ 2 ] ).sort( ( a, c ) => a - c );
		const [ x, z ] = L( cx, cy );
		out.push( { kind: 'dome', name: d.name, x, z, r: + r.toFixed( 2 ), base: + rest[ rest.length >> 1 ].toFixed( 2 ), top: + peak[ 2 ].toFixed( 2 ), ground: + ground.toFixed( 2 ), colour: colourAt( cx, cy, r * 0.6 ) } );

	}

	console.log( `places: domes and towers ${out.map( d => `${d.name} ${d.top.toFixed( 1 )} m ${d.colour}` ).join( ', ' )}` );
	return out;

}
