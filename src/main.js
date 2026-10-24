import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFacadeMaterial, PLASTER } from './shading/facade.js';
import { createRoofMaterial, createGroundMaterial, createWaterMaterial } from './shading/surfaces.js';
import { Walker } from './walker.js';
import { addFurniture } from './furniture.js';
import { addSigns } from './signs.js';
import { addDecor, addEmbankment } from './decor.js';
import { addPlaces } from './places.js';
import { addLife } from './life.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMinimap } from './minimap.js';

async function load( name, type = 'arrayBuffer', dir = 'data/' ) {

	if ( ! window.PACKED_DATA ) return ( await fetch( `${dir}${name}` ) )[ type ]();

	// Hosted build: gzipped, base64-encoded text files (see tools/pack-artifact.mjs).
	const text = await ( await fetch( `${dir}${name}.gz.txt` ) ).text();
	const bytes = Uint8Array.from( atob( text ), c => c.charCodeAt( 0 ) );
	const unpacked = new Response( new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'gzip' ) ) );
	return unpacked[ type ]();

}

const [ data, wallsBuf, wallIdxBuf, roofsBuf, roofIdxBuf, terrainBuf, surfaceBuf, surface2Buf, pavementBuf, pavementIdxBuf, footprintBuf, embankmentBuf ] = await Promise.all( [
	load( 'scene.json', 'json' ),
	load( 'walls.bin' ),
	load( 'walls-index.bin' ),
	load( 'roofs.bin' ),
	load( 'roofs-index.bin' ),
	load( 'terrain.bin' ),
	load( 'surface.bin' ),
	load( 'surface2.bin' ),
	load( 'pavement.bin' ),
	load( 'pavement-index.bin' ),
	load( 'footprints.bin' ),
	load( 'embankment.bin' )
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
scene.environmentIntensity = 0.18;

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
scene.add( sun, sun.target, new THREE.HemisphereLight( 0xdfe6ee, 0xc49a6c, 0.75 ) );

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
const surfaceTexture = buf => {

	const tex = new THREE.DataTexture( new Uint8Array( buf ), S.width, S.height, THREE.RGBAFormat );
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;

};

const surface2 = new Uint8Array( surface2Buf );
const groundDetail = await new THREE.TextureLoader().loadAsync( 'data/ground-detail.jpg' );
groundDetail.flipY = false; // row 0 = north, like the surface maps
groundDetail.anisotropy = renderer.getMaxAnisotropy();
const groundMaterial = createGroundMaterial( surfaceTexture( surfaceBuf ), surfaceTexture( surface2Buf ), bounds, groundDetail );
const terrain = new THREE.Mesh( terrainGeo, groundMaterial );
terrain.receiveShadow = true;
scene.add( terrain );

// Raised pavements with their kerbs (double-sided: the kerb faces are only wound one way).
const pavementGeo = new THREE.BufferGeometry();
pavementGeo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( pavementBuf ), 3 ) );
pavementGeo.setIndex( new THREE.BufferAttribute( new Uint32Array( pavementIdxBuf ), 1 ) );
pavementGeo.computeVertexNormals();
const pavementMaterial = createGroundMaterial( surfaceTexture( surfaceBuf ), surfaceTexture( surface2Buf ), bounds, groundDetail );
pavementMaterial.side = THREE.DoubleSide;
const pavement = new THREE.Mesh( pavementGeo, pavementMaterial );
pavement.receiveShadow = true;
scene.add( pavement );

function terrainHeight( x, z ) {

	const fx = THREE.MathUtils.clamp( ( x - bounds.minX ) / T.cell, 0, T.width - 1.001 );
	const fz = THREE.MathUtils.clamp( ( z - bounds.minZ ) / T.cell, 0, T.height - 1.001 );
	const x0 = Math.floor( fx ), z0 = Math.floor( fz ), tx = fx - x0, tz = fz - z0;
	const i = z0 * T.width + x0;
	return ( heights[ i ] * ( 1 - tx ) + heights[ i + 1 ] * tx ) * ( 1 - tz ) +
		( heights[ i + T.width ] * ( 1 - tx ) + heights[ i + T.width + 1 ] * tx ) * tz;

}

