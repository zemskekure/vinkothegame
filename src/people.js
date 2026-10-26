// People: Quaternius' low-poly characters (CC0; public/models/people/PROVENANCE.md), dressed late-90s style.
//   - Animated Men / Animated Women (2019): the main crowd; 31-bone rig, Walk / Idle / Run / Sitting.
//   - Ultimate Modular Men / Women (2022): more kinds of people (business, hoodie, worker, punk, beach, tourist with a
//     backpack); 62-bone rig, Walk / Idle / Run / Wave, no sitting.
//   - Background Posed Humans (2018): static people, standing about or sitting on benches.
//
// Every body becomes one geometry (all its parts and materials merged). Its modelled head is replaced by a box on
// the head bone, PS1 style, whose front carries a face texture. Each vertex has the modelled colour, box-projected
// UVs (one texture tile per 0.5 m) and a `slot`: 0 kept as modelled (eyes, shoes, ties), 1 top, 2 bottom, 3 hair
// (the head box's sides, back and top), 4 skin, 5 face (the box's front), 6 the top's chest (one picture across it,
// where a garment front shows).
//
// A person ("look") is, per slot 1…5, [ r, g, b, mode ]: mode 0 keeps the modelled colour, 1 paints r g b, 2 + t
// paints tile t of the wardrobe atlas tinted by r g b. Skinned people near the camera carry their look in a
// per-person vertex attribute; instanced ones per instance. The wardrobe (public/models/people/manifest.json, low-
// resolution images by kind: faces, heads, clothes, skin, fronts) is packed into one nearest-filtered atlas; without
// any face photos a drawn pixel face stands in. Bodies also have shapes (see "Body shapes" below). Who wears what
// and how they are built is decided in src/persona.js.

import * as THREE from 'three/webgpu';
import { attribute, select, texture, uv, vec2, float, pow } from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { snapVertex, BODY_LEVELS, ART } from './holub/ps1.js';

export const SLOT = { keep: 0, top: 1, bottom: 2, hair: 3, skin: 4, face: 5, chest: 6 };
const LOOKS = [ 'lookTop', 'lookBottom', 'lookHair', 'lookSkin', 'lookFace' ];
const BLOCK_HEADS = ! new URLSearchParams( location.search ).has( 'modelheads' ); // ?modelheads keeps the modelled heads
// In the pigeon game (?holub) the people are drawn like the rest of its late-90s picture: faceted (one normal per
// triangle), their vertices snapped to the console's coarse screen grid (src/holub/ps1.js), and their colours cut
// to a few levels a channel. The walking view keeps them smooth. How faceted, how many levels and the head's shape
// are the art direction (game settings, `art`; tuned in the studio, ?studio).
const PS1 = window.GAME === 'holub' || /[?&](holub|admin|studio)(=|&|$)/.test( location.search );
const HEAD = { facets: ART.headFacets ?? 6, scale: ART.headScale ?? 1 };
let FLAT = ART.flat !== false;

export const BODIES = [
	[ 'm', 'animated-men/longsleeve' ], [ 'm', 'animated-men/shirt' ], [ 'm', 'animated-men/casual' ], [ 'm', 'animated-men/suit' ],
	[ 'f', 'animated-women/jacket' ], [ 'f', 'animated-women/casual' ], [ 'f', 'animated-women/tanktop' ], [ 'f', 'animated-women/dress' ],
	[ 'm', 'modular-men/business' ], [ 'm', 'modular-men/hoodie' ], [ 'm', 'modular-men/casual' ], [ 'm', 'modular-men/worker' ],
	[ 'm', 'modular-men/punk' ], [ 'm', 'modular-men/beach' ], [ 'm', 'modular-men/adventurer' ], [ 'm', 'modular-men/farmer' ],
	[ 'f', 'modular-women/casual' ], [ 'f', 'modular-women/formal' ], [ 'f', 'modular-women/punk' ], [ 'f', 'modular-women/adventurer' ]
].map( ( [ sex, file ] ) => ( { sex, file, animated: file.startsWith( 'animated' ) } ) );

// What people in Prague wear on an ordinary day: mostly dark and muted, some colour. sRGB.
export const TOPS = [ 0x1d1d20, 0x2b2c31, 0x3c3e44, 0x6d7076, 0xa3a5a8, 0xe6e3dc, 0xd8cfbd, 0x1f2a44, 0x2d3d5c, 0x4c6a8f,
	0x8fb0cf, 0x6b2230, 0xa33a32, 0xc4562f, 0xc89b2c, 0x5a5e3a, 0x2f4a3a, 0x3f6b5a, 0x8b8160, 0xa87b4f, 0x5a3e2b, 0xd49aa4, 0x7b4f7a ];
export const BOTTOMS = [ 0x1a1a1c, 0x2a2b2f, 0x24324d, 0x34496b, 0x4f6a90, 0x6e86a8, 0x55575c, 0x8a8a86, 0xbcae8e, 0x8b7f5e,
	0x4c4f34, 0x4a3426, 0x6b5a48 ];
export const HAIR = [ 0x16110e, 0x2a1d15, 0x3b281b, 0x5a3b24, 0x7a5434, 0xa78457, 0xcfb27c, 0x8c8a86, 0xc9c6c0, 0x6e2f1d ];
export const SKIN = [ 0xf1d0b5, 0xeac2a1, 0xe3b38f, 0xd9a47e, 0xc98e66, 0xb97a55, 0x9a6244, 0x6e452f ];


// ---------------------------------------------------------------------------
// The wardrobe: an atlas of low-resolution textures, nearest-filtered.

const TILE = 128, GRID = 16; // a 2048 px atlas of 128 px tiles
// Garment fronts (a hoodie, a cardigan, a flannel shirt… photographed flat) take two tiles each: a patch of their
// plain fabric in the last row (FABRIC_ROW + i), for the back and sleeves, and the front itself one row up, stretched
// over the chest. A top whose tile is in the last row shows the front on its chest triangles (slot 6).
const FABRIC_ROW = ( GRID - 1 ) * GRID, FRONT_ROW = ( GRID - 2 ) * GRID;

// A drawn pixel face (16 × 16, scaled up): eyes, brows, nose shadow, mouth; white where the skin colour shows.
function drawFace( c, x0, y0, variant = 0 ) {

	const px = TILE / 16, dot = ( x, y, w, h, col ) => {

		c.fillStyle = col;
		c.fillRect( x0 + x * px, y0 + y * px, w * px, h * px );

	};

	dot( 0, 0, 16, 16, '#ffffff' );
	dot( 3, 6, 3, 1, '#4a3a30' );
	dot( 10, 6, 3, 1, '#4a3a30' );
	dot( 4, 7, 2, 2, '#ffffff' );
	dot( 10, 7, 2, 2, '#ffffff' );
	dot( 4 + ( variant & 1 ), 7, 1, 2, '#1a1410' );
	dot( 10 + ( variant & 1 ), 7, 1, 2, '#1a1410' );
	dot( 7, 9, 2, 2, '#d8c2b4' );
	dot( 5, 12, 6, 1, '#8a4a40' );
	if ( variant & 2 ) dot( 6, 13, 4, 1, '#b07a6c' );

}

