// The start screen: a late-90s console title over a still of the city drifting by (public/start/praha.png, rendered
// from the game and cut to 480 × 270 and 64 colours). Three ways in:
//   - Holub: the pigeon game and its first day, from the egg (src/holub/, src/holub/story.js; same as ?holub);
//   - Kurýr: a food courier on the delivery scooter, dressed in the character creator first (src/creator.js,
//     src/player.js);
//   - Jen se projet: on foot, nothing to do (the plain walk, as without any parameter before).
// Opened without parameters (or with only ones that don't choose a place or a mode, like ?webgl); any deep link
// (?at, ?holub, ?overview, ?view, ?admin…) goes straight into the game as before, and ?start shows it anyway.
// While it is up the city's data downloads behind it (into the browser's cache, which the game then reads), and
// in the game Esc (or the Menu button) offers the way back here.

const params = new URLSearchParams( location.search );
const NEUTRAL = new Set( [ 'start', 'webgl', 'seed', 'fps', 'hd', 'signs', 'cars', 'modelheads', 'texturetest' ] );
const STORY_KEY = 'holub-story'; // src/holub/story.js
const GOTO_KEY = 'vinko.start.goto'; // a page reload straight into the creator ("Upravit postavu")

// The files the game loads first (src/main.js), the biggest ones.
const DATA = [ 'scene.json', 'walls.bin', 'walls-index.bin', 'roofs.bin', 'roofs-index.bin', 'terrain.bin', 'surface.bin', 'surface2.bin', 'pavement.bin', 'pavement-index.bin', 'footprints.bin', 'embankment.bin', 'ground-detail.jpg', 'ground-detail-wide.jpg' ];

const STYLE = `
	#start { position: fixed; inset: 0; z-index: 50; overflow: hidden; background: #10141a; color: #f4ecd2;
		font: 16px/1.25 'Arial Black', 'Arial Bold', Gadget, sans-serif; user-select: none; -webkit-user-select: none; }
	#start .bg { position: absolute; inset: -8%; background: #10141a url(start/praha.png) center / cover no-repeat; image-rendering: pixelated;
		animation: start-drift 70s ease-in-out infinite alternate; }
	@keyframes start-drift { from { transform: scale(1.04) translate(-3%, 1%); } to { transform: scale(1.16) translate(3%, -2%); } }
	#start .fx { position: absolute; inset: 0; pointer-events: none;
		background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px),
			radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%); }
	#start .shade { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(16,20,26,0.15), rgba(16,20,26,0.05) 40%, rgba(16,20,26,0.7)); pointer-events: none; }
	#start .menu { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: max(5vh, 24px) 16px 16px; box-sizing: border-box; }
	#start .title { width: min(86vw, 620px); height: auto; image-rendering: pixelated; filter: drop-shadow(0 6px 0 rgba(0,0,0,0.45)); }
	#start .sub { margin-top: 6px; font-size: clamp(12px, 2.2vw, 17px); letter-spacing: 0.32em; color: #f4ecd2; text-shadow: 2px 2px 0 #000; }
	#start ul { list-style: none; margin: auto 0 0; padding: 0; width: min(92vw, 460px); }
	#start li { margin: 8px 0; }
	#start li button { display: grid; grid-template-columns: 28px 1fr; align-items: center; width: 100%; padding: 10px 14px; border: 3px solid #000; background: rgba(20, 26, 40, 0.82);
		color: #f4ecd2; font: inherit; font-size: clamp(22px, 4.4vw, 30px); font-style: italic; text-align: left; letter-spacing: 0.03em; cursor: pointer; text-shadow: 3px 3px 0 #000;
		box-shadow: inset -3px -3px 0 rgba(0,0,0,0.4), inset 3px 3px 0 rgba(255,255,255,0.12); }
	#start li.on button { background: rgba(196, 86, 47, 0.92); color: #ffd34a; }
	#start li.on button > span:first-child::before { content: '▶'; font-size: 0.7em; font-style: normal; animation: start-blink 0.9s steps(2) infinite; }
	#start li button small { grid-column: 2; font: 12px/1.3 system-ui, sans-serif; font-style: normal; letter-spacing: 0; text-shadow: 1px 1px 0 #000; opacity: 0.85; margin-top: 2px; }
	#start li.minor button { font-size: 14px; padding: 6px 14px; background: rgba(20, 26, 40, 0.6); }
	@keyframes start-blink { 50% { opacity: 0; } }
	#start .foot { display: flex; justify-content: space-between; gap: 12px; width: min(92vw, 900px); margin-top: 18px; font: 12px/1.3 system-ui, sans-serif; text-shadow: 1px 1px 0 #000; opacity: 0.8; }
	#start .load { white-space: nowrap; }
	#start-toast { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); z-index: 40; padding: 10px 18px; max-width: calc(100vw - 32px); box-sizing: border-box; background: rgba(8, 10, 16, 0.82);
		border: 3px solid #000; color: #f4ecd2; font: italic 18px/1.3 'Arial Black', 'Arial Bold', sans-serif; text-shadow: 2px 2px 0 #000; text-align: center; pointer-events: none; transition: opacity 0.8s; }
	#start-toast small { display: block; font: 12px/1.4 system-ui, sans-serif; font-style: normal; opacity: 0.85; margin-top: 4px; }
	#start-pause { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; background: rgba(8, 10, 16, 0.55); }
	#start-pause ul { list-style: none; margin: 0; padding: 14px; width: min(86vw, 360px); background: rgba(16, 20, 30, 0.92); border: 3px solid #000; }
	#start-pause li button { width: 100%; margin: 4px 0; padding: 10px 14px; border: 3px solid #000; background: #2d3d5c; color: #f4ecd2; font: italic 20px 'Arial Black', 'Arial Bold', sans-serif; text-align: left; cursor: pointer; text-shadow: 2px 2px 0 #000; }
	#start-pause li.on button { background: #c4562f; color: #ffd34a; }
	#start-pause h2 { margin: 0 0 8px; font: italic 26px 'Arial Black', 'Arial Bold', sans-serif; color: #ffd34a; text-shadow: 3px 3px 0 #000; }
`;

