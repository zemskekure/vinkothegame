// The in-game HUD, in the start screen's late-90s console style (src/ui.js): nothing permanent on screen but the
// minimap (src/minimap.js) and what the mode needs (the scooter's speedometer, the pigeon's tally).
//   - The street's name comes in big and italic when you enter a new street, as an area title, and goes again.
//   - The controls as key caps, for a few seconds at the start and on H (and in the pause menu, "Ovládání").
//   - Messages for the courier come on a pager.
//   - Near a tram at a stop, a key prompt ("[E] nastoupit") low in the middle; in the tram, the line and the next
//     stop on a board like the trams' own (amber dots on black).
//   - Esc (or the MENU button on a touch screen) opens the pause menu, which also holds the credits and the build.
// One HUD a page: `getHud()`.

import { FONT, VERSION, useBaseStyle, choose, titleCanvas, showCredits } from './ui.js';

const STYLE = `
	#hud-area { position: fixed; right: 26px; bottom: 112px; z-index: 3; text-align: right; pointer-events: none; opacity: 0; max-width: calc(100vw - 52px); }
	#hud-area .name { font: 700 48px/1.05 ${FONT}; color: #ffd34a; text-shadow: -2px 0 #000, 2px 0 #000, 0 -2px #000, 0 2px #000, -2px -2px #000, 2px -2px #000, -2px 2px #000, 2px 2px #000, 5px 5px 0 #000; }
	#hud-area .quarter { font: 16px/1.2 ${FONT}; color: #f4ecd2; letter-spacing: 0.18em; text-transform: uppercase; text-shadow: 2px 2px 0 #000; margin-bottom: 2px; }
	#hud-area.in { animation: hud-area 5s steps(30, end) forwards; }
	@keyframes hud-area { 0% { opacity: 0; transform: translateX(40px); } 8% { opacity: 1; transform: none; } 80% { opacity: 1; transform: none; } 100% { opacity: 0; transform: none; } }
	#hud-keys { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 3; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px;
		width: max-content; max-width: calc(100vw - 32px); padding: 8px 12px; box-sizing: border-box; pointer-events: none; transition: opacity 0.6s; opacity: 0;
		font: 16px/1.6 ${FONT}; color: #f4ecd2; text-shadow: 2px 2px 0 #000; }
	#hud-keys.on { opacity: 1; }
	#hud-keys > span { white-space: nowrap; }
	#hud-speed { position: fixed; right: 18px; bottom: 18px; z-index: 3; display: none; padding: 6px 10px 8px; min-width: 132px; box-sizing: border-box; pointer-events: none; text-align: right; }
	#hud-speed.on { display: block; }
	#hud-speed b { font: 700 48px/1 ${FONT}; color: #ffd34a; text-shadow: 3px 3px 0 #000; }
	#hud-speed small { font: 16px ${FONT}; margin-left: 4px; text-shadow: 2px 2px 0 #000; }
	#hud-speed .seg { display: flex; gap: 2px; margin-top: 5px; }
	#hud-speed .seg i { flex: 1; height: 7px; background: #2a3242; border: 1px solid #000; }
	#hud-speed .seg i.lit { background: #ffd34a; }
	#hud-speed .seg i.lit.hot { background: #c4562f; }
	#hud-pager { position: fixed; left: 50%; top: 16px; z-index: 6; transform: translate(-50%, -140%); transition: transform 0.35s steps(6, end); pointer-events: none;
		width: min(86vw, 340px); padding: 8px 10px 10px; box-sizing: border-box; background: #2b2f36; border: 3px solid #000; border-radius: 4px;
		box-shadow: inset -3px -3px 0 rgba(0,0,0,0.45), inset 3px 3px 0 rgba(255,255,255,0.12), 5px 5px 0 rgba(0,0,0,0.45); }
	#hud-pager.in { transform: translate(-50%, 0); }
	#hud-pager .brand { font: 16px ${FONT}; color: #9aa3b2; letter-spacing: 0.1em; margin: 0 0 4px 2px; }
	#hud-pager .lcd { padding: 6px 8px; background: #a9b874; color: #1d2612; border: 2px solid #000; font: 16px/1.25 ${FONT};
		box-shadow: inset 2px 2px 0 rgba(0,0,0,0.25); text-transform: uppercase; }
	#hud-pager .lcd small { display: block; font-size: 16px; opacity: 0.75; text-transform: none; }
	#hud-clock { position: fixed; right: 18px; top: 18px; z-index: 3; padding: 4px 12px; pointer-events: none; font: 700 32px/1.1 ${FONT}; color: #ffd34a; text-shadow: 3px 3px 0 #000; }
	#hud-clock small { font: 400 16px ${FONT}; color: #f4ecd2; margin-right: 4px; vertical-align: 4px; }
	#hud-tally { position: fixed; right: 18px; top: 74px; z-index: 3; display: flex; gap: 14px; padding: 6px 12px; pointer-events: none; font: 16px/1.3 ${FONT}; text-shadow: 2px 2px 0 #000; }
	#hud-tally b { color: #ffd34a; }
	#hud-tally span small { font-size: 16px; opacity: 0.8; margin-right: 6px; }
	#hud-prompt { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 3; display: none; gap: 14px; padding: 8px 14px; pointer-events: none;
		font: 16px/1.6 ${FONT}; color: #f4ecd2; text-shadow: 2px 2px 0 #000; white-space: nowrap; }
	#hud-prompt.on { display: flex; animation: hud-blink 1.2s steps(2, end) infinite; }
	@keyframes hud-blink { 50% { color: #ffd34a; } }
	#hud-tram { position: fixed; left: 16px; top: 76px; z-index: 3; display: none; align-items: stretch; pointer-events: none;
		background: #0b0b0b; border: 3px solid #000; box-shadow: 0 0 0 2px #3a3f44, 5px 5px 0 rgba(0,0,0,0.45); max-width: calc(100vw - 32px); }
	#hud-tram.on { display: flex; }
	#hud-tram .line { padding: 4px 12px; background: #ffb52e; color: #0b0b0b; font: 700 32px/1.2 ${FONT}; display: grid; place-items: center; }
	#hud-tram .text { padding: 4px 14px 6px; color: #ffb52e; font: 16px/1.5 ${FONT}; text-shadow: 0 0 6px rgba(255, 181, 46, 0.45); }
	#hud-tram .text b { display: block; font: 700 24px/1.25 ${FONT}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	#hud-touch { position: fixed; left: 10px; top: 10px; z-index: 4; display: flex; gap: 8px; }
	#hud-touch button { padding: 7px 10px; border: 3px solid #000; background: rgba(20, 26, 40, 0.86); color: #f4ecd2; font: 16px ${FONT}; text-shadow: 2px 2px 0 #000;
		box-shadow: inset -2px -2px 0 rgba(0,0,0,0.4), inset 2px 2px 0 rgba(255,255,255,0.12); }
	#hud-overview { position: fixed; left: 16px; top: 16px; z-index: 3; padding: 6px 12px; pointer-events: none; font: 16px/1.5 ${FONT}; text-shadow: 2px 2px 0 #000; }
	#hud-pause { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; background: rgba(8, 10, 16, 0.62); }
	#hud-pause .box { position: relative; width: min(88vw, 400px); display: flex; flex-direction: column; align-items: center; }
	#hud-pause .title { width: min(70vw, 300px); height: auto; image-rendering: pixelated; filter: drop-shadow(0 5px 0 rgba(0,0,0,0.45)); margin-bottom: 8px; }
	#hud-pause .ui-menu { width: 100%; }
	#hud-pause .ui-version { margin-top: 10px; }
	@media (max-width: 600px), (pointer: coarse) {
		#hud-area { right: auto; left: 12px; top: 104px; bottom: auto; text-align: left; max-width: calc(100vw - 170px); }
		#hud-area .name { font-size: 32px; }
		
		#hud-speed { right: auto; left: 160px; bottom: 30px; min-width: 104px; }
		#hud-speed b { font-size: 32px; }
		#hud-tally { right: auto; left: 10px; top: 58px; gap: 8px; }
		#hud-clock { right: 10px; top: 150px; font-size: 16px; }
		#hud-keys { top: auto; bottom: 172px; width: auto; }
		#hud-keys > span { white-space: normal; text-align: center; }
	}
`;