export async function loadWardrobe() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = TILE * GRID;
	const c = canvas.getContext( '2d', { willReadFrequently: true } );
	c.imageSmoothingEnabled = false;
	const tiles = { faces: [], heads: [], clothes: [], skin: [] };
	let fronts = 0;
	let next = 0;
	const place = draw => {

		if ( next >= GRID * GRID ) return - 1;
		const t = next ++;
		draw( ( t % GRID ) * TILE, Math.floor( t / GRID ) * TILE );
		return t;

	};

	// Images listed in public/models/people/manifest.json by kind (faces/, heads/, clothes/, skin/), each a file
	// name or { file, sex }, scaled into their tile. For a face, the skin (cheeks) and hair (top edge) colours are
	// read back so the rest of the person matches it.
	let manifest = null;
	try {

		const r = await fetch( 'models/people/manifest.json' );
		if ( r.ok ) manifest = await r.json();

	} catch ( e ) { /* no wardrobe yet */ }

	const mean = ( x, y, x0, y0, x1, y1 ) => {

		const d = c.getImageData( x + x0 * TILE, y + y0 * TILE, ( x1 - x0 ) * TILE, ( y1 - y0 ) * TILE ).data, k = new THREE.Color();
		let r = 0, g = 0, b = 0;
		for ( let i = 0; i < d.length; i += 4 ) {

			r += d[ i ];
			g += d[ i + 1 ];
			b += d[ i + 2 ];

		}

		const n = d.length / 4;
		return k.setRGB( r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace ).toArray();

	};

	// Garment fronts (manifest `fronts`: { file, crop, patch }, rectangles as fractions of the image): the patch fills
	// its fabric tile; the front's body (`crop`, without the sleeves) is drawn over the patch's mean colour, so what is
	// transparent round the collar shows the same cloth.
	if ( manifest?.fronts ) await Promise.all( manifest.fronts.slice( 0, GRID ).map( async ( { file, crop, patch } ) => {

		try {

			const img = new Image();
			img.src = `models/people/fronts/${file}`;
			await img.decode();
			const W = img.naturalWidth, H = img.naturalHeight, i = fronts ++;
			const fx = ( i % GRID ) * TILE, fy = Math.floor( FABRIC_ROW / GRID ) * TILE + Math.floor( i / GRID ) * TILE;
			c.drawImage( img, patch[ 0 ] * W, patch[ 1 ] * H, ( patch[ 2 ] - patch[ 0 ] ) * W, ( patch[ 3 ] - patch[ 1 ] ) * H, fx, fy, TILE, TILE );
			const m = mean( fx, fy, 0, 0, 1, 1 );
			const k = new THREE.Color().fromArray( m );
			c.fillStyle = '#' + k.getHexString( THREE.SRGBColorSpace );
			c.fillRect( fx, fy - TILE, TILE, TILE );
			c.drawImage( img, crop[ 0 ] * W, crop[ 1 ] * H, ( crop[ 2 ] - crop[ 0 ] ) * W, ( crop[ 3 ] - crop[ 1 ] ) * H, fx, fy - TILE, TILE, TILE );
			tiles.clothes.push( { t: FABRIC_ROW + i, file, part: 'top', dir: 'fronts', front: true, mean: m, own: true } );

		} catch ( e ) {

			console.warn( 'people: texture missing', 'fronts', file );

		}

	} ) );

	if ( manifest ) await Promise.all( Object.keys( tiles ).flatMap( kind => ( manifest[ kind ] || [] ).map( async entry => {

		const { file, sex, part } = typeof entry === 'string' ? { file: entry } : entry;
		try {

			const img = new Image();
			img.src = `models/people/${kind}/${file}`;
			await img.decode();
			let info = null;
			const t = place( ( x, y ) => {

				c.drawImage( img, x, y, TILE, TILE );
				if ( kind === 'faces' ) {

					const cheeks = mean( x, y, 0.22, 0.55, 0.32, 0.68 ).map( ( v, i ) => ( v + mean( x, y, 0.68, 0.55, 0.78, 0.68 )[ i ] ) / 2 );
					info = { skin: cheeks, hair: mean( x, y, 0.3, 0, 0.7, 0.05 ) };

				} else info = { mean: mean( x, y, 0, 0, 1, 1 ), own: true }; // a photo of hair, cloth or skin in its own colours

			} );
			if ( t >= 0 ) tiles[ kind ].push( { t, file, sex, part, ...info } );

		} catch ( e ) {

			console.warn( 'people: texture missing', kind, file );

		}

	} ) ) );

	// Same order on every load, whatever order the images arrived in.
	for ( const list of Object.values( tiles ) ) list.sort( ( a, b ) => a.file < b.file ? - 1 : 1 );

	// Without photos, a drawn pixel face.
	if ( ! tiles.faces.length ) tiles.faces.push( { t: place( ( x, y ) => drawFace( c, x, y, 0 ) ) } );

	// ?texturetest: a few drawn fabrics and faces to check the textured path without any images.
	if ( new URLSearchParams( location.search ).has( 'texturetest' ) ) {

		tiles.faces.push( { t: place( ( x, y ) => drawFace( c, x, y, 1 ) ) }, { t: place( ( x, y ) => drawFace( c, x, y, 3 ) ) } );
		tiles.clothes.push( ...[ place( ( x, y ) => {

			// Plaid.
			c.fillStyle = '#ffffff';
			c.fillRect( x, y, TILE, TILE );
			c.fillStyle = 'rgba(0,0,0,0.35)';
			for ( let k = 0; k < TILE; k += 32 ) {

				c.fillRect( x + k, y, 10, TILE );
				c.fillRect( x, y + k, TILE, 10 );

			}

		} ), place( ( x, y ) => {

			// Stripes.
			for ( let k = 0; k < TILE; k += 16 ) {

				c.fillStyle = k % 32 ? '#ffffff' : '#30343c';
				c.fillRect( x, y + k, TILE, 16 );

			}

		} ) ].map( t => ( { t } ) ) );
		tiles.heads.push( { t: place( ( x, y ) => {

			// Hair: dark strands on white (tinted by the hair colour).
			c.fillStyle = '#ffffff';
			c.fillRect( x, y, TILE, TILE );
			c.fillStyle = 'rgba(0,0,0,0.3)';
			for ( let k = 0; k < TILE; k += 8 ) c.fillRect( x + k, y, 3, TILE );

		} ) } );

	}

	const map = new THREE.CanvasTexture( canvas );
	map.colorSpace = THREE.SRGBColorSpace;
	map.magFilter = map.minFilter = THREE.NearestFilter;
	map.generateMipmaps = false;
	map.flipY = false;
	return { map, tiles };

}

// The wardrobe without the textures the art direction left out of the streets (art.exclude: file names by kind);
// a kind left with nothing keeps all of its textures.
export function allowed( tiles ) {

	const out = {};
	for ( const [ kind, list ] of Object.entries( tiles ) ) {

		const no = new Set( ART.exclude?.[ kind ] || [] ), kept = list.filter( x => ! no.has( x.file ) );
		out[ kind ] = kept.length ? kept : list;

	}

	return out;

}

// The material: modelled colour, flat colour, or a tinted atlas tile, per slot. `look( k )` is the look of slot
// k + 1 (a per-vertex or a per-instance attribute).
function lookMaterial( wardrobe, look ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.9, metalness: 0 } );
	const slot = attribute( 'slot', 'float' );
	let l = null;
	for ( let k = 0; k < 5; k ++ ) {

		const lk = look( k );
		l = l ? select( slot.sub( k + 1 ).abs().lessThan( 0.5 ), lk, l ) : lk;

	}

	const base = attribute( 'color', 'vec3' );
	const mode = select( slot.lessThan( 0.5 ), float( 0 ), l.w );
	// The chest (slot 6, dressed like the top) is one picture from collar to hem: its UVs run 0…1 once, and a garment
	// front's fabric tile swaps for the front itself there.
	const chest = slot.greaterThan( 5.5 );
	const t0 = mode.sub( 2 ).max( 0 ).round();
	const t = select( chest.and( t0.greaterThanEqual( FABRIC_ROW ) ), t0.sub( GRID ), t0 );
	const cell = vec2( t.mod( GRID ), t.div( GRID ).floor() );
	const local = select( chest, uv(), uv().fract() ).clamp( 0.004, 0.996 );
	const tex = texture( wardrobe.map, cell.add( local ).div( GRID ) ).rgb.mul( l.xyz );
	const colour = select( mode.lessThan( 0.5 ), base, select( mode.lessThan( 1.5 ), l.xyz, tex ) );
	m.colorNode = colour;
	if ( PS1 ) {

		// Quantised in display (gamma) space, so the dark clothes keep their steps too (0 levels: not cut).
		const n = BODY_LEVELS.max( 1 );
		m.colorNode = select( BODY_LEVELS.greaterThan( 0 ), pow( pow( colour.max( 0 ), float( 1 / 2.2 ) ).mul( n ).round().div( n ), float( 2.2 ) ), colour );
		m.flatShading = FLAT;
		m.vertexNode = snapVertex();

	}

	return m;

}