// Whether this page load shows the start screen.
export function wanted() {

	if ( window.GAME ) return false;
	if ( params.has( 'start' ) ) return true;
	return [ ...params.keys() ].every( k => NEUTRAL.has( k ) );

}

const storage = {
	get( k ) {

		try {

			return localStorage.getItem( k );

		} catch {

			return null;

		}

	},
	set( k, v ) {

		try {

			if ( v === null ) localStorage.removeItem( k );
			else localStorage.setItem( k, v );

		} catch { /* not kept */ }

	},
	take( k ) {

		try {

			const v = sessionStorage.getItem( k );
			sessionStorage.removeItem( k );
			return v;

		} catch {

			return null;

		}

	}
};

// The city's data into the browser's cache while the player chooses: how far it got, 0…1.
function preload() {

	const state = { progress: 0 };
	if ( window.PACKED_DATA ) return state;
	const parts = DATA.map( () => 0 );
	const update = () => state.progress = parts.reduce( ( a, b ) => a + b, 0 ) / parts.length;
	DATA.forEach( async ( name, i ) => {

		try {

			const r = await fetch( `data/${name}` );
			if ( ! r.ok || ! r.body ) {

				parts[ i ] = 1;
				return update();

			}

			const total = Number( r.headers.get( 'content-length' ) ) || 0, reader = r.body.getReader();
			let got = 0;
			for ( ;; ) {

				const { done, value } = await reader.read();
				if ( done ) break;
				got += value.length;
				if ( total ) parts[ i ] = Math.min( 0.99, got / total );
				update();

			}

		} catch { /* the game loads it itself */ }

		parts[ i ] = 1;
		update();

	} );
	return state;

}

