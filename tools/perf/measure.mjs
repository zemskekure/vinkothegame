// Load and frame-time measurements of a served build in real Chrome (WebGPU), for docs/performance.md.
//
//   node tools/perf/measure.mjs <base url> <label> [load|views|all] [shots dir]
//
// load: a cold load (from START, or the AT environment variable: the bare URL stops at the start screen now) with
// the network throttled to the Cloudflare tunnel's ~1.5 MB/s (bytes over the wire, time to
// window.__ready, JS heap), then a repeat visit in the same browser. views: frame times (from the game's own
// rendered frames, the cap lifted with ?fps=240), draw calls and triangles in the busy views, plus a screenshot.

import { launch } from './browser.mjs';

const [ base, label, what = 'all', shots ] = process.argv.slice( 2 );

// Where the load test starts: the game's own start on Betlémské náměstí (src/main.js startAt).
const START = process.env.AT ? `at=${process.env.AT}` : 'at=-78,68,-1.152';

const VIEWS = {
	start: START,
	narodni: 'at=-250,329,-1.571',
	betlem: 'at=-20,70,1.571',
	malastrana: 'overview&view=-650,260,250,-1100,0,-250',
	overview: 'overview',
	holub: 'holub',
	river: 'holub&fly=-420,250,0',
	karluv: 'at=-470,-270,1.2',
	petrin: 'overview&view=-1560,190,-60,-1637,165,-88',
	// Prague 1 beyond the Old Town (streamed squares far from the first area).
	hradcany: 'at=-1503,-742,-1.9',
	wenceslas: 'at=541.66,429.72,-2.35',
	prikope: 'at=610,-52,-0.95',
	castle: 'overview&view=-1018,305,-672,-1148,65,-842'
};

let shared;
const browserOnce = async () => shared ||= await launch();

function watch( page, log ) {

	page.on( 'pageerror', e => log.push( 'PAGEERROR ' + e.message.slice( 0, 200 ) ) );
	page.on( 'console', m => ( m.type() === 'error' || /pipeline|Pipeline/.test( m.text() ) ) && log.push( m.type() + ' ' + m.text().slice( 0, 200 ) ) );

}

