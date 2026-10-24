// Packs the built app (dist/) for hosting as a claude.ai artifact, which serves no raw binary files:
// every binary data file is gzipped and base64-encoded (images are copied as they are) into artifact/data/<name>.gz.txt; the page sets
// window.PACKED_DATA so src/main.js unpacks them in the browser.

import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const DIST = new URL( '../dist/', import.meta.url );
const OUT = new URL( '../artifact/', import.meta.url );

await mkdir( new URL( 'data/', OUT ), { recursive: true } );
await mkdir( new URL( 'assets/', OUT ), { recursive: true } );
await copyFile( new URL( 'assets/app.js', DIST ), new URL( 'assets/app.js', OUT ) );

for ( const name of await readdir( new URL( 'data/', DIST ) ) ) {

	if ( name.endsWith( '.jpg' ) ) {

		// Images are served as they are.
		await copyFile( new URL( `data/${name}`, DIST ), new URL( `data/${name}`, OUT ) );
		continue;

	}

	const raw = await readFile( new URL( `data/${name}`, DIST ) );
	const packed = gzipSync( raw, { level: 9 } ).toString( 'base64' );
	await writeFile( new URL( `data/${name}.gz.txt`, OUT ), packed );
	console.log( `${name}: ${( raw.length / 1e6 ).toFixed( 1 )} MB → ${( packed.length / 1e6 ).toFixed( 1 )} MB` );

}

// Models (public/models): .glb packed like the data, textures and licences copied.
const MODELS = new URL( 'models/', DIST );
for ( const dir of await readdir( MODELS ) ) {

	await mkdir( new URL( `models/${dir}/Textures/`, OUT ), { recursive: true } );
	for ( const name of await readdir( new URL( `${dir}/`, MODELS ) ) ) {

		const src = new URL( `${dir}/${name}`, MODELS );
		if ( name === 'Textures' ) {

			for ( const tex of await readdir( new URL( `${dir}/Textures/`, MODELS ) ) ) await copyFile( new URL( `${dir}/Textures/${tex}`, MODELS ), new URL( `models/${dir}/Textures/${tex}`, OUT ) );

		} else if ( name.endsWith( '.glb' ) ) {

			await writeFile( new URL( `models/${dir}/${name}.gz.txt`, OUT ), gzipSync( await readFile( src ), { level: 9 } ).toString( 'base64' ) );

		} else await copyFile( src, new URL( `models/${dir}/${name}`, OUT ) );

	}

}
