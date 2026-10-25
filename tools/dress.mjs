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
const PLATES_AREA = { x0: - 400, x1: 240, z0: - 80, z1: 350 }; // Betlémské náměstí and the streets round it, to Národní
const DISTRICT = [ 'STARÉ MĚSTO', 'PRAHA 1' ];

const FONTS = { serif: 'Georgia, "Times New Roman", serif', sans: '"Helvetica Neue", Arial, sans-serif', script: '"Brush Script MT", "Segoe Script", cursive' };

export function dressSquare( { places, frontFacing, frame, S, L, sign, yAtLocal, streetData, project, streetFacades, toLocal, buildingInfo, inHouse = () => false } ) {

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
		dress.push( { kind: 'logo', brand: 'pilsner', ...on( svejk, 0.42 + 4.6 / svejk.len, 3.15 ), w: 0.85, h: 1.0 } );
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

	// --- Signs read off street photos, street by street (data/signs.json): each on a house front (RÚIAN code and
	// edge), its centre a fraction across the front from the left as seen from the street, at a height above the
	// pavement.
	const SIGNS = JSON.parse( readFileSync( new URL( '../data/signs.json', import.meta.url ) ) );
	let signsPlaced = 0;
	for ( const g of SIGNS ) {

		const [ code, edge ] = g.front.split( '_' ).map( Number );
		const q = streetFacades.find( f => f.code === code && f.edge === edge );
		if ( ! q ) {

			console.warn( `dress: no front ${g.front} for "${g.text}"` );
			continue;

		}

		const len = Math.hypot( q.b[ 0 ] - q.a[ 0 ], q.b[ 1 ] - q.a[ 1 ] );
		const f = { ...q, len, ux: ( q.b[ 0 ] - q.a[ 0 ] ) / len, uy: ( q.b[ 1 ] - q.a[ 1 ] ) / len };
		// Seen from the street (looking along −n), is the front's first end on the left?
		const aIsLeft = f.ux * - f.n[ 1 ] + f.uy * f.n[ 0 ] > 0;
		const t = Math.max( 0.02, Math.min( 0.98, aIsLeft ? g.fromLeft : 1 - g.fromLeft ) );
		const p = on( f, t, g.height );
		const font = FONTS[ g.font ] || FONTS.serif, text = g.text, sub = g.sub || undefined;
		if ( g.brand ) dress.push( { kind: 'logo', ...p, brand: g.brand, w: g.width || 2.5, h: g.logoHeight || 0.6, blade: g.blade || undefined } );
		else if ( g.kind === 'letters' ) dress.push( { kind: 'letters', ...p, text, h: Math.max( 0.18, Math.min( 0.6, g.width / Math.max( 3, text.length * 0.7 ) ) ), ink: g.ink || '#333333', font, weight: '700', spacing: 8 } );
		else if ( g.kind === 'hanging' ) dress.push( { kind: 'hanging', ...p, w: Math.min( 1.2, g.width || 0.8 ), h: Math.min( 1.0, ( g.width || 0.8 ) * 0.7 ), text, sub, bg: g.bg || '#2b2b2b', ink: g.ink || '#f2ead6', font } );
		else if ( g.kind === 'plaque' ) dress.push( { kind: 'board', ...p, w: Math.min( 0.9, g.width || 0.6 ), h: 0.42, text, sub, bg: g.bg || '#1d1d1d', ink: g.ink || '#ffffff', font, weight: '600', spacing: 2, frame: 'none' } );
		else dress.push( { kind: 'board', ...p, w: Math.max( 1, g.width || 2.5 ), h: sub ? 0.72 : 0.58, text, sub, bg: g.bg || '#222222', ink: g.ink || '#f2ead6', font, weight: '700', spacing: 8, frame: 'none' } );
		signsPlaced ++;

	}

	const osm = JSON.parse( readFileSync( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	// --- David Černý's sculptures (OSM): Viselec, Sigmund Freud hanging by one hand from a pole off a roof over the
	// Husova corner; the rotating head of Franz Kafka in the Quadrio courtyard (src/landmarks.js).
	{

		const at = id => {

			const n = osm.find( e => e.type === 'node' && e.id === id );
			return n ? project( n.lon, n.lat ) : null;

		};
		const v = at( 2517769530 );
		if ( v ) {

			// The pole comes off the roof of the house the point is over (or nearest to), at its eave.
			const wall = frontFacing( v[ 0 ], v[ 1 ], v[ 0 ], v[ 1 ] );
			const eave = wall && buildingInfo.get( wall.code )?.eaveY;
			if ( wall && eave ) {

				const W = [ wall.a[ 0 ] + wall.ux * wall.len * wall.t, wall.a[ 1 ] + wall.uy * wall.len * wall.t ];
				const [ x, z ] = L( ...v ), [ wx, wz ] = L( ...W );
				const out = Math.max( 1.8, Math.hypot( x - wx, z - wz ) );
				const nx = wall.n[ 0 ], nz = - wall.n[ 1 ];
				places.viselec = { x: + ( wx + nx * out ).toFixed( 2 ), z: + ( wz + nz * out ).toFixed( 2 ), wx: + wx.toFixed( 2 ), wz: + wz.toFixed( 2 ), y: + toLocal( W[ 0 ], W[ 1 ], eave )[ 1 ].toFixed( 2 ), ground: yAtLocal( x, z ) };

			}

		}

		const k = at( 3166450188 );
		if ( k ) {

			const [ x, z ] = L( ...k );
			places.kafka = { x, z, y: yAtLocal( x, z ) };

		}

	}

	// --- Národní and Spálená: landmarks from street photos. `at( x, z, sx, sz, h )`: the house front nearest local
	// point (x, z) that faces the street point (sx, sz), at the place along it nearest (x, z), h m above the ground.
	const at = ( x, z, sx, sz, h ) => {

		const f = front( x, z, sx, sz );
		if ( ! f ) return null;
		const [ X, Y ] = S( x, z );
		const t = Math.max( 0.04, Math.min( 0.96, ( ( X - f.a[ 0 ] ) * f.ux + ( Y - f.a[ 1 ] ) * f.uy ) / f.len ) );
		return { ...on( f, t, h ), code: f.code, f, t };

	};
	const put = ( p, item ) => p && dress.push( { ...p, f: undefined, t: undefined, code: undefined, ...item } );
	const SANS = '"Helvetica Neue", Arial, sans-serif', SERIF = 'Georgia, "Times New Roman", serif';
	{

		// Kaňkův palác (Národní 16): the memorial of 17 November 1989. The old arcade along Národní is glazed in now;
		// the memorial fills the arch 8.9 m from the Mikulandská corner (sixth opening from the east, measured off
		// Street View 2025-09): a white stone panel with the bronze of raised hands on a stone step, candles and
		// flowers on the step and on the pavement at its foot. OSM node 3196599841 marks the same arch once its
		// projection offset is taken out. The arch itself is in the house's described ground floor (data/houses.json).
		put( at( - 46.7, 309.8, - 46.7, 290, 0 ), { kind: 'memorial1711' } );
		// Café Louvre (Národní 22): the red lettering across the first floor; on the ground floor the dark green
		// shopfronts, LOUVRE over the door, the small boards of its rooms; Reduta jazz club and Rock Café next door.
		// Upright red roman capitals, widely spaced, as on the house (Street View 2025-09).
		put( at( 12, 298, 12, 280, 6.1 ), { kind: 'letters', text: 'CAFÉ  LOUVRE', h: 0.95, ink: '#c4232a', font: SERIF, weight: '700', spacing: 22 } );
		put( at( 14, 297, 14, 280, 3.5 ), { kind: 'board', w: 3.2, h: 0.75, text: 'LOUVRE', bg: '#173326', ink: '#d9c48a', font: SERIF, weight: '700', spacing: 30, frame: 'none' } );
		put( at( 9, 299, 9, 280, 2.95 ), { kind: 'board', w: 3.6, h: 0.32, text: 'GALERIE · KAVÁRNA · RESTAURACE · BILLIARD', bg: '#101010', ink: '#f4f1e8', font: SANS, weight: '600', spacing: 4, frame: 'none' } );
		put( at( - 3, 301, - 3, 282, 3.5 ), { kind: 'board', w: 3.4, h: 0.62, text: 'REDUTA', sub: 'JAZZ CLUB', bg: '#173326', ink: '#e3c66b', font: SERIF, weight: '700', spacing: 12, frame: 'gold' } );
		put( at( 3, 300, 3, 282, 3.2 ), { kind: 'letters', text: 'Rock Café', h: 0.55, ink: '#ff3b3b', font: '"Brush Script MT", "Segoe Script", cursive', weight: '700', spacing: 2, glow: true } );
		// Palác Metro (Národní 25): east of the stone portal (x ≈ −20.5) KFC's white box sign with the Colonel hangs out
		// over its shopfront at about 3.4 m, a flat one on the fascia beside it (Street View 2025-09).
		put( at( - 12.5, 283, - 12.5, 296, 3.5 ), { kind: 'logo', brand: 'kfc', w: 0.85, h: 0.85, blade: true, glow: true } );
		put( at( - 15.5, 283, - 15.5, 296, 3.35 ), { kind: 'logo', brand: 'kfc', w: 0.8, h: 0.8 } );
		// Česká spořitelna on Na Perštýně: the blue ATM bay, BANKOMAT / ATM over two cash machines.
		put( at( 37.4, 248.2, 50, 248.2, 1.85 ), { kind: 'logo', brand: 'csAtm', w: 3.2, h: 2.4 } );
		// Palác Chicago (Národní 32): its name in grey metal letters over the first floor.
		put( at( 140, 270, 140, 255, 5.6 ), { kind: 'letters', text: 'CHICAGO', h: 0.55, ink: '#8f989d', font: SANS, weight: '700', spacing: 30 } );
		// The Praha insurance house (Národní 7, Osvald Polívka): PRAHA in gold mosaic under the cornice.
		const praha = at( - 244, 323, - 244, 340, 0 );
		if ( praha ) {

			const eave = buildingInfo.get( praha.code )?.eaveY;
			const top = eave ? toLocal( ...S( praha.x, praha.z ), eave )[ 1 ] : praha.y + 15;
			put( praha, { y: + ( top - 2.4 ).toFixed( 2 ), kind: 'board', w: 6.5, h: 1.1, text: 'P R A H A', bg: '#1d2e5c', ink: '#e2b64a', font: SERIF, weight: '700', spacing: 24, frame: 'gold' } );

		}

		// Spálená: the functionalist Olympic (its blue name on the white band, the school's blue band above, the
		// Ypsilon café, the deli), the art nouveau Česká pojišťovna (the red cartouche with the gold lion, GENERALI).
		put( at( 78, 452, 50, 452, 3.4 ), { kind: 'board', w: 6.4, h: 0.95, text: '›  OLYMPIC  ‹', bg: '#f4f4f0', ink: '#2b5fb4', font: SANS, weight: '800', spacing: 18, frame: 'none' } );
		put( at( 78, 452, 50, 452, 7.2 ), { kind: 'board', w: 8.5, h: 0.62, text: 'GYMNÁZIUM A STŘEDNÍ ŠKOLA FUTURUM', bg: '#2350a8', ink: '#ffffff', font: SANS, weight: '700', spacing: 6, frame: 'none' } );
		put( at( 78, 444, 50, 444, 3.4 ), { kind: 'board', w: 2.6, h: 0.8, text: 'Ypsilon', bg: '#efe8d6', ink: '#3a2c20', font: '"Brush Script MT", "Segoe Script", cursive', weight: '700', spacing: 2, frame: 'none' } );
		put( at( 78, 460, 50, 460, 2.9 ), { kind: 'board', w: 3.4, h: 0.36, text: 'LAHŮDKY · CHLEBÍČKY · CUKRÁRNA', bg: '#f4f4f0', ink: '#1d2e5c', font: SANS, weight: '700', spacing: 4, frame: 'none' } );
		put( at( 78, 486, 50, 486, 4.3 ), { kind: 'cartouche', text: 'PRVNÍ ČESKÁ VZÁJEMNÁ', sub: 'POJIŠŤOVNA' } );
		put( at( 78, 494, 50, 494, 3.6 ), { kind: 'board', w: 3.0, h: 0.6, text: 'GENERALI', bg: '#7a1d1d', ink: '#e8c46a', font: SERIF, weight: '700', spacing: 16, frame: 'gold' } );
		for ( const z of [ 474, 480, 492, 498 ] ) put( at( 78, z, 50, z, 7.6 ), { kind: 'mosaic', w: 2.2, h: 0.7 } );
		// Diamant (Spálená 4): cubist pilasters at its door, its name, and (below) the cubist niche round St John.
		const door = at( 47, 613, 30, 613, 0 );
		if ( door ) {

			put( door, { kind: 'cubistDoor', w: 2.2, h: 3.4 } );
			put( { ...door, y: + ( door.y + 3.9 ).toFixed( 2 ) }, { kind: 'letters', text: 'DIAMANT', h: 0.32, ink: '#3a3a38', font: SANS, weight: '700', spacing: 22 } );

		}

	}

	// Statues of St John of Nepomuk in their places (OSM): Platzer's by St Ursula's on Národní, and the one in the
	// cubist niche by Diamant; each faces the street.
	for ( const [ id, sx, sz, frame, near ] of [ [ 6840520600, - 188, 320, null, [ - 188, 344 ] ], [ 4758035848, 30, 604, 'cubist' ] ] ) {

		const n = osm.find( e => e.type === 'node' && e.id === id );
		if ( ! n ) continue;
		// Against the wall nearest the mapped point that faces the street, a little out from it.
		const [ px, pz ] = near || L( ...project( n.lon, n.lat ) ); // (St Ursula's: the point lies inside the church; its front on Národní)
		const wall = front( px, pz, sx, sz );
		let x = px, z = pz, rot = Math.atan2( sx - px, sz - pz );
		if ( wall && wall.d < 9 ) {

			const [ X, Y ] = S( px, pz );
			const t = Math.max( 0.05, Math.min( 0.95, ( ( X - wall.a[ 0 ] ) * wall.ux + ( Y - wall.a[ 1 ] ) * wall.uy ) / wall.len ) );
			const c = on( wall, t, 0 );
			x = + ( c.x + c.n[ 0 ] * ( frame ? 0.9 : 1.2 ) ).toFixed( 2 );
			z = + ( c.z + c.n[ 1 ] * ( frame ? 0.9 : 1.2 ) ).toFixed( 2 );
			rot = Math.atan2( c.n[ 0 ], c.n[ 1 ] );

		}

		dress.push( { kind: 'saint', x, z, y: yAtLocal( x, z ), rot: + rot.toFixed( 3 ), frame } );

	}

	// The National Theatre: the two bronze trigas (Victory's three-horse chariots) on the pylons at the corners of
	// its front on Národní.
	{

		const way = osm.find( e => e.type === 'way' && e.id === 7649971 );
		const f = front( - 370, 360, - 370, 335 );
		const eave = f && buildingInfo.get( f.code )?.eaveY;
		if ( way && eave ) {

			const nodes = new Map( osm.filter( e => e.type === 'node' ).map( e => [ e.id, e ] ) );
			const pts = way.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( q => L( ...project( q.lon, q.lat ) ) );
			const minZ = Math.min( ...pts.map( q => q[ 1 ] ) ), band = pts.filter( q => q[ 1 ] < minZ + 5 );
			const y = toLocal( ...S( band[ 0 ][ 0 ], band[ 0 ][ 1 ] ), eave )[ 1 ];
			for ( const x of [ Math.min( ...band.map( q => q[ 0 ] ) ) + 3.5, Math.max( ...band.map( q => q[ 0 ] ) ) - 3.5 ] ) dress.push( { kind: 'triga', x: + x.toFixed( 2 ), z: + ( minZ + 3.5 ).toFixed( 2 ), y: + ( y + 2.2 ).toFixed( 2 ), rot: Math.PI } );

		}

	}

	// Metro: the pylon with the line B sign by each entrance to Národní třída station.
	for ( const e of osm ) {

		if ( e.type !== 'node' || e.tags?.railway !== 'subway_entrance' ) continue;
		const [ x, z ] = L( ...project( e.lon, e.lat ) );
		if ( x < - 400 || x > 290 || z < 150 || z > 700 || inHouse( ...S( x, z ) ) ) continue; // entrances inside a house (Quadrio) have no pylon
		dress.push( { kind: 'pylon', x, z, y: yAtLocal( x, z ), rot: 0, line: 'B', name: 'Národní třída' } );

	}

	// --- Plates: the red house register number (conscription number) over the blue street number, by the door
	// (the address point in OSM); the red street name plates at the street corners.
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

	console.log( `dress: ${dress.length} signs and fixtures (${signsPlaced} from street photos), ${numbers} house numbers, ${names} street name plates` );

}
