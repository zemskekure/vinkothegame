// The game's look outside the 3D picture, shared by the start screen (src/start.js) and the in-game HUD
// (src/hud.js): a late-90s console's menus. Chunky italic Arial Black, dark panels with hard black edges and a
// bevel, cream text with hard shadows, the orange and yellow of the title. System fonts only.

// The game's name and the line under it, in one place (the name is not decided yet).
export const GAME_TITLE = 'PRAHA';
export const GAME_SUBTITLE = 'PRAHA 1';

// Which build this is (vite.config.js: the build's date and commit).
export const VERSION = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

export const FONT = `'Pixelify Sans', system-ui, sans-serif`;

// Everything every screen needs: the menu list, the panels, the buttons, the scanlines.
export const BASE_STYLE = `
	.ui-panel { background: rgba(16, 20, 30, 0.92); border: 3px solid #000; color: #f4ecd2;
		box-shadow: inset -3px -3px 0 rgba(0,0,0,0.4), inset 3px 3px 0 rgba(255,255,255,0.10), 5px 5px 0 rgba(0,0,0,0.45); }
	.ui-scan { position: absolute; inset: 0; pointer-events: none;
		background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px),
			radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%); }
	.ui-menu { list-style: none; margin: 0; padding: 0; }
	.ui-menu li { margin: 8px 0; }
	.ui-menu li button { display: grid; grid-template-columns: 28px 1fr; align-items: center; width: 100%; padding: 10px 14px; border: 3px solid #000; background: rgba(20, 26, 40, 0.86);
		color: #f4ecd2; font: 32px/1.1 ${FONT}; text-align: left; letter-spacing: 0.03em; cursor: pointer; text-shadow: 3px 3px 0 #000;
		box-shadow: inset -3px -3px 0 rgba(0,0,0,0.4), inset 3px 3px 0 rgba(255,255,255,0.12); }
	.ui-menu li.on button { background: rgba(196, 86, 47, 0.94); color: #ffd34a; }
	.ui-menu li.on button > span:first-child::before { content: '▶'; font-size: 0.7em; font-style: normal; animation: ui-blink 0.9s steps(2) infinite; }
	.ui-menu li button small { grid-column: 2; font: 16px/1.25 ${FONT}; letter-spacing: 0; text-shadow: 2px 2px 0 #000; opacity: 0.85; margin-top: 2px; }
	.ui-menu li.minor button { font-size: 24px; padding: 6px 14px; background: rgba(20, 26, 40, 0.66); }
	@keyframes ui-blink { 50% { opacity: 0; } }
	@media (max-width: 600px) { .ui-menu li button { font-size: 24px; padding: 8px 12px; } }
	.ui-key { display: inline-block; min-width: 1.5em; padding: 2px 5px 1px; margin: 0 1px; box-sizing: border-box; text-align: center; background: #f4ecd2; color: #10141a;
		border: 2px solid #000; font: 16px/1 ${FONT}; box-shadow: inset -2px -2px 0 rgba(0,0,0,0.25), 2px 2px 0 rgba(0,0,0,0.6); text-shadow: none; }
	.ui-version { font: 16px/1 ${FONT}; letter-spacing: 0.04em; color: #f4ecd2; opacity: 0.55; text-shadow: 1px 1px 0 #000; }
	#ui-credits { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(8, 10, 16, 0.7); }
	#ui-credits .ui-panel { position: relative; width: min(92vw, 560px); max-height: 84vh; overflow: auto; padding: 16px 20px 18px; box-sizing: border-box; font: 16px/1.4 ${FONT}; }
	#ui-credits h2 { margin: 0 0 10px; font: 32px ${FONT}; color: #ffd34a; text-shadow: 3px 3px 0 #000; }
	#ui-credits dl { margin: 0; }
	#ui-credits dt { margin-top: 10px; font: 16px ${FONT}; color: #ffd34a; text-shadow: 2px 2px 0 #000; letter-spacing: 0.03em; }
	#ui-credits dd { margin: 2px 0 0; }
	#ui-credits a { color: #f4ecd2; }
	#ui-credits button { margin-top: 14px; padding: 6px 14px; border: 3px solid #000; background: #c4562f; color: #ffd34a; font: 16px ${FONT}; text-shadow: 2px 2px 0 #000; cursor: pointer; }
`;

let styled = false;
export function useBaseStyle() {

	if ( styled ) return;
	styled = true;
	const style = document.createElement( 'style' );
	style.textContent = BASE_STYLE;
	document.head.appendChild( style );

}

