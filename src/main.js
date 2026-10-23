import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
	createRoofMaterial, createGroundMaterial, createWallMaterial, createWaterMaterial, PLASTER
} from './materials.js';
import { Walker } from './walker.js';

const load = async ( name, type = 'arrayBuffer' ) => ( await fetch( `data/${name}` ) )[ type ]();

const [ scene_, wallsBuf, roofsBuf, roofIdxBuf, terrainBuf, footprintBuf, ortho ] = await Promise.all( [
	load( 'scene.json', 'json' ),
	load( 'walls.bin' ),
	load( 'roofs.bin' ),
	load( 'roofs-index.bin' ),
	load( 'terrain.bin' ),
	load( 'footprints.bin' ),
	new THREE.TextureLoader().loadAsync( 'data/ortho.jpg' )
] );

const data = scene_;
const { bounds } = data;

// ---------------------------------------------------------------------------
// Renderer, scene, sky

const params = new URLSearchParams( location.search );
const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.3, 20000 );

const sunDir = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 52 ), THREE.MathUtils.degToRad( 215 ) );

const sky = new SkyMesh();
sky.scale.setScalar( 10000 );
sky.material.fog = false;
sky.turbidity.value = 4;
sky.rayleigh.value = 1.2;
sky.mieCoefficient.value = 0.004;
sky.mieDirectionalG.value = 0.8;
sky.sunPosition.value.copy( sunDir );
scene.add( sky );

// Image-based light from the sky.
const pmrem = new THREE.PMREMGenerator( renderer );
const envScene = new THREE.Scene();
envScene.add( sky.clone() );
scene.environment = pmrem.fromScene( envScene ).texture;
scene.environmentIntensity = 0.35;

scene.fog = new THREE.Fog( 0xc6d4de, 500, 1800 );

const sun = new THREE.DirectionalLight( 0xfff1dc, 3.2 );
sun.position.copy( sunDir ).multiplyScalar( 700 );
sun.castShadow = true;
sun.shadow.mapSize.set( 4096, 4096 );
const half = Math.max( bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ ) * 0.62;
Object.assign( sun.shadow.camera, { left: - half, right: half, top: half, bottom: - half, near: 10, far: 1600 } );
sun.shadow.bias = - 0.0004;
sun.shadow.normalBias = 0.4;
const centre = new THREE.Vector3( ( bounds.minX + bounds.maxX ) / 2, 0, ( bounds.minZ + bounds.maxZ ) / 2 );
sun.target.position.copy( centre );
sun.position.add( centre );
scene.add( sun, sun.target );

ortho.colorSpace = THREE.SRGBColorSpace;
ortho.anisotropy = renderer.getMaxAnisotropy();

// ---------------------------------------------------------------------------
// Terrain

const T = data.terrain;
const heights = new Float32Array( terrainBuf );
const terrainGeo = new THREE.PlaneGeometry( ( T.width - 1 ) * T.cell, ( T.height - 1 ) * T.cell, T.width - 1, T.height - 1 );
terrainGeo.rotateX( - Math.PI / 2 );
terrainGeo.translate( centre.x, 0, centre.z );
const tp = terrainGeo.attributes.position;
for ( let i = 0; i < tp.count; i ++ ) tp.setY( i, heights[ i ] );
terrainGeo.computeVertexNormals();
const terrain = new THREE.Mesh( terrainGeo, createGroundMaterial( ortho, bounds ) );
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

// River surface: a flat sheet just above the lowest terrain, hidden by the embankments elsewhere.
const water = new THREE.Mesh(
	new THREE.PlaneGeometry( bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ ).rotateX( - Math.PI / 2 ),
	createWaterMaterial()
);
water.position.set( centre.x, data.waterLevel, centre.z );
water.receiveShadow = true;
scene.add( water );

// Surroundings beyond the data area, so the edge fades into fog instead of void.
const skirt = new THREE.Mesh(
	new THREE.RingGeometry( 1, 6000, 4, 1 ).rotateX( - Math.PI / 2 ),
	new THREE.MeshStandardNodeMaterial( { color: 0x8a8378, roughness: 1 } )
);
skirt.position.set( centre.x, data.waterLevel - 2, centre.z );
scene.add( skirt );

// ---------------------------------------------------------------------------
// Buildings

const roofGeo = new THREE.BufferGeometry();
roofGeo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( roofsBuf ), 3 ) );
roofGeo.setIndex( new THREE.BufferAttribute( new Uint32Array( roofIdxBuf ), 1 ) );
roofGeo.computeVertexNormals();
const roofs = new THREE.Mesh( roofGeo, createRoofMaterial( ortho, bounds ) );
roofs.castShadow = roofs.receiveShadow = true;
scene.add( roofs );

