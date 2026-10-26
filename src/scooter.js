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

	// The wheels turn: the model is one mesh, so its pieces are split apart once loaded, and the two tyres (and the
	// rims and hubs inside them) get their own meshes pivoting on their axles. `roll( metres )` turns them.
	const wheels = [];
	group.userData.roll = d => {

		for ( const w of wheels ) w.rotation.x += d / w.userData.radius;

	};

	vehicleModel( loadModel, 'scooter', SCOOTER.length ).then( ( { geometry, material } ) => {

		const parts = splitWheels( geometry );
		const body = new THREE.Mesh( parts.body, material );
		body.castShadow = true;
		lean.add( body );
		for ( const w of parts.wheels ) {

			const pivot = new THREE.Group();
			pivot.position.set( 0, w.y, w.z );
			pivot.userData.radius = w.radius;
			const mesh = new THREE.Mesh( w.geometry, material );
			mesh.castShadow = true;
			pivot.add( mesh );
			lean.add( pivot );
			wheels.push( pivot );

		}

	} );

	return group;

}

// The model's separate pieces (islands of triangles joined by shared corners). A tyre is a piece as tall as it is
// long that stands on the ground; everything lying wholly inside its circle (rim, hub, brake disc) turns with it.
function splitWheels( geometry ) {

	const P = geometry.attributes.position, n = P.count;
	const parent = new Int32Array( n ).map( ( _, i ) => i );
	const find = x => {

		while ( parent[ x ] !== x ) x = parent[ x ] = parent[ parent[ x ] ];
		return x;

	};

	const seen = new Map();
	for ( let i = 0; i < n; i ++ ) {

		const key = `${P.getX( i ).toFixed( 4 )},${P.getY( i ).toFixed( 4 )},${P.getZ( i ).toFixed( 4 )}`;
		if ( seen.has( key ) ) parent[ find( i ) ] = find( seen.get( key ) );
		else seen.set( key, i );

	}

	for ( let t = 0; t < n; t += 3 ) {

		parent[ find( t + 1 ) ] = find( t );
		parent[ find( t + 2 ) ] = find( t );

	}

	const islands = new Map();
	for ( let t = 0; t < n; t += 3 ) {

		const r = find( t );
		let o = islands.get( r );
		if ( ! o ) islands.set( r, o = { tris: [], y0: Infinity, y1: - Infinity, z0: Infinity, z1: - Infinity } );
		o.tris.push( t );
		for ( let k = t; k < t + 3; k ++ ) {

			o.y0 = Math.min( o.y0, P.getY( k ) );
			o.y1 = Math.max( o.y1, P.getY( k ) );
			o.z0 = Math.min( o.z0, P.getZ( k ) );
			o.z1 = Math.max( o.z1, P.getZ( k ) );

		}

	}

	const height = geometry.boundingBox.max.y;
	const tyres = [ ...islands.values() ]
		.filter( o => o.y0 < height * 0.05 && Math.abs( ( o.y1 - o.y0 ) - ( o.z1 - o.z0 ) ) < ( o.y1 - o.y0 ) * 0.25 && o.y1 < height * 0.6 )
		.sort( ( a, b ) => b.tris.length - a.tris.length ).slice( 0, 2 )
		.map( o => ( { y: ( o.y0 + o.y1 ) / 2, z: ( o.z0 + o.z1 ) / 2, radius: ( o.y1 - o.y0 ) / 2, tris: [] } ) );
	if ( tyres.length < 2 ) return { body: geometry, wheels: [] };

	const bodyTris = [];
	for ( const o of islands.values() ) {

		const wheel = tyres.find( w => o.tris.every( t => [ t, t + 1, t + 2 ].every( k => Math.hypot( P.getY( k ) - w.y, P.getZ( k ) - w.z ) <= w.radius * 1.03 ) ) );
		( wheel ? wheel.tris : bodyTris ).push( ...o.tris );

	}

	// A geometry of the chosen triangles, moved so that a wheel's axle is its origin.
	const pick = ( tris, y = 0, z = 0 ) => {

		const g = new THREE.BufferGeometry();
		for ( const [ name, a ] of Object.entries( geometry.attributes ) ) {

			const out = new Float32Array( tris.length * 3 * a.itemSize );
			tris.forEach( ( t, j ) => {

				for ( let k = 0; k < 3; k ++ ) for ( let c = 0; c < a.itemSize; c ++ ) out[ ( j * 3 + k ) * a.itemSize + c ] = a.array[ ( t + k ) * a.itemSize + c ];

			} );
			g.setAttribute( name, new THREE.BufferAttribute( out, a.itemSize ) );

		}

		g.translate( 0, - y, - z );
		return g;

	};

	return { body: pick( bodyTris ), wheels: tyres.map( w => ( { ...w, geometry: pick( w.tris, w.y, w.z ) } ) ) };

}
