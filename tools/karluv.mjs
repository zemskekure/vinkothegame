// Karlův most (Charles Bridge) and its towers, from the data (drawn by src/karluv.js):
//
//   - The axis is ZABAGED's ("Karlův most"), moved onto the middle of the deck the surface model (DMP 1G) shows: the
//     deck is 9.75 m over the parapets there and its middle lies 0.45 m south of ZABAGED's line, the same along the
//     whole river (measured across the deck every 4 m wherever water is on both sides).
//   - The deck's height is the surface model's along the middle (the median across the walkway, so people, statues
//     and lamps don't count), smoothed over 30 m: the bridge rises gently from Malá Strana to the middle of the river
//     and falls to the Old Town tower. Before, the deck was sampled 10 m at a time against the land at its ends and
//     dipped 3 m over Kampa.
//   - Piers, statues, lamps, ice-guards: the 30 statues and statuary groups and the gas lamps along the parapets are
//     OpenStreetMap points (historic=memorial, memorial=statue, location=bridge; highway=street_lamp,
//     lamp_type=gaslight), the wooden ice-guards upstream are man_made=dolphin. The statues stand in pairs over the
//     15 piers (the aerial photo shows the cutwaters under each pair), so the piers are where the pairs are.
//   - The towers: the Old Town Bridge Tower (RÚIAN 46669388), the Lesser Town Bridge Tower (RÚIAN 30714851) and the
//     Judith Tower (RÚIAN 43633421) from their footprints, their heights from the surface model; the gate between
//     the Lesser Town towers (OSM way 460016966) is two crenellated walls with an arch each, open to the sky between
//     them (the surface model: two 2 m strips 10.5 m over the street, the street between).
//
// OpenStreetMap points are moved onto the cadastre everywhere here (tools/geo.mjs OSM_OFFSET), also inside the first
// area: the Old Town end of the bridge is in it, and the RÚIAN tower footprint and the surface model agree with the
// corrected points, not the raw ones (the raw outline of the tower lies 10 m off).

import { readFileSync } from 'node:fs';

export const TOWER_CODES = { oldTown: 46669388, lesserTown: 30714851, judith: 43633421 };
export const GATE_WAY = 460016966;

// What each statue is, for its silhouette (the works are well documented; kinds in src/karluv.js).
const STATUES = {
	'svatý Václav': [ 'single', 'banner' ],
	'svatý Salvator se svatými Kosmou a Damiánem': [ 'group3', 'christ' ],
	'svatý Vít': [ 'vitus' ],
	'svatí Jan z Mathy, Felix z Valois a Ivan': [ 'turks' ],
	'svatý Vojtěch': [ 'bishop' ],
	'svatý Filip Benicius': [ 'single', 'cross' ],
	'svatá Luitgarda': [ 'luitgarda' ],
	'svatý Kajetán': [ 'kajetan' ],
	'svatý Augustin': [ 'bishop', 'heart' ],
	'svatý Mikuláš Tolentinský': [ 'single', 'basket' ],
	'svatý Vincenc Ferrerský a svatý Prokop': [ 'group2', 'rock' ],
	'svatý Juda Tadeáš': [ 'single', 'club' ],
	'svatý Antonín Paduánský': [ 'single', 'child' ],
	'svatý František Serafinský': [ 'group3', 'angels' ],
	'svatá Ludmila': [ 'single', 'child' ],
	'svatý Jan Nepomucký': [ 'nepomuk' ],
	'svatí Norbert, Václav a Zikmund': [ 'group3' ],
	'svatý František Borgia': [ 'group3', 'angels' ],
	'svatý Jan Křtitel': [ 'single', 'cross' ],
	'svatý Kryštof': [ 'kristof' ],
	'svatí Cyril a Metoděj': [ 'group4' ],
	'svatý František Xaverský': [ 'xaver' ],
	'svatá Anna': [ 'single', 'child' ],
	'svatý Josef': [ 'single', 'child' ],
	'svatý Kříž s Kalvárií': [ 'calvary' ],
	'Pieta': [ 'pieta' ],
	'Madona se svatými Dominikem a Tomášem Akvinským': [ 'madona', 'two' ],
	'svaté Barbora, Markéta a Alžběta': [ 'group3' ],
	'Madona se svatým Bernardem': [ 'madona', 'one' ],
	'svatý Ivo': [ 'group3' ],
	'Bruncvík': [ 'bruncvik' ]
};

