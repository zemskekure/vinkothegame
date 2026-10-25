// Letím jak holub: you are a city pigeon on Betlémské náměstí. Walk, take off, fly over the roofs and land on
// them, sit, peck at the leftovers people drop round the café terraces, benches and bins, and let one go on the
// people below. The look: a late golden hour, warm haze, chunky pixels (rendered at low resolution, scaled up
// without smoothing), after the "how Prague must feel like" PS2-era renders.

import * as THREE from 'three/webgpu';
import { makePigeon } from './pigeon.js';

// --- the look ---------------------------------------------------------------------------------------------------

// The sun low in the west-north-west, as on a summer evening (scene frame: azimuth from +z, south, towards +x).
export const HOLUB_SUN = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 81 ), THREE.MathUtils.degToRad( 252 ) );
export const PIXEL_SCALE = 0.42; // of the device's pixel ratio: big, visible pixels

export function holubLook( { renderer, scene, sky, sun, hemi, camera } ) {

	renderer.toneMappingExposure = 0.92;
	renderer.domElement.style.imageRendering = 'pixelated';
	sky.turbidity.value = 9;
	sky.rayleigh.value = 3.2;
	sky.mieCoefficient.value = 0.009;
	sky.mieDirectionalG.value = 0.93;
	sun.color.setHex( 0xffae63 );
	sun.intensity = 3.6;
	hemi.color.setHex( 0xf3c9a0 );
	hemi.groundColor.setHex( 0x5b4636 );
	hemi.intensity = 0.7;
	scene.fog = new THREE.Fog( 0xe7ac78, 90, 1000 );
	scene.environmentIntensity = 0.25;
	camera.near = 0.05;
	camera.far = 4000;
	camera.fov = 62;
	camera.updateProjectionMatrix();

}

// --- where a pigeon can stand: the street, or a roof ------------------------------------------------------------

// Highest roof surface on a 0.5 m grid, rasterised once from the roof triangles.
function roofGrid( roofGeo, bounds ) {

	const C = 0.5, W = Math.ceil( ( bounds.maxX - bounds.minX ) / C ), H = Math.ceil( ( bounds.maxZ - bounds.minZ ) / C );
	const grid = new Float32Array( W * H ).fill( - Infinity );
	const p = roofGeo.attributes.position;
	for ( let t = 0; t < p.count; t += 3 ) {

		const ax = p.getX( t ), ay = p.getY( t ), az = p.getZ( t ), bx = p.getX( t + 1 ), by = p.getY( t + 1 ), bz = p.getZ( t + 1 ), cx = p.getX( t + 2 ), cy = p.getY( t + 2 ), cz = p.getZ( t + 2 );
		const det = ( bz - cz ) * ( ax - cx ) + ( cx - bx ) * ( az - cz );
		if ( Math.abs( det ) < 1e-9 ) continue;
		const c0 = Math.max( 0, Math.floor( ( Math.min( ax, bx, cx ) - bounds.minX ) / C ) ), c1 = Math.min( W - 1, Math.ceil( ( Math.max( ax, bx, cx ) - bounds.minX ) / C ) );
		const r0 = Math.max( 0, Math.floor( ( Math.min( az, bz, cz ) - bounds.minZ ) / C ) ), r1 = Math.min( H - 1, Math.ceil( ( Math.max( az, bz, cz ) - bounds.minZ ) / C ) );
		for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

			const x = bounds.minX + ( c + 0.5 ) * C, z = bounds.minZ + ( r + 0.5 ) * C;
			const l0 = ( ( bz - cz ) * ( x - cx ) + ( cx - bx ) * ( z - cz ) ) / det, l1 = ( ( cz - az ) * ( x - cx ) + ( ax - cx ) * ( z - cz ) ) / det, l2 = 1 - l0 - l1;
			if ( l0 < - 0.02 || l1 < - 0.02 || l2 < - 0.02 ) continue;
			const y = l0 * ay + l1 * by + l2 * cy, i = r * W + c;
			if ( y > grid[ i ] ) grid[ i ] = y;

		}

	}

	return ( x, z ) => {

		const c = Math.floor( ( x - bounds.minX ) / C ), r = Math.floor( ( z - bounds.minZ ) / C );
		return c < 0 || r < 0 || c >= W || r >= H ? - Infinity : grid[ r * W + c ];

	};

}

