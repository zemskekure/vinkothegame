// A CPU profile of a running view (CDP Profiler): self time by function, top 40.
//
//   node tools/perf/profile.mjs <url> [seconds]

import { launch } from './browser.mjs';

const [ url, seconds = 5 ] = process.argv.slice( 2 );
const browser = await launch();
const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
await page.goto( url, { timeout: 600000 } );
await page.waitForFunction( () => window.__ready, null, { timeout: 600000 } );
await page.waitForFunction( () => window.__complete !== false, null, { timeout: 600000 } );
if ( process.env.FLY ) await page.evaluate( fly => {

	const [ x, z, heading ] = fly.split( ',' ).map( Number ), h = window.__debug.holub;
	h.place( x, z, heading );
	h.keys.add( 'Space' );
	setTimeout( () => h.keys.add( 'KeyW' ), 600 );

}, process.env.FLY );
await page.waitForTimeout( 6000 );
const cdp = await page.context().newCDPSession( page );
await cdp.send( 'Profiler.enable' );
await cdp.send( 'Profiler.setSamplingInterval', { interval: 200 } );
await cdp.send( 'Profiler.start' );
await page.waitForTimeout( seconds * 1000 );
const { profile } = await cdp.send( 'Profiler.stop' );
const self = new Map(), byId = new Map( profile.nodes.map( n => [ n.id, n ] ) );
const dt = profile.timeDeltas;
const counts = new Map();
profile.samples.forEach( ( id, i ) => counts.set( id, ( counts.get( id ) || 0 ) + ( dt[ i ] || 0 ) ) );
let total = 0;
for ( const [ id, t ] of counts ) {

	const n = byId.get( id ), f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split( '/' ).pop()}:${f.lineNumber}`;
	self.set( key, ( self.get( key ) || 0 ) + t );
	total += t;

}

console.log( `total ${( total / 1000 ).toFixed( 0 )} ms` );
console.log( [ ...self ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 40 ).map( ( [ k, t ] ) => `${( t / total * 100 ).toFixed( 1 ).padStart( 5 )}%  ${k}` ).join( '\n' ) );
await browser.close();
