// The owner's friends: a few named people with their own photo faces, always in the same places: all of them round
// one table in the pub (Hostinec U Rotundy), and some of them about the city as well. Come within a few metres and
// their name and a line of theirs show above their head.
//
// Their faces are private and never in the repository: they live in public/models/people/friends/ (gitignored)
// with a friends.json beside them, put there by tools/friends.mjs. Without that folder there are simply no friends.
//
// friends.json:
//   { "friends": [ { "name": "…", "file": "….jpg", "sex": "m", "lines": [ "…", "…" ],
//                    "spots": [ "pub", "kampa", { "x": 0, "z": 0, "yaw": 0, "pose": "stand" } ] } ] }
//   `spots` are names from SPOTS below or a place of their own (pose "stand" or "bench"); "pub" takes the next free
//   place at the table. Each friend's body and clothes are dealt from a seed made from their name, so they look the
//   same every game (`seed` in the entry changes it).
//
// The faces are drawn into free tiles of the crowd's atlas, but not listed among its faces, so nobody in the crowd
// ever wears one.

import * as THREE from 'three/webgpu';
import { BODIES, makeSkinned, makeBatch, shapedHeight, shapeWeights } from './people.js';
import { generatePerson, lookOf } from './persona.js';
import { onFront, cyl, M, Kit } from './kit.js';

const DIR = 'models/people/friends/';
const NEAR = 4; // metres: how close the player comes before a friend says something

// Hostinec U Rotundy (Karoliny Světlé 17; tools/places.mjs, the room's frame as src/venues.js builds it): the right-
// hand front table of the vaulted room, four spindle chairs (local x 2.21 ± 0.45, z −1.35 ∓ 0.6) and the aisle end of
// the table to stand at. Local x to the right seen from the street, z out of the wall (the room is at negative z).
const PUB = { x: - 266.99, y: 6.38, z: 205.86, n: [ 0.973, - 0.2308 ], table: [ 2.205, - 1.35 ] };
const PUB_PLACES = [
	{ sit: [ 1.755, - 1.95, Math.PI ] }, { sit: [ 2.655, - 1.95, Math.PI ] },
	{ sit: [ 1.755, - 0.75, 0 ] }, { sit: [ 2.655, - 0.75, 0 ] },
	{ stand: [ 1.05, - 1.05 ] }, { stand: [ 1.0, - 1.75 ] }, { stand: [ 1.2, - 2.45 ] }, { stand: [ 0.75, - 0.6 ] }
];

// Places about the city (scene frame; yaw: the way they face, (sin yaw, cos yaw)).
//   kampa: the bench on Kampa by the river (OSM bench, scene furniture), at its east half.
//   betlem: Betlémské náměstí, in the open east part of the square, facing north.
//   divadlo: the Národní divadlo tram island on Národní, waiting at the stop, looking east up Národní for the tram.
export const SPOTS = {
	kampa: { bench: [ - 763, 10.82, 0 ] },
	betlem: { x: - 61, z: 69, yaw: Math.PI },
	divadlo: { x: - 300.0, z: 335.6, yaw: 1.68 }
};

// Their list (null when there is none: the folder is absent in the public repository).
export async function loadFriends() {

	// The build knows whether the folder is there (vite.config.js); without it nothing is asked for (no 404).
	if ( typeof __FRIENDS__ !== 'undefined' && ! __FRIENDS__ ) return null;
	try {

		const r = await fetch( DIR + 'friends.json', { cache: 'no-cache' } );
		if ( ! r.ok || ! ( r.headers.get( 'content-type' ) || '' ).includes( 'json' ) ) return null;
		const j = await r.json();
		return Array.isArray( j?.friends ) && j.friends.length ? j.friends : null;

	} catch {

		return null;

	}

}

// A seed from a name (FNV-1a).
export function nameSeed( name ) {

	let h = 0x811c9dc5;
	for ( const ch of name ) h = Math.imul( h ^ ch.codePointAt( 0 ), 0x01000193 );
	return h >>> 0;

}

