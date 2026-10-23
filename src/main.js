import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFacadeMaterial, PLASTER } from './shading/facade.js';
import { createRoofMaterial, createGroundMaterial, createWaterMaterial } from './shading/surfaces.js';
import { Walker } from './walker.js';

const load = async ( name, type = 'arrayBuffer' ) => ( await fetch( `data/${name}` ) )[ type ]();

const [ data, wallsBuf, roofsBuf, roofIdxBuf, terrainBuf, surfaceBuf, footprintBuf ] = await Promise.all( [
	load( 'scene.json', 'json' ),
	load( 'walls.bin' ),
	load( 'roofs.bin' ),
	load( 'roofs-index.bin' ),
	load( 'terrain.bin' ),
	load( 'surface.bin' ),
	load( 'footprints.bin' )
] );

const { bounds } = data;
const params = new URLSearchParams( location.search );

// ---------------------------------------------------------------------------
// Renderer, sky, light

const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.2, 20000 );

// Late-afternoon sun from the south-west.
const sunDir = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 55 ), THREE.MathUtils.degToRad( 225 ) );

const sky = new SkyMesh();
sky.scale.setScalar( 10000 );
sky.turbidity.value = 3;
sky.rayleigh.value = 1.4;
sky.mieCoefficient.value = 0.004;
sky.mieDirectionalG.value = 0.8;
sky.sunPosition.value.copy( sunDir );
sky.material.fog = false;
scene.add( sky );

const pmrem = new THREE.PMREMGenerator( renderer );
const envScene = new THREE.Scene();
envScene.add( sky.clone() );
scene.environment = pmrem.fromScene( envScene ).texture;
scene.environmentIntensity = 0.3;

scene.fog = new THREE.Fog( 0xc9d6e2, 350, 1600 );

const centre = new THREE.Vector3( ( bounds.minX + bounds.maxX ) / 2, 0, ( bounds.minZ + bounds.maxZ ) / 2 );

const sun = new THREE.DirectionalLight( 0xffe6c4, 3.0 );
sun.castShadow = true;
sun.shadow.mapSize.set( 4096, 4096 );
const half = Math.max( bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ ) * 0.62;
Object.assign( sun.shadow.camera, { left: - half, right: half, top: half, bottom: - half, near: 10, far: 1600 } );
sun.shadow.bias = - 0.0003;
sun.shadow.normalBias = 0.3;
sun.position.copy( sunDir ).multiplyScalar( 700 ).add( centre );
sun.target.position.copy( centre );
scene.add( sun, sun.target, new THREE.HemisphereLight( 0xd6e2ee, 0x8a7a66, 0.35 ) );

// ---------------------------------------------------------------------------
// Terrain and street surfaces

const T = data.terrain;
const heights = new Float32Array( terrainBuf );
const terrainGeo = new THREE.PlaneGeometry( ( T.width - 1 ) * T.cell, ( T.height - 1 ) * T.cell, T.width - 1, T.height - 1 );
terrainGeo.rotateX( - Math.PI / 2 );
terrainGeo.translate( centre.x, 0, centre.z );
const tp = terrainGeo.attributes.position;
for ( let i = 0; i < tp.count; i ++ ) tp.setY( i, heights[ i ] );
terrainGeo.computeVertexNormals();

const S = data.surface;
const surfaceTex = new THREE.DataTexture( new Uint8Array( surfaceBuf ), S.width, S.height, THREE.RGBAFormat );
surfaceTex.magFilter = surfaceTex.minFilter = THREE.LinearFilter;
surfaceTex.needsUpdate = true;

const terrain = new THREE.Mesh( terrainGeo, createGroundMaterial( surfaceTex, bounds ) );
terrain.receiveShadow = true;
scene.add( terrain );

function groundHeight( x, z ) {

	const fx = THREE.MathUtils.clamp( ( x - bounds.minX ) / T.cell, 0, T.width - 1.001 );
	const fz = THREE.MathUtils.clamp( ( z - bounds.minZ ) / T.cell, 0, T.height - 1.001 );
	const x0 = Math.floor( fx ), z0 = Math.floor( fz ), tx = fx - x0, tz = fz - z0;
	const i = z0 * T.width + x0;
	return ( heights[ i ] * ( 1 - tx ) + heights[ i + 1 ] * tx ) * ( 1 - tz ) +
		( heights[ i + T.width ] * ( 1 - tx ) + heights[ i + T.width + 1 ] * tx ) * tz;

}

// River: a flat sheet just above the lowest terrain, hidden under the embankments elsewhere.
const water = new THREE.Mesh(
	new THREE.PlaneGeometry( bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ ).rotateX( - Math.PI / 2 ),
	createWaterMaterial()
);
water.position.set( centre.x, data.waterLevel, centre.z );
water.receiveShadow = true;
scene.add( water );

