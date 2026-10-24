// Betlémské náměstí as it is, from street photos: the venues' own signs (Švejk's wooden fascia, the gallery's
// lettering, the hotel's name and flags, U Zeleného stromu's portal and inscription), the Oliva Nera terrace in the
// square under its awnings, the cast-iron street clock, the red awnings of no. 2; and, on every house round the
// square and in the streets near it, Prague's enamel plates: the red house register number over the blue street
// number (from the address points in OSM), and the red street name plates at the corners.
//
// Positions are found from the footprints (the house front nearest a point, facing the square); everything is in
// the scene's local frame. Drawn by src/dress.js.

import { readFileSync } from 'node:fs';

// The streets and the square the plates are put up in (local frame bounds).
const PLATES_AREA = { x0: - 190, x1: 70, z0: - 60, z1: 140 };
const DISTRICT = [ 'STARÉ MĚSTO', 'PRAHA 1' ];

export function dressSquare( { places, frontFacing, frame, S, L, sign, yAtLocal, streetData, project } ) {

	const dress = places.dress = [];
	places.plates = [];
	places.awnings = [];

	// A house front: the one nearest local point (x, z) that faces local point (tx, tz).
	const front = ( x, z, tx, tz, opts ) => {

		const [ X, Y ] = S( x, z ), [ TX, TY ] = S( tx, tz );
		const f = frontFacing( X, Y, TX, TY, opts );
		if ( ! f ) console.warn( `dress: no front at ${x}, ${z}` );
		return f;

	};
	// Local frame at a fraction t along a front, h metres above the ground in front of it.
	const on = ( f, t, h ) => {

		const c = frame( f, f.len * t );
		return { x: c.x, z: c.z, y: + ( c.y + h ).toFixed( 2 ), n: c.n, u: c.u, ground: c.y };

	};

	// --- Švejk (no. 7): the dark wooden fascia over the restaurant, the round Švejk badge at its left end, the
	// Pilsner Urquell plaque and a round Pilsner sign hanging out from the wall.
	const svejk = front( - 3, 67, - 3, 62 );
	if ( svejk ) {

		const p = on( svejk, 0.42, 3.15 );
		dress.push( { kind: 'board', ...p, w: 7.4, h: 0.78, text: 'ŠVEJK  RESTAURANT', bg: '#5b3a22', ink: '#f1dca4', font: 'Georgia, serif', weight: '700', spacing: 18, frame: 'wood' } );
		dress.push( { kind: 'badge', ...on( svejk, 0.42 - 4.3 / svejk.len, 3.2 ), r: 0.55, text: 'ŠVEJK', bg: '#f0d79a', ink: '#a8321f', ring: '#c39a3c' } );
		dress.push( { kind: 'board', ...on( svejk, 0.42 + 4.6 / svejk.len, 3.15 ), w: 0.9, h: 0.9, text: 'Pilsner', sub: 'Urquell', bg: '#2a4a32', ink: '#efe2b4', font: 'Georgia, serif', weight: '700', frame: 'gold' } );
		sign( svejk, svejk.len * 0.85, 3.9, '', 'beer' );

	}

	// --- U Zeleného stromu (no. 6): the stone portal with its gateway and the inscription panel above.
	const strom = front( - 4, 59, - 4, 64 );
	if ( strom ) dress.push( { kind: 'portal', ...on( strom, 0.55, 0 ), w: 2.6, h: 3.4, text: 'U zeleného stromu', stone: '#d8cdb4', ink: '#4f493c', number: '351', street: '6' } );

	// --- Galerie U Betlémské kaple (no. 8): its name in dark letters along the front, lamps either side.
	const galerie = front( - 28, 73, - 34, 66 );
	if ( galerie ) {

		dress.push( { kind: 'letters', ...on( galerie, 0.5, 3.45 ), text: 'GALERIE  U  BETLÉMSKÉ  KAPLE', h: 0.42, ink: '#3f3f3d', font: 'Georgia, "Times New Roman", serif', weight: '400', spacing: 22 } );
		for ( const t of [ 0.18, 0.82 ] ) dress.push( { kind: 'lantern', ...on( galerie, t, 3.5 ) } );

	}

	// --- Hotel Betlem Club (no. 9): its name above the ground floor and flags.
	const hotel = front( - 54, 75.5, - 54, 68 );
	if ( hotel ) {

		dress.push( { kind: 'letters', ...on( hotel, 0.5, 3.6 ), text: 'HOTEL  BETLEM  CLUB', h: 0.46, ink: '#26473a', font: 'Georgia, "Times New Roman", serif', weight: '700', spacing: 16 } );
		dress.push( { kind: 'flags', ...on( hotel, 0.22, 4.6 ), flags: [ 'cz' ] } );
		dress.push( { kind: 'flags', ...on( hotel, 0.78, 4.6 ), flags: [ 'eu' ] } );

	}

	// --- Alriso (no. 11) and the Klub Betlémská / Galerie Jaroslava Fragnera (no. 5a): name boards.
	const alriso = front( - 89, 72.5, - 89, 66 );
	if ( alriso ) dress.push( { kind: 'board', ...on( alriso, 0.5, 3.1 ), w: 3.4, h: 0.6, text: 'ALRISO', sub: 'risotteria italiana', bg: '#23262a', ink: '#e9e1cc', font: 'Georgia, serif', weight: '700', spacing: 14, frame: 'none' } );
	const fragner = front( - 16, 45, - 30, 52 );
	if ( fragner ) dress.push( { kind: 'board', ...on( fragner, 0.5, 2.7 ), w: 2.2, h: 0.62, text: 'GALERIE JAROSLAVA FRAGNERA', sub: 'Klub Betlémská', bg: '#111111', ink: '#f4f4f0', font: '"Helvetica Neue", Arial, sans-serif', weight: '600', spacing: 4, frame: 'none' } );

	// --- U Betlémské kaple (no. 2): the restaurant's name and white awnings over the arched ground floor.
	const no2 = front( - 88, 47, - 80, 58 );
	if ( no2 ) {

		dress.push( { kind: 'letters', ...on( no2, 0.5, 3.75 ), text: 'U BETLÉMSKÉ KAPLE', h: 0.4, ink: '#7a1f1a', font: 'Georgia, serif', weight: '700', spacing: 14 } );
		for ( const t of [ 0.2, 0.4, 0.6, 0.8 ] ) {

			const p = on( no2, t, 2.9 );
			places.awnings.push( [ p.x, p.y, p.z, + Math.atan2( p.n[ 0 ], p.n[ 1 ] ).toFixed( 3 ), + Math.min( 2.6, no2.len * 0.16 ).toFixed( 2 ), '#f1efe8' ] );

		}

	}

	// --- Oliva Nera's terrace in the square, under cream awnings lettered with its name, and the street clock at
	// its east end (both where the aerial photo shows them).
	{

		const [ x, z ] = [ - 65.8, 59.3 ];
		dress.push( { kind: 'canopy', x, z, y: yAtLocal( x, z ), rot: 0, w: 13.5, d: 4.6, text: 'RISTORANTE ITALIANO   ·   Oliva Nera   ·   ', cloth: '#e8dcc0', ink: '#5a4630' } );
		const cx = - 57.2, cz = 60.6;
		dress.push( { kind: 'clock', x: cx, z: cz, y: yAtLocal( cx, cz ) } );

	}

	// --- Plates: the red house register number (conscription number) over the blue street number, by the door
	// (the address point in OSM); the red street name plates at the street corners.
	const osm = JSON.parse( readFileSync( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const inArea = ( x, z ) => x > PLATES_AREA.x0 && x < PLATES_AREA.x1 && z > PLATES_AREA.z0 && z < PLATES_AREA.z1;
	let numbers = 0;
	for ( const e of osm ) {

		const t = e.tags || {};
		if ( e.type !== 'node' || ! t[ 'addr:conscriptionnumber' ] || t.name ) continue;
		const [ X, Y ] = project( e.lon, e.lat );
		const [ x, z ] = L( X, Y );
		if ( ! inArea( x, z ) ) continue;
		// The front the address point stands on (its street side): nearest wall facing open ground.
		let best = null;
		for ( let a = 0; a < 8; a ++ ) {

			const tx = x + Math.cos( a * Math.PI / 4 ) * 8, tz = z + Math.sin( a * Math.PI / 4 ) * 8;
			const f = frontFacing( X, Y, ...S( tx, tz ) );
			if ( f && f.d < 4 && ( ! best || f.d < best.d ) ) best = f;

		}

		if ( ! best ) continue;
		// Beside the door: half a metre to the side of the address point, clear of the opening.
		const s = Math.max( 0.6, Math.min( best.len - 0.6, best.len * best.t + 1.1 ) );
		const c = frame( best, s );
		const p = { x: c.x, z: c.z, n: c.n };
		places.plates.push( { ...p, y: + ( c.y + 2.55 ).toFixed( 2 ), kind: 'cp', text: t[ 'addr:conscriptionnumber' ], sub: DISTRICT } );
		if ( t[ 'addr:streetnumber' ] ) places.plates.push( { ...p, y: + ( c.y + 2.2 ).toFixed( 2 ), kind: 'or', text: t[ 'addr:streetnumber' ] } );
		numbers ++;

	}

	// Street name plates: at both ends of each named street (and the square's corners), on the corner house's
	// wall along the street, a metre in from the corner at 3.2 m.
	const streets = new Map();
	for ( const w of streetData.ways ) {

		const name = w.tags?.name;
		if ( ! name || ! w.tags.highway || w.tags.highway === 'steps' || w.pts.length < 2 ) continue;
		( streets.get( name ) || streets.set( name, [] ).get( name ) ).push( w.pts );

	}

	let names = 0;
	const placedAt = [];
	for ( const [ name, lines ] of streets ) for ( const pts of lines ) for ( const end of [ 0, 1 ] ) {

		const P = end ? pts[ pts.length - 1 ] : pts[ 0 ], Q = end ? pts[ pts.length - 2 ] : pts[ 1 ];
		const [ px, pz ] = L( P.X, P.Y );
		if ( ! inArea( px, pz ) ) continue;
		const len = Math.hypot( Q.X - P.X, Q.Y - P.Y ) || 1;
		const ux = ( Q.X - P.X ) / len, uy = ( Q.Y - P.Y ) / len;
		// A few metres into the street from its end, the wall on either side.
		let best = null;
		for ( const side of [ - 1, 1 ] ) {

			const X = P.X + ux * 5 + uy * side * 6, Y = P.Y + uy * 5 - ux * side * 6;
			const f = frontFacing( X, Y, P.X + ux * 5, P.Y + uy * 5 );
			if ( ! f || f.d > 5 || Math.abs( f.ux * ux + f.uy * uy ) < 0.8 ) continue;
			if ( ! best || f.d < best.d ) best = f;

		}

		if ( ! best ) continue;
		// The end of that wall nearer the street's end.
		const da = Math.hypot( best.a[ 0 ] - P.X, best.a[ 1 ] - P.Y ), db = Math.hypot( best.b[ 0 ] - P.X, best.b[ 1 ] - P.Y );
		const s = da < db ? Math.min( 1.2, best.len / 2 ) : Math.max( best.len - 1.2, best.len / 2 );
		const c = frame( best, s );
		if ( placedAt.some( q => q.name === name && Math.hypot( q.x - c.x, q.z - c.z ) < 12 ) ) continue;
		placedAt.push( { name, x: c.x, z: c.z } );
		places.plates.push( { x: c.x, z: c.z, n: c.n, y: + ( c.y + 3.2 ).toFixed( 2 ), kind: 'street', text: name.toUpperCase(), sub: DISTRICT.join( '  ' ) } );
		names ++;

	}

	// The square's own plates, on the corner houses at its entrances.
	for ( const [ x, z, tx, tz, t ] of [ [ - 54, 75.5, - 54, 68, 0.06 ], [ - 98, 74, - 90, 66, 0.9 ], [ - 4, 59, - 4, 64, 0.08 ], [ - 102, 55, - 90, 58, 0.15 ] ] ) {

		const f = front( x, z, tx, tz );
		if ( ! f ) continue;
		const c = frame( f, f.len * t );
		places.plates.push( { x: c.x, z: c.z, n: c.n, y: + ( c.y + 3.2 ).toFixed( 2 ), kind: 'street', text: 'BETLÉMSKÉ NÁMĚSTÍ', sub: DISTRICT.join( '  ' ) } );
		names ++;

	}

	console.log( `dress: ${dress.length} signs and fixtures on Betlémské náměstí, ${numbers} house numbers, ${names} street name plates` );

}
