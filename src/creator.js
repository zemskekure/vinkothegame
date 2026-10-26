// The courier's character creator, opened from the start screen (src/start.js): the player as a person of the
// streets (src/persona.js spec, src/people.js body), dressed and shaped by hand on a small turntable drawn at a
// console's resolution. Each line is a picker in the manner of a late-90s options screen: ◀ ▶ (or the arrow keys)
// step through the faces, the hair, the clothes and the body; 🎲 deals a random person by the crowd's own rules.
// The spec is kept in this browser (`vinko.player`) for next time; the game's player wears it (src/player.js).

import * as THREE from 'three/webgpu';
import { BODIES, TOPS, BOTTOMS, loadWardrobe, useWardrobe, applyArt, lookAttribute } from './people.js';
import { rulesFrom, generatePerson, lookOf, buildPerson } from './persona.js';
import { SETTINGS } from './settings.js';
import { SHAPE_NAMES, CATS, BODY_CLOTHES, tilesFor, tileUrl, bodyLoader } from './wardrobe-ui.js';
import { savedPlayer, savePlayer, defaultPlayer } from './player.js';

// The knobs worth having on a console: the main ones of the body's shape, and the height.
const KNOBS = [ 'fat', 'belly', 'head', 'hunch', 'shoulders', 'legs' ];
const KNOB = { min: - 1, max: 1.5, step: 0.1 }, HEIGHT = { min: 1.45, max: 2.05, step: 0.02 };

const STYLE = `
	#creator { position: fixed; inset: 0; z-index: 60; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 440px); gap: 0; color: #f4ecd2;
		font: 16px/1.25 'Pixelify Sans', system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
	#creator .stage { position: relative; display: grid; place-items: center; min-height: 0; }
	#creator .stage canvas { height: min(84vh, 720px); width: auto; aspect-ratio: 2 / 3; image-rendering: pixelated; touch-action: none; cursor: grab; }
	#creator .stage .tag { position: absolute; left: 16px; top: 14px; font-size: 32px; letter-spacing: 0.04em; color: #ffd34a; text-shadow: 3px 3px 0 #000; }
	#creator .stage .tag small { display: block; font-size: 16px; letter-spacing: 0.04em; color: #f4ecd2; text-shadow: 2px 2px 0 #000; }
	#creator .side { display: flex; flex-direction: column; min-height: 0; background: rgba(8, 10, 16, 0.78); border-left: 3px solid #000; }
	#creator .rows { flex: 1; overflow-y: auto; padding: 10px 12px; scrollbar-width: thin; }
	#creator h3 { margin: 12px 4px 4px; font-size: 16px; font-weight: 400; letter-spacing: 0.08em; color: #8fb0cf; text-transform: uppercase; }
	#creator .row { display: grid; grid-template-columns: 104px 34px 1fr 34px; align-items: center; gap: 4px; padding: 3px 4px; border: 2px solid transparent; }
	#creator .row.on { border-color: #ffd34a; background: rgba(255, 211, 74, 0.08); }
	#creator .row .lab { font-size: 16px; text-transform: uppercase; opacity: 0.85; }
	#creator .row button { height: 34px; border: 2px solid #000; background: #2d3d5c; color: #ffd34a; font: inherit; font-size: 16px; cursor: pointer; box-shadow: inset -2px -2px 0 rgba(0,0,0,0.35), inset 2px 2px 0 rgba(255,255,255,0.15); padding: 0; }
	#creator .row button:active { box-shadow: inset 2px 2px 0 rgba(0,0,0,0.35); }
	#creator .val { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 34px; font-size: 16px; text-align: center; overflow: hidden; white-space: nowrap; }
	#creator .val img { width: 30px; height: 30px; image-rendering: pixelated; border: 2px solid #000; object-fit: cover; }
	#creator .val .sw { width: 30px; height: 22px; border: 2px solid #000; }
	#creator .bar { display: flex; gap: 2px; }
	#creator .bar i { width: 9px; height: 16px; background: #2b2c31; border: 1px solid #000; }
	#creator .bar i.f { background: #ffd34a; }
	#creator .bar i.z { background: #8fb0cf; }
	#creator .actions { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 8px; padding: 10px 12px 14px; border-top: 3px solid #000; }
	#creator .actions button { height: 48px; border: 3px solid #000; background: #2d3d5c; color: #f4ecd2; font: inherit; font-size: 16px; cursor: pointer; text-shadow: 2px 2px 0 #000; box-shadow: inset -3px -3px 0 rgba(0,0,0,0.35), inset 3px 3px 0 rgba(255,255,255,0.15); }
	#creator .actions button.play { background: #c4562f; color: #ffd34a; font-size: 24px; }
	#creator .keys { padding: 0 12px 10px; font: 16px/1.3 'Pixelify Sans', system-ui, sans-serif; opacity: 0.6; }
	#creator .busy { position: absolute; bottom: 14px; left: 0; right: 0; text-align: center; font-size: 16px; opacity: 0; transition: opacity 0.2s; text-shadow: 2px 2px 0 #000; }
	#creator .busy.on { opacity: 0.9; }
	@media (max-width: 760px) {
		#creator { grid-template-columns: 1fr; grid-template-rows: 38vh minmax(0, 1fr); }
		#creator .stage canvas { height: 38vh; }
		#creator .side { border-left: 0; border-top: 3px solid #000; }
		#creator .keys { display: none; }
		#creator .row { grid-template-columns: 92px 40px 1fr 40px; }
		#creator .row button { height: 40px; }
	}
`;

