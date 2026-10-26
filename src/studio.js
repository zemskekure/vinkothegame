// The art direction studio (?studio): the pigeon game's late-90s look tuned on a calm, still line-up instead of the
// running city. A patch of wet cobblestones before a short house front (three bays drawn by the real facade shader,
// with a drawn shopfront), a sky panorama behind, a fixed sun. On low turntables: six people (different bodies,
// faces and clothes, one sitting on a bench), the pigeon, a herring gull and a mallard, a street lamp, a bin and a
// café table with a rohlík, a trdelník and a beer. Nothing walks; the camera orbits (drag) and zooms (wheel), a
// click on a thing brings it close, and the turntables can turn slowly.
//
// The panel beside it (styled like the admin page, src/admin.js) edits the same game settings: the picture (`look`,
// src/holub/ps1.js) and the art direction (`art`): the people's heads (gem facets, size), flat or smooth shading,
// colour levels of their bodies, which textures may dress people in the streets, the pigeon's feathers and size,
// photos on the food, and this studio's own light and line-up. Uložit saves it all the way the admin page does.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SETTINGS, DEFAULTS, LOCAL, SERVER, merge, writeLocal } from './settings.js';
import { STYLE, LOOK, saveSettings, downloadSettings, get, set } from './admin.js';
import { ps1Look } from './holub/ps1.js';
import { BODIES, SHAPE, loadWardrobe, useWardrobe, prepareBody, applyArt, lookAttribute, shapeWeights } from './people.js';
import { rulesFrom, gameSeed, personSeed, generatePerson, lookOf, buildPerson as build } from './persona.js';
import { makePigeon, birdSize } from './holub/pigeon.js';
import { FOOD, foodMaterial } from './holub/game.js';
import { MODELS } from './furniture.js';
import { createFacadeMaterial } from './shading/facade.js';

const params = new URLSearchParams( location.search );
const SKIES = [ 'golden_evening', 'blue_noon', 'grey_overcast_drizzle', 'pink_sunrise_haze', 'heavy_storm', 'night_full_moon' ];
const SKY_NAMES = { golden_evening: 'Zlatý večer', blue_noon: 'Modré poledne', grey_overcast_drizzle: 'Zataženo', pink_sunrise_haze: 'Růžové ráno', heavy_storm: 'Bouřka', night_full_moon: 'Noc s úplňkem' };

// The six people of the line-up are specs (src/persona.js): made by the generator from the crowd rules like the
// people in the streets (the last one sitting on a bench), or as saved (art.lineup) after dressing them by hand.
const SIZE = 6, SEATED = 5;

// --- page and renderer -----------------------------------------------------------------------------------------

document.title = 'Ateliér · Letím jak holub';
for ( const id of [ 'hud', 'place', 'credit' ] ) document.getElementById( id )?.style.setProperty( 'display', 'none' );
const loading = document.getElementById( 'loading' );
if ( loading ) loading.textContent = 'Připravuji ateliér…';

let settings = structuredClone( SETTINGS );
delete settings.version;
const art = () => settings.art;
art().studio ??= {};
const PANEL_W = 400;

// Frames are drawn only while something changes (see the loop at the end).
let awakeUntil = Infinity, frames = 0;
const invalidate = () => awakeUntil = Math.max( awakeUntil === Infinity ? 0 : awakeUntil, performance.now() + 1200 );
THREE.DefaultLoadingManager.onProgress = () => invalidate();

const renderer = new THREE.WebGPURenderer( { antialias: false, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( 1 );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
Object.assign( renderer.domElement.style, { position: 'fixed', top: '0', imageRendering: 'pixelated' } );
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 42, 1, 0.05, 400 );
const HOME = { position: new THREE.Vector3( 0, 2.1, 14 ), target: new THREE.Vector3( 0, 1.15, 0 ) };
camera.position.copy( HOME.position );

const controls = new OrbitControls( camera, renderer.domElement );
controls.target.copy( HOME.target );
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.495;
controls.addEventListener( 'change', () => invalidate() );

// --- light, fog, sky --------------------------------------------------------------------------------------------

const sun = new THREE.DirectionalLight( 0xffe2bd, 3.2 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
Object.assign( sun.shadow.camera, { left: - 12, right: 12, top: 12, bottom: - 12, near: 1, far: 80 } );
sun.shadow.bias = - 0.0004;
sun.shadow.normalBias = 0.02;
const hemi = new THREE.HemisphereLight( 0xf3e2cc, 0x5b4636, 0.7 );
scene.add( sun, sun.target, hemi );
scene.fog = new THREE.Fog( 0xd9b48f, 30, 140 );

const loader = new THREE.TextureLoader();
const crisp = ( url, repeat ) => {

	const t = loader.load( url );
	t.colorSpace = THREE.SRGBColorSpace;
	t.magFilter = t.minFilter = THREE.NearestFilter;
	t.generateMipmaps = false;
	if ( repeat ) {

		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.repeat.set( ...repeat );

	}

	return t;

};

// The sky: a panorama inside a tall open cylinder round the set (the images are wider than 2 : 1, so not a sphere).
const skyMaterial = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide, fog: false } );
const skyDome = new THREE.Mesh( new THREE.CylinderGeometry( 90, 90, 70, 48, 1, true ).translate( 0, 22, 0 ), skyMaterial );
scene.add( skyDome );
const skyTextures = {}, skyMeans = {};
const skyTexture = name => skyTextures[ name ] ||= loader.load( `models/sky/${name}.jpg`, t => {

	// Its mean colour for the fog, so the far floor melts into it.
	const c = document.createElement( 'canvas' );
	c.width = c.height = 1;
	const x = c.getContext( '2d' );
	x.drawImage( t.image, 0, t.image.height * 0.55, t.image.width, t.image.height * 0.2, 0, 0, 1, 1 );
	const [ r, g, b ] = x.getImageData( 0, 0, 1, 1 ).data;
	skyMeans[ name ] = new THREE.Color().setRGB( r / 255, g / 255, b / 255, THREE.SRGBColorSpace );
	applyLight();

}, undefined, () => {} );

