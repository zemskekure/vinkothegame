// Frame-time experiments: load one view, then switch things off one at a time (snippets run in the page with
// `d` = window.__debug) and measure each for a few seconds. For finding where the frame time goes.
//
//   node tools/perf/lab.mjs <url> <experiments.json>

import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';

const [ url, file ] = process.argv.slice( 2 );
const experiments = JSON.parse( readFileSync( file, 'utf8' ) );
const browser = await launch();
const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
page.on( 'console', m => m.type() === 'error' && console.log( 'console', m.text().slice( 0, 6000 ) ) );
await page.addInitScript( () => window.__frameLog = [] );
await page.goto( url, { timeout: 600000 } );
await page.waitForFunction( () => window.__ready, null, { timeout: 600000 } );
await page.waitForTimeout( 6000 );
const measure = () => page.evaluate( () => new Promise( res => {

	window.__frameLog.length = 0;
	setTimeout( () => {

		const ts = window.__frameLog, d = ts.slice( 1 ).map( ( t, i ) => t - ts[ i ] ).sort( ( a, b ) => a - b );
		const info = window.__debug.renderer.info.render;
		res( `avg ${( d.reduce( ( a, b ) => a + b, 0 ) / d.length ).toFixed( 1 )} p50 ${d[ d.length >> 1 ].toFixed( 1 )} p95 ${d[ Math.floor( d.length * 0.95 ) ].toFixed( 1 )} calls ${window.__frameInfo[ 0 ]} ktris ${( window.__frameInfo[ 1 ] / 1000 ).toFixed( 0 )}` );

	}, 4000 );

} ) );
for ( const [ name, code ] of experiments ) {

	if ( code ) await page.evaluate( `{ const d = window.__debug; ${code} }` );
	await page.waitForTimeout( 1000 );
	console.log( name.padEnd( 28 ), await measure() );

}

await browser.close();
