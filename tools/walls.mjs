// Garden and courtyard walls (OSM barrier=wall): plastered walls with a coping, a walk barrier, an open gateway
// where a footway goes through, and barred gates where street photos show them (the Náprstek museum's garden wall
// on Náprstkova: four iron-barred openings). Drawn by src/dress.js.

import { readFileSync } from 'node:fs';

const HEIGHT = 2.6;
// Barred gates seen in street photos: way id → fractions along the way (from its first node).
const BARRED = { 398651531: [ 0.36, 0.61, 0.77, 0.88 ] };
const COLOUR = { 398651531: '#efe0b2' };

export function collectWalls( { places, project, L, S, yAtLocal, streetData, AREA } ) {

	const osm = JSON.parse( readFileSync( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	const foot = streetData.ways.filter( w => /footway|path|pedestrian|steps|living_street/.test( w.tags?.highway || '' ) ).map( w => w.pts );
	// Where segment a–b crosses a footway: the fraction along a–b, or null.
	const crossing = ( [ ax, ay ], [ bx, by ] ) => {

		for ( const pts of foot ) for ( let i = 1; i < pts.length; i ++ ) {

			const cx = pts[ i - 1 ].X, cy = pts[ i - 1 ].Y, dx = pts[ i ].X, dy = pts[ i ].Y;
			const d = ( bx - ax ) * ( dy - cy ) - ( by - ay ) * ( dx - cx );
			if ( Math.abs( d ) < 1e-9 ) continue;
			const t = ( ( cx - ax ) * ( dy - cy ) - ( cy - ay ) * ( dx - cx ) ) / d, u = ( ( cx - ax ) * ( by - ay ) - ( cy - ay ) * ( bx - ax ) ) / d;
			if ( t >= 0 && t <= 1 && u >= 0 && u <= 1 ) return t;

		}

		return null;

	};

	const walls = places.walls = [];
	let n = 0;
	for ( const w of osm ) {

		if ( w.type !== 'way' || w.tags?.barrier !== 'wall' ) continue;
		const pts = w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( q => project( q.lon, q.lat ) );
		if ( pts.length < 2 || ! pts.some( ( [ X, Y ] ) => X > AREA.xmin && X < AREA.xmax && Y > AREA.ymin && Y < AREA.ymax ) ) continue;
		const total = pts.slice( 1 ).reduce( ( a, p, i ) => a + Math.hypot( p[ 0 ] - pts[ i ][ 0 ], p[ 1 ] - pts[ i ][ 1 ] ), 0 );
		const gates = ( BARRED[ w.id ] || [] ).map( f => f * total );
		const height = Number( w.tags.height ) || HEIGHT;
		let s = 0;
		for ( let i = 1; i < pts.length; i ++ ) {

			const A = pts[ i - 1 ], B = pts[ i ], len = Math.hypot( B[ 0 ] - A[ 0 ], B[ 1 ] - A[ 1 ] );
			if ( len < 0.3 ) continue;
			// Openings on this segment, as [ from, to, kind ] in metres along it.
			const open = [];
			const t = crossing( A, B );
			if ( t !== null ) open.push( [ t * len - 0.9, t * len + 0.9, 'open' ] );
			for ( const g of gates ) if ( g >= s && g < s + len ) open.push( [ g - s - 0.55, g - s + 0.55, 'barred' ] );
			open.sort( ( p, q ) => p[ 0 ] - q[ 0 ] );
			const at = d => {

				const X = A[ 0 ] + ( B[ 0 ] - A[ 0 ] ) * d / len, Y = A[ 1 ] + ( B[ 1 ] - A[ 1 ] ) * d / len;
				const [ x, z ] = L( X, Y );
				return [ x, yAtLocal( x, z ), z ];

			};

			let d0 = 0;
			for ( const [ o0, o1, kind ] of [ ...open, [ len, len, 'end' ] ] ) {

				const a = Math.max( d0, 0 ), b = Math.min( o0, len );
				if ( b - a > 0.1 ) {

					const [ x0, y0, z0 ] = at( a ), [ x1, y1, z1 ] = at( b );
					walls.push( { kind: 'wall', x0, z0, x1, z1, y: + Math.min( y0, y1 ).toFixed( 2 ), h: height, colour: COLOUR[ w.id ] || '#e6dcc6' } );
					places.barriers.push( [ x0, z0, x1, z1, - 99 ] );

				}

				if ( kind !== 'end' ) {

					const [ x0, y0, z0 ] = at( Math.max( 0, o0 ) ), [ x1, , z1 ] = at( Math.min( len, o1 ) );
					walls.push( { kind, x0, z0, x1, z1, y: y0, h: height, colour: COLOUR[ w.id ] || '#e6dcc6' } );
					if ( kind === 'barred' ) places.barriers.push( [ x0, z0, x1, z1, - 99 ] );

				}

				d0 = Math.max( d0, o1 );

			}

			s += len;

		}

		n ++;

	}

	console.log( `walls: ${n} garden and courtyard walls, ${walls.filter( p => p.kind !== 'wall' ).length} gates` );

}