// --- the set: a cobblestone patch and a house front --------------------------------------------------------------

const floor = new THREE.Mesh( new THREE.CircleGeometry( 16, 24 ).rotateX( - Math.PI / 2 ), new THREE.MeshStandardNodeMaterial( { map: crisp( 'models/props/cobblestones.jpg', [ 14, 14 ] ), roughness: 0.75 } ) );
floor.receiveShadow = true;
scene.add( floor );

// Three bays of an Old Town front (src/shading/facade.js), its attributes set as tools/build-scene.mjs would for a
// street wall 9.4 m wide: a ground floor 3.8 m high and three upper floors under the cornice; the plaster in the
// drawn shopfront's pink.
function houseFront( width = 9.4, floors = 4, fH = 3.8, z = - 3.2 ) {

	const top = floors * fH + 0.9;
	const g = new THREE.PlaneGeometry( width, top ).translate( 0, top / 2, z );
	const n = g.attributes.position.count, P = g.attributes.position;
	const plaster = new THREE.Color( 0xd8ac97 );
	const A = [], B = [], C = [], T = [], H = [], L = [];
	for ( let i = 0; i < n; i ++ ) {

		A.push( P.getX( i ) + width / 2, width, 0, top );
		B.push( fH, 0.37, 0, - 1 );
		C.push( 0, 0, 1, 0 );
		T.push( - 1, 0, 0 );
		H.push( 0, 0, - 1, 0 );
		L.push( plaster.r, plaster.g, plaster.b );

	}

	for ( const [ name, a, k ] of [ [ 'wallA', A, 4 ], [ 'wallB', B, 4 ], [ 'wallC', C, 4 ], [ 'trimColour', T, 3 ], [ 'house', H, 4 ], [ 'plaster', L, 3 ] ] ) g.setAttribute( name, new THREE.Float32BufferAttribute( a, k ) );
	const wall = new THREE.Mesh( g, createFacadeMaterial() );
	wall.receiveShadow = true;
	wall.castShadow = true;
	const group = new THREE.Group();
	group.add( wall );
	// The house behind its front, and a roof of red tiles.
	const body = new THREE.Mesh( new THREE.BoxGeometry( width, top, 6 ).translate( 0, top / 2, z - 3.01 ), new THREE.MeshStandardNodeMaterial( { color: plaster, roughness: 0.9 } ) );
	const roof = new THREE.Mesh( new THREE.CylinderGeometry( 3.6, 3.6, width + 0.3, 3, 1 ).rotateZ( Math.PI / 2 ).scale( 1, 0.75, 1 ).translate( 0, top + 1.3, z - 3 ), new THREE.MeshStandardNodeMaterial( { color: 0xa4513a, roughness: 0.85, flatShading: true } ) );
	body.castShadow = roof.castShadow = true;
	group.add( body, roof );
	return group;

}

scene.add( houseFront() );

// The drawn shopfront of the Hemingway Bar (Karoliny Světlé 26; data/fronts, drawn from the owner's photo), as
// src/fronts.js shows it in the city: a picture just ahead of the ground floor.
{

	const urls = import.meta.glob( '../data/fronts-rendered/21644039_7.png', { query: '?url', import: 'default', eager: true } );
	const url = Object.values( urls )[ 0 ];
	if ( url ) {

		const map = loader.load( url );
		map.colorSpace = THREE.SRGBColorSpace;
		const front = new THREE.Mesh( new THREE.PlaneGeometry( 8.19, 3.79 ), new THREE.MeshStandardNodeMaterial( { map, transparent: true, alphaTest: 0.08, roughness: 0.8 } ) );
		front.position.set( 0, 3.79 / 2, - 3.2 + 0.075 );
		front.receiveShadow = true;
		scene.add( front );

	}

}

// --- the line-up --------------------------------------------------------------------------------------------------

// Every exhibit stands on a turntable (a low stone disc) and can be focused; `spin` turns with the turntable.
const items = [];
const stone = new THREE.MeshStandardNodeMaterial( { color: 0x8d877c, roughness: 0.9, flatShading: true } );
function exhibit( name, x, z, radius, build ) {

	const base = new THREE.Group();
	base.position.set( x, 0, z );
	const disc = new THREE.Mesh( new THREE.CylinderGeometry( radius, radius * 1.04, 0.06, 12 ).translate( 0, 0.03, 0 ), stone );
	disc.receiveShadow = true;
	const spin = new THREE.Group();
	spin.position.y = 0.06;
	base.add( disc, spin );
	scene.add( base );
	const item = { name, base, spin, radius, build };
	base.traverse( o => o.userData.item = item );
	items.push( item );
	return item;

}

function setContent( item, object ) {

	if ( item.content ) item.spin.remove( item.content );
	item.content = object;
	object.traverse( o => {

		o.userData.item = item;
		if ( o.isMesh ) o.castShadow = true;

	} );
	item.spin.add( object );
	invalidate();

}

// Things: the city's own furniture models (src/furniture.js), the pigeon game's food (src/holub/game.js).
const model = parts => {

	const g = new THREE.Group();
	for ( const [ geometry, material ] of parts ) g.add( new THREE.Mesh( geometry, material ) );
	return g;

};

