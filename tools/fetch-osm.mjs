// Downloads OpenStreetMap data (© OpenStreetMap contributors, ODbL) for the play area into data/raw/osm.json:
// street layout, pavements, steps, trees, benches, lamps, bollards, shops… Run with NODE_USE_ENV_PROXY=1 behind a proxy.
// The area is split into tiles to stay under the API's per-request node limit; elements are merged by id.

import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = { west: 14.4080, south: 50.0757, east: 14.4245, north: 50.0875 };
const TILES = 3;

const elements = new Map();
const dx = ( BBOX.east - BBOX.west ) / TILES, dy = ( BBOX.north - BBOX.south ) / TILES;

for ( let i = 0; i < TILES; i ++ ) {

	for ( let j = 0; j < TILES; j ++ ) {

		const bbox = [ BBOX.west + i * dx, BBOX.south + j * dy, BBOX.west + ( i + 1 ) * dx, BBOX.south + ( j + 1 ) * dy ].map( v => v.toFixed( 6 ) ).join( ',' );
		for ( let attempt = 0; ; attempt ++ ) {

			const res = await fetch( `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, { headers: { 'User-Agent': 'vinkothegame/0.1 (Prague Old Town 3D model)' } } );
			if ( res.ok ) {

				for ( const el of ( await res.json() ).elements ) elements.set( `${el.type}/${el.id}`, el );
				break;

			}

			if ( attempt >= 3 ) throw new Error( `OSM ${bbox}: ${res.status} ${await res.text()}` );
			await new Promise( r => setTimeout( r, 3000 * 2 ** attempt ) );

		}

	}

}

await mkdir( new URL( '../data/raw/', import.meta.url ), { recursive: true } );
await writeFile( new URL( '../data/raw/osm.json', import.meta.url ), JSON.stringify( [ ...elements.values() ] ) );
console.log( `osm: ${elements.size} elements` );
