// The levels around the National Theatre, measured rather than taken from OpenStreetMap (whose outlines here sit
// about 10 m south-west of the cadastre and the ČÚZK surface model, like everywhere in the area):
//
//   - Národní is a bridge deck over Divadelní (DMP 1G: 193.3–193.7 m over z 313.5 … 343.5): a square road tunnel,
//     stone balustrades over both mouths (owner's photo 2022, Street View 2025).
//   - Divadelní north of Národní: an open trench between Lažanský palác and the Academy of Sciences at 188.2–188.5 m;
//     one straight flight of 40 granite steps against the Academy's wall from Národní's pavement down to it, a stone
//     balustrade on its open side (owner's photos 2022/2023, Street View 2025).
//   - Divadelní south of Národní: an open trench between the theatre and the piazzetta, 188.1 m at Národní rising to
//     190.0 m at Ostrovní. The piazzetta (náměstí Václava Havla, 193.6–193.9 m) cantilevers over the street's east
//     pavement with a heavy granite parapet on its edge: the pavement runs under it along a stone-clad wall as far
//     as the office building on the square's south side, then along that building's banded stone base (Street View
//     2019).
//   - Nová scéna stands on an open undercroft at the piazzetta's level, a step up from Národní's pavement.
//
// The terrain grid is a height field, so where one level overhangs another the grid carries the lower one and the
// deck over it is a slab of its own (`decks`, drawn with the street's surface by src/main.js), its edges on whole-metre
// grid lines so that the grid's step between the levels stays hidden behind walls. Coordinates below are in the scene frame (x east, z south) from RÚIAN footprints and the surface model.
// Returns railing lines in the format of tools/quay.mjs (drawn and made walk barriers the same way) and the pieces
// for tools/places.mjs and src/theatre.js.

import { ORIGIN } from './area.mjs';

// Codes of the RÚIAN buildings the levels are fitted to.
const THEATRE = 21652228, ACADEMY = 21649651, LAZANSKY = 21649685, SOUTH_BLOCK = 21652244, NOVA_SCENA = 21658722;

// Where the surface model's deck edge is (DMP 1G jumps from the street to the square): x by z.
const DECK_EDGE = [ [ 343.5, - 341.6 ], [ 372, - 341.8 ], [ 385, - 342.6 ], [ 398, - 343.6 ] ];
const COVERED_W = 2.6; // the covered pavement, edge to back wall (Street View 2019)
const COVER_END = 398; // the office building's north face: the cantilever ends there
const TRENCH_END = 434; // Ostrovní
// The tunnel's walls and the covered pavement's back wall stand on whole-metre grid lines, so the terrain under the
// decks (street level) and beside them (deck level) meets behind the walls, out of sight.
const TUNNEL = { zN: 313.5, zS: 343.5, xW: - 348, xE: - 339 };
// The covered pavement's back wall, x by z (the deck edge less the pavement's ~2.4 m, to the metre).
const BACK = [ [ 377, - 339 ], [ 391, - 340 ], [ 1e9, - 341 ] ];

const lerpTable = ( table, z ) => {

	if ( z <= table[ 0 ][ 0 ] ) return table[ 0 ][ 1 ];
	for ( let i = 1; i < table.length; i ++ ) if ( z <= table[ i ][ 0 ] ) {

		const [ z0, x0 ] = table[ i - 1 ], [ z1, x1 ] = table[ i ];
		return x0 + ( x1 - x0 ) * ( z - z0 ) / ( z1 - z0 );

	}

	return table[ table.length - 1 ][ 1 ];

};

