// Architectural scale figures: faceless, smooth, adult-proportioned people in soft matte colours, like the little
// people in an architect's model. A figure is 14 rigid parts (pelvis, torso, neck, head, thighs, shins, feet,
// upper arms, forearms) jointed at hips, knees, shoulders and elbows; poses are computed procedurally (walk cycle,
// standing, sitting). The same pose code drives the instanced crowd (src/life.js) and the player (src/walker.js).
//
// Model space: feet on y = 0, facing +z, 1.75 m tall.

import * as THREE from 'three/webgpu';

const HIP_Y = 0.94, HIP_X = 0.095, THIGH = 0.45, SHIN = 0.45;
const SHOULDER_Y = 1.44, SHOULDER_X = 0.2, UPPER_ARM = 0.29, FOREARM = 0.27;

// Torso: a lathe from the hips to the shoulders, flattened front to back.
function torsoGeometry() {

	const profile = [ [ 0.0, - 0.02 ], [ 0.14, 0.0 ], [ 0.155, 0.1 ], [ 0.14, 0.24 ], [ 0.165, 0.38 ], [ 0.175, 0.46 ], [ 0.12, 0.53 ], [ 0.0, 0.55 ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) );
	return new THREE.LatheGeometry( profile, 14 ).scale( 1, 1, 0.68 );

}

const limb = ( r0, r1, len ) => new THREE.CylinderGeometry( r1, r0, len, 8 ).translate( 0, - len / 2, 0 ); // hangs from its joint

export const PARTS = [
	{ name: 'torso', geometry: torsoGeometry() },
	{ name: 'neck', geometry: new THREE.CylinderGeometry( 0.045, 0.05, 0.1, 8 ) },
	{ name: 'head', geometry: new THREE.SphereGeometry( 0.1, 14, 10 ).scale( 0.88, 1.12, 1 ) },
	{ name: 'thighL', geometry: limb( 0.085, 0.06, THIGH ) },
	{ name: 'thighR', geometry: limb( 0.085, 0.06, THIGH ) },
	{ name: 'shinL', geometry: limb( 0.058, 0.042, SHIN ) },
	{ name: 'shinR', geometry: limb( 0.058, 0.042, SHIN ) },
	{ name: 'footL', geometry: new THREE.BoxGeometry( 0.085, 0.06, 0.22 ).translate( 0, - 0.03, 0.045 ) },
	{ name: 'footR', geometry: new THREE.BoxGeometry( 0.085, 0.06, 0.22 ).translate( 0, - 0.03, 0.045 ) },
	{ name: 'armL', geometry: limb( 0.05, 0.04, UPPER_ARM ) },
	{ name: 'armR', geometry: limb( 0.05, 0.04, UPPER_ARM ) },
	{ name: 'forearmL', geometry: limb( 0.04, 0.032, FOREARM ) },
	{ name: 'forearmR', geometry: limb( 0.04, 0.032, FOREARM ) },
	{ name: 'pelvis', geometry: new THREE.SphereGeometry( 0.15, 12, 8 ).scale( 1, 0.55, 0.7 ) }
];

// Which part is coloured as clothing top (0) / bottom (1) / skin-ish head (2).
export const PART_TONE = { torso: 0, neck: 2, head: 2, thighL: 1, thighR: 1, shinL: 1, shinR: 1, footL: 1, footR: 1, armL: 0, armR: 0, forearmL: 0, forearmR: 0, pelvis: 1 };

// Soft model-maker's palette.
export const TONES = [ 0xeae5db, 0xdcd6ca, 0xcbc4b6, 0xb9b2a5, 0xdac6ac, 0xc9aa8f, 0xadb7a9, 0xa3adb9, 0xd4b8b0, 0x9a948a ];

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _leg = new THREE.Matrix4();
const rx = a => _r.makeRotationX( a );