export function collectKarluv( ctx, { places, zone, L, S, groundY } ) {

	const { dsm, AREA, terrainAt, riverAt, buildings, projectCadastre } = ctx;
	const feats = ctx.zabagedBridges?.features || ctx.zabagedBridges || [];
	const f = feats.find( q => ( q.attributes || q.properties )?.jmeno === 'Karlův most' );
	const path = f && ( f.geometry.paths || f.geometry.rings || [] )[ 0 ];
	if ( ! path || ! dsm || ! projectCadastre ) return null;
	const BASE = - ctx.toLocal( 0, 0, 0 )[ 1 ];
	const dsmAt = ( X, Y ) => {

		const fx = Math.min( Math.max( ( X - AREA.xmin ) / dsm.cell - 0.5, 0 ), dsm.width - 1.001 ), fy = Math.min( Math.max( ( AREA.ymax - Y ) / dsm.cell - 0.5, 0 ), dsm.height - 1.001 );
		const x0 = Math.floor( fx ), y0 = Math.floor( fy ), tx = fx - x0, ty = fy - y0, i = y0 * dsm.width + x0, d = dsm.data;
		return ( d[ i ] * ( 1 - tx ) + d[ i + 1 ] * tx ) * ( 1 - ty ) + ( d[ i + dsm.width ] * ( 1 - tx ) + d[ i + dsm.width + 1 ] * tx ) * ty - BASE;

	};
	const median = v => [ ...v ].sort( ( a, b ) => a - b )[ v.length >> 1 ];

	// Stations every 2 m from the Malá Strana end, the line evened over ±8 m (ZABAGED's has small kinks).
	const axis = path[ 0 ][ 0 ] < path[ path.length - 1 ][ 0 ] ? [ ...path ] : [ ...path ].reverse();
	let st = [];
	{

		let i = 1, seg0 = 0;
		for ( let s = 0; ; s += 2 ) {

			while ( i < axis.length && seg0 + Math.hypot( axis[ i ][ 0 ] - axis[ i - 1 ][ 0 ], axis[ i ][ 1 ] - axis[ i - 1 ][ 1 ] ) < s ) {

				seg0 += Math.hypot( axis[ i ][ 0 ] - axis[ i - 1 ][ 0 ], axis[ i ][ 1 ] - axis[ i - 1 ][ 1 ] );
				i ++;

			}

			if ( i >= axis.length ) break;
			const [ ax, ay ] = axis[ i - 1 ], [ bx, by ] = axis[ i ], t = ( s - seg0 ) / Math.hypot( bx - ax, by - ay );
			st.push( [ ax + ( bx - ax ) * t, ay + ( by - ay ) * t ] );

		}

		st = st.map( ( p, i ) => {

			const k = Math.min( 4, i, st.length - 1 - i ), w = st.slice( i - k, i + k + 1 );
			return [ w.reduce( ( a, q ) => a + q[ 0 ], 0 ) / w.length, w.reduce( ( a, q ) => a + q[ 1 ], 0 ) / w.length ];

		} );

	}

	const n = st.length;
	const dirAt = i => {

		const a = st[ Math.max( 0, i - 2 ) ], b = st[ Math.min( n - 1, i + 2 ) ], l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		return [ ( b[ 0 ] - a[ 0 ] ) / l, ( b[ 1 ] - a[ 1 ] ) / l ];

	};

	// The deck's middle and width, measured across it where there is water on both sides (S-JTSK: left of the
	// direction of travel is north, o > 0 here).
	{

		const centres = [], widths = [];
		for ( let i = 0; i < n; i += 2 ) {

			const [ X, Y ] = st[ i ], [ ux, uy ] = dirAt( i ), h = o => dsmAt( X - uy * o, Y + ux * o );
			if ( ! riverAt( X - uy * 8, Y + ux * 8 ) || ! riverAt( X + uy * 8, Y - ux * 8 ) ) continue;
			const ref = median( [ - 1, 0, 1 ].map( h ) );
			let lo = 0, hi = 0;
			while ( lo > - 10 && h( lo - 0.25 ) > ref - 2.5 ) lo -= 0.25;
			while ( hi < 10 && h( hi + 0.25 ) > ref - 2.5 ) hi += 0.25;
			if ( hi - lo < 9 || hi - lo > 10.75 ) continue; // a pier's cutwater or a statue on its pedestal
			centres.push( ( lo + hi ) / 2 );
			widths.push( hi - lo );

		}

		const c = centres.length > 10 ? median( centres ) : 0;
		st = st.map( ( [ X, Y ], i ) => {

			const [ ux, uy ] = dirAt( i );
			return [ X - uy * c, Y + ux * c ];

		} );
		console.log( `places: Karlův most axis moved ${c.toFixed( 2 )} m north of ZABAGED's, deck ${( widths.length ? median( widths ) : 0 ).toFixed( 2 )} m wide (${centres.length} sections)` );

	}

	// Position along and across the axis of a S-JTSK point: s (m from the Malá Strana end), o (m, + south).
	const along = ( X, Y ) => {

		let best = null;
		for ( let i = 0; i + 1 < n; i ++ ) {

			const [ ax, ay ] = st[ i ], [ bx, by ] = st[ i + 1 ], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
			const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / l2 ) );
			const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
			if ( ! best || d < best.d ) best = { d, s: ( i + t ) * 2, o: - ( ( X - ax ) * - dy + ( Y - ay ) * dx ) / Math.sqrt( l2 ) };

		}

		return best;

	};

	// The towers: footprints (scene frame), the frame of the bridge where they stand, heights from the surface model.
	const byCode = new Map( buildings.map( b => [ b.code, b ] ) );
	const osm = JSON.parse( readFileSync( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( q => [ q.id, q ] ) );
	const towerOf = ( kind, ring ) => {

		const xs = ring.map( p => p[ 0 ] ), ys = ring.map( p => p[ 1 ] );
		const inside = [];
		for ( let X = Math.min( ...xs ); X <= Math.max( ...xs ); X += 0.5 ) for ( let Y = Math.min( ...ys ); Y <= Math.max( ...ys ); Y += 0.5 ) {

			let c = false;
			for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) if ( ( ring[ i ][ 1 ] > Y ) !== ( ring[ j ][ 1 ] > Y ) && X < ( ring[ j ][ 0 ] - ring[ i ][ 0 ] ) * ( Y - ring[ i ][ 1 ] ) / ( ring[ j ][ 1 ] - ring[ i ][ 1 ] ) + ring[ i ][ 0 ] ) c = ! c;
			if ( c ) inside.push( dsmAt( X, Y ) );

		}

		inside.sort( ( a, b ) => a - b );
		const ground = Math.min( ...ring.map( ( [ X, Y ] ) => terrainAt( X, Y ) ) );
		return {
			kind, ring: ring.map( ( [ X, Y ] ) => L( X, Y ) ), ground: + ground.toFixed( 2 ),
			// The plateau (the gallery round the roof, the eaves) and the top of the roof.
			eave: + inside[ Math.floor( inside.length * 0.3 ) ].toFixed( 2 ), top: + inside[ inside.length - 1 ].toFixed( 2 ),
			// The gate's walls (two strips of its outline) by the upper quarter.
			upper: + inside[ Math.floor( inside.length * 0.75 ) ].toFixed( 2 )
		};

	};

	const towers = [];
	for ( const [ kind, code ] of Object.entries( TOWER_CODES ) ) {

		const b = byCode.get( code );
		if ( b ) towers.push( towerOf( kind, b.poly.outer ) );

	}

	const gateWay = osm.find( e => e.type === 'way' && e.id === GATE_WAY );
	if ( gateWay ) {

		const ring = gateWay.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( q => projectCadastre( q.lon, q.lat ) );
		ring.pop();
		towers.push( towerOf( 'gate', ring ) );

	}

	// Where the Old Town tower stands on the axis: the deck runs through its passage.
	const old = towers.find( t => t.kind === 'oldTown' );
	let sTower = n * 2, sTowerEnd = n * 2;
	if ( old ) {

		const ss = byCode.get( TOWER_CODES.oldTown ).poly.outer.map( ( [ X, Y ] ) => along( X, Y ) ).filter( p => Math.abs( p.o ) < 7 ).map( p => p.s );
		sTower = Math.min( ...ss );
		sTowerEnd = Math.max( ...ss );

	}

	// Heights: the median across the walkway, then a running median over 22 m and a mean over 30 m. Inside the tower
	// and past it the deck runs level through the passage and down to Křižovnické náměstí's ground.
	const iTower = Math.max( 4, Math.floor( ( sTower - 2 ) / 2 ) );
	let ys = st.map( ( [ X, Y ], i ) => {

		const [ ux, uy ] = dirAt( i ), hs = [];
		for ( let o = - 3; o <= 3; o += 0.5 ) hs.push( dsmAt( X - uy * o, Y + ux * o ) );
		return median( hs );

	} ).slice( 0, iTower );
	ys = ys.map( ( _, i ) => median( ys.slice( Math.max( 0, i - 5 ), i + 6 ) ) );
	ys = ys.map( ( _, i ) => {

		const w = ys.slice( Math.max( 0, i - 7 ), i + 8 );
		return w.reduce( ( a, v ) => a + v, 0 ) / w.length;

	} );
	// Meet the street at the Malá Strana end, over the first 10 m. At the Old Town end, Křižovnické náměstí's level is
	// the surface model's (the terrain model has the river's edge under the end of the axis).
	const y0 = groundY( ...st[ 0 ] );
	ys = ys.map( ( y, i ) => i * 2 < 10 ? y0 + ( y - y0 ) * i * 2 / 10 : y );
	const yT = ys[ ys.length - 1 ], yEnd = ( ( [ X, Y ], [ ux, uy ] ) => median( [ - 2, - 1, 0, 1, 2 ].map( o => dsmAt( X - uy * o, Y + ux * o ) ) ) )( st[ n - 1 ], dirAt( n - 1 ) ), iEnd = n - 1, iPass = Math.min( iEnd, Math.ceil( ( sTowerEnd + 1 ) / 2 ) );
	for ( let i = iTower; i < n; i ++ ) ys.push( i <= iPass ? yT + ( Math.min( yT, yEnd + 0.4 ) - yT ) * ( i - iTower ) / Math.max( 1, iPass - iTower ) : Math.min( yT, yEnd + 0.4 ) + ( yEnd - Math.min( yT, yEnd + 0.4 ) ) * ( i - iPass ) / Math.max( 1, iEnd - iPass ) );

	const pts = st.map( ( [ X, Y ], i ) => [ ...L( X, Y ), + ys[ i ].toFixed( 2 ) ] );
	// The river's surface (the terrain model's water level under the bridge).
	const wet = st.filter( ( [ X, Y ] ) => riverAt( X, Y ) ).map( ( [ X, Y ] ) => terrainAt( X, Y ) );
	const waterY = wet.length ? Math.min( ...wet ) : 0;
	// The ground (or the river bed's water) under the middle and the edges of the deck, for the piers and the arches.
	const low = st.map( ( [ X, Y ], i ) => {

		const [ ux, uy ] = dirAt( i );
		return + Math.min( ...[ - 4, 0, 4 ].map( o => riverAt( X - uy * o, Y + ux * o ) ? waterY : terrainAt( X - uy * o, Y + ux * o ) ) ).toFixed( 2 );

	} );

	// Statues, lamps and ice-guards from OpenStreetMap, by their place along the axis.
	const statues = [], lamps = [], guards = [];
	let cross = null;
	for ( const q of nodes.values() ) {

		const t = q.tags;
		if ( ! t ) continue;
		const isStatue = t.memorial === 'statue' && ( t.location === 'bridge' || STATUES[ t.name ]?.[ 0 ] === 'bruncvik' );
		const isLamp = t.highway === 'street_lamp', isGuard = t.man_made === 'dolphin', isCross = t.historic === 'wayside_shrine' && /Karlově mostě/.test( t.description || '' );
		if ( ! isStatue && ! isLamp && ! isGuard && ! isCross ) continue;
		const [ X, Y ] = projectCadastre( q.lon, q.lat ), p = along( X, Y );
		if ( ! p || p.s < 1 || p.s > sTower - 1 ) continue;
		if ( isStatue && p.d < 14 ) statues.push( { s: p.s, o: p.o, name: t.name } );
		else if ( isLamp && Math.abs( p.o ) < 8 ) lamps.push( [ + p.s.toFixed( 1 ), Math.sign( p.o ) ] );
		else if ( isGuard && p.d < 30 ) guards.push( [ + p.s.toFixed( 1 ), + p.o.toFixed( 1 ) ] );
		else if ( isCross && p.d < 8 ) cross = [ + p.s.toFixed( 1 ), Math.sign( p.o ) ];

	}

	// Piers: the pairs of statues across the bridge from each other.
	const piers = [];
	for ( const q of [ ...statues ].sort( ( a, b ) => a.s - b.s ) ) {

		if ( STATUES[ q.name ]?.[ 0 ] === 'bruncvik' ) continue;
		const last = piers[ piers.length - 1 ];
		if ( last && q.s - last.s1 < 8 ) {

			last.s1 = q.s;
			last.sum += q.s;
			last.k ++;

		} else piers.push( { s0: q.s, s1: q.s, sum: q.s, k: 1 } );

	}

	const pierS = piers.map( p => + ( p.sum / p.k ).toFixed( 1 ) );
	const snap = s => pierS.reduce( ( a, b ) => Math.abs( b - s ) < Math.abs( a - s ) ? b : a, pierS[ 0 ] );
	const statueList = statues.map( q => {

		const [ kind, attr ] = STATUES[ q.name ] || [ 'single' ];
		return kind === 'bruncvik' ? { s: + q.s.toFixed( 1 ), side: Math.sign( q.o ), kind, name: q.name } : { s: snap( q.s ), side: Math.sign( q.o ), kind, attr, name: q.name };

	} ).sort( ( a, b ) => a.s - b.s || a.side - b.side );
	const unknown = statues.filter( q => ! STATUES[ q.name ] ).map( q => q.name );
	if ( unknown.length ) console.warn( `places: Karlův most statues without a kind: ${unknown.join( ', ' )}` );

	const half = 4.875, rail = 0.45, walk = half - rail;
	// The arches on Kampa with rooms built into them (RÚIAN houses under the deck, left out of the houses).
	const filled = [];
	for ( const b of buildings ) {

		if ( ! b.underKarluv ) continue;
		const ss = b.poly.outer.map( ( [ X, Y ] ) => along( X, Y ).s );
		filled.push( [ + Math.min( ...ss ).toFixed( 1 ), + Math.max( ...ss ).toFixed( 1 ) ] );

	}

	const K = { pts, step: 2, half, rail, piers: pierS, low, statues: statueList, lamps: lamps.sort( ( a, b ) => a[ 0 ] - b[ 0 ] ), guards, cross, towers, filled, sTower: + sTower.toFixed( 1 ), sTowerEnd: + sTowerEnd.toFixed( 1 ), passage: 2.6 };

	// Walking: the deck 10 m at a time. Over Kampa and the river a zone holds only for the walker up on the deck
	// (`over`: the ground below), so people on Kampa walk under the arches. Through the Old Town tower only the
	// passage, under its vault.
	const segs = [];
	for ( let i = 0; i + 1 < n; i += 5 ) {

		const j = Math.min( n - 1, i + 5 ), [ ax, az, ya ] = pts[ i ], [ bx, bz, yb ] = pts[ j ];
		const len = Math.hypot( bx - ax, bz - az ), lx = ( bx - ax ) / len, lz = ( bz - az ) / len;
		const sA = i * 2, sB = j * 2;
		const inTower = sB > sTower && sA < sTowerEnd;
		const under = Math.min( ...low.slice( i, j + 1 ) );
		const extra = { y0: ya, y1: yb, along: [ lx, lz ] };
		if ( under < Math.min( ya, yb ) - 4 ) extra.over = + under.toFixed( 2 );
		if ( inTower ) {

			// The open deck up to the tower's face, then the passage.
			const a = Math.max( 0, ( sTower - sA ) / ( sB - sA ) );
			if ( a > 0.05 ) {

				const mx = ax + ( bx - ax ) * a / 2, mz = az + ( bz - az ) * a / 2;
				zone( mx, mz, [ lz, - lx ], walk, len * a / 2 + 0.05, { y0: ya, y1: + ( ya + ( yb - ya ) * a ).toFixed( 2 ), along: [ lx, lz ] } );

			}

			const mx = ax + ( bx - ax ) * ( 1 + a ) / 2, mz = az + ( bz - az ) * ( 1 + a ) / 2;
			zone( mx, mz, [ lz, - lx ], K.passage - 0.25, len * ( 1 - a ) / 2 + 0.05, { y0: + ( ya + ( yb - ya ) * a ).toFixed( 2 ), y1: yb, along: [ lx, lz ], ceil: + ( Math.max( ya, yb ) + 6.5 ).toFixed( 2 ) } );

		} else if ( sA >= sTowerEnd ) zone( ( ax + bx ) / 2, ( az + bz ) / 2, [ lz, - lx ], K.passage + 0.6, len / 2 + 0.05, extra ); // out of the passage onto the square
		else zone( ( ax + bx ) / 2, ( az + bz ) / 2, [ lz, - lx ], walk, len / 2 + 0.05, extra );
		segs.push( { A: S( ax, az ), B: S( bx, bz ), w: half * 2, kind: 'karluv', ya, yb } );

	}

	// The parapets are walk barriers for the walker up on the deck (anyone lower passes: Kampa under the arches), up to
	// the tower; the piers on land stop the walker below.
	const frameAt = i => {

		const [ x, z ] = pts[ i ], j = Math.min( n - 1, i + 1 ), k = Math.max( 0, i - 1 );
		const l = Math.hypot( pts[ j ][ 0 ] - pts[ k ][ 0 ], pts[ j ][ 1 ] - pts[ k ][ 1 ] ), ux = ( pts[ j ][ 0 ] - pts[ k ][ 0 ] ) / l, uz = ( pts[ j ][ 1 ] - pts[ k ][ 1 ] ) / l;
		return { x, z, ux, uz, at: o => [ x - uz * o, z + ux * o ] };

	};
	const iStop = Math.floor( sTower / 2 );
	for ( const sgn of [ - 1, 1 ] ) for ( let i = 1; i <= iStop; i ++ ) {

		const a = frameAt( i - 1 ).at( sgn * ( walk + 0.05 ) ), b = frameAt( i ).at( sgn * ( walk + 0.05 ) );
		places.barriers.push( [ + a[ 0 ].toFixed( 2 ), + a[ 1 ].toFixed( 2 ), + b[ 0 ].toFixed( 2 ), + b[ 1 ].toFixed( 2 ), + ( Math.min( pts[ i - 1 ][ 2 ], pts[ i ][ 2 ] ) - 1.2 ).toFixed( 2 ) ] );

	}

	// The statues' pedestals stand on the walkway along the parapets.
	for ( const q of statueList ) {

		if ( q.kind === 'bruncvik' ) continue;
		const i = Math.round( q.s / 2 ), F = frameAt( i ), y = pts[ i ][ 2 ] - 1.2;
		const c = ( u, o ) => [ F.x + F.ux * u - F.uz * o, F.z + F.uz * u + F.ux * o ];
		const o0 = q.side * walk, o1 = q.side * ( half - 1.65 );
		const ring = [ c( - 1.1, o0 ), c( - 1.1, o1 ), c( 1.1, o1 ), c( 1.1, o0 ) ];
		for ( let k = 0; k < 3; k ++ ) places.barriers.push( [ ...ring[ k ].map( v => + v.toFixed( 2 ) ), ...ring[ k + 1 ].map( v => + v.toFixed( 2 ) ), + y.toFixed( 2 ) ] );

	}

	for ( const s of pierS ) {

		const i = Math.round( s / 2 );
		if ( low[ i ] <= waterY + 0.3 ) continue;
		const F = frameAt( i ), y = pts[ i ][ 2 ];
		const c = ( u, o ) => [ F.x + F.ux * u - F.uz * o, F.z + F.uz * u + F.ux * o ];
		const ring = [ c( - 4.3, - half - 3 ), c( 4.3, - half - 3 ), c( 4.3, half + 5 ), c( - 4.3, half + 5 ) ];
		for ( let k = 0; k < 4; k ++ ) {

			const a = ring[ k ], b = ring[ ( k + 1 ) % 4 ];
			places.barriers.push( [ + a[ 0 ].toFixed( 2 ), + a[ 1 ].toFixed( 2 ), + b[ 0 ].toFixed( 2 ), + b[ 1 ].toFixed( 2 ), 999, + ( y - 2 ).toFixed( 2 ) ] );

		}

	}

	// The gate between the Lesser Town towers: its two walls across the street, each with its arch (walk barriers
	// either side of the arch).
	const gate = towers.find( t => t.kind === 'gate' );
	if ( gate ) {

		const g = gateFrame( gate.ring );
		Object.assign( gate, g );
		for ( const sgn of [ - 1, 1 ] ) {

			const u = sgn * ( g.hu - 0.9 );
			for ( const [ v0, v1 ] of [ [ - g.hv, - 2.5 ], [ 2.5, g.hv ] ] ) {

				const a = [ g.x + g.ux * u - g.uz * v0, g.z + g.uz * u + g.ux * v0 ], b = [ g.x + g.ux * u - g.uz * v1, g.z + g.uz * u + g.ux * v1 ];
				places.barriers.push( [ + a[ 0 ].toFixed( 2 ), + a[ 1 ].toFixed( 2 ), + b[ 0 ].toFixed( 2 ), + b[ 1 ].toFixed( 2 ), - 99 ] );

			}

		}

	}

	console.log( `places: Karlův most ${( n - 1 ) * 2} m, deck ${Math.min( ...ys ).toFixed( 2 )}…${Math.max( ...ys ).toFixed( 2 )} m, ${pierS.length} piers, ${statueList.length} statues, ${lamps.length} lamps, ${guards.length} ice-guards, towers ${towers.map( t => t.kind ).join( ', ' )}` );

	// Whether a S-JTSK point lies within `pad` metres of the deck's edges (along its length, short of the tower).
	const onDeck = ( X, Y, pad = 0 ) => {

		const p = along( X, Y );
		return p && p.s > 0.5 && p.s < sTower && Math.abs( p.o ) < half + pad;

	};

	return { K, segs, onDeck, along, sTower };

}

