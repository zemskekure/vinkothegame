// Packs the built app (dist/) for hosting as a claude.ai artifact, which serves no raw binary files:
// every data file is gzipped and base64-encoded into artifact/data/<name>.gz.txt; the page sets
// window.PACKED_DATA so src/main.js unpacks them in the browser.

import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const DIST = new URL( '../dist/', import.meta.url );
const OUT = new URL( '../artifact/', import.meta.url );

await mkdir( new URL( 'data/', OUT ), { recursive: true } );
await mkdir( new URL( 'assets/', OUT ), { recursive: true } );
await copyFile( new URL( 'assets/app.js', DIST ), new URL( 'assets/app.js', OUT ) );

for ( const name of await readdir( new URL( 'data/', DIST ) ) ) {

	const raw = await readFile( new URL( `data/${name}`, DIST ) );
	const packed = gzipSync( raw, { level: 9 } ).toString( 'base64' );
	await writeFile( new URL( `data/${name}.gz.txt`, OUT ), packed );
	console.log( `${name}: ${( raw.length / 1e6 ).toFixed( 1 )} MB → ${( packed.length / 1e6 ).toFixed( 1 )} MB` );

}