let SKINNED = null, INSTANCED = null;
export function useWardrobe( wardrobe ) {

	SKINNED = lookMaterial( wardrobe, () => attribute( 'look', 'vec4' ) );
	INSTANCED = lookMaterial( wardrobe, k => attribute( LOOKS[ k ], 'vec4' ) );

}

// The art direction's people settings: { headFacets, headScale, flat, bodyLevels }. Levels and flat shading change
// the materials at once; the head's facets and size apply to bodies prepared after this (prepareBody).
export function applyArt( art ) {

	if ( art.headFacets !== undefined ) HEAD.facets = Math.max( 3, Math.round( art.headFacets ) );
	if ( art.headScale !== undefined ) HEAD.scale = art.headScale;
	if ( art.bodyLevels !== undefined ) BODY_LEVELS.value = art.bodyLevels;
	if ( art.flat !== undefined && PS1 && art.flat !== FLAT ) {

		FLAT = art.flat;
		for ( const m of [ SKINNED, INSTANCED ] ) if ( m ) {

			m.flatShading = FLAT;
			m.needsUpdate = true;

		}

	}

}

// ---------------------------------------------------------------------------
// Geometry helpers

// Slot of one part (a skinned primitive) from its material and mesh names. The animated bodies name their materials
// for what they are (Shirt, Pants); the modular ones name them by colour, so there the part decides: the biggest
// material on the body is the top, on the legs the bottom.
function slotOf( mat, part, biggest, animated ) {

	if ( /^Skin/.test( mat ) ) return SLOT.skin;
	if ( /HairTie/.test( mat ) ) return SLOT.keep;
	if ( /Hair|Eyebrows|Moustache/.test( mat ) ) return SLOT.hair;
	if ( /Eye|Earrings|Gold|Metal|Visor|Details|Tie|Socks|Shoes/.test( mat ) ) return SLOT.keep;
	if ( animated ) {

		if ( mat === 'Pants' ) return SLOT.bottom;
		if ( mat === 'Dress' || mat === 'Jacket' || ( mat === 'Shirt' && ! biggest.jacket ) ) return SLOT.top;
		return SLOT.keep;

	}

	if ( /_Body/.test( part ) && biggest.Body === mat ) return SLOT.top;
	if ( /_(Legs|Pants)/.test( part ) && biggest.Legs === mat ) return SLOT.bottom;
	return SLOT.keep;

}

// Box-projected UVs, one tile per `metre` model units: each vertex projected along its normal's main axis.
function boxUV( position, normal, metre ) {

	const n = position.length / 3, out = new Float32Array( n * 2 ), s = 1 / ( 0.5 * metre );
	for ( let i = 0; i < n; i ++ ) {

		const x = position[ i * 3 ], y = position[ i * 3 + 1 ], z = position[ i * 3 + 2 ];
		const ax = Math.abs( normal[ i * 3 ] ), ay = Math.abs( normal[ i * 3 + 1 ] ), az = Math.abs( normal[ i * 3 + 2 ] );
		const [ u, v ] = ay > ax && ay > az ? [ x, z ] : ax > az ? [ z, y ] : [ x, y ];
		out[ i * 2 ] = u * s;
		out[ i * 2 + 1 ] = 1 - v * s;

	}

	return out;

}

// A box head: corners from `toBody( local )` (a box from `min` to `max` in some local frame), the face on the side
// whose normal points most along +z in body space. Returns arrays to append; UVs 0…1 per side (v down, the
// atlas is drawn top-down), the face upright and not mirrored.
function headBox( min, max, toBody ) {

	const pos = [], nor = [], uvs = [], slot = [], index = [];
	const P = new THREE.Vector3(), O = toBody( new THREE.Vector3() );
	const axes = [ 0, 1, 2 ].map( i => toBody( new THREE.Vector3().setComponent( i, 1 ) ).sub( O ).normalize() );
	let front = null, best = - 2;
	for ( let i = 0; i < 3; i ++ ) for ( const s of [ - 1, 1 ] ) if ( axes[ i ].z * s > best ) {

		best = axes[ i ].z * s;
		front = [ i, s ];

	}

	for ( let i = 0; i < 3; i ++ ) for ( const s of [ - 1, 1 ] ) {

		const j = ( i + 1 ) % 3, k = ( i + 2 ) % 3, base = pos.length / 3;
		const corners = [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ].map( ( [ a, b ] ) => {

			const l = new THREE.Vector3();
			l.setComponent( i, s > 0 ? max.getComponent( i ) : min.getComponent( i ) );
			l.setComponent( j, a ? max.getComponent( j ) : min.getComponent( j ) );
			l.setComponent( k, b ? max.getComponent( k ) : min.getComponent( k ) );
			return toBody( l );

		} );

		const n = axes[ i ].clone().multiplyScalar( s );
		const isFront = i === front[ 0 ] && s === front[ 1 ];
		// UV axes in body space: right as seen from outside (+x for the face), and down.
		const down = new THREE.Vector3( 0, - 1, 0 ), right = Math.abs( n.y ) > 0.7 ? new THREE.Vector3( 1, 0, 0 ) : new THREE.Vector3().crossVectors( n, down ).negate().normalize();
		if ( Math.abs( n.y ) > 0.7 ) down.set( 0, 0, n.y > 0 ? 1 : - 1 );
		const us = corners.map( c => c.dot( right ) ), vs = corners.map( c => c.dot( down ) );
		const u0 = Math.min( ...us ), u1 = Math.max( ...us ), v0 = Math.min( ...vs ), v1 = Math.max( ...vs );
		corners.forEach( ( c, m ) => {

			pos.push( c.x, c.y, c.z );
			nor.push( n.x, n.y, n.z );
			uvs.push( ( us[ m ] - u0 ) / ( u1 - u0 ), ( vs[ m ] - v0 ) / ( v1 - v0 ) );
			slot.push( isFront ? SLOT.face : SLOT.hair );

		} );

		// Wind outwards.
		P.subVectors( corners[ 1 ], corners[ 0 ] ).cross( new THREE.Vector3().subVectors( corners[ 2 ], corners[ 0 ] ) );
		if ( P.dot( n ) > 0 ) index.push( base, base + 1, base + 2, base, base + 2, base + 3 );
		else index.push( base, base + 2, base + 1, base, base + 3, base + 2 );

	}

	return { pos, nor, uvs, slot, index };

}

// ---------------------------------------------------------------------------
// Body shapes
//
// Nobody on the street is built like the models: a person's shape is a sum of displacements of the body's rest
// pose, one per knob (SHAPE, each about −1 … 1, 0 as modelled), weighted by the knob. Rigged bodies move the
// vertices before the skinning, so the walk, the idle and the sitting clips bend the new shape at the old joints;
// that is enough for a belly, a big head or long shins, and nothing in the animation has to change. Skinned people
// get their own positions (computed once, when they come near); the instanced ones carry the first knobs as morph
// targets on their shared pose, weighted per instance.