async function loadTest() {

	const browser = await browserOnce();
	const ctx = await browser.newContext( { viewport: { width: 1280, height: 800 } } );
	const page = await ctx.newPage();
	const cdp = await ctx.newCDPSession( page );
	await cdp.send( 'Network.enable' );
	// Throttled here unless the server does it (tools/perf/serve.mjs RATE=…, which also slows the workers' downloads).
	if ( ! process.env.FAST && ! process.env.SERVER_RATE ) await cdp.send( 'Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1.5e6, uploadThroughput: 0.5e6 } );
	const out = {};
	for ( const visit of [ 'cold', 'repeat' ] ) {

		let bytes = 0, requests = 0;
		const big = [];
		const urls = new Map(), perUrl = new Map();
		const onResp = e => urls.set( e.requestId, e.response.url.replace( base, '' ) );
		cdp.on( 'Network.responseReceived', onResp );
		const onDone = e => {

			bytes += e.encodedDataLength;
			perUrl.set( urls.get( e.requestId ), e.encodedDataLength );
			requests ++;

		};
		cdp.on( 'Network.loadingFinished', onDone );
		const log = [];
		watch( page, log );
		const served = async () => {

			const r = await fetch( `${base}__bytes` ).catch( () => null );
			return r?.ok ? Number( await r.text() ) : NaN;

		};
		const served0 = await served();
		const t0 = Date.now();
		await page.goto( `${base}?${START}`, { timeout: 600000, waitUntil: 'domcontentloaded' } );
		const ok = await page.waitForFunction( () => window.__ready, null, { timeout: 600000, polling: 100 } ).then( () => true, () => false );
		const ready = ( Date.now() - t0 ) / 1000;
		// What the server sent (workers' downloads too, which the page's network events don't see), else the page's.
		const servedAtReady = await served() - served0;
		const bytesAtReady = Number.isFinite( servedAtReady ) ? servedAtReady : bytes;
		// Everything streamed in after the city (people, trams, boats): window.__complete.
		await page.waitForFunction( () => window.__complete !== false, null, { timeout: 600000, polling: 100 } ).catch( () => {} );
		const complete = ( Date.now() - t0 ) / 1000;
		await page.waitForTimeout( visit === 'cold' ? 15000 : 3000 );
		const heap = await page.evaluate( () => performance.memory ? Math.round( performance.memory.usedJSHeapSize / 1e6 ) : null );
		await cdp.send( 'HeapProfiler.collectGarbage' ).catch( () => {} );
		const heapGC = await page.evaluate( () => performance.memory ? Math.round( performance.memory.usedJSHeapSize / 1e6 ) : null );
		cdp.off( 'Network.loadingFinished', onDone );
		cdp.off( 'Network.responseReceived', onResp );
		console.log( [ ...perUrl ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 25 ).map( ( [ u, b ] ) => `  ${( b / 1e6 ).toFixed( 2 )} MB ${u}` ).join( '\n' ) );
		const servedTotal = await served() - served0;
		out[ visit ] = { ok, ready: + ready.toFixed( 1 ), complete: + complete.toFixed( 1 ), mbAtReady: + ( bytesAtReady / 1e6 ).toFixed( 2 ), mbTotal: + ( ( Number.isFinite( servedTotal ) ? servedTotal : bytes ) / 1e6 ).toFixed( 2 ), requests, heap, heapGC, errors: log.slice( 0, 5 ) };
		console.log( label, visit, JSON.stringify( out[ visit ] ) );

	}

	await ctx.close();
	return out;

}

async function viewTest( name ) {

	const browser = await browserOnce();
	const ctx = await browser.newContext( { viewport: { width: 1440, height: 900 } } );
	const page = await ctx.newPage();
	const log = [];
	watch( page, log );
	await page.addInitScript( () => {

		window.__frameLog = [];
		window.__frameCost = [];

	} );
	const q = VIEWS[ name ];
	const fly = /fly=([-\d.,]+)/.exec( q );
	// With the frame cap lifted (?fps=1000): how long a frame takes, the headroom under the game's 60 a second.
	// (Headless Chrome's animation frames don't tick at a display's rate, so a capped run measures the ticks.)
	const url = base + '?fps=1000' + ( q ? '&' + q.replace( /&?fly=[-\d.,]+/, '' ) : '' );
	await page.goto( url, { timeout: 600000, waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__ready, null, { timeout: 600000 } );
	await page.waitForFunction( () => window.__complete !== false, null, { timeout: 600000 } );
	if ( fly ) {

		const [ x, z, heading ] = fly[ 1 ].split( ',' ).map( Number );
		await page.evaluate( ( [ x, z, heading ] ) => {

			const h = window.__debug.holub;
			h.place( x, z, heading );
			h.keys.add( 'Space' );
			setTimeout( () => h.keys.add( 'KeyW' ), 600 );
			setInterval( () => {

				h.keys.delete( 'Space' );
				setTimeout( () => h.keys.add( 'Space' ), 300 );

			}, 2500 );

		}, [ x, z, heading ] );

	}

	await page.waitForTimeout( 5000 );
	const stats = seconds => page.evaluate( seconds => new Promise( res => {

		window.__frameLog.length = 0;
		window.__frameCost.length = 0;
		let calls = 0, tris = 0, n = 0;
		const sample = setInterval( () => {

			if ( ! window.__frameInfo ) return;
			calls += window.__frameInfo[ 0 ];
			tris += window.__frameInfo[ 1 ];
			n ++;

		}, 250 );
		setTimeout( () => {

			clearInterval( sample );
			const ts = window.__frameLog;
			const d = ts.slice( 1 ).map( ( t, i ) => t - ts[ i ] ).sort( ( a, b ) => a - b );
			const c = window.__frameCost.slice().sort( ( a, b ) => a - b );
			const avg = a => a.reduce( ( x, y ) => x + y, 0 ) / a.length;
			res( { frames: d.length, avg: + avg( d ).toFixed( 1 ), p50: + d[ d.length >> 1 ].toFixed( 1 ), p95: + d[ Math.floor( d.length * 0.95 ) ].toFixed( 1 ), max: + d[ d.length - 1 ].toFixed( 1 ), over20: + ( d.filter( x => x > 20 ).length / d.length * 100 ).toFixed( 1 ),
				cpu: c.length ? + avg( c ).toFixed( 1 ) : null, cpu95: c.length ? + c[ Math.floor( c.length * 0.95 ) ].toFixed( 1 ) : null,
				calls: n ? Math.round( calls / n ) : null, ktris: n ? Math.round( tris / n / 1000 ) : null, heap: performance.memory ? Math.round( performance.memory.usedJSHeapSize / 1e6 ) : null } );

		}, seconds * 1000 );

	} ), seconds );
	const r = await stats( 8 );

	r.errors = log.slice( 0, 5 );
	console.log( label, name, JSON.stringify( r ) );
	if ( shots ) await page.screenshot( { path: `${shots}/${label}-${name}.png` } );
	await ctx.close();
	return r;

}

const results = { label };
if ( what === 'load' || what === 'all' ) results.load = await loadTest();
if ( what !== 'load' ) {

	results.views = {};
	const names = what === 'all' || what === 'views' ? Object.keys( VIEWS ) : what.split( ',' );
	for ( const name of names ) results.views[ name ] = await viewTest( name );

}

console.log( JSON.stringify( results ) );
await shared?.close();