function cafeTable() {

	const g = new THREE.Group();
	const metal = new THREE.MeshStandardNodeMaterial( { color: 0x2b2d2c, roughness: 0.5, metalness: 0.5, flatShading: true } );
	g.add( new THREE.Mesh( new THREE.CylinderGeometry( 0.32, 0.32, 0.025, 10 ).translate( 0, 0.74, 0 ), metal ), new THREE.Mesh( new THREE.CylinderGeometry( 0.025, 0.03, 0.73, 6 ).translate( 0, 0.365, 0 ), metal ), new THREE.Mesh( new THREE.CylinderGeometry( 0.2, 0.22, 0.02, 10 ), metal ) );
	const photo = art().photoFood;
	const onTop = ( mesh, x, z, ry = 0 ) => {

		mesh.position.set( x, 0.755 + 0.03, z );
		mesh.rotation.y = ry;
		g.add( mesh );

	};

	const [ , rohlik, rc, rp ] = FOOD[ 0 ], [ , trdlo, tc, tp ] = FOOD[ 3 ], [ , preclik, pc ] = FOOD[ 2 ];
	onTop( new THREE.Mesh( rohlik(), foodMaterial( rc, rp, photo ) ), - 0.13, 0.06, 0.4 );
	onTop( new THREE.Mesh( trdlo(), foodMaterial( tc, tp, photo ) ), 0.12, 0.1, - 0.3 );
	onTop( new THREE.Mesh( preclik(), foodMaterial( pc, null, photo ) ), - 0.05, - 0.16 );
	// A half-litre of lager in a straight tumbler: the photo of the glass stretched round a five-sided cylinder.
	const beer = new THREE.Mesh( new THREE.CylinderGeometry( 0.042, 0.036, 0.16, 6 ).translate( 0, 0.08 - 0.03, 0 ), photo
		? new THREE.MeshStandardNodeMaterial( { map: crisp( 'models/props/beer.jpg' ), roughness: 0.3, flatShading: true } )
		: new THREE.MeshStandardNodeMaterial( { color: 0xd99a2a, roughness: 0.3, flatShading: true, emissive: 0x6b4208, emissiveIntensity: 0.3 } ) );
	onTop( beer, 0.15, - 0.12 );
	return g;

}

function bird( kind ) {

	const b = makePigeon( { kind, texture: art().pigeon?.texture } );
	b.userData.animate( 1, { mode: 'walk', speed: 0 } ); // settle into the standing pose
	b.scale.setScalar( 1.15 * birdSize( kind ) * ( kind === 'pigeon' ? art().pigeon?.size ?? 1 : 1 ) );
	return b;

}

// --- people -------------------------------------------------------------------------------------------------------

const wardrobe = await loadWardrobe();
useWardrobe( wardrobe );
applyArt( art() );
const gltfLoader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
const buffers = new Map();
const bodyCache = new Map();
async function body( file ) {

	if ( ! bodyCache.has( file ) ) {

		if ( ! buffers.has( file ) ) buffers.set( file, await ( await fetch( `models/people/${file}.glb` ) ).arrayBuffer() );
		const spec = BODIES.find( b => b.file === file );
		bodyCache.set( file, prepareBody( await gltfLoader.parseAsync( buffers.get( file ).slice( 0 ), 'models/people/' ), spec ) );

	}

	return bodyCache.get( file );

}

// A new line-up from the rules: the seeds dealt as in a game (a fixed seed in the rules gives the same people).
let base = gameSeed( rulesFrom( art() ) );
const generated = ( i, seed = personSeed( base, i ) ) => ( { ...generatePerson( rulesFrom( art() ), seed, wardrobe, { sitting: i === SEATED } ), seated: i === SEATED } );
const saved = art().lineup || [];
const lineup = Array.from( { length: SIZE }, ( _, i ) => saved[ i ]?.shape ? { ...generated( i ), ...saved[ i ], seated: i === SEATED } : generated( i ) );

// A person standing (the clip's idle pose, held still) or sitting on a bench.
async function person( p ) {

	const b = await body( p.body );
	const s = build( p, b, wardrobe );
	const clip = p.seated && b.clips.Sitting ? b.clips.Sitting : b.clips.Idle || b.clips.Walk;
	s.mixer.clipAction( clip ).play();
	s.mixer.setTime( clip.duration * ( p.seated ? 0.5 : 0.2 ) );
	s.object.updateMatrixWorld( true );
	if ( ! p.seated ) return { object: s.object, skinned: s };
	// On a park bench (seat 0.46 m), hips a little in front of the backrest.
	const g = new THREE.Group();
	const bench = model( MODELS.bench );
	bench.rotation.y = Math.PI;
	g.add( bench );
	const sc = s.scale, w = shapeWeights( p.shape );
	const drop = b.sitting.drop.reduce( ( a, d, k ) => a + d * w[ k ], 0 );
	s.object.position.set( 0, 0.46 - ( b.sitting.bottom + drop ) * sc + 0.01, 0.05 - b.sitting.hipsZ * sc );
	g.add( s.object );
	return { object: g, skinned: s };

}

const people = [];
async function buildPerson( i ) {

	const built = await person( lineup[ i ] );
	people[ i ].skinned = built.skinned;
	setContent( people[ i ].item, built.object );

}

// Places along the line-up (x), front to back a little staggered.
const X = [ - 7.2, - 5.9, - 4.6, - 3.3, - 2.0, - 0.1 ];
lineup.forEach( ( p, i ) => {

	people[ i ] = { item: exhibit( `Postava ${i + 1}`, X[ i ], i % 2 ? 0.25 : - 0.15, p.seated ? 1.1 : 0.5 ) };
	people[ i ].item.person = i;

} );
await Promise.all( lineup.map( ( p, i ) => buildPerson( i ) ) );

const things = {
	lamp: exhibit( 'Lampa', 1.9, - 0.6, 0.35 ),
	bin: exhibit( 'Koš', 2.9, 0.1, 0.35 ),
	table: exhibit( 'Stolek s jídlem', 4.1, 0.2, 0.45 ),
	pigeon: exhibit( 'Holub', 5.3, 0.6, 0.3 ),
	seagull: exhibit( 'Racek', 6.2, 0.3, 0.38 ),
	duck: exhibit( 'Kachna', 7.2, 0.6, 0.38 )
};
setContent( things.lamp, model( MODELS.lamp ) );
setContent( things.bin, model( MODELS.bin ) );
const buildTable = () => setContent( things.table, cafeTable() );
const buildBirds = () => {

	for ( const k of [ 'pigeon', 'seagull', 'duck' ] ) {

		setContent( things[ k ], bird( k ) );
		things[ k ].content.rotation.y = - 0.5;

	}

};