// Walking surface: street level plus the raised pavement (kerb field in surface2's blue channel).
// Walkable zones from tools/places.mjs (rooms, doorways, stairs): oriented rectangles with their own floor height.
const zones = data.places?.zones || [];
function zoneAt( x, z ) {

	for ( const zn of zones ) {

		const dx = x - zn.x, dz = z - zn.z;
		if ( Math.abs( dx * zn.ux + dz * zn.uz ) < zn.hu && Math.abs( - dx * zn.uz + dz * zn.ux ) < zn.hn ) return zn;

	}

	return null;

}

function zoneHeight( zn, x, z ) {

	if ( zn.y !== undefined ) return zn.y;
	// Sloping zones (stairs, passages): y0 at the −along end, y1 at the +along end, in steps if it has them.
	let t = ( ( x - zn.x ) * zn.along[ 0 ] + ( z - zn.z ) * zn.along[ 1 ] ) / ( 2 * zn.hn ) + 0.5;
	t = Math.min( 1, Math.max( 0, t ) );
	if ( zn.steps ) t = Math.min( zn.steps, Math.floor( t * ( zn.steps + 1 ) ) ) / zn.steps;
	return zn.y0 + ( zn.y1 - zn.y0 ) * t;

}

function groundHeight( x, z ) {

	const zn = zoneAt( x, z );
	if ( zn ) return zoneHeight( zn, x, z );
	const col = Math.min( S.width - 1, Math.max( 0, Math.floor( ( x - bounds.minX ) / S.cell ) ) );
	const row = Math.min( S.height - 1, Math.max( 0, Math.floor( ( z - bounds.minZ ) / S.cell ) ) );
	const Fk = ( 128 - surface2[ ( row * S.width + col ) * 4 + 2 ] ) / 25;
	const raise = Fk > 0 && Fk < 8.5 ? data.kerbHeight : 0;
	return terrainHeight( x, z ) + raise;

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
// Packed into vec4s: WebGPU allows at most 16 values passed from vertex to fragment shader.
[ [ 'position', 3, 0 ], [ 'wallA', 4, 3 ], [ 'wallB', 4, 7 ], [ 'wallC', 4, 13 ], [ 'trimColour', 3, 17 ], [ 'house', 4, 20 ] ].forEach( ( [ name, size, offset ] ) => {

	wallGeo.setAttribute( name, new THREE.InterleavedBufferAttribute( wib, size, offset ) );

} );

// Landmark facades (style 1 Národní divadlo sandstone, 2 Máj beige panels, 3 Betlémská kaple white render).
const LANDMARK_COLOURS = { 1: 0xb59a74, 2: 0xd8d1c2, 3: 0xf1ede5 };
const plaster = new Float32Array( walls.length / ws * 3 );
const c = new THREE.Color();
for ( let i = 0, n = walls.length / ws; i < n; i ++ ) {

	// Measured colour from street photos when there is one, else a typical Prague plaster.
	const r = walls[ i * ws + 10 ];
	const landmark = LANDMARK_COLOURS[ walls[ i * ws + 16 ] ];
	if ( landmark ) c.setHex( landmark );
	else if ( r >= 0 ) c.setRGB( r, walls[ i * ws + 11 ], walls[ i * ws + 12 ], THREE.SRGBColorSpace );
	else c.setHex( PLASTER[ Math.floor( walls[ i * ws + 8 ] * PLASTER.length ) ] );
	plaster.set( [ c.r, c.g, c.b ], i * 3 );

}

wallGeo.setAttribute( 'plaster', new THREE.BufferAttribute( plaster, 3 ) );
wallGeo.setIndex( new THREE.BufferAttribute( new Uint32Array( wallIdxBuf ), 1 ) );
wallGeo.computeVertexNormals();
const wallMesh = new THREE.Mesh( wallGeo, createFacadeMaterial( data.places?.cutouts || [] ) );
wallMesh.castShadow = wallMesh.receiveShadow = true;
scene.add( wallMesh );

// ---------------------------------------------------------------------------
// Street furniture and trees (OpenStreetMap, plus canopy peaks found in the surface model)

// The chimney courtyard's benches and lamps, the museum gate's lanterns: ordinary furniture and decor.
const places = data.places;
if ( places?.yard ) {

	for ( const [ x, z, y, rot ] of places.yard.benches ) data.furniture.bench.push( x, y, z, rot, 1 );
	for ( const [ x, z, y ] of places.yard.lamps ) data.furniture.lamp.push( x, y, z, 0, 1 );

}

if ( places?.gate ) {

	const G = places.gate;
	for ( const side of [ - 1, 1 ] ) {

		const o = side * ( G.w / 2 + 0.95 );
		data.decor.lanterns.push( [ G.x + G.n[ 1 ] * o, G.y + 3.4, G.z - G.n[ 0 ] * o, Math.atan2( G.n[ 0 ], G.n[ 1 ] ) ] );

	}

}

addFurniture( scene, data.furniture );
addSigns( scene, data.signs || [], renderer );
addDecor( scene, data.decor );
addEmbankment( scene, embankmentBuf, data.embankment );

// Signature places (rotunda, pub, café, champagne bar, museum gate, stairs) and street life (people, cars).
const { seats } = addPlaces( scene, places, data.furniture );
// Models: Kenney's Mini Characters and Car Kit (CC0); textures resolve next to them.
const gltfLoader = new GLTFLoader();
const loadModel = async ( path, dir ) => gltfLoader.parseAsync( await load( path, 'arrayBuffer', '' ), dir );
const life = await addLife( scene, places?.life, { seats, benches: data.furniture.bench, groundHeight, loadModel, camera } );

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
	if ( zoneAt( x, z ) ) return false;
	if ( groundHeight( x, z ) < data.waterLevel + 1 ) return true; // stay out of the river
	const i = row * fp.width + col;
	return ( footprintBits[ i >> 3 ] >> ( i & 7 ) ) & 1;

}