// Beyond the modelled area: plain ground fading into the fog.
const outer = new THREE.Shape().moveTo( - 5000, - 5000 ).lineTo( 5000, - 5000 ).lineTo( 5000, 5000 ).lineTo( - 5000, 5000 );
outer.holes.push( new THREE.Path().moveTo( bounds.minX, - bounds.minZ ).lineTo( bounds.minX, - bounds.maxZ )
	.lineTo( bounds.maxX, - bounds.maxZ ).lineTo( bounds.maxX, - bounds.minZ ) );
const skirt = new THREE.Mesh( new THREE.ShapeGeometry( outer ).rotateX( - Math.PI / 2 ),
	new THREE.MeshStandardNodeMaterial( { color: 0x8c8378, roughness: 1 } ) );
skirt.position.y = heights.reduce( ( a, v ) => a + v, 0 ) / heights.length - 1;
scene.add( skirt );

// ---------------------------------------------------------------------------
// Buildings

// Roofs: flat-shaded so every hip and gable face reads crisply.
const rs = data.roofStride;
const roofIndexed = new THREE.BufferGeometry();
const rib = new THREE.InterleavedBuffer( new Float32Array( roofsBuf ), rs );
roofIndexed.setAttribute( 'position', new THREE.InterleavedBufferAttribute( rib, 3, 0 ) );
roofIndexed.setAttribute( 'roofKind', new THREE.InterleavedBufferAttribute( rib, 1, 3 ) );
roofIndexed.setAttribute( 'seed', new THREE.InterleavedBufferAttribute( rib, 1, 4 ) );
roofIndexed.setAttribute( 'roofColor', new THREE.InterleavedBufferAttribute( rib, 3, 5 ) );
roofIndexed.setIndex( new THREE.BufferAttribute( new Uint32Array( roofIdxBuf ), 1 ) );
const roofGeo = roofIndexed.toNonIndexed();
roofGeo.computeVertexNormals();
const roofs = new THREE.Mesh( roofGeo, createRoofMaterial() );
roofs.castShadow = roofs.receiveShadow = true;
scene.add( roofs );

const walls = new Float32Array( wallsBuf );
const ws = data.wallStride;
const wallGeo = new THREE.BufferGeometry();
const wib = new THREE.InterleavedBuffer( walls, ws );
[ [ 'position', 3, 0 ], [ 'wallU', 1, 3 ], [ 'wallW', 1, 4 ], [ 'wallBase', 1, 5 ], [ 'wallTop', 1, 6 ],
	[ 'floorH', 1, 7 ], [ 'seed', 1, 8 ], [ 'kind', 1, 9 ] ].forEach( ( [ name, size, offset ] ) => {

	wallGeo.setAttribute( name, new THREE.InterleavedBufferAttribute( wib, size, offset ) );

} );

const plaster = new Float32Array( walls.length / ws * 3 );
const c = new THREE.Color();
for ( let i = 0, n = walls.length / ws; i < n; i ++ ) {

	c.setHex( PLASTER[ Math.floor( walls[ i * ws + 8 ] * PLASTER.length ) ] );
	plaster.set( [ c.r, c.g, c.b ], i * 3 );

}

wallGeo.setAttribute( 'plaster', new THREE.BufferAttribute( plaster, 3 ) );
wallGeo.computeVertexNormals();
const wallMesh = new THREE.Mesh( wallGeo, createFacadeMaterial() );
wallMesh.castShadow = wallMesh.receiveShadow = true;
scene.add( wallMesh );

// ---------------------------------------------------------------------------
// Trees (canopy peaks found in the surface model)

const tree = data.trees;
const treeCount = tree.length / 5;
const crowns = new THREE.InstancedMesh( new THREE.IcosahedronGeometry( 1, 1 ),
	new THREE.MeshStandardNodeMaterial( { roughness: 0.95, flatShading: true } ), treeCount * 3 );