buildTable();
buildBirds();
for ( const [ i, p ] of people.entries() ) p.item.spin.rotation.y = ( i - 2.5 ) * - 0.08;

// --- the picture ---------------------------------------------------------------------------------------------------

const ps1 = ps1Look( { renderer, scene, camera } );
let viewW = 0;
function resize() {

	const folded = panel.classList.contains( 'folded' ) || window.innerWidth < 800;
	const left = folded ? 0 : Math.min( PANEL_W, window.innerWidth );
	viewW = window.innerWidth - left;
	renderer.domElement.style.left = `${left}px`;
	renderer.setSize( viewW, window.innerHeight );
	invalidate();
	camera.aspect = viewW / window.innerHeight;
	camera.updateProjectionMatrix();

}

function applyLook() {

	ps1.set( settings.look );
	applyLight();

}

function applyLight() {

	invalidate();
	const S = art().studio, L = settings.look;
	const dir = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 90 - ( S.sunElevation ?? 40 ) ), THREE.MathUtils.degToRad( S.sunAzimuth ?? 35 ) );
	sun.position.copy( dir ).multiplyScalar( 30 );
	sun.intensity = 3.2 * ( L.sun ?? 1 );
	hemi.intensity = S.ambient ?? 0.7;
	renderer.toneMappingExposure = 0.92 * ( L.exposure ?? 1 );
	const bg = S.background || 'golden_evening';
	const isSky = SKIES.includes( bg );
	skyDome.visible = isSky;
	if ( isSky ) {

		skyMaterial.map = skyTexture( bg );
		skyMaterial.needsUpdate = true;
		scene.background = null;

	} else scene.background = new THREE.Color( /^#[0-9a-f]{6}$/i.test( bg ) ? bg : '#8f8a80' );

	const fog = /^#[0-9a-f]{6}$/i.test( L.fogColour || '' ) ? new THREE.Color( L.fogColour ) : isSky ? skyMeans[ bg ] || new THREE.Color( 0xd9b48f ) : scene.background;
	scene.fog.color.copy( fog );
	const k = Math.max( 0.05, L.fog ?? 1 );
	scene.fog.near = 30 / k;
	scene.fog.far = 140 / k;

}

// --- focusing, turning ---------------------------------------------------------------------------------------------

let fly = null;
function focus( item ) {

	const box = new THREE.Box3().setFromObject( item ? item.base : scene.getObjectByName( 'lineup' ) || items[ 0 ].base );
	let target, position;
	if ( item ) {

		const c = box.getCenter( new THREE.Vector3() ), size = box.getSize( new THREE.Vector3() );
		let d = Math.max( 0.5, Math.max( size.y, size.x * 0.8 ) * 1.6 + 0.2 );
		// The café table: its top, where the food is.
		if ( item === things?.table ) {

			c.y = 0.8;
			size.y = 0.4;
			d = 0.8;

		}

		const dir = camera.position.clone().sub( controls.target ).setY( 0 ).normalize();
		if ( dir.lengthSq() < 0.5 ) dir.set( 0, 0, 1 );
		target = c;
		position = c.clone().addScaledVector( dir, d ).add( new THREE.Vector3( 0, size.y * 0.15, 0 ) );

	} else {

		target = HOME.target.clone();
		position = HOME.position.clone();

	}

	invalidate();
	fly = { t: 0, from: [ camera.position.clone(), controls.target.clone() ], to: [ position, target ] };

}

const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener( 'pointerdown', e => down = [ e.clientX, e.clientY ] );
renderer.domElement.addEventListener( 'pointerup', e => {

	if ( ! down || Math.hypot( e.clientX - down[ 0 ], e.clientY - down[ 1 ] ) > 4 ) return;
	const r = renderer.domElement.getBoundingClientRect();
	pointer.set( ( e.clientX - r.left ) / r.width * 2 - 1, - ( e.clientY - r.top ) / r.height * 2 + 1 );
	ray.setFromCamera( pointer, camera );
	const hit = ray.intersectObjects( items.map( i => i.base ), true )[ 0 ];
	const item = hit?.object.userData.item;
	if ( item ) {

		focus( item );
		if ( item.person !== undefined ) selectPerson( item.person );

	}

} );
renderer.domElement.addEventListener( 'dblclick', () => focus( null ) );

// --- the panel -----------------------------------------------------------------------------------------------------

const EXTRA = `
#admin .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 4px; margin: 4px 0 8px; }
#admin .thumbs button { padding: 0; border: 2px solid transparent; border-radius: 3px; background: #ddd9cf; aspect-ratio: 1; overflow: hidden; position: relative; }
#admin .thumbs button img { display: block; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
#admin .thumbs button.on { border-color: #1d1d1b; }
#admin .thumbs button.out { opacity: 0.35; }
#admin .thumbs button.none { font-size: 11px; color: #6b6860; }
#admin .thumbs button .sw { position: absolute; inset: 0; }
#admin .cat { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 10px; }
#admin .cat b { font-weight: 600; }
#admin .cat button { padding: 2px 6px; font-size: 12px; }
#admin .people { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin: 6px 0; }
#admin .people button.on { background: #1d1d1b; border-color: #1d1d1b; color: #fff; }
#admin select { width: 100%; padding: 3px 5px; border: 1px solid #bdb9b0; border-radius: 3px; font: inherit; background: #fff; }
#admin label.check { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
#admin ul.items { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
#admin ul.items button { padding: 3px 7px; font-size: 12px; }
#admin .swatch { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
`;

const style = document.createElement( 'style' );
style.textContent = STYLE + EXTRA;
document.head.appendChild( style );

