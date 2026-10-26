// Downloads OpenStreetMap data (© OpenStreetMap contributors, ODbL) for the play area into data/raw/osm.json:
// street layout, pavements, steps, trees, benches, lamps, bollards, shops… Run with NODE_USE_ENV_PROXY=1 behind a proxy.
// The area is split into tiles to stay under the API's per-request node limit; elements are merged by id.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

// The play area (tools/area.mjs) with a margin, in WGS 84.
const BBOX = { west: 14.3895, south: 50.0740, east: 14.4245, north: 50.0915 };
const TILES = 5;

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

const OUT = new URL( '../data/raw/osm.json', import.meta.url );
await mkdir( new URL( '../data/raw/', import.meta.url ), { recursive: true } );
// In a fixed order, whatever the tiling: the build joins streets in file order (tools/kerbs.mjs), so a different
// order measures some kerbs a little differently. Elements already in an earlier download keep their place in it
// (a re-fetch, or a bigger area, leaves the modelled streets as they were); new ones follow, as nodes, ways and
// relations, each by id.
const RANK = { node: 0, way: 1, relation: 2 };
const before = new Map();
try {

	JSON.parse( await readFile( OUT ) ).forEach( ( e, i ) => before.set( `${e.type}/${e.id}`, i ) );

} catch { /* first download */ }

const sorted = [ ...elements.entries() ].sort( ( [ ka, a ], [ kb, b ] ) => ( before.get( ka ) ?? Infinity ) - ( before.get( kb ) ?? Infinity ) || RANK[ a.type ] - RANK[ b.type ] || a.id - b.id ).map( ( [ , e ] ) => e );
await writeFile( OUT, JSON.stringify( sorted ) );
console.log( `osm: ${elements.size} elements` );