// A free tile of the people's atlas (none of the wardrobe's, below the garment fronts' two rows), or −1.
function freeTiles( wardrobe ) {

	const used = new Set();
	for ( const list of Object.values( wardrobe.tiles ) ) for ( const t of list ) used.add( t.t );
	const canvas = wardrobe.map.image, tile = 128, grid = canvas.width / tile, last = ( grid - 2 ) * grid;
	let next = 0;
	return () => {

		while ( next < last && used.has( next ) ) next ++;
		if ( next >= last ) return - 1;
		used.add( next );
		return next ++;

	};

}

// Draws a face photo into a free tile; the skin (cheeks) and hair (top edge) colours read back as the wardrobe does.
async function faceTile( wardrobe, next, url ) {

	const img = new Image();
	img.src = url;
	await img.decode();
	const t = next();
	if ( t < 0 ) return null;
	const canvas = wardrobe.map.image, c = canvas.getContext( '2d' ), tile = 128, grid = canvas.width / tile;
	const x = ( t % grid ) * tile, y = Math.floor( t / grid ) * tile;
	c.drawImage( img, x, y, tile, tile );
	const mean = ( x0, y0, x1, y1 ) => {

		const d = c.getImageData( x + x0 * tile, y + y0 * tile, ( x1 - x0 ) * tile, ( y1 - y0 ) * tile ).data;
		let r = 0, g = 0, b = 0;
		for ( let i = 0; i < d.length; i += 4 ) {

			r += d[ i ];
			g += d[ i + 1 ];
			b += d[ i + 2 ];

		}

		const n = d.length / 4;
		return new THREE.Color().setRGB( r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace ).toArray();

	};

	const a = mean( 0.22, 0.55, 0.32, 0.68 ), b = mean( 0.68, 0.55, 0.78, 0.68 );
	wardrobe.map.needsUpdate = true;
	return { t, skin: a.map( ( v, i ) => ( v + b[ i ] ) / 2 ), hair: mean( 0.3, 0, 0.7, 0.05 ) };

}

// A person of their own look on a body, placed once: standing (skinned, the Idle clip played while near) or seated.
// Returns the figure, drawn and animated by `figures.update`.
export function figure( body, spec, look, { x, y, z, yaw, sit = null } ) {

	if ( sit && body.sitting ) {

		// Seated as the crowd sits (src/life.js sitAt): the body's baked sitting pose, instanced once; the hips back
		// from the seat's middle, the seat of the trousers on the seat (it moves with the body's shape).
		const sc = spec.height / shapedHeight( body, spec.shape ), width = spec.width ?? 1;
		const fx = Math.sin( yaw ), fz = Math.cos( yaw ), o = sit.back + body.sitting.hipsZ * sc;
		const w = shapeWeights( spec.shape ), drop = body.sitting.drop.reduce( ( a, d, k ) => a + d * w[ k ], 0 );
		const p = new THREE.Vector3( x - fx * o, y + sit.height - ( body.sitting.bottom + drop ) * sc + 0.01, z - fz * o );
		const mesh = makeBatch( body.sitting.geometry, 1 );
		mesh.setLook( 0, look );
		mesh.setShape( 0, spec.shape );
		mesh.setMatrixAt( 0, new THREE.Matrix4().compose( p, new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), yaw ), new THREE.Vector3( sc * width, sc, sc * width ) ) );
		mesh.instanceMatrix.needsUpdate = true;
		return { object: mesh, animate: false, height: spec.height * 0.72, x: p.x, y: p.y, z: p.z };

	}

	const { object, mixer } = makeSkinned( body, look, spec.height, spec.shape, spec.width ?? 1 );
	object.position.set( x, y, z );
	object.rotation.y = yaw;
	const act = mixer.clipAction( body.clips.Idle || body.clips.Walk ).play();
	act.time = ( spec.seed % 1000 ) / 1000 * act.getClip().duration;
	mixer.update( 0 );
	return { object, mixer, animate: true, height: spec.height, x, y, z };

}

