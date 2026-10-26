// The loading screen: one bar that fills through everything that happens before play, with the step's name small
// under it. The download (from the start screen's preload, src/start.js, or the game's own, src/main.js) takes the
// first share; the game's build steps (src/main.js) each take theirs. Inside a step without a natural measure the
// bar still creeps on towards the step's end, and a stripe runs along it on the compositor, so it moves even while
// the page is busy building.

import { FONT, GAME_TITLE, titleCanvas, useBaseStyle } from './ui.js';

const STYLE = `
	#loading { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: #10141a; color: #f4ecd2; overflow: hidden; user-select: none; }
	#loading .box { position: relative; display: flex; flex-direction: column; align-items: center; width: min(86vw, 520px); }
	#loading .title { width: min(60vw, 300px); height: auto; image-rendering: pixelated; filter: drop-shadow(0 4px 0 rgba(0,0,0,0.45)); margin-bottom: 26px; }
	#loading .bar { position: relative; width: 100%; height: 22px; box-sizing: border-box; border: 3px solid #000; background: #232a38; overflow: hidden;
		box-shadow: 0 0 0 2px #f4ecd2, 0 0 0 5px #000, 6px 6px 0 4px rgba(0,0,0,0.45); }
	#loading .fill { position: absolute; inset: 0; transform-origin: 0 50%; transform: scaleX(0); transition: transform 0.25s linear;
		background: linear-gradient(to bottom, #fff3a8, #ffd34a 45%, #e8892c 55%, #c4562f); }
	#loading .run { position: absolute; inset: 0 -40px 0 0; opacity: 0.35; animation: loading-run 0.6s linear infinite;
		background: repeating-linear-gradient(-60deg, rgba(0,0,0,0.6) 0 8px, transparent 8px 20px); }
	@keyframes loading-run { to { transform: translateX(-23.1px); } }
	#loading .row { display: flex; justify-content: space-between; width: 100%; margin-top: 12px; font: 16px/1.2 ${FONT}; text-shadow: 2px 2px 0 #000; }
	#loading .pct { color: #ffd34a; }
`;

// The first files the game needs (src/main.js): the city's index, the coarse heights, the map, the first area's ground
// detail; the start screen preloads the same ones. The squares of the city stream in after them (src/stream.js).
export const DATA = [ 'scene.json', 'heights.bin', 'map.png', 'ground-detail.jpg' ];
// The download's share of the bar.
const DOWNLOAD = 0.12;

const files = new Map();
let el = null, fill, label, pct, timer = 0;
let from = 0, to = DOWNLOAD, target = 0, shown = 0, inDownload = true;

function build() {

	if ( el ) return;
	el = document.getElementById( 'loading' );
	if ( ! el ) return;
	useBaseStyle();
	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.appendChild( style );
	el.innerHTML = `<div class="box"><div class="bar"><div class="fill"></div><div class="run"></div></div>
		<div class="row"><span class="label"></span><span class="pct"></span></div></div><div class="ui-scan"></div>`;
	el.querySelector( '.box' ).prepend( titleCanvas( GAME_TITLE ) );
	fill = el.querySelector( '.fill' );
	label = el.querySelector( '.label' );
	pct = el.querySelector( '.pct' );
	label.textContent = 'Stahuji město';
	timer = setInterval( tick, 100 );

}

// Each tick the bar moves towards where the step got, and creeps on a little towards the step's end however long
// the step takes (it never reaches it before the step says so).
function tick() {

	if ( ! el?.isConnected ) return clearInterval( timer );
	if ( inDownload ) target = Math.max( target, DOWNLOAD * downloaded() );
	target += ( to - 0.004 - target ) * 0.012;
	shown += ( Math.max( shown, target ) - shown ) * 0.5;
	draw();

}

function draw() {

	fill.style.transform = `scaleX(${shown.toFixed( 4 )})`;
	pct.textContent = `${Math.floor( shown * 100 )} %`;

}

function downloaded() {

	let sum = 0;
	for ( const name of DATA ) sum += files.get( name ) || 0;
	return sum / DATA.length;

}

// How far one of the first files got (0…1), from whoever downloads it.
export function fileProgress( name, f ) {

	build();
	files.set( name, Math.max( files.get( name ) || 0, f ) );

}

// A build step from `a` to `b` (shares of the whole bar) begins; the page gets a moment to show it.
export function step( name, a, b ) {

	build();
	if ( ! el ) return Promise.resolve();
	inDownload = false;
	from = a;
	to = b;
	target = Math.max( target, a );
	shown = Math.max( shown, a );
	label.textContent = name;
	draw();
	return paint();

}

// How far the current step got (0…1).
export function stepProgress( f ) {

	if ( ! el ) return;
	target = Math.max( target, from + ( to - from ) * Math.min( 1, f ) );

}

// A sub-step of the current step: progress, and a moment for the page to show it.
export function sub( f ) {

	stepProgress( f );
	if ( el ) {

		shown = Math.max( shown, target );
		draw();

	}

	return paint();

}

// The bar full, then the screen away.
export function done() {

	build();
	if ( ! el ) return;
	shown = 1;
	draw();
	clearInterval( timer );
	const gone = el;
	el = null;
	setTimeout( () => gone.remove(), 150 );

}

// Plain text in place of the bar (the studio).
export function message( text ) {

	build();
	if ( label ) label.textContent = text;

}

export function show() {

	build();

}

// Lets the browser draw a frame (a timeout, too, for a tab in the background, where frames wait).
function paint() {

	return new Promise( resolve => {

		let settled = false;
		const go = () => {

			if ( settled ) return;
			settled = true;
			resolve();

		};

		requestAnimationFrame( () => setTimeout( go, 0 ) );
		setTimeout( go, 60 );

	} );

}
