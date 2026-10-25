// The game's admin page (?admin): the pigeon game keeps running behind, and a panel on the left with three tabs
// over the game settings (src/settings.js, public/game-settings.json):
//   - Vzhled: every knob of the picture and the light, applied to the running game at once (resolution, colour
//     levels, dither, grain, contrast, saturation, exposure, sun, fog, vertex wobble, time of day).
//   - Map: the whole area drawn from the scene's own data (the minimap's image), the lines people walk, where the
//     walkers are right now (red dots), the spawn zones (circles) and the pigeon's start (blue arrow).
//     Click empty ground to add a zone, click a zone to pick it, drag to move it, the mouse wheel over it changes its
//     reach. "Vybrat na mapě" by the pigeon's start makes the next click set the start instead.
//   - Zones and the look, the day and the pigeon's start apply at once; the number of people at the next load.
//   - Uložit sends the settings to the grid dashboard (PUT ../api/game-settings); without it they stay in this
//     browser (localStorage) and the JSON can be downloaded and put on the server by hand.

import { SETTINGS, DEFAULTS, SERVER, LOCAL, API_URL, merge, writeLocal } from './settings.js';

export const STYLE = `
#admin { position: fixed; left: 0; top: 0; bottom: 0; width: min(400px, 100vw); overflow-y: auto; z-index: 10; background: #f6f5f2; color: #1d1d1b; font: 13px/1.4 system-ui, sans-serif; box-shadow: 1px 0 0 #c9c6bf; }
#admin * { box-sizing: border-box; }
#admin header { position: sticky; top: 0; z-index: 1; padding: 10px 14px; background: #f6f5f2; border-bottom: 1px solid #d8d5ce; }
#admin h1 { margin: 0; font-size: 16px; }
#admin h2 { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6860; }
#admin section { padding: 0 14px 4px; }
#admin .status { margin-top: 4px; color: #6b6860; min-height: 18px; }
#admin .status.ok { color: #2f6b45; }
#admin .status.warn { color: #9e5b1b; }
#admin canvas.map { display: block; width: 100%; border: 1px solid #c9c6bf; background: #a09c94; cursor: crosshair; touch-action: none; }
#admin .hint { color: #6b6860; font-size: 12px; margin: 4px 0; }
#admin label.row { display: grid; grid-template-columns: 130px 1fr 64px; gap: 8px; align-items: center; margin: 5px 0; }
#admin label.row input[type=range] { width: 100%; }
#admin input[type=number], #admin input[type=text] { width: 100%; padding: 3px 5px; border: 1px solid #bdb9b0; border-radius: 3px; font: inherit; background: #fff; }
#admin .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
#admin button { padding: 5px 10px; border: 1px solid #bdb9b0; border-radius: 4px; background: #fff; color: #1d1d1b; font: inherit; cursor: pointer; }
#admin button.primary { background: #1d1d1b; border-color: #1d1d1b; color: #fff; }
#admin button.danger { color: #9e1b1b; }
#admin ul.zones { list-style: none; margin: 6px 0; padding: 0; }
#admin ul.zones li { display: flex; justify-content: space-between; padding: 3px 6px; border-radius: 3px; cursor: pointer; }
#admin ul.zones li.on { background: #e4e0d6; }
#admin ul.zones li span { color: #6b6860; }
#admin .zone { padding: 6px 8px; margin: 6px 0; border: 1px solid #d8d5ce; border-radius: 4px; background: #fff; }
#admin .pair { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
#admin .pair label { display: block; color: #6b6860; font-size: 12px; }
#admin nav { display: flex; gap: 4px; margin-top: 8px; }
#admin nav button { flex: 1; }
#admin nav button.on { background: #1d1d1b; border-color: #1d1d1b; color: #fff; }
#admin [data-tab][hidden] { display: none; }
#admin.folded { width: auto; bottom: auto; }
#admin.folded > :not(header), #admin.folded header > :not(.top) { display: none; }
#admin .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
#admin input[type=color] { width: 100%; height: 24px; padding: 0; border: 1px solid #bdb9b0; }
#admin footer { position: sticky; bottom: 0; padding: 8px 14px; background: #f6f5f2; border-top: 1px solid #d8d5ce; }
`;