// Draws a set of figures: each shown within the haze (at most `far` metres), animated within 40 m.
export function figures( scene, list, camera, far = 150 ) {

	const group = new THREE.Group();
	group.name = 'special people';
	for ( const f of list ) group.add( f.object );
	scene.add( group );
	return {
		group,
		update( dt ) {

			const limit = Math.min( far, scene.fog?.far ?? far );
			for ( const f of list ) {

				if ( f.hidden ) {

					f.object.visible = false;
					continue;

				}

				const d = Math.hypot( f.x - camera.position.x, f.z - camera.position.z );
				f.object.visible = d < limit;
				if ( f.object.visible && f.animate && d < 40 ) f.mixer.update( dt );

			}

		}
	};

}

// The name and a line above a friend's head: a small label of its own over the game's picture, projected to the
// screen each frame. Self-contained, so it doesn't depend on the HUD's styling.
function labels( dom ) {

	const style = document.createElement( 'style' );
	style.textContent = `
		.friend-label { position: fixed; left: 0; top: 0; transform: translate(-50%, -100%); pointer-events: none; z-index: 5;
			font: 13px/1.3 system-ui, sans-serif; color: #fff; text-align: center; text-shadow: 0 1px 2px #000, 0 0 4px #000;
			opacity: 0; transition: opacity 0.25s; white-space: nowrap; }
		.friend-label b { display: block; font-size: 15px; letter-spacing: 0.02em; }
		.friend-label span { display: block; max-width: 260px; white-space: normal; font-style: italic; opacity: 0.92; }
		.friend-label.on { opacity: 1; }`;
	document.head.appendChild( style );
	const v = new THREE.Vector3();
	return {
		make( name ) {

			const el = document.createElement( 'div' );
			el.className = 'friend-label';
			el.innerHTML = '<b></b><span></span>';
			el.querySelector( 'b' ).textContent = name;
			document.body.appendChild( el );
			return el;

		},
		place( el, x, y, z, camera ) {

			v.set( x, y, z ).project( camera );
			if ( v.z > 1 || Math.abs( v.x ) > 1.1 || Math.abs( v.y ) > 1.1 ) return false;
			const r = dom.getBoundingClientRect();
			el.style.left = `${ r.left + ( v.x + 1 ) / 2 * r.width }px`;
			el.style.top = `${ r.top + ( 1 - v.y ) / 2 * r.height }px`;
			return true;

		}
	};

}

