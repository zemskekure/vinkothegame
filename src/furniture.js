// Street furniture from OpenStreetMap positions (see tools/streets.mjs), as instanced procedural models:
// historic Prague lamp posts, benches, bins, bollards, bike stands, fountains, statues on pedestals and trees. Each entry in data.furniture[type] is [ x, y, z, rotation, scale ].

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, positionWorld, mix, float, vec2, floor, fract, abs, smoothstep } from 'three/tsl';
import { noise2D } from './shading/common.js';

const iron = new THREE.MeshStandardNodeMaterial( { color: 0x262b28, metalness: 0.6, roughness: 0.45 } );
const stone = new THREE.MeshStandardNodeMaterial( { color: 0xa39a8a, roughness: 0.85 } );
const wood = new THREE.MeshStandardNodeMaterial( { color: 0x7b5434, roughness: 0.7 } );
const bronze = new THREE.MeshStandardNodeMaterial( { color: 0x4f6a5a, metalness: 0.7, roughness: 0.5 } );
const water = new THREE.MeshStandardNodeMaterial( { color: 0x29404a, roughness: 0.05, metalness: 0.1 } );
const lampGlass = new THREE.MeshStandardNodeMaterial( { color: 0xfff2d6, emissive: 0xffd9a0, emissiveIntensity: 0.4, roughness: 0.2 } );
const bark = new THREE.MeshStandardNodeMaterial( { color: 0x4a3b2c, roughness: 1 } );
const leaves = new THREE.MeshStandardNodeMaterial( { roughness: 0.9, flatShading: true } );
leaves.colorNode = mix( color( 0x3e5a24 ), color( 0x5f7d32 ), noise2D( positionWorld.xz.mul( 0.9 ) ) ).mul( mix( float( 0.8 ), float( 1.1 ), noise2D( positionWorld.xz.mul( 0.13 ).add( 7 ) ) ) );

const cyl = ( r0, r1, h, y, seg = 12 ) => new THREE.CylinderGeometry( r0, r1, h, seg ).translate( 0, y + h / 2, 0 );
const box = ( w, h, d, x, y, z ) => new THREE.BoxGeometry( w, h, d ).translate( x, y + h / 2, z );

// Brick for the factory chimneys: running-bond courses with a light mortar.
const brick = new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } );
{

	const row = positionWorld.y.div( 0.075 );
	const around = positionWorld.x.add( positionWorld.z ).div( 0.25 ); // brick length along the circumference
	const mortar = smoothstep( 0.42, 0.5, abs( fract( row ).sub( 0.5 ) ) ).max( smoothstep( 0.44, 0.5, abs( fract( around.add( floor( row ).mul( 0.5 ) ) ).sub( 0.5 ) ) ) );
	const tone = mix( color( 0x8c4a34 ), color( 0xa25a3e ), noise2D( vec2( floor( around ), floor( row ) ).mul( 0.7 ) ) );
	brick.colorNode = mix( tone, color( 0x9a9286 ), mortar.mul( 0.6 ) ).mul( mix( float( 0.75 ), float( 1 ), smoothstep( 0, 8, positionWorld.y ) ) );

}

// Each model: a list of [ geometry, material ] parts, merged per material.
const MODELS = {

	// Cast-iron historic street lamp with a four-sided lantern (about 4.5 m).
	lamp: [
		[ mergeGeometries( [
			cyl( 0.16, 0.2, 0.9, 0, 10 ), cyl( 0.12, 0.12, 0.08, 0.9, 10 ),
			cyl( 0.055, 0.075, 2.9, 0.98, 10 ), cyl( 0.09, 0.06, 0.25, 3.85, 10 ),
			cyl( 0.0, 0.26, 0.28, 4.62, 4 ).rotateY( Math.PI / 4 ), cyl( 0.03, 0.03, 0.2, 4.9, 6 )
		] ), iron ],
		[ cyl( 0.2, 0.14, 0.52, 4.1, 4 ).rotateY( Math.PI / 4 ), lampGlass ]
	],

	// Wooden slatted bench on cast-iron legs, 1.8 m long along local x.
	bench: [
		[ mergeGeometries( [
			box( 1.8, 0.04, 0.12, 0, 0.44, - 0.15 ), box( 1.8, 0.04, 0.12, 0, 0.44, 0 ), box( 1.8, 0.04, 0.12, 0, 0.44, 0.15 ),
			box( 1.8, 0.1, 0.03, 0, 0.62, 0.24 ).rotateX( - 0.15 ), box( 1.8, 0.1, 0.03, 0, 0.76, 0.26 ).rotateX( - 0.15 )
		] ), wood ],
		[ mergeGeometries( [
			box( 0.05, 0.44, 0.5, - 0.75, 0, 0 ), box( 0.05, 0.44, 0.5, 0.75, 0, 0 ),
			box( 0.05, 0.45, 0.05, - 0.75, 0.44, 0.24 ), box( 0.05, 0.45, 0.05, 0.75, 0.44, 0.24 )
		] ), iron ]
	],

	// Free-standing brick chimney, tapering, with a corbelled collar near the top; scaled to its height.
	chimney: [ [ mergeGeometries( [ cyl( 0.03, 0.045, 1, 0, 24 ), cyl( 0.036, 0.036, 0.015, 0.94, 24 ), cyl( 0.04, 0.04, 0.01, 0.955, 24 ) ] ), brick ] ],

	bin: [ [ mergeGeometries( [ cyl( 0.2, 0.18, 0.85, 0, 14 ), cyl( 0.22, 0.22, 0.06, 0.85, 14 ) ] ), new THREE.MeshStandardNodeMaterial( { color: 0x2c3a31, roughness: 0.6, metalness: 0.3 } ) ] ],

	bollard: [ [ mergeGeometries( [ cyl( 0.09, 0.1, 0.8, 0, 10 ), cyl( 0.11, 0.11, 0.05, 0.62, 10 ), new THREE.SphereGeometry( 0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2 ).translate( 0, 0.8, 0 ) ] ), iron ] ],

	// One U-shaped stand; the scale field repeats it along local x.
	bikestand: [ [ new THREE.TorusGeometry( 0.38, 0.025, 6, 16, Math.PI ).translate( 0, 0.45, 0 ).rotateY( Math.PI / 2 ), new THREE.MeshStandardNodeMaterial( { color: 0x8a8d8f, metalness: 0.8, roughness: 0.35 } ) ] ],

	fountain: [
		[ mergeGeometries( [ cyl( 1.3, 1.35, 0.55, 0, 24 ), cyl( 0.18, 0.25, 1.4, 0.55, 10 ), cyl( 0.55, 0.15, 0.2, 1.6, 16 ) ] ), stone ],
		[ cyl( 1.18, 1.18, 0.02, 0.45, 24 ), water ]
	],

	// Statue: stone pedestal with a bronze figure.
	statue: [
		[ mergeGeometries( [ box( 1.5, 0.35, 1.5, 0, 0, 0 ), box( 1.1, 1.6, 1.1, 0, 0.35, 0 ), box( 1.3, 0.2, 1.3, 0, 1.95, 0 ) ] ), stone ],
		[ mergeGeometries( [ new THREE.CapsuleGeometry( 0.3, 1.1, 4, 10 ).translate( 0, 2.15 + 0.85, 0 ), new THREE.SphereGeometry( 0.2, 10, 8 ).translate( 0, 3.85, 0 ) ] ), bronze ]
	]

};

