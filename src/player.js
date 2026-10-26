// The player: a person of the streets (src/persona.js spec, src/people.js skinned body) in place of the walker's
// plain figure (src/figures.js), in every on-foot and scooter mode. Who it is: the person made in the start screen's
// character creator (src/creator.js; kept in this browser as `vinko.player`), or else a man dealt by the crowd's
// rules from a seed of this browser's own, so he stays the same from one visit to the next.
//
// The walker still poses its avatar through `userData.setPose( { phase, stride, t, ride } )`, so the walk, the run
// and the scooter work as they did:
//   - on foot, the body's own Idle / Walk / Run clips blend by the stride, and the walk and run cycles are driven by
//     the walker's step phase (one cycle per two steps), so the feet keep the walker's cadence;
//   - on the scooter, the idle pose with the joints bent by hand: thighs forward along the seat, shins down to the
//     floorboard, the back leaning a little into the ride, the arms out to the handlebars. The hips are set on the
//     seat where the plain figure's were (the walker places the avatar 0.47 m under the seat).
//
// The person is made before the crowd (src/life.js) with a wardrobe of its own: the people's material is made per
// wardrobe (src/people.js useWardrobe), and the crowd's, made after, then serves the crowd.

import * as THREE from 'three/webgpu';
import { BODIES, loadWardrobe, useWardrobe, prepareBody } from './people.js';
import { rulesFrom, generatePerson, buildPerson } from './persona.js';
import { SETTINGS } from './settings.js';

export const PLAYER_KEY = 'vinko.player';
const SEED_KEY = 'vinko.player.seed';

// The person saved by the creator, if any (and still wearable).
export function savedPlayer() {

	try {

		const spec = JSON.parse( localStorage.getItem( PLAYER_KEY ) || 'null' );
		return spec && BODIES.some( b => b.file === spec.body ) ? spec : null;

	} catch {

		return null;

	}

}

export function savePlayer( spec ) {

	try {

		localStorage.setItem( PLAYER_KEY, JSON.stringify( spec ) );

	} catch { /* not kept: private mode */ }

}

// This browser's own man: the same seed every visit (a new one where nothing can be kept).
export function defaultPlayer( wardrobe ) {

	let seed = 0;
	try {

		seed = Number( localStorage.getItem( SEED_KEY ) ) >>> 0;
		if ( ! seed ) {

			seed = ( Math.random() * 4294966295 + 1000 ) >>> 0;
			localStorage.setItem( SEED_KEY, String( seed ) );

		}

	} catch {

		seed ||= ( Math.random() * 4294966295 + 1000 ) >>> 0;

	}

	return generatePerson( rulesFrom( SETTINGS.art ), seed, wardrobe, { sex: 'm' } );

}

// Makes the player's person (null if it can't be made: the plain figure stays). `dress( walker, { ride } )` puts it
// on the walker, on the scooter with `ride`.
export async function makePlayer( loadModel, spec = window.PLAYER_SPEC ) {

	try {

		const wardrobe = await loadWardrobe();
		useWardrobe( wardrobe );
		spec ||= savedPlayer() || defaultPlayer( wardrobe );
		const body = prepareBody( await loadModel( `models/people/${spec.body}.glb`, 'models/people/' ), BODIES.find( b => b.file === spec.body ) );
		const skinned = buildPerson( spec, body, wardrobe );
		return { spec, dress: ( walker, options ) => dress( walker, { body, skinned }, options ) };

	} catch ( e ) {

		console.warn( 'player: kept the plain figure', e );
		return null;

	}

}

const TAU = Math.PI * 2;
const SEAT = 0.47 + 0.09; // the hip joints over the avatar's origin when riding: the seat, plus the thigh's thickness

// Bends on the scooter (rad, about the body's left–right axis; negative swings a limb forward). Bones by three's
// names for them (the model's "UpperLeg.L" loses its dot).
const RIDE = { UpperLegL: - 1.42, UpperLegR: - 1.42, LowerLegL: 1.5, LowerLegR: 1.5, Abdomen: 0.12, UpperArmL: - 0.95, UpperArmR: - 0.95, LowerArmL: - 0.55, LowerArmR: - 0.55 };

function dress( walker, { body, skinned }, { ride = false } = {} ) {

	const { object, mixer } = skinned;
	const avatar = new THREE.Group();
	avatar.add( object );
	avatar.visible = walker.avatar.visible;

	const clips = body.clips;
	const idle = mixer.clipAction( clips.Idle || clips.Walk ).play();
	const walk = mixer.clipAction( clips.Walk ).play();
	const run = mixer.clipAction( clips.Run || clips.Walk ).play();
	// The walk and the run are set by the step phase, not by the clock.
	walk.timeScale = run.timeScale = 0;

	const bones = {};
	object.traverse( o => {

		if ( o.isBone && RIDE[ o.name ] !== undefined ) bones[ o.name ] = o;

	} );

	const axis = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), hip = new THREE.Vector3(), v = new THREE.Vector3();
	// Turns a bone about the body's left–right axis (in the avatar's frame), whatever its own axes are.
	const bend = ( bone, angle ) => {

		bone.parent.updateWorldMatrix( true, false );
		bone.parent.getWorldQuaternion( pq ).invert();
		avatar.getWorldQuaternion( q );
		axis.set( 1, 0, 0 ).applyQuaternion( q ).applyQuaternion( pq ).normalize();
		bone.quaternion.premultiply( q.setFromAxisAngle( axis, angle ) );

	};

	// What the clips left before the bends, put back each frame (a bone no clip moves would bend further every frame).
	const unbent = new Map();
	let last = 0;
	avatar.userData.setPose = ( { phase = 0, stride = 0, t = 0, ride = false } ) => {

		const dt = Math.min( 0.1, Math.max( 0, t - last ) );
		last = t;
		const cycle = ( ( phase / TAU ) % 1 + 1 ) % 1;
		const r = ride ? 0 : THREE.MathUtils.clamp( ( stride - 0.95 ) / 0.25, 0, 1 );
		const w = ride ? 0 : THREE.MathUtils.clamp( stride / 0.6, 0, 1 ) - r;
		walk.time = cycle * clips.Walk.duration;
		run.time = cycle * run.getClip().duration;
		walk.setEffectiveWeight( w );
		run.setEffectiveWeight( r );
		idle.setEffectiveWeight( 1 - w - r );
		for ( const [ bone, rest ] of unbent ) bone.quaternion.copy( rest );
		unbent.clear();
		mixer.update( dt );

		object.position.set( 0, 0, 0 );
		if ( ! ride ) return;

		for ( const [ name, angle ] of Object.entries( RIDE ) ) {

			const bone = bones[ name ];
			if ( ! bone ) continue;
			unbent.set( bone, bone.quaternion.clone() );
			bend( bone, angle );

		}

		// The hips onto the seat.
		avatar.updateWorldMatrix( true, true );
		hip.set( 0, 0, 0 );
		for ( const name of [ 'UpperLegL', 'UpperLegR' ] ) if ( bones[ name ] ) hip.add( avatar.worldToLocal( bones[ name ].getWorldPosition( v ) ).multiplyScalar( 0.5 ) );
		object.position.set( - hip.x, SEAT - hip.y, - hip.z );

	};

	// In place of the plain figure, wherever it is (in the street, or on the scooter).
	const parent = walker.avatar.parent;
	parent?.remove( walker.avatar );
	walker.avatar = avatar;
	parent?.add( avatar );
	avatar.userData.setPose( {} );
	// A courier starts on the scooter.
	if ( ride ) walker.setRiding( true );
	return avatar;

}