// Builds the friends (when their folder is there). `taken( x, z )` says whether a seat or bench is theirs, so the
// crowd leaves it free; `update( dt )` draws them and their labels.
export async function addFriends( scene, { wardrobe, bodies, rules, groundHeight, camera, dom, player } ) {

	const none = { taken: () => false, update() {}, list: [] };
	const list = await loadFriends();
	if ( ! list ) return none;

	const next = freeTiles( wardrobe );
	const pub = onFront( PUB.x, PUB.y, PUB.z, PUB.n );
	pub.updateMatrixWorld( true );
	const local = ( x, z ) => new THREE.Vector3( x, 0, z ).applyMatrix4( pub.matrixWorld );
	const localYaw = rot => {

		// A direction in the room's frame to the scene's yaw.
		const d = new THREE.Vector3( Math.sin( rot ), 0, Math.cos( rot ) ).transformDirection( pub.matrixWorld );
		return Math.atan2( d.x, d.z );

	};

	const [ tx, tz ] = PUB.table, table = local( tx, tz );
	const reserved = [];
	const people = [], ui = labels( dom || document.querySelector( 'canvas' ) );
	let atPub = 0;

	for ( const entry of list ) {

		if ( ! entry?.name || ! entry.file ) continue;
		let face;
		try {

			face = await faceTile( wardrobe, next, DIR + encodeURIComponent( entry.file ) );

		} catch {

			console.warn( 'friends: face missing', entry.file );
			continue;

		}

		if ( ! face ) break; // the atlas is full

		// Their body and clothes from their name (an animated body, which can stand and sit), their own face, and the
		// hair and skin in the face's colours.
		const sex = entry.sex === 'f' ? 'f' : 'm';
		const spec = generatePerson( rules, entry.seed ?? nameSeed( entry.name ), wardrobe, { sitting: true, sex } );
		spec.hair = spec.skin = '';
		const look = lookOf( spec, wardrobe );
		look[ 2 ] = [ ...face.hair, 1 ];
		look[ 3 ] = [ ...face.skin, 1 ];
		look[ 4 ] = [ 1, 1, 1, 2 + face.t ];
		const body = bodies[ BODIES.findIndex( b => b.file === spec.body ) ];
		if ( ! body ) continue;
		const lines = ( entry.lines || [] ).filter( l => typeof l === 'string' && l );

		for ( const s of entry.spots || [ 'pub' ] ) {

			let at = null;
			if ( s === 'pub' ) {

				const p = PUB_PLACES[ atPub ++ ];
				if ( ! p ) continue;
				if ( p.sit ) {

					const w = local( p.sit[ 0 ], p.sit[ 1 ] );
					// The chair faces the table (src/venues.js seat(): the sitter looks along the chair's −z).
					at = { x: w.x, y: PUB.y, z: w.z, yaw: localYaw( p.sit[ 2 ] + Math.PI ), sit: { back: 0.06, height: 0.45 } };
					reserved.push( [ w.x, w.z ] );

				} else {

					const w = local( p.stand[ 0 ], p.stand[ 1 ] );
					at = { x: w.x, y: PUB.y, z: w.z, yaw: Math.atan2( table.x - w.x, table.z - w.z ) };

				}

			} else {

				const o = typeof s === 'string' ? SPOTS[ s ] : s;
				if ( ! o ) continue;
				if ( o.bench || o.pose === 'bench' ) {

					// A bench: the seat along its local x. The crowd's posed bench sitters (src/life.js) face −z in their
					// model and are turned by rot + π; the animated bodies face +z, so by rot itself. The east half.
					const [ bx, bz, rot ] = o.bench || [ o.x, o.z, o.yaw ?? 0 ];
					const yaw = rot, x = bx + Math.cos( rot ) * 0.45, z = bz - Math.sin( rot ) * 0.45;
					at = { x, y: groundHeight( bx, bz ), z, yaw, sit: { back: 0.08, height: 0.47 } };
					reserved.push( [ bx, bz ] );

				} else at = { x: o.x, y: groundHeight( o.x, o.z ), z: o.z, yaw: o.yaw ?? 0 };

			}

			const f = figure( body, spec, look, at );
			f.name = entry.name;
			f.lines = lines;
			f.label = ui.make( entry.name );
			people.push( f );

		}

	}

	const drawn = figures( scene, people, camera );

	// A small table's worth of beer: a full mug in front of every chair and a few for the ones standing.
	const kit = new Kit();
	for ( const [ x, z ] of [ [ 1.75, - 1.55 ], [ 2.6, - 1.6 ], [ 1.8, - 1.12 ], [ 2.68, - 1.05 ], [ 1.48, - 1.3 ], [ 1.5, - 1.62 ], [ 2.25, - 1.4 ] ] ) {

		kit.add( M.beer, cyl( 0.045, 0.045, 0.13, x, 0.77, z, 10 ) ).add( M.foam, cyl( 0.047, 0.047, 0.03, x, 0.9, z, 10 ) );

	}

	kit.build( pub, { shadows: false } );
	if ( people.length ) scene.add( pub );

	// Only the nearest friend within reach speaks (round the pub table they would all talk at once).
	let shown = null;
	function update( dt ) {

		drawn.update( dt );
		const me = player?.();
		let best = null, bd = NEAR;
		if ( me ) for ( const f of people ) {

			const d = Math.hypot( f.x - me.x, f.z - me.z );
			if ( f.object.visible && d < bd && ( me.y === undefined || Math.abs( f.y - me.y ) < 2.5 ) ) {

				best = f;
				bd = d;

			}

		}

		if ( best !== shown ) {

			// A new line each time one comes up to them.
			if ( best ) best.label.querySelector( 'span' ).textContent = best.lines.length ? best.lines[ Math.floor( Math.random() * best.lines.length ) ] : '';
			shown?.label.classList.remove( 'on' );
			shown = best;

		}

		if ( shown ) shown.label.classList.toggle( 'on', ui.place( shown.label, shown.x, shown.y + shown.height + 0.12, shown.z, camera ) );

	}

	return {
		list: people,
		taken: ( x, z ) => reserved.some( ( [ rx, rz ] ) => Math.hypot( rx - x, rz - z ) < 0.3 ),
		update,
		get shown() {

			return shown;

		}
	};

}
