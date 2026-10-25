// The pigeon's first day: you hatch from an egg in a nest on a cornice above Betlémské náměstí, then a short
// tutorial (walk, peck, fly, land on another roof, the first well-aimed dropping) opens the city. Progress is kept
// in the browser; ?vejce starts from the egg again.

import * as THREE from 'three/webgpu';

const KEY = 'holub-story';
const STEPS = [
	{ id: 'egg', text: 'Jsi ve vejci. Klubej se: mačkej <b>mezerník</b>.' },
	{ id: 'walk', text: 'Ahoj světe! Rozhlédni se myší a projdi se po hnízdě (<b>WASD</b>).' },
	{ id: 'peck', text: 'Máš hlad. Sezob tři drobky (<b>E</b>).', need: 3 },
	{ id: 'fly', text: 'Teď to hlavní: vzlétni (<b>mezerník</b>, drž ho a mávej).' },
	{ id: 'land', text: 'Doleť na jinou střechu a přistaň (pusť klávesy, nebo <b>C</b> dolů).' },
	{ id: 'hit', text: 'Poslední zkouška: najdi turistu a trefuj (<b>Q</b>).' },
	{ id: 'free', text: 'Praha je tvoje. Hledej drobky, poznávej město. <i>Prý tu jsou i tajemství…</i>' }
];

