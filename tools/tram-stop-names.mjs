// The tram stops' names for the game (src/tram-stops.json): every OpenStreetMap tram stop (railway=tram_stop, or a
// tram stop_position) in data/raw/osm.json with its name, in the scene frame. The trams (src/trams.js) name each stop
// of a route after the nearest of them, for the "Příští zastávka" board when one rides.
//
//   node tools/tram-stop-names.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { lonLatToSJTSK } from './geo.mjs';
import { ORIGIN } from './area.mjs';

const osm = JSON.parse( await readFile( new URL( '../data/raw/osm.json', import.meta.url ) ) );
const project = await lonLatToSJTSK();
const out = [];
for ( const n of osm.elements || osm ) {

	const t = n.tags;
	if ( n.type !== 'node' || ! t?.name ) continue;
	if ( t.railway !== 'tram_stop' && ! ( t.public_transport === 'stop_position' && t.tram === 'yes' ) ) continue;
	const [ X, Y ] = project( n.lon, n.lat );
	out.push( [ t.name, + ( X - ORIGIN.x ).toFixed( 1 ), + ( - ( Y - ORIGIN.y ) ).toFixed( 1 ) ] );

}

await writeFile( new URL( '../src/tram-stops.json', import.meta.url ), JSON.stringify( out ) + '\n' );
console.log( `tram stops: ${out.length} named` );