export async function buildTerraces( { terrain, tw, th, cell, AREA, bareAt, buildings } ) {

	const S = ( x, z ) => [ x + ORIGIN.x, - z + ORIGIN.y ];
	// Levels from the bare-earth model itself: the terrain grid is smoothed over 9 m, which fills a 5 m deep street
	// only 8 m wide.
	const at = ( x, z ) => bareAt( ...S( x, z ) );
	const byCode = code => buildings.find( b => b.code === code );

	// The x where a footprint's outline crosses the row z, the largest (east face) or smallest (west face) in a range.
	const faceX = ( code, z, x0, x1, east ) => {

		const b = byCode( code );
		if ( ! b ) return null;
		const ring = b.poly.outer.map( ( [ X, Y ] ) => [ X - ORIGIN.x, - ( Y - ORIGIN.y ) ] );
		let best = null;
		for ( let i = 0; i < ring.length; i ++ ) {

			const [ ax, az ] = ring[ i ], [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
			if ( ( az > z ) === ( bz > z ) ) continue;
			const x = ax + ( bx - ax ) * ( z - az ) / ( bz - az );
			if ( x < x0 || x > x1 ) continue;
			if ( best === null || ( east ? x > best : x < best ) ) best = x;

		}

		return best;

	};

	// Grid vertices are at whole scene metres: column c at x = c + (AREA.xmin − ORIGIN.x), row r at z = r − (AREA.ymax − ORIGIN.y).
	const X0 = AREA.xmin - ORIGIN.x, Z0 = - ( AREA.ymax - ORIGIN.y );
	const setV = ( x, z, y, how = 'set' ) => {

		const c = Math.round( ( x - X0 ) / cell ), r = Math.round( ( z - Z0 ) / cell );
		if ( c < 0 || r < 0 || c >= tw || r >= th ) return;
		const i = r * tw + c;
		terrain[ i ] = how === 'min' ? Math.min( terrain[ i ], y ) : how === 'max' ? Math.max( terrain[ i ], y ) : y;

	};

	// --- levels, read before anything is changed
	const median = a => [ ...a ].sort( ( p, q ) => p - q )[ a.length >> 1 ];
	// Národní either side of the tunnel.
	const deckN = median( [ - 356, - 354, - 334, - 332 ].flatMap( x => [ 318, 324, 330, 336 ].map( z => at( x, z ) ) ) );
	// Divadelní's floor along the open trench (bare-earth model; the street is open to the sky there), smoothed.
	const floorRaw = z => z < 340 ? at( - 343, z ) : at( - 345.5, z );
	const floorAt = z => median( [ - 2, - 1, 0, 1, 2 ].map( d => floorRaw( z + d ) ) );
	const floorN = floorAt( 308 ), floorS = floorAt( 346 );
	const floorTable = [];
	for ( let z = 344; z <= TRENCH_END + 2; z += 2 ) floorTable.push( [ z, floorAt( z ) ] );
	const floor = z => z <= TUNNEL.zS ? floorN + ( floorS - floorN ) * Math.max( 0, Math.min( 1, ( z - TUNNEL.zN ) / ( TUNNEL.zS - TUNNEL.zN ) ) ) : lerpTable( floorTable, z );
	// The square, a few metres in from its edge.
	const deckTable = [];
	for ( let z = 344; z <= COVER_END + 2; z += 2 ) deckTable.push( [ z, Math.max( deckN, median( [ - 336, - 334 ].map( x => at( x, z ) ) ) ) ] );
	const deckP = z => lerpTable( deckTable, z );
	const theatreX = z => faceX( THEATRE, z, - 360, - 340, true ) ?? - 349.5;
	const southFace = z => faceX( SOUTH_BLOCK, z, - 346, - 336, false ) ?? - 342;
	const edgeX = z => z <= COVER_END ? lerpTable( DECK_EDGE, z ) : southFace( z ) - 2.4;
	const backX = z => z <= COVER_END ? BACK.find( ( [ z1 ] ) => z <= z1 )[ 1 ] : southFace( z );
	const soffit = z => floor( z ) + 0.12 + 2.9;
	const ceil = deckN - 0.85;

	// --- under Národní: the tunnel at street level, the street either side of it back at Národní's level (the grid
	// is smoothed; the deck over the tunnel is a slab of its own, src/main.js and src/theatre.js)
	for ( let z = Math.ceil( TUNNEL.zN ); z <= Math.floor( TUNNEL.zS ); z ++ ) for ( let x = TUNNEL.xW - 6; x <= TUNNEL.xE + 6; x ++ ) setV( x, z, x >= TUNNEL.xW && x <= TUNNEL.xE ? floor( z ) : deckN );
	// North of it the street between Lažanský palác and the Academy, as surveyed.
	for ( let z = 262; z < TUNNEL.zN; z ++ ) {

		const w = faceX( LAZANSKY, z, - 352, - 330, true ) ?? - 348, e = faceX( ACADEMY, z, - 345, - 325, false ) ?? - 336;
		for ( let x = Math.floor( w ) - 1; x <= Math.ceil( e ) + 1; x ++ ) setV( x, z, Math.min( at( x, z ), ( z > 306 ? floorN : floorAt( z ) ) + 0.05 ), 'min' ); // (under the deck's edge the survey guesses)

	}

	// --- the trench south of Národní: street level to the covered pavement's back wall (to the office building's base
	// south of the cantilever), the square's level beyond it
	for ( let z = Math.ceil( TUNNEL.zS ); z <= TRENCH_END; z ++ ) {

		const b = backX( z ), w = theatreX( z );
		for ( let x = Math.floor( w ) - 2; x <= ( z <= COVER_END ? b : Math.ceil( b ) - 1 ); x ++ ) setV( x, z, floor( z ) );
		if ( z <= COVER_END ) for ( let x = b + 1; x <= - 330; x ++ ) setV( x, z, deckP( z ) );

	}

	// The decks over street level: walked on, drawn with the street's surface (src/main.js).
	const decks = {
		tunnel: { x0: TUNNEL.xW - 1, x1: TUNNEL.xE + 1, z0: TUNNEL.zN, z1: TUNNEL.zS, y: deckN },
		strip: []
	};
	for ( let z = TUNNEL.zS; z <= COVER_END + 1e-6; z += 1 ) decks.strip.push( [ z, edgeX( z ), backX( z ) + 1, deckP( z ) ] );
	const deckAt = ( X, Y ) => {

		const x = X - ORIGIN.x, z = - ( Y - ORIGIN.y ), t = decks.tunnel;
		if ( x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1 ) return t.y;
		if ( z >= TUNNEL.zS && z <= COVER_END && x >= edgeX( z ) && x <= backX( z ) + 1 ) return deckP( z );
		return null;

	};
	// Divadelní between the theatre and the covered pavement is one carriageway (parking along the theatre, one lane;
	// Street View 2019): no generic pavement there, the covered pavement is built (src/theatre.js).
	// 'road' up to the kerb, 'deck' for the square's edge over the covered pavement (granite slabs), else null.
	const trenchStreet = ( X, Y ) => {

		const x = X - ORIGIN.x, z = - ( Y - ORIGIN.y );
		if ( z < TUNNEL.zS - 0.5 || z > COVER_END || x < theatreX( z ) - 1 ) return null;
		if ( x < edgeX( z ) - 0.3 ) return 'road';
		// The square: along Nová scéna's west side, then across to the operations building (RÚIAN).
		return x <= ( z < 368 ? - 329 : - 289 ) ? 'deck' : null;

	};

	// --- railing lines (tools/quay.mjs format; S-JTSK, normals towards the low side)
	const rails = [];
	const P = ( x, z, extra ) => {

		const [ X, Y ] = S( x, z );
		return { X, Y, ...extra };

	};

	// Over the tunnel mouths: the deck's face down to the opening; the balustrades on it are drawn in src/theatre.js.
	const stairW = 2.8, stairOut = 0.25; // the flight's width and its gap from the Academy's wall
	const academyAtTop = faceX( ACADEMY, TUNNEL.zN + 0.5, - 345, - 330, false ) ?? - 338.7;
	const northEnd = academyAtTop - stairOut - stairW - 0.35;
	const lineX = ( x0, x1, z, n, extra ) => {

		const line = [];
		const k = Math.max( 1, Math.ceil( Math.abs( x1 - x0 ) ) );
		for ( let i = 0; i <= k; i ++ ) line.push( P( x0 + ( x1 - x0 ) * i / k, z, { nx: 0, ny: n, ...extra } ) );
		return line;

	};

	rails.push( lineX( TUNNEL.xW, northEnd, TUNNEL.zN, 1, { top: deckN, quay: floorN, wall: true, portal: true, openTop: ceil, bare: true } ) );
	rails.push( lineX( TUNNEL.xW, edgeX( TUNNEL.zS ), TUNNEL.zS, - 1, { top: deckN, quay: floorS, wall: true, portal: true, openTop: ceil, bare: true } ) );

	// The square's edge over the covered pavement: its face down to the soffit, the granite parapet on top.
	{

		const line = [];
		for ( let z = TUNNEL.zS; z <= COVER_END + 1e-6; z += 1 ) line.push( P( edgeX( z ), z, { nx: - 1, ny: 0, top: deckP( z ), quay: floor( z ), wall: true, portal: true, openTop: soffit( z ), parapet: true, thick: 1.15 } ) );
		rails.push( line );

	}

	// The stone-clad back wall of the covered pavement (under the square), stepping back a metre where the pavement
	// widens: a walk barrier for the street level only.
	{

		const line = [];
		for ( let z = TUNNEL.zS; z <= COVER_END + 1e-6; z += 1 ) {

			const b = backX( z ), prev = line.length ? line[ line.length - 1 ] : null;
			const props = { top: deckP( z ) - 0.05, quay: floor( z ), wall: true, bare: true, below: deckP( z ) - 1.5 };
			if ( prev && Math.abs( prev.x - b ) > 0.01 ) {

				// The jog: a short wall across, on the last row of the narrower stretch.
				line.push( P( b, z - 1, { ...props, nx: - 1, ny: 0 } ) );
				line[ line.length - 2 ] = { ...line[ line.length - 2 ], nx: 0, ny: 1 };

			}

			line.push( { ...P( b, z, { nx: - 1, ny: 0, ...props } ), x: b } );

		}

		for ( const p of line ) delete p.x;
		rails.push( line );

	}

	// South of the cantilever: the office building's banded stone base along the pavement, up to the square's level.
	{

		const line = [];
		for ( let z = COVER_END; z <= TRENCH_END - 2 + 1e-6; z += 1 ) line.push( P( backX( z ) - 0.12, z, { nx: - 1, ny: 0, top: deckP( COVER_END ), quay: floor( z ), wall: true, bare: true, noBarrier: true } ) );
		rails.push( line );

	}

	// --- the garden wall along Divadelní's west side, from Divadelní 16–22 up towards Konviktská (owner's Street View
	// screenshots): the garden behind stands ~2 m above the street (DMR 5G: 192.0 against 190.0), so it is a retaining
	// wall 1.5–2 m high with a low iron fence on top, big trees behind. Its line from the street photos and the
	// survey's step between the two levels.
	{

		const A = [ - 322, 198 ], B = [ - 314, 143 ];
		const len = Math.hypot( B[ 0 ] - A[ 0 ], B[ 1 ] - A[ 1 ] );
		const lineX = z => A[ 0 ] + ( B[ 0 ] - A[ 0 ] ) * ( z - A[ 1 ] ) / ( B[ 1 ] - A[ 1 ] );
		const street = z => median( [ 2.5, 3, 3.5 ].map( d => at( lineX( z ) + d, z ) ) );
		const garden = z => Math.max( street( z ) + 1.5, median( [ - 2, - 3, - 4 ].map( d => at( lineX( z ) + d, z ) ) ) );
		// The two levels meet just behind the wall (the grid's step hidden behind it).
		for ( let z = Math.ceil( B[ 1 ] ); z <= Math.floor( A[ 1 ] ); z ++ ) {

			const xl = lineX( z ), c = Math.floor( xl );
			for ( let x = c; x <= c + 4; x ++ ) setV( x, z, street( z ), 'min' );
			for ( let x = c - 4; x < c; x ++ ) setV( x, z, garden( z ), 'max' );

		}

		// Outward normal towards the street (east), in S-JTSK (y north = −z).
		const ux = ( B[ 0 ] - A[ 0 ] ) / len, uz = ( B[ 1 ] - A[ 1 ] ) / len;
		let nx = uz, nz = - ux;
		if ( nx < 0 ) { nx = - nx; nz = - nz; }
		const line = [];
		for ( let s = 0; s <= len + 1e-6; s += 1 ) {

			const z = A[ 1 ] + uz * s, x = A[ 0 ] + ux * s;
			line.push( P( x, z, { nx, ny: - nz, top: garden( z ), quay: street( z ), wall: true, garden: true } ) );

		}

		rails.push( line );

	}

	// --- the stairs from Národní's north pavement down to Divadelní, against the Academy's west wall
	let stairs = null;
	{

		const zTop = TUNNEL.zN, zBot = TUNNEL.zN - 12.4;
		const face = z => faceX( ACADEMY, z, - 345, - 330, false ) ?? - 338.7;
		// The wall leans a little to the east going north: keep the flight parallel to it.
		const xTop = face( zTop + 0.5 ) - stairOut - stairW / 2, xBot = face( zBot + 1.5 ) - stairOut - stairW / 2;
		stairs = { top: [ xTop, deckN, zTop ], bottom: [ xBot, floorN, zBot ], steps: 40, w: stairW };

	}

	// --- Nová scéna's undercroft: the open west part of its ground floor, the lobby block east of it
	let undercroft = null;
	{

		const b = byCode( NOVA_SCENA );
		if ( b ) {

			const ring = b.poly.outer.map( ( [ X, Y ] ) => [ X - ORIGIN.x, - ( Y - ORIGIN.y ) ] );
			const xs = ring.map( p => p[ 0 ] ), zs = ring.map( p => p[ 1 ] );
			const x0 = Math.min( ...xs ), z0 = Math.min( ...zs ), z1 = Math.max( ...zs );
			const lobby = - 289.0; // the enclosed lobby's west wall (OSM part 542223027 moved onto the cadastre)
			const level = deckP( 360 );
			// Its street face on Národní, west to east (the footprint's northern edge).
			const north = x => {

				let best = null;
				for ( let i = 0; i < ring.length; i ++ ) {

					const [ ax, az ] = ring[ i ], [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
					if ( ( ax > x ) === ( bx > x ) ) continue;
					const z = az + ( bz - az ) * ( x - ax ) / ( bx - ax );
					if ( best === null || z < best ) best = z;

				}

				return best;

			};

			// The floor under the building at the square's level (the bare-earth model only guesses under a roof).
			for ( let z = Math.floor( z0 ); z <= Math.ceil( z1 ); z ++ ) for ( let x = Math.floor( x0 ); x <= lobby; x ++ ) {

				const zn = north( x );
				if ( zn !== null && z >= zn + 1.2 ) setV( x, z, level );

			}

			undercroft = {
				ring, level, soffit: level + 3.0, lobby, foot: deckN, front: [ x0 + 2.0, - 292.6 ].map( x => [ x, north( x ) ] ), // the straight street face (RÚIAN)
				// The two stone-clad blocks standing in it (OSM parts 542222507 and 542222509, moved onto the cadastre).
				blocks: [ [ - 321.5, 349.3, - 313.9, 359.7 ], [ - 307.6, 350.5, - 300.1, 360.8 ] ]
			};

		}

	}

	const out = {
		rails, decks, deckAt, trenchStreet,
		tunnel: { ...TUNNEL, ya: floorN, yb: floorS, ceil, deck: deckN },
		trench: {
			zS: TUNNEL.zS, coverEnd: COVER_END, end: TRENCH_END,
			rows: Array.from( { length: Math.round( ( TRENCH_END - TUNNEL.zS ) / 1 ) + 1 }, ( _, i ) => {

				const z = TUNNEL.zS + i;
				return { z, edge: edgeX( z ), back: backX( z ), floor: floor( z ), deck: deckP( Math.min( z, COVER_END ) ), soffit: soffit( z ), theatre: theatreX( z ) };

			} )
		},
		stairs, undercroft,
		piazzetta: { level: deckP( 380 ) },
		lazansky: LAZANSKY
	};

	console.log( `terraces: Národní deck ${( deckN + 184 ).toFixed( 2 )} over Divadelní ${( floorN + 184 ).toFixed( 2 )}–${( floorS + 184 ).toFixed( 2 )}, square ${( out.piazzetta.level + 184 ).toFixed( 2 )}, ${rails.length} walls` );
	return out;

}
