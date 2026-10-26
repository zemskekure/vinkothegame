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
import { addIcons } from './icons.js';
import { addShopfronts } from './fronts.js';
import ICONS from '../data/icons.json';
import { addLife } from './life.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createMinimap } from './minimap.js';
import { addTrams } from './trams.js';
import { onLegie } from './bridges.js';
import { SUN, ANIMATE } from './kit.js';
import { HOLUB_SUN, PIXEL_SCALE, holubLook, startHolub } from './holub/game.js';
import { startStory } from './holub/story.js';
import { ps1Look } from './holub/ps1.js';
import { startDay } from './holub/sky.js';
import { SETTINGS } from './settings.js';

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
// Letím jak holub: the pigeon game on the same city (src/holub/), from its own page or with ?holub.
// ?admin is the game's settings page (src/admin.js): the pigeon game with the map and the settings beside it.
const ADMIN = params.has( 'admin' );
const HOLUB = window.GAME === 'holub' || params.has( 'holub' ) || ADMIN;
if ( HOLUB ) SUN.copy( HOLUB_SUN );

// ---------------------------------------------------------------------------
// Renderer, sky, light

const renderer = new THREE.WebGPURenderer( { antialias: ! HOLUB, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) * ( HOLUB ? PIXEL_SCALE : 1 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.2, 20000 );

// Late-afternoon sun from the south-west (src/kit.js).
const sunDir = SUN.clone();

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
sun.shadow.mapSize.set( 2048, 2048 );
const half = Math.max( bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ ) * 0.62;
Object.assign( sun.shadow.camera, { left: - half, right: half, top: half, bottom: - half, near: 10, far: 1600 } );
sun.shadow.bias = - 0.0003;
sun.shadow.normalBias = 0.3;
sun.position.copy( sunDir ).multiplyScalar( 700 ).add( centre );
sun.target.position.copy( centre );
const hemi = new THREE.HemisphereLight( 0xdfe6ee, 0xc49a6c, 0.75 );
scene.add( sun, sun.target, hemi );
if ( HOLUB ) holubLook( { renderer, scene, sky, sun, hemi, camera } );

// ---------------------------------------------------------------------------
// Terrain and street surfaces

const T = data.terrain;
const heights = new Float32Array( terrainBuf );
const terrainGeo = new THREE.PlaneGeometry( ( T.width - 1 ) * T.cell, ( T.height - 1 ) * T.cell, T.width - 1, T.height - 1 );
terrainGeo.rotateX( - Math.PI / 2 );
terrainGeo.translate( centre.x, 0, centre.z );
const tp = terrainGeo.attributes.position;
for ( let i = 0; i < tp.count; i ++ ) tp.setY( i, heights[ i ] );
// Retaining walls (tools/quay.mjs: the náplavka's wall under Smetanovo nábřeží, Čapadlo's lane): the 1 m grid would
// ramp across a wall's foot. Grid points within 1.5 m of the wall line move onto it (the high ones from behind, the
// low ones from in front), and the triangles still spanning from the top to the foot are dropped: the ground meets
// the wall face in a straight line on both sides.
{

	const gx0 = tp.getX( 0 ), gz0 = tp.getZ( 0 ), mark = new Uint8Array( tp.count ), mids = new Float32Array( tp.count );
	for ( const [ x0, z0, x1, z1, nx, nz, top, low ] of data.cliffs || [] ) {

		const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz, mid = ( top + low ) / 2;
		if ( ! l2 ) continue;
		const c0 = Math.max( 0, Math.floor( ( Math.min( x0, x1 ) - 1.6 - gx0 ) / T.cell ) ), c1 = Math.min( T.width - 1, Math.ceil( ( Math.max( x0, x1 ) + 1.6 - gx0 ) / T.cell ) );
		const r0 = Math.max( 0, Math.floor( ( Math.min( z0, z1 ) - 1.6 - gz0 ) / T.cell ) ), r1 = Math.min( T.height - 1, Math.ceil( ( Math.max( z0, z1 ) + 1.6 - gz0 ) / T.cell ) );
		for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

			const i = r * T.width + c, x = gx0 + c * T.cell, z = gz0 + r * T.cell;
			if ( mark[ i ] ) continue;
			const t = ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / l2;
			if ( t < - 0.01 || t > 1.01 ) continue;
			const d = ( x - x0 ) * nx + ( z - z0 ) * nz, y = heights[ i ];
			if ( Math.abs( d ) >= 1.5 ) continue;
			const to = y > mid ? - 0.02 : 0.02;
			tp.setXYZ( i, x - nx * ( d - to ), y, z - nz * ( d - to ) );
			mark[ i ] = 1;
			mids[ i ] = mid;

		}

	}

	const index = terrainGeo.index.array, kept = [];
	for ( let k = 0; k < index.length; k += 3 ) {

		const v = [ index[ k ], index[ k + 1 ], index[ k + 2 ] ], m = v.find( i => mark[ i ] );
		if ( m !== undefined ) {

			const mid = mids[ m ];
			if ( v.some( i => heights[ i ] > mid ) && v.some( i => heights[ i ] < mid ) ) continue;

		}

		kept.push( ...v );

	}

	if ( kept.length < index.length ) terrainGeo.setIndex( kept );

}