export const SHAPE = [ 'fat', 'belly', 'hips', 'head', 'hunch', 'shoulders', 'legs', 'torso', 'arms', 'neck', 'tilt', 'lumps' ];
// The knobs the instanced (far, seated, posed) people have: what still shows from a distance or sitting down.
const INSTANCED_SHAPE = 5;

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};
const ramp = ( a, b, x ) => Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );

// A small random displacement for a point, the same for every vertex there (so seams don't open).
function lump( x, y, z, out ) {

	let h = Math.imul( Math.round( x * 400 ), 73856093 ) ^ Math.imul( Math.round( y * 400 ), 19349663 ) ^ Math.imul( Math.round( z * 400 ), 83492791 );
	for ( let k = 0; k < 3; k ++ ) {

		h = Math.imul( h ^ ( h >>> 15 ), 2246822507 );
		h = Math.imul( h ^ ( h >>> 13 ), 3266489909 );
		h ^= h >>> 16;
		out[ k ] = ( h >>> 0 ) / 4294967296 * 2 - 1;

	}

	return out;

}

// Which part of the body a bone moves.
function region( name ) {

	name = name.replace( /[_.]/g, '' );
	if ( /^Abdomen/.test( name ) ) return 'belly';
	if ( /^(Torso|Chest|Shoulder)/.test( name ) ) return 'chest';
	if ( /^Neck/.test( name ) ) return 'neck';
	if ( /^Head/.test( name ) ) return 'head';
	if ( /^UpperArm/.test( name ) ) return 'arm';
	if ( /^LowerArm/.test( name ) ) return 'forearm';
	if ( /^(Palm|Wrist|MiddleHand|Fingers|Thumb|Index|Middle|Ring|Pinky)/.test( name ) ) return 'hand';
	if ( /^UpperLeg/.test( name ) ) return 'thigh';
	if ( /^LowerLeg/.test( name ) ) return 'shin';
	if ( /^Foot/.test( name ) ) return 'foot';
	return 'hips';

}

// The displacements of a rigged body (positions in the body's frame: y up, facing +z, feet on y ≈ 0), one
// Float32Array per SHAPE knob. `joint( name )` is a bone's rest position in the same frame; `weights( i )` the
// vertex's weight per region; `head` the indices of the gem head's vertices.
function rigShapes( position, weights, joint, head ) {

	const n = position.length / 3, out = SHAPE.map( () => new Float32Array( n * 3 ) );
	let top = - Infinity, bottom = Infinity;
	for ( let i = 0; i < n; i ++ ) {

		top = Math.max( top, position[ i * 3 + 1 ] );
		bottom = Math.min( bottom, position[ i * 3 + 1 ] );

	}

	const H = top - bottom;
	const mid = ( a, b ) => a && b ? a.clone().add( b ).multiplyScalar( 0.5 ) : a || b;
	const legL = joint( 'UpperLegL' ), legR = joint( 'UpperLegR' ), kneeL = joint( 'LowerLegL' ), kneeR = joint( 'LowerLegR' );
	const armL = joint( 'UpperArmL' ), armR = joint( 'UpperArmR' ), elbowL = joint( 'LowerArmL' ), elbowR = joint( 'LowerArmR' );
	const handL = joint( 'PalmL' ) || joint( 'WristL' ), handR = joint( 'PalmR' ) || joint( 'WristR' );
	const yLeg = mid( legL, legR ).y, yKnee = mid( kneeL, kneeR ).y, yShoulder = mid( armL, armR ).y;
	const neck = joint( 'Neck' ), yNeck = neck.y, xLeg = Math.abs( legL.x - legR.x ) / 2, xShoulder = Math.abs( armL.x - armR.x ) / 2;
	const headTop = top;

	// The spine's depth (z) and the head's centre, from the vertices.
	let zc = 0, zn = 0;
	const hc = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		const w = weights( i );
		if ( w.belly + w.chest > 0.5 ) {

			zc += position[ i * 3 + 2 ];
			zn ++;

		}

	}

	zc /= Math.max( 1, zn );
	for ( const i of head ) hc.x += position[ i * 3 ] / head.length, hc.y += position[ i * 3 + 1 ] / head.length, hc.z += position[ i * 3 + 2 ] / head.length;
	if ( ! head.length ) hc.copy( joint( 'Head' ) );

	// Distance from a point to a line (a limb), as the vector from the line out to the point.
	const v = new THREE.Vector3(), p = new THREE.Vector3(), radial = ( a, b, target ) => {

		const d = p.subVectors( b, a ).normalize();
		target.subVectors( v, a );
		return target.addScaledVector( d, - target.dot( d ) );

	};

	const r = new THREE.Vector3(), q = [ 0, 0, 0 ];
	const yB = yLeg + 0.3 * ( yNeck - yLeg ), sB = 0.17 * ( yNeck - yLeg ), yPivot = yLeg + 0.5 * ( yShoulder - yLeg );
	for ( let i = 0; i < n; i ++ ) {

		v.fromArray( position, i * 3 );
		const w = weights( i ), x = v.x, y = v.y, z = v.z, side = x >= 0 ? 1 : - 1;
		const left = ( legL.x >= 0 ) === ( x >= 0 );
		const trunk = w.hips + w.belly + w.chest, leg = w.thigh + w.shin + w.foot, arm = w.arm + w.forearm + w.hand, up = 1 - leg;
		const set = ( k, dx, dy, dz ) => {

			out[ k ][ i * 3 ] += dx;
			out[ k ][ i * 3 + 1 ] += dy;
			out[ k ][ i * 3 + 2 ] += dz;

		};

		// fat: thicker round the spine, the thighs, the arms and the neck; arms and legs pushed out to keep clear.
		const t = trunk * ( 1 - 0.6 * smooth( yShoulder - 0.03 * H, yNeck, y ) );
		set( 0, x * 0.45 * t, 0, ( z - zc ) * 0.45 * t );
		if ( w.thigh + w.shin > 0 ) {

			radial( left ? legL : legR, left ? kneeL : kneeR, r );
			r.multiplyScalar( 0.4 * w.thigh + 0.2 * w.shin );
			set( 0, r.x, r.y, r.z );

		}

		if ( w.arm + w.forearm > 0 ) {

			const sl = ( armL.x >= 0 ) === ( x >= 0 );
			radial( sl ? armL : armR, sl ? elbowL : elbowR, r );
			r.multiplyScalar( 0.35 * w.arm + 0.15 * w.forearm );
			set( 0, r.x, r.y, r.z );

		}

		set( 0, side * ( 0.25 * xShoulder * arm + 0.3 * xLeg * leg ) + x * 0.35 * w.neck, 0, ( z - zc ) * 0.35 * w.neck );

		// belly: forward (and a little sideways) round the navel.
		const g = Math.exp( - ( ( ( y - yB ) / sB ) ** 2 ) ) * ( w.belly + w.hips + w.chest );
		set( 1, x * 0.25 * g, 0, 0.1 * H * g * ramp( 0, 0.06 * H, z - zc ) );

		// hips: wider at the hip joints, a bigger seat behind.
		const g2 = Math.exp( - ( ( ( y - yLeg ) / ( 0.1 * H ) ) ** 2 ) ) * ( trunk + w.thigh );
		set( 2, x * 0.35 * g2 + side * 0.15 * xLeg * leg, 0, - 0.05 * H * g2 * ramp( 0, 0.05 * H, zc - z ) );

		// head: the gem bigger or smaller about its centre.
		if ( w.head > 0.99 ) set( 3, ( x - hc.x ) * 0.35, ( y - hc.y ) * 0.35, ( z - hc.z ) * 0.35 );

		// hunch: the upper back bent forward over the chest, the head pushed forward and down; the arms hang from the
		// shoulders, so they move as the shoulders do.
		const yy = y * ( 1 - arm ) + yShoulder * arm;
		const a = Math.max( 0, yy - yPivot ) / ( headTop - yPivot ) * up;
		set( 4, 0, - 0.03 * H * a - 0.02 * H * w.head, 0.1 * H * a ** 1.5 + 0.04 * H * w.head );

		// shoulders: the arms further out, the chest wider under them.
		set( 5, side * 0.03 * H * arm + x * 0.3 * smooth( yShoulder - 0.15 * H, yShoulder, y ) * trunk, 0, 0 );

		// legs: longer thighs; everything above the hips rises with them, the feet stay on the ground.
		set( 6, 0, 0.07 * H * ( leg * ramp( yKnee, yLeg, y ) + up ), 0 );

		// torso: longer between the hips and the shoulders.
		set( 7, 0, 0.06 * H * ( trunk * ramp( yLeg, yShoulder, y ) + arm + w.neck + w.head ), 0 );

		// arms: longer forearms and hands, along the arm.
		if ( w.forearm + w.hand > 0 ) {

			const sl = ( armL.x >= 0 ) === ( x >= 0 ), e = sl ? elbowL : elbowR, h = sl ? handL : handR;
			if ( e && h ) {

				const d = p.subVectors( h, e ), len = d.length();
				d.normalize();
				const f = w.hand + w.forearm * ramp( 0, len, r.subVectors( v, e ).dot( d ) );
				set( 8, d.x * 0.06 * H * f, d.y * 0.06 * H * f, d.z * 0.06 * H * f );

			}

		}

		// neck: the head on a longer neck (or sunk into the shoulders).
		set( 9, 0, 0.04 * H * ( w.head + w.neck * ramp( yNeck, hc.y, y ) ), 0 );

		// tilt: one shoulder higher, the head leaning to the low side.
		const b = smooth( yPivot, yShoulder, yy ) * up;
		set( 10, - 0.02 * H * w.head, 0.035 * H * b * ( arm > 0.5 ? side : Math.max( - 1, Math.min( 1, x / xShoulder ) ) ), 0 );

		// lumps: hand-made wonkiness, a centimetre or two anywhere.
		lump( x, y, z, q );
		set( 11, q[ 0 ] * 0.012 * H, q[ 1 ] * 0.012 * H, q[ 2 ] * 0.012 * H );

	}

	return { H, deltas: out, top: out.map( d => {

		// How much taller each knob makes the body: the rise of its highest point.
		let best = 0, at = - Infinity;
		for ( let i = 0; i < n; i ++ ) if ( position[ i * 3 + 1 ] > at ) {

			at = position[ i * 3 + 1 ];
			best = d[ i * 3 + 1 ];

		}

		return best;

	} ) };

}