// One slider row: [ key path, label, min, max, step, note ].
export const LOOK = [
	[ 'look.lines', 'Rozlišení (řádky)', 0, 720, 10, '0 = plné rozlišení obrazovky' ],
	[ 'look.levels', 'Úrovně barev', 0, 128, 1, '0 = bez omezení barev' ],
	[ 'look.dither', 'Rastr (dither)', 0, 1, 0.05 ],
	[ 'look.grain', 'Zrno', 0, 0.2, 0.005 ],
	[ 'look.contrast', 'Kontrast', 0.5, 2, 0.01 ],
	[ 'look.saturation', 'Sytost', 0, 2, 0.01 ],
	[ 'look.exposure', 'Expozice', 0.2, 3, 0.01 ],
	[ 'look.sun', 'Síla slunce', 0, 3, 0.05 ],
	[ 'look.fog', 'Hustota mlhy', 0.1, 6, 0.05, 'víc = mlha blíž' ],
	[ 'look.snap', 'Chvění vrcholů', 0, 240, 1, 'mřížka, na kterou skáčou vrcholy lidí a holuba; 0 = vypnuto, méně = hrubší' ]
];
const PEOPLE = [
	[ 'people.walkers', 'Chodci', 0, 600, 1 ],
	[ 'people.seatedShare', 'Obsazené židle', 0, 1, 0.05 ],
	[ 'people.benchShare', 'Obsazené lavičky', 0, 1, 0.05 ],
	[ 'people.standing', 'Stojící skupinky', 0, 100, 1 ]
];
const DAY = [
	[ 'day.startHour', 'Denní doba (h)', 0, 23.9, 0.1, 'kdy hra začíná; posunutím se hned přenastaví i hodiny' ],
	[ 'day.minutes', 'Délka dne (min)', 0, 120, 1, '0 = čas stojí' ]
];

