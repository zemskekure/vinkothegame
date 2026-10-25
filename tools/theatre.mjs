// The National Theatre node, walkable at both levels (levels and outlines from tools/terraces.mjs; drawn by
// src/theatre.js):
//
//   - the road tunnel under Národní and the covered pavement under the piazzetta's cantilever are "under-deck"
//     zones: they hold only while the walker is down at street level, so Národní and the square above stay walkable;
//   - the 40-step flight from Národní down to Divadelní north, against the Academy of Sciences;
//   - Nová scéna's open undercroft, a step up from Národní's pavement to the square's level, between its two
//     stone-clad blocks;
//   - walk barriers: the walls of the tunnel and the covered pavement stop the walker below, the balustrades and the
//     parapet stop the walker above.
//
// Everything returned is in the scene frame (x east, y up, z south).

export function collectTheatre( ctx, { places, zone } ) {

	const t = ctx.terraces;
	if ( ! t?.tunnel ) return;
	const { ORIGIN } = ctx;
	const L = ( X, Y ) => [ + ( X - ORIGIN.x ).toFixed( 2 ), + ( - ( Y - ORIGIN.y ) ).toFixed( 2 ) ];
	const r2 = v => + v.toFixed( 2 );
	const bar = ( x0, z0, x1, z1, above, below ) => places.barriers.push( below === undefined ? [ r2( x0 ), r2( z0 ), r2( x1 ), r2( z1 ), above ] : [ r2( x0 ), r2( z0 ), r2( x1 ), r2( z1 ), above, r2( below ) ] );
	const NEVER = 999;

	const T = t.tunnel, rows = t.trench.rows;
	const theatre = places.theatre = { tunnel: { ...T }, rows, coverEnd: t.trench.coverEnd, balustrades: [], decks: t.decks };

	// --- Národní over the tunnel: its deck for a walker up there (and for trams and people), the road below
	const D = t.decks.tunnel;
	zone( ( D.x0 + D.x1 ) / 2, ( D.z0 + D.z1 ) / 2, [ 1, 0 ], ( D.x1 - D.x0 ) / 2, ( D.z1 - D.z0 ) / 2, { y: r2( D.y ), over: r2( T.ya ) } );
	zone( ( T.xW + T.xE ) / 2, ( T.zN + T.zS ) / 2, [ 1, 0 ], ( T.xE - T.xW ) / 2 - 0.25, ( T.zS - T.zN ) / 2 + 0.3, { y0: r2( T.ya ), y1: r2( T.yb ), along: [ 0, 1 ], ceil: r2( T.ceil - 0.1 ), deck: r2( T.deck ) } );
	bar( T.xW + 0.15, T.zN, T.xW + 0.15, T.zS, NEVER, T.deck - 1.5 );
	bar( T.xE - 0.15, T.zN, T.xE - 0.15, T.zS + 0.2, NEVER, T.deck - 1.5 );

	// --- the covered pavement under the square's edge, in short pieces (the edge bends a little)
	const cover = rows.filter( r => r.z <= t.trench.coverEnd );
	for ( let i = 0; i + 1 < cover.length; i += 4 ) {

		const a = cover[ i ], b = cover[ Math.min( i + 4, cover.length - 1 ) ];
		const x0 = Math.max( a.edge, b.edge ) - 0.3, x1 = Math.min( a.back, b.back ) - 0.3;
		const zc = ( a.z + b.z ) / 2, hn = ( b.z - a.z ) / 2 + 0.05;
		// The square over it, out to the parapet (the parapet's barrier keeps the walker on it).
		const u0 = Math.min( a.edge, b.edge ), u1 = Math.max( a.back, b.back ) + 1;
		zone( ( u0 + u1 ) / 2, zc, [ 1, 0 ], ( u1 - u0 ) / 2, hn, { y0: r2( a.deck ), y1: r2( b.deck ), along: [ 0, 1 ], over: r2( Math.min( a.floor, b.floor ) ) } );
		zone( ( x0 + x1 ) / 2, zc, [ 1, 0 ], ( x1 - x0 ) / 2, hn, { y0: r2( a.floor + 0.12 ), y1: r2( b.floor + 0.12 ), along: [ 0, 1 ], ceil: r2( Math.min( a.soffit, b.soffit ) - 0.1 ), deck: r2( Math.min( a.deck, b.deck ) ) } );

	}

	// --- the railing lines' barriers (tools/terraces.mjs): a bare back wall stops the walker below only, the deck's
	// faces over the openings stop the walker above only.
	for ( const line of t.rails ) for ( let i = 1; i < line.length; i ++ ) {

		const a = line[ i - 1 ], b = line[ i ];
		if ( a.noBarrier ) continue;
		const [ x0, z0 ] = L( a.X, a.Y ), [ x1, z1 ] = L( b.X, b.Y );
		if ( a.below !== undefined ) bar( x0, z0, x1, z1, NEVER, Math.min( a.below, b.below ) );
		else bar( x0, z0, x1, z1, a.portal && b.portal ? r2( Math.min( a.quay, b.quay ) + 2.0 ) : - 99 );

	}

	// --- the stairs from Národní's north pavement down to Divadelní
	const st = t.stairs;
	if ( st ) {

		const [ tx, ty, tz ] = st.top, [ bx, by, bz ] = st.bottom;
		const len = Math.hypot( tx - bx, tz - bz ), along = [ ( tx - bx ) / len, ( tz - bz ) / len ];
		const across = [ along[ 1 ], - along[ 0 ] ]; // points west (towards the street)
		theatre.stairs = { top: [ r2( tx ), r2( ty ), r2( tz ) ], bottom: [ r2( bx ), r2( by ), r2( bz ) ], steps: st.steps, w: st.w };
		zone( ( tx + bx ) / 2, ( tz + bz ) / 2, across, st.w / 2 - 0.15, len / 2 + 0.15, { y0: r2( by ), y1: r2( ty ), along, steps: st.steps } );
		// The balustrade on the street side, from a newel at the foot to the bridge's balustrade at the top.
		const side = st.w / 2 + 0.2;
		const sx = across[ 0 ] * side, sz = across[ 1 ] * side;
		theatre.balustrades.push( { a: [ r2( bx + sx ), r2( by ), r2( bz + sz ) ], b: [ r2( tx + sx ), r2( ty ), r2( tz + sz ) ], stair: true } );
		bar( bx + sx, bz + sz, tx + sx, tz + sz, - 99 );
		// The flight is solid down to the street at its top: no walking into it from the tunnel below.
		bar( tx + sx, T.zN - 0.1, tx - sx + 0.6, T.zN - 0.1, NEVER, T.deck - 1.5 );
		console.log( `places: Národní → Divadelní stairs ${st.steps} × ${( ( ty - by ) / st.steps ).toFixed( 3 )} m over ${len.toFixed( 1 )} m` );

	}

	// The bridge's balustrades over the tunnel mouths (owner's photo 2022, Street View 2025).
	const north = t.rails[ 0 ], south = t.rails[ 1 ];
	for ( const [ line, inward ] of [ [ north, 0.25 ], [ south, - 0.25 ] ] ) {

		const [ ax, az ] = L( line[ 0 ].X, line[ 0 ].Y ), [ bx, bz ] = L( line[ line.length - 1 ].X, line[ line.length - 1 ].Y );
		theatre.balustrades.push( { a: [ ax, r2( T.deck ), r2( az + inward ) ], b: [ bx, r2( T.deck ), r2( bz + inward ) ] } );

	}

	// --- Nová scéna's undercroft
	const u = t.undercroft;
	if ( u ) {

		const [ [ fx0, fz0 ], [ fx1, fz1 ] ] = u.front;
		const fl = Math.hypot( fx1 - fx0, fz1 - fz0 ), fu = [ ( fx1 - fx0 ) / fl, ( fz1 - fz0 ) / fl ], fn = [ - fu[ 1 ], fu[ 0 ] ]; // fn: into the building (south)
		const STRIP = 1.2, OUT = 1.5, steps = Math.max( 2, Math.round( ( u.level - u.foot ) / 0.16 ) );
		// From the pavement in front up to the square's level just inside the street face.
		const cx = ( fx0 + fx1 ) / 2 + fn[ 0 ] * ( STRIP - OUT ) / 2, cz = ( fz0 + fz1 ) / 2 + fn[ 1 ] * ( STRIP - OUT ) / 2;
		zone( cx, cz, fu, fl / 2 + 2, ( STRIP + OUT ) / 2, { y0: r2( u.foot ), y1: r2( u.level ), along: fn, steps } );
		const xs = u.ring.map( p => p[ 0 ] ), zs = u.ring.map( p => p[ 1 ] );
		const x0 = Math.min( ...xs ) - 0.3, x1 = u.lobby - 0.3, z0 = Math.max( fz0, fz1 ) + STRIP, z1 = Math.max( ...zs ) + 0.4;
		zone( ( x0 + x1 ) / 2, ( z0 + z1 ) / 2, [ 1, 0 ], ( x1 - x0 ) / 2, ( z1 - z0 ) / 2, { y: r2( u.level ), ceil: r2( u.soffit - 0.15 ) } );
		for ( const [ a0, b0, a1, b1 ] of u.blocks ) {

			bar( a0, b0, a1, b0, - 99 ); bar( a1, b0, a1, b1, - 99 ); bar( a1, b1, a0, b1, - 99 ); bar( a0, b1, a0, b0, - 99 );

		}

		bar( u.lobby, Math.min( fz0, fz1 ) - 0.2, u.lobby, Math.max( ...zs ) + 0.5, - 99 );
		theatre.undercroft = { ring: u.ring.map( ( [ x, z ] ) => [ r2( x ), r2( z ) ] ), level: r2( u.level ), foot: r2( u.foot ), soffit: r2( u.soffit ), lobby: u.lobby, front: u.front.map( ( [ x, z ] ) => [ r2( x ), r2( z ) ] ), steps, strip: STRIP, out: OUT, blocks: u.blocks };
		console.log( `places: Nová scéna undercroft, ${steps} steps up from Národní, ${u.blocks.length} blocks` );

	}

}