// Fills `out` (one Matrix4 per part, model space) for a pose:
//   { walk: phase (rad) or null, stride: 0…1, sit: bool, ride: bool (on the scooter), breath: phase, air: 0…1 (a jump) }
export function pose( out, { phase = 0, stride = 0, sit = false, ride = false, t = 0, air = 0 } ) {

	let hip = [ 0, 0 ], knee = [ 0, 0 ], shoulder = [ 0, 0 ], elbow = [ 0.15, 0.15 ];
	let pelvisY = HIP_Y, lean = 0;
	if ( ride ) {

		// Astride a scooter: thighs forward along the seat, shins down to the floorboard, arms out to the bars,
		// leaning a little into the ride.
		hip = [ 1.45, 1.45 ];
		knee = [ 1.62, 1.62 ];
		shoulder = [ 0.95, 0.95 ];
		elbow = [ 0.45, 0.45 ];
		pelvisY = 0.5;
		lean = 0.14;

	} else if ( sit ) {

		hip = [ 1.57, 1.5 ];
		knee = [ 1.57, 1.45 ];
		shoulder = [ 0.35, 0.25 ];
		elbow = [ 0.9, 1.0 ];
		pelvisY = 0.5;
		lean = - 0.05;

	} else if ( stride > 0 ) {

		for ( const [ i, ph ] of [ [ 0, phase ], [ 1, phase + Math.PI ] ] ) {

			const s = Math.sin( ph );
			hip[ i ] = 0.5 * stride * s;
			knee[ i ] = stride * ( 0.08 + 0.75 * Math.max( 0, Math.sin( ph + 1.2 ) ) ) * ( s > - 0.2 ? 1 : 0.4 );
			shoulder[ i ] = - 0.42 * stride * s;
			elbow[ i ] = 0.2 + 0.35 * stride * Math.max( 0, - s );

		}

		pelvisY = HIP_Y - 0.035 * stride + 0.03 * stride * Math.abs( Math.cos( phase ) );
		lean = 0.06 * stride;

	} else {

		pelvisY = HIP_Y + 0.004 * Math.sin( t * 1.7 );
		shoulder = [ 0.03, 0.03 ];

	}

	// In a jump: the knees pulled up, the arms out.
	if ( air && ! ride && ! sit ) {

		hip = hip.map( ( h, i ) => h + air * ( i ? 0.6 : 0.95 ) );
		knee = knee.map( ( k, i ) => k + air * ( i ? 0.9 : 1.35 ) );
		shoulder = shoulder.map( s => s + air * 0.45 );

	}

	const torso = new THREE.Matrix4().makeTranslation( 0, pelvisY, 0 ).multiply( rx( lean ) );
	const set = ( name, m ) => out[ PARTS.findIndex( p => p.name === name ) ].copy( m );

	set( 'pelvis', _m.makeTranslation( 0, pelvisY, 0 ) );
	set( 'torso', torso );
	set( 'neck', _m.copy( torso ).multiply( _leg.makeTranslation( 0, 0.58, 0.01 ) ) );
	set( 'head', _m.copy( torso ).multiply( _leg.makeTranslation( 0, 0.72, 0.02 ) ) );

	for ( const [ i, side ] of [ [ 0, 'L' ], [ 1, 'R' ] ] ) {

		const sx = i === 0 ? HIP_X : - HIP_X;
		// Legs: forward swing is a negative rotation about x (the limb hangs along −y, model faces +z).
		const thigh = new THREE.Matrix4().makeTranslation( sx, pelvisY - 0.03, 0 ).multiply( rx( - hip[ i ] ) );
		set( 'thigh' + side, thigh );
		const shin = thigh.clone().multiply( _leg.makeTranslation( 0, - THIGH, 0 ) ).multiply( rx( knee[ i ] ) );
		set( 'shin' + side, shin );
		const foot = shin.clone().multiply( _leg.makeTranslation( 0, - SHIN, 0 ) ).multiply( rx( - knee[ i ] + hip[ i ] - ( sit || ride ? 0 : hip[ i ] ) ) );
		set( 'foot' + side, foot );

		const ax = i === 0 ? SHOULDER_X : - SHOULDER_X;
		const arm = torso.clone().multiply( _leg.makeTranslation( ax, SHOULDER_Y - HIP_Y - 0.02, 0 ) ).multiply( rx( - lean - shoulder[ i ] ) ).multiply( new THREE.Matrix4().makeRotationZ( i === 0 ? 0.06 : - 0.06 ) );
		set( 'arm' + side, arm );
		set( 'forearm' + side, arm.clone().multiply( _leg.makeTranslation( 0, - UPPER_ARM, 0 ) ).multiply( rx( - elbow[ i ] ) ) );

	}

	return out;

}

export const newPose = () => PARTS.map( () => new THREE.Matrix4() );

export const figureMaterial = () => new THREE.MeshStandardNodeMaterial( { roughness: 0.72, metalness: 0 } );

// A single figure as a group of meshes (the player).
export function makeFigure( top, bottom, head = top ) {

	const group = new THREE.Group();
	const meshes = PARTS.map( p => {

		const tone = PART_TONE[ p.name ];
		const m = new THREE.Mesh( p.geometry, new THREE.MeshStandardNodeMaterial( { color: [ top, bottom, head ][ tone ], roughness: 0.7 } ) );
		m.matrixAutoUpdate = false;
		m.castShadow = true;
		group.add( m );
		return m;

	} );

	const matrices = newPose();
	group.userData.setPose = state => {

		pose( matrices, state );
		meshes.forEach( ( m, i ) => {

			m.matrix.copy( matrices[ i ] );
			m.matrixWorldNeedsUpdate = true;

		} );

	};

	group.userData.setPose( {} );
	return group;

}
