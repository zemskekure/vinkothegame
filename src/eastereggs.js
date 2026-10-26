// Small things a player may notice: places and objects that tell a local story without a word.
//
// The black SUV in front of the garage gate of Náprstkova 9 (no. 215; the tagged brown double gate 14–16.5 m along
// its street front, data/houses.json 21643423): a big boxy black off-roader that always stands there, across the gate,
// where it isn't allowed to. No badge, no plate text: everyone who knows, knows.

import * as THREE from 'three/webgpu';

// The front's west end and direction (RÚIAN footprint of 21643423, scene frame), the gate's middle 15.25 m along it.
const FRONT = { x: - 148.2, z: 13.2, dx: 0.909, dz: 0.426 };
const ALONG = 15.25, OUT = 2.0; // metres along the front, and out from the wall to the car's middle

export function addEasterEggs( scene, groundHeight ) {

	const x = FRONT.x + FRONT.dx * ALONG - FRONT.dz * OUT, z = FRONT.z + FRONT.dz * ALONG + FRONT.dx * OUT;
	const suv = blackSUV();
	suv.position.set( x, groundHeight( x, z ), z );
	// Parked along the kerb, nose east, square across the gate.
	suv.rotation.y = Math.atan2( FRONT.dx, FRONT.dz );
	scene.add( suv );
	return { suv };

}

// A boxy luxury off-roader, 4.8 × 1.95 × 1.95 m: a tall slab body, an upright glasshouse, flat bonnet, round lamps,
// a spare wheel on the tailgate, wide black wheels. Gloss black paint, dark tinted glass, a little chrome.
function blackSUV() {

	const paint = new THREE.MeshStandardNodeMaterial( { color: 0x0b0c0e, roughness: 0.25, metalness: 0.6 } );
	const glass = new THREE.MeshStandardNodeMaterial( { color: 0x15191e, roughness: 0.1, metalness: 0.8 } );
	const chrome = new THREE.MeshStandardNodeMaterial( { color: 0xb8bcc2, roughness: 0.25, metalness: 1 } );
	const rubber = new THREE.MeshStandardNodeMaterial( { color: 0x101010, roughness: 0.9 } );
	const lamp = new THREE.MeshStandardNodeMaterial( { color: 0xfff6dc, emissive: 0x6a6450, roughness: 0.4 } );
	const red = new THREE.MeshStandardNodeMaterial( { color: 0x7a0c10, emissive: 0x240203, roughness: 0.4 } );
	const g = new THREE.Group();
	const box = ( w, h, d, m, x, y, z ) => {

		const mesh = new THREE.Mesh( new THREE.BoxGeometry( w, h, d ), m );
		mesh.position.set( x, y, z );
		mesh.castShadow = true;
		g.add( mesh );
		return mesh;

	};

	// Model space: +z forward, wheels on y = 0.
	box( 1.95, 0.95, 4.6, paint, 0, 0.82, 0 ); // body
	box( 1.85, 0.75, 2.75, paint, 0, 1.6, - 0.45 ); // cabin
	box( 1.87, 0.55, 2.6, glass, 0, 1.62, - 0.45 ); // the windows round the cabin
	box( 1.75, 0.5, 0.06, glass, 0, 1.6, 0.93 ).rotation.x = - 0.12; // windscreen, nearly upright
	box( 1.3, 0.28, 0.05, chrome, 0, 0.98, 2.31 ); // grille
	for ( const s of [ - 1, 1 ] ) {

		box( 0.22, 0.22, 0.05, lamp, s * 0.72, 1.0, 2.31 ); // round-ish headlamps
		box( 0.12, 0.3, 0.05, red, s * 0.88, 0.95, - 2.31 ); // tail lamps
		box( 0.06, 0.1, 0.25, paint, s * 1.0, 1.35, 0.95 ); // mirrors
		box( 0.05, 0.08, 3.4, chrome, s * 0.985, 0.62, 0 ); // side rubbing strip

	}

	box( 1.9, 0.18, 0.15, rubber, 0, 0.38, 2.33 ); // bumpers
	box( 1.9, 0.18, 0.15, rubber, 0, 0.38, - 2.33 );
	const wheel = new THREE.CylinderGeometry( 0.42, 0.42, 0.3, 10 ).rotateZ( Math.PI / 2 );
	for ( const [ wx, wz ] of [ [ - 0.86, 1.45 ], [ 0.86, 1.45 ], [ - 0.86, - 1.45 ], [ 0.86, - 1.45 ] ] ) {

		const m = new THREE.Mesh( wheel, rubber );
		m.position.set( wx, 0.42, wz );
		g.add( m );

	}

	const spare = new THREE.Mesh( new THREE.CylinderGeometry( 0.4, 0.4, 0.26, 10 ).rotateX( Math.PI / 2 ), paint );
	spare.position.set( 0, 1.05, - 2.45 );
	g.add( spare );
	return g;

}