// The title, drawn at a console's resolution: chunky letters with a hard outline, scaled up with hard pixels.
function titleCanvas( text ) {

	const c = document.createElement( 'canvas' ), x = c.getContext( '2d' );
	c.width = 156;
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
function choose( list, items, { onBack = null } = {} ) {

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

// Shows the start screen if this load wants it, and sets the game up for the choice (window.GAME, window.PLAYER_SPEC).
// Resolves when the game should load.
export async function startScreen() {

	if ( ! wanted() ) return null;

	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.appendChild( style );
	const root = document.createElement( 'div' );
	root.id = 'start';
	root.innerHTML = `<div class="bg"></div><div class="shade"></div><div class="fx"></div>
		<div class="menu"><div class="sub">BETLÉMSKÁ ČTVRŤ</div><ul></ul>
		<div class="foot"><span class="keys">↑↓ vybrat · Enter potvrdit</span><span class="load"></span></div></div>`;
	root.querySelector( '.menu' ).prepend( titleCanvas( 'PRAHA' ) );
	document.body.appendChild( root );
	const list = root.querySelector( 'ul' ), load = root.querySelector( '.load' );

	const data = preload();
	const showLoad = () => load.textContent = data.progress < 1 ? `Načítám město… ${Math.floor( data.progress * 100 )} %` : 'Město je připravené';
	showLoad();
	const loadTimer = setInterval( showLoad, 250 );

	const step = Number( storage.get( STORY_KEY ) ) || 0;
	let choice = storage.take( GOTO_KEY ) === 'creator' ? 'courier' : null, player = null;
	for ( ;; ) {

		choice ??= await choose( list, [
			{ id: 'holub', label: 'Holub', note: step ? 'Pokračuješ tam, kde jsi skončil.' : 'Vylíhneš se na římse nad náměstím. Pak už to půjde samo.', on: true },
			{ id: 'courier', label: 'Kurýr', note: 'Rozvážíš jídlo na skútru po Starém Městě.' },
			{ id: 'walk', label: 'Jen se projet', note: 'Pěšky, bez úkolů.' },
			...( step ? [ { id: 'egg', label: 'Holub znovu od vejce', minor: true } ] : [] )
		] );

		if ( choice !== 'courier' ) break;

		// The courier dresses first; going back from the creator returns to the menu.
		root.querySelector( '.menu' ).style.visibility = 'hidden';
		const { createCharacter } = await import( './creator.js' );
		player = await createCharacter( root, { webgl: params.has( 'webgl' ) } );
		root.querySelector( '.menu' ).style.visibility = '';
		if ( player ) break;
		choice = null;

	}

	if ( choice === 'egg' ) storage.set( STORY_KEY, null );
	if ( choice === 'holub' || choice === 'egg' ) window.GAME = 'holub';
	if ( choice === 'courier' ) {

		window.GAME = 'courier';
		window.PLAYER_SPEC = player; // also kept in this browser; this is for when nothing can be kept

	}

	clearInterval( loadTimer );
	root.remove();

	// The game's own loading screen, with how far the data got.
	const loading = document.getElementById( 'loading' );
	const showProgress = () => {

		if ( ! loading.isConnected ) return clearInterval( progressTimer );
		loading.textContent = data.progress < 1 ? `Načítám Prahu… ${Math.floor( data.progress * 100 )} %` : 'Stavím Prahu…';

	};

	const progressTimer = setInterval( showProgress, 250 );
	showProgress();
	inGame( choice );
	return choice;

}

// In the game: a word for the courier when it starts, and the menu on Esc (or the Menu button).
function inGame( choice ) {

	const ready = new Promise( resolve => {

		const poll = setInterval( () => {

			if ( ! window.__ready ) return;
			clearInterval( poll );
			resolve();

		}, 200 );

	} );

	ready.then( () => {

		if ( choice === 'courier' ) toast( 'Dneska žádné objednávky. Projeď se.', 'W plyn · S brzda · A/D řízení · B sesednout' );
		const hud = document.getElementById( 'hud' );
		if ( hud ) {

			const b = document.createElement( 'button' );
			b.textContent = 'Menu (Esc)';
			b.style.marginLeft = '6px';
			b.addEventListener( 'click', () => pause( choice ) );
			hud.appendChild( b );

		}

		addEventListener( 'keydown', e => {

			// The first Esc only frees the mouse (the browser's pointer lock); the next one opens the menu.
			if ( e.code !== 'Escape' || e.defaultPrevented || document.pointerLockElement || document.getElementById( 'start-pause' ) ) return;
			pause( choice );

		} );

	} );

}

function toast( text, note ) {

	const el = document.createElement( 'div' );
	el.id = 'start-toast';
	el.innerHTML = `${text}${note ? `<small>${note}</small>` : ''}`;
	document.body.appendChild( el );
	setTimeout( () => el.style.opacity = '0', 6000 );
	setTimeout( () => el.remove(), 7000 );

}

async function pause( choice ) {

	if ( document.pointerLockElement ) document.exitPointerLock();
	const el = document.createElement( 'div' );
	el.id = 'start-pause';
	el.innerHTML = '<ul><h2>Pauza</h2></ul>';
	document.body.appendChild( el );
	const id = await choose( el.querySelector( 'ul' ), [
		{ id: 'back', label: 'Pokračovat', on: true },
		...( choice === 'courier' ? [ { id: 'creator', label: 'Upravit postavu' } ] : [] ),
		{ id: 'menu', label: 'Hlavní menu' }
	], { onBack: 'back' } );
	el.remove();
	if ( id === 'back' ) return;
	// Back to the start: the page again, with only the parameters that don't choose a mode.
	if ( id === 'creator' ) try {

		sessionStorage.setItem( GOTO_KEY, 'creator' );

	} catch { /* the menu instead */ }

	const keep = [ ...params ].filter( ( [ k ] ) => NEUTRAL.has( k ) && k !== 'start' );
	location.href = location.pathname + ( keep.length ? '?' + keep.map( ( [ k, v ] ) => v ? `${k}=${encodeURIComponent( v )}` : k ).join( '&' ) : '' );

}
