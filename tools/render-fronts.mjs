// Rasterize checked, original SVG frontage drawings for the game texture loader. The SVGs remain the source;
// generated PNGs are ignored by git and rebuilt before Vite bundles the game.

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { validateShopfrontSvg } from './square-schema.mjs';

const ROOT = path.dirname( path.dirname( fileURLToPath( import.meta.url ) ) );
const source = path.join( ROOT, 'data/fronts' );
const output = path.join( ROOT, 'data/fronts-rendered' );
const scene = JSON.parse( await readFile( path.join( ROOT, 'public/data/scene.json' ) ) );
const fronts = ( scene.decor?.shopfronts || [] ).filter( f => f.file.endsWith( '.svg' ) );
await mkdir( output, { recursive: true } );
const wanted = new Set( fronts.map( f => f.file.replace( /\.svg$/, '.png' ) ) );
for ( const file of await readdir( output ) ) if ( file.endsWith( '.png' ) && ! wanted.has( file ) ) await rm( path.join( output, file ) );
if ( ! fronts.length ) process.exit( 0 );

const browser = await chromium.launch( { args: [ '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader' ] } );
try {

	const page = await browser.newPage();
	for ( const front of fronts ) {

		const svg = await readFile( path.join( source, front.file ), 'utf8' );
		const errors = validateShopfrontSvg( svg, { len: front.width } );
		if ( errors.length ) throw new Error( `${front.file}: ${errors.join( '; ' )}` );
		const png = await page.evaluate( async text => {

			const img = new Image();
			img.src = `data:image/svg+xml;base64,${btoa( unescape( encodeURIComponent( text ) ) )}`;
			await img.decode();
			const view = text.match( /viewBox="0 0 ([\d.]+) ([\d.]+)"/ );
			const width = Math.min( 4096, Math.max( 512, Math.round( Number( view[ 1 ] ) * 1.5 ) ) );
			const canvas = document.createElement( 'canvas' );
			canvas.width = width;
			canvas.height = Math.round( width * Number( view[ 2 ] ) / Number( view[ 1 ] ) );
			canvas.getContext( '2d' ).drawImage( img, 0, 0, canvas.width, canvas.height );
			return canvas.toDataURL( 'image/png' ).split( ',' )[ 1 ];

		}, svg );
		await writeFile( path.join( output, front.file.replace( /\.svg$/, '.png' ) ), Buffer.from( png, 'base64' ) );
		console.log( `rendered ${front.file}` );

	}

} finally {

	await browser.close();

}
