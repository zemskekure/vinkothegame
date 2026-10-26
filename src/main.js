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
import { addBoats } from './boats.js';
import { onLegie } from './bridges.js';
import { SUN, ANIMATE } from './kit.js';
import { HOLUB_SUN, PIXEL_SCALE, holubLook, startHolub } from './holub/game.js';
import { startStory } from './holub/story.js';
import { ps1Look } from './holub/ps1.js';
import { startDay } from './holub/sky.js';
import { SETTINGS } from './settings.js';
import { batchStatic, splitByTile } from './batch.js';
import { unpackWalls, unpackRoofs, unpackTerrain, unpackPavement, unpackSurfaces } from './unpack.js';
import * as loading from './loading.js';
import { getHud } from './hud.js';
import { backToStart } from './start.js';

// The loading bar (src/loading.js): the download, then each build step below with its share.
loading.show();

async function load( name, type = 'arrayBuffer', dir = 'data/', track = false ) {

	// Already downloaded (or downloading) behind the start screen (src/start.js).
	const kept = dir === 'data/' ? await window.__preload?.[ name ] : null;
	if ( kept ) {

		delete window.__preload[ name ];
		return new Response( kept )[ type ]();

	}

	if ( ! window.PACKED_DATA && track ) {

		// One of the first files: read as it comes, for the loading bar.
		const r = await fetch( `${dir}${name}` );
		if ( ! r.body ) return r[ type ]();
		const total = Number( r.headers.get( 'content-length' ) ) || 0, reader = r.body.getReader(), chunks = [];
		let got = 0;
		for ( ;; ) {

			const { done, value } = await reader.read();
			if ( done ) break;
			chunks.push( value );
			got += value.length;
			if ( total ) loading.fileProgress( name, Math.min( 0.99, got / total ) );

		}

		loading.fileProgress( name, 1 );
		return new Response( new Blob( chunks ) )[ type ]();

	}

	if ( ! window.PACKED_DATA ) return ( await fetch( `${dir}${name}` ) )[ type ]();

	// Hosted build: gzipped, base64-encoded text files (see tools/pack-artifact.mjs).
	const text = await ( await fetch( `${dir}${name}.gz.txt` ) ).text();
	const bytes = Uint8Array.from( atob( text ), c => c.charCodeAt( 0 ) );
	const unpacked = new Response( new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'gzip' ) ) );
	return unpacked[ type ]();

}

// The city's buffers are packed (tools/pack.mjs, src/unpack.js): about a fifth of the raw floats, and less again
// over the wire once the server gzips them.
// (let: each download is let go once unpacked, below.)
let [ data, wallsBuf, wallTableBuf, roofsBuf, roofTableBuf, terrainBuf, surfacesBuf, pavementBuf, footprintBuf, embankmentBuf ] = await Promise.all( [
	load( 'scene.json', 'json', 'data/', true ),
	...[ 'walls.bin', 'walls-table.bin', 'roofs.bin', 'roofs-table.bin', 'terrain.bin', 'surfaces.bin', 'pavement.bin', 'footprints.bin', 'embankment.bin' ].map( n => load( n, 'arrayBuffer', 'data/', true ) )
] );
await loading.step( 'Skládám terén', 0.4, 0.46 );

const { bounds } = data;
const params = new URLSearchParams( location.search );
// Letím jak holub: the pigeon game on the same city (src/holub/), from its own page or with ?holub.
// ?admin is the game's settings page (src/admin.js): the pigeon game with the map and the settings beside it.
const ADMIN = params.has( 'admin' );
const HOLUB = window.GAME === 'holub' || params.has( 'holub' ) || ADMIN;
if ( HOLUB ) SUN.copy( HOLUB_SUN );
// The whole game is shown as a late-90s console picture (src/holub/ps1.js: a low internal resolution, cut colours,
// dither, grain), on foot, on the scooter, from above and as the pigeon; ?hd shows the plain full-resolution picture.
const PS1 = ! params.has( 'hd' );

// ---------------------------------------------------------------------------
// Renderer, sky, light

const renderer = new THREE.WebGPURenderer( { antialias: ! HOLUB && ! PS1, forceWebGL: params.has( 'webgl' ) } );
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
// The first area, modelled in detail (tools/area.mjs); the area since grew west over the river to Petřín.
const FB = data.firstBounds || bounds;
const firstCentre = new THREE.Vector3( ( FB.minX + FB.maxX ) / 2, 0, ( FB.minZ + FB.maxZ ) / 2 );

