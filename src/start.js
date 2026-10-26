// The start screen: a late-90s console title over a still of the city drifting by (public/start/praha.png, rendered
// from the game and cut to 480 × 270 and 64 colours). Three ways in:
//   - Holub: the pigeon, straight in the city, on the pavement of Betlémské náměstí (src/holub/; same as ?holub; the
//     egg and the first day's tutorial, src/holub/story.js, only with ?vejce);
//   - Kurýr: a food courier on the delivery scooter, dressed in the character creator first (src/creator.js,
//     src/player.js);
//   - Jen se projet: on foot, nothing to do (the plain walk, as without any parameter before).
// Opened without parameters (or with only ones that don't choose a place or a mode, like ?webgl); any deep link
// (?at, ?holub, ?overview, ?view, ?admin…) goes straight into the game as before, and ?start shows it anyway.
// While it is up the city's data downloads behind it (into the browser's cache, which the game then reads), and
// in the game the pause menu (src/hud.js) offers the way back here (backToStart).

import { FONT, GAME_TITLE, GAME_SUBTITLE, VERSION, useBaseStyle, titleCanvas, choose, showCredits } from './ui.js';
import { DATA, fileProgress } from './loading.js';

const params = new URLSearchParams( location.search );
const NEUTRAL = new Set( [ 'start', 'webgl', 'seed', 'fps', 'hd', 'signs', 'cars', 'modelheads', 'texturetest' ] );
const GOTO_KEY = 'vinko.start.goto'; // a page reload straight into the creator ("Upravit postavu")

const STYLE = `
	#start { position: fixed; inset: 0; z-index: 50; overflow: hidden; background: #10141a; color: #f4ecd2;
		font: 16px/1.25 ${FONT}; user-select: none; -webkit-user-select: none; }
	#start .bg { position: absolute; inset: -8%; background: #10141a url(start/praha.png) center / cover no-repeat; image-rendering: pixelated;
		animation: start-drift 70s ease-in-out infinite alternate; }
	@keyframes start-drift { from { transform: scale(1.04) translate(-3%, 1%); } to { transform: scale(1.16) translate(3%, -2%); } }
	#start .shade { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(16,20,26,0.15), rgba(16,20,26,0.05) 40%, rgba(16,20,26,0.7)); pointer-events: none; }
	#start .menu { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: max(5vh, 24px) 16px 16px; box-sizing: border-box; }
	#start .title { width: min(86vw, 620px); height: auto; image-rendering: pixelated; filter: drop-shadow(0 6px 0 rgba(0,0,0,0.45)); }
	#start .sub { margin-top: 6px; font-size: 32px; letter-spacing: 0.12em; color: #f4ecd2; text-shadow: 3px 3px 0 #000; }
	#start .sub:empty { display: none; }
	#start ul { margin: auto 0 0; width: min(92vw, 460px); }
	#start .foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: min(92vw, 900px); margin-top: 18px; text-shadow: 2px 2px 0 #000; }
	#start .foot > span { opacity: 0.85; }
	#start .foot button { padding: 2px 8px; border: 2px solid #000; background: rgba(20, 26, 40, 0.8); color: #f4ecd2; font: 16px ${FONT}; cursor: pointer; text-shadow: 2px 2px 0 #000; }
	#start .load { white-space: nowrap; }
	#start .ui-version { position: absolute; right: 10px; top: 8px; }
	@media (max-width: 600px) { #start .sub { font-size: 16px; } #start .foot { flex-wrap: wrap; justify-content: center; } #start .keys { display: none; } }
`;

// Whether this page load shows the start screen.
export function wanted() {

	if ( window.GAME ) return false;
	if ( params.has( 'start' ) ) return true;
	return [ ...params.keys() ].every( k => NEUTRAL.has( k ) );

}

