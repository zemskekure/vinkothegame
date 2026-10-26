// The browser the measurements run in: the installed Google Chrome, headless (new headless mode, so no window shows
// up on the desktop), with WebGPU on and the frame-rate limits off.

import { chromium } from '/Users/jancervenka/Documents/ChatGPT/PRAGA/vinkothegame/node_modules/playwright/index.mjs';

export const ARGS = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
	'--disable-background-timer-throttling', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info' ];

export function launch() {

	return chromium.launch( { channel: 'chrome', headless: true, args: ARGS } );

}

// Whether the page has a real WebGPU adapter.
export function hasWebGPU( page ) {

	return page.evaluate( async () => !! ( navigator.gpu && await navigator.gpu.requestAdapter() ) );

}
