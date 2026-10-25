// The city pigeon (Columba livia domestica), low-poly and flat-shaded: blue-grey body, the iridescent green and
// purple neck, two black bars across each wing, dark tail band, orange eyes, the white cere over a dark beak, coral
// legs. About 32 cm from beak to tail. Animated in code: walking with the head thrust forward and back at each
// step, pecking, flapping and gliding, sitting fluffed up with the legs tucked away, and lifting the tail.

import * as THREE from 'three/webgpu';
import { snapVertex } from './ps1.js';

// Its vertices snap to the console's screen grid like everything else alive in the game (src/holub/ps1.js).
const mat = ( hex, extra = {} ) => Object.assign( new THREE.MeshStandardNodeMaterial( { color: hex, roughness: 0.8, flatShading: true, ...extra } ), { vertexNode: snapVertex() } );
const P = {
	body: mat( 0x8c95a4 ),
	back: mat( 0x9aa3b2 ),
	neck: mat( 0x5f7d73, { metalness: 0.35, roughness: 0.45 } ),
	sheen: mat( 0x7a5f8c, { metalness: 0.35, roughness: 0.45 } ),
	head: mat( 0x737c8c ),
	wing: mat( 0x8a93a3 ),
	bar: mat( 0x2a2c33 ),
	tip: mat( 0x3c414c ),
	beak: mat( 0x3a3434 ),
	cere: mat( 0xe9e6dc ),
	eye: mat( 0xe0701e, { roughness: 0.3 } ),
	pupil: mat( 0x111111 ),
	leg: mat( 0xc8574c )
};

const ball = ( r, m, sx = 1, sy = 1, sz = 1, seg = 7 ) => {

	const g = new THREE.Mesh( new THREE.SphereGeometry( r, seg, Math.max( 4, seg - 2 ) ), m );
	g.scale.set( sx, sy, sz );
	g.castShadow = true;
	return g;

};

// One wing, extended along +x (side = 1) or −x: a tapering flat blade with the two black bars and dark primaries.
function wingMesh( side ) {

	const g = new THREE.Group();
	const shape = new THREE.Shape().moveTo( 0, 0.05 ).lineTo( 0.14, 0.06 ).lineTo( 0.27, 0.02 ).lineTo( 0.29, - 0.05 ).lineTo( 0.12, - 0.09 ).lineTo( 0, - 0.07 ).closePath();
	const blade = new THREE.Mesh( new THREE.ExtrudeGeometry( shape, { depth: 0.012, bevelEnabled: false } ).rotateX( Math.PI / 2 ), P.wing );
	blade.castShadow = true;
	g.add( blade );
	for ( const z of [ - 0.035, - 0.06 ] ) {

		const bar = new THREE.Mesh( new THREE.BoxGeometry( 0.09, 0.004, 0.012 ), P.bar );
		bar.position.set( 0.08, 0.006, z );
		g.add( bar );

	}

	const tip = new THREE.Mesh( new THREE.ExtrudeGeometry( new THREE.Shape().moveTo( 0.2, 0.035 ).lineTo( 0.27, 0.02 ).lineTo( 0.29, - 0.05 ).lineTo( 0.2, - 0.075 ).closePath(), { depth: 0.014, bevelEnabled: false } ).rotateX( Math.PI / 2 ), P.tip );
	tip.position.y = 0.001;
	g.add( tip );
	g.scale.x = side;
	return g;

}

