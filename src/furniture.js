// Street furniture from OpenStreetMap positions (see tools/streets.mjs), as instanced low-poly models: historic
// Prague lamp posts, bins and bollards turned from the owner's pictures, benches with his slats, bike stands,
// fountains, statues on pedestals and trees. Each entry in data.furniture[type] is [ x, y, z, rotation, scale ].

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, positionWorld, mix, float, vec2, floor, fract, abs, smoothstep, step, attribute, texture, uv } from 'three/tsl';
import { noise2D } from './shading/common.js';
import { mergeInstances } from './kit.js';
// The owner's pictures of a historic lamp post, a bin, a bollard and a bench (tools/textures/furniture.py).
import ATLAS from './furniture-atlas.json';

const atlasTexture = new THREE.TextureLoader().load( 'textures/furniture-atlas.png' );
atlasTexture.colorSpace = THREE.SRGBColorSpace;
atlasTexture.magFilter = atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
const pictured = new THREE.MeshStandardNodeMaterial( { map: atlasTexture, roughness: 0.6, metalness: 0.2 } );
pictured.name = 'street furniture';

// A round thing turned on a lathe from its picture's outline (radius by height), the picture wrapped round it: once
// across the front half, mirrored on the back.
function lathe( name, segments = 8 ) {

	const T = ATLAS.things[ name ], H = T.height, r = T.rect, pts = T.lathe;
	const pos = [], uv = [];
	for ( let i = 0; i < pts.length - 1; i ++ ) for ( let k = 0; k < segments; k ++ ) {

		const ring = ( j, s ) => {

			const a = s / segments * Math.PI * 2, rad = pts[ j ][ 1 ] * H;
			const u = 1 - Math.abs( 2 * s / segments - 1 );
			return [ [ Math.sin( a ) * rad, pts[ j ][ 0 ] * H, Math.cos( a ) * rad ], [ r[ 0 ] + ( r[ 2 ] - r[ 0 ] ) * ( 0.5 + ( u - 0.5 ) * 0.98 ), r[ 1 ] + ( r[ 3 ] - r[ 1 ] ) * pts[ j ][ 0 ] ] ];

		};

		const [ a, b, c, d ] = [ ring( i, k ), ring( i, k + 1 ), ring( i + 1, k + 1 ), ring( i + 1, k ) ];
		for ( const [ p, t ] of [ a, b, c, a, c, d ] ) {

			pos.push( ...p );
			uv.push( ...t );

		}

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.computeVertexNormals();
	return g;

}

// A box whose every face wears the same picture (a slat of the bench).
function slatBox( w, h, d, x, y, z, rect ) {

	const g = new THREE.BoxGeometry( w, h, d ).translate( x, y + h / 2, z );
	const t = g.attributes.uv;
	for ( let i = 0; i < t.count; i ++ ) t.setXY( i, rect[ 0 ] + ( rect[ 2 ] - rect[ 0 ] ) * t.getX( i ), rect[ 1 ] + ( rect[ 3 ] - rect[ 1 ] ) * t.getY( i ) );
	return g;

}

const SLAT = ATLAS.things.bench.slat;

const iron = new THREE.MeshStandardNodeMaterial( { color: 0x262b28, metalness: 0.6, roughness: 0.45 } );
const stone = new THREE.MeshStandardNodeMaterial( { color: 0xa39a8a, roughness: 0.85 } );
const bronze = new THREE.MeshStandardNodeMaterial( { color: 0x4f6a5a, metalness: 0.7, roughness: 0.5 } );
const water = new THREE.MeshStandardNodeMaterial( { color: 0x29404a, roughness: 0.05, metalness: 0.1 } );
// Trees wear the owner's leaves and bark (public/textures/tree-atlas.png, tools/textures/trees.py): the top row holds
// the leaves of the linden, the horse chestnut and the plane (kind 0, 1, 2) and linden bark, the bottom row plane
// bark. Each tree's kind comes in with its instance.
const treeAtlas = new THREE.TextureLoader().load( 'textures/tree-atlas.png' );
treeAtlas.colorSpace = THREE.SRGBColorSpace;
treeAtlas.magFilter = treeAtlas.minFilter = THREE.NearestFilter;
treeAtlas.generateMipmaps = false;
const treeKind = attribute( 'kind', 'float' );
const bark = new THREE.MeshStandardNodeMaterial( { roughness: 1 } );
{

	const isPlane = step( 1.5, treeKind );
	const t = vec2( fract( uv().x.mul( 2 ) ), fract( uv().y.mul( 3 ) ) );
	bark.colorNode = texture( treeAtlas, mix( vec2( t.x.mul( 0.25 ).add( 0.75 ), t.y.mul( 0.5 ).add( 0.5 ) ), vec2( t.x.mul( 0.25 ), t.y.mul( 0.5 ) ), isPlane ) );

}
const leaves = new THREE.MeshStandardNodeMaterial( { roughness: 0.9, flatShading: true } );
{

	const t = fract( uv().mul( 1.5 ) );
	leaves.colorNode = texture( treeAtlas, vec2( t.x.add( treeKind ).mul( 0.25 ), t.y.mul( 0.5 ).add( 0.5 ) ) ).mul( mix( float( 0.85 ), float( 1.1 ), noise2D( positionWorld.xz.mul( 0.13 ).add( 7 ) ) ) );

}

// A tree's kind from where it stands: planes along the river and on the islands, horse chestnuts in the parks and
// gardens over there, lindens in the streets; dealt out by a hash of the position, so a tree keeps its kind.
function kindOfTree( x, z ) {

	const h = Math.abs( Math.sin( x * 12.9898 + z * 78.233 ) * 43758.5453 ) % 1;
	const river = x < - 380;
	return river ? ( h < 0.5 ? 2 : h < 0.8 ? 1 : 0 ) : ( h < 0.6 ? 0 : h < 0.85 ? 1 : 2 );

}

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
export const MODELS = {

	// Cast-iron historic street lamp with its lantern (4.6 m), from the owner's picture.
	lamp: [ [ lathe( 'lamp', 6 ), pictured ] ],

	// Wooden slatted bench on cast-iron legs, 1.8 m long along local x.
	bench: [
		[ mergeGeometries( [
			slatBox( 1.8, 0.04, 0.12, 0, 0.44, - 0.15, SLAT ), slatBox( 1.8, 0.04, 0.12, 0, 0.44, 0, SLAT ), slatBox( 1.8, 0.04, 0.12, 0, 0.44, 0.15, SLAT ),
			slatBox( 1.8, 0.1, 0.03, 0, 0.62, 0.24, SLAT ).rotateX( - 0.15 ), slatBox( 1.8, 0.1, 0.03, 0, 0.76, 0.26, SLAT ).rotateX( - 0.15 )
		] ), pictured ],
		[ mergeGeometries( [
			box( 0.05, 0.44, 0.5, - 0.75, 0, 0 ), box( 0.05, 0.44, 0.5, 0.75, 0, 0 ),
			box( 0.05, 0.45, 0.05, - 0.75, 0.44, 0.24 ), box( 0.05, 0.45, 0.05, 0.75, 0.44, 0.24 )
		] ), iron ]
	],

	// Free-standing brick chimney, tapering, with a corbelled collar near the top; scaled to its height.
	chimney: [ [ mergeGeometries( [ cyl( 0.03, 0.045, 1, 0, 24 ), cyl( 0.036, 0.036, 0.015, 0.94, 24 ), cyl( 0.04, 0.04, 0.01, 0.955, 24 ) ] ), brick ] ],

	// The cast-iron bin and the bollard, from the owner's pictures.
	bin: [ [ lathe( 'bin', 10 ), pictured ] ],

	bollard: [ [ lathe( 'bollard', 8 ), pictured ] ],

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

// The trees come in one batch per 300 m square of the city, so the squares out of view (or lost in the haze,
// src/main.js) are skipped; the small things, few triangles each, in one batch a kind.
// `kindOf( entry )`: a number per instance, passed to the material as the `kind` attribute (the trees' species).
function instance( scene, type, parts, entries, matrixOf, tile = Infinity, { stride = 5, kindOf = null } = {} ) {

	const count = entries.length / stride;
	if ( ! count ) return;
	const tiles = new Map();
	for ( let i = 0; i < count; i ++ ) {

		const key = tile === Infinity ? 0 : `${Math.floor( entries[ i * stride ] / tile )},${Math.floor( entries[ i * stride + 2 ] / tile )}`;
		if ( ! tiles.has( key ) ) tiles.set( key, [] );
		tiles.get( key ).push( entries.slice( i * stride, i * stride + stride ) );

	}

	for ( const list of tiles.values() ) for ( const [ geometry, material ] of parts ) {

		const matrices = list.map( entry => matrixOf( entry, new THREE.Matrix4() ) );
		const merged = mergeInstances( geometry, matrices, kindOf ? { name: 'kind', values: list.map( kindOf ) } : null );
		// Only the pictured materials read the picture's coordinates.
		if ( ! [ pictured, bark, leaves ].includes( material ) ) merged.deleteAttribute( 'uv' );
		const mesh = new THREE.Mesh( merged, material );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.name = type;
		mesh.userData.tile = true;
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
		const r = Math.min( 6, Math.max( 2, h * 0.32 ) ), kind = kindOfTree( x, z );
		// The crown turned by the tree's place in the whole city's list (a square's trees carry theirs: src/stream.js).
		const n = furniture.treeIndex ? furniture.treeIndex[ i / 5 ] * 5 : i;
		for ( let k = 0; k < 3; k ++ ) {

			const a = n * 2.4 + k * 2.1;
			blobs.push( x + Math.cos( a ) * r * 0.35, y + h * ( 0.62 + 0.07 * k ), z + Math.sin( a ) * r * 0.35, a, r * 0.78, kind );

		}

	}

	const crownH = 0.75; // crown blobs are squashed spheres
	// (20-sided blobs: chunky, as the console games drew their trees.)
	instance( scene, 'tree', [ [ new THREE.IcosahedronGeometry( 1, 0 ), leaves ] ], blobs,
		( [ x, y, z, rot, r ], m ) => m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( r, r * crownH, r ) ), 300, { stride: 6, kindOf: e => e[ 5 ] } );
	instance( scene, 'trunk', [ [ cyl( 0.14, 0.24, 1, 0, 7 ), bark ] ], trees,
		( [ x, y, z, , h ], m ) => m.compose( p.set( x, y, z ), q.identity(), s.set( 1, h * 0.62, 1 ) ), 300, { kindOf: e => kindOfTree( e[ 0 ], e[ 2 ] ) } );

	// Zebra crossings are painted from the aerial photo (ground detail in src/shading/surfaces.js).

}
