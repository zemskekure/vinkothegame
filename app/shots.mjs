// Screenshots of the game in headless Chromium (Playwright's bundled browser, WebGL 2). One page load per batch:
// the scene is ~90 MB, so the camera is moved in place between shots instead of reloading.

import { chromium } from 'playwright';

const HIDE = 'body > *:not(canvas) { display: none !important; }';

// shots: [ { file, kind: 'overview' | 'top' | 'street', cell } ], cell = { x0, z0, x1, z1, views }
export async function takeShots( baseURL, shots, { auth, log = () => {} } = {} ) {

	const browser = await chromium.launch( { args: [ '--ignore-gpu-blocklist' ] } );
	try {

		const context = await browser.newContext( { viewport: { width: 1280, height: 800 }, httpCredentials: auth ? { username: 'grid', password: auth } : undefined } );
		const page = await context.newPage();
		page.on( 'pageerror', e => log( `[page] ${e.message}` ) );
		await page.goto( `${baseURL}?webgl&overview`, { timeout: 120000 } );
		await page.waitForFunction( () => window.__ready, null, { timeout: 240000 } );
		await page.addStyleTag( { content: HIDE } );
		await page.waitForTimeout( 3000 );
		let walking = false;

		for ( const s of shots ) {

			const { x0, z0, x1, z1 } = s.cell;
			const cx = ( x0 + x1 ) / 2, cz = ( z0 + z1 ) / 2;

			if ( s.kind === 'street' ) {

				if ( ! s.cell.views.at ) continue;
				await page.setViewportSize( { width: 1280, height: 800 } );
				if ( ! walking ) await page.keyboard.press( 'KeyM' );
				walking = true;
				const [ x, z, yaw ] = s.cell.views.at.split( ',' ).map( Number );
				await page.evaluate( ( [ x, z, yaw ] ) => window.__debug.walker.teleport( x, z, yaw ), [ x, z, yaw ] );

			} else {

				if ( walking ) await page.keyboard.press( 'KeyM' );
				walking = false;
				// From straight above, a square image just covering the cell (vertical field of view 60°);
				// or the oblique overview the cell page opens with.
				const top = s.kind === 'top';
				await page.setViewportSize( top ? { width: 640, height: 640 } : { width: 1280, height: 800 } );
				await page.evaluate( ( [ top, cx, cz, half, view ] ) => {

					const { camera, orbit, groundHeight } = window.__debug;
					if ( top ) {

						const g = groundHeight( cx, cz ) || 0;
						camera.position.set( cx, g + half / Math.tan( Math.PI / 6 ), cz + 0.01 );
						orbit.target.set( cx, g, cz );

					} else {

						const [ x, y, z, tx, ty, tz ] = view.split( ',' ).map( Number );
						camera.position.set( x, y, z );
						orbit.target.set( tx, ty, tz );

					}

					orbit.update();

				}, [ top, cx, cz, Math.max( x1 - x0, z1 - z0 ) / 2, s.cell.views.overview ] );

			}

			await page.waitForTimeout( s.kind === 'street' ? 2500 : 1500 );
			await page.screenshot( { path: s.file, type: 'jpeg', quality: 82 } );

		}

	} finally {

		await browser.close();

	}

}