const panel = document.createElement( 'div' );
panel.id = 'admin';
panel.innerHTML = `
	<header>
		<div class="top"><h1>Ateliér – art direction</h1><button data-fold>Skrýt</button></div>
		<div class="status" data-status></div>
		<nav><button data-show="look" class="on">Obraz a světlo</button><button data-show="people">Lidé</button><button data-show="things">Holub a věci</button></nav>
	</header>
	<section data-tab="look"><h2>Obraz</h2><div data-look></div>
		<label class="row" title="prázdné = barva podle pozadí"><span>Barva mlhy</span><input type="color" data-fogcolour><label><input type="checkbox" data-fogown> vlastní</label></label>
	</section>
	<section data-tab="look"><h2>Světlo v ateliéru</h2><div data-light></div>
		<label class="row"><span>Pozadí</span><select data-bg style="grid-column: span 2"></select></label>
		<label class="row"><span>Barva pozadí</span><input type="color" data-bgcolour style="grid-column: span 2"></label>
		<p class="hint">Slunce, expozice a mlha platí i ve hře; směr slunce, okolní světlo a pozadí jen tady (ve hře je určuje denní doba).</p>
	</section>
	<section data-tab="people" hidden>
		<h2>Generátor lidí</h2>
		<div class="buttons"><button class="primary" data-shuffle>🎲 Zamíchat</button></div>
		<div data-crowd></div>
		<label class="row" title="0 = při každém spuštění hry noví lidé; jiné číslo = pokaždé titíž (na zkoušení)"><span>Pevné semínko</span><input type="number" min="0" step="1" data-seed style="grid-column: span 2"></label>
		<p class="hint">Podle těchto pravidel se při každém spuštění hry vyrobí noví lidé do ulic. Zamíchat ukáže jinou šestici; posuvníky přepočítají tutéž šestici.</p>
		<h2>Hlavy a tělo (všichni lidé)</h2><div data-heads></div>
		<label class="check"><input type="checkbox" data-flat> Ploché stínování (fasety)</label>
		<h2>Postava</h2>
		<div class="people" data-people></div>
		<label class="row"><span>Tělo</span><select data-body style="grid-column: span 2"></select></label>
		<div data-wardrobe></div>
		<p class="hint">Klik na náhled obleče vybranou postavu. „Vyřadit z ulic“ zakáže vybranou texturu pro náhodné lidi ve hře (zašedlé náhledy).</p>
		<h2>Tvar postavy</h2>
		<div data-shape></div>
	</section>
	<section data-tab="things" hidden>
		<h2>Holub</h2>
		<label class="row"><span>Peří</span><select data-feathers style="grid-column: span 2"><option value="plain">barvy (bez textury)</option><option value="feathers">fotky peří</option></select></label>
		<div class="thumbs" data-feather-thumbs></div>
		<div data-pigeon></div>
		<h2>Věci</h2>
		<label class="check"><input type="checkbox" data-photofood> Fotky na jídle (rohlík, trdelník, pivo)</label>
		<h2>Ukázat zblízka</h2>
		<ul class="items" data-items></ul>
		<label class="check"><input type="checkbox" data-turn> Točit podstavci (pomalu)</label>
	</section>
	<footer>
		<div class="buttons">
			<button class="primary" data-save>Uložit</button>
			<button data-reset>Výchozí hodnoty</button>
			<button data-download>Stáhnout JSON</button>
			<button data-home>Celek</button>
			${ LOCAL ? '<button data-forget>Zahodit místní nastavení</button>' : '' }
		</div>
	</footer>`;
document.body.appendChild( panel );

const $ = sel => panel.querySelector( sel );
const status = ( text, kind = '' ) => {

	const el = $( '[data-status]' );
	el.textContent = text;
	el.className = 'status ' + kind;

};

status( LOCAL ? 'Načteno nastavení z tohoto prohlížeče (má přednost před serverem).' : SERVER ? 'Načteno nastavení ze serveru.' : 'Výchozí nastavení (na serveru zatím nic uloženo).' );
let dirty = false;
const changed = () => {

	dirty = true;
	status( 'Neuloženo.', 'warn' );

};

const rows = [];
function addRows( host, list, onInput, onChange ) {

	for ( const [ path, label, min, max, step, note ] of list ) {

		const row = document.createElement( 'label' );
		row.className = 'row';
		row.title = note || '';
		row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step}">`;
		const [ range, num ] = row.querySelectorAll( 'input' );
		range.dataset.path = path;
		const write = ( v, done ) => {

			v = Math.min( max, Math.max( min, Number( v ) ) );
			if ( ! Number.isFinite( v ) ) return;
			set( settings, path, v );
			range.value = num.value = v;
			onInput?.( path, v );
			if ( done ) onChange?.( path, v );
			changed();

		};

		range.addEventListener( 'input', () => write( range.value, false ) );
		range.addEventListener( 'change', () => write( range.value, true ) );
		num.addEventListener( 'change', () => write( num.value, true ) );
		rows.push( () => range.value = num.value = get( settings, path ) );
		host.appendChild( row );

	}

}

// Tabs and folding.
const tabs = panel.querySelectorAll( '[data-show]' );
for ( const b of tabs ) b.addEventListener( 'click', () => {

	for ( const t of tabs ) t.classList.toggle( 'on', t === b );
	for ( const sec of panel.querySelectorAll( '[data-tab]' ) ) sec.hidden = sec.dataset.tab !== b.dataset.show;

} );
$( '[data-fold]' ).addEventListener( 'click', () => {

	const folded = panel.classList.toggle( 'folded' );
	$( '[data-fold]' ).textContent = folded ? 'Nastavení' : 'Skrýt';
	resize();

} );
for ( const type of [ 'keydown', 'keyup' ] ) panel.addEventListener( type, e => e.stopPropagation() );

// Picture and light.
addRows( $( '[data-look]' ), LOOK, applyLook );
addRows( $( '[data-light]' ), [
	[ 'art.studio.sunAzimuth', 'Slunce – směr (°)', 0, 360, 1 ],
	[ 'art.studio.sunElevation', 'Slunce – výška (°)', 3, 89, 1 ],
	[ 'art.studio.ambient', 'Okolní světlo', 0, 2, 0.05 ]
], applyLight );

