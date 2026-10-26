// Letím jak holub: you are a city pigeon on Betlémské náměstí. Walk, take off, fly over the roofs and land on
// them, sit, peck at the leftovers people drop round the café terraces, benches and bins, and let one go on the
// people below. The look: a late golden hour, warm haze, chunky pixels (rendered at low resolution, scaled up
// without smoothing), after the "how Prague must feel like" PS2-era renders.

import * as THREE from 'three/webgpu';
import { makePigeon } from './pigeon.js';
import { ART } from './ps1.js';
import { getHud } from '../hud.js';
import { SETTINGS } from '../settings.js';

// How the pigeon flies, tunable in the game settings (`pigeon`, admin page ?admin, tab Holub). A city pigeon
// cruises at about 40 km/h; the rest is what felt calm and easy to steer.
export const FLIGHT = {
	speed: 10, // cruising airspeed, m/s (W flaps up to 1.45 × that, S slows to half)
	turn: 1.1, // the fastest turn, rad/s
	bank: 24, // how far it leans into a turn, degrees
	camDistance: 2.2, // the camera behind the bird in flight, m (it trails a little further when fast)
	camLag: 0.45 // how long the camera takes to swing back behind after a turn, s
};

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

// [ name, geometry, colour, photo ]: the photo (public/models/props, from the owner's texture set) is stretched
// over the blocky shape when the art direction asks for it (game settings, art.photoFood).
export const FOOD = [
	[ 'rohlík', () => new THREE.CapsuleGeometry( 0.025, 0.07, 3, 6 ).rotateZ( Math.PI / 2 ), 0xd9a45b, 'rohlik' ],
	[ 'hranolka', () => new THREE.BoxGeometry( 0.012, 0.012, 0.08 ), 0xf2cc4a ],
	[ 'preclík', () => new THREE.TorusGeometry( 0.035, 0.012, 4, 8, Math.PI * 1.3 ).rotateX( Math.PI / 2 ), 0x8a4f22 ],
	[ 'trdelník', () => new THREE.CylinderGeometry( 0.03, 0.03, 0.06, 7, 1, true ).rotateZ( Math.PI / 2 ), 0xb7742e, 'trdelnik' ],
	[ 'drobky', () => new THREE.DodecahedronGeometry( 0.018 ), 0xe9cf9a ]
];

const photos = new Map();
export function foodMaterial( colour, photo, usePhoto = ART.photoFood ) {

	const m = new THREE.MeshStandardNodeMaterial( { color: colour, roughness: 0.7, flatShading: true, emissive: colour, emissiveIntensity: 0.18 } );
	if ( usePhoto && photo ) {

		if ( ! photos.has( photo ) ) {

			const t = new THREE.TextureLoader().load( `models/props/${photo}.jpg` );
			t.colorSpace = THREE.SRGBColorSpace;
			t.magFilter = t.minFilter = THREE.NearestFilter;
			t.generateMipmaps = false;
			photos.set( photo, t );

		}

		m.map = photos.get( photo );
		m.color.setHex( 0xffffff );
		m.emissiveIntensity = 0.06;

	}

	return m;

}