// The third-person camera keeps out of houses (but not out of the walk-in rooms, nor over the river).
function cameraBlocked( x, z ) {

	const col = Math.floor( ( x - bounds.minX ) / fp.cell ), row = Math.floor( ( z - bounds.minZ ) / fp.cell );
	if ( col < 0 || row < 0 || col >= fp.width || row >= fp.height || zoneAt( x, z ) ) return false;
	const i = row * fp.width + col;
	return ( footprintBits[ i >> 3 ] >> ( i & 7 ) ) & 1;

}

const walker = new Walker( camera, renderer.domElement, groundHeight, isBlocked, scene, cameraBlocked );

const hud = {
	mode: document.getElementById( 'mode' ),
	help: document.getElementById( 'help' ),
	place: document.getElementById( 'place' )
};

// Minimap: places to find, and the landmarks.
const placeMarkers = [];
if ( places?.rotunda ) placeMarkers.push( { x: places.rotunda.x, z: places.rotunda.z, icon: 'R', colour: '#8a6d4b' } );
for ( const room of places?.interiors || [] ) placeMarkers.push( { x: room.x, z: room.z, icon: { pub: 'H', cafe: 'S', champagne: 'C' }[ room.style ], colour: { pub: '#2f6b45', cafe: '#333', champagne: '#b08a2e' }[ room.style ] } );
if ( places?.gate ) placeMarkers.push( { x: places.gate.x, z: places.gate.z, icon: 'M', colour: '#8f2a22' } );
if ( places?.stairs ) placeMarkers.push( { x: places.stairs.top[ 0 ], z: places.stairs.top[ 2 ], icon: '⇵', colour: '#5d6a78' } );
if ( data.furniture.chimney?.length ) placeMarkers.push( { x: data.furniture.chimney[ 0 ], z: data.furniture.chimney[ 2 ], icon: 'K', colour: '#9b4a32' } );
for ( const b of data.buildings ) {

	const icon = { 'Národní divadlo': 'D', 'Betlémská kaple': '✝' }[ b.name ];
	if ( icon ) placeMarkers.push( { x: b.x, z: b.z, icon, colour: '#4f6d8f' } );

}

