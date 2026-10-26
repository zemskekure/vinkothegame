// Outdoor stairs in the newly covered city follow OpenStreetMap lines and DMR ground heights.
// Existing streets keep their terrain; enclosed and underground stairs need a later passage survey.
import { EAST_AREA } from './area.mjs';

export function collectFirstLayer( { places, streetData, terrainAt, terrainGrid, AREA, ORIGIN } ) {

	const inOld = ( X, Y ) => X >= EAST_AREA.xmin && X <= EAST_AREA.xmax && Y >= EAST_AREA.ymin && Y <= EAST_AREA.ymax;
	const inside = ( X, Y ) => X > AREA.xmin + 2 && X < AREA.xmax - 2 && Y > AREA.ymin + 2 && Y < AREA.ymax - 2;
	const local = ( p, y ) => [ p.X - ORIGIN.x, y, ORIGIN.y - p.Y ];
	const { terrain, tw, th, cell } = terrainGrid;
	let count = 0;
	for ( const w of streetData.ways ) {

		const t = w.tags;
		if ( t.highway !== 'steps' || t.tunnel || /^(private|no|customers)$/.test( t.access || '' ) || Number( t.layer ) < 0 ) continue;
		if ( ! w.pts.every( p => inside( p.X, p.Y ) && ! inOld( p.X, p.Y ) ) ) continue;
		const total = w.pts.slice( 1 ).reduce( ( sum, p, i ) => sum + Math.hypot( p.X - w.pts[ i ].X, p.Y - w.pts[ i ].Y ), 0 );
		const width = Math.max( 1, Math.min( 8, parseFloat( t.width ) || 2 ) );
		for ( let i = 1; i < w.pts.length; i ++ ) {

			const a = w.pts[ i - 1 ], b = w.pts[ i ], len = Math.hypot( b.X - a.X, b.Y - a.Y );
			const n = Math.max( 1, Math.ceil( len / 8 ) );
			for ( let k = 0; k < n; k ++ ) {

				const at = f => ( { X: a.X + ( b.X - a.X ) * f, Y: a.Y + ( b.Y - a.Y ) * f } );
				let p = at( k / n ), q = at( ( k + 1 ) / n );
				let y0 = terrainAt( p.X, p.Y ), y1 = terrainAt( q.X, q.Y );
				if ( y0 > y1 ) { [ p, q ] = [ q, p ]; [ y0, y1 ] = [ y1, y0 ]; }
				const run = len / n, rise = y1 - y0;
				if ( run < 0.3 || rise < 0.12 ) continue;
				const steps = Math.max( 1, Math.ceil( rise / 0.18 ), Math.round( ( Number( t.step_count ) || 0 ) * run / total ) );
				const bottom = local( p, y0 + 0.03 ), top = local( q, y1 + 0.03 );
				const ux = ( top[ 0 ] - bottom[ 0 ] ) / run, uz = ( top[ 2 ] - bottom[ 2 ] ) / run;
				places.flights.push( { kind: 'open', bottom, top, w: width, steps, way: w.id } );
				places.zones.push( { x: ( bottom[ 0 ] + top[ 0 ] ) / 2, z: ( bottom[ 2 ] + top[ 2 ] ) / 2, ux: uz, uz: - ux, hu: width / 2, hn: run / 2, y0: bottom[ 1 ], y1: top[ 1 ], along: [ ux, uz ], steps } );
				// Leave the terrain just under the treads so the hillside cannot cover them.
				const margin = width / 2 + 1;
				const c0 = Math.max( 0, Math.floor( ( Math.min( p.X, q.X ) - margin - AREA.xmin ) / cell ) );
				const c1 = Math.min( tw - 1, Math.ceil( ( Math.max( p.X, q.X ) + margin - AREA.xmin ) / cell ) );
				const r0 = Math.max( 0, Math.floor( ( AREA.ymax - Math.max( p.Y, q.Y ) - margin ) / cell ) );
				const r1 = Math.min( th - 1, Math.ceil( ( AREA.ymax - Math.min( p.Y, q.Y ) + margin ) / cell ) );
				for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

					const X = AREA.xmin + c * cell, Y = AREA.ymax - r * cell;
					const f = ( ( X - p.X ) * ( q.X - p.X ) + ( Y - p.Y ) * ( q.Y - p.Y ) ) / ( run * run );
					if ( f < 0 || f > 1 || inOld( X, Y ) ) continue;
					if ( Math.hypot( X - p.X - f * ( q.X - p.X ), Y - p.Y - f * ( q.Y - p.Y ) ) > width / 2 + 0.2 ) continue;
					terrain[ r * tw + c ] = Math.min( terrain[ r * tw + c ], y0 + rise * f - 0.08 );

				}
				count ++;

			}

		}

	}
	console.log( `first layer: ${count} outdoor stair flights` );

}