function scatterFood( scene, spots, surfaceAt, rnd ) {

	const items = [];
	for ( const [ x, z ] of spots ) {

		const [ name, geo, colour, photo ] = FOOD[ Math.floor( rnd() * FOOD.length ) ];
		const m = new THREE.Mesh( geo(), foodMaterial( colour, photo ) );
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

export function startHolub( { scene, camera, dom, roofGeo, bounds, groundHeight, waterLevel, places, furniture, life, start, indoors = () => false, solids = null } ) {

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
	// Inside a walk-in room (the pub, the večerka…) the floor; elsewhere the street or the roof over it. A tram's or a
	// car's roof (src/solids.js) counts too, for a bird at `y` no lower than a little under it: one that flies or
	// walks into the side of a tram meets a wall, one on the street under a tram passing over stays on the street.
	const cityAt = ( x, z ) => indoors( x, z ) ? groundHeight( x, z ) : Math.max( groundHeight( x, z ), roofAt( x, z ) );
	const surfaceAt = ( x, z, y = Infinity ) => {

		const s = cityAt( x, z ), t = solids ? solids.top( x, z ) : - Infinity;
		return t > s && y >= t - 0.6 ? t : s;

	};
	const shove = [ 0, 0 ];
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
	bird.scale.setScalar( 1.15 * ( ART.pigeon?.size ?? 1 ) ); // a little larger than life, to read on screen (× the art direction's size)
	scene.add( bird );

	// State.
	const pos = new THREE.Vector3( start[ 0 ], 0, start[ 1 ] );
	pos.y = surfaceAt( pos.x, pos.z );
	const vel = new THREE.Vector3();
	const tune = Object.assign( {}, FLIGHT, SETTINGS.pigeon );
	let airspeed = 6, vy = 0, turnRate = 0, liftoff = 0, airTime = 0, landed = false, lookedAt = 0, mode = 'walk', heading = start[ 2 ], yaw = start[ 2 ] + Math.PI, pitch = 0.3, dist = 0.95, idle = 0;
	let peck = 0, pecking = 0, poop = 0, poopCooldown = 0, bank = 0, height = 0;
	const slide = new THREE.Vector3(); // what is left of the speed just after touching down
	const keys = new Set();
	const score = { food: 0, drops: 0, hits: 0 };
	const drops = [], splats = [];
	const splatMat = new THREE.MeshStandardNodeMaterial( { color: 0xf3f1ea, roughness: 0.35 } );
	const splatDark = new THREE.MeshStandardNodeMaterial( { color: 0x6f6a58, roughness: 0.6 } );
	const dropGeo = new THREE.SphereGeometry( 0.018, 6, 4 );

	// --- HUD (src/hud.js): the tally in a corner, and what the bird says (the keys: src/main.js).
	const hud = getHud();
	const toast = document.createElement( 'div' );
	Object.assign( toast.style, { position: 'fixed', left: '50%', top: '18%', transform: 'translateX(-50%)', font: '32px/1 \'Pixelify Sans\', system-ui, sans-serif', color: '#ffd34a', textShadow: '-2px 0 #000, 2px 0 #000, 0 -2px #000, 0 2px #000, 4px 4px 0 #000', opacity: 0, transition: 'opacity .3s', pointerEvents: 'none', zIndex: 3 } );
	document.body.appendChild( toast );
	let toastTimer = 0;
	const say = text => {

		toast.textContent = text;
		toast.style.opacity = 1;
		toastTimer = 1.4;

	};

	const showScore = () => {

		hud.tally( [ [ 'DROBKY', `${score.food}/${foodTotal}` ], [ 'BOBKY', score.drops ], [ 'ZÁSAHY', score.hits ] ] );

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

		const css = ( el, st ) => Object.assign( el.style, st );
		const pad = document.createElement( 'div' ), knob = document.createElement( 'div' );
		css( pad, { position: 'fixed', left: '22px', bottom: '22px', width: '140px', height: '140px', borderRadius: '50%', background: 'rgba(16,20,30,0.45)', border: '4px solid #000', boxShadow: '0 0 0 2px #f4ecd2', zIndex: 5, touchAction: 'none' } );
		css( knob, { position: 'absolute', left: '45px', top: '45px', width: '50px', height: '50px', borderRadius: '50%', background: '#ffd34a', border: '3px solid #000', boxSizing: 'border-box', pointerEvents: 'none' } );
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
			b.innerHTML = `<div style="font-size:24px;line-height:1">${label}</div><div style="font:16px/1 'Pixelify Sans',system-ui,sans-serif;margin-top:2px">${title}</div>`;
			css( b, { width: '68px', height: '68px', boxSizing: 'border-box', display: 'grid', placeContent: 'center', textAlign: 'center', background: 'rgba(16,20,30,0.7)', border: '3px solid #000', boxShadow: 'inset -3px -3px 0 rgba(0,0,0,0.4), inset 3px 3px 0 rgba(255,255,255,0.12)', color: '#f4ecd2', userSelect: 'none', webkitUserSelect: 'none', touchAction: 'none' } );
			b.addEventListener( 'touchstart', e => {

				e.preventDefault();
				b.style.background = 'rgba(196,86,47,0.9)';
				if ( hold ) keys.add( hold );
				tap?.();

			}, { passive: false } );
			const up = e => {

				e.preventDefault();
				b.style.background = 'rgba(16,20,30,0.7)';
				if ( hold ) keys.delete( hold );

			};
			b.addEventListener( 'touchend', up );
			b.addEventListener( 'touchcancel', up );
			bar.appendChild( b );

		};
		button( '🕊️', 'letět', { hold: 'Space' } );
		button( '⬇️', 'dolů', { hold: 'KeyC', tap: () => {

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

			// Off the edge, wings open: a slow glide out that picks up speed.
			mode = 'glide';
			airspeed = 4;
			vy = - 0.5;
			liftoff = 0;
			airTime = 0;
			slide.set( 0, 0, 0 );
			vel.set( Math.sin( heading ) * airspeed, vy, Math.cos( heading ) * airspeed );

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
		// Keys still held from the flight (S to land) don't walk the bird off once it is down; let go first.
		if ( mode === 'walk' || mode === 'sit' ) {

			if ( ! ix && ! iz ) landed = false;
			else if ( landed ) ix = iz = 0;

		}

		let speed = 0;

		if ( ( mode === 'walk' || mode === 'sit' ) && solids ) {

			// On a tram's roof the bird rides along, turning with it; on the street a vehicle shoves it aside.
			const ride = solids.carry( pos.x, pos.z, pos.y );
			if ( ride ) {

				pos.x = ride[ 0 ];
				pos.z = ride[ 1 ];
				heading += ride[ 2 ];
				yaw += ride[ 2 ];

			} else {

				const [ dx, dz ] = solids.push( pos.x, pos.z, pos.y, 0.15, dt, shove );
				pos.x += dx;
				pos.z += dz;

			}

		}

		if ( mode === 'walk' || mode === 'sit' ) {

			if ( keys.has( 'Space' ) ) {

				// A hop and a few hard wingbeats up to about head height, then the bird levels off by itself.
				mode = 'fly';
				vy = 2.6;
				airspeed = 3.5;
				liftoff = 0.6;
				airTime = 0;
				turnRate = 0;
				bank = 0;
				slide.set( 0, 0, 0 );
				heading = Math.atan2( fwd.x, fwd.z );
				vel.set( Math.sin( heading ) * airspeed, vy, Math.cos( heading ) * airspeed );
				say( 'Frrr!' );
				emit( 'takeoff' );

			} else if ( mode === 'walk' && slide.lengthSq() > 0.01 ) {

				// Just landed: the last of the speed runs out in a few quick steps.
				if ( ! tryMove( pos.x + slide.x * dt, pos.z ) ) slide.x = 0;
				if ( mode === 'walk' && ! tryMove( pos.x, pos.z + slide.z * dt ) ) slide.z = 0;
				slide.multiplyScalar( Math.exp( - 5 * dt ) );
				speed = slide.length();

			} else if ( mode === 'walk' && ( ix || iz ) && pecking <= 0 ) {

				want.copy( fwd ).multiplyScalar( iz ).addScaledVector( right, ix ).normalize();
				speed = fast ? 2.4 : 1.0;
				heading = Math.atan2( want.x, want.z );
				if ( ! tryMove( pos.x + want.x * speed * dt, pos.z ) ) speed *= 0.5;
				if ( ! tryMove( pos.x, pos.z + want.z * speed * dt ) ) speed *= 0.5;
				emit( 'walk', speed * dt );

			} else if ( mode === 'sit' && ( ix || iz ) ) mode = 'walk';

			if ( mode === 'walk' || mode === 'sit' ) pos.y = surfaceAt( pos.x, pos.z, pos.y );
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

			// Flight, calm and forgiving: the bird keeps its own heading, airspeed and climb, every input eases in and
			// out, and with nothing pressed it flies straight and level at a pigeon's cruising speed (~40 km/h).
			// A/D turn, leaning into the turn; W flaps (a little faster, climbing gently); S slows down and, slow,
			// sinks; Space flaps up; C or Shift glides down. Slow and low over a roof, a ledge or the pavement, it
			// flares and lands by itself. The mouse only swings the camera round, which drifts back behind.
			const damp = ( a, b, k ) => a + ( b - a ) * ( 1 - Math.exp( - k * dt ) );
			const up = keys.has( 'Space' ), down = keys.has( 'KeyC' ) || keys.has( 'ShiftLeft' ) || keys.has( 'ShiftRight' );
			const flap = up || iz > 0;
			const cruise = tune.speed;
			liftoff -= dt;
			airTime += dt;
			const water = overWater( pos.x, pos.z );
			height = pos.y - ( water ? waterLevel + 0.6 : surfaceAt( pos.x, pos.z ) );
			// Landing: near something to stand on and slow (S), coming down, or just slow a while after taking off,
			// the bird brakes and settles on it.
			const flare = liftoff <= 0 && ! flap && ! water && height < 2.5 && ( vy < - 0.3 || iz < 0 || airTime > 2.5 && airspeed < cruise * 0.6 );

			let target = iz > 0 ? cruise * 1.45 : iz < 0 ? cruise * 0.5 : cruise;
			if ( down && iz >= 0 ) target *= 1.15; // gliding down picks up a little speed
			if ( flare ) target = Math.min( target, 3.5 );
			airspeed = damp( airspeed, target, flare || iz < 0 ? 1.3 : target > airspeed ? 0.8 : 0.5 );

			// Held slow (S), the wings hold less: below about 80 % of cruise the bird sinks gently.
			const sink = iz >= 0 ? 0 : THREE.MathUtils.clamp( ( cruise * 0.8 - airspeed ) / ( cruise * 0.3 ), 0, 1 ) * 1.2;
			let wantVy = up ? 3 : iz > 0 ? 1.2 : down ? - 3.5 : - sink;
			if ( liftoff > 0 ) wantVy = Math.max( wantVy, 2.2 );
			if ( flare ) wantVy = Math.max( wantVy, - Math.max( 0.6, height * 1.2 ) );
			// A roof or a ledge just ahead and a little higher: the bird lifts over it by itself instead of hitting it.
			const reach = Math.max( 2, airspeed * 0.8 );
			const clear = surfaceAt( pos.x + Math.sin( heading ) * reach, pos.z + Math.cos( heading ) * reach ) + ( flare ? 0 : 0.6 ) - pos.y;
			if ( clear > 0 && clear < 5 ) wantVy = Math.max( wantVy, Math.min( 4, clear / 0.8 ) );
			// A wall too high to lift over: the bird turns away along it, to the nearer open side (the side it is
			// already turning to first), as a bird would, instead of flying into it.
			let avoid = 0;
			if ( clear >= 5 ) {

				const free = a => surfaceAt( pos.x + Math.sin( a ) * reach, pos.z + Math.cos( a ) * reach ) < pos.y - 0.3;
				const first = ix > 0 ? - 1 : ix < 0 ? 1 : ( Math.sign( turnRate ) || 1 );
				avoid = first * 1.6;
				for ( let k = 1; k <= 6; k ++ ) {

					if ( free( heading + first * k * 0.25 ) ) {

						avoid = first * k * 0.25;
						break;

					}

					if ( free( heading - first * k * 0.25 ) ) {

						avoid = - first * k * 0.25;
						break;

					}

				}

			}

			vy = damp( vy, wantVy, 2.2 );

			// Turning: the turn eases in and out, and the bird leans into it (left turn, left wing down) by an angle
			// that follows the turn. The camera does not roll with it: the horizon stays level.
			turnRate = damp( turnRate, THREE.MathUtils.clamp( - ix * tune.turn + avoid * 2, - tune.turn * 1.4, tune.turn * 1.4 ), 2.5 );
			heading += turnRate * dt;
			bank = damp( bank, - THREE.MathUtils.clamp( turnRate / Math.max( 0.1, tune.turn ), - 1.2, 1.2 ) * THREE.MathUtils.degToRad( tune.bank ), 4 );
			mode = flap || liftoff > 0 || flare ? 'fly' : 'glide';

			vel.set( Math.sin( heading ) * airspeed, vy, Math.cos( heading ) * airspeed );
			const nx = pos.x + vel.x * dt, nz = pos.z + vel.z * dt;
			let ny = pos.y + vel.y * dt;
			// Walls: no flying through a house; the bird slides along it, losing a little speed. A low edge (a
			// cornice, a ridge just above) it simply hops over.
			let scraped = false;
			const sx = surfaceAt( nx, pos.z );
			if ( sx <= ny - 0.05 ) pos.x = nx;
			else if ( sx - ny < 0.35 ) {

				ny = sx + 0.05;
				pos.x = nx;

			} else {

				vel.x = 0;
				scraped = true;

			}

			const sz = surfaceAt( pos.x, nz );
			if ( sz <= ny - 0.05 ) pos.z = nz;
			else if ( sz - ny < 0.35 ) {

				ny = sz + 0.05;
				pos.z = nz;

			} else {

				vel.z = 0;
				scraped = true;

			}

			// Along a wall, the bird turns to fly with it rather than pressing into it.
			if ( scraped ) {

				// The open direction nearest the heading, a step away, and the bird swings round to it quickly.
				airspeed *= Math.exp( - 0.4 * dt );
				const open = o => surfaceAt( pos.x + Math.sin( heading + o ) * 1.2, pos.z + Math.cos( heading + o ) * 1.2 ) < ny - 0.05;
				const side = Math.sign( turnRate ) || 1;
				for ( let k = 1; k <= 10; k ++ ) {

					const o = open( side * k * 0.3 ) ? side * k * 0.3 : open( - side * k * 0.3 ) ? - side * k * 0.3 : 0;
					if ( o ) {

						heading += o * ( 1 - Math.exp( - 4 * dt ) );
						break;

					}

				}

			}
			pos.x = THREE.MathUtils.clamp( pos.x, bounds.minX + 1, bounds.maxX - 1 );
			pos.z = THREE.MathUtils.clamp( pos.z, bounds.minZ + 1, bounds.maxZ - 1 );
			const onWater = overWater( pos.x, pos.z );
			const floor = onWater ? waterLevel + 0.6 : surfaceAt( pos.x, pos.z );
			ny = Math.min( ny, floor + 160 );
			// Landing on a slope (a roof) the bird may hover just above it: close enough counts as down.
			if ( ny <= floor || flare && ny - floor < 0.15 && ! onWater ) {

				ny = floor;
				if ( onWater || flap || liftoff > 0 ) vy = Math.max( vy, onWater ? 1 : 0 ); // skims along
				else if ( airspeed < 7.5 ) {

					// Down: the rest of the speed runs out in a few steps on the ground.
					mode = 'walk';
					landed = true;
					slide.set( vel.x, 0, vel.z ).multiplyScalar( 0.4 );
					vel.set( 0, 0, 0 );
					vy = turnRate = bank = 0;
					emit( 'land', roofAt( pos.x, pos.z ) - groundHeight( pos.x, pos.z ) );

				} else {

					// Too fast to stand: a soft bounce, a little slower each time.
					vy = 1.2;
					airspeed *= 0.7;

				}

			}

			pos.y = ny;
			// The camera swings back behind the bird when the mouse has been still for a moment, lagging a little
			// in turns so the motion shows; it looks slightly down on the bird, a bit more when it climbs.
			if ( performance.now() - lookedAt > 900 ) {

				const d = THREE.MathUtils.euclideanModulo( heading + Math.PI - yaw + Math.PI, Math.PI * 2 ) - Math.PI;
				yaw += d * ( 1 - Math.exp( - dt / Math.max( 0.05, tune.camLag ) ) );
				pitch = damp( pitch, 0.28 + THREE.MathUtils.clamp( vy, - 4, 4 ) * 0.03, 1.5 );

			}

			speed = vel.length();

		}

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
		const d = flying ? tune.camDistance * dist / 0.95 : dist;
		camTarget.set( pos.x, pos.y + ( flying ? 0.25 : 0.22 ), pos.z );
		let k = d;
		for ( ; k > 0.35; k -= 0.15 ) {

			camPos.copy( camTarget ).addScaledVector( look, - k );
			if ( surfaceAt( camPos.x, camPos.z ) < camPos.y - 0.1 ) break;

		}

		camPos.copy( camTarget ).addScaledVector( look, - k );
		camPos.y = Math.max( camPos.y, ( overWater( camPos.x, camPos.z ) ? waterLevel : surfaceAt( camPos.x, camPos.z ) ) + 0.12 );
		camera.position.lerp( camPos, 1 - Math.exp( - ( flying ? 10 : 10 ) * dt ) );
		// A touch wider when fast, never more than a few degrees.
		const fov = 62 + ( flying ? THREE.MathUtils.clamp( ( airspeed - tune.speed * 0.5 ) * 0.4, 0, 5 ) : 0 );
		if ( Math.abs( camera.fov - fov ) > 0.05 ) {

			camera.fov += ( fov - camera.fov ) * ( 1 - Math.exp( - 3 * dt ) );
			camera.updateProjectionMatrix();

		}
		camera.lookAt( camTarget );
		void t;

	}

	// Crumbs the story puts down (round a point), the same kind as the leftovers in the streets.
	const addFood = ( x, z, n, spread = 0.8 ) => {

		const more = scatterFood( scene, Array.from( { length: n }, () => [ x + ( rnd() - 0.5 ) * spread * 2, z + ( rnd() - 0.5 ) * spread * 2 ] ), surfaceAt, rnd );
		food.push( ...more );
		return more;

	};

	return { update, pos, keys, bird, on: f => listeners.push( f ), addFood, surfaceAt, roofAt, say,
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

	}, score,
	// The flight numbers, live (the admin page writes into them), and the state for tests.
	tune, get flight() {

		return { mode, airspeed, vy, bank, turnRate, height, y: pos.y, heading };

	} };

}