const fogColour = $( '[data-fogcolour]' ), fogOwn = $( '[data-fogown]' );
const writeFog = () => {

	settings.look.fogColour = fogOwn.checked ? fogColour.value : '';
	applyLight();
	changed();

};

fogColour.addEventListener( 'input', () => {

	fogOwn.checked = true;
	writeFog();

} );
fogOwn.addEventListener( 'change', writeFog );
rows.push( () => {

	fogOwn.checked = !! settings.look.fogColour;
	fogColour.value = settings.look.fogColour || '#d9b48f';

} );

const bgSelect = $( '[data-bg]' ), bgColour = $( '[data-bgcolour]' );
bgSelect.innerHTML = SKIES.map( s => `<option value="${s}">obloha: ${SKY_NAMES[ s ]}</option>` ).join( '' ) + '<option value="colour">jednolitá barva</option>';
const writeBg = () => {

	art().studio.background = bgSelect.value === 'colour' ? bgColour.value : bgSelect.value;
	applyLight();
	changed();

};

bgSelect.addEventListener( 'change', writeBg );
bgColour.addEventListener( 'input', () => {

	bgSelect.value = 'colour';
	writeBg();

} );
rows.push( () => {

	const bg = art().studio.background || 'golden_evening';
	bgSelect.value = SKIES.includes( bg ) ? bg : 'colour';
	bgColour.value = SKIES.includes( bg ) ? '#8f8a80' : bg;

} );

// People: heads and bodies for everyone.
let rebuilding = Promise.resolve();
const rebuildPeople = () => {

	rebuilding = rebuilding.then( async () => {

		applyArt( art() );
		bodyCache.clear();
		for ( let i = 0; i < lineup.length; i ++ ) await buildPerson( i );

	} );
	return rebuilding;

};

addRows( $( '[data-heads]' ), [
	[ 'art.headFacets', 'Hlava – počet stěn', 3, 16, 1, 'kolik stran má broušená hlava (6 = výchozí)' ],
	[ 'art.headScale', 'Hlava – velikost', 0.7, 1.6, 0.01, '1 = výchozí (už o kus větší než skutečná)' ],
	[ 'art.bodyLevels', 'Úrovně barev těla', 0, 32, 1, 'na kolik odstínů se seká barva oblečení a kůže; 0 = bez omezení' ]
], ( path, v ) => {

	if ( path === 'art.bodyLevels' ) applyArt( { bodyLevels: v } );
	invalidate();

}, path => {

	if ( path !== 'art.bodyLevels' ) rebuildPeople();

} );
const flat = $( '[data-flat]' );
flat.addEventListener( 'change', () => {

	art().flat = flat.checked;
	applyArt( { flat: flat.checked } );
	invalidate();
	changed();

} );
rows.push( () => flat.checked = art().flat !== false );

// The crowd's rules (art.crowd, src/persona.js): a change makes the same six people again by the new rules; the dice
// deal six new ones.
art().crowd = rulesFrom( art() );
const regenerate = ( fresh = false ) => {

	if ( fresh ) base = ( Math.random() * 4294967296 ) >>> 0;
	lineup.forEach( ( p, i ) => {

		const next = generated( i, fresh ? personSeed( base, i ) : p.seed );
		for ( const key of Object.keys( p ) ) delete p[ key ];
		Object.assign( p, next );

	} );
	saveLineup();
	showWardrobe();
	rebuilding = rebuilding.then( async () => {

		for ( let i = 0; i < lineup.length; i ++ ) await buildPerson( i );

	} );
	return rebuilding;

};

addRows( $( '[data-crowd]' ), [
	[ 'art.crowd.ugliness', 'Ošklivost', 0, 1, 0.01, '0 = jen trochu nedokonalí, 1 = pořádná PS1 groteska' ],
	[ 'art.crowd.textured', 'Látky místo barev', 0, 1, 0.05, 'podíl oblečení z fotek látek (zbytek jednolitá barva)' ],
	[ 'art.crowd.spread.fat', 'Rozptyl – tloušťka', 0, 2, 0.05 ],
	[ 'art.crowd.spread.belly', 'Rozptyl – břicho', 0, 2, 0.05 ],
	[ 'art.crowd.spread.legs', 'Rozptyl – délka nohou', 0, 2, 0.05 ],
	[ 'art.crowd.spread.head', 'Rozptyl – hlava', 0, 2, 0.05 ],
	[ 'art.crowd.spread.hunch', 'Rozptyl – shrbení', 0, 2, 0.05 ],
	[ 'art.crowd.spread.height', 'Rozptyl – výška', 0, 2, 0.05 ]
], null, () => regenerate() );
$( '[data-shuffle]' ).addEventListener( 'click', () => regenerate( true ) );
const seedInput = $( '[data-seed]' );
seedInput.addEventListener( 'change', () => {

	art().crowd.seed = Math.max( 0, Math.round( Number( seedInput.value ) || 0 ) ) >>> 0;
	if ( art().crowd.seed ) base = art().crowd.seed;
	changed();
	regenerate( false );

} );
rows.push( () => seedInput.value = art().crowd?.seed || 0 );