// The same knobs, roughly, for a body without bones (the posed humans): `head` are the head box's vertices; the
// figure is upright from the hips up in every pose.
function poseShapes( position, head, height ) {

	const n = position.length / 3, out = SHAPE.map( () => new Float32Array( n * 3 ) ), H = height;
	const hc = new THREE.Vector3(), q = [ 0, 0, 0 ];
	let neck = Infinity;
	for ( const i of head ) {

		hc.x += position[ i * 3 ] / head.length;
		hc.y += position[ i * 3 + 1 ] / head.length;
		hc.z += position[ i * 3 + 2 ] / head.length;
		neck = Math.min( neck, position[ i * 3 + 1 ] );

	}

	const isHead = new Uint8Array( n );
	for ( const i of head ) isHead[ i ] = 1;
	const yLeg = neck - 0.36 * H, yB = neck - 0.25 * H;
	for ( let i = 0; i < n; i ++ ) {

		const x = position[ i * 3 ], y = position[ i * 3 + 1 ], z = position[ i * 3 + 2 ];
		const set = ( k, dx, dy, dz ) => {

			out[ k ][ i * 3 ] += dx;
			out[ k ][ i * 3 + 1 ] += dy;
			out[ k ][ i * 3 + 2 ] += dz;

		};

		if ( isHead[ i ] ) {

			set( 3, ( x - hc.x ) * 0.35, ( y - hc.y ) * 0.35, ( z - hc.z ) * 0.35 );
			set( 4, 0, - 0.02 * H, 0.06 * H );
			set( 9, 0, 0.04 * H, 0 );

		} else {

			const t = smooth( yLeg - 0.2 * H, yLeg, y ) * ( 1 - smooth( neck - 0.06 * H, neck, y ) );
			set( 0, ( x - hc.x ) * 0.4 * t, 0, ( z - hc.z ) * 0.4 * t );
			const g = Math.exp( - ( ( ( y - yB ) / ( 0.08 * H ) ) ** 2 ) );
			set( 1, ( x - hc.x ) * 0.2 * g, 0, 0.1 * H * g * ramp( 0, 0.06 * H, z - hc.z ) );
			const g2 = Math.exp( - ( ( ( y - yLeg ) / ( 0.1 * H ) ) ** 2 ) );
			set( 2, ( x - hc.x ) * 0.35 * g2, 0, - 0.05 * H * g2 * ramp( 0, 0.05 * H, hc.z - z ) );
			const a = smooth( yB, neck, y );
			set( 4, 0, - 0.03 * H * a, 0.08 * H * a );

		}

		lump( x, y, z, q );
		set( 11, q[ 0 ] * 0.012 * H, q[ 1 ] * 0.012 * H, q[ 2 ] * 0.012 * H );

	}

	return { H, deltas: out, top: out.map( () => 0 ) };

}

// The shape knobs as a list of weights (SHAPE order) from { fat, belly, … }.
export function shapeWeights( shape = {} ) {

	return SHAPE.map( k => shape[ k ] || 0 );

}

// Positions of a body in a shape: the rest positions plus the weighted displacements.
function shaped( base, shapes, w ) {

	const out = new Float32Array( base );
	shapes.deltas.forEach( ( d, k ) => {

		if ( w[ k ] ) for ( let i = 0; i < out.length; i ++ ) out[ i ] += d[ i ] * w[ k ];

	} );
	return out;

}

// A static geometry's morph targets for the instanced people: the first knobs' displacements.
function morphs( geometry, deltas ) {

	geometry.morphAttributes.position = deltas.slice( 0, INSTANCED_SHAPE ).map( d => new THREE.BufferAttribute( d, 3 ) );
	geometry.morphTargetsRelative = true;
	return geometry;

}

// ---------------------------------------------------------------------------
// Skinned bodies