function instance( scene, type, parts, entries, matrixOf ) {

	const count = entries.length / 5;
	if ( ! count ) return;
	for ( const [ geometry, material ] of parts ) {

		const mesh = new THREE.InstancedMesh( geometry, material, count );
		const m = new THREE.Matrix4();
		for ( let i = 0; i < count; i ++ ) mesh.setMatrixAt( i, matrixOf( entries.slice( i * 5, i * 5 + 5 ), m ) );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.name = type;
		scene.add( mesh );

	}

}

export function addFurniture( scene, furniture ) {

	const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3( 1, 1, 1 );
	const up = new THREE.Vector3( 0, 1, 0 );
	const place = ( [ x, y, z, rot ], m ) => m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( 1, 1, 1 ) );

	// Chimneys: [ x, y, z, rot, height ], the unit model scaled uniformly to the height.
	instance( scene, 'chimney', MODELS.chimney, furniture.chimney || [], ( [ x, y, z, , h ], m ) => m.compose( p.set( x, y - 0.5, z ), q.identity(), s.set( h, h, h ) ) );

	for ( const type of [ 'lamp', 'bench', 'bin', 'bollard', 'fountain', 'statue' ] ) {

		instance( scene, type, MODELS[ type ], furniture[ type ] || [], place );

	}

	// Bike stands: one entry per rack, `scale` stands in a row 0.8 m apart.
	const stands = [];
	const list = furniture.bikestand || [];
	for ( let i = 0; i < list.length; i += 5 ) {

		const [ x, y, z, rot, n ] = list.slice( i, i + 5 );
		for ( let k = 0; k < n; k ++ ) {

			const o = ( k - ( n - 1 ) / 2 ) * 0.8;
			stands.push( x + Math.cos( rot ) * o, y, z - Math.sin( rot ) * o, rot, 1 );

		}

	}

	instance( scene, 'bikestand', MODELS.bikestand, stands, place );

	// Trees: trunk plus three overlapping crown blobs, sized by height.
	const trees = furniture.tree || [];
	const blobs = [];
	for ( let i = 0; i < trees.length; i += 5 ) {

		const [ x, y, z, , h ] = trees.slice( i, i + 5 );
		const r = Math.min( 6, Math.max( 2, h * 0.32 ) );
		for ( let k = 0; k < 3; k ++ ) {

			const a = i * 2.4 + k * 2.1;
			blobs.push( x + Math.cos( a ) * r * 0.35, y + h * ( 0.62 + 0.07 * k ), z + Math.sin( a ) * r * 0.35, a, r * 0.78 );

		}

	}

	const crownH = 0.75; // crown blobs are squashed spheres
	instance( scene, 'tree', [ [ new THREE.IcosahedronGeometry( 1, 1 ), leaves ] ], blobs,
		( [ x, y, z, rot, r ], m ) => m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( r, r * crownH, r ) ) );
	instance( scene, 'trunk', [ [ cyl( 0.14, 0.24, 1, 0, 7 ), bark ] ], trees,
		( [ x, y, z, , h ], m ) => m.compose( p.set( x, y, z ), q.identity(), s.set( 1, h * 0.62, 1 ) ) );

	// Zebra crossings are painted from the aerial photo (ground detail in src/shading/surfaces.js).

}