// --- leftovers ----------------------------------------------------------------------------------------------------

const FOOD = [
	[ 'rohlík', () => new THREE.CapsuleGeometry( 0.025, 0.07, 3, 6 ).rotateZ( Math.PI / 2 ), 0xd9a45b ],
	[ 'hranolka', () => new THREE.BoxGeometry( 0.012, 0.012, 0.08 ), 0xf2cc4a ],
	[ 'preclík', () => new THREE.TorusGeometry( 0.035, 0.012, 4, 8, Math.PI * 1.3 ).rotateX( Math.PI / 2 ), 0x8a4f22 ],
	[ 'trdelník', () => new THREE.CylinderGeometry( 0.03, 0.03, 0.06, 7, 1, true ).rotateZ( Math.PI / 2 ), 0xb7742e ],
	[ 'drobky', () => new THREE.DodecahedronGeometry( 0.018 ), 0xe9cf9a ]
];

function scatterFood( scene, spots, surfaceAt, rnd ) {

	const items = [];
	for ( const [ x, z ] of spots ) {

		const [ name, geo, colour ] = FOOD[ Math.floor( rnd() * FOOD.length ) ];
		const m = new THREE.Mesh( geo(), new THREE.MeshStandardNodeMaterial( { color: colour, roughness: 0.7, flatShading: true, emissive: colour, emissiveIntensity: 0.18 } ) );
		const fx = x + ( rnd() - 0.5 ) * 1.6, fz = z + ( rnd() - 0.5 ) * 1.6;
		m.position.set( fx, surfaceAt( fx, fz ) + 0.02, fz );
		m.rotation.y = rnd() * Math.PI * 2;
		m.castShadow = true;
		m.userData.name = name;
		scene.add( m );
		items.push( m );

	}

	return items;

}

// --- the game -----------------------------------------------------------------------------------------------------