// Merges a loaded character's skinned primitives into one SkinnedMesh on the first primitive's skeleton, and swaps
// the head (every triangle carried by the head bone alone) for a box on that bone.
function mergeBody( gltf, spec ) {

	const root = gltf.scene;
	root.updateMatrixWorld( true );
	const prims = [];
	root.traverse( o => o.isSkinnedMesh && prims.push( o ) );
	const skeleton = prims[ 0 ].skeleton;
	const headBone = skeleton.bones.findIndex( b => b.name === 'Head' );

	// The biggest material per body part (modular characters) and whether there's a jacket (animated ones).
	const biggest = { jacket: prims.some( p => p.material.name === 'Jacket' ) };
	for ( const key of [ 'Body', 'Legs' ] ) {

		let best = 0;
		for ( const p of prims ) {

			const n = p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
			if ( new RegExp( `_${key === 'Legs' ? '(Legs|Pants)' : key}` ).test( p.name + ' ' + p.parent.name ) && ! /^Skin/.test( p.material.name ) && n > best ) {

				best = n;
				biggest[ key ] = p.material.name;

			}

		}

	}

	const position = [], normal = [], color = [], slot = [], skinIndex = [], skinWeight = [], index = [], dominant = [];
	const W = prims[ 0 ].matrixWorld.clone(), Winv = W.clone().invert();
	const v = new THREE.Vector3(), n = new THREE.Vector3(), M = new THREE.Matrix4(), N = new THREE.Matrix3();
	for ( const p of prims ) {

		// Into the first skeleton's bind space, then into the character's frame (y up, facing +z; the meshes hang
		// under the armature's z-up node): per-skin inverse bind matrices may differ by a constant (quantisation).
		M.copy( W ).multiply( skeleton.boneInverses[ 0 ].clone().invert() ).multiply( p.skeleton.boneInverses[ p.skeleton.bones.indexOf( skeleton.bones[ 0 ] ) ] ).multiply( p.bindMatrix );
		N.getNormalMatrix( M );
		const g = p.geometry, a = g.attributes, s = slotOf( p.material.name, p.name + ' ' + p.parent.name, biggest, spec.animated );
		const c = p.material.color, vo = position.length / 3;
		for ( let i = 0; i < a.position.count; i ++ ) {

			v.fromBufferAttribute( a.position, i ).applyMatrix4( M );
			n.fromBufferAttribute( a.normal, i ).applyMatrix3( N ).normalize();
			position.push( v.x, v.y, v.z );
			normal.push( n.x, n.y, n.z );
			color.push( c.r, c.g, c.b );
			slot.push( s );
			let dw = 0, db = - 1;
			for ( let k = 0; k < 4; k ++ ) {

				// Bones by identity: each primitive's skeleton lists the same bones, maybe in another order.
				const b = skeleton.bones.indexOf( p.skeleton.bones[ a.skinIndex.getComponent( i, k ) ] ), w = a.skinWeight.getComponent( i, k );
				skinIndex.push( b );
				skinWeight.push( w );
				if ( w > dw ) {

					dw = w;
					db = b;

				}

			}

			dominant.push( db === headBone && dw > 0.5 );

		}

		const count = g.index ? g.index.count : a.position.count;
		for ( let i = 0; i < count; i += 3 ) {

			const t = [ 0, 1, 2 ].map( k => vo + ( g.index ? g.index.getX( i + k ) : i + k ) );
			if ( BLOCK_HEADS && t.every( k => dominant[ k ] ) ) continue;
			index.push( ...t );

		}

	}

	// The head: a coarse faceted gem (by default 6 sides, 4 rings) a size too big, PS1 style, with the photo face
	// stretched straight on over its front half and hair on the rest; carried by the head bone. Sides and size are the
	// art direction's (HEAD).
	const headUV = [], head = [];
	if ( BLOCK_HEADS && headBone >= 0 ) {

		const inv = skeleton.boneInverses[ headBone ].clone().multiply( Winv ), toBody = inv.clone().invert();
		const box = new THREE.Box3();
		for ( let i = 0; i < dominant.length; i ++ ) if ( dominant[ i ] ) box.expandByPoint( v.fromArray( position, i * 3 ).applyMatrix4( inv ) );
		const size = box.getSize( new THREE.Vector3() ), mid = box.getCenter( new THREE.Vector3() );
		const gem = new THREE.SphereGeometry( 0.5, HEAD.facets, Math.max( 2, Math.round( HEAD.facets * 2 / 3 ) ) ).toNonIndexed();
		const g = gem.attributes.position, P = new THREE.Vector3(), out = [], hs = HEAD.scale;
		for ( let k = 0; k < g.count; k ++ ) out.push( P.set( g.getX( k ) * size.x * 1.15 * hs, g.getY( k ) * size.y * 1.1 * hs, g.getZ( k ) * size.z * 1.15 * hs ).add( mid ).applyMatrix4( toBody ).clone() );
		const bb = new THREE.Box3().setFromPoints( out ), vo = position.length / 3;
		const A = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();
		for ( let k = 0; k < out.length; k += 3 ) {

			N.crossVectors( A.subVectors( out[ k + 1 ], out[ k ] ), B.subVectors( out[ k + 2 ], out[ k ] ) ).normalize();
			if ( N.dot( P.subVectors( out[ k ], bb.getCenter( new THREE.Vector3() ) ) ) < 0 ) N.negate();
			const face = N.z > 0.15;
			for ( let m = 0; m < 3; m ++ ) {

				const q = out[ k + m ];
				position.push( q.x, q.y, q.z );
				normal.push( N.x, N.y, N.z );
				slot.push( face ? SLOT.face : SLOT.hair );
				color.push( 1, 1, 1 );
				skinIndex.push( headBone, 0, 0, 0 );
				skinWeight.push( 1, 0, 0, 0 );
				head.push( vo + k + m );
				headUV.push( vo + k + m, ( q.x - bb.min.x ) / ( bb.max.x - bb.min.x ), ( bb.max.y - q.y ) / ( bb.max.y - bb.min.y ) );

			}

			const flip = N.dot( P.crossVectors( A.subVectors( out[ k + 1 ], out[ k ] ), B.subVectors( out[ k + 2 ], out[ k ] ) ) ) < 0;
			index.push( vo + k, vo + k + ( flip ? 2 : 1 ), vo + k + ( flip ? 1 : 2 ) );

		}

	}

	// Bones' rest positions in the body's frame, and each vertex's weight per part of the body.
	const joints = {};
	skeleton.bones.forEach( ( b, k ) => joints[ b.name.replace( /[_.]/g, '' ) ] = new THREE.Vector3().applyMatrix4( W.clone().multiply( skeleton.boneInverses[ k ].clone().invert() ) ) );
	const regions = skeleton.bones.map( b => region( b.name ) );
	const weights = i => {

		const w = { hips: 0, belly: 0, chest: 0, neck: 0, head: 0, arm: 0, forearm: 0, hand: 0, thigh: 0, shin: 0, foot: 0 };
		for ( let k = 0; k < 4; k ++ ) w[ regions[ skinIndex[ i * 4 + k ] ] ] += skinWeight[ i * 4 + k ];
		return w;

	};

	// The chest: the top's triangles facing forward between the hips and the shoulders, given vertices of their own
	// (slot 6) with UVs straight across the front, collar at the top, hem at the bottom.
	const chestUV = [];
	{

		const yLeg = ( joints.UpperLegL.y + joints.UpperLegR.y ) / 2, yShoulder = ( joints.UpperArmL.y + joints.UpperArmR.y ) / 2;
		const xs = Math.abs( joints.UpperArmL.x - joints.UpperArmR.x ) / 2 * 1.05;
		const top = yShoulder + 0.08 * ( yShoulder - yLeg ), bottom = yLeg - 0.05 * ( yShoulder - yLeg );
		const C = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), Nt = new THREE.Vector3();
		const copies = new Map();
		for ( let t = 0; t < index.length; t += 3 ) {

			const [ a, b, c ] = [ index[ t ], index[ t + 1 ], index[ t + 2 ] ];
			if ( slot[ a ] !== SLOT.top || slot[ b ] !== SLOT.top || slot[ c ] !== SLOT.top ) continue;
			C.fromArray( position, a * 3 ).add( v.fromArray( position, b * 3 ) ).add( v.fromArray( position, c * 3 ) ).divideScalar( 3 );
			A.fromArray( position, b * 3 ).sub( v.fromArray( position, a * 3 ) );
			B.fromArray( position, c * 3 ).sub( v.fromArray( position, a * 3 ) );
			Nt.crossVectors( A, B ).normalize();
			if ( Nt.z < 0.35 || C.y < bottom || C.y > top || Math.abs( C.x ) > xs ) continue;
			const w = weights( a );
			if ( w.hips + w.belly + w.chest < 0.5 ) continue;
			for ( let m = 0; m < 3; m ++ ) {

				const o = index[ t + m ];
				if ( ! copies.has( o ) ) {

					const k = position.length / 3;
					position.push( position[ o * 3 ], position[ o * 3 + 1 ], position[ o * 3 + 2 ] );
					normal.push( normal[ o * 3 ], normal[ o * 3 + 1 ], normal[ o * 3 + 2 ] );
					color.push( color[ o * 3 ], color[ o * 3 + 1 ], color[ o * 3 + 2 ] );
					slot.push( SLOT.chest );
					for ( let j = 0; j < 4; j ++ ) {

						skinIndex.push( skinIndex[ o * 4 + j ] );
						skinWeight.push( skinWeight[ o * 4 + j ] );

					}

					chestUV.push( k, ( position[ o * 3 ] + xs ) / ( 2 * xs ), ( top - position[ o * 3 + 1 ] ) / ( top - bottom ) );
					copies.set( o, k );

				}

				index[ t + m ] = copies.get( o );

			}

		}

	}

	const geometry = new THREE.BufferGeometry();
	const P = new Float32Array( position ), Nn = new Float32Array( normal );
	geometry.setAttribute( 'position', new THREE.BufferAttribute( P, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( Nn, 3 ) );
	const UV = boxUV( P, Nn, 1 / 1.75 * ( new THREE.Box3().setFromArray( P ).getSize( v ).y ) );
	for ( let k = 0; k < headUV.length; k += 3 ) UV.set( [ headUV[ k + 1 ], headUV[ k + 2 ] ], headUV[ k ] * 2 );
	for ( let k = 0; k < chestUV.length; k += 3 ) UV.set( [ chestUV[ k + 1 ], chestUV[ k + 2 ] ], chestUV[ k ] * 2 );
	geometry.userData.shapes = rigShapes( P, weights, name => joints[ name ], head );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( UV, 2 ) );
	geometry.setAttribute( 'color', new THREE.BufferAttribute( new Float32Array( color ), 3 ) );
	geometry.setAttribute( 'slot', new THREE.BufferAttribute( new Float32Array( slot ), 1 ) );
	geometry.setAttribute( 'skinIndex', new THREE.BufferAttribute( new Uint16Array( skinIndex ), 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.BufferAttribute( new Float32Array( skinWeight ), 4 ) );
	geometry.setIndex( index );

	const mesh = new THREE.SkinnedMesh( geometry, SKINNED );
	mesh.name = 'body';
	mesh.frustumCulled = false;
	mesh.castShadow = true;
	for ( const p of prims ) p.removeFromParent();
	root.add( mesh );
	root.updateMatrixWorld( true );
	mesh.bind( skeleton, Winv );
	return mesh;

}