const walls = new Float32Array( wallsBuf );
const stride = data.wallStride;
const wallGeo = new THREE.BufferGeometry();
const ib = new THREE.InterleavedBuffer( walls, stride );
wallGeo.setAttribute( 'position', new THREE.InterleavedBufferAttribute( ib, 3, 0 ) );
wallGeo.setAttribute( 'wallU', new THREE.InterleavedBufferAttribute( ib, 1, 3 ) );
wallGeo.setAttribute( 'wallBase', new THREE.InterleavedBufferAttribute( ib, 1, 4 ) );
wallGeo.setAttribute( 'floorH', new THREE.InterleavedBufferAttribute( ib, 1, 5 ) );
wallGeo.setAttribute( 'seed', new THREE.InterleavedBufferAttribute( ib, 1, 6 ) );
wallGeo.setAttribute( 'party', new THREE.InterleavedBufferAttribute( ib, 1, 7 ) );

const plaster = new Float32Array( walls.length / stride * 3 );
const c = new THREE.Color();
for ( let i = 0, n = walls.length / stride; i < n; i ++ ) {

	const seed = walls[ i * stride + 6 ];
	c.setHex( PLASTER[ Math.floor( seed * PLASTER.length ) ] );
	plaster.set( [ c.r, c.g, c.b ], i * 3 );

}

wallGeo.setAttribute( 'plaster', new THREE.BufferAttribute( plaster, 3 ) );
wallGeo.computeVertexNormals();
const wallMesh = new THREE.Mesh( wallGeo, createWallMaterial() );
wallMesh.castShadow = wallMesh.receiveShadow = true;
scene.add( wallMesh );

// ---------------------------------------------------------------------------
// Trees (canopy peaks found in the surface model)

const tree = data.trees;
const treeCount = tree.length / 5;
const crownGeo = new THREE.IcosahedronGeometry( 1, 2 );
const crowns = new THREE.InstancedMesh( crownGeo, new THREE.MeshStandardNodeMaterial( { roughness: 1, flatShading: true } ), treeCount );
const trunks = new THREE.InstancedMesh( new THREE.CylinderGeometry( 0.18, 0.28, 1, 6 ).translate( 0, 0.5, 0 ),
	new THREE.MeshStandardNodeMaterial( { color: 0x4a3b2c, roughness: 1 } ), treeCount );
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
for ( let i = 0; i < treeCount; i ++ ) {

	const [ x, y, z, h, r ] = tree.slice( i * 5, i * 5 + 5 );
	const crownH = h * 0.42;
	q.setFromAxisAngle( THREE.Object3D.DEFAULT_UP, i * 2.4 );
	m.compose( p.set( x, y + h - crownH, z ), q, s.set( r, crownH, r ) );
	crowns.setMatrixAt( i, m );
	crowns.setColorAt( i, c.setHSL( 0.22 + ( ( i * 0.37 ) % 0.06 ), 0.35, 0.2 + ( ( i * 0.61 ) % 0.08 ) ) );
	m.compose( p.set( x, y, z ), q, s.set( 1, h - crownH * 1.5, 1 ) );
	trunks.setMatrixAt( i, m );

}

crowns.castShadow = crowns.receiveShadow = trunks.castShadow = true;
scene.add( crowns, trunks );

// ---------------------------------------------------------------------------
// Controls: orbit (overview) and walking at street level

const orbit = new OrbitControls( camera, renderer.domElement );
orbit.target.set( - 20, 5, 30 );
camera.position.set( - 330, 260, 330 );
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.minDistance = 20;
orbit.maxDistance = 900;
orbit.enableDamping = true;

const fp = data.footprints;
const footprintBits = new Uint8Array( footprintBuf );
function isBlocked( x, z ) {

	const col = Math.floor( ( x - bounds.minX ) / fp.cell ), row = Math.floor( ( z - bounds.minZ ) / fp.cell );
	if ( col < 0 || row < 0 || col >= fp.width || row >= fp.height ) return true;
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

	walking = walk;
	orbit.enabled = ! walk;
	walker.enabled = walk;
	hud.mode.textContent = walk ? 'Pohled shora (Esc, M)' : 'Projít se ulicemi (M)';
	hud.help.textContent = walk
		? 'Klikni pro rozhlížení myší · WASD chůze · Shift běh'
		: 'Táhni myší pro otáčení · kolečko přiblížení · pravé tlačítko posun';
	hud.place.style.display = walk ? 'block' : 'none';

	if ( walk ) {

		// Start on Betlémské náměstí, facing the chapel.
		walker.teleport( 0, 0, Math.PI * 0.75 );

	} else {

		camera.position.set( camera.position.x - 160, 200, camera.position.z + 160 );
		orbit.target.set( camera.position.x + 160, 5, camera.position.z - 160 );

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

document.getElementById( 'credit' ).textContent = data.attribution;

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