// The title, drawn at a console's resolution: chunky letters with a hard outline, scaled up with hard pixels.
export function titleCanvas( text ) {

	const c = document.createElement( 'canvas' ), x = c.getContext( '2d' );
	x.font = 'italic 900 38px "Arial Black", "Arial Bold", Gadget, sans-serif';
	c.width = Math.max( 156, Math.ceil( x.measureText( text ).width + 16 ) );
	c.height = 44;
	x.font = 'italic 900 38px "Arial Black", "Arial Bold", Gadget, sans-serif';
	x.textAlign = 'center';
	x.textBaseline = 'middle';
	const g = x.createLinearGradient( 0, 6, 0, 38 );
	g.addColorStop( 0, '#fff3a8' );
	g.addColorStop( 0.45, '#ffd34a' );
	g.addColorStop( 0.55, '#e8892c' );
	g.addColorStop( 1, '#c4562f' );
	x.lineJoin = 'round';
	x.lineWidth = 6;
	x.strokeStyle = '#000';
	x.strokeText( text, c.width / 2, 23 );
	x.fillStyle = g;
	x.fillText( text, c.width / 2, 23 );
	// Hard edges: every pixel either drawn or not, as on a console.
	const img = x.getImageData( 0, 0, c.width, c.height );
	for ( let i = 3; i < img.data.length; i += 4 ) img.data[ i ] = img.data[ i ] > 110 ? 255 : 0;
	x.putImageData( img, 0, 0 );
	c.className = 'title';
	return c;

}

// A list of big choices worked by the arrows and Enter, the mouse or a finger. Resolves with the chosen id.
export function choose( list, items, { onBack = null } = {} ) {

	return new Promise( resolve => {

		let current = Math.max( 0, items.findIndex( it => it.on ) );
		const lis = items.map( ( it, i ) => {

			const li = document.createElement( 'li' );
			if ( it.minor ) li.className = 'minor';
			const b = document.createElement( 'button' );
			b.innerHTML = `<span></span><span>${it.label}</span>${it.note ? `<small>${it.note}</small>` : ''}`;
			b.addEventListener( 'pointerenter', () => mark( i ) );
			b.addEventListener( 'click', () => done( it.id ) );
			li.appendChild( b );
			list.appendChild( li );
			return li;

		} );

		const mark = i => {

			current = ( i + items.length ) % items.length;
			lis.forEach( ( li, k ) => li.classList.toggle( 'on', k === current ) );

		};

		const key = e => {

			// A panel over the menu (the credits) takes the keys while it is open.
			if ( document.getElementById( 'ui-credits' ) ) return;
			const k = e.code;
			if ( k === 'ArrowUp' || k === 'KeyW' ) mark( current - 1 );
			else if ( k === 'ArrowDown' || k === 'KeyS' ) mark( current + 1 );
			else if ( k === 'Enter' || k === 'NumpadEnter' || k === 'Space' ) done( items[ current ].id );
			else if ( k === 'Escape' && onBack ) done( onBack );
			else return;
			e.preventDefault();
			e.stopPropagation();

		};

		const done = id => {

			removeEventListener( 'keydown', key, true );
			list.innerHTML = '';
			resolve( id );

		};

		addEventListener( 'keydown', key, true );
		mark( current );

	} );

}

// Who made what the game is made of. They must stay reachable from the game (the pause menu and the start screen).
const CREDITS = [
	[ 'Město', 'Data © ČÚZK (RÚIAN, ZABAGED®, DMR 5G, DMP 1G, ortofoto) · © přispěvatelé <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL)' ],
	[ 'Fasády', 'Podle fotek © <a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a> a jejich autoři (CC BY-SA 4.0)' ],
	[ 'Lidé', 'Postavy <a href="https://quaternius.com" target="_blank" rel="noopener">Quaternius</a> (CC0)' ],
	[ 'Vozidla (CC BY 4.0, upravená)', 'Skútr: Han66st · Škoda Octavia: Kuutti Siitonen · Škoda Favorit: FPSunreal · Trabant: creativecipher · šlapadlo labuť: Polygonal_64 · parník: norlinmartin (vše Sketchfab, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>)' ],
	[ 'Loďky', '<a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> Watercraft Kit (CC0)' ],
	[ 'Písmo', 'Pixelify Sans, The Pixelify Sans Project Authors (<a href="fonts/PixelifySans-OFL.txt" target="_blank" rel="noopener">SIL Open Font License 1.1</a>)' ],
	[ 'Vykreslování', 'Podle Slop New York (Mr.doob, MIT) · <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT)' ]
];

// The credits over whatever is on screen; Esc, Enter or the button closes it. Resolves when closed.
export function showCredits() {

	useBaseStyle();
	return new Promise( resolve => {

		const el = document.createElement( 'div' );
		el.id = 'ui-credits';
		el.innerHTML = `<div class="ui-panel"><h2>Autoři a licence</h2><dl>${CREDITS.map( ( [ t, d ] ) => `<dt>${t}</dt><dd>${d}</dd>` ).join( '' )}</dl>
			<button>Zpět</button> <span class="ui-version">${VERSION}</span></div>`;
		document.body.appendChild( el );
		const close = () => {

			removeEventListener( 'keydown', key, true );
			el.remove();
			resolve();

		};

		const key = e => {

			if ( ! [ 'Escape', 'Enter', 'NumpadEnter', 'Space' ].includes( e.code ) ) return;
			e.preventDefault();
			e.stopPropagation();
			close();

		};

		addEventListener( 'keydown', key, true );
		el.querySelector( 'button' ).addEventListener( 'click', close );
		el.addEventListener( 'click', e => e.target === el && close() );

	} );

}