function findBone( root, name ) {

	let b = null;
	root.traverse( o => {

		if ( ! b && o.isBone && o.name.replace( /[_.]/g, '' ) === name ) b = o;

	} );
	return b;

}

// Positions of a skinned mesh in its current pose, as a static geometry (normals from the faces); with `shaped`, the
// shape knobs' displacements carried into the pose as morph targets.
function bake( mesh, shaped = true ) {

	const src = mesh.geometry, count = src.attributes.position.count, rest = src.attributes.position.array;
	const v = new THREE.Vector3();
	const pose = from => {

		const out = new Float32Array( count * 3 );
		for ( let i = 0; i < count; i ++ ) mesh.applyBoneTransform( i, v.fromArray( from, i * 3 ) ).applyMatrix4( mesh.matrixWorld ).toArray( out, i * 3 );
		return out;

	};

	const position = pose( rest );
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
	for ( const name of [ 'uv', 'color', 'slot' ] ) g.setAttribute( name, src.attributes[ name ] );
	g.setIndex( src.index );
	g.computeVertexNormals();
	if ( ! shaped ) return g;
	const deltas = src.userData.shapes.deltas.slice( 0, INSTANCED_SHAPE ).map( d => {

		const moved = new Float32Array( rest );
		for ( let i = 0; i < moved.length; i ++ ) moved[ i ] += d[ i ];
		const p = pose( moved );
		for ( let i = 0; i < p.length; i ++ ) p[ i ] -= position[ i ];
		return p;

	} );
	morphs( g, deltas );
	return g;

}

// One body ready to use: the template to clone, its clips, its height, natural walking speed, and baked poses.
export function prepareBody( gltf, spec ) {

	const mesh = mergeBody( gltf, spec );
	const root = gltf.scene;
	const clips = {};
	for ( const c of gltf.animations ) clips[ c.name ] = c;
	const mixer = new THREE.AnimationMixer( root );
	const v = new THREE.Vector3();
	root.updateMatrixWorld( true );
	const box = new THREE.Box3();
	for ( let i = 0; i < mesh.geometry.attributes.position.count; i += 2 ) box.expandByPoint( mesh.getVertexPosition( i, v ).applyMatrix4( mesh.matrixWorld ) );
	const height = box.max.y - box.min.y;

	// Walking speed the clip was animated for (model units per second): a foot moves back by one step length in
	// half a cycle while it's on the ground.
	const walk = clips.Walk, foot = findBone( root, 'FootL' );
	const act = mixer.clipAction( walk ).play();
	let z0 = Infinity, z1 = - Infinity;
	for ( let k = 0; k < 24; k ++ ) {

		mixer.setTime( walk.duration * k / 24 );
		root.updateMatrixWorld( true );
		foot.getWorldPosition( v );
		z0 = Math.min( z0, v.z );
		z1 = Math.max( z1, v.z );

	}

	const pace = 2 * ( z1 - z0 ) / walk.duration;

	// Mid-stride, for the instanced walkers further away (over 60 m: no shape but their width and height).
	mixer.setTime( walk.duration * 0.3 );
	root.updateMatrixWorld( true );
	const walking = bake( mesh, false );
	act.stop();

	// Sitting, for terrace and café chairs: the hips (joint) and the lowest point of the seat of the trousers.
	let sitting = null;
	if ( clips.Sitting ) {

		const sit = mixer.clipAction( clips.Sitting ).play();
		mixer.setTime( clips.Sitting.duration * 0.5 );
		root.updateMatrixWorld( true );
		const geometry = bake( mesh );
		const hips = findBone( root, 'Hips' ).getWorldPosition( new THREE.Vector3() );
		const p = geometry.attributes.position;
		let bottom = Infinity, at = 0;
		for ( let i = 0; i < p.count; i ++ ) {

			const y = p.getY( i ), z = p.getZ( i );
			if ( y > 0.1 * height && Math.abs( z - hips.z ) < 0.1 * height && y < bottom ) {

				bottom = y;
				at = i;

			}

		}

		// How the seat of the trousers moves with each knob (a big seat sits higher).
		const drop = geometry.morphAttributes.position.map( d => d.getY( at ) );
		sitting = { geometry, hipsZ: hips.z, bottom, drop };
		sit.stop();

	}

	mixer.stopAllAction();
	mixer.uncacheRoot( root );
	root.updateMatrixWorld( true );
	return { spec, root, clips, height, pace, walking, sitting, shapes: mesh.geometry.userData.shapes };

}

// The per-vertex look of one person on a body geometry.
export function lookAttribute( geometry, look ) {

	const slot = geometry.attributes.slot.array, out = new Float32Array( slot.length * 4 );
	for ( let i = 0; i < slot.length; i ++ ) if ( slot[ i ] > 0 ) out.set( look[ slot[ i ] === SLOT.chest ? 0 : slot[ i ] - 1 ], i * 4 );
	return new THREE.BufferAttribute( out, 4 );

}

// A body's height in a shape (in the units of body.height).
export function shapedHeight( body, shape ) {

	const w = shapeWeights( shape );
	return body.height * ( 1 + body.shapes.top.reduce( ( a, d, k ) => a + d * w[ k ], 0 ) / body.shapes.H );

}