terrainGeo.computeVertexNormals();

const S = data.surface;
const surfaceTexture = buf => {

	const tex = new THREE.DataTexture( new Uint8Array( buf ), S.width, S.height, THREE.RGBAFormat );
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;

};

const surface2 = new Uint8Array( surface2Buf );
const surfaceBytes = new Uint8Array( surfaceBuf );
const groundDetail = await new THREE.TextureLoader().loadAsync( 'data/ground-detail.jpg' );
groundDetail.flipY = false; // row 0 = north, like the surface maps
groundDetail.anisotropy = renderer.getMaxAnisotropy();
const groundMaterial = createGroundMaterial( surfaceTexture( surfaceBuf ), surfaceTexture( surface2Buf ), bounds, groundDetail );
const terrain = new THREE.Mesh( terrainGeo, groundMaterial );
terrain.receiveShadow = true;
scene.add( terrain );

// Decks over a street below (tools/terraces.mjs): Národní over Divadelní, the piazzetta's edge over the covered
// pavement. Slabs of their own, drawn with the street's surface; the street below is in the terrain.
{

	const decks = data.places?.theatre?.decks;
	if ( decks ) {

		const pos = [], quadAt = ( a, b, c, d ) => pos.push( ...a, ...b, ...c, ...a, ...c, ...d );
		const t = decks.tunnel, y = t.y + 0.01;
		quadAt( [ t.x0, y, t.z0 ], [ t.x0, y, t.z1 ], [ t.x1, y, t.z1 ], [ t.x1, y, t.z0 ] );
		for ( let i = 1; i < decks.strip.length; i ++ ) {

			const [ za, xa0, xa1, ya ] = decks.strip[ i - 1 ], [ zb, xb0, xb1, yb ] = decks.strip[ i ];
			quadAt( [ xa0, ya + 0.01, za ], [ xb0, yb + 0.01, zb ], [ xb1, yb + 0.01, zb ], [ xa1, ya + 0.01, za ] );

		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
		geo.computeVertexNormals();
		const deck = new THREE.Mesh( geo, groundMaterial );
		deck.receiveShadow = true;
		scene.add( deck );

	}

}

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
// A zone with a `deck` lies under a walkable deck (the road under Národní, the pavement under the piazzetta's edge):
// it holds only for a walker down at its level (`y`, the walker's height; null: above, on the deck); the deck's own
// zone (`over`) only for one up on it.
const zones = data.places?.zones || [];
// An underpass zone (`under`: Čapadlo under Smetanovo nábřeží) is the ground only for someone below its ceiling
// (y: the asker's height; null: anyone else, who stays on the street above). Decks: see `deck` / `over` below.
let walkerLevel = () => null;
function zoneAt( x, z, y = walkerLevel() ) {

	for ( const zn of zones ) {

		if ( zn.under && ( y === null || y === undefined || y > zn.ceil ) ) continue;
		const dx = x - zn.x, dz = z - zn.z;
		if ( Math.abs( dx * zn.ux + dz * zn.uz ) < zn.hu && Math.abs( - dx * zn.uz + dz * zn.ux ) < zn.hn ) {

			if ( zn.deck !== undefined && ( y === null || y > ( ( zn.y ?? Math.min( zn.y0, zn.y1 ) ) + zn.deck ) / 2 ) ) continue;
			// A zone `over` a lower level (the deck itself) holds for a walker up there, and for everything else.
			if ( zn.over !== undefined && y !== null && y <= ( ( zn.y ?? Math.min( zn.y0, zn.y1 ) ) + zn.over ) / 2 ) continue;
			return zn;

		}

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

// Next to a retaining wall (the cliffs above), the ground is the wall's top on its high side and its foot on the
// low side, not the 1 m grid's ramp between them. On a 0.5 m grid of the wall segments within 2 m.
const cliffGrid = new Map();
for ( const seg of data.cliffs || [] ) {

	const [ x0, z0, x1, z1 ] = seg;
	for ( let x = Math.min( x0, x1 ) - 2; x <= Math.max( x0, x1 ) + 2; x += 0.5 ) for ( let z = Math.min( z0, z1 ) - 2; z <= Math.max( z0, z1 ) + 2; z += 0.5 ) {

		const key = Math.floor( ( z - bounds.minZ ) / 0.5 ) * 100000 + Math.floor( ( x - bounds.minX ) / 0.5 );
		if ( ! cliffGrid.has( key ) ) cliffGrid.set( key, [] );
		cliffGrid.get( key ).push( seg );

	}

}

function cliffClamp( x, z, h ) {

	const segs = cliffGrid.get( Math.floor( ( z - bounds.minZ ) / 0.5 ) * 100000 + Math.floor( ( x - bounds.minX ) / 0.5 ) );
	if ( ! segs ) return h;
	let best = null, bd = 2;
	for ( const seg of segs ) {

		const [ x0, z0, x1, z1 ] = seg, dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
		const t = Math.max( 0, Math.min( 1, ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / l2 ) );
		const dd = Math.hypot( x - x0 - t * dx, z - z0 - t * dz );
		if ( dd < bd ) {

			bd = dd;
			best = seg;

		}

	}

	if ( ! best ) return h;
	const [ x0, z0, , , nx, nz, top, low ] = best;
	return ( x - x0 ) * nx + ( z - z0 ) * nz < 0 ? Math.max( h, top ) : Math.min( h, low );

}

// Ground for everything but the walker (trams, people, furniture): the upper level where two overlap.
function groundHeight( x, z, y = null ) {

	const zn = zoneAt( x, z, y );
	if ( zn ) return zoneHeight( zn, x, z );
	const col = Math.min( S.width - 1, Math.max( 0, Math.floor( ( x - bounds.minX ) / S.cell ) ) );
	const row = Math.min( S.height - 1, Math.max( 0, Math.floor( ( z - bounds.minZ ) / S.cell ) ) );
	const Fk = ( 128 - surface2[ ( row * S.width + col ) * 4 + 2 ] ) / 25;
	const raise = Fk > 0 && Fk < 8.5 ? data.kerbHeight : 0;
	return cliffClamp( x, z, terrainHeight( x, z ) ) + raise;

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

// Landmark facades (style 1 Národní divadlo sandstone, 2 Máj white panels, 3 Betlémská kaple white render).
const LANDMARK_COLOURS = { 1: 0xb59a74, 2: 0xe6e6e2, 3: 0xf1ede5 };
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
// Described ground floors (tools/build-scene.mjs): one row per street front, one texel per 0.25 m of the front
// holding the opening there: kind + 10 × frame colour, its left and right edge (m) and flags. Half floats: those
// are filterable under WebGPU too (32-bit floats are not), and keep the edges to about 3 cm.
const GF_TEXELS = 256;
const groundRows = data.groundFloors || [];
const gfData = new Uint16Array( GF_TEXELS * Math.max( 1, groundRows.length ) * 4 );
groundRows.forEach( ( row, r ) => {

	for ( const [ u0, u1, kind, frame, flags ] of row ) {

		for ( let t = Math.max( 0, Math.floor( u0 / 0.25 ) ); t <= Math.min( GF_TEXELS - 1, Math.floor( u1 / 0.25 ) ); t ++ ) {

			gfData.set( [ kind + 10 * frame, u0, u1, flags ].map( THREE.DataUtils.toHalfFloat ), ( r * GF_TEXELS + t ) * 4 );

		}

	}

} );
const groundFloorTexture = new THREE.DataTexture( gfData, GF_TEXELS, Math.max( 1, groundRows.length ), THREE.RGBAFormat, THREE.HalfFloatType );
groundFloorTexture.magFilter = groundFloorTexture.minFilter = THREE.NearestFilter;
groundFloorTexture.needsUpdate = true;

const wallMesh = new THREE.Mesh( wallGeo, createFacadeMaterial( data.places?.cutouts || [], groundFloorTexture ) );
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
// Generic name boards from OpenStreetMap: off until the city gets its own signs and logos (?signs shows them).
if ( params.has( 'signs' ) ) addSigns( scene, data.signs || [], renderer );
addDecor( scene, data.decor );
await addShopfronts( scene, data.decor?.shopfronts );
addEmbankment( scene, embankmentBuf, data.embankment );

// Signature places (rotunda, pub, café, champagne bar, museum gate, stairs) and street life (people, cars).
const { seats } = addPlaces( scene, places, data.furniture, data.waterLevel );
// Local icons: big lettering, sculptures, domed corner towers (data/icons.json).
addIcons( scene, ICONS, groundHeight, data.buildings );
// Models: Quaternius' people and Kenney's Car Kit (CC0); textures resolve next to them. The people are
// meshopt-compressed.
const gltfLoader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
const loadModel = async ( path, dir ) => gltfLoader.parseAsync( await load( path, 'arrayBuffer', '' ), dir );
const life = await addLife( scene, places?.life, { seats, benches: data.furniture.bench, groundHeight, loadModel, camera, cars: params.has( 'cars' ) } ); // cars hidden for now (?cars shows them)

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
// Walk barriers (tools/places.mjs): railings along the river edge, each blocking above a height (-99: always;
// higher: you pass below it, through the underpass under the street). On a 0.5 m grid of segment lists.
const BAR = 0.5, barW = Math.ceil( ( bounds.maxX - bounds.minX ) / BAR ), barGrid = new Map();
for ( const seg of data.places?.barriers || [] ) {

	const [ x0, z0, x1, z1 ] = seg, n = Math.ceil( Math.hypot( x1 - x0, z1 - z0 ) / 0.2 ) + 1;
	for ( let k = 0; k <= n; k ++ ) {

		const x = x0 + ( x1 - x0 ) * k / n, z = z0 + ( z1 - z0 ) * k / n;
		const key = Math.floor( ( z - bounds.minZ ) / BAR ) * barW + Math.floor( ( x - bounds.minX ) / BAR );
		if ( ! barGrid.has( key ) ) barGrid.set( key, new Set() );
		barGrid.get( key ).add( seg );

	}

}

function barrierAt( x, z, y ) {

	const segs = barGrid.get( Math.floor( ( z - bounds.minZ ) / BAR ) * barW + Math.floor( ( x - bounds.minX ) / BAR ) );
	if ( ! segs ) return false;
	for ( const [ x0, z0, x1, z1, above, below = - Infinity ] of segs ) {

		// Blocks a walker at or over `above`, or under `below` (a wall under a deck stops only the walker below).
		if ( y < above && y >= below ) continue;
		const dx = x1 - x0, dz = z1 - z0, t = Math.max( 0, Math.min( 1, ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );
		if ( Math.hypot( x - x0 - t * dx, z - z0 - t * dz ) < 0.2 ) return true;

	}

	return false;

}

// The walker's height (set once it stands somewhere), for the barriers and the underpass zones.
let walkerHeight = () => Infinity;

// Ceiling over a walkable zone (underpass, passages, arcades): the third-person camera stays below it.
const ceilingAt = ( x, z ) => zoneAt( x, z, walkerHeight() )?.ceil ?? Infinity;

function isBlocked( x, z ) {

	const col = Math.floor( ( x - bounds.minX ) / fp.cell ), row = Math.floor( ( z - bounds.minZ ) / fp.cell );
	if ( col < 0 || row < 0 || col >= fp.width || row >= fp.height ) return true;
	const y = walkerHeight();
	if ( barrierAt( x, z, y ) ) return true;
	if ( zoneAt( x, z, y ) ) return false;
	if ( groundHeight( x, z, y ) < data.waterLevel + 1 ) return true; // stay out of the river
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

const walker = new Walker( camera, renderer.domElement, ( x, z ) => groundHeight( x, z, walker.placed ? walker.y : null ), isBlocked, scene, cameraBlocked, ceilingAt );
walker.setScooter( loadModel );
// How rough the street is under the scooter: 0 asphalt, ½ paving stones, 1 granite setts (surface2: the carriageway's
// surface on the road, the open area's off it), plus a jolt across the tram rails.
walker.roughAt = ( x, z ) => {

	const col = Math.min( S.width - 1, Math.max( 0, Math.floor( ( x - bounds.minX ) / S.cell ) ) );
	const row = Math.min( S.height - 1, Math.max( 0, Math.floor( ( z - bounds.minZ ) / S.cell ) ) );
	const i = ( row * S.width + col ) * 4;
	const onRoad = surfaceBytes[ i + 2 ] > 128;
	const code = onRoad ? surface2[ i ] : surface2[ i + 1 ];
	const rails = surfaceBytes[ i + 3 ] < 20 ? 0.6 : 0;
	return Math.max( rails, code === 40 ? 0.3 : 1 - code / 255 );

};
walkerHeight = () => walker.placed ? walker.y + 0.5 : Infinity;
walkerLevel = () => walker.placed ? walker.y : null;

// Trams and their overhead line (poles kept out of houses).
const trams = await addTrams( scene, places?.life?.trams, groundHeight, ( x, z ) => cameraBlocked( x, z ) || onLegie( places?.legie, x, z ) );

const hud = {
	mode: document.getElementById( 'mode' ),
	help: document.getElementById( 'help' ),
	place: document.getElementById( 'place' )
};

// Minimap: places to find, and the landmarks.
const placeMarkers = [];
if ( places?.rotunda ) placeMarkers.push( { x: places.rotunda.x, z: places.rotunda.z, icon: 'R', colour: '#8a6d4b' } );
for ( const room of places?.interiors || [] ) placeMarkers.push( { x: room.x, z: room.z, icon: { pub: 'H', cafe: 'S', champagne: 'C', slavia: 'K', vecerka: 'Ph' }[ room.style ], colour: { pub: '#2f6b45', cafe: '#333', champagne: '#b08a2e', slavia: '#2f5b3c', vecerka: '#9e1b1b' }[ room.style ] } );
if ( places?.gate ) placeMarkers.push( { x: places.gate.x, z: places.gate.z, icon: 'M', colour: '#8f2a22' } );
if ( places?.stairs ) placeMarkers.push( { x: places.stairs.top[ 0 ], z: places.stairs.top[ 2 ], icon: '⇵', colour: '#5d6a78' } );
if ( data.furniture.chimney?.length ) placeMarkers.push( { x: data.furniture.chimney[ 0 ], z: data.furniture.chimney[ 2 ], icon: 'K', colour: '#9b4a32' } );
for ( const b of data.buildings ) {

	const icon = { 'Národní divadlo': 'D', 'Betlémská kaple': '✝', 'Nová scéna': 'N', Quadrio: 'Q', 'Máj': 'Á' }[ b.name ];
	if ( icon ) placeMarkers.push( { x: b.x, z: b.z, icon, colour: '#4f6d8f' } );

}

// Signature fronts with their lettering: Kavárna Slavia, Platýz, Žofín, Mánes…; the Šítkov tower and Žofín's pavilion.
const SIGN_ICONS = { 'KAVÁRNA SLAVIA': [ 'K', '#2f5b3c' ], 'PLATÝZ': [ 'P', '#7a6a4f' ], 'ŽOFÍN': [ 'Ž', '#b8902f' ], 'KARLOVY LÁZNĚ': [ 'L', '#c2387f' ], 'FAMU': [ 'F', '#1f2d4d' ], 'UNIVERZITA KARLOVA · FAKULTA SOCIÁLNÍCH VĚD': [ 'U', '#1f2d4d' ] };
for ( const s of places?.signs || [] ) {

	const m = SIGN_ICONS[ s.text ];
	if ( m && ! placeMarkers.some( p => p.icon === m[ 0 ] && Math.hypot( p.x - s.x, p.z - s.z ) < 40 ) ) placeMarkers.push( { x: s.x, z: s.z, icon: m[ 0 ], colour: m[ 1 ] } );

}

if ( places?.sitkov ) placeMarkers.push( { x: places.sitkov.x, z: places.sitkov.z, icon: 'V', colour: '#4f7a68' } );
if ( places?.bandstand ) placeMarkers.push( { x: places.bandstand.x, z: places.bandstand.z, icon: '♫', colour: '#26352d' } );

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

// Start on Betlémské náměstí, at the west end of the square by Oliva Nera's terrace, looking at the chapel.
function startAt() {

	const [ x, z, tx, tz ] = [ - 78, 68, - 42, 52 ];
	return `${x},${z},${Math.atan2( - ( tx - x ), - ( tz - z ) ).toFixed( 3 )}`;

}

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
			? 'Klikni a ovládej kameru myší · WASD chůze · Shift běh · B skútr · kolečko zoom · V pohled z očí · Tab mapa'
			: 'Táhni myší pro otáčení · kolečko přiblížení · pravé tlačítko posun';
	hud.place.style.display = walk ? 'block' : 'none';
	minimap.setVisible( walk );

	if ( walk ) {

		// Back where you left off, or at the start.
		// ?at=x,z,yaw[,y]: y picks the level where one lies over another (the walker starts at street level).
		const [ x, z, yaw, y ] = walker.placed ? [ walker.pos.x, walker.pos.z, walker.yaw ] : ( params.get( 'at' ) || startAt() ).split( ',' ).map( Number );
		if ( Number.isFinite( y ) ) walker.y = y;
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

	if ( e.code === 'KeyM' && ! HOLUB ) setMode( ! walking );

} );
// The pigeon (?holub) instead of the walker: by default on Betlémské náměstí by the terrace, facing the chapel
// (game settings, `pigeon.start`: x, z, heading).
const holubStart = SETTINGS.pigeon.start;
const holub = HOLUB ? startHolub( { scene, camera, dom: renderer.domElement, roofGeo, bounds, groundHeight, waterLevel: data.waterLevel, places, furniture: data.furniture, life, start: holubStart, indoors: ( x, z ) => { const zn = zoneAt( x, z ); return !! zn && zn.y !== undefined && zn.ceil === undefined; } } ) : null;
// The pigeon's first day (egg, tutorial) and the clock that moves the sun and the light.
const story = holub ? startStory( { scene, camera, holub, start: holubStart } ) : null;
const day = holub ? startDay( { renderer, scene, sky, sun, hemi, centre, hour: SETTINGS.day.startHour, minutes: SETTINGS.day.minutes, tune: SETTINGS.look } ) : null;
if ( HOLUB ) {

	orbit.enabled = false;
	minimap.setVisible( true );
	hud.place.style.display = 'block';
	document.title = 'Letím jak holub';

} else setMode( ! params.has( 'overview' ) ); // start on foot; ?overview for the view from above

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

// The big map (a click on the dial, or Tab): click a place to be there at once, on foot or as the pigeon.
function openBigMap() {

	if ( minimap.isOpen || ! ( holub || walking ) ) return;
	if ( document.pointerLockElement ) document.exitPointerLock();
	const me = holub ? holub.pos : walker.pos;
	const wasLocked = holub?.locked;
	if ( holub ) holub.locked = true;
	minimap.openMap( {
		x: me.x, z: me.z, labelAt: nearestStreet,
		onClose: () => {

			if ( holub ) holub.locked = wasLocked;

		},
		onPick: ( x, z ) => {

			if ( holub ) holub.place( x, z, holub.heading );
			else walker.teleport( x, z, walker.yaw );

		}
	} );

}

minimap.view.addEventListener( 'click', openBigMap );
addEventListener( 'keydown', e => {

	if ( e.code !== 'Tab' || minimap.isOpen || e.target.closest?.( 'input, textarea, select' ) ) return;
	e.preventDefault();
	openBigMap();

} );

document.getElementById( 'credit' ).textContent = data.attribution + ' · fasády podle fotek © Mapillary (CC BY-SA) · lidé: Quaternius (CC0) · auta: Kenney (CC0) · rendering after Slop New York (MIT, Mr.doob)';

// ---------------------------------------------------------------------------

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const timer = new THREE.Timer();
let labelTimer = 0;

// The pigeon game is shown as a late-90s console picture (src/holub/ps1.js); ?hd turns that off.
const ps1 = HOLUB && ! params.has( 'hd' ) ? ps1Look( { renderer, scene, camera } ) : null;
if ( ps1 ) renderer.setPixelRatio( 1 );

// The admin page: the settings and the map from above beside the running game.
if ( ADMIN ) ( await import( './admin.js' ) ).startAdmin( { bounds, map: minimap.map, life, ps1, day, holub } );

// Battery: at most 60 frames a second (30 in the pigeon game's low-resolution picture), however fast the screen
// refreshes, and the sun's shadows redrawn every third frame, not every frame. ?fps=N sets the cap.
const FPS = Number( params.get( 'fps' ) ) || ( ps1 ? 30 : 60 );
renderer.shadowMap.autoUpdate = false;
let lastFrame = 0, frameNo = 0;
renderer.setAnimationLoop( () => {

	const now = performance.now();
	if ( now - lastFrame < 1000 / FPS - 2 ) return;
	lastFrame = now;
	if ( frameNo ++ % 3 === 0 ) renderer.shadowMap.needsUpdate = true;
	timer.update();
	const dt = Math.min( timer.getDelta(), 0.1 );
	life.update( dt );
	trams.update( dt );

	if ( holub ) {

		holub.update( dt );
		story.update( dt );
		day.update( dt );
		minimap.update( holub.pos.x, holub.pos.z, holub.yaw, holub.heading );
		labelTimer -= dt;
		if ( labelTimer <= 0 ) {

			labelTimer = 0.3;
			hud.place.textContent = nearestStreet( holub.pos.x, holub.pos.z ) || 'Staré Město';

		}

	} else if ( walking ) {

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

	if ( ps1 ) ps1.render(); else renderer.render( scene, camera );

} );

document.getElementById( 'loading' ).remove();
window.__debug = { camera, isBlocked, groundHeight, walker, life, trams, holub };
window.__THREE = THREE;
window.__ready = true;