export function makePigeon() {

	const root = new THREE.Group(); // at the feet, facing +z
	const body = new THREE.Group(); // tilts and bobs
	root.add( body );

	const torso = ball( 0.1, P.body, 0.9, 0.82, 1.55 );
	torso.position.set( 0, 0.165, - 0.01 );
	torso.rotation.x = - 0.25;
	const back = ball( 0.085, P.back, 0.95, 0.6, 1.3 );
	back.position.set( 0, 0.205, - 0.04 );
	back.rotation.x = - 0.25;
	body.add( torso, back );

	// Neck and head: the head group thrusts forward and back while walking and dips to peck.
	const neck = ball( 0.06, P.neck, 1, 1.15, 0.95 );
	neck.position.set( 0, 0.245, 0.09 );
	const sheen = ball( 0.052, P.sheen, 1.05, 0.8, 0.9 );
	sheen.position.set( 0, 0.225, 0.11 );
	body.add( neck, sheen );

	const head = new THREE.Group();
	head.position.set( 0, 0.29, 0.12 );
	const skull = ball( 0.042, P.head, 0.9, 0.95, 1.05 );
	const beak = new THREE.Mesh( new THREE.ConeGeometry( 0.011, 0.045, 5 ).rotateX( Math.PI / 2 ), P.beak );
	beak.position.set( 0, - 0.008, 0.055 );
	const cere = ball( 0.01, P.cere, 1.1, 0.7, 1.3, 5 );
	cere.position.set( 0, 0.002, 0.04 );
	head.add( skull, beak, cere );
	for ( const s of [ - 1, 1 ] ) {

		const eye = ball( 0.0095, P.eye, 1, 1, 1, 6 );
		eye.position.set( s * 0.032, 0.01, 0.018 );
		const pupil = ball( 0.005, P.pupil, 1, 1, 1, 5 );
		pupil.position.set( s * 0.039, 0.01, 0.02 );
		head.add( eye, pupil );

	}

	body.add( head );

	// Wings: pivots at the shoulders; folded back along the body or spread for flight.
	const wings = [ - 1, 1 ].map( s => {

		// pivot: sweep (folded back or spread) and flap; roll: about the wing's length, so a folded wing stands
		// on edge against the body instead of sticking out flat.
		const pivot = new THREE.Group(), roll = new THREE.Group();
		pivot.position.set( s * 0.072, 0.225, 0.06 );
		roll.add( wingMesh( s ) );
		pivot.add( roll );
		pivot.userData.roll = roll;
		body.add( pivot );
		return pivot;

	} );

	// Tail: a fan with the dark band near its end.
	const tail = new THREE.Group();
	tail.position.set( 0, 0.17, - 0.16 );
	const fan = new THREE.Mesh( new THREE.BoxGeometry( 0.08, 0.012, 0.12 ).translate( 0, 0, - 0.06 ), P.wing );
	const band = new THREE.Mesh( new THREE.BoxGeometry( 0.084, 0.014, 0.025 ).translate( 0, 0, - 0.1 ), P.bar );
	fan.castShadow = true;
	tail.add( fan, band );
	body.add( tail );

	// Legs with three toes forward and one back.
	const legs = [ - 1, 1 ].map( s => {

		const leg = new THREE.Group();
		leg.position.set( s * 0.028, 0.095, 0.0 );
		const shin = new THREE.Mesh( new THREE.CylinderGeometry( 0.006, 0.007, 0.095, 5 ).translate( 0, - 0.0475, 0 ), P.leg );
		leg.add( shin );
		for ( const a of [ - 0.45, 0, 0.45, Math.PI ] ) {

			const toe = new THREE.Mesh( new THREE.BoxGeometry( 0.006, 0.005, a === Math.PI ? 0.025 : 0.035 ).translate( 0, 0, a === Math.PI ? 0.012 : 0.017 ), P.leg );
			toe.position.y = - 0.093;
			toe.rotation.y = a;
			leg.add( toe );

		}

		root.add( leg );
		return leg;

	} );

	root.traverse( o => {

		if ( o.isMesh ) o.castShadow = true;

	} );

	// --- animation state
	let t = 0, flap = 0;
	const set = ( v, k, target, rate, dt ) => {

		v[ k ] += ( target - v[ k ] ) * Math.min( 1, rate * dt );

	};

	/**
	 * mode: 'walk' | 'sit' | 'fly' | 'glide'; speed: ground speed (m/s) when walking; peck 0…1 (head down);
	 * poop 0…1 (tail up); bank: roll in flight (radians).
	 */
	root.userData.animate = ( dt, { mode, speed = 0, peck = 0, poop = 0, bank = 0, climb = 0 } ) => {

		t += dt;
		const flying = mode === 'fly' || mode === 'glide';
		// Legs: alternate swing in step with the head; tucked in sitting and flight.
		const stepRate = 2.4 + speed * 5.5, phase = t * stepRate;
		const walking = mode === 'walk' && speed > 0.05;
		legs.forEach( ( leg, i ) => {

			set( leg.rotation, 'x', walking ? Math.sin( phase + i * Math.PI ) * 0.55 : ( flying ? 1.2 : 0 ), 14, dt );
			set( leg.scale, 'y', mode === 'sit' ? 0.25 : ( flying ? 0.7 : 1 ), 10, dt );

		} );
		// Body: lowered and fluffed when sitting, level in flight.
		set( body.position, 'y', mode === 'sit' ? - 0.085 : ( flying ? 0 : 0 ), 8, dt );
		const fluff = mode === 'sit' ? 1.12 : 1;
		set( body.scale, 'x', fluff, 4, dt );
		set( body.scale, 'z', fluff, 4, dt );
		set( body.rotation, 'x', flying ? 0.15 - climb * 0.35 : ( mode === 'walk' ? Math.sin( phase * 2 ) * 0.03 : 0 ), 6, dt );
		set( body.rotation, 'z', flying ? bank : ( walking ? Math.sin( phase ) * 0.06 : 0 ), 6, dt );
		// Head: the pigeon's thrust (forward, then held still while the body catches up), the peck, a look round.
		const thrust = walking ? ( Math.sin( phase * 2 ) > 0 ? 0.035 : - 0.01 ) : 0;
		set( head.position, 'z', 0.12 + thrust + peck * 0.05, 18, dt );
		set( head.position, 'y', 0.29 - peck * 0.2 + ( mode === 'sit' ? - 0.02 : 0 ), 16, dt );
		set( head.rotation, 'x', peck * 1.1, 16, dt );
		set( head.rotation, 'y', ! flying && ! walking && peck < 0.1 ? Math.sin( t * 0.7 ) * 0.5 * ( Math.sin( t * 0.23 ) > 0.3 ? 1 : 0 ) : 0, 5, dt );
		// Wings: folded (along the back, tips crossing over the tail) or spread; flapping or held for a glide.
		if ( mode === 'fly' ) flap += dt * 17;
		wings.forEach( ( w, i ) => {

			const s = i ? 1 : - 1;
			set( w.rotation, 'y', flying ? s * 0.12 : s * 1.38, 10, dt );
			set( w.rotation, 'x', flying ? 0 : - 0.12, 10, dt );
			set( w.userData.roll.rotation, 'x', flying ? 0 : 1.3, 10, dt );
			const beat = mode === 'fly' ? Math.sin( flap ) * 0.95 : ( mode === 'glide' ? 0.12 : 0.05 );
			w.rotation.z += ( s * beat - w.rotation.z ) * Math.min( 1, 24 * dt );

		} );
		// Tail: fanned in flight, lifted to poop.
		set( tail.rotation, 'x', - poop * 0.7 + ( flying ? 0.1 : 0.15 ), 12, dt );
		set( tail.scale, 'x', flying ? 1.6 : 1, 6, dt );

	};

	return root;

}
