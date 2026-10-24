// Level changes the bare-earth terrain model gets wrong, by the National Theatre:
//
//   - Divadelní runs under Národní in a short tunnel (OSM layer -1). The terrain model has no bridge, so Národní
//     dipped down to Divadelní there. Národní's deck is raised back to its level, with walls and railings at both
//     portals, and the tunnel is walkable below.
//   - The piazzetta of the National Theatre (náměstí Václava Havla) is a level granite terrace about 4 m above
//     Divadelní: levelled, with a retaining wall and a heavy stone parapet (no railing) along its Divadelní side.
//
// Returns railing lines in the format of tools/quay.mjs (drawn and made walk barriers the same way), the tunnel,
// and the piazzetta (outline and level). S-JTSK metres; heights relative to BASE_HEIGHT like the terrain grid.

import { readFile } from 'node:fs/promises';
import { lonLatToSJTSK } from './geo.mjs';

const DIVADELNI_TUNNEL = 141140410;
const PIAZZETTA = 27804723;

export async function buildTerraces( { terrain, tw, th, cell, AREA, terrainAt, buildingAt = () => - 1 } ) {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	const way = id => {

		const w = osm.find( e => e.type === 'way' && e.id === id );
		return w ? w.nodes.map( n => nodes.get( n ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) ) : null;

	};

	const idx = ( X, Y ) => {

		const c = Math.round( ( X - AREA.xmin ) / cell ), r = Math.round( ( AREA.ymax - Y ) / cell );
		return c >= 0 && r >= 0 && c < tw && r < th ? r * tw + c : - 1;

	};

	const rails = [], out = { rails, tunnel: null, piazzetta: null };

	// --- Národní over Divadelní
	const t = way( DIVADELNI_TUNNEL );
	if ( t ) {

		const [ A, B ] = [ t[ 0 ], t[ t.length - 1 ] ];
		const len = Math.hypot( B[ 0 ] - A[ 0 ], B[ 1 ] - A[ 1 ] ), ux = ( B[ 0 ] - A[ 0 ] ) / len, uy = ( B[ 1 ] - A[ 1 ] ) / len;
		const px = - uy, py = ux, HALF = 9, ROAD = 5;
		// The deck: Národní's level either side of the tunnel, across it.
		const deckAt = s => Math.max( terrainAt( A[ 0 ] + ux * s + px * ( HALF + 4 ), A[ 1 ] + uy * s + py * ( HALF + 4 ) ), terrainAt( A[ 0 ] + ux * s - px * ( HALF + 4 ), A[ 1 ] + uy * s - py * ( HALF + 4 ) ) );
		const deck = [];
		for ( let s = 0; s <= len; s += 1 ) deck.push( deckAt( s ) );
		const ceil = [ ...deck ].sort( ( a, b ) => a - b )[ deck.length >> 1 ] - 0.6;
		// Road levels away from the portals (the model ramps Divadelní up the portal walls); at the portals the road
		// is down far enough for 3 m of headroom under the deck, ramping to the street's level 16 m out.
		const far = [ terrainAt( A[ 0 ] - ux * 16, A[ 1 ] - uy * 16 ), terrainAt( B[ 0 ] + ux * 16, B[ 1 ] + uy * 16 ) ];
		const yA = Math.min( far[ 0 ], ceil - 3 ), yB = Math.min( far[ 1 ], ceil - 3 );
		for ( const [ P, sgn, y, yFar ] of [ [ A, - 1, yA, far[ 0 ] ], [ B, 1, yB, far[ 1 ] ] ] ) for ( let d = 0.2; d <= 16; d += 0.4 ) for ( let o = - ROAD; o <= ROAD; o += 0.4 ) {

			const i = idx( P[ 0 ] + ux * sgn * d + px * o, P[ 1 ] + uy * sgn * d + py * o );
			if ( i >= 0 ) terrain[ i ] = Math.min( terrain[ i ], y + ( yFar - y ) * d / 16 );

		}

		// Národní is level over the tunnel (and its pavements beside it).
		const level = ceil + 0.6;
		for ( let s = - 0.5; s <= len + 0.5; s += 0.4 ) for ( let o = - HALF - 4; o <= HALF + 4; o += 0.4 ) {

			const i = idx( A[ 0 ] + ux * s + px * o, A[ 1 ] + uy * s + py * o );
			if ( i >= 0 && ( Math.abs( o ) <= HALF || terrain[ i ] > level - 1.2 ) ) terrain[ i ] = Math.max( terrain[ i ], level );

		}

		deck.fill( level );

		out.tunnel = { a: A, b: B, ya: yA, yb: yB, w: 2 * ROAD + 1, ceil };
		// Portal walls: across the tunnel's mouths, the low side outwards.
		for ( const [ P, sgn, low, top ] of [ [ A, - 1, yA, deck[ 0 ] ], [ B, 1, yB, deck[ deck.length - 1 ] ] ] ) {

			const line = [];
			for ( let o = - HALF; o <= HALF + 1e-6; o += 1 ) line.push( { X: P[ 0 ] + px * o, Y: P[ 1 ] + py * o, nx: ux * sgn, ny: uy * sgn, top, quay: low, wall: true, portal: Math.abs( o ) < ROAD } );
			rails.push( line );

		}

	}

	// --- The piazzetta
	const p = way( PIAZZETTA );
	if ( p ) {

		const ring = p.slice( 0, - 1 );
		const inRing = ( X, Y ) => {

			let c = false;
			for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

				const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ j ];
				if ( ( ay > Y ) !== ( by > Y ) && X < ax + ( Y - ay ) / ( by - ay ) * ( bx - ax ) ) c = ! c;

			}

			return c;

		};

		const xs = ring.map( q => q[ 0 ] ), ys = ring.map( q => q[ 1 ] );
		const heights = [];
		for ( let X = Math.min( ...xs ); X <= Math.max( ...xs ); X += 1 ) for ( let Y = Math.min( ...ys ); Y <= Math.max( ...ys ); Y += 1 ) if ( inRing( X, Y ) ) heights.push( terrainAt( X, Y ) );
		heights.sort( ( a, b ) => a - b );
		const level = heights[ Math.floor( heights.length * 0.75 ) ];
		const low = new Map();
		// Find the Divadelní side: ring edges with low ground just outside them.
		for ( let i = 0; i < ring.length; i ++ ) {

			const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ];
			const l = Math.hypot( bx - ax, by - ay );
			if ( l < 4 ) continue;
			let nx = ( by - ay ) / l, ny = - ( bx - ax ) / l;
			if ( inRing( ( ax + bx ) / 2 + nx * 0.5, ( ay + by ) / 2 + ny * 0.5 ) ) {

				nx = - nx;
				ny = - ny;

			}

			if ( buildingAt( ( ax + bx ) / 2 + nx * 2, ( ay + by ) / 2 + ny * 2 ) >= 0 ) continue; // a house front
			const outside = terrainAt( ( ax + bx ) / 2 + nx * 4, ( ay + by ) / 2 + ny * 4 );
			if ( level - outside < 1.5 ) continue;
			const line = [];
			for ( let s = 0; s <= l + 1e-6; s += 1 ) {

				const X = ax + ( bx - ax ) * s / l - nx * 0.3, Y = ay + ( by - ay ) * s / l - ny * 0.3;
				line.push( { X, Y, nx, ny, top: level, quay: Math.min( level - 0.5, terrainAt( X + nx * 3.5, Y + ny * 3.5 ) ), wall: true, parapet: true } );

			}

			rails.push( line );
			low.set( i, true );

		}

		for ( let X = Math.min( ...xs ) - 1; X <= Math.max( ...xs ) + 1; X += 0.5 ) for ( let Y = Math.min( ...ys ) - 1; Y <= Math.max( ...ys ) + 1; Y += 0.5 ) {

			const i = idx( X, Y );
			if ( i >= 0 && inRing( X, Y ) ) terrain[ i ] = level;

		}

		out.piazzetta = { ring, level };

	}

	console.log( `terraces: ${rails.length} walls with railings${out.tunnel ? ', Divadelní under Národní' : ''}${out.piazzetta ? `, piazzetta at ${out.piazzetta.level.toFixed( 2 )}` : ''}` );
	return out;

}
