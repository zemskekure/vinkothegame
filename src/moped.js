import * as THREE from 'three/webgpu';

// A small cream-and-red step-through moped (the kind parked all over the Old Town), about 1.8 m long, facing +z.
// Built from boxes and cylinders like the rest of the street furniture.
export function makeMoped() {

	const group = new THREE.Group();
	const mat = c => new THREE.MeshStandardNodeMaterial( { color: c, roughness: 0.55, metalness: 0.1 } );
	const body = mat( 0xb8352b ), cream = mat( 0xece4d2 ), dark = mat( 0x1d1f22 ), chrome = mat( 0xb9bcc0 );
	const box = ( w, h, d, m, x, y, z ) => {

		const mesh = new THREE.Mesh( new THREE.BoxGeometry( w, h, d ), m );
		mesh.position.set( x, y, z );
		mesh.castShadow = true;
		group.add( mesh );
		return mesh;

	};

	// Wheels: 0.5 m across, on their sides.
	const wheelGeometry = new THREE.CylinderGeometry( 0.25, 0.25, 0.12, 18 );
	wheelGeometry.rotateZ( Math.PI / 2 );
	for ( const z of [ - 0.62, 0.62 ] ) {

		const wheel = new THREE.Mesh( wheelGeometry, dark );
		wheel.position.set( 0, 0.25, z );
		wheel.castShadow = true;
		group.add( wheel );

	}

	box( 0.34, 0.08, 0.9, cream, 0, 0.3, 0 ); // floorboard
	box( 0.42, 0.42, 0.62, body, 0, 0.55, - 0.42 ); // rear body over the engine
	box( 0.34, 0.12, 0.62, dark, 0, 0.82, - 0.38 ); // seat
	box( 0.36, 0.78, 0.12, body, 0, 0.66, 0.5 ); // leg shield
	box( 0.08, 0.6, 0.08, chrome, 0, 0.98, 0.56 ); // steering column
	box( 0.66, 0.05, 0.05, chrome, 0, 1.28, 0.56 ); // handlebar
	box( 0.16, 0.1, 0.06, cream, 0, 1.2, 0.62 ); // headlamp housing
	box( 0.2, 0.18, 0.3, body, 0, 0.5, 0.66 ); // front mudguard
	return group;

}