const isTouch = matchMedia( '(pointer: coarse)' ).matches || navigator.maxTouchPoints > 0 && ! matchMedia( '(pointer: fine)' ).matches;
const minimap = createMinimap( {
	bounds, surface: new Uint8Array( surfaceBuf ), surface2, S, waterLevel: data.waterLevel, markers: placeMarkers, touch: isTouch,
	terrainHeight,
	isHouse: ( x, z ) => {

		const col = Math.floor( ( x - bounds.minX ) / fp.cell ), row = Math.floor( ( z - bounds.minZ ) / fp.cell );
		if ( col < 0 || row < 0 || col >= fp.width || row >= fp.height ) return false;
		const i = row * fp.width + col;
		return ( footprintBits[ i >> 3 ] >> ( i & 7 ) ) & 1;

	}
} );
if ( isTouch ) document.getElementById( 'hud' ).style.maxWidth = 'calc(100vw - 172px)';

let walking = false;
const touch = matchMedia( '(pointer: coarse)' ).matches || navigator.maxTouchPoints > 0 && ! matchMedia( '(pointer: fine)' ).matches;
function setMode( walk ) {

	const wasWalking = walking;
	walking = walk;
	orbit.enabled = ! walk;
	walker.setEnabled( walk, touch );
	hud.mode.textContent = ( walk ? 'Pohled shora' : 'Projít se ulicemi' ) + ( touch ? '' : ' (M)' );
	hud.help.textContent = touch
		? ( walk ? 'Joystick vlevo dole chůze (až k okraji běh) · táhni prstem kamerou' : 'Táhni prstem pro otáčení · dvěma prsty přiblížení a posun' )
		: walk
			? 'Klikni a ovládej kameru myší · WASD chůze · Shift běh · kolečko zoom · V pohled z očí'
			: 'Táhni myší pro otáčení · kolečko přiblížení · pravé tlačítko posun';
	hud.place.style.display = walk ? 'block' : 'none';
	minimap.setVisible( walk );

	if ( walk ) {

		// Back where you left off, or at the start.
		const [ x, z, yaw ] = walker.placed ? [ walker.pos.x, walker.pos.z, walker.yaw ] : ( params.get( 'at' ) || '-20,40,0.6' ).split( ',' ).map( Number );
		walker.teleport( x, z, yaw );
		walker.placed = true;

	} else if ( wasWalking ) {

		if ( document.pointerLockElement ) document.exitPointerLock();
		const t = walker.pos.clone();
		camera.position.set( t.x - 160, 180, t.z + 180 );
		orbit.target.set( t.x, 5, t.z );

	}

}

hud.mode.addEventListener( 'click', () => setMode( ! walking ) );
window.addEventListener( 'keydown', e => {

	if ( e.code === 'KeyM' ) setMode( ! walking );

} );
setMode( params.has( 'walk' ) );

// ?view=x,y,z,tx,ty,tz aims the overview camera (handy for sharing a viewpoint).
if ( params.has( 'view' ) && ! walking ) {

	const [ x, y, z, tx, ty, tz ] = params.get( 'view' ).split( ',' ).map( Number );
	camera.position.set( x, y, z );
	orbit.target.set( tx, ty, tz );

}

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

document.getElementById( 'credit' ).textContent = data.attribution + ' · fasády podle fotek © Mapillary (CC BY-SA) · postavy a auta: Kenney (CC0) · rendering after Slop New York (MIT, Mr.doob)';

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
	life.update( dt );

	if ( walking ) {

		walker.update( dt );
		minimap.update( walker.pos.x, walker.pos.z, walker.yaw, walker.heading );
		labelTimer -= dt;
		if ( labelTimer <= 0 ) {

			labelTimer = 0.3;
			hud.place.textContent = nearestStreet( walker.pos.x, walker.pos.z ) || 'Staré Město';

		}

	} else {

		orbit.update();

	}

	renderer.render( scene, camera );

} );

document.getElementById( 'loading' ).remove();
window.__debug = { camera, isBlocked, groundHeight, walker, life };
window.__THREE = THREE;
window.__ready = true;