const trunks = new THREE.InstancedMesh( new THREE.CylinderGeometry( 0.16, 0.26, 1, 7 ).translate( 0, 0.5, 0 ),
	new THREE.MeshStandardNodeMaterial( { color: 0x4a3b2c, roughness: 1 } ), treeCount );
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
for ( let i = 0; i < treeCount; i ++ ) {

	const [ x, y, z, h, r ] = tree.slice( i * 5, i * 5 + 5 );
	const crownH = h * 0.4;
	// Three overlapping blobs per crown.
	for ( let k = 0; k < 3; k ++ ) {

		const a = i * 2.4 + k * 2.1, o = r * 0.35;
		q.setFromAxisAngle( THREE.Object3D.DEFAULT_UP, a );
		m.compose( p.set( x + Math.cos( a ) * o, y + h - crownH * ( 0.9 + 0.15 * k ), z + Math.sin( a ) * o ), q, s.set( r * 0.75, crownH * 0.8, r * 0.75 ) );
		crowns.setMatrixAt( i * 3 + k, m );
		crowns.setColorAt( i * 3 + k, c.setHSL( 0.23 + ( ( i * 0.37 + k * 0.11 ) % 0.05 ), 0.42, 0.24 + ( ( i * 0.61 + k * 0.2 ) % 0.07 ) ) );

	}

	m.compose( p.set( x, y, z ), q.identity(), s.set( 1, h - crownH * 1.2, 1 ) );
	trunks.setMatrixAt( i, m );

}

crowns.castShadow = crowns.receiveShadow = trunks.castShadow = true;
scene.add( crowns, trunks );

// ---------------------------------------------------------------------------
// Controls: orbit (overview) and walking at street level

const orbit = new OrbitControls( camera, renderer.domElement );
orbit.target.set( - 20, 5, 30 );
camera.position.set( - 260, 190, 280 );
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.minDistance = 20;
orbit.maxDistance = 900;
orbit.enableDamping = true;

const fp = data.footprints;
const footprintBits = new Uint8Array( footprintBuf );
function isBlocked( x, z ) {

	const col = Math.floor( ( x - bounds.minX ) / fp.cell ), row = Math.floor( ( z - bounds.minZ ) / fp.cell );
	if ( col < 0 || row < 0 || col >= fp.width || row >= fp.height ) return true;
	if ( groundHeight( x, z ) < data.waterLevel + 1 ) return true; // stay out of the river
	const i = row * fp.width + col;
	return ( footprintBits[ i >> 3 ] >> ( i & 7 ) ) & 1;

}

const walker = new Walker( camera, renderer.domElement, groundHeight, isBlocked );

const hud = {
	mode: document.getElementById( 'mode' ),
	help: document.getElementById( 'help' ),
	place: document.getElementById( 'place' )
};

let walking = false;
function setMode( walk ) {

	const wasWalking = walking;
	walking = walk;
	orbit.enabled = ! walk;
	walker.enabled = walk;
	hud.mode.textContent = walk ? 'Pohled shora (M)' : 'Projít se ulicemi (M)';
	hud.help.textContent = walk
		? 'Klikni pro rozhlížení myší · WASD chůze · Shift běh'
		: 'Táhni myší pro otáčení · kolečko přiblížení · pravé tlačítko posun';
	hud.place.style.display = walk ? 'block' : 'none';

	if ( walk ) {

		const [ x, z, yaw ] = ( params.get( 'at' ) || '0,0,2.35' ).split( ',' ).map( Number );
		walker.teleport( x, z, yaw );

	} else if ( wasWalking ) {

		if ( document.pointerLockElement ) document.exitPointerLock();
		const t = camera.position.clone();
		camera.position.set( t.x - 160, 180, t.z + 180 );
		orbit.target.set( t.x, 5, t.z );

	}

}

hud.mode.addEventListener( 'click', () => setMode( ! walking ) );
window.addEventListener( 'keydown', e => {

	if ( e.code === 'KeyM' ) setMode( ! walking );

} );
setMode( params.has( 'walk' ) );

// Nearest street name for the walking HUD.
const streetPts = data.streets.flatMap( st => st.paths.flatMap( path => {

	const pts = [];
	for ( let i = 0; i < path.length; i += 3 ) pts.push( [ path[ i ], path[ i + 2 ], st.name ] );
	return pts;

} ) );

function nearestStreet( x, z ) {

	let best = null, bd = 40 * 40;
	for ( const [ sx, sz, name ] of streetPts ) {

		const d = ( sx - x ) ** 2 + ( sz - z ) ** 2;
		if ( d < bd ) {

			bd = d;
			best = name;

		}

	}

	return best;

}

document.getElementById( 'credit' ).textContent = data.attribution + ' · rendering after Slop New York (MIT, Mr.doob)';

// ---------------------------------------------------------------------------

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const timer = new THREE.Timer();
let labelTimer = 0;

renderer.setAnimationLoop( () => {

	timer.update();
	const dt = Math.min( timer.getDelta(), 0.1 );

	if ( walking ) {

		walker.update( dt );
		labelTimer -= dt;
		if ( labelTimer <= 0 ) {

			labelTimer = 0.3;
			hud.place.textContent = nearestStreet( camera.position.x, camera.position.z ) || 'Staré Město';

		}

	} else {

		orbit.update();

	}

	renderer.render( scene, camera );

} );

document.getElementById( 'loading' ).remove();
window.__ready = true;