export function startStory( { scene, camera, holub, start } ) {

	const params = new URLSearchParams( location.search );
	let step = 0;
	try {

		step = params.has( 'vejce' ) ? 0 : Math.min( STEPS.length - 1, Number( localStorage.getItem( KEY ) ) || 0 );

	} catch { /* private mode: start from the egg */ }

	const save = () => {

		try {

			localStorage.setItem( KEY, String( step ) );

		} catch { /* not kept */ }

	};

	// The nest: the nearest roof at least 6 m above the street to the start, on a 1 m spiral.
	const [ sx, sz ] = start;
	const ground = holub.surfaceAt( sx, sz );
	let nest = [ sx, sz ];
	search: for ( let r = 0; r < 40; r ++ ) {

		for ( let a = 0; a < Math.max( 1, r * 8 ); a ++ ) {

			const t = a / Math.max( 1, r * 8 ) * Math.PI * 2, x = sx + Math.cos( t ) * r, z = sz + Math.sin( t ) * r;
			if ( holub.roofAt( x, z ) > ground + 6 ) {

				nest = [ x, z ];
				break search;

			}

		}

	}

	const nestY = holub.surfaceAt( nest[ 0 ], nest[ 1 ] );

	// Straw ring and the egg.
	const nestGroup = new THREE.Group();
	nestGroup.position.set( nest[ 0 ], nestY, nest[ 1 ] );
	const straw = new THREE.MeshStandardNodeMaterial( { color: 0xb38a4a, roughness: 1, flatShading: true } );
	nestGroup.add( new THREE.Mesh( new THREE.TorusGeometry( 0.2, 0.07, 5, 12 ).rotateX( Math.PI / 2 ).translate( 0, 0.05, 0 ), straw ) );
	for ( let k = 0; k < 9; k ++ ) {

		const twig = new THREE.Mesh( new THREE.CylinderGeometry( 0.008, 0.008, 0.3, 3 ), straw );
		twig.position.set( Math.cos( k ) * 0.2, 0.06, Math.sin( k ) * 0.2 );
		twig.rotation.set( Math.PI / 2, 0, k * 0.7 );
		nestGroup.add( twig );

	}

	const shell = new THREE.MeshStandardNodeMaterial( { color: 0xf1ece0, roughness: 0.5, flatShading: true } );
	const eggBottom = new THREE.Mesh( new THREE.SphereGeometry( 0.06, 10, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55 ), shell );
	const eggTop = new THREE.Mesh( new THREE.SphereGeometry( 0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45 ), shell );
	const egg = new THREE.Group();
	egg.add( eggBottom, eggTop );
	egg.scale.set( 1, 1.3, 1 );
	egg.position.y = 0.1;
	nestGroup.add( egg );
	scene.add( nestGroup );

	// The objective panel.
	const panel = document.createElement( 'div' );
	Object.assign( panel.style, { position: 'fixed', left: '50%', bottom: '74px', transform: 'translateX(-50%)', maxWidth: 'min(620px, calc(100vw - 32px))', padding: '10px 16px', background: 'rgba(30, 20, 12, 0.72)', color: '#fff3d6', borderRadius: '10px', font: '16px/1.4 system-ui, sans-serif', textAlign: 'center', pointerEvents: 'none', transition: 'opacity .4s' } );
	document.body.appendChild( panel );
	const show = () => {

		const s = STEPS[ step ];
		panel.innerHTML = s.need ? `${s.text} <span style="opacity:.7">(${count}/${s.need})</span>` : s.text;

	};

	let count = 0, walked = 0, cracks = 0, wobble = 0, orbit = 0, hatchedAt = - 1;
	const next = () => {

		step = Math.min( STEPS.length - 1, step + 1 );
		count = 0;
		save();
		show();
		if ( STEPS[ step ].id === 'free' ) setTimeout( () => {

			panel.style.opacity = 0;

		}, 9000 );

	};

	const hatch = () => {

		hatchedAt = performance.now();
		holub.locked = false;
		holub.place( nest[ 0 ], nest[ 1 ], Math.PI );
		holub.addFood( nest[ 0 ], nest[ 1 ], 5, 1.2 );
		holub.say( 'Píp!' );
		next();

	};

	if ( step === 0 ) {

		holub.locked = true;
		window.addEventListener( 'keydown', function crack( e ) {

			if ( e.code !== 'Space' || step !== 0 ) return;
			cracks ++;
			wobble = 1;
			if ( cracks >= 6 ) {

				window.removeEventListener( 'keydown', crack );
				hatch();

			}

		} );

	} else {

		// Coming back: no egg, the bird starts on the nest.
		egg.visible = false;
		holub.place( nest[ 0 ], nest[ 1 ], Math.PI );

	}

	holub.on( ( type, value ) => {

		const id = STEPS[ step ].id;
		if ( id === 'walk' && type === 'walk' ) {

			walked += value;
			if ( walked > 0.8 ) next();

		} else if ( id === 'peck' && type === 'peck' ) {

			count ++;
			show();
			if ( count >= STEPS[ step ].need ) next();

		} else if ( id === 'fly' && type === 'takeoff' ) next();
		else if ( id === 'land' && type === 'land' && value > 4 && Math.hypot( holub.pos.x - nest[ 0 ], holub.pos.z - nest[ 1 ] ) > 15 ) next();
		else if ( id === 'hit' && type === 'hit' ) next();

	} );

	show();

	function update( dt ) {

		if ( step === 0 ) {

			// Inside the egg: the camera circles the nest; each press shakes the egg and opens a crack.
			orbit += dt * 0.25;
			wobble = Math.max( 0, wobble - dt * 3 );
			egg.rotation.z = Math.sin( performance.now() * 0.04 ) * 0.25 * wobble;
			eggTop.position.y = cracks * 0.004;
			eggTop.rotation.z = cracks * 0.05;
			camera.position.set( nest[ 0 ] + Math.sin( orbit ) * 0.7, nestY + 0.45, nest[ 1 ] + Math.cos( orbit ) * 0.7 );
			camera.lookAt( nest[ 0 ], nestY + 0.08, nest[ 1 ] );

		} else if ( hatchedAt > 0 ) {

			// The shell halves lie where they broke for a while.
			const t = ( performance.now() - hatchedAt ) / 1000;
			eggTop.position.set( 0.08, 0, 0.05 );
			eggTop.rotation.z = 2.4;
			if ( t > 40 ) egg.visible = false;

		}

	}

	return { update, get step() {

		return STEPS[ step ].id;

	} };

}