const storage = {
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

// What the game reads after the city's first files, nearest needed first: the drawn fronts and the player's body and
// wardrobe (while the city is built), then the scooter, the street life, the crowd's bodies, the trams and boats.
async function laterFiles() {

	const [ { BODIES }, { FRONT_URLS } ] = await Promise.all( [ import( './people.js' ), import( './fronts.js' ) ] );
	let wardrobe = [];
	try {

		const manifest = await ( await fetch( 'models/people/manifest.json', { priority: 'low' } ) ).json();
		for ( const [ kind, list ] of Object.entries( manifest ) ) if ( Array.isArray( list ) ) for ( const it of list ) {

			const file = typeof it === 'string' ? it : it?.file;
			if ( file ) wardrobe.push( `models/people/${kind}/${file}` );

		}

	} catch { /* the game loads it itself */ }

	const V = 'models/vehicles/';
	return [
		...FRONT_URLS, ...wardrobe,
		...BODIES.map( b => `models/people/${b.file}.glb` ),
		`${V}scooter.glb`, `${V}delivery-box.png`, 'data/life.json',
		'models/people/posed-humans/male.glb', 'models/people/posed-humans/female.glb',
		`${V}tram-atlas.json`, `${V}tram-atlas.png`,
		`${V}boat-swan.glb`, `${V}boat-row.glb`, `${V}boat-row-large.glb`, `${V}boat-steamer.glb`
	];

}

// The city's data into the browser's cache while the player chooses: how far it got, 0…1.
function preload() {

	const state = { progress: 0 };
	if ( window.PACKED_DATA ) return { progress: 1, later: 1 };
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
				fileProgress( name, parts[ i ] );
				update();

			}

		} catch { /* the game loads it itself */ }

		parts[ i ] = 1;
		fileProgress( name, 1 );
		update();

	} );

	// Then the rest, quietly, four at a time; state.later: how far that got.
	state.later = 0;
	const first = new Promise( resolve => {

		const poll = setInterval( () => state.progress >= 1 && ( clearInterval( poll ), resolve() ), 200 );

	} );
	first.then( laterFiles ).then( async urls => {

		let next = 0, got = 0;
		const worker = async () => {

			while ( next < urls.length ) {

				const url = urls[ next ++ ];
				try {

					const r = await fetch( url, { priority: 'low' } );
					await r.arrayBuffer();

				} catch { /* the game loads it itself */ }

				state.later = ++ got / urls.length;

			}

		};

		await Promise.all( [ worker(), worker(), worker(), worker() ] );

	} ).catch( () => state.later = 1 );
	return state;

}

// Shows the start screen if this load wants it, and sets the game up for the choice (window.GAME, window.PLAYER_SPEC).
// Resolves when the game should load.
export async function startScreen() {

	if ( ! wanted() ) return null;

	useBaseStyle();
	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.appendChild( style );
	const root = document.createElement( 'div' );
	root.id = 'start';
	root.innerHTML = `<div class="bg"></div><div class="shade"></div><div class="ui-scan"></div>
		<div class="menu"><span class="ui-version">${VERSION}</span><div class="sub"></div><ul class="ui-menu"></ul>
		<div class="foot"><span class="keys"><span class="ui-key">↑</span><span class="ui-key">↓</span> vybrat · <span class="ui-key">Enter</span> potvrdit</span><button class="credits">Autoři a licence</button><span class="load"></span></div></div>`;
	root.querySelector( '.sub' ).textContent = GAME_SUBTITLE;
	root.querySelector( '.menu' ).prepend( titleCanvas( GAME_TITLE ) );
	root.querySelector( '.credits' ).addEventListener( 'click', () => showCredits() );
	document.body.appendChild( root );
	const list = root.querySelector( 'ul' ), load = root.querySelector( '.load' );

	const data = preload();
	const showLoad = () => load.textContent = data.progress < 1 ? `Načítám město… ${Math.floor( data.progress * 100 )} %`
		: data.later < 1 ? `Město připravené ✓ · lidé a tramvaje… ${Math.floor( data.later * 100 )} %` : 'Město připravené ✓';
	showLoad();
	const loadTimer = setInterval( showLoad, 250 );

	let choice = storage.take( GOTO_KEY ) === 'creator' ? 'courier' : null, player = null;
	for ( ;; ) {

		choice ??= await choose( list, [
			{ id: 'holub', label: 'Holub', note: 'Jsi holub na Betlémském náměstí. Choď, zobej, leť.', on: true },
			{ id: 'courier', label: 'Kurýr', note: 'Rozvážíš jídlo na skútru po Starém Městě.' },
			{ id: 'walk', label: 'Jen se projet', note: 'Pěšky, bez úkolů.' }
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

	if ( choice === 'holub' ) window.GAME = 'holub';
	if ( choice === 'courier' ) {

		window.GAME = 'courier';
		window.PLAYER_SPEC = player; // also kept in this browser; this is for when nothing can be kept

	}

	clearInterval( loadTimer );
	root.remove();
	return choice;

}

// Back to the start screen (the pause menu's "Hlavní menu", src/hud.js): the page again, with only the parameters
// that don't choose a mode; `creator` goes straight on to the character creator.
export function backToStart( { creator = false } = {} ) {

	if ( creator ) try {

		sessionStorage.setItem( GOTO_KEY, 'creator' );

	} catch { /* the menu instead */ }

	const keep = [ ...params ].filter( ( [ k ] ) => NEUTRAL.has( k ) && k !== 'start' );
	location.href = location.pathname + ( keep.length ? '?' + keep.map( ( [ k, v ] ) => v ? `${k}=${encodeURIComponent( v )}` : k ).join( '&' ) : '' );

}