export function startHolub( { scene, camera, dom, roofGeo, bounds, groundHeight, waterLevel, places, furniture, life, start, indoors = () => false } ) {

	// What happens, for the story (src/holub/story.js): 'peck' (food name), 'takeoff', 'land' (height above the street),
	// 'walk' (metres), 'drop', 'hit'.
	const listeners = [];
	const emit = ( type, value ) => {

		for ( const f of listeners ) f( type, value );

	};
	// While locked (inside the egg), input moves nothing; the story drives the camera.
	let locked = false;

	let seed = 7;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	const roofAt = roofGrid( roofGeo, bounds );
	// Inside a walk-in room (the pub, the večerka…) the floor; elsewhere the street or the roof over it.
	const surfaceAt = ( x, z ) => indoors( x, z ) ? groundHeight( x, z ) : Math.max( groundHeight( x, z ), roofAt( x, z ) );
	const overWater = ( x, z ) => surfaceAt( x, z ) < waterLevel + 0.3;

	// Leftovers round the terrace tables, benches and bins (more where people sit).
	const spots = [];
	for ( const [ x, , z ] of places?.seats || [] ) if ( rnd() < 0.35 ) spots.push( [ x, z ] );
	for ( let i = 0; i < ( furniture.bench?.length || 0 ); i += 5 ) if ( rnd() < 0.6 ) spots.push( [ furniture.bench[ i ], furniture.bench[ i + 2 ] ] );
	for ( let i = 0; i < ( furniture.bin?.length || 0 ); i += 5 ) if ( rnd() < 0.7 ) spots.push( [ furniture.bin[ i ], furniture.bin[ i + 2 ] ] );
	for ( let k = 0; k < 14; k ++ ) spots.push( [ - 66 + ( rnd() - 0.5 ) * 14, 59 + ( rnd() - 0.5 ) * 5 ] ); // under Oliva Nera's terrace
	const food = scatterFood( scene, spots.filter( ( [ x, z ] ) => ! overWater( x, z ) ), surfaceAt, rnd );
	const foodTotal = food.length;

	// In flight, a soft dark spot on whatever is below: where you are, and where a dropping will land.
	const aim = new THREE.Mesh( new THREE.CircleGeometry( 0.35, 16 ).rotateX( - Math.PI / 2 ), new THREE.MeshBasicNodeMaterial( { color: 0x1a1008, transparent: true, opacity: 0.35, depthWrite: false } ) );
	aim.renderOrder = 2;
	scene.add( aim );

	const bird = makePigeon();
	bird.scale.setScalar( 1.15 ); // a little larger than life, to read on screen
	scene.add( bird );

	// State.
	const pos = new THREE.Vector3( start[ 0 ], 0, start[ 1 ] );
	pos.y = surfaceAt( pos.x, pos.z );
	const vel = new THREE.Vector3();
	let turnRate = 0, lookedAt = 0, mode = 'walk', heading = start[ 2 ], yaw = start[ 2 ] + Math.PI, pitch = 0.3, dist = 0.95, idle = 0;
	let peck = 0, pecking = 0, poop = 0, poopCooldown = 0, bank = 0, lastYaw = yaw;
	const keys = new Set();
	const score = { food: 0, drops: 0, hits: 0 };
	const drops = [], splats = [];
	const splatMat = new THREE.MeshStandardNodeMaterial( { color: 0xf3f1ea, roughness: 0.35 } );
	const splatDark = new THREE.MeshStandardNodeMaterial( { color: 0x6f6a58, roughness: 0.6 } );
	const dropGeo = new THREE.SphereGeometry( 0.018, 6, 4 );

	// --- HUD
	const hud = document.getElementById( 'hud' );
	hud.innerHTML = `<h1>Letím jak holub</h1><p id="help">Klikni do obrazu · myš kamera · WASD chůze, v letu A/D zatáčení, W rychleji, S pomaleji · mezerník vzlétnout a mávat · C dolů / sednout · E zobnout · Q bobek · Shift rychleji</p><p id="score"></p>`;
	const scoreEl = document.getElementById( 'score' );
	const toast = document.createElement( 'div' );
	Object.assign( toast.style, { position: 'fixed', left: '50%', top: '18%', transform: 'translateX(-50%)', font: '700 26px/1 system-ui, sans-serif', color: '#fff3d6', textShadow: '0 2px 0 #3b2412, 0 0 12px #000', opacity: 0, transition: 'opacity .3s', pointerEvents: 'none' } );
	document.body.appendChild( toast );
	let toastTimer = 0;
	const say = text => {

		toast.textContent = text;
		toast.style.opacity = 1;
		toastTimer = 1.4;

	};

	const showScore = () => {

		scoreEl.textContent = `🍞 ${score.food} / ${foodTotal}   ·   💩 ${score.drops}   ·   🎯 ${score.hits}`;

	};

	showScore();

	// --- input
	dom.addEventListener( 'click', () => {

		if ( document.pointerLockElement !== dom && matchMedia( '(pointer: fine)' ).matches ) dom.requestPointerLock();

	} );
	document.addEventListener( 'mousemove', e => {

		if ( document.pointerLockElement !== dom ) return;
		yaw -= e.movementX * 0.0024;
		pitch = THREE.MathUtils.clamp( pitch + e.movementY * 0.0024, - 0.9, 1.35 );
		lookedAt = performance.now();

	} );
	dom.addEventListener( 'wheel', e => {

		dist = THREE.MathUtils.clamp( dist * ( e.deltaY > 0 ? 1.12 : 0.89 ), 0.5, 14 );

	}, { passive: true } );
	const peckNow = () => {

		idle = 0;
		if ( mode === 'fly' || mode === 'glide' ) return;
		mode = 'walk';
		pecking = 0.35;

	};
	const poopNow = () => {

		idle = 0;
		if ( poopCooldown <= 0 ) dropOne();

	};
	const sitToggle = () => {

		idle = 0;
		if ( mode === 'walk' ) mode = 'sit';
		else if ( mode === 'sit' ) mode = 'walk';

	};
	window.addEventListener( 'keydown', e => {

		keys.add( e.code );
		idle = 0;
		if ( e.code === 'KeyE' ) peckNow();
		if ( e.code === 'KeyQ' ) poopNow();
		if ( e.code === 'KeyC' ) sitToggle();
		if ( e.code === 'Space' ) e.preventDefault();

	} );
	window.addEventListener( 'keyup', e => keys.delete( e.code ) );
	window.addEventListener( 'blur', () => keys.clear() );

	// --- touch: a joystick bottom left (walk, or steer in flight; pushed to the rim, faster), drag anywhere else to
	// look, and big thumb buttons bottom right: fly (hold to flap and climb), down (hold in flight; tap on the
	// ground to sit), peck, poop.
	const stick = { x: 0, y: 0, id: null };
	const isTouch = matchMedia( '(pointer: coarse)' ).matches || navigator.maxTouchPoints > 0 && ! matchMedia( '(pointer: fine)' ).matches;
	if ( isTouch ) {

		document.getElementById( 'help' ).textContent = 'Joystick vlevo: chůze a let · táhni prstem: rozhlížení · tlačítka vpravo';
		hud.style.maxWidth = 'calc(100vw - 170px)';
		hud.style.fontSize = '12px';
		Object.assign( document.getElementById( 'place' ).style, { top: '118px', bottom: 'auto', left: '12px', right: 'auto', transform: 'none', fontSize: '13px' } );
		const css = ( el, st ) => Object.assign( el.style, st );
		const pad = document.createElement( 'div' ), knob = document.createElement( 'div' );
		css( pad, { position: 'fixed', left: '22px', bottom: '22px', width: '140px', height: '140px', borderRadius: '50%', background: 'rgba(30,20,12,0.28)', border: '2px solid rgba(255,236,200,0.45)', zIndex: 5, touchAction: 'none' } );
		css( knob, { position: 'absolute', left: '45px', top: '45px', width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(255,236,200,0.75)', pointerEvents: 'none' } );
		pad.appendChild( knob );
		document.body.appendChild( pad );
		const setStick = t => {

			const r = pad.getBoundingClientRect(), R = r.width / 2;
			let dx = ( t.clientX - r.left - R ) / R, dy = ( t.clientY - r.top - R ) / R;
			const m = Math.hypot( dx, dy );
			if ( m > 1 ) {

				dx /= m;
				dy /= m;

			}

			stick.x = dx;
			stick.y = - dy;
			knob.style.left = `${45 + dx * 45}px`;
			knob.style.top = `${45 + dy * 45}px`;

		};
		pad.addEventListener( 'touchstart', e => {

			e.preventDefault();
			const t = e.changedTouches[ 0 ];
			stick.id = t.identifier;
			setStick( t );

		}, { passive: false } );
		pad.addEventListener( 'touchmove', e => {

			e.preventDefault();
			for ( const t of e.changedTouches ) if ( t.identifier === stick.id ) setStick( t );

		}, { passive: false } );
		const release = e => {

			for ( const t of e.changedTouches ) if ( t.identifier === stick.id ) {

				stick.id = null;
				stick.x = stick.y = 0;
				knob.style.left = knob.style.top = '45px';

			}

		};
		pad.addEventListener( 'touchend', release );
		pad.addEventListener( 'touchcancel', release );

		// Buttons: hold ones press a key while held; tap ones act once.
		const bar = document.createElement( 'div' );
		css( bar, { position: 'fixed', right: '16px', bottom: '22px', display: 'grid', gridTemplateColumns: '68px 68px', gap: '12px', zIndex: 5 } );
		document.body.appendChild( bar );
		const button = ( label, title, { hold, tap } ) => {

			const b = document.createElement( 'div' );
			b.innerHTML = `<div style="font-size:26px;line-height:1">${label}</div><div style="font-size:10px;margin-top:2px">${title}</div>`;
			css( b, { width: '68px', height: '68px', borderRadius: '50%', display: 'grid', placeContent: 'center', textAlign: 'center', background: 'rgba(30,20,12,0.45)', border: '2px solid rgba(255,236,200,0.6)', color: '#fff3d6', userSelect: 'none', webkitUserSelect: 'none', touchAction: 'none' } );
			b.addEventListener( 'touchstart', e => {

				e.preventDefault();
				b.style.background = 'rgba(255,190,110,0.6)';
				if ( hold ) keys.add( hold );
				tap?.();

			}, { passive: false } );
			const up = e => {

				e.preventDefault();
				b.style.background = 'rgba(30,20,12,0.45)';
				if ( hold ) keys.delete( hold );

			};
			b.addEventListener( 'touchend', up );
			b.addEventListener( 'touchcancel', up );
			bar.appendChild( b );

		};
		button( '🕊️', 'letět', { hold: 'Space' } );
		button( '⬇️', 'dolů / sednout', { hold: 'KeyC', tap: () => {

			if ( mode !== 'fly' && mode !== 'glide' ) sitToggle();

		} } );
		button( '🍞', 'zobnout', { tap: peckNow } );
		button( '💩', 'bobek', { tap: poopNow } );

		// Look: drag on the view (any finger not on the joystick or a button).
		let lookId = null, lx = 0, ly = 0;
		dom.addEventListener( 'touchstart', e => {

			const t = e.changedTouches[ 0 ];
			if ( lookId === null ) {

				lookId = t.identifier;
				lx = t.clientX;
				ly = t.clientY;

			}

		}, { passive: true } );
		dom.addEventListener( 'touchmove', e => {

			for ( const t of e.changedTouches ) if ( t.identifier === lookId ) {

				yaw -= ( t.clientX - lx ) * 0.006;
				pitch = THREE.MathUtils.clamp( pitch + ( t.clientY - ly ) * 0.005, - 0.9, 1.35 );
				lx = t.clientX;
				ly = t.clientY;

			}

		}, { passive: true } );
		const lookEnd = e => {

			for ( const t of e.changedTouches ) if ( t.identifier === lookId ) lookId = null;

		};
		dom.addEventListener( 'touchend', lookEnd );
		dom.addEventListener( 'touchcancel', lookEnd );

	}

	const tailPos = new THREE.Vector3();
	function dropOne() {

		poopCooldown = 0.7;
		poop = 1;
		tailPos.set( 0, 0.16, - 0.22 ).applyMatrix4( bird.matrixWorld );
		const m = new THREE.Mesh( dropGeo, splatMat );
		m.position.copy( tailPos );
		scene.add( m );
		drops.push( { m, v: vel.clone().multiplyScalar( 0.85 ).add( new THREE.Vector3( 0, - 0.4, 0 ) ), checked: new Set() } );
		score.drops ++;
		showScore();

	}

	function splat( x, y, z ) {

		const g = new THREE.Group();
		const n = 9, shape = new THREE.Shape();
		for ( let k = 0; k <= n; k ++ ) {

			const a = k / n * Math.PI * 2, r = 0.05 + rnd() * 0.05;
			if ( k === 0 ) shape.moveTo( Math.cos( a ) * r, Math.sin( a ) * r );
			else shape.lineTo( Math.cos( a ) * r, Math.sin( a ) * r );

		}

		const white = new THREE.Mesh( new THREE.ShapeGeometry( shape ).rotateX( - Math.PI / 2 ), splatMat );
		const dark = new THREE.Mesh( new THREE.CircleGeometry( 0.022, 6 ).rotateX( - Math.PI / 2 ).translate( 0.008, 0.002, - 0.005 ), splatDark );
		g.add( white, dark );
		g.position.set( x, y + 0.012, z );
		g.rotation.y = rnd() * 6;
		scene.add( g );
		splats.push( g );
		if ( splats.length > 300 ) scene.remove( splats.shift() );

	}

	// --- update
	const look = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3();
	const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
	const tryMove = ( nx, nz ) => {

		// Walking: the step up from here may be a kerb, not a wall; dropping off a roof edge starts a glide.
		const here = surfaceAt( pos.x, pos.z ), there = surfaceAt( nx, nz );
		if ( there - here > 0.32 || overWater( nx, nz ) || nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ ) return false;
		pos.x = nx;
		pos.z = nz;
		if ( here - there > 0.6 ) {

			mode = 'glide';
			vel.set( Math.sin( heading ) * 2, 0, Math.cos( heading ) * 2 );

		}

		return true;

	};

	function update( dt ) {

		if ( locked ) {

			bird.visible = false;
			aim.visible = false;
			return;

		}

		bird.visible = true;
		poopCooldown -= dt;
		poop = Math.max( 0, poop - dt * 2.5 );
		toastTimer -= dt;
		if ( toastTimer <= 0 ) toast.style.opacity = 0;
		const fast = keys.has( 'ShiftLeft' ) || keys.has( 'ShiftRight' ) || Math.hypot( stick.x, stick.y ) > 0.95;
		look.set( - Math.sin( yaw ) * Math.cos( pitch ), - Math.sin( pitch ), - Math.cos( yaw ) * Math.cos( pitch ) );
		fwd.set( - Math.sin( yaw ), 0, - Math.cos( yaw ) );
		right.set( - fwd.z, 0, fwd.x );
		let ix = ( keys.has( 'KeyD' ) ? 1 : 0 ) - ( keys.has( 'KeyA' ) ? 1 : 0 ), iz = ( keys.has( 'KeyW' ) ? 1 : 0 ) - ( keys.has( 'KeyS' ) ? 1 : 0 );
		if ( Math.hypot( stick.x, stick.y ) > 0.15 ) {

			ix = stick.x;
			iz = stick.y;
			// In flight, the stick also turns: sideways steers the view (and so the bird) round.

		}
		let speed = 0;

		if ( mode === 'walk' || mode === 'sit' ) {

			if ( keys.has( 'Space' ) ) {

				mode = 'fly';
				vel.copy( fwd ).multiplyScalar( 2.5 ).setY( 3.2 );
				say( 'Frrr!' );
				emit( 'takeoff' );

			} else if ( mode === 'walk' && ( ix || iz ) && pecking <= 0 ) {

				want.copy( fwd ).multiplyScalar( iz ).addScaledVector( right, ix ).normalize();
				speed = fast ? 2.4 : 1.0;
				heading = Math.atan2( want.x, want.z );
				if ( ! tryMove( pos.x + want.x * speed * dt, pos.z ) ) speed *= 0.5;
				if ( ! tryMove( pos.x, pos.z + want.z * speed * dt ) ) speed *= 0.5;
				emit( 'walk', speed * dt );

			} else if ( mode === 'sit' && ( ix || iz ) ) mode = 'walk';

			if ( mode === 'walk' || mode === 'sit' ) pos.y = surfaceAt( pos.x, pos.z );
			idle = speed > 0 || pecking > 0 ? 0 : idle + dt;
			if ( mode === 'walk' && idle > 9 ) mode = 'sit';

			// Pecking: eat what lies under the beak.
			if ( pecking > 0 ) {

				pecking -= dt;
				peck = Math.sin( Math.max( 0, pecking ) / 0.35 * Math.PI );
				if ( pecking < 0.18 && pecking + dt >= 0.18 ) {

					const bx = pos.x + Math.sin( heading ) * 0.2, bz = pos.z + Math.cos( heading ) * 0.2;
					const i = food.findIndex( f => Math.hypot( f.position.x - bx, f.position.z - bz ) < 0.4 && Math.abs( f.position.y - pos.y ) < 0.4 );
					if ( i >= 0 ) {

						say( `Mňam! ${food[ i ].userData.name}` );
						scene.remove( food[ i ] );
						food.splice( i, 1 );
						score.food ++;
						showScore();
						emit( 'peck', food.length ? 1 : 0 );
						if ( ! food.length ) say( 'Všechno snědeno! Holub roku.' );

					}

				}

			} else peck = 0;

		} else {

			// Flight, steered by the keys alone (the mouse only moves the camera round the bird): A/D turn the bird, W
			// flies faster, S slower, Space flaps upwards, C comes down; without wingbeats, a slow sinking glide.
			const flapping = keys.has( 'Space' ) || iz > 0;
			turnRate += ( - ix * 1.9 - turnRate ) * Math.min( 1, 6 * dt );
			heading += turnRate * dt;
			const target = iz > 0 ? ( fast ? 19 : 11 ) : ( iz < 0 ? 2 : 6 );
			want.set( Math.sin( heading ) * target, iz <= 0 ? - 1.3 : 0, Math.cos( heading ) * target );
			vel.lerp( want, Math.min( 1, 1.8 * dt ) );
			if ( keys.has( 'Space' ) ) vel.y += 11 * dt;
			if ( keys.has( 'KeyC' ) ) vel.y -= 10 * dt;
			vel.y = THREE.MathUtils.clamp( vel.y, - 9, 6 );
			mode = flapping ? 'fly' : 'glide';

			const nx = pos.x + vel.x * dt, nz = pos.z + vel.z * dt;
			let ny = pos.y + vel.y * dt;
			// Walls: no flying through a house; slide along it.
			if ( surfaceAt( nx, pos.z ) <= ny - 0.05 ) pos.x = nx; else vel.x *= - 0.2;
			if ( surfaceAt( pos.x, nz ) <= ny - 0.05 ) pos.z = nz; else vel.z *= - 0.2;
			pos.x = THREE.MathUtils.clamp( pos.x, bounds.minX + 1, bounds.maxX - 1 );
			pos.z = THREE.MathUtils.clamp( pos.z, bounds.minZ + 1, bounds.maxZ - 1 );
			const floor = overWater( pos.x, pos.z ) ? waterLevel + 0.6 : surfaceAt( pos.x, pos.z );
			ny = Math.min( ny, floor + 160 );
			if ( ny <= floor ) {

				ny = floor;
				if ( overWater( pos.x, pos.z ) ) vel.y = Math.max( vel.y, 1.5 );
				else if ( vel.y <= 0.5 && ! keys.has( 'Space' ) ) {

					mode = 'walk';
					vel.set( 0, 0, 0 );
					emit( 'land', roofAt( pos.x, pos.z ) - groundHeight( pos.x, pos.z ) );

				}

			}

			pos.y = ny;
			bank += ( THREE.MathUtils.clamp( turnRate * 0.35, - 0.8, 0.8 ) - bank ) * Math.min( 1, 5 * dt );
			// The camera swings back behind the bird when the mouse has been still for a moment.
			if ( performance.now() - lookedAt > 1200 ) {

				const d = THREE.MathUtils.euclideanModulo( heading + Math.PI - yaw + Math.PI, Math.PI * 2 ) - Math.PI;
				yaw += d * Math.min( 1, 2.2 * dt );

			}
			speed = vel.length();

		}

		lastYaw = yaw;

		// Droppings: fall, check for a person on the way down, splat on what they hit.
		for ( let i = drops.length - 1; i >= 0; i -- ) {

			const d = drops[ i ];
			d.v.y -= 9.8 * dt;
			d.m.position.addScaledVector( d.v, dt );
			const p = d.m.position;
			for ( const a of life.agents || [] ) {

				if ( d.checked.has( a ) ) continue;
				if ( Math.abs( a.x - p.x ) < 0.35 && Math.abs( a.z - p.z ) < 0.35 && p.y < a.y + 1.85 && p.y > a.y + 1.2 ) {

					d.checked.add( a );
					score.hits ++;
					showScore();
					emit( 'hit' );
					say( [ 'Zásah!', 'Na hlavu!', 'Prý to nosí štěstí.', 'Bingo!' ][ score.hits % 4 ] );
					scene.remove( d.m );
					drops.splice( i, 1 );
					break;

				}

			}

			if ( ! drops.includes( d ) ) continue;
			const ground = surfaceAt( p.x, p.z );
			if ( p.y <= ground || p.y < waterLevel ) {

				if ( p.y >= waterLevel - 0.1 && ground > waterLevel ) splat( p.x, ground, p.z );
				scene.remove( d.m );
				drops.splice( i, 1 );

			}

		}

		// The bird.
		bird.position.copy( pos );
		bird.rotation.y = heading;
		bird.userData.animate( dt, { mode, speed, peck, poop, bank, climb: THREE.MathUtils.clamp( vel.y / 6, - 1, 1 ) } );
		bird.updateMatrixWorld();

		aim.visible = ( mode === 'fly' || mode === 'glide' ) && ! overWater( pos.x, pos.z );
		if ( aim.visible ) {

			aim.position.set( pos.x, surfaceAt( pos.x, pos.z ) + 0.03, pos.z );
			aim.scale.setScalar( 1 + Math.min( 3, ( pos.y - aim.position.y ) * 0.06 ) );

		}

		// Food: turning slowly so it catches the light from the air.
		const t = performance.now() / 1000;
		for ( const f of food ) f.rotation.y += dt * 0.6;

		// Camera: behind the bird, closer on the ground, further in flight; kept out of the houses.
		const flying = mode === 'fly' || mode === 'glide';
		const d = dist * ( flying ? 1.9 : 1 );
		camTarget.set( pos.x, pos.y + ( flying ? 0.25 : 0.22 ), pos.z );
		let k = d;
		for ( ; k > 0.35; k -= 0.15 ) {

			camPos.copy( camTarget ).addScaledVector( look, - k );
			if ( surfaceAt( camPos.x, camPos.z ) < camPos.y - 0.1 ) break;

		}

		camPos.copy( camTarget ).addScaledVector( look, - k );
		camPos.y = Math.max( camPos.y, ( overWater( camPos.x, camPos.z ) ? waterLevel : surfaceAt( camPos.x, camPos.z ) ) + 0.12 );
		camera.position.lerp( camPos, Math.min( 1, ( flying ? 6 : 10 ) * dt ) );
		camera.lookAt( camTarget );
		void t;

	}

	// Crumbs the story puts down (round a point), the same kind as the leftovers in the streets.
	const addFood = ( x, z, n, spread = 0.8 ) => {

		const more = scatterFood( scene, Array.from( { length: n }, () => [ x + ( rnd() - 0.5 ) * spread * 2, z + ( rnd() - 0.5 ) * spread * 2 ] ), surfaceAt, rnd );
		food.push( ...more );
		return more;

	};

	return { update, pos, keys, on: f => listeners.push( f ), addFood, surfaceAt, roofAt, say,
		set locked( v ) {

			locked = v;
			if ( v ) keys.clear();

		}, get locked() {

			return locked;

		}, place: ( x, z, h ) => {

			pos.set( x, surfaceAt( x, z ), z );
			heading = h;
			yaw = h + Math.PI;
			mode = 'walk';
			vel.set( 0, 0, 0 );

		}, get mode() {

			return mode;

		}, look: ( y, p ) => {

		yaw = y;
		pitch = p;

	}, get heading() {

		return heading;

	}, get yaw() {

		return yaw;

	}, score };

}
