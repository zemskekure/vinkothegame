// A long pigeon flight across the map (docs/performance.md, Streaming by square): frame times, the squares coming
// in and how long each took to put in, the heap.
//
//   node tools/perf/flight.mjs <url> <out.json> [seconds 100] [cruise m/s 30] [x -1950] [z -300] [heading 1.571]
import { launch } from './browser.mjs';
import { writeFileSync } from 'node:fs';
const [ base, out, seconds = 100, speed = 30, x0 = -1950, z0 = -300, heading = 1.571 ] = process.argv.slice( 2 );
const browser = await launch();
const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
const errors = [];
page.on( 'pageerror', e => errors.push( e.message ) );
page.on( 'console', m => /pipeline|Pipeline|error/i.test( m.text() ) && errors.push( m.text().slice( 0, 200 ) ) );
await page.addInitScript( () => { window.__frameLog = []; window.__frameCost = []; } );
await page.goto( `${base}?holub&fps=1000`, { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( () => window.__ready, null, { timeout: 300000 } );
await page.waitForFunction( () => window.__complete !== false, null, { timeout: 300000 } );
await page.evaluate( ( [ x, z, h, speed ] ) => {
	const H = window.__debug.holub;
	H.tune.speed = speed;
	H.place( x, z, h );
	H.keys.add( 'Space' );
	setTimeout( () => H.keys.add( 'KeyW' ), 600 );
	setInterval( () => { H.keys.delete( 'Space' ); setTimeout( () => H.keys.add( 'Space' ), 300 ); }, 2500 );
	window.__track = [];
	window.__frameLog.length = 0; window.__frameCost.length = 0; window.__debug.squareLog.length = 0;
	setInterval( () => window.__track.push( [ Math.round( performance.now() ), Math.round( H.pos.x ), Math.round( H.pos.z ), Math.round( H.pos.y ), window.__debug.stream.live.size, window.__debug.stream.pending, Math.round( performance.memory.usedJSHeapSize / 1e6 ) ] ), 1000 );
}, [ Number( x0 ), Number( z0 ), Number( heading ), Number( speed ) ] );
await page.waitForTimeout( seconds * 1000 );
const r = await page.evaluate( () => {
	const ts = window.__frameLog, d = ts.slice( 1 ).map( ( t, i ) => t - ts[ i ] );
	return { d, cost: window.__frameCost, squares: window.__debug.squareLog, track: window.__track, calls: window.__frameInfo };
} );
const s = r.d.slice().sort( ( a, b ) => a - b ), q = p => s[ Math.floor( s.length * p ) ].toFixed( 1 );
const summary = { frames: s.length, avg: ( s.reduce( ( a, b ) => a + b, 0 ) / s.length ).toFixed( 1 ), p50: q( 0.5 ), p95: q( 0.95 ), p99: q( 0.99 ), max: s.at( -1 ).toFixed( 1 ), over20: ( s.filter( x => x > 20 ).length / s.length * 100 ).toFixed( 1 ) + '%', over50: s.filter( x => x > 50 ).length,
	squaresIn: r.squares.length, squareApply: r.squares.length ? { avg: ( r.squares.reduce( ( a, b ) => a + b[ 3 ], 0 ) / r.squares.length ).toFixed( 1 ), max: Math.max( ...r.squares.map( x => x[ 3 ] ) ) } : null, start: r.track[ 0 ], end: r.track.at( -1 ), heapMax: Math.max( ...r.track.map( t => t[ 6 ] ) ), errors: errors.slice( 0, 5 ) };
console.log( JSON.stringify( summary ) );
writeFileSync( out, JSON.stringify( { summary, ...r } ) );
await browser.close();