// Opens the creator over `host` (the start screen's backdrop shows round it). Resolves with the spec to play, or
// null when the player goes back.
export async function createCharacter( host, { webgl = false } = {} ) {

	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	const root = document.createElement( 'div' );
	root.id = 'creator';
	root.innerHTML = `
		<div class="stage"><div class="tag">KURÝR<small>Kdo dneska rozváží?</small></div><div class="busy">Převlékám…</div></div>
		<div class="side">
			<div class="rows"></div>
			<div class="keys">↑↓ řádek · ←→ změnit · R náhodně · Enter hrát · Esc zpět</div>
			<div class="actions"><button data-back>Zpět</button><button data-dice title="Náhodná postava (R)">🎲</button><button class="play" data-play>Hrát</button></div>
		</div>`;
	host.append( style, root );
	const $ = sel => root.querySelector( sel );
	const busy = $( '.busy' );

	// The turntable: a low-resolution picture (160 × 240), scaled up with hard pixels.
	const W = 160, H = 240;
	const renderer = new THREE.WebGPURenderer( { antialias: false, alpha: true, forceWebGL: webgl } );
	renderer.setPixelRatio( 1 );
	renderer.setSize( W, H, false );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.95;
	$( '.stage' ).prepend( renderer.domElement );
	await renderer.init();

	const scene = new THREE.Scene(); // clear: the start screen's city shows behind
	const camera = new THREE.PerspectiveCamera( 30, W / H, 0.1, 50 );
	camera.position.set( 0, 1.2, 5.4 );
	camera.lookAt( 0, 0.98, 0 );
	const sun = new THREE.DirectionalLight( 0xffe2bd, 2.6 );
	sun.position.set( 2.5, 4, 3.5 );
	scene.add( sun, new THREE.HemisphereLight( 0xdfe6ee, 0x5b4636, 1.1 ) );
	// A paving-stone disc to stand on.
	const disc = new THREE.Mesh( new THREE.CylinderGeometry( 0.62, 0.66, 0.08, 10 ).translate( 0, - 0.04, 0 ), new THREE.MeshStandardNodeMaterial( { color: 0x8d877c, roughness: 0.9, flatShading: true } ) );
	const spin = new THREE.Group();
	spin.add( disc );
	scene.add( spin );

	// The wardrobe and the bodies, as in the streets (the art direction's heads).
	applyArt( SETTINGS.art );
	const wardrobe = await loadWardrobe();
	useWardrobe( wardrobe );
	const body = bodyLoader();
	const rules = rulesFrom( SETTINGS.art );
	const random = () => generatePerson( rules, ( Math.random() * 4294967296 ) >>> 0, wardrobe );

	const spec = savedPlayer() || defaultPlayer( wardrobe );
	spec.colour ??= [ TOPS[ 2 ], BOTTOMS[ 1 ] ];
	spec.shape ??= {};

	// The person on the turntable, standing in the body's idle.
	let shown = null, building = Promise.resolve(), pending = false;
	const show = async () => {

		const b = await body( spec.body );
		const s = buildPerson( spec, b, wardrobe );
		s.mixer.clipAction( b.clips.Idle || b.clips.Walk ).play();
		if ( shown ) spin.remove( shown.object );
		shown = s;
		spin.add( s.object );

	};

	// Rebuilt at most once at a time; the last change wins.
	const rebuild = () => {

		if ( pending ) return building;
		pending = true;
		busy.classList.add( 'on' );
		building = building.then( async () => {

			pending = false;
			await show();
			if ( ! pending ) busy.classList.remove( 'on' );

		} );
		return building;

	};

	// A change of texture only repaints the person.
	const repaint = () => {

		if ( ! shown ) return;
		shown.object.traverse( o => {

			if ( o.isSkinnedMesh ) o.geometry.setAttribute( 'look', lookAttribute( o.geometry, lookOf( spec, wardrobe ) ) );

		} );

	};

	// --- the pickers ---------------------------------------------------------------------------------------------

	const cat = key => CATS.find( c => c[ 0 ] === key );
	const bodiesOf = sex => BODIES.filter( b => b.sex === sex );
	const facesOf = sex => {

		const all = tilesFor( wardrobe, 'faces' ), own = all.filter( f => ! f.sex || f.sex === sex );
		return own.length ? own : all;

	};

	const cycle = ( list, value, d ) => list[ ( ( list.indexOf( value ) + d ) % list.length + list.length ) % list.length ];
	const bar = ( v, min, max ) => {

		const n = 10, f = Math.round( ( v - min ) / ( max - min ) * n ), zero = Math.round( ( 0 - min ) / ( max - min ) * n );
		return `<span class="bar">${Array.from( { length: n }, ( _, i ) => `<i class="${i < f ? 'f' : ''}${min < 0 && i === zero ? ' z' : ''}"></i>` ).join( '' )}</span>`;

	};

	const hex = c => '#' + new THREE.Color().setHex( c ).getHexString();
	// A wardrobe picker: '' (none: a plain colour, or the colours read from the face) and the tiles.
	const tilePicker = ( key, sexed = false ) => {

		const [ , label, kind, part, none ] = cat( key );
		const files = () => [ ...( none ? [ '' ] : [] ), ...( sexed ? facesOf( spec.sex ) : tilesFor( wardrobe, kind, part ) ).map( t => t.file ) ];
		return {
			label: label.replace( / \(.*\)/, '' ),
			show: () => {

				const list = files(), file = spec[ key ] || '', i = list.indexOf( file );
				if ( ! file ) return `<span>${none}</span>`;
				const tile = wardrobe.tiles[ kind ].find( t => t.file === file );
				return `${tile ? `<img alt="" src="${tileUrl( tile, kind )}">` : ''}<span>${i + 1 - ( none ? 1 : 0 )}/${list.length - ( none ? 1 : 0 )}</span>`;

			},
			step: d => {

				spec[ key ] = cycle( files(), spec[ key ] || '', d );
				repaint();

			}
		};

	};

	const colourPicker = ( label, k, palette ) => ( {
		label,
		show: () => `<span class="sw" style="background:${hex( spec.colour[ k ] )}"></span>`,
		step: d => {

			spec.colour[ k ] = cycle( palette, palette.includes( spec.colour[ k ] ) ? spec.colour[ k ] : palette[ 0 ], d );
			repaint();

		}
	} );

	const knob = ( label, { min, max, step }, get, set, format ) => ( {
		label,
		show: () => `${bar( get(), min, max )}${format ? `<span>${format( get() )}</span>` : ''}`,
		step: d => {

			set( Math.round( THREE.MathUtils.clamp( get() + d * step, min, max ) * 1000 ) / 1000 );
			rebuild();

		}
	} );

	const clothesName = file => {

		const [ dir, name ] = file.split( '/' );
		return ( BODY_CLOTHES[ name ] || name ) + ( dir.startsWith( 'modular' ) ? ' II' : '' );

	};

	const groups = [
		[ 'Postava', [
			{
				label: 'Kdo',
				show: () => `<span>${spec.sex === 'f' ? 'žena' : 'muž'}</span>`,
				step: () => {

					// The same clothes on the other body where there are, and a face that goes with it.
					const sex = spec.sex === 'f' ? 'm' : 'f', [ dir, name ] = spec.body.split( '/' );
					const same = dir.replace( sex === 'f' ? 'men' : 'women', sex === 'f' ? 'women' : 'men' ) + '/' + name;
					spec.sex = sex;
					spec.body = ( BODIES.find( b => b.file === same ) || bodiesOf( sex )[ 0 ] ).file;
					const faces = facesOf( sex ).map( t => t.file );
					if ( ! faces.includes( spec.face ) ) spec.face = faces[ Math.floor( Math.random() * faces.length ) ];
					spec.height = Math.round( THREE.MathUtils.clamp( spec.height + ( sex === 'f' ? - 0.12 : 0.12 ), HEIGHT.min, HEIGHT.max ) * 100 ) / 100;
					rebuild();

				}
			},
			{
				label: 'Oblečení',
				show: () => `<span>${clothesName( spec.body )}</span>`,
				step: d => {

					spec.body = cycle( bodiesOf( spec.sex ).map( b => b.file ), spec.body, d );
					rebuild();

				}
			},
			tilePicker( 'face', true ),
			tilePicker( 'hair' ),
			tilePicker( 'skin' )
		] ],
		[ 'Oblečení', [
			tilePicker( 'top' ),
			colourPicker( 'Barva nahoře', 0, TOPS ),
			tilePicker( 'bottom' ),
			colourPicker( 'Barva dole', 1, BOTTOMS )
		] ],
		[ 'Tvar postavy', [
			...KNOBS.map( k => knob( SHAPE_NAMES[ k ].replace( / \(.*\)/, '' ), KNOB, () => spec.shape[ k ] ?? 0, v => spec.shape[ k ] = v ) ),
			knob( 'Výška', HEIGHT, () => spec.height, v => spec.height = v, v => v.toFixed( 2 ).replace( '.', ',' ) + ' m' )
		] ]
	];

	const rows = [];
	const list = $( '.rows' );
	let current = 0;
	for ( const [ title, pickers ] of groups ) {

		const h = document.createElement( 'h3' );
		h.textContent = title;
		list.appendChild( h );
		for ( const picker of pickers ) {

			const el = document.createElement( 'div' );
			el.className = 'row';
			el.innerHTML = `<span class="lab">${picker.label}</span><button data-d="-1" aria-label="předchozí">◀</button><span class="val"></span><button data-d="1" aria-label="další">▶</button>`;
			const i = rows.length;
			el.addEventListener( 'pointerdown', () => select( i, false ) );
			for ( const b of el.querySelectorAll( 'button' ) ) b.addEventListener( 'click', () => change( i, Number( b.dataset.d ) ) );
			list.appendChild( el );
			rows.push( { picker, el } );

		}

	}

	const refresh = () => {

		for ( const [ i, { picker, el } ] of rows.entries() ) {

			el.classList.toggle( 'on', i === current );
			el.querySelector( '.val' ).innerHTML = picker.show();

		}

		savePlayer( spec );

	};

	function select( i, scroll = true ) {

		current = ( i + rows.length ) % rows.length;
		refresh();
		if ( scroll ) rows[ current ].el.scrollIntoView( { block: 'nearest' } );

	}

	function change( i, d ) {

		current = i;
		rows[ i ].picker.step( d );
		refresh();

	}

	const dice = () => {

		const next = random();
		for ( const key of Object.keys( spec ) ) delete spec[ key ];
		Object.assign( spec, next );
		refresh();
		rebuild();

	};

	await show();
	refresh();

	// Turning: by itself, or dragged round.
	let drag = null, frozen = 0;
	const canvas = renderer.domElement;
	canvas.addEventListener( 'pointerdown', e => {

		drag = { id: e.pointerId, x: e.clientX };
		canvas.setPointerCapture( e.pointerId );

	} );
	canvas.addEventListener( 'pointermove', e => {

		if ( ! drag || e.pointerId !== drag.id ) return;
		spin.rotation.y += ( e.clientX - drag.x ) * 0.012;
		drag.x = e.clientX;
		frozen = 2;

	} );
	const endDrag = () => drag = null;
	canvas.addEventListener( 'pointerup', endDrag );
	canvas.addEventListener( 'pointercancel', endDrag );

	const timer = new THREE.Timer();
	renderer.setAnimationLoop( () => {

		timer.update();
		const dt = Math.min( timer.getDelta(), 0.1 );
		frozen = Math.max( 0, frozen - dt );
		if ( ! drag && ! frozen ) spin.rotation.y += dt * 0.5;
		shown?.mixer.update( dt );
		renderer.render( scene, camera );

	} );

	window.__creator = { spec, dice, settled: () => building }; // for screenshots and tests

	return new Promise( resolve => {

		const close = async play => {

			removeEventListener( 'keydown', key, true );
			let out = null;
			if ( play ) {

				await building;
				savePlayer( spec );
				out = structuredClone( spec );

			}

			renderer.setAnimationLoop( null );
			renderer.dispose();
			root.remove();
			style.remove();
			delete window.__creator;
			resolve( out );

		};

		const key = e => {

			const k = e.code;
			if ( k === 'ArrowUp' || k === 'KeyW' ) select( current - 1 );
			else if ( k === 'ArrowDown' || k === 'KeyS' ) select( current + 1 );
			else if ( k === 'ArrowLeft' || k === 'KeyA' ) change( current, - 1 );
			else if ( k === 'ArrowRight' || k === 'KeyD' ) change( current, 1 );
			else if ( k === 'KeyR' ) dice();
			else if ( k === 'Enter' || k === 'NumpadEnter' ) close( true );
			else if ( k === 'Escape' || k === 'Backspace' ) close( false );
			else return;
			e.preventDefault();
			e.stopPropagation();

		};

		addEventListener( 'keydown', key, true );
		$( '[data-back]' ).addEventListener( 'click', () => close( false ) );
		$( '[data-dice]' ).addEventListener( 'click', dice );
		$( '[data-play]' ).addEventListener( 'click', () => close( true ) );

	} );

}