// The sun's shadows cover a square around where one is (aimShadows below): 400 m across on foot and as the pigeon,
// 900 m from above. Like the short draw distance, the shadows end in the haze.
const shadowCentre = firstCentre.clone();
const sun = new THREE.DirectionalLight( 0xffe6c4, 3.0 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
Object.assign( sun.shadow.camera, { left: - 450, right: 450, top: 450, bottom: - 450, near: 10, far: 1600 } );
sun.shadow.bias = - 0.0003;
sun.shadow.normalBias = 0.3;
sun.position.copy( sunDir ).multiplyScalar( 700 ).add( shadowCentre );
sun.target.position.copy( shadowCentre );
const hemi = new THREE.HemisphereLight( 0xdfe6ee, 0xc49a6c, 0.75 );
scene.add( sun, sun.target, hemi );
if ( HOLUB ) holubLook( { renderer, scene, sky, sun, hemi, camera } );

// ---------------------------------------------------------------------------
// Terrain and street surfaces

const T = data.terrain;
// The ground is drawn from a mesh of the 1 m grid (tools/rtin.mjs at build time): big triangles where the ground is
// flat, small ones where it bends, every grid point along the retaining walls. The grid's heights (for walking,
// the people, the trams) are read off the same triangles.
const terrainGeo = new THREE.BufferGeometry();
const terrainMesh = unpackTerrain( terrainBuf, data.packed[ 'terrain.bin' ], T );
const heights = terrainMesh.heights;
terrainBuf = null;
const vertexAt = new Map(); // grid point → corner
{

	const { grid } = terrainMesh, pos = new Float32Array( grid.length * 3 );
	for ( let v = 0; v < grid.length; v ++ ) {

		const g = grid[ v ], c = g % T.width, r = ( g - c ) / T.width;
		pos[ v * 3 ] = bounds.minX + c * T.cell;
		pos[ v * 3 + 1 ] = terrainMesh.y[ v ];
		pos[ v * 3 + 2 ] = bounds.minZ + r * T.cell;
		vertexAt.set( g, v );

	}

	terrainGeo.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );

}

const tp = terrainGeo.attributes.position;
// Retaining walls (tools/quay.mjs: the náplavka's wall under Smetanovo nábřeží, Čapadlo's lane): the 1 m grid would
// ramp across a wall's foot. Grid points within 1.5 m of the wall line move onto it (the high ones from behind, the
// low ones from in front), and the triangles still spanning from the top to the foot are dropped: the ground meets
// the wall face in a straight line on both sides.
{

	const mark = new Uint8Array( tp.count ), mids = new Float32Array( tp.count );
	for ( const [ x0, z0, x1, z1, nx, nz, top, low ] of data.cliffs || [] ) {

		const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz, mid = ( top + low ) / 2;
		if ( ! l2 ) continue;
		const c0 = Math.max( 0, Math.floor( ( Math.min( x0, x1 ) - 1.6 - bounds.minX ) / T.cell ) ), c1 = Math.min( T.width - 1, Math.ceil( ( Math.max( x0, x1 ) + 1.6 - bounds.minX ) / T.cell ) );
		const r0 = Math.max( 0, Math.floor( ( Math.min( z0, z1 ) - 1.6 - bounds.minZ ) / T.cell ) ), r1 = Math.min( T.height - 1, Math.ceil( ( Math.max( z0, z1 ) + 1.6 - bounds.minZ ) / T.cell ) );
		for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

			const i = vertexAt.get( r * T.width + c );
			if ( i === undefined || mark[ i ] ) continue;
			const x = bounds.minX + c * T.cell, z = bounds.minZ + r * T.cell;
			const t = ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / l2;
			if ( t < - 0.01 || t > 1.01 ) continue;
			const d = ( x - x0 ) * nx + ( z - z0 ) * nz, y = tp.getY( i );
			if ( Math.abs( d ) >= 1.5 ) continue;
			const to = y > mid ? - 0.02 : 0.02;
			tp.setXYZ( i, x - nx * ( d - to ), y, z - nz * ( d - to ) );
			mark[ i ] = 1;
			mids[ i ] = mid;

		}

	}

	const index = terrainMesh.index, kept = [];
	for ( let k = 0; k < index.length; k += 3 ) {

		const v = [ index[ k ], index[ k + 1 ], index[ k + 2 ] ], m = v.find( i => mark[ i ] );
		if ( m !== undefined ) {

			const mid = mids[ m ];
			if ( v.some( i => tp.getY( i ) > mid ) && v.some( i => tp.getY( i ) < mid ) ) continue;

		}

		kept.push( ...v );

	}

	terrainGeo.setIndex( new THREE.BufferAttribute( kept.length < index.length ? new Uint32Array( kept ) : index, 1 ) );

}

terrainGeo.computeVertexNormals();

const S = data.surface;
const surfaceTexture = buf => {

	const tex = new THREE.DataTexture( buf, S.width, S.height, THREE.RGBAFormat );
	tex.magFilter = tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;

};