let hud = null;
export function getHud() {

	return hud ??= makeHud();

}

const touch = matchMedia( '(pointer: coarse)' ).matches || navigator.maxTouchPoints > 0 && ! matchMedia( '(pointer: fine)' ).matches;

// Key caps: '[W][A][S][D] chůze' is written as [ [ 'W', 'A', 'S', 'D' ], 'chůze' ].
const caps = list => list.map( ( [ keys, what ] ) => `<span>${keys.map( k => `<span class="ui-key">${k}</span>` ).join( '' )} ${what}</span>` ).join( '' );

export const KEYS = {
	walk: [ [ [ 'W', 'A', 'S', 'D' ], 'chůze' ], [ [ 'Shift' ], 'běh' ], [ [ 'Mezerník' ], 'skok' ], [ [ 'B' ], 'skútr' ], [ [ 'V' ], 'z očí' ], [ [ 'Tab' ], 'mapa' ], [ [ 'M' ], 'shora' ], [ [ 'Esc' ], 'menu' ] ],
	tram: [ [ [ 'W', 'A', 'S', 'D' ], 'ulička' ], [ [ 'C' ], 'sednout' ], [ [ 'E' ], 'vystoupit (na zastávce)' ], [ [ 'Myš' ], 'rozhlížení' ], [ [ 'Esc' ], 'menu' ] ],
	ride: [ [ [ 'W' ], 'plyn' ], [ [ 'S' ], 'brzda' ], [ [ 'A', 'D' ], 'řízení' ], [ [ 'B' ], 'sesednout' ], [ [ 'Tab' ], 'mapa' ], [ [ 'Esc' ], 'menu' ] ],
	boat: [ [ [ 'W', 'S' ], 'šlapat' ], [ [ 'A', 'D' ], 'kormidlo' ], [ [ 'V' ], 'z očí' ], [ [ 'E' ], 'vrátit (u mola)' ], [ [ 'Esc' ], 'menu' ] ],
	pigeon: [ [ [ 'W', 'A', 'S', 'D' ], 'chůze a let' ], [ [ 'Mezerník' ], 'vzlétnout / výš' ], [ [ 'S' ], 'v letu: přistát' ], [ [ 'C' ], 'níž / sednout' ], [ [ 'E' ], 'zobnout' ], [ [ 'Q' ], 'bobek' ], [ [ 'Tab' ], 'mapa' ], [ [ 'Esc' ], 'menu' ] ],
	above: [ [ [ 'Myš' ], 'otáčení' ], [ [ 'Kolečko' ], 'přiblížení' ], [ [ 'M' ], 'na ulici' ], [ [ 'Esc' ], 'menu' ] ]
};
const TOUCH_KEYS = {
	walk: 'Joystick vlevo dole: chůze (až k okraji běh) · táhni prstem: kamera',
	ride: 'Joystick: plyn, brzda a řízení · táhni prstem: kamera',
	tram: 'Joystick: ulička · táhni prstem: rozhlížení',
	boat: 'Joystick: šlapat a kormidlo · táhni prstem: kamera',
	pigeon: 'Joystick vlevo: chůze a let · táhni prstem: rozhlížení · tlačítka vpravo',
	above: 'Táhni prstem: otáčení · dvěma prsty: přiblížení a posun'
};

