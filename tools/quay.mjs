// Smetanovo nábřeží's river edge: the riverside pavement (OSM) runs along an iron railing on a stone curb from
// Karlovy lázně to Most Legií. Where the river wall is right below, the embankment (build-scene.mjs) already has
// its parapet and railing; elsewhere a lower quay lies below the street (the Čapadlo terrace by the Faculty of
// Social Sciences): there the street ends in a vertical retaining wall with the railing on top, and the terrace
// below is levelled. Returns the railing line (for the walk barrier and stairs), the wall and railing geometry,
// and beyond( X, Y ): whether a point lies riverward of the railing (no street pavement there).
//
// All in S-JTSK metres; heights relative to BASE_HEIGHT like the terrain grid.

import { readFile } from 'node:fs/promises';
import { lonLatToSJTSK } from './geo.mjs';

// The riverside pavement of Smetanovo nábřeží, south to north (OSM ways).
const RIVERSIDE_WAYS = [ 963908577, 74171496, 137806764 ];
const OFFSET = 1.4; // railing: this far riverward of the pavement's centre line
const UNDERPASS_WAY = 1201427940; // Čapadlo: the footway under the street from the faculty's side to the terrace

export async function buildQuay( { terrain, tw, th, cell, AREA, terrainAt, riverAt } ) {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	const ways = RIVERSIDE_WAYS.map( id => osm.find( e => e.type === 'way' && e.id === id ) ).filter( Boolean )
		.map( w => w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) ) );

	// Join into one line (each way flipped as needed to continue the previous one).
	let line = [];
	for ( const w of ways ) {

		if ( ! line.length ) {

			line = [ ...w ];
			continue;

		}

		const end = line[ line.length - 1 ];
		const d0 = Math.hypot( w[ 0 ][ 0 ] - end[ 0 ], w[ 0 ][ 1 ] - end[ 1 ] ), d1 = Math.hypot( w[ w.length - 1 ][ 0 ] - end[ 0 ], w[ w.length - 1 ][ 1 ] - end[ 1 ] );
		const next = d1 < d0 ? [ ...w ].reverse() : w;
		if ( Math.min( d0, d1 ) > 5 && line.length ) {

			// The first way may run the other way round.
			const s0 = Math.hypot( w[ 0 ][ 0 ] - line[ 0 ][ 0 ], w[ 0 ][ 1 ] - line[ 0 ][ 1 ] );
			if ( s0 < 5 ) line.reverse();

		}

		line.push( ...next.slice( 1 ) );

	}

	if ( line.length < 2 ) return null;

	// Resample every metre, offset towards the river.
	const pts = [];
	for ( let i = 1; i < line.length; i ++ ) {

		const [ ax, ay ] = line[ i - 1 ], [ bx, by ] = line[ i ];
		const len = Math.hypot( bx - ax, by - ay ), n = Math.max( 1, Math.round( len ) );
		for ( let k = i === 1 ? 0 : 1; k <= n; k ++ ) pts.push( [ ax + ( bx - ax ) * k / n, ay + ( by - ay ) * k / n ] );

	}

	const riverSide = ( X, Y, nx, ny ) => {

		for ( let d = 1; d < 30; d += 1 ) {

			if ( riverAt( X + nx * d, Y + ny * d ) ) return 1;
			if ( riverAt( X - nx * d, Y - ny * d ) ) return - 1;

		}

		return 1;

	};

	// Each point: the riverward direction, and where the street's level ends (the top of the drop to the river or
	// to a lower quay): the most riverward point within the street's level, searched from 4 m riverward of the
	// pavement line to 8 m landward of it. Smoothed along the line (a running median).
	const probe = [];
	for ( let i = 0; i < pts.length; i ++ ) {

		const a = pts[ Math.max( 0, i - 3 ) ], b = pts[ Math.min( pts.length - 1, i + 3 ) ];
		const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) || 1;
		let nx = ( b[ 1 ] - a[ 1 ] ) / l, ny = - ( b[ 0 ] - a[ 0 ] ) / l;
		const s = riverSide( pts[ i ][ 0 ], pts[ i ][ 1 ], nx, ny );
		nx *= s; ny *= s;
		const [ PX, PY ] = pts[ i ];
		const at = d => riverAt( PX + nx * d, PY + ny * d ) ? - 99 : terrainAt( PX + nx * d, PY + ny * d );
		let top = - 99;
		for ( let d = - 10; d <= 0; d += 0.5 ) top = Math.max( top, at( d ) );
		// The survey surface rounds the wall's top off: take the edge half way down a big drop.
		let low = top;
		for ( let d = 3; d <= 7; d += 0.5 ) if ( at( d ) > - 99 ) low = Math.min( low, at( d ) );
		const level = top - Math.max( 0.35, Math.min( 1.2, ( top - low ) / 2 ) );
		let edge = OFFSET;
		if ( top - low > 1.0 ) for ( let d = 4; d >= - 8; d -= 0.25 ) if ( at( d ) >= level ) {

			edge = Math.min( OFFSET, d + 0.2 );
			break;

		}

		probe.push( { PX, PY, nx, ny, edge } );

	}

	const rail = [];
	for ( let i = 0; i < probe.length; i ++ ) {

		const near = probe.slice( Math.max( 0, i - 4 ), i + 5 ).map( p => p.edge ).sort( ( a, b ) => a - b );
		const { PX, PY, nx, ny } = probe[ i ], edge = near[ near.length >> 1 ];
		const X = PX + nx * edge, Y = PY + ny * edge;
		if ( X < AREA.xmin + 2 || X > AREA.xmax - 2 || Y < AREA.ymin + 2 || Y > AREA.ymax - 2 ) continue;
		const top = Math.max( terrainAt( X - nx * 1.2, Y - ny * 1.2 ), terrainAt( X - nx * 2.5, Y - ny * 2.5 ) );
		// What lies below: the river wall right there (the embankment has it), or a lower quay.
		let river = false;
		for ( let d = 0.5; d <= 2.5; d += 0.5 ) if ( riverAt( X + nx * d, Y + ny * d ) ) river = true;
		const below = [];
		for ( let d = 3; d <= 9; d += 1 ) if ( ! riverAt( X + nx * d, Y + ny * d ) ) below.push( terrainAt( X + nx * d, Y + ny * d ) );
		below.sort( ( p, q ) => p - q );
		const low = below.length ? below[ below.length >> 1 ] : top;
		rail.push( { X, Y, nx, ny, top, river, low: Math.min( low, top ) } );

	}

	// Where the underpass comes out under the railing: the wall has an opening there (a lintel over it).
	const under = osm.find( e => e.type === 'way' && e.id === UNDERPASS_WAY );
	if ( under ) {

		const u = under.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) );
		for ( const p of rail ) for ( let i = 1; i < u.length; i ++ ) {

			const [ ax, ay ] = u[ i - 1 ], [ bx, by ] = u[ i ];
			const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
			const t = Math.max( 0, Math.min( 1, ( ( p.X - ax ) * dx + ( p.Y - ay ) * dy ) / l2 ) );
			if ( Math.hypot( p.X - ax - t * dx, p.Y - ay - t * dy ) < 1.5 ) p.portal = true;

		}

	}

	// Smooth the quay level along the line (a terrace is level), then level the ground below the wall.
	for ( let i = 0; i < rail.length; i ++ ) {

		const near = rail.slice( Math.max( 0, i - 6 ), i + 7 ).filter( r => ! r.river ).map( r => r.low ).sort( ( p, q ) => p - q );
		rail[ i ].quay = near.length ? near[ near.length >> 1 ] : rail[ i ].low;
		rail[ i ].wall = ! rail[ i ].river && rail[ i ].top - rail[ i ].quay > 0.8;

	}

	const setCell = ( X, Y, fn ) => {

		const c = Math.round( ( X - AREA.xmin ) / cell ), r = Math.round( ( AREA.ymax - Y ) / cell );
		if ( c < 0 || r < 0 || c >= tw || r >= th ) return;
		terrain[ r * tw + c ] = fn( terrain[ r * tw + c ] );

	};

	for ( const p of rail ) {

		if ( ! p.wall ) continue;
		for ( let d = 0.4; d <= 3.5; d += 0.4 ) for ( const o of [ - 0.5, 0, 0.5 ] ) {

			const X = p.X + p.nx * d - p.ny * o, Y = p.Y + p.ny * d + p.nx * o;
			if ( ! riverAt( X, Y ) ) setCell( X, Y, v => Math.min( v, p.quay ) );

		}

		for ( let d = 0.2; d <= 1.6; d += 0.4 ) setCell( p.X - p.nx * d, p.Y - p.ny * d, v => Math.max( v, p.top ) );

	}

	// Riverward of the railing (within 14 m): no street pavement. Rasterised once on a 0.5 m grid.
	const G = 0.5, gw = Math.ceil( ( AREA.xmax - AREA.xmin ) / G ), gh = Math.ceil( ( AREA.ymax - AREA.ymin ) / G );
	const mask = new Uint8Array( gw * gh );
	for ( const p of rail ) for ( let d = 0.3; d <= 14; d += 0.25 ) for ( let o = - 0.75; o <= 0.75; o += 0.25 ) {

		const X = p.X + p.nx * d - p.ny * o, Y = p.Y + p.ny * d + p.nx * o;
		const c = Math.floor( ( X - AREA.xmin ) / G ), r = Math.floor( ( AREA.ymax - Y ) / G );
		if ( c >= 0 && r >= 0 && c < gw && r < gh ) mask[ r * gw + c ] = 1;

	}

	const beyond = ( X, Y ) => {

		const c = Math.floor( ( X - AREA.xmin ) / G ), r = Math.floor( ( AREA.ymax - Y ) / G );
		return c >= 0 && r >= 0 && c < gw && r < gh && mask[ r * gw + c ] === 1;

	};

	console.log( `quay: ${rail.length} m of railing, ${rail.filter( p => p.wall ).length} m of retaining wall` );
	return { rail, beyond };

}