// A skinned person: a clone of the body in their shape, scaled to their height (and `width` across), wearing their
// look, with a mixer.
export function makeSkinned( body, look, height, shape = null, width = 1 ) {

	const object = cloneSkinned( body.root );
	const s = height / shapedHeight( body, shape );
	object.scale.set( s * width, s, s * width );
	let mesh = null;
	object.traverse( o => {

		if ( o.isSkinnedMesh ) mesh = o;

	} );

	const src = body.root.getObjectByName( 'body' ).geometry;
	const geometry = new THREE.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight', 'slot' ] ) geometry.setAttribute( name, src.attributes[ name ] );
	geometry.setIndex( src.index );
	geometry.setAttribute( 'look', lookAttribute( src, look ) );
	if ( shape ) geometry.setAttribute( 'position', new THREE.BufferAttribute( shaped( src.attributes.position.array, body.shapes, shapeWeights( shape ) ), 3 ) );
	geometry.userData.shapes = body.shapes;
	mesh.geometry = geometry;
	mesh.material = SKINNED;
	mesh.frustumCulled = false;
	mesh.castShadow = true;

	return { object, mixer: new THREE.AnimationMixer( object ), scale: s };

}

// An instanced batch of one static geometry with per-instance looks.
export function makeBatch( geometry, count ) {

	const g = geometry.clone();
	for ( const name of LOOKS ) g.setAttribute( name, new THREE.InstancedBufferAttribute( new Float32Array( Math.max( 1, count ) * 4 ), 4 ) );
	const mesh = new THREE.InstancedMesh( g, INSTANCED, Math.max( 1, count ) );
	mesh.count = count;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.frustumCulled = false;
	mesh.setLook = ( i, look ) => LOOKS.forEach( ( name, k ) => g.attributes[ name ].array.set( look[ k ], i * 4 ) );
	// The shape knobs this pose has as morph targets, per instance.
	// (A batch of one reads the weights from the mesh, a bigger one from its morph texture; three's morph node
	// expects the mesh's own weights only in the first case.)
	const dummy = { morphTargetInfluences: [] };
	if ( g.morphAttributes.position && mesh.count <= 1 ) mesh.morphTargetInfluences = g.morphAttributes.position.map( () => 0 );
	mesh.setShape = ( i, shape ) => {

		if ( ! g.morphAttributes.position ) return;
		dummy.morphTargetInfluences = shapeWeights( shape ).slice( 0, g.morphAttributes.position.length );
		mesh.setMorphAt( i, dummy );
		if ( i === 0 && mesh.morphTargetInfluences ) mesh.morphTargetInfluences.splice( 0, Infinity, ...dummy.morphTargetInfluences );
		mesh.morphTexture.needsUpdate = true;

	};
	return mesh;

}

// ---------------------------------------------------------------------------
// Background Posed Humans: one body per pose, with a box head like the others.

export function preparePosed( gltf ) {

	gltf.scene.updateMatrixWorld( true );
	const meshes = {};
	gltf.scene.traverse( o => {

		if ( o.isMesh ) ( meshes[ o.parent !== gltf.scene && o.parent.name ? o.parent.name : o.name ] ||= [] ).push( o );

	} );

	// Standing height, for scale and for how big a head is.
	const standing = new THREE.Box3();
	for ( const m of meshes.Standing ) standing.expandByObject( m );
	const height = standing.max.y - standing.min.y;

	const build = parts => {

		const pos = [], color = [], slot = [], v = new THREE.Vector3();
		for ( const m of parts ) {

			const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
			const p = g.attributes.position;
			const s = { Skin: SLOT.skin, Shirt: SLOT.top, Pants: SLOT.bottom }[ m.material.name ] ?? SLOT.keep;
			for ( let i = 0; i < p.count; i ++ ) {

				v.fromBufferAttribute( p, i ).applyMatrix4( m.matrixWorld );
				pos.push( v.x, v.y, v.z );
				color.push( m.material.color.r, m.material.color.g, m.material.color.b );
				slot.push( s );

			}

		}

		// The head: skin triangles in the top 13 % of the figure, around the crown.
		let top = - Infinity;
		for ( let i = 1; i < pos.length; i += 3 ) top = Math.max( top, pos[ i ] );
		const head = new THREE.Box3(), keep = [];
		for ( let t = 0; t < pos.length / 9; t ++ ) {

			let inHead = true;
			for ( let k = 0; k < 3; k ++ ) if ( pos[ t * 9 + k * 3 + 1 ] < top - 0.13 * height || slot[ t * 3 + k ] !== SLOT.skin ) inHead = false;
			if ( inHead ) for ( let k = 0; k < 3; k ++ ) head.expandByPoint( v.fromArray( pos, t * 9 + k * 3 ) );
			else keep.push( t );

		}

		const P = [], C = [], S = [];
		for ( const t of keep ) for ( let k = 0; k < 3; k ++ ) {

			const i = t * 3 + k;
			P.push( pos[ i * 3 ], pos[ i * 3 + 1 ], pos[ i * 3 + 2 ] );
			C.push( color[ i * 3 ], color[ i * 3 + 1 ], color[ i * 3 + 2 ] );
			S.push( slot[ i ] );

		}

		const body = new THREE.BufferGeometry();
		body.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( P ), 3 ) );
		body.computeVertexNormals();
		const UV = boxUV( body.attributes.position.array, body.attributes.normal.array, height / 1.75 );

		// Square-ish box: as wide as deep, a little taller.
		const size = head.getSize( v ), c = head.getCenter( new THREE.Vector3() ), w = Math.max( size.x, size.z ) * 0.95;
		const hb = headBox( new THREE.Vector3( c.x - w / 2, head.min.y, c.z - w / 2 ), new THREE.Vector3( c.x + w / 2, head.max.y + 0.02 * height, c.z + w / 2 ), l => l );
		const hg = new THREE.BufferGeometry();
		hg.setAttribute( 'position', new THREE.Float32BufferAttribute( hb.pos, 3 ) );
		hg.setAttribute( 'uv', new THREE.Float32BufferAttribute( hb.uvs, 2 ) );
		hg.setAttribute( 'slot', new THREE.Float32BufferAttribute( hb.slot, 1 ) );
		hg.setIndex( hb.index );
		const h = hg.toNonIndexed();

		const g = new THREE.BufferGeometry();
		const cat = ( a, b ) => {

			const out = new Float32Array( a.length + b.length );
			out.set( a );
			out.set( b, a.length );
			return out;

		};

		g.setAttribute( 'position', new THREE.BufferAttribute( cat( P, h.attributes.position.array ), 3 ) );
		g.setAttribute( 'uv', new THREE.BufferAttribute( cat( UV, h.attributes.uv.array ), 2 ) );
		g.setAttribute( 'color', new THREE.BufferAttribute( cat( C, new Float32Array( h.attributes.slot.count * 3 ).fill( 1 ) ), 3 ) );
		g.setAttribute( 'slot', new THREE.BufferAttribute( cat( S, h.attributes.slot.array ), 1 ) );
		g.computeVertexNormals();
		g.computeBoundingBox();
		const first = P.length / 3, box = [];
		for ( let i = first; i < g.attributes.position.count; i ++ ) box.push( i );
		morphs( g, poseShapes( g.attributes.position.array, box, height ).deltas );
		return g;

	};

	const cache = new Map();
	const geometry = pose => {

		if ( ! cache.has( pose ) ) cache.set( pose, build( meshes[ pose ] ) );
		return cache.get( pose );

	};

	// The seated pose: the lowest point of the seat (the seat of the trousers, at the back of the figure).
	const seat = pose => {

		const g = geometry( pose ), p = g.attributes.position;
		let bottom = Infinity, z = 0, at = 0;
		for ( let i = 0; i < p.count; i ++ ) {

			const y = p.getY( i );
			if ( y > 0.12 * height && y < bottom && p.getZ( i ) < g.boundingBox.min.z + 0.08 * height ) {

				bottom = y;
				z = p.getZ( i );
				at = i;

			}

		}

		return { bottom, z, drop: g.morphAttributes.position.map( d => d.getY( at ) ) };

	};

	return { height, geometry, seat };

}
