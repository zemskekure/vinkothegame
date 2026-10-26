// Where the JS heap goes: a sampling heap profile from the page's start to some seconds after it is up, live memory
// by allocating function (self, top 30).
//
//   node tools/perf/heap.mjs <url> [seconds after ready]

import { launch } from './browser.mjs';

const [ url, seconds = 8 ] = process.argv.slice( 2 );
const browser = await launch();
const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
const cdp = await page.context().newCDPSession( page );
await cdp.send( 'HeapProfiler.enable' );
await cdp.send( 'HeapProfiler.startSampling', { samplingInterval: 16384 } );
await page.goto( url, { timeout: 600000 } );
await page.waitForFunction( () => window.__ready, null, { timeout: 600000 } );
await page.waitForTimeout( seconds * 1000 );
await cdp.send( 'HeapProfiler.collectGarbage' );
const { profile } = await cdp.send( 'HeapProfiler.getSamplingProfile' );
const self = new Map();
let total = 0;
const walk = ( node, stack ) => {

	const f = node.callFrame, name = `${f.functionName || '(anon)'} ${f.url.split( '/' ).pop()}:${f.lineNumber}`;
	if ( node.selfSize ) {

		const key = `${name}  <  ${stack.slice( - 2 ).join( ' < ' )}`;
		self.set( key, ( self.get( key ) || 0 ) + node.selfSize );
		total += node.selfSize;

	}

	for ( const c of node.children ) walk( c, [ ...stack, name ] );

};
walk( profile.head, [] );
console.log( `sampled live ${( total / 1e6 ).toFixed( 0 )} MB, heap used ${await page.evaluate( () => Math.round( performance.memory.usedJSHeapSize / 1e6 ) )} MB` );
console.log( [ ...self ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 30 ).map( ( [ k, v ] ) => `${( v / 1e6 ).toFixed( 1 ).padStart( 6 )} MB  ${k}` ).join( '\n' ) );
await browser.close();
