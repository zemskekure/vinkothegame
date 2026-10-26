// Petřín: the lookout tower and the funicular's track, from the data (drawn by src/petrin.js).
//
//   - Petřínská rozhledna (RÚIAN 40367843, OSM way 7645353: "steel framework tower", 60 m to its roof): the
//     octagonal footprint of its base (18 m across), the ground under it from the terrain model; the surface model
//     sees its top 56 m over the ground.
//   - Lanová dráha na Petřín: the OSM ways railway=funicular from Újezd past Nebozízek (where the two tracks of the
//     passing loop part) to Petřín, moved onto the cadastre; the track follows the terrain model (the cutting
//     included), level between the ends of the viaduct (bridge=yes).

import { readFileSync } from 'node:fs';

export const PETRIN_TOWER = 40367843;

export function collectPetrin( ctx, { L } ) {

	const { buildings, terrainAt, projectCadastre, AREA } = ctx;
	const out = { tower: null, funicular: [] };
	const b = buildings.find( q => q.code === PETRIN_TOWER );
	if ( b ) {

		const ring = b.poly.outer;
		const cx = ring.reduce( ( a, p ) => a + p[ 0 ], 0 ) / ring.length, cy = ring.reduce( ( a, p ) => a + p[ 1 ], 0 ) / ring.length;
		const r = Math.max( ...ring.map( ( [ X, Y ] ) => Math.hypot( X - cx, Y - cy ) ) );
		// One corner of the octagon gives its turn.
		const [ X0, Y0 ] = ring.reduce( ( a, p ) => Math.hypot( p[ 0 ] - cx, p[ 1 ] - cy ) > Math.hypot( a[ 0 ] - cx, a[ 1 ] - cy ) ? p : a );
		const [ x, z ] = L( cx, cy ), [ x0, z0 ] = L( X0, Y0 );
		out.tower = { x, z, y: + Math.min( ...ring.map( ( [ X, Y ] ) => terrainAt( X, Y ) ) ).toFixed( 2 ), r: + r.toFixed( 2 ), rot: + Math.atan2( x0 - x, z0 - z ).toFixed( 3 ) };

	}

	if ( ! projectCadastre ) return out;
	const osm = JSON.parse( readFileSync( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( q => [ q.id, q ] ) );
	for ( const w of osm ) {

		if ( w.type !== 'way' || w.tags?.railway !== 'funicular' ) continue;
		const pts = w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( q => projectCadastre( q.lon, q.lat ) );
		if ( ! pts.every( ( [ X, Y ] ) => X > AREA.xmin && X < AREA.xmax && Y > AREA.ymin && Y < AREA.ymax ) ) continue;
		// Every 2 m along the way.
		const line = [];
		for ( let i = 1; i < pts.length; i ++ ) {

			const [ ax, ay ] = pts[ i - 1 ], [ bx, by ] = pts[ i ], n = Math.max( 1, Math.ceil( Math.hypot( bx - ax, by - ay ) / 2 ) );
			for ( let k = i === 1 ? 0 : 1; k <= n; k ++ ) line.push( [ ax + ( bx - ax ) * k / n, ay + ( by - ay ) * k / n ] );

		}

		const ys = line.map( ( [ X, Y ] ) => terrainAt( X, Y ) + 0.25 );
		if ( w.tags.bridge === 'yes' ) for ( let i = 0; i < ys.length; i ++ ) ys[ i ] = ys[ 0 ] + ( ys[ ys.length - 1 ] - ys[ 0 ] ) * i / ( ys.length - 1 );
		out.funicular.push( { bridge: w.tags.bridge === 'yes', pts: line.map( ( [ X, Y ], i ) => [ ...L( X, Y ), + ys[ i ].toFixed( 2 ) ] ) } );

	}

	console.log( `places: Petřín tower ${out.tower ? 'at ' + out.tower.x + ', ' + out.tower.z : 'missing'}, funicular ${out.funicular.length} ways` );
	return out;

}
