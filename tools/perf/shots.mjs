// Screenshots of several views in one headless browser, for before/after comparisons.
//
//   node tools/perf/shots.mjs <base url> <out prefix> <name>=<query> …

import { launch } from './browser.mjs';

const [ base, prefix, ...views ] = process.argv.slice( 2 );
const browser = await launch();
for ( const view of views ) {

	const [ name, query ] = view.split( /=(.*)/ );
	const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
	const errors = [];
	page.on( 'console', m => m.type() === 'error' && ! m.text().includes( '404' ) && errors.push( m.text().slice( 0, 200 ) ) );
	page.on( 'pageerror', e => errors.push( e.message.slice( 0, 200 ) ) );
	await page.goto( `${base}?${query}`, { timeout: 600000 } );
	await page.waitForFunction( () => window.__ready, null, { timeout: 600000 } );
	await page.waitForFunction( () => window.__complete !== false, null, { timeout: 60000 } ).catch( () => {} );
	await page.waitForTimeout( 6000 );
	await page.screenshot( { path: `${prefix}${name}.png` } );
	console.log( name, errors.length ? errors.join( ' | ' ) : 'ok' );
	await page.close();

}

await browser.close();
