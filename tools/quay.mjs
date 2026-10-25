// Smetanovo nábřeží's river edge and Čapadlo, measured on the ČÚZK terrain model (DMR 5G) rather than OSM, which
// is several metres off here (its Čapadlo lies inside the faculty's footprint):
//
// - The riverside pavement ends in a straight stone curb with the cast-iron railing on it, from Karlovy lázně to
//   Most Legií (Street View 2018, 2025). Its line: each OSM segment of the riverside pavement, moved out to the
//   measured street edge (the top of the drop to the water or to the quay) by a straight fit, so the railing runs
//   in long straight lines with corners only where the street turns.
// - Between z ≈ 112 and 240 the náplavka ("poloostrov Hollar") lies below: a flat quay about 1.8 m over the water
//   and 5 m under the street, under big trees, with no railing at the water's edge. A retaining wall drops from
//   the railing to the quay; the quay's level is the terrain model's, evened along the quay.
// - Elsewhere the river wall drops straight to the water under the railing; the river embankment (build-scene.mjs)
//   then draws only the wall, not its own parapet (edge() tells it which).
// - Čapadlo: the only way down to the náplavka. A sunken lane runs along the north wall of the Faculty of Social
//   Sciences (Hollar) from Divadelní to under the street, 3.5 m below the street and the garden north of it; 25 steps
//   go down into it from the street's east pavement along the faculty's wall (one handrail, open to the lane), and
//   at its west end an arch (glazed front with the name, owner's photo 2023) leads under the carriageway to the quay.
//   The gated "Prague Boats" stair from the railing down to the moorings is not a way down (Street View 2018).
//
// All in S-JTSK metres; heights relative to BASE_HEIGHT like the terrain grid. Rail points ({ X, Y, nx, ny } with n
// towards the low side, top, quay = low side's level, wall, portal) are drawn by drawRail() in build-scene.mjs and
// become walk barriers in places.mjs.

import { readFile } from 'node:fs/promises';
import { lonLatToSJTSK } from './geo.mjs';
import { ORIGIN } from './area.mjs';

// The riverside pavement of Smetanovo nábřeží, north to south (OSM ways).
const RIVERSIDE_WAYS = [ 963908577, 74171496, 137806764 ];
// OSM as projected by tools/geo.mjs sits (−6.18, +7.68) m off RÚIAN and the aerial photo in the scene frame (measured
// on 174 RÚIAN-imported outlines): the pavement's line is moved back by that much (S-JTSK: X + 6.18, Y + 7.68).
// Remove this once geo.mjs itself is corrected.
const OSM_SHIFT = [ 6.18, 7.68 ];

// Čapadlo, in the scene frame (x east, z south), measured on the terrain model (DMR 5G, absolute heights) and the
// RÚIAN footprint of the faculty (no. 995, kod 21649553), whose north wall runs (−362.9, 203.4) → (−326.3, 212.3).
const LANE = {
	// The lane's north edge (the garden's retaining wall), west to east, and its floor at both ends.
	north: [ [ - 362.6, 195.6 ], [ - 356, 195.4 ], [ - 350, 196.8 ], [ - 344, 197.6 ], [ - 338, 198.4 ], [ - 334, 199.6 ], [ - 330, 201.5 ], [ - 327, 203.5 ] ],
	wall: [ [ - 362.9, 203.4 ], [ - 327, 212.1 ] ],
	floor: [ 188.5, 189.4 ],
	west: - 362.6,
	// The steps: along the faculty's wall from the lane (foot, east) straight up to the street's east pavement (top,
	// west, at the faculty's corner), beside the underpass's arch; 25 steps (OSM) over the 3.4 m drop.
	steps: { top: [ - 362.9, 202.2 ], foot: [ - 354.75, 204.2 ], w: 2.2, n: 25 },
	// The underpass: from the lane's west end under the street to the quay (the direction of OSM's tunnel way).
	tunnel: { a: [ - 362.6, 198.3 ], dir: [ - 0.975, - 0.224 ], w: 3.0, h: 2.8 }
};
const BASE = 184;