// The chosen person's shape (src/people.js SHAPE), height and width: the spec edited by hand, as a character
// creator would.
const SHAPE_NAMES = { fat: 'Tloušťka', belly: 'Břicho', hips: 'Boky', head: 'Hlava', hunch: 'Shrbení', shoulders: 'Ramena', legs: 'Nohy (délka)', torso: 'Trup (délka)', arms: 'Ruce (délka)', neck: 'Krk', tilt: 'Nakřivo', lumps: 'Hrbolatost' };
const shapeRows = [];
{

	const host = $( '[data-shape]' );
	const knobs = [ ...SHAPE.map( k => [ k, SHAPE_NAMES[ k ], - 1, 1.5, 0.01 ] ), [ 'height', 'Výška (m)', 1.4, 2.1, 0.01 ], [ 'width', 'Šířka', 0.85, 1.15, 0.01 ] ];
	let pending = null;
	for ( const [ key, label, min, max, step ] of knobs ) {

		const row = document.createElement( 'label' );
		row.className = 'row';
		row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step}">`;
		const [ range, num ] = row.querySelectorAll( 'input' );
		const read = () => key === 'height' || key === 'width' ? lineup[ current ][ key ] ?? 1 : lineup[ current ].shape?.[ key ] ?? 0;
		const write = v => {

			v = Math.min( max, Math.max( min, Number( v ) ) );
			if ( ! Number.isFinite( v ) ) return;
			const p = lineup[ current ];
			if ( key === 'height' || key === 'width' ) p[ key ] = v;
			else ( p.shape ??= {} )[ key ] = v;
			range.value = num.value = v;
			saveLineup();
			// Rebuilt at most once at a time; the last value wins.
			const i = current;
			if ( ! pending ) pending = rebuilding = rebuilding.then( async () => {

				pending = null;
				await buildPerson( i );

			} );

		};

		range.addEventListener( 'input', () => write( range.value ) );
		num.addEventListener( 'change', () => write( num.value ) );
		shapeRows.push( () => range.value = num.value = read() );
		host.appendChild( row );

	}

}

// The person being dressed.
let current = 0;
const peopleBar = $( '[data-people]' );
lineup.forEach( ( p, i ) => {

	const b = document.createElement( 'button' );
	b.textContent = p.seated ? `${i + 1} sedí` : `${i + 1}`;
	b.addEventListener( 'click', () => {

		selectPerson( i );
		focus( people[ i ].item );

	} );
	peopleBar.appendChild( b );

} );

const bodySelect = $( '[data-body]' );
const NAMES = { 'animated-men': 'muž', 'animated-women': 'žena', 'modular-men': 'muž (modular)', 'modular-women': 'žena (modular)' };
bodySelect.addEventListener( 'change', async () => {

	lineup[ current ].body = bodySelect.value;
	saveLineup();
	await buildPerson( current );

} );

// Wardrobe categories: [ key, label, kind, part, none label ].
const CATS = [
	[ 'face', 'Tvář', 'faces', null, null ],
	[ 'hair', 'Vlasy (zadní a horní strany hlavy)', 'heads', null, 'z tváře' ],
	[ 'top', 'Nahoře', 'clothes', 'top', 'barva' ],
	[ 'bottom', 'Dole', 'clothes', 'bottom', 'barva' ],
	[ 'skin', 'Kůže', 'skin', null, 'z tváře' ]
];

const wardrobeHost = $( '[data-wardrobe]' );
function showWardrobe() {

	const p = lineup[ current ];
	for ( const [ i, b ] of [ ...peopleBar.children ].entries() ) b.classList.toggle( 'on', i === current );
	bodySelect.innerHTML = BODIES.filter( b => ! p.seated || b.animated ).map( b => {

		const [ dir, name ] = b.file.split( '/' );
		return `<option value="${b.file}">${NAMES[ dir ]}: ${name}</option>`;

	} ).join( '' );
	bodySelect.value = p.body;
	wardrobeHost.innerHTML = '';
	for ( const [ key, label, kind, part, none ] of CATS ) {

		const head = document.createElement( 'div' );
		head.className = 'cat';
		const chosen = p[ key ], out = new Set( art().exclude?.[ kind ] || [] );
		head.innerHTML = `<b>${label}</b>`;
		if ( chosen ) {

			const ex = document.createElement( 'button' );
			ex.textContent = out.has( chosen ) ? 'Vrátit do ulic' : 'Vyřadit z ulic';
			ex.title = chosen;
			ex.addEventListener( 'click', () => {

				const list = art().exclude[ kind ] ??= [];
				const k = list.indexOf( chosen );
				if ( k >= 0 ) list.splice( k, 1 );
				else list.push( chosen );
				changed();
				showWardrobe();

			} );
			head.appendChild( ex );

		}

		const grid = document.createElement( 'div' );
		grid.className = 'thumbs';
		grid.dataset.cat = key;
		if ( none ) {

			const b = document.createElement( 'button' );
			b.className = 'none' + ( chosen ? '' : ' on' );
			b.textContent = none;
			b.title = none === 'barva' ? 'jednolitá barva' : 'barva přečtená z fotky tváře';
			if ( none === 'barva' ) {

				const sw = document.createElement( 'span' );
				sw.className = 'sw';
				sw.style.background = '#' + new THREE.Color().setHex( p.colour?.[ key === 'top' ? 0 : 1 ] ?? 0x3c3e44 ).getHexString();
				sw.style.opacity = 0.5;
				b.appendChild( sw );

			}

			b.addEventListener( 'click', () => wear( key, '' ) );
			grid.appendChild( b );

		}

		for ( const t of wardrobe.tiles[ kind ].filter( t => ! part || ! t.part || t.part === part ) ) {

			const b = document.createElement( 'button' );
			b.className = ( t.file === chosen ? 'on ' : '' ) + ( out.has( t.file ) ? 'out' : '' );
			b.title = t.file + ( out.has( t.file ) ? ' (vyřazeno z ulic)' : '' );
			b.dataset.file = t.file;
			b.innerHTML = `<img loading="lazy" alt="" src="models/people/${t.dir || kind}/${t.file}">`;
			b.addEventListener( 'click', () => wear( key, t.file ) );
			grid.appendChild( b );

		}

		wardrobeHost.append( head, grid );

	}

	shapeRows.forEach( f => f() );

}

function saveLineup() {

	art().lineup = lineup.map( ( { seated, ...spec } ) => structuredClone( spec ) );
	changed();

}