const [ surfaceBytes, surface2 ] = unpackSurfaces( surfacesBuf, S.width, S.height );
surfacesBuf = null;
const surfaceTex = surfaceTexture( surfaceBytes ), surface2Tex = surfaceTexture( surface2 );
// The aerial photo's ground detail: 25 cm over the first area, 50 cm over the whole area.
const loadDetail = async name => {

	// From the start screen's download if it has it (src/start.js), else from the server.
	const kept = await window.__preload?.[ name ];
	const url = kept ? URL.createObjectURL( kept ) : `data/${name}`;
	if ( kept ) delete window.__preload[ name ];
	const tex = await new THREE.TextureLoader().loadAsync( url );
	if ( kept ) URL.revokeObjectURL( url );
	tex.flipY = false; // row 0 = north, like the surface maps
	tex.anisotropy = renderer.getMaxAnisotropy();
	return tex;

};
await loading.step( 'Pokládám dlažbu', 0.46, 0.5 );
const groundDetail = await loadDetail( 'ground-detail.jpg' );
const groundDetailWide = data.firstBounds ? await loadDetail( 'ground-detail-wide.jpg' ) : null;
const groundMaterial = createGroundMaterial( surfaceTex, surface2Tex, bounds, groundDetail, FB, groundDetailWide );
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
{

	const { positions, index } = unpackPavement( pavementBuf, data.packed[ 'pavement.bin' ] );
	pavementBuf = null;
	pavementGeo.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	pavementGeo.setIndex( new THREE.BufferAttribute( index, 1 ) );

}

