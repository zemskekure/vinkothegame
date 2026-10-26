// The player's ride: a small 110 cc automatic scooter of the kind food couriers ride round the Old Town, 1.9 m
// long with the seat at about 0.78 m, carrying a square turquoise delivery box (plain, no brand) on a rack over the
// back. The scooter is a downloaded low-poly model (public/models/vehicles/CREDITS.md); the box and its rack are
// boxes. Model space: the wheels on y = 0, facing +z.
//
// The returned group is placed and turned by the walker; its `lean` child holds everything that tilts into the
// turns and pitches over bumps, the rider included (`seat` is where the rider's pelvis sits, in the lean frame).

import * as THREE from 'three/webgpu';
import { vehicleModel, crispTexture } from './vehicles.js';

export const SCOOTER = { length: 1.9, seatY: 0.78, seatZ: - 0.27 };

export function makeScooter( loadModel ) {

	const group = new THREE.Group();
	const lean = new THREE.Group();
	group.add( lean );
	group.userData.lean = lean;
	group.userData.seat = new THREE.Vector3( 0, SCOOTER.seatY, SCOOTER.seatZ );

	// The rack: two dark rails from under the seat out over the tail light, and a flat carrier plate.
	const iron = new THREE.MeshStandardNodeMaterial( { color: 0x1e1f21, roughness: 0.6, metalness: 0.3 } );
	const rack = new THREE.Group();
	for ( const x of [ - 0.14, 0.14 ] ) rack.add( new THREE.Mesh( new THREE.BoxGeometry( 0.03, 0.03, 0.5 ), iron ).translateX( x ).translateY( 0.86 ).translateZ( - 0.66 ) );
	rack.add( new THREE.Mesh( new THREE.BoxGeometry( 0.34, 0.02, 0.36 ), iron ).translateY( 0.88 ).translateZ( - 0.74 ) );

	// The box: 0.42 m wide, 0.40 m tall, 0.40 m deep, its lid seam near the top.
	const box = new THREE.Mesh( new THREE.BoxGeometry( 0.42, 0.4, 0.4 ), new THREE.MeshStandardNodeMaterial( { map: crispTexture( 'delivery-box.png' ), roughness: 0.6 } ) );
	box.position.set( 0, 0.89 + 0.2, - 0.76 );
	rack.add( box );
	rack.traverse( o => o.isMesh && ( o.castShadow = true ) );
	lean.add( rack );

	vehicleModel( loadModel, 'scooter', SCOOTER.length ).then( ( { geometry, material } ) => {

		const body = new THREE.Mesh( geometry, material );
		body.castShadow = true;
		lean.add( body );

	} );

	return group;

}