// The gate's frame from its outline: the street runs along u (through the arches), v across between the towers.
function gateFrame( ring ) {

	let best = null;
	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ], [ bx, bz ] = ring[ ( i + 1 ) % ring.length ], l = Math.hypot( bx - ax, bz - az );
		if ( l < 1 ) continue;
		const ux = ( bx - ax ) / l, uz = ( bz - az ) / l;
		const us = ring.map( ( [ x, z ] ) => x * ux + z * uz ), vs = ring.map( ( [ x, z ] ) => - x * uz + z * ux );
		const area = ( Math.max( ...us ) - Math.min( ...us ) ) * ( Math.max( ...vs ) - Math.min( ...vs ) );
		if ( ! best || area < best.area ) best = { area, ux, uz, u0: Math.min( ...us ), u1: Math.max( ...us ), v0: Math.min( ...vs ), v1: Math.max( ...vs ) };

	}

	let { ux, uz, u0, u1, v0, v1 } = best;
	// u along the street: the longer side runs between the towers, so the street crosses the shorter one.
	if ( u1 - u0 > v1 - v0 ) {

		[ ux, uz ] = [ - uz, ux ];
		[ u0, u1, v0, v1 ] = [ v0, v1, - u1, - u0 ];

	}

	const cu = ( u0 + u1 ) / 2, cv = ( v0 + v1 ) / 2;
	return { x: + ( cu * ux - cv * uz ).toFixed( 2 ), z: + ( cu * uz + cv * ux ).toFixed( 2 ), ux: + ux.toFixed( 4 ), uz: + uz.toFixed( 4 ), hu: + ( ( u1 - u0 ) / 2 ).toFixed( 2 ), hv: + ( ( v1 - v0 ) / 2 ).toFixed( 2 ) };

}

// Whether a building outline (S-JTSK) lies under Karlův most's deck: RÚIAN has the rooms built into the arches on
// Kampa as houses, whose flat roofs (at the deck's height in the surface model) came through the deck. They are left
// to src/karluv.js, which walls up those arches.
export function underKarluv( zabagedBridges ) {

	const feats = zabagedBridges?.features || zabagedBridges || [];
	const f = feats.find( q => ( q.attributes || q.properties )?.jmeno === 'Karlův most' );
	const path = f && ( f.geometry.paths || f.geometry.rings || [] )[ 0 ];
	if ( ! path ) return () => false;
	const off = ( X, Y ) => {

		let best = Infinity;
		for ( let i = 0; i + 1 < path.length; i ++ ) {

			const [ ax, ay ] = path[ i ], [ bx, by ] = path[ i + 1 ], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
			const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / l2 ) );
			best = Math.min( best, Math.hypot( X - ax - t * dx, Y - ay - t * dy ) );

		}

		return best;

	};
	return ring => {

		const inside = ring.filter( ( [ X, Y ] ) => off( X, Y ) < 6.5 ).length;
		return inside >= ring.length * 0.6;

	};

}