function makeHud() {

	useBaseStyle();
	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.appendChild( style );

	const add = ( id, cls = '' ) => {

		const el = document.createElement( 'div' );
		el.id = id;
		if ( cls ) el.className = cls;
		document.body.appendChild( el );
		return el;

	};

	// --- the street's name, as an area title
	const area = add( 'hud-area' );
	let shownName = null, candidate = null, seen = 0;
	// Called a few times a second with the street one is in: shown when it has held for a moment and differs.
	function place( name, quarter ) {

		const key = name || quarter;
		if ( key !== candidate ) {

			candidate = key;
			seen = 0;

		}

		if ( ++ seen < 2 || key === shownName ) return;
		shownName = key;
		area.innerHTML = `${name ? `<div class="quarter">${quarter}</div>` : ''}<div class="name">${key}</div>`;
		area.classList.remove( 'in' );
		void area.offsetWidth; // restart the animation
		area.classList.add( 'in' );

	}

	// Shows the current street again (after a teleport, or a mode change).
	function replace() {

		shownName = candidate = null;

	}

	// --- key hints
	const keys = add( 'hud-keys', 'ui-panel' );
	let keysSet = null, keysTimer = 0;
	function hints( set, seconds = 8 ) {

		keysSet = set;
		keys.innerHTML = touch ? `<span>${TOUCH_KEYS[ set ]}</span>` : caps( KEYS[ set ] );
		keys.classList.add( 'on' );
		clearTimeout( keysTimer );
		if ( seconds ) keysTimer = setTimeout( () => keys.classList.remove( 'on' ), seconds * 1000 );

	}

	function hideHints() {

		clearTimeout( keysTimer );
		keys.classList.remove( 'on' );

	}

	addEventListener( 'keydown', e => {

		if ( e.code !== 'KeyH' || ! keysSet || e.target.closest?.( 'input, textarea, select' ) ) return;
		if ( keys.classList.contains( 'on' ) ) hideHints();
		else hints( keysSet, 0 );

	} );

	// --- the scooter's speedometer
	const speedo = add( 'hud-speed', 'ui-panel' );
	speedo.innerHTML = `<b>0</b><small>km/h</small><div class="seg">${'<i></i>'.repeat( 10 )}</div>`;
	const speedNum = speedo.querySelector( 'b' ), segs = [ ...speedo.querySelectorAll( 'i' ) ];
	let lastKmh = - 1;
	function speed( kmh ) {

		speedo.classList.toggle( 'on', kmh !== null );
		if ( kmh === null ) return;
		const k = Math.round( kmh );
		if ( k === lastKmh ) return;
		lastKmh = k;
		speedNum.textContent = k;
		segs.forEach( ( s, i ) => {

			s.classList.toggle( 'lit', k >= ( i + 0.5 ) * 4 );
			s.classList.toggle( 'hot', i >= 8 );

		} );

	}

	// --- the pager
	const pagerEl = add( 'hud-pager' );
	let pagerTimer = 0;
	function pager( text, note, seconds = 7 ) {

		pagerEl.innerHTML = `<div class="brand">ROZVOZ · ZPRÁVA</div><div class="lcd">${text}${note ? `<small>${note}</small>` : ''}</div>`;
		pagerEl.classList.add( 'in' );
		clearTimeout( pagerTimer );
		pagerTimer = setTimeout( () => pagerEl.classList.remove( 'in' ), seconds * 1000 );

	}

	// --- the key prompt near a tram: [ [ keys, what ], … ] or null; on a touch screen a tap on it does it (`tap`)
	const promptEl = add( 'hud-prompt', 'ui-panel' );
	function prompt( list, tap = null ) {

		promptEl.classList.toggle( 'on', !! list );
		if ( list ) promptEl.innerHTML = caps( list );
		promptEl.style.pointerEvents = list && tap ? 'auto' : 'none';
		promptEl.onpointerdown = list && tap ? e => {

			e.preventDefault();
			tap();

		} : null;

	}

	// --- in the tram: the line and the stops, or null to hide
	const tramEl = add( 'hud-tram' );
	let tramShown = '';
	function tram( line, title, note = '' ) {

		const key = line === null ? '' : `${line}|${title}|${note}`;
		if ( key === tramShown ) return;
		tramShown = key;
		tramEl.classList.toggle( 'on', !! key );
		if ( key ) tramEl.innerHTML = `${line ? `<div class="line">${line}</div>` : ''}<div class="text"><b>${title}</b>${note}</div>`;

	}

	// --- the pigeon's tally
	let tallyEl = null;
	function tally( items ) {

		tallyEl ??= add( 'hud-tally', 'ui-panel' );
		tallyEl.innerHTML = items.map( ( [ what, n ] ) => `<span><small>${what}</small><b>${n}</b></span>` ).join( '' );

	}

	// --- the view from above: a small reminder in a corner
	const overview = add( 'hud-overview', 'ui-panel' );
	overview.style.display = 'none';
	overview.textContent = 'POHLED SHORA';

	// --- the pause menu
	let paused = false;
	let menuItems = () => [];
	async function pause() {

		if ( paused ) return;
		paused = true;
		if ( document.pointerLockElement ) document.exitPointerLock();
		const el = document.createElement( 'div' );
		el.id = 'hud-pause';
		el.innerHTML = `<div class="ui-scan"></div><div class="box"><ul class="ui-menu"></ul><div class="ui-version">${VERSION}</div></div>`;
		el.querySelector( '.box' ).prepend( titleCanvas( 'PAUZA' ) );
		document.body.appendChild( el );
		const list = el.querySelector( 'ul' );
		const extra = menuItems();
		for ( ;; ) {

			const id = await choose( list, [
				{ id: 'back', label: 'Pokračovat', on: true },
				...extra.map( ( { id, label } ) => ( { id, label } ) ),
				{ id: 'keys', label: 'Ovládání', minor: true },
				{ id: 'credits', label: 'Autoři a licence', minor: true }
			], { onBack: 'back' } );
			if ( id === 'credits' ) {

				await showCredits();
				continue;

			}

			el.remove();
			paused = false;
			if ( id === 'keys' && keysSet ) hints( keysSet, 12 );
			extra.find( it => it.id === id )?.run();
			return;

		}

	}

	// The touch screen's buttons: the menu, and the view from above / back to the street.
	let touchBar = null;
	function touchButtons( buttons ) {

		if ( ! touch ) return;
		touchBar ??= add( 'hud-touch' );
		touchBar.innerHTML = '';
		for ( const [ label, run ] of buttons ) {

			const b = document.createElement( 'button' );
			b.textContent = label;
			b.addEventListener( 'click', run );
			touchBar.appendChild( b );

		}

	}

	return {
		touch,
		place, replace, hints, hideHints, speed, pager, tally, pause, touchButtons, prompt, tram,
		// What the pause menu offers besides going on, the controls and the credits: [ { id, label, run } ].
		set menu( f ) {

			menuItems = f;

		},
		get paused() {

			return paused;

		},
		// The HUD for a mode: 'walk', 'ride', 'pigeon', 'above'.
		mode( m ) {

			overview.style.display = m === 'above' ? 'block' : 'none';
			area.style.display = m === 'above' ? 'none' : '';
			if ( m !== 'ride' ) speed( null );
			if ( m === 'above' ) replace();

		}
	};

}