// Dressing in a texture changes only the person's look attribute, at once.
function wear( key, file ) {

	const p = lineup[ current ];
	p[ key ] = file;
	saveLineup();
	const s = people[ current ].skinned;
	let mesh = null;
	s.object.traverse( o => {

		if ( o.isSkinnedMesh ) mesh = o;

	} );
	mesh.geometry.setAttribute( 'look', lookAttribute( mesh.geometry, lookOf( p, wardrobe ) ) );
	invalidate();
	showWardrobe();

}

function selectPerson( i ) {

	current = i;
	showWardrobe();

}

// The pigeon and things.
const feathers = $( '[data-feathers]' );
$( '[data-feather-thumbs]' ).innerHTML = [ 'pigeon_body', 'pigeon_tail', 'seagull_body', 'seagull_wing', 'duck_head_green', 'duck_chest_brown', 'duck_body_grey' ].map( n => `<button title="${n}" disabled><img alt="" src="models/animals/${n}.jpg"></button>` ).join( '' );
feathers.addEventListener( 'change', () => {

	art().pigeon.texture = feathers.value;
	buildBirds();
	changed();

} );
rows.push( () => feathers.value = art().pigeon?.texture || 'plain' );
addRows( $( '[data-pigeon]' ), [ [ 'art.pigeon.size', 'Velikost holuba', 0.5, 2.5, 0.05, '1 = výchozí (ve hře je holub vždy o 15 % větší než skutečný)' ] ], () => buildBirds() );
const photoFood = $( '[data-photofood]' );
photoFood.addEventListener( 'change', () => {

	art().photoFood = photoFood.checked;
	buildTable();
	changed();

} );
rows.push( () => photoFood.checked = !! art().photoFood );

const turn = $( '[data-turn]' );
turn.addEventListener( 'change', () => {

	art().studio.turntable = turn.checked;
	changed();

} );
rows.push( () => turn.checked = !! art().studio.turntable );

const list = $( '[data-items]' );
for ( const item of items ) {

	const li = document.createElement( 'li' ), b = document.createElement( 'button' );
	b.textContent = item.name;
	b.addEventListener( 'click', () => {

		focus( item );
		if ( item.person !== undefined ) selectPerson( item.person );

	} );
	li.appendChild( b );
	list.appendChild( li );

}

// Save, reset, download.
const showAll = () => rows.forEach( f => f() );
$( '[data-save]' ).addEventListener( 'click', async () => {

	status( 'Ukládám…' );
	const where = await saveSettings( settings );
	if ( where === 'server' ) status( 'Uloženo na server. Platí pro všechny hráče.', 'ok' );
	else if ( where === 'local' ) status( 'Server není k dispozici: uloženo jen v tomto prohlížeči. Soubor pro server: Stáhnout JSON.', 'warn' );
	else status( 'Nepodařilo se uložit. Stáhněte JSON.', 'warn' );
	dirty = false;

} );
$( '[data-reset]' ).addEventListener( 'click', async () => {

	settings = merge( DEFAULTS, null );
	delete settings.version;
	settings.art.studio ??= {};
	base = gameSeed( rulesFrom( settings.art ) );
	settings.art.crowd = rulesFrom( settings.art );
	lineup.forEach( ( p, i ) => {

		const next = generated( i );
		for ( const key of Object.keys( p ) ) delete p[ key ];
		Object.assign( p, next );

	} );
	applyLook();
	showAll();
	selectPerson( current );
	buildBirds();
	buildTable();
	await rebuildPeople();
	changed();
	status( 'Výchozí hodnoty. Uložením je potvrdíte.', 'warn' );

} );
$( '[data-download]' ).addEventListener( 'click', () => downloadSettings( settings ) );
$( '[data-home]' ).addEventListener( 'click', () => focus( null ) );
$( '[data-forget]' )?.addEventListener( 'click', () => {

	writeLocal( null );
	location.reload();

} );
window.addEventListener( 'beforeunload', e => {

	if ( dirty ) e.preventDefault();

} );

// --- go -------------------------------------------------------------------------------------------------------------

window.addEventListener( 'resize', resize );
resize();
applyLook();
showAll();
selectPerson( 0 );
loading?.remove();

// Drawn on demand: the set is still, so a frame is drawn only after something changed (the camera, a control, a
// texture arriving), for a short while after it (the orbit's damping), and never more than 60 times a second
// (?fps=N for another cap).
const FPS = Number( params.get( 'fps' ) ) || 60;
const timer = new THREE.Timer();
let last = - Infinity;
renderer.setAnimationLoop( now => {

	if ( now - last < 1000 / FPS - 2 ) return;
	timer.update();
	const dt = Math.min( timer.getDelta(), 0.1 );
	last = now;
	const moving = controls.update();
	if ( fly || moving || art().studio.turntable ) invalidate();
	if ( performance.now() > awakeUntil ) return;
	if ( fly ) {

		fly.t = Math.min( 1, fly.t + dt / 0.6 );
		const e = 1 - ( 1 - fly.t ) ** 3;
		camera.position.lerpVectors( fly.from[ 0 ], fly.to[ 0 ], e );
		controls.target.lerpVectors( fly.from[ 1 ], fly.to[ 1 ], e );
		if ( fly.t >= 1 ) fly = null;

	}

	if ( art().studio.turntable ) for ( const item of items ) item.spin.rotation.y += dt * 0.35;
	ps1.render();
	frames ++;

} );

// For tests and the console.
window.__studio = {
	get settings() {

		return settings;

	},
	get lineup() {

		return lineup;

	},
	set( path, v ) {

		const input = panel.querySelector( `input[type=range][data-path="${path}"]` );
		input.value = v;
		input.dispatchEvent( new Event( 'input' ) );
		input.dispatchEvent( new Event( 'change' ) );
		return rebuilding;

	},
	get frames() {

		return frames;

	},
	people,
	shuffle: () => regenerate( true ),
	view( x, y, z, tx, ty, tz ) {

		camera.position.set( x, y, z );
		controls.target.set( tx, ty, tz );
		invalidate();

	},
	focus: name => focus( items.find( i => i.name === name ) || null ),
	ready: true
};