// Saves the settings for everyone (PUT to the grid dashboard) or, without it, in this browser. Returns
// 'server', 'local' or '' (not saved: download the JSON).
export async function saveSettings( settings ) {

	const body = JSON.stringify( { version: 1, ...settings }, null, '\t' );
	try {

		const r = await fetch( API_URL, { method: 'PUT', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin' } );
		if ( r.ok ) {

			writeLocal( null );
			return 'server';

		}

	} catch { /* no dashboard behind the game */ }

	return writeLocal( settings ) ? 'local' : '';

}

// The settings as a file to put on the server by hand.
export function downloadSettings( settings ) {

	const a = document.createElement( 'a' );
	a.href = URL.createObjectURL( new Blob( [ JSON.stringify( { version: 1, ...settings }, null, '\t' ) + '\n' ], { type: 'application/json' } ) );
	a.download = 'game-settings.json';
	a.click();
	setTimeout( () => URL.revokeObjectURL( a.href ), 1000 );

}

export const get = ( o, path ) => path.split( '.' ).reduce( ( a, k ) => a?.[ k ], o );
export const set = ( o, path, v ) => {

	const keys = path.split( '.' ), last = keys.pop();
	keys.reduce( ( a, k ) => a[ k ] ??= {}, o )[ last ] = v;

};

export function startAdmin( { bounds, map, life, ps1, day, holub } ) {

	let settings = structuredClone( SETTINGS );
	settings.people.spawnZones ??= [];
	let selected = - 1, pickPigeon = false, dirty = false;

	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.appendChild( style );
	for ( const id of [ 'hud' ] ) document.getElementById( id )?.style.setProperty( 'display', 'none' );

	const panel = document.createElement( 'div' );
	panel.id = 'admin';
	panel.innerHTML = `
		<header>
			<div class="top"><h1>Nastavení hry</h1><button data-fold>Skrýt</button></div>
			<div class="status" data-status></div>
			<nav><button data-show="look" class="on">Vzhled</button><button data-show="map">Mapa a lidé</button><button data-show="pigeon">Holub</button></nav>
		</header>
		<section data-tab="look"><h2>Obraz</h2><div data-look></div>
			<label class="row" title="prázdné = barva podle denní doby"><span>Barva mlhy</span><input type="color" data-fogcolour><label><input type="checkbox" data-fogown> vlastní</label></label>
		</section>
		<section data-tab="look"><h2>Čas</h2><div data-day></div></section>
		<section data-tab="map" hidden>
			<h2>Mapa a místa, kde se lidé objevují</h2>
			<canvas class="map"></canvas>
			<p class="hint">Klik na volné místo přidá zónu · táhnutím ji posuneš · kolečko myši mění dosah · červené tečky jsou chodci teď.</p>
			<ul class="zones" data-zones></ul>
			<div class="zone" data-zone></div>
		</section>
		<section data-tab="map" hidden><h2>Lidé</h2><div data-people></div><p class="hint">Počty lidí se projeví po uložení a novém načtení hry.</p></section>
		<section data-tab="pigeon" hidden>
			<h2>Holub na začátku</h2>
			<div class="pair">
				<div><label>x (m)</label><input type="number" step="1" data-px></div>
				<div><label>z (m)</label><input type="number" step="1" data-pz></div>
				<div><label>směr (°)</label><input type="number" step="1" data-ph></div>
			</div>
			<div class="buttons">
				<button data-pick>Vybrat na mapě</button>
				<button data-here>Kde je holub teď</button>
				<button data-fly>Přesunout holuba</button>
			</div>
		</section>
		<footer>
			<div class="buttons">
				<button class="primary" data-save>Uložit</button>
				<button data-reset>Výchozí hodnoty</button>
				<button data-download>Stáhnout JSON</button>
				<button data-reload>Načíst hru znovu</button>
				${ LOCAL ? '<button data-forget>Zahodit místní nastavení</button>' : '' }
			</div>
		</footer>`;
	document.body.appendChild( panel );
	// Typing in the panel must not steer the pigeon (its keys are on window).
	for ( const type of [ 'keydown', 'keyup' ] ) panel.addEventListener( type, e => e.stopPropagation() );

	const $ = sel => panel.querySelector( sel );
	const status = ( text, kind = '' ) => {

		const el = $( '[data-status]' );
		el.textContent = text;
		el.className = 'status ' + kind;

	};

	status( LOCAL ? 'Načteno nastavení z tohoto prohlížeče (má přednost před serverem).' : SERVER ? 'Načteno nastavení ze serveru.' : 'Výchozí nastavení (na serveru zatím nic uloženo).' );

	// --- applying settings to the running game
	const applyLook = () => {

		ps1?.set( settings.look );
		if ( day ) day.tune = settings.look;

	};
	const applyDay = () => {

		if ( day ) day.minutes = settings.day.minutes;

	};

	let respawnTimer = 0;
	const respawn = () => {

		clearTimeout( respawnTimer );
		respawnTimer = setTimeout( () => life.placeWalkers?.( settings.people.spawnZones ), 120 );

	};

	const changed = () => {

		dirty = true;
		status( 'Neuloženo.', 'warn' );

	};

	// --- slider rows
	const rows = [];
	const addRows = ( host, list, onInput ) => {

		for ( const [ path, label, min, max, step, note ] of list ) {

			const row = document.createElement( 'label' );
			row.className = 'row';
			row.title = note || '';
			row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step}">`;
			const [ range, num ] = row.querySelectorAll( 'input' );
			const write = v => {

				v = Math.min( max, Math.max( min, Number( v ) ) );
				if ( ! Number.isFinite( v ) ) return;
				set( settings, path, v );
				range.value = num.value = v;
				onInput( path, v );
				changed();

			};

			range.addEventListener( 'input', () => write( range.value ) );
			num.addEventListener( 'change', () => write( num.value ) );
			rows.push( () => range.value = num.value = get( settings, path ) );
			host.appendChild( row );

		}

	};

	// Tabs, and folding the panel away to look at the game.
	const tabs = panel.querySelectorAll( '[data-show]' );
	for ( const b of tabs ) b.addEventListener( 'click', () => {

		for ( const t of tabs ) t.classList.toggle( 'on', t === b );
		for ( const sec of panel.querySelectorAll( '[data-tab]' ) ) sec.hidden = sec.dataset.tab !== b.dataset.show;
		if ( b.dataset.show === 'map' ) resize();

	} );
	$( '[data-fold]' ).addEventListener( 'click', () => {

		const folded = panel.classList.toggle( 'folded' );
		$( '[data-fold]' ).textContent = folded ? 'Nastavení' : 'Skrýt';

	} );

	// The fog's colour: the day's own unless "vlastní" is ticked.
	const fogColour = $( '[data-fogcolour]' ), fogOwn = $( '[data-fogown]' );
	const writeFog = () => {

		settings.look.fogColour = fogOwn.checked ? fogColour.value : '';
		applyLook();
		changed();

	};

	fogColour.addEventListener( 'input', () => {

		fogOwn.checked = true;
		writeFog();

	} );
	fogOwn.addEventListener( 'change', writeFog );
	rows.push( () => {

		fogOwn.checked = !! settings.look.fogColour;
		fogColour.value = settings.look.fogColour || '#e7ac78';

	} );

	addRows( $( '[data-people]' ), PEOPLE, () => {} );
	addRows( $( '[data-look]' ), LOOK, applyLook );
	addRows( $( '[data-day]' ), DAY, path => {

		if ( path === 'day.startHour' && day ) day.hour = settings.day.startHour;
		applyDay();

	} );

	// --- the pigeon's start
	const px = $( '[data-px]' ), pz = $( '[data-pz]' ), ph = $( '[data-ph]' );
	const showPigeon = () => {

		const [ x, z, h ] = settings.pigeon.start;
		px.value = Math.round( x );
		pz.value = Math.round( z );
		ph.value = Math.round( h * 180 / Math.PI );

	};

	const setPigeon = ( x, z, h ) => {

		settings.pigeon.start = [ Math.round( x * 10 ) / 10, Math.round( z * 10 ) / 10, Math.round( h * 1e4 ) / 1e4 ];
		showPigeon();
		changed();
		draw();

	};

	for ( const el of [ px, pz, ph ] ) el.addEventListener( 'change', () => setPigeon( Number( px.value ) || 0, Number( pz.value ) || 0, ( Number( ph.value ) || 0 ) * Math.PI / 180 ) );
	$( '[data-pick]' ).addEventListener( 'click', () => {

		pickPigeon = ! pickPigeon;
		$( '[data-pick]' ).textContent = pickPigeon ? 'Klikni do mapy…' : 'Vybrat na mapě';

	} );
	$( '[data-here]' ).addEventListener( 'click', () => holub && setPigeon( holub.pos.x, holub.pos.z, holub.heading ) );
	$( '[data-fly]' ).addEventListener( 'click', () => holub?.place( ...settings.pigeon.start ) );

	// --- the map
	const canvas = $( 'canvas.map' ), ctx = canvas.getContext( '2d' );
	const metresX = bounds.maxX - bounds.minX, metresZ = bounds.maxZ - bounds.minZ;
	const dpr = Math.min( 2, window.devicePixelRatio || 1 );
	let scale = 0; // canvas pixels a metre (0 until the map tab is first shown)

	const resize = () => {

		const w = canvas.clientWidth;
		if ( ! w ) return; // its tab is hidden
		canvas.width = Math.round( w * dpr );
		canvas.height = Math.round( w * metresZ / metresX * dpr );
		scale = canvas.width / metresX;
		draw();

	};

	const toMap = ( x, z ) => [ ( x - bounds.minX ) * scale, ( z - bounds.minZ ) * scale ];
	const fromEvent = e => {

		const r = canvas.getBoundingClientRect();
		return [ bounds.minX + ( e.clientX - r.left ) * dpr / scale, bounds.minZ + ( e.clientY - r.top ) * dpr / scale ];

	};

	// The walk lines, drawn once into their own layer.
	const lines = document.createElement( 'canvas' );
	const drawLines = () => {

		lines.width = canvas.width;
		lines.height = canvas.height;
		const c = lines.getContext( '2d' );
		c.strokeStyle = 'rgba(40, 40, 40, 0.45)';
		c.lineWidth = Math.max( 1, dpr * 0.8 );
		for ( const p of life.walks || [] ) {

			c.beginPath();
			p.pts.forEach( ( [ x, z ], i ) => c[ i ? 'lineTo' : 'moveTo' ]( ...toMap( x, z ) ) );
			c.stroke();

		}

	};

	function draw() {

		if ( ! scale || ! canvas.clientWidth ) return;
		if ( lines.width !== canvas.width ) drawLines();
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage( map, 0, 0, canvas.width, canvas.width * map.height / map.width );
		ctx.drawImage( lines, 0, 0 );

		// Walkers now.
		ctx.fillStyle = '#e0241a';
		const dot = 2.5 * dpr;
		for ( const a of life.agents ) if ( a.walk ) {

			const [ x, y ] = toMap( a.x, a.z );
			ctx.fillRect( x - dot / 2, y - dot / 2, dot, dot );

		}

		// Zones: the circle is the reach (at its edge the zone still adds about a third of its weight).
		settings.people.spawnZones.forEach( ( zn, i ) => {

			const [ x, y ] = toMap( zn.x, zn.z ), on = i === selected;
			ctx.beginPath();
			ctx.arc( x, y, zn.r * scale, 0, Math.PI * 2 );
			ctx.fillStyle = on ? 'rgba(255, 196, 0, 0.22)' : 'rgba(255, 196, 0, 0.12)';
			ctx.fill();
			ctx.lineWidth = ( on ? 2 : 1 ) * dpr;
			ctx.strokeStyle = on ? '#1d1d1b' : 'rgba(29, 29, 27, 0.7)';
			ctx.stroke();
			ctx.fillStyle = '#1d1d1b';
			ctx.fillRect( x - 2 * dpr, y - 2 * dpr, 4 * dpr, 4 * dpr );
			ctx.font = `${11 * dpr}px system-ui, sans-serif`;
			ctx.fillText( `${zn.name || 'zóna'} · ${zn.weight}`, x + 5 * dpr, y - 4 * dpr );

		} );

		// The pigeon's start (arrow along its heading; heading h looks along +z turned by h) and where it is now.
		const arrow = ( x, z, h, colour, size ) => {

			const [ cx, cy ] = toMap( x, z ), fx = Math.sin( h ), fy = Math.cos( h );
			ctx.beginPath();
			ctx.moveTo( cx + fx * size, cy + fy * size );
			ctx.lineTo( cx - fx * size * 0.6 - fy * size * 0.6, cy - fy * size * 0.6 + fx * size * 0.6 );
			ctx.lineTo( cx - fx * size * 0.6 + fy * size * 0.6, cy - fy * size * 0.6 - fx * size * 0.6 );
			ctx.closePath();
			ctx.fillStyle = colour;
			ctx.fill();

		};

		arrow( ...settings.pigeon.start, '#1f4fbf', 8 * dpr );
		if ( holub ) arrow( holub.pos.x, holub.pos.z, holub.heading, 'rgba(31, 79, 191, 0.45)', 5 * dpr );

	}

	const zoneAt = ( x, z ) => {

		// The nearest zone whose centre is within 12 px or whose circle holds the point.
		let best = - 1, bd = Infinity;
		settings.people.spawnZones.forEach( ( zn, i ) => {

			const d = Math.hypot( x - zn.x, z - zn.z );
			if ( ( d < zn.r || d * scale < 12 * dpr ) && d < bd ) {

				bd = d;
				best = i;

			}

		} );
		return best;

	};

	let drag = null;
	canvas.addEventListener( 'pointerdown', e => {

		const [ x, z ] = fromEvent( e );
		if ( pickPigeon ) {

			pickPigeon = false;
			$( '[data-pick]' ).textContent = 'Vybrat na mapě';
			setPigeon( x, z, settings.pigeon.start[ 2 ] );
			return;

		}

		let i = zoneAt( x, z );
		if ( i < 0 ) {

			const zones = settings.people.spawnZones;
			zones.push( { name: `Zóna ${zones.length + 1}`, x: Math.round( x ), z: Math.round( z ), r: 60, weight: 4 } );
			i = zones.length - 1;
			changed();
			respawn();

		}

		selected = i;
		const zn = settings.people.spawnZones[ i ];
		drag = { dx: zn.x - x, dz: zn.z - z, moved: false };
		canvas.setPointerCapture( e.pointerId );
		showZones();
		draw();

	} );
	canvas.addEventListener( 'pointermove', e => {

		if ( ! drag || selected < 0 ) return;
		const [ x, z ] = fromEvent( e ), zn = settings.people.spawnZones[ selected ];
		zn.x = Math.round( x + drag.dx );
		zn.z = Math.round( z + drag.dz );
		drag.moved = true;
		draw();

	} );
	canvas.addEventListener( 'pointerup', () => {

		if ( drag?.moved ) {

			changed();
			respawn();
			showZones();

		}

		drag = null;

	} );
	canvas.addEventListener( 'wheel', e => {

		const [ x, z ] = fromEvent( e ), i = zoneAt( x, z );
		if ( i < 0 ) return;
		e.preventDefault();
		selected = i;
		const zn = settings.people.spawnZones[ i ];
		zn.r = Math.round( Math.min( 600, Math.max( 10, zn.r * ( e.deltaY > 0 ? 0.92 : 1.08 ) ) ) );
		changed();
		respawn();
		showZones();
		draw();

	}, { passive: false } );

	// --- the zone list and the picked zone's fields
	function showZones() {

		const zones = settings.people.spawnZones;
		const list = $( '[data-zones]' );
		list.innerHTML = '';
		zones.forEach( ( zn, i ) => {

			const li = document.createElement( 'li' );
			li.className = i === selected ? 'on' : '';
			li.innerHTML = `<b></b><span>dosah ${zn.r} m · váha ${zn.weight}</span>`;
			li.querySelector( 'b' ).textContent = zn.name || 'zóna';
			li.addEventListener( 'click', () => {

				selected = i;
				showZones();
				draw();

			} );
			list.appendChild( li );

		} );

		const box = $( '[data-zone]' );
		const zn = zones[ selected ];
		box.style.display = zn ? 'block' : 'none';
		if ( ! zn ) return;
		box.innerHTML = `
			<label class="row"><span>Název</span><input type="text" data-k="name" style="grid-column: span 2"></label>
			<label class="row"><span>Dosah (m)</span><input type="range" min="10" max="600" step="5" data-k="r"><input type="number" min="10" max="600" data-k="r"></label>
			<label class="row"><span>Váha</span><input type="range" min="0" max="30" step="0.5" data-k="weight"><input type="number" min="0" max="30" step="0.5" data-k="weight"></label>
			<div class="pair"><div><label>x (m)</label><input type="number" data-k="x"></div><div><label>z (m)</label><input type="number" data-k="z"></div><div></div></div>
			<div class="buttons"><button class="danger" data-delete>Smazat zónu</button></div>`;
		for ( const el of box.querySelectorAll( '[data-k]' ) ) {

			const k = el.dataset.k;
			el.value = zn[ k ];
			el.addEventListener( el.type === 'range' || el.type === 'text' ? 'input' : 'change', () => {

				zn[ k ] = k === 'name' ? el.value : Number( el.value ) || 0;
				for ( const other of box.querySelectorAll( `[data-k="${k}"]` ) ) if ( other !== el ) other.value = zn[ k ];
				changed();
				if ( k !== 'name' ) respawn();
				const li = list.children[ selected ];
				li.querySelector( 'b' ).textContent = zn.name || 'zóna';
				li.querySelector( 'span' ).textContent = `dosah ${zn.r} m · váha ${zn.weight}`;
				draw();

			} );

		}

		box.querySelector( '[data-delete]' ).addEventListener( 'click', () => deleteZone() );

	}

	const deleteZone = () => {

		if ( selected < 0 ) return;
		settings.people.spawnZones.splice( selected, 1 );
		selected = - 1;
		changed();
		respawn();
		showZones();
		draw();

	};

	panel.addEventListener( 'keydown', e => {

		if ( ( e.key === 'Delete' || e.key === 'Backspace' ) && e.target === panel && selected >= 0 ) deleteZone();

	} );
	panel.tabIndex = - 1;
	canvas.addEventListener( 'pointerdown', () => panel.focus( { preventScroll: true } ) );

	// --- save, reset, download
	const showAll = () => {

		rows.forEach( f => f() );
		showPigeon();
		showZones();
		draw();

	};

	const download = () => downloadSettings( settings );

	$( '[data-save]' ).addEventListener( 'click', async () => {

		status( 'Ukládám…' );
		const where = await saveSettings( settings );
		if ( where === 'server' ) status( 'Uloženo na server. Platí pro všechny hráče.', 'ok' );
		else if ( where === 'local' ) status( 'Server není k dispozici: uloženo jen v tomto prohlížeči. Soubor pro server: Stáhnout JSON.', 'warn' );
		else status( 'Nepodařilo se uložit. Stáhněte JSON.', 'warn' );
		dirty = false;

	} );
	$( '[data-reset]' ).addEventListener( 'click', () => {

		settings = merge( DEFAULTS, null );
		delete settings.version;
		selected = - 1;
		applyLook();
		applyDay();
		if ( day ) day.hour = settings.day.startHour;
		respawn();
		showAll();
		changed();
		status( 'Výchozí hodnoty. Uložením je potvrdíte.', 'warn' );

	} );
	$( '[data-download]' ).addEventListener( 'click', download );
	$( '[data-reload]' ).addEventListener( 'click', () => location.reload() );
	$( '[data-forget]' )?.addEventListener( 'click', () => {

		writeLocal( null );
		location.reload();

	} );
	window.addEventListener( 'beforeunload', e => {

		if ( dirty ) e.preventDefault();

	} );

	delete settings.version;
	new ResizeObserver( resize ).observe( canvas );
	resize();
	showAll();
	setInterval( draw, 500 ); // the walkers move

	// For tests and the console.
	window.__admin = { get settings() {

		return settings;

	}, toClient: ( x, z ) => {

		const r = canvas.getBoundingClientRect();
		return [ r.left + ( x - bounds.minX ) * scale / dpr, r.top + ( z - bounds.minZ ) * scale / dpr ];

	} };

}