export async function buildQuay( { terrain, tw, th, cell, AREA, riverAt, dtmAt } ) {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	const ways = RIVERSIDE_WAYS.map( id => osm.find( e => e.type === 'way' && e.id === id ) ).filter( Boolean )
		.map( w => w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) ).map( ( [ X, Y ] ) => [ X + OSM_SHIFT[ 0 ], Y + OSM_SHIFT[ 1 ] ] ) );
	const S = ( x, z ) => [ x + ORIGIN.x, - z + ORIGIN.y ];

	// Join into one line (each way flipped as needed to continue the previous one), dropping doubled nodes.
	let line = [];
	for ( const w of ways ) {

		if ( ! line.length ) {

			line = [ ...w ];
			continue;

		}

		const end = line[ line.length - 1 ];
		const d0 = Math.hypot( w[ 0 ][ 0 ] - end[ 0 ], w[ 0 ][ 1 ] - end[ 1 ] ), d1 = Math.hypot( w[ w.length - 1 ][ 0 ] - end[ 0 ], w[ w.length - 1 ][ 1 ] - end[ 1 ] );
		if ( Math.min( d0, d1 ) > 5 && Math.hypot( w[ 0 ][ 0 ] - line[ 0 ][ 0 ], w[ 0 ][ 1 ] - line[ 0 ][ 1 ] ) < 5 ) line.reverse();
		const e2 = line[ line.length - 1 ];
		const flip = Math.hypot( w[ w.length - 1 ][ 0 ] - e2[ 0 ], w[ w.length - 1 ][ 1 ] - e2[ 1 ] ) < Math.hypot( w[ 0 ][ 0 ] - e2[ 0 ], w[ 0 ][ 1 ] - e2[ 1 ] );
		line.push( ...( flip ? [ ...w ].reverse() : w ).slice( 1 ) );

	}

	line = line.filter( ( p, i ) => ! i || Math.hypot( p[ 0 ] - line[ i - 1 ][ 0 ], p[ 1 ] - line[ i - 1 ][ 1 ] ) > 0.5 );
	if ( line.length < 2 ) return null;

	const median = a => {

		const s = a.filter( Number.isFinite ).sort( ( p, q ) => p - q );
		return s.length ? s[ s.length >> 1 ] : NaN;

	};
	const riverAlong = ( X, Y, nx, ny, from, to ) => {

		for ( let d = from; d <= to; d += 0.25 ) if ( riverAt( X + nx * d, Y + ny * d ) ) return d;
		return Infinity;

	};

	// Each OSM segment: its riverward normal, and the street edge measured every metre along it (the first point
	// riverward where the ground falls 1.5 m under the street, or the river).
	const segs = [];
	for ( let i = 1; i < line.length; i ++ ) {

		const [ ax, ay ] = line[ i - 1 ], [ bx, by ] = line[ i ];
		const len = Math.hypot( bx - ax, by - ay ), ux = ( bx - ax ) / len, uy = ( by - ay ) / len;
		let nx = uy, ny = - ux;
		const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
		if ( riverAlong( mx, my, - nx, - ny, 0, 30 ) < riverAlong( mx, my, nx, ny, 0, 30 ) ) {

			nx = - nx; ny = - ny;

		}

		const st = [];
		for ( let t = 0.5; t < len; t += 1 ) {

			const X = ax + ux * t, Y = ay + uy * t;
			const top = median( [ - 5, - 4, - 3, - 2, - 1.5 ].map( d => dtmAt( X + nx * d, Y + ny * d ) ) );
			const river = riverAlong( X, Y, nx, ny, - 3, 25 );
			let e = river - 0.4, kind = 'river';
			for ( let d = - 3; d < river; d += 0.25 ) if ( dtmAt( X + nx * d, Y + ny * d ) < top - 1.5 ) {

				e = d - 0.5;
				kind = 'drop';
				break;

			}

			if ( Number.isFinite( e ) ) st.push( { t, e, kind, river } );

		}

		segs.push( { ax, ay, ux, uy, nx, ny, len, st } );

	}

	// A straight railing line per segment: e( t ) = a + b·t fitted (twice, the second time without outliers);
	// short segments keep a constant offset. Never riverward of the river's outline.
	for ( const s of segs ) {

		let a = median( s.st.map( p => p.e ) ), b = 0;
		if ( ! Number.isFinite( a ) ) a = 1.4;
		if ( s.len >= 12 && s.st.length >= 8 ) for ( let pass = 0; pass < 2; pass ++ ) {

			const use = s.st.filter( p => ! pass || Math.abs( p.e - a - b * p.t ) < 1.0 );
			if ( use.length < 6 ) break;
			const mt = use.reduce( ( q, p ) => q + p.t, 0 ) / use.length, me = use.reduce( ( q, p ) => q + p.e, 0 ) / use.length;
			const stt = use.reduce( ( q, p ) => q + ( p.t - mt ) ** 2, 0 );
			b = stt > 1e-6 ? use.reduce( ( q, p ) => q + ( p.t - mt ) * ( p.e - me ), 0 ) / stt : 0;
			b = Math.max( - 0.08, Math.min( 0.08, b ) );
			a = me - b * mt;

		}

		let shift = 0;
		for ( const p of s.st ) if ( Number.isFinite( p.river ) ) shift = Math.min( shift, p.river - 0.4 - ( a + b * p.t ) );
		s.a = a + shift;
		s.b = b;

	}

	// The railing's corners: where consecutive lines meet (or half way between their ends where they don't).
	const lineEnd = ( s, t ) => [ s.ax + s.ux * t + s.nx * ( s.a + s.b * t ), s.ay + s.uy * t + s.ny * ( s.a + s.b * t ) ];
	const corners = [ lineEnd( segs[ 0 ], 0 ) ];
	for ( let i = 1; i < segs.length; i ++ ) {

		const p = lineEnd( segs[ i - 1 ], segs[ i - 1 ].len ), q = lineEnd( segs[ i ], 0 );
		const p0 = lineEnd( segs[ i - 1 ], 0 ), q1 = lineEnd( segs[ i ], segs[ i ].len );
		const d1 = [ p[ 0 ] - p0[ 0 ], p[ 1 ] - p0[ 1 ] ], d2 = [ q1[ 0 ] - q[ 0 ], q1[ 1 ] - q[ 1 ] ];
		const den = d1[ 0 ] * d2[ 1 ] - d1[ 1 ] * d2[ 0 ];
		let c = [ ( p[ 0 ] + q[ 0 ] ) / 2, ( p[ 1 ] + q[ 1 ] ) / 2 ];
		if ( Math.abs( den ) > 1e-6 ) {

			const k = ( ( q[ 0 ] - p0[ 0 ] ) * d2[ 1 ] - ( q[ 1 ] - p0[ 1 ] ) * d2[ 0 ] ) / den;
			const X = [ p0[ 0 ] + d1[ 0 ] * k, p0[ 1 ] + d1[ 1 ] * k ];
			if ( Math.hypot( X[ 0 ] - c[ 0 ], X[ 1 ] - c[ 1 ] ) < 4 ) c = X;

		}

		corners.push( c );

	}

	corners.push( lineEnd( segs[ segs.length - 1 ], segs[ segs.length - 1 ].len ) );

	// Railing points every metre along the corners' polyline, each with the riverward normal of its stretch.
	const rail = [];
	for ( let i = 1; i < corners.length; i ++ ) {

		const [ ax, ay ] = corners[ i - 1 ], [ bx, by ] = corners[ i ];
		const len = Math.hypot( bx - ax, by - ay );
		if ( len < 0.05 ) continue;
		const n = Math.max( 1, Math.round( len ) ), s = segs[ i - 1 ];
		let nx = ( by - ay ) / len, ny = - ( bx - ax ) / len;
		if ( nx * s.nx + ny * s.ny < 0 ) {

			nx = - nx; ny = - ny;

		}

		for ( let k = rail.length ? 1 : 0; k <= n; k ++ ) {

			const X = ax + ( bx - ax ) * k / n, Y = ay + ( by - ay ) * k / n;
			if ( X < AREA.xmin + 2 || X > AREA.xmax - 2 || Y < AREA.ymin + 2 || Y > AREA.ymax - 2 ) continue;
			rail.push( { X, Y, nx, ny } );

		}

	}

	// What lies below each point: the street's level just inland, the distance to the river, and a quay where there
	// is more than 3.5 m of lower ground before the water.
	for ( const p of rail ) {

		p.top = median( [ - 3, - 2.5, - 2, - 1.5, - 1 ].map( d => dtmAt( p.X + p.nx * d, p.Y + p.ny * d ) ) );
		p.w = riverAlong( p.X, p.Y, p.nx, p.ny, 0, 30 );
		const low = [];
		for ( let d = 2; d < p.w - 1; d += 0.5 ) low.push( dtmAt( p.X + p.nx * d, p.Y + p.ny * d ) );
		p.low = median( low );
		p.isQuay = p.w > 3.5 && Number.isFinite( p.w ) && p.low < p.top - 2;

	}

	// Even out along the line: the street level (running mean), the quay (contiguous runs of at least 10 m, a level
	// from a running median then a running mean).
	const runMean = ( vals, r ) => vals.map( ( _, i ) => {

		const w = vals.slice( Math.max( 0, i - r ), i + r + 1 ).filter( Number.isFinite );
		return w.length ? w.reduce( ( a, v ) => a + v, 0 ) / w.length : vals[ i ];

	} );
	const tops = runMean( rail.map( p => p.top ), 4 );
	rail.forEach( ( p, i ) => p.top = tops[ i ] );
	for ( let i = 0; i < rail.length; ) {

		let j = i;
		while ( j < rail.length && rail[ j ].isQuay === rail[ i ].isQuay ) j ++;
		if ( rail[ i ].isQuay && j - i < 10 ) for ( let k = i; k < j; k ++ ) rail[ k ].isQuay = false;
		i = j;

	}

	const quayIdx = rail.map( ( p, i ) => p.isQuay ? i : - 1 ).filter( i => i >= 0 );
	const med = quayIdx.map( ( i, k ) => median( quayIdx.slice( Math.max( 0, k - 7 ), k + 8 ).map( j => rail[ j ].low ) ) );
	const lev = runMean( med, 10 );
	quayIdx.forEach( ( i, k ) => rail[ i ].quayLevel = lev[ k ] );
	for ( const p of rail ) {

		p.river = false;
		p.wall = p.isQuay;
		p.quay = p.isQuay ? p.quayLevel : p.top;

	}

	// Terrain: the street held at its level up to the railing, the quay levelled from the wall to the water, the
	// narrow ledge beyond the railing on the direct stretches at street level. Masks for edge() and beyond().
	const G = 0.5, gw = Math.ceil( ( AREA.xmax - AREA.xmin ) / G ), gh = Math.ceil( ( AREA.ymax - AREA.ymin ) / G );
	const quayMask = new Float32Array( gw * gh ).fill( NaN ), streetMask = new Uint8Array( gw * gh ), beyondMask = new Uint8Array( gw * gh );
	const gi = ( X, Y ) => {

		const c = Math.floor( ( X - AREA.xmin ) / G ), r = Math.floor( ( AREA.ymax - Y ) / G );
		return c >= 0 && r >= 0 && c < gw && r < gh ? r * gw + c : - 1;

	};
	const setCell = ( X, Y, fn ) => {

		const c = Math.round( ( X - AREA.xmin ) / cell ), r = Math.round( ( AREA.ymax - Y ) / cell );
		if ( c < 0 || r < 0 || c >= tw || r >= th ) return;
		terrain[ r * tw + c ] = fn( terrain[ r * tw + c ] );

	};

	// Each grid cell near the line by its own centre: landward of the railing at the street's level, riverward on the
	// quay at the quay's (src/main.js then moves the grid points onto the wall line).
	const cellSet = ( p, X, Y, quay ) => {

		const c = Math.round( ( X - AREA.xmin ) / cell ), r = Math.round( ( AREA.ymax - Y ) / cell );
		if ( c < 0 || r < 0 || c >= tw || r >= th ) return;
		const cx = AREA.xmin + c * cell, cy = AREA.ymax - r * cell, d = ( cx - p.X ) * p.nx + ( cy - p.Y ) * p.ny;
		if ( riverAt( cx, cy ) ) return;
		if ( d < 0 ) terrain[ r * tw + c ] = Math.max( terrain[ r * tw + c ], p.top );
		else terrain[ r * tw + c ] = quay ? p.quay : Math.max( terrain[ r * tw + c ], p.top );

	};

	for ( const p of rail ) {

		const far = Number.isFinite( p.w ) ? p.w + 0.6 : 3;
		for ( let d = - 1.6; d <= Math.max( far, 14 ); d += 0.25 ) for ( let o = - 0.75; o <= 0.75; o += 0.25 ) {

			const X = p.X + p.nx * d - p.ny * o, Y = p.Y + p.ny * d + p.nx * o;
			const k = gi( X, Y );
			if ( d > 0 && k >= 0 ) beyondMask[ k ] = 1;
			if ( d > far || riverAt( X, Y ) ) continue;
			cellSet( p, X, Y, p.isQuay );
			if ( d < 0.3 || k < 0 ) continue;
			if ( p.isQuay ) quayMask[ k ] = p.quay;
			else streetMask[ k ] = 1;

		}

	}

	// Čapadlo's lane: the floor levelled inside its outline (the garden's wall, the faculty's wall, the lane's west
	// end under the pavement, Divadelní at the east end).
	const lane = [ ...LANE.north, ...[ ...LANE.wall ].reverse() ].map( ( [ x, z ] ) => S( x, z ) );
	const inLane = ( X, Y ) => {

		let inside = false;
		for ( let i = 0, j = lane.length - 1; i < lane.length; j = i ++ ) {

			const [ xi, yi ] = lane[ i ], [ xj, yj ] = lane[ j ];
			if ( ( yi > Y ) !== ( yj > Y ) && X < xi + ( Y - yi ) * ( xj - xi ) / ( yj - yi ) ) inside = ! inside;

		}

		return inside;

	};
	const laneY = x => LANE.floor[ 0 ] - BASE + ( LANE.floor[ 1 ] - LANE.floor[ 0 ] ) * Math.max( 0, Math.min( 1, ( x - LANE.west ) / 35.6 ) );
	{

		const xs = lane.map( p => p[ 0 ] ), ys = lane.map( p => p[ 1 ] );
		for ( let X = Math.min( ...xs ) - 1; X <= Math.max( ...xs ) + 1; X += 0.25 ) for ( let Y = Math.min( ...ys ) - 1; Y <= Math.max( ...ys ) + 1; Y += 0.25 ) {

			if ( ! inLane( X, Y ) ) continue;
			setCell( X, Y, () => laneY( X - ORIGIN.x ) );
			const k = gi( X, Y );
			if ( k >= 0 ) beyondMask[ k ] = 1;

		}

	}

	// The steps and the underpass.
	const st = LANE.steps;
	const stepsTop = dtmAt( ...S( st.top[ 0 ] - 1.5, st.top[ 1 ] ) );
	const capadlo = {
		steps: { top: [ ...S( ...st.top ), stepsTop ], foot: [ ...S( ...st.foot ), laneY( st.foot[ 0 ] ) ], w: st.w, n: st.n }
	};
	{

		// The ground cut away under the steps (cells whose centre is under them).
		const [ tX, tY ] = capadlo.steps.top, [ fX, fY ] = capadlo.steps.foot;
		const len = Math.hypot( tX - fX, tY - fY ), ux = ( tX - fX ) / len, uy = ( tY - fY ) / len;
		for ( let c = Math.floor( ( Math.min( tX, fX ) - 3 - AREA.xmin ) / cell ); c <= Math.ceil( ( Math.max( tX, fX ) + 3 - AREA.xmin ) / cell ); c ++ ) {

			for ( let r = Math.floor( ( AREA.ymax - Math.max( tY, fY ) - 3 ) / cell ); r <= Math.ceil( ( AREA.ymax - Math.min( tY, fY ) + 3 ) / cell ); r ++ ) {

				const X = AREA.xmin + c * cell, Y = AREA.ymax - r * cell;
				const s = ( X - fX ) * ux + ( Y - fY ) * uy, o = - ( X - fX ) * uy + ( Y - fY ) * ux;
				if ( s > - 0.3 && s < len - 0.3 && Math.abs( o ) < st.w / 2 + 0.2 ) terrain[ r * tw + c ] = Math.min( terrain[ r * tw + c ], capadlo.steps.foot[ 2 ] - 0.2 );

			}

		}

	}

	{

		// The underpass ends where it meets the railing line.
		const T = LANE.tunnel, [ ax, ay ] = S( ...T.a ), dx = T.dir[ 0 ], dy = - T.dir[ 1 ];
		let best = null;
		for ( const p of rail ) {

			const along = ( p.X - ax ) * dx + ( p.Y - ay ) * dy, off = Math.abs( - ( p.X - ax ) * dy + ( p.Y - ay ) * dx );
			if ( along > 5 && off < 1 && ( ! best || off < best.off ) ) best = { p, along, off };

		}

		if ( best ) {

			const L = best.along + 0.4, mouth = best.p;
			const b = [ ax + dx * L, ay + dy * L ];
			capadlo.tunnel = { a: [ ax, ay, laneY( T.a[ 0 ] ) ], b: [ ...b, mouth.quay ], w: T.w, h: T.h };
			// The wall under the railing is open over the underpass.
			for ( const p of rail ) {

				const along = ( p.X - ax ) * dx + ( p.Y - ay ) * dy, off = - ( p.X - ax ) * dy + ( p.Y - ay ) * dx;
				if ( along > 5 && Math.abs( off ) < T.w / 2 + 0.2 ) {

					p.portal = true;
					p.openTop = mouth.quay + T.h;

				}

			}

		}

	}

	// The lane's walls as railing lines: the west end under the pavement (open over the underpass, ending at the
	// steps), and the garden's retaining wall with its fence. n points into the lane.
	const wallLine = ( pts, n, top, extra = () => ( {} ) ) => {

		const out = [];
		for ( let i = 1; i < pts.length; i ++ ) {

			const [ ax, ay ] = S( ...pts[ i - 1 ] ), [ bx, by ] = S( ...pts[ i ] );
			const len = Math.hypot( bx - ax, by - ay ), k = Math.max( 1, Math.round( len ) );
			let nx = ( by - ay ) / len, ny = - ( bx - ax ) / len;
			const [ px, py ] = S( ...n );
			if ( nx * ( px - ax ) + ny * ( py - ay ) < 0 ) {

				nx = - nx; ny = - ny;

			}

			for ( let j = out.length ? 1 : 0; j <= k; j ++ ) {

				const X = ax + ( bx - ax ) * j / k, Y = ay + ( by - ay ) * j / k;
				out.push( { X, Y, nx, ny, top: top( X, Y, nx, ny ), quay: laneY( X - ORIGIN.x ), wall: true, river: false, ...extra( X, Y ) } );

			}

		}

		return out;

	};
	const T = LANE.tunnel, ta = S( ...T.a );
	const laneWest = wallLine( [ [ LANE.west, LANE.north[ 0 ][ 1 ] ], [ LANE.west, st.top[ 1 ] - st.w / 2 ] ], [ LANE.west + 5, 199 ], ( X, Y, nx, ny ) => dtmAt( X - nx * 1.5, Y - ny * 1.5 ),
		( X, Y ) => Math.abs( Y - ta[ 1 ] ) < T.w / 2 + 0.2 ? { portal: true, openTop: laneY( LANE.west ) + T.h } : {} );
	const laneNorth = wallLine( LANE.north, [ - 345, 202 ], ( X, Y, nx, ny ) => median( [ 1.5, 2, 3 ].map( d => dtmAt( X - nx * d, Y - ny * d ) ) ) );

	const beyond = ( X, Y ) => {

		const k = gi( X, Y );
		return k >= 0 && beyondMask[ k ] === 1;

	};
	// For the river embankment: what a point just inland of the river's outline is: 'quay' (the náplavka),
	// 'street' (the railing is right above) or null.
	const edge = ( X, Y ) => {

		const k = gi( X, Y );
		if ( k < 0 ) return null;
		if ( Number.isFinite( quayMask[ k ] ) ) return 'quay';
		return streetMask[ k ] ? 'street' : null;

	};

	// Heights next to the walls (for the pavement mesh): the wall's top on its high side, its foot on the low side,
	// not the 1 m terrain grid's ramp between them.
	const walls = [ rail, laneWest, laneNorth ].flatMap( l => l.filter( p => p.wall && ! p.portal ) );
	const wx0 = Math.min( ...walls.map( p => p.X ) ) - 2, wx1 = Math.max( ...walls.map( p => p.X ) ) + 2;
	const wy0 = Math.min( ...walls.map( p => p.Y ) ) - 2, wy1 = Math.max( ...walls.map( p => p.Y ) ) + 2;
	const clamp = ( X, Y, h ) => {

		if ( X < wx0 || X > wx1 || Y < wy0 || Y > wy1 ) return h;
		let best = null, bd = 2;
		for ( const p of walls ) {

			const d = Math.hypot( X - p.X, Y - p.Y );
			if ( d < bd ) {

				bd = d;
				best = p;

			}

		}

		if ( ! best ) return h;
		return ( X - best.X ) * best.nx + ( Y - best.Y ) * best.ny < 0 ? Math.max( h, best.top ) : Math.min( h, best.quay );

	};

	const q = rail.filter( p => p.isQuay );
	console.log( `quay: ${rail.length} m of railing in ${corners.length - 1} straight runs, náplavka ${q.length} m at ${q.length ? ( Math.min( ...q.map( p => p.quay ) ) + BASE ).toFixed( 2 ) : '-'}…${q.length ? ( Math.max( ...q.map( p => p.quay ) ) + BASE ).toFixed( 2 ) : '-'} m; Čapadlo underpass ${capadlo.tunnel ? Math.hypot( capadlo.tunnel.b[ 0 ] - capadlo.tunnel.a[ 0 ], capadlo.tunnel.b[ 1 ] - capadlo.tunnel.a[ 1 ] ).toFixed( 1 ) + ' m' : 'MISSING'}` );
	return { rail, lines: [ rail, laneWest, laneNorth ], beyond, edge, capadlo, inLane, clamp };

}
