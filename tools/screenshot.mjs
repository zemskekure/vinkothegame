// Renders the running dev server in headless Chromium and saves screenshots.
// Usage: node tools/screenshot.mjs <url> <out.png> [more url/out pairs…]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice( 2 );
// The Linux container has its own Chromium and no GPU; elsewhere (macOS) Playwright's bundled browser and the GPU.
const linux = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const browser = await chromium.launch( existsSync( linux ) ? {
	executablePath: linux,
	args: [ '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ]
} : { args: [ '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
page.on( 'console', m => console.log( '[page]', m.type(), m.text() ) );
page.on( 'pageerror', e => console.log( '[pageerror]', e.message ) );

for ( let i = 0; i < args.length; i += 2 ) {

	await page.goto( args[ i ] );
	await page.waitForFunction( () => window.__ready, null, { timeout: 240000 } );
	await page.waitForTimeout( 4000 );
	await page.screenshot( { path: args[ i + 1 ], timeout: 180000 } );
	console.log( 'saved', args[ i + 1 ] );

}

await browser.close();