pavementGeo.computeVertexNormals();
const pavementMaterial = createGroundMaterial( surfaceTex, surface2Tex, bounds, groundDetail, FB, groundDetailWide );
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
// The zones by 8 m square (each listed in every square its rectangle can reach), in their order in the list, so a
// lookup tries the few nearby ones only, first match first as before.
const ZONE_CELL = 8, zoneGrid = new Map();
zones.forEach( zn => {

	const r = Math.hypot( zn.hu, zn.hn );
	for ( let i = Math.floor( ( zn.x - r ) / ZONE_CELL ); i <= Math.floor( ( zn.x + r ) / ZONE_CELL ); i ++ ) {

		for ( let j = Math.floor( ( zn.z - r ) / ZONE_CELL ); j <= Math.floor( ( zn.z + r ) / ZONE_CELL ); j ++ ) {

			const key = i * 100000 + j;
			if ( ! zoneGrid.has( key ) ) zoneGrid.set( key, [] );
			zoneGrid.get( key ).push( zn );

		}

	}

} );
const NO_ZONES = [];
function zoneAt( x, z, y = walkerLevel() ) {

	for ( const zn of zoneGrid.get( Math.floor( x / ZONE_CELL ) * 100000 + Math.floor( z / ZONE_CELL ) ) || NO_ZONES ) {

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

// Beyond the modelled area: plain ground fading into the fog, carried on level from the area's edge (else Petřín's
// top would stand on a cliff over a plain).
{

	const pos = [], FAR = 5000, { minX, maxX, minZ, maxZ } = bounds;
	const at = ( x, z ) => [ x, terrainHeight( x, z ) - 0.05, z ];
	const out = ( p, nx, nz ) => [ p[ 0 ] + nx * FAR, p[ 1 ], p[ 2 ] + nz * FAR ];
	const quad = ( a, b, c, d ) => pos.push( ...a, ...b, ...c, ...a, ...c, ...d );
	const side = ( x0, z0, x1, z1, nx, nz ) => {

		const n = Math.round( Math.hypot( x1 - x0, z1 - z0 ) / 2 );
		for ( let i = 0; i < n; i ++ ) {

			const p = at( x0 + ( x1 - x0 ) * i / n, z0 + ( z1 - z0 ) * i / n ), q = at( x0 + ( x1 - x0 ) * ( i + 1 ) / n, z0 + ( z1 - z0 ) * ( i + 1 ) / n );
			quad( p, q, out( q, nx, nz ), out( p, nx, nz ) );

		}

	};
	side( minX, minZ, maxX, minZ, 0, - 1 );
	side( maxX, minZ, maxX, maxZ, 1, 0 );
	side( maxX, maxZ, minX, maxZ, 0, 1 );
	side( minX, maxZ, minX, minZ, - 1, 0 );
	for ( const [ x, z, sx, sz ] of [ [ minX, minZ, - 1, - 1 ], [ maxX, minZ, 1, - 1 ], [ maxX, maxZ, 1, 1 ], [ minX, maxZ, - 1, 1 ] ] ) {

		const k = at( x, z );
		quad( k, out( k, sx, 0 ), out( k, sx, sz ), out( k, 0, sz ) );

	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	geo.computeVertexNormals();
	scene.add( new THREE.Mesh( geo, new THREE.MeshStandardNodeMaterial( { color: 0x8c8378, roughness: 1, side: THREE.DoubleSide } ) ) );

}

// ---------------------------------------------------------------------------
// Buildings

await loading.step( 'Stavím domy', 0.5, 0.58 );

// Roofs: flat-shaded so every hip and gable face reads crisply.
const roofs = new THREE.Mesh( ( () => {

	const rs = data.roofStride;
	const roofIndexed = new THREE.BufferGeometry();
	const roofData = unpackRoofs( roofsBuf, roofTableBuf, data.packed[ 'roofs.bin' ], rs );
	roofsBuf = roofTableBuf = null;
	const rib = new THREE.InterleavedBuffer( roofData.roofs, rs );
	roofIndexed.setAttribute( 'position', new THREE.InterleavedBufferAttribute( rib, 3, 0 ) );
	roofIndexed.setAttribute( 'roofKind', new THREE.InterleavedBufferAttribute( rib, 1, 3 ) );
	roofIndexed.setAttribute( 'seed', new THREE.InterleavedBufferAttribute( rib, 1, 4 ) );
	roofIndexed.setAttribute( 'roofColor', new THREE.InterleavedBufferAttribute( rib, 3, 5 ) );
	roofIndexed.setIndex( new THREE.BufferAttribute( roofData.index, 1 ) );
	const roofGeo = roofIndexed.toNonIndexed();
	roofGeo.computeVertexNormals();
	return roofGeo;

} )(), createRoofMaterial() );
roofs.castShadow = roofs.receiveShadow = true;
scene.add( roofs );

// The walls (built in a function of their own, so their arrays can go once they are on the GPU).
const wallGeo = ( () => {

	const ws = data.wallStride;
	const wallData = unpackWalls( wallsBuf, wallTableBuf, data.packed[ 'walls.bin' ], ws );
	wallsBuf = wallTableBuf = null;
	const walls = wallData.walls;
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
	wallGeo.setIndex( new THREE.BufferAttribute( wallData.index, 1 ) );
	wallGeo.computeVertexNormals();
	return wallGeo;

} )();
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

await loading.sub( 0.5 );
const wallMesh = new THREE.Mesh( wallGeo, createFacadeMaterial( data.places?.cutouts || [], groundFloorTexture ) );
wallMesh.castShadow = wallMesh.receiveShadow = true;
scene.add( wallMesh );

// ---------------------------------------------------------------------------
// Street furniture and trees (OpenStreetMap, plus canopy peaks found in the surface model)

await loading.step( 'Rozmisťuji lavičky a stromy', 0.58, 0.66 );

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
embankmentBuf = null;

await loading.sub( 0.5 );
// Signature places (rotunda, pub, café, champagne bar, museum gate, stairs) and street life (people, cars).
const { seats } = addPlaces( scene, places, data.furniture, data.waterLevel );
// Local icons: big lettering, sculptures, domed corner towers (data/icons.json).
addIcons( scene, ICONS, groundHeight, data.buildings );
// The still city in few draw calls (src/batch.js): the hand-made pieces merged per material and 150 m square, the
// big meshes cut into 200 m squares that are skipped when out of view.
await loading.step( 'Slučuji město', 0.66, 0.72 );
const batched = batchStatic( scene );
const tiles = [ terrain, pavement, wallMesh, roofs ].map( mesh => splitByTile( mesh ) );
const roofTiles = tiles[ 3 ];
for ( const mesh of [ terrain, pavement, wallMesh, roofs ] ) mesh.geometry = new THREE.BufferGeometry();
// Once on the GPU, the big meshes' arrays are dropped from memory: an empty array of the same kind stays, for the
// buffer layout the renderer reads when it builds a pipeline.
{

	const heavy = new Set();
	for ( const g of tiles.map( t => t.userData.geometry ) ) {

		for ( const a of Object.values( g.attributes ) ) heavy.add( a.isInterleavedBufferAttribute ? a.data : a );
		if ( g.index ) heavy.add( g.index );

	}

	const drop = setInterval( () => {

		for ( const b of heavy ) {

			const d = renderer.backend.get( b );
			if ( ! d.buffer && ! d.bufferGPU ) continue;
			b.array = new b.array.constructor( 0 );
			heavy.delete( b );

		}

		if ( ! heavy.size ) clearInterval( drop );

	}, 2000 );

}
const stillRoots = new Set( scene.children );
// Everything still, with where it is (a sphere around it), to leave out what lies past the haze (the loop below).
const beyondFog = [];
scene.updateMatrixWorld( true );
scene.traverse( o => {

	if ( ! o.isMesh ) return;
	if ( o.isInstancedMesh && ! o.boundingSphere ) o.computeBoundingSphere();
	if ( ! o.isInstancedMesh && ! o.geometry.boundingSphere ) o.geometry.computeBoundingSphere();
	const sphere = ( o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere ).clone().applyMatrix4( o.matrixWorld );
	if ( sphere.radius < 2000 ) beyondFog.push( { o, sphere } );

} );
// Models: Quaternius' people (CC0) and the vehicles (public/models/vehicles/CREDITS.md); textures resolve next to them. The people are
// meshopt-compressed.
const gltfLoader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
const loadModel = async ( path, dir ) => gltfLoader.parseAsync( await load( path, 'arrayBuffer', '' ), dir );
// The player (src/player.js): a person of the streets, as made in the character creator, in place of the plain figure.
// Built before the crowd (addLife, at the end of this file): the crowd's material then takes over the shared atlas.
await loading.step( HOLUB ? 'Čechrám peří' : 'Oblékám postavu', 0.72, 0.76 );
const player = HOLUB ? null : await ( await import( './player.js' ) ).makePlayer( loadModel );
// The people, the trams and the boats come after the city (see the end of this file): one can walk while their
// models download. Until then they are empty stand-ins.
const life = { update() {}, agents: [], walks: [] };

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
player?.dress( walker, { ride: window.GAME === 'courier' } ); // the courier (src/start.js) starts on the scooter
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
let trams = { update() {} }, boats = { update() {} };

// The HUD (src/hud.js): the street's name as an area title, key hints, the speedometer, the pause menu.
const hud = getHud();
await loading.step( 'Kreslím mapu', 0.76, 0.8 );

// Minimap: places to find, and the landmarks.
const placeMarkers = [];
if ( places?.rotunda ) placeMarkers.push( { x: places.rotunda.x, z: places.rotunda.z, icon: 'R', colour: '#8a6d4b' } );
for ( const room of places?.interiors || [] ) placeMarkers.push( room.marker || { x: room.x, z: room.z, icon: { pub: 'H', cafe: 'S', champagne: 'C', slavia: 'K', vecerka: 'Ph' }[ room.style ], colour: { pub: '#2f6b45', cafe: '#333', champagne: '#b08a2e', slavia: '#2f5b3c', vecerka: '#9e1b1b' }[ room.style ] } );
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

// Bridges for the maps (src/minimap.js): Most Legií along its axis (the tollhouse bays wider, the carriageway between
// the pavements in road colour), and the generic OSM decks (Karlův most, the footbridges) as their strips, footways
// and pedestrian decks in pavement colour, the rest in road colour.
const mapBridges = [];
if ( places?.legie ) {

	const lg = places.legie, P = lg.pts.map( p => [ p[ 0 ], p[ 1 ] ] );
	const bay = P.slice( 0, Math.floor( lg.bay.s1 / lg.step ) + 1 );
	mapBridges.push( [
		{ pts: bay, w: lg.bay.half * 2, fill: 'pavement' },
		{ pts: P, w: lg.half * 2, fill: 'pavement' },
		{ pts: P, w: ( lg.half - lg.rail - lg.walk ) * 2, fill: 'road', inner: true }
	] );

}

for ( const b of places?.bridges || [] ) mapBridges.push( [ { pts: [ [ b.x0, b.z0 ], [ b.x1, b.z1 ] ], w: b.w, fill: /footway|path|pedestrian|cycleway/.test( b.kind ) ? 'pavement' : 'road' } ] );

const isTouch = matchMedia( '(pointer: coarse)' ).matches || navigator.maxTouchPoints > 0 && ! matchMedia( '(pointer: fine)' ).matches;
const minimap = createMinimap( {
	bounds, surface: surfaceBytes, surface2, S, waterLevel: data.waterLevel, markers: placeMarkers, touch: isTouch, bridges: mapBridges,
	terrainHeight,
	isHouse: ( x, z ) => {

		const col = Math.floor( ( x - bounds.minX ) / fp.cell ), row = Math.floor( ( z - bounds.minZ ) / fp.cell );
		if ( col < 0 || row < 0 || col >= fp.width || row >= fp.height ) return false;
		const i = row * fp.width + col;
		return ( footprintBits[ i >> 3 ] >> ( i & 7 ) ) & 1;

	}
} );

// Start on Betlémské náměstí, at the west end of the square by Oliva Nera's terrace, looking at the chapel.
function startAt() {

	const [ x, z, tx, tz ] = [ - 78, 68, - 42, 52 ];
	return `${x},${z},${Math.atan2( - ( tx - x ), - ( tz - z ) ).toFixed( 3 )}`;

}

let walking = false;
const touch = matchMedia( '(pointer: coarse)' ).matches || navigator.maxTouchPoints > 0 && ! matchMedia( '(pointer: fine)' ).matches;
// The haze: in the console picture, on foot it closes in as in the pigeon game (from 90 m, thick at 1 km; game
// settings `look.fog` makes it denser), a short draw distance as the consoles had; from above it stays far.
const FOG = { walk: [ 90, 1000 ], above: [ 350, 1600 ] };
function setMode( walk ) {

	if ( PS1 && ! HOLUB ) {

		const k = Math.max( 0.05, SETTINGS.look.fog ?? 1 ), [ near, far ] = FOG[ walk ? 'walk' : 'above' ];
		scene.fog.near = near / k;
		scene.fog.far = far / k;

	}

	const wasWalking = walking;
	walking = walk;
	orbit.enabled = ! walk;
	walker.setEnabled( walk, touch );
	minimap.setVisible( walk );
	hud.touchButtons( [ [ 'MENU', () => pauseGame() ], [ walk ? 'SHORA' : 'NA ULICI', () => setMode( ! walking ) ] ] );

	if ( walk ) {

		// Back where you left off, or at the start.
		// ?at=x,z,yaw[,y]: y picks the level where one lies over another (the walker starts at street level).
		const [ x, z, yaw, y ] = walker.placed ? [ walker.pos.x, walker.pos.z, walker.yaw ] : ( params.get( 'at' ) || startAt() ).split( ',' ).map( Number );
		if ( Number.isFinite( y ) ) walker.y = y;
		walker.teleport( x, z, yaw );
		walker.placed = true;

	} else if ( wasWalking ) {

		releasePointer();
		const t = walker.pos.clone();
		camera.position.set( t.x - 160, 180, t.z + 180 );
		orbit.target.set( t.x, 5, t.z );

	}

}

window.addEventListener( 'keydown', e => {

	if ( e.code === 'KeyM' && ! HOLUB && ! hud.paused ) setMode( ! walking );

} );
// The pigeon (?holub) instead of the walker: by default on Betlémské náměstí by the terrace, facing the chapel
// (game settings, `pigeon.start`: x, z, heading).
const holubStart = SETTINGS.pigeon.start;
const holub = HOLUB ? startHolub( { scene, camera, dom: renderer.domElement, roofGeo: roofTiles.userData.geometry, bounds, groundHeight, waterLevel: data.waterLevel, places, furniture: data.furniture, life, start: holubStart, indoors: ( x, z ) => { const zn = zoneAt( x, z ); return !! zn && zn.y !== undefined && zn.ceil === undefined; } } ) : null;
// The pigeon starts in the city, on the pavement, ready to go; the first day's story (the egg in a nest on a cornice,
// a short tutorial: src/holub/story.js) only with ?vejce. The clock moves the sun and the light.
const story = holub && params.has( 'vejce' ) ? startStory( { scene, camera, holub, start: holubStart } ) : null;
const day = holub ? startDay( { renderer, scene, sky, sun, hemi, centre: shadowCentre, hour: SETTINGS.day.startHour, minutes: SETTINGS.day.minutes, tune: SETTINGS.look } ) : null;
if ( HOLUB ) {

	orbit.enabled = false;
	minimap.setVisible( true );
	hud.touchButtons( [ [ 'MENU', () => pauseGame() ] ] );
	document.title = 'Letím jak holub';

} else setMode( ! params.has( 'overview' ) ); // start on foot; ?overview for the view from above

// ?view=x,y,z,tx,ty,tz aims the overview camera (handy for sharing a viewpoint).
if ( params.has( 'view' ) && ! walking ) {

	const [ x, y, z, tx, ty, tz ] = params.get( 'view' ).split( ',' ).map( Number );
	camera.position.set( x, y, z );
	orbit.target.set( tx, ty, tz );

}

// Nearest street name for the HUD: the street whose centre line passes nearest (the segments between the path's
// points, so a long street with few points still wins over the end of a short side street).
const streetSegs = data.streets.flatMap( st => st.paths.flatMap( path => {

	const segs = [];
	for ( let i = 3; i < path.length; i += 3 ) segs.push( [ path[ i - 3 ], path[ i - 1 ], path[ i ], path[ i + 2 ], st.name ] );
	if ( path.length === 3 ) segs.push( [ path[ 0 ], path[ 2 ], path[ 0 ], path[ 2 ], st.name ] );
	return segs;

} ) );

// Away from any street: the quarter, Malá Strana west of the first area (over the river), else Staré Město.
const quarter = x => x < FB.minX ? 'Malá Strana' : 'Staré Město';

function nearestStreet( x, z ) {

	let best = null, bd = 40 * 40;
	for ( const [ x0, z0, x1, z1, name ] of streetSegs ) {

		const dx = x1 - x0, dz = z1 - z0, t = Math.max( 0, Math.min( 1, ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );
		const d = ( x0 + t * dx - x ) ** 2 + ( z0 + t * dz - z ) ** 2;
		if ( d < bd ) {

			bd = d;
			best = name;

		}

	}

	return best;

}

// The big map (a click on the dial, or Tab): click a place to be there at once, on foot or as the pigeon.
function openBigMap() {

	if ( minimap.isOpen || hud.paused || ! ( holub || walking ) ) return;
	releasePointer();
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
			hud.replace();

		}
	} );

}

minimap.view.addEventListener( 'click', openBigMap );
addEventListener( 'keydown', e => {

	if ( e.code !== 'Tab' || minimap.isOpen || hud.paused || e.target.closest?.( 'input, textarea, select' ) ) return;
	e.preventDefault();
	openBigMap();

} );

// The credits (data.attribution among them) are in the pause menu and on the start screen (src/ui.js CREDITS).

// ---------------------------------------------------------------------------
// Pause: Esc (or MENU on a touch screen, or the tab going to the background) opens the menu; the city stands still
// under it, the last picture dimmed behind. The pointer is let go, and caught again on "Pokračovat".

let paused = false, resumed = false, ownRelease = false;
function releasePointer() {

	if ( ! document.pointerLockElement ) return;
	ownRelease = true;
	document.exitPointerLock();

}

const fine = matchMedia( '(pointer: fine)' ).matches;
hud.menu = () => [
	...( HOLUB ? [] : [ walking ? { id: 'above', label: 'Pohled shora', run: () => setMode( false ) } : { id: 'street', label: 'Na ulici', run: () => setMode( true ) } ] ),
	...( window.GAME === 'courier' ? [ { id: 'creator', label: 'Upravit postavu', run: () => backToStart( { creator: true } ) } ] : [] ),
	{ id: 'menu', label: 'Hlavní menu', run: () => backToStart() }
];
async function pauseGame() {

	if ( ADMIN || hud.paused || minimap.isOpen || ! window.__ready ) return;
	paused = true;
	walker.keys.clear();
	releasePointer();
	await hud.pause();
	paused = false;
	resumed = true;
	walker.keys.clear();
	if ( fine && ( walking || holub ) ) {

		try {

			renderer.domElement.requestPointerLock()?.catch?.( () => {} );

		} catch { /* a click on the picture catches it */ }

	}

}

addEventListener( 'keydown', e => {

	if ( e.code !== 'Escape' || e.defaultPrevented ) return;
	e.preventDefault();
	pauseGame();

} );
// Esc while the pointer is caught: the browser lets it go and the page may never see the key.
document.addEventListener( 'pointerlockchange', () => {

	if ( document.pointerLockElement ) return;
	if ( ownRelease ) ownRelease = false;
	else pauseGame();

} );
document.addEventListener( 'visibilitychange', () => document.hidden && pauseGame() );

// ---------------------------------------------------------------------------

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const timer = new THREE.Timer();
let labelTimer = 0, hudMode = null;

// The pigeon game is shown as a late-90s console picture (src/holub/ps1.js); ?hd turns that off.
const ps1 = PS1 ? ps1Look( { renderer, scene, camera } ) : null;
if ( ps1 ) {

	renderer.setPixelRatio( 1 );
	renderer.domElement.style.imageRendering = 'pixelated';
	// On foot the light is the walk's own late afternoon, tuned by the same art-direction knobs as the pigeon's day
	// (game settings, `look`: exposure, sun strength; the fog's density in setMode above).
	if ( ! HOLUB ) {

		const look = SETTINGS.look;
		renderer.toneMappingExposure *= look.exposure ?? 1;
		sun.intensity *= look.sun ?? 1;
		if ( /^#[0-9a-f]{6}$/i.test( look.fogColour || '' ) ) scene.fog.color.set( look.fogColour );

	}

}

// The admin page: the settings and the map from above beside the running game.
if ( ADMIN ) ( await import( './admin.js' ) ).startAdmin( { bounds, map: minimap.map, life, ps1, day, holub } );

// Battery: at most 60 frames a second (30 in the pigeon game), however fast the screen refreshes. ?fps=N sets the cap.
let FPS = Number( params.get( 'fps' ) ) || ( HOLUB ? 30 : 60 );
// The shadowed square (see the sun above) follows one around in 50 m steps.
function aimShadows( x, z, close ) {

	const half = close ? 200 : 450, cam = sun.shadow.camera;
	if ( cam.right !== half ) {

		Object.assign( cam, { left: - half, right: half, top: half, bottom: - half } );
		cam.updateProjectionMatrix();
		sun.shadow.needsUpdate = true;

	}

	const cx = Math.round( x / 50 ) * 50, cz = Math.round( z / 50 ) * 50;
	if ( cx === shadowCentre.x && cz === shadowCentre.z ) return;
	const dir = sun.position.clone().sub( shadowCentre );
	shadowCentre.set( cx, 0, cz );
	sun.target.position.copy( shadowCentre );
	sun.position.copy( shadowCentre ).add( dir );
	sun.shadow.needsUpdate = true;

}

// The sun's shadows fall from the houses, roofs, trees and the rest of the still city only: the shadow map is drawn
// when the shadowed square moves or the sun has moved (the pigeon's day), not every frame. Whatever moves (people,
// trams, boats, the walker, the pigeon) casts none.
sun.shadow.autoUpdate = false;
sun.shadow.needsUpdate = true;
const shadowSun = sun.position.clone().sub( sun.target.position ).normalize(), sunNow = new THREE.Vector3();
let shadowAge = 0;
function stillShadows( dt ) {

	shadowAge += dt;
	sunNow.copy( sun.position ).sub( sun.target.position ).normalize();
	if ( shadowAge > 1 && sunNow.angleTo( shadowSun ) > 0.008 ) {

		shadowSun.copy( sunNow );
		sun.shadow.needsUpdate = true;

	}

	if ( ! sun.shadow.needsUpdate ) return;
	shadowAge = 0;
	// What was added after the still city (src/batch.js below) moves, or may: it casts no shadow.
	for ( const o of scene.children ) if ( ! stillRoots.has( o ) ) o.traverse( m => m.castShadow = false );

}

let lastFrame = 0, frameNo = 0;
renderer.setAnimationLoop( () => {

	const now = performance.now();
	if ( now - lastFrame < 1000 / FPS - 2 ) return;
	lastFrame = now;
	window.__frameLog?.push( now );
	frameNo ++;
	timer.update();
	// Paused: nothing moves and the last picture stays; back from the pause, no jump for the time it was away.
	if ( paused ) return;
	const dt = resumed ? 0 : Math.min( timer.getDelta(), 0.1 );
	resumed = false;
	life.update( dt );
	trams.update( dt );
	boats.update( dt );

	if ( holub ) {

		holub.update( dt );
		story?.update( dt );
		day.update( dt );
		minimap.update( holub.pos.x, holub.pos.z, holub.yaw, holub.heading );

	} else if ( walking ) {

		walker.update( dt );
		minimap.update( walker.pos.x, walker.pos.z, walker.yaw, walker.heading );
		hud.speed( walker.riding ? Math.abs( walker.speed ) * 3.6 : null );

	} else {

		orbit.update();

	}

	// The HUD: the street's name when it changes, the mode's keys when the mode does.
	labelTimer -= dt;
	if ( labelTimer <= 0 && window.__ready ) {

		labelTimer = 0.3;
		const mode = holub ? 'pigeon' : ! walking ? 'above' : walker.riding ? 'ride' : 'walk';
		if ( mode !== hudMode ) {

			hud.mode( mode );
			hud.hints( mode, hudMode ? 6 : 12 );
			hudMode = mode;

		}

		const me = holub ? holub.pos : walking ? walker.pos : null;
		if ( me ) hud.place( nearestStreet( me.x, me.z ), quarter( me.x ) );

	}

	const focus = holub ? holub.pos : walking ? walker.pos : orbit.target;
	aimShadows( focus.x, focus.z, !! holub || walking );
	stillShadows( dt );
	// None of the city's squares is drawn past the fog's far end, where it is all fog anyway (the plain ground
	// beyond the area still is, so the horizon stays where it was).
	for ( const { o, sphere } of beyondFog ) o.visible = camera.position.distanceTo( sphere.center ) - sphere.radius < scene.fog.far;

	if ( ps1 ) ps1.render(); else renderer.render( scene, camera );
	// Measuring (tools/perf/): draw calls, triangles and the frame's own time on the main thread.
	if ( window.__frameLog ) {

		window.__frameInfo = [ renderer.info.render.drawCalls, renderer.info.render.triangles ];
		window.__frameCost?.push( performance.now() - now );

	}

} );

// Easter eggs (src/eastereggs.js): the black SUV across the garage gate on Náprstkova.
( await import( './eastereggs.js' ) ).addEasterEggs( scene, groundHeight );

// Every material's GPU pipeline prepared before play, all round the city, so a sign, an awning or a tram that first
// comes into view doesn't stall a frame while its shader is built (the hitch when turning the camera).
{

	await loading.step( 'Připravuji obraz', 0.8, 1 );
	const hidden = [];
	scene.traverse( o => {

		if ( ! o.visible ) return;
		if ( o.frustumCulled ) {

			o.frustumCulled = false;
			hidden.push( o );

		}

	} );
	try {

		await renderer.compileAsync( scene, camera, null, e => loading.stepProgress( e.loaded / e.total ) );

	} catch ( e ) {

		console.warn( 'compileAsync', e );

	}

	for ( const o of hidden ) o.frustumCulled = true;
	loading.done();

}

window.__debug = { setFps: f => FPS = f, renderer, scene, batched, camera, isBlocked, groundHeight, walker, life, trams, boats, holub, waterLevel: data.waterLevel };
window.__THREE = THREE;
window.__ready = true;
// The courier's first message, on the pager.
if ( window.GAME === 'courier' ) setTimeout( () => hud.pager( 'Dneska žádné objednávky.', 'Projeď se po městě.' ), 1500 );
window.__complete = false;

// Street life: the people (cars hidden for now, ?cars shows them), the trams and the boats, loaded once the city is up.
load( 'life.json', 'json' ).then( streetLife => Promise.all( [
	addLife( scene, streetLife, { seats, benches: data.furniture.bench, groundHeight, loadModel, camera, cars: params.has( 'cars' ) } ).then( l => Object.assign( life, l ) ),
	addTrams( scene, streetLife?.trams, groundHeight, ( x, z ) => cameraBlocked( x, z ) || onLegie( places?.legie, x, z ) ).then( t => trams = window.__debug.trams = t ),
	addBoats( scene, { loadModel, groundHeight, waterLevel: data.waterLevel } ).then( b => boats = window.__debug.boats = b )
] ) ).then( () => renderer.compileAsync( scene, camera ).catch( () => {} ) ).then( () => window.__complete = true ); // the people's, trams' and boats' pipelines too
