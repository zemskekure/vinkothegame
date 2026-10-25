// People: Quaternius' low-poly characters (CC0; public/models/people/PROVENANCE.md), dressed late-90s style.
//   - Animated Men / Animated Women (2019): the main crowd; 31-bone rig, Walk / Idle / Run / Sitting.
//   - Ultimate Modular Men / Women (2022): more kinds of people (business, hoodie, worker, punk, beach, tourist with a
//     backpack); 62-bone rig, Walk / Idle / Run / Wave, no sitting.
//   - Background Posed Humans (2018): static people, standing about or sitting on benches.
//
// Every body becomes one geometry (all its parts and materials merged). Its modelled head is replaced by a box on
// the head bone, PS1 style, whose front carries a face texture. Each vertex has the modelled colour, box-projected
// UVs (one texture tile per 0.5 m) and a `slot`: 0 kept as modelled (eyes, shoes, ties), 1 top, 2 bottom, 3 hair
// (the head box's sides, back and top), 4 skin, 5 face (the box's front).
//
// A person ("look") is, per slot 1…5, [ r, g, b, mode ]: mode 0 keeps the modelled colour, 1 paints r g b, 2 + t
// paints tile t of the wardrobe atlas tinted by r g b. Skinned people near the camera carry their look in a
// per-person vertex attribute; instanced ones per instance. The wardrobe (public/models/people/manifest.json, low-
// resolution images by kind: faces, heads, clothes, skin) is packed into one nearest-filtered atlas; without any
// face photos a drawn pixel face stands in.

import * as THREE from 'three/webgpu';
import { attribute, select, texture, uv, vec2, float } from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const SLOT = { keep: 0, top: 1, bottom: 2, hair: 3, skin: 4, face: 5 };
const LOOKS = [ 'lookTop', 'lookBottom', 'lookHair', 'lookSkin', 'lookFace' ];
const BLOCK_HEADS = ! new URLSearchParams( location.search ).has( 'modelheads' ); // ?modelheads keeps the modelled heads

export const BODIES = [
	[ 'm', 'animated-men/longsleeve' ], [ 'm', 'animated-men/shirt' ], [ 'm', 'animated-men/casual' ], [ 'm', 'animated-men/suit' ],
	[ 'f', 'animated-women/jacket' ], [ 'f', 'animated-women/casual' ], [ 'f', 'animated-women/tanktop' ], [ 'f', 'animated-women/dress' ],
	[ 'm', 'modular-men/business' ], [ 'm', 'modular-men/hoodie' ], [ 'm', 'modular-men/casual' ], [ 'm', 'modular-men/worker' ],
	[ 'm', 'modular-men/punk' ], [ 'm', 'modular-men/beach' ], [ 'm', 'modular-men/adventurer' ], [ 'm', 'modular-men/farmer' ],
	[ 'f', 'modular-women/casual' ], [ 'f', 'modular-women/formal' ], [ 'f', 'modular-women/punk' ], [ 'f', 'modular-women/adventurer' ]
].map( ( [ sex, file ] ) => ( { sex, file, animated: file.startsWith( 'animated' ) } ) );

// What people in Prague wear on an ordinary day: mostly dark and muted, some colour. sRGB.
const TOPS = [ 0x1d1d20, 0x2b2c31, 0x3c3e44, 0x6d7076, 0xa3a5a8, 0xe6e3dc, 0xd8cfbd, 0x1f2a44, 0x2d3d5c, 0x4c6a8f,
	0x8fb0cf, 0x6b2230, 0xa33a32, 0xc4562f, 0xc89b2c, 0x5a5e3a, 0x2f4a3a, 0x3f6b5a, 0x8b8160, 0xa87b4f, 0x5a3e2b, 0xd49aa4, 0x7b4f7a ];
const BOTTOMS = [ 0x1a1a1c, 0x2a2b2f, 0x24324d, 0x34496b, 0x4f6a90, 0x6e86a8, 0x55575c, 0x8a8a86, 0xbcae8e, 0x8b7f5e,
	0x4c4f34, 0x4a3426, 0x6b5a48 ];
const HAIR = [ 0x16110e, 0x2a1d15, 0x3b281b, 0x5a3b24, 0x7a5434, 0xa78457, 0xcfb27c, 0x8c8a86, 0xc9c6c0, 0x6e2f1d ];
const SKIN = [ 0xf1d0b5, 0xeac2a1, 0xe3b38f, 0xd9a47e, 0xc98e66, 0xb97a55, 0x9a6244, 0x6e452f ];

const lin = hex => new THREE.Color().setHex( hex ); // converts sRGB to the linear working space
const pick = ( rnd, list ) => list[ Math.floor( rnd() * list.length ) ];

// ---------------------------------------------------------------------------
// The wardrobe: an atlas of low-resolution textures, nearest-filtered.

const TILE = 128, GRID = 16; // a 2048 px atlas of 128 px tiles

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

	if ( manifest ) await Promise.all( Object.keys( tiles ).flatMap( kind => ( manifest[ kind ] || [] ).map( async entry => {

		const { file, sex } = typeof entry === 'string' ? { file: entry } : entry;
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

				}

			} );
			if ( t >= 0 ) tiles[ kind ].push( { t, file, sex, ...info } );

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

// A person's look, see the top of the file. A photo face comes with its own skin and hair colours; tiles are
// { t, sex, skin, hair }.
export function dress( rnd, sex, wardrobe ) {

	const T = wardrobe.tiles;
	const paint = ( list, p, tiles = [], pt = 0 ) => {

		if ( rnd() > p ) return [ 0, 0, 0, 0 ];
		const k = lin( pick( rnd, list ) ).multiplyScalar( 0.9 + rnd() * 0.2 );
		if ( tiles.length && rnd() < pt ) return [ 1 - ( 1 - k.r ) * 0.5, 1 - ( 1 - k.g ) * 0.5, 1 - ( 1 - k.b ) * 0.5, 2 + pick( rnd, tiles ).t ];
		return [ k.r, k.g, k.b, 1 ];

	};

	const faces = T.faces.filter( f => ! f.sex || f.sex === sex ), face = pick( rnd, faces.length ? faces : T.faces );
	let skin, hair;
	if ( face.skin ) {

		skin = [ ...face.skin, 1 ];
		hair = [ ...face.hair, 1 ];

	} else {

		skin = paint( SKIN.slice( 0, rnd() < 0.85 ? 5 : 8 ), 1, T.skin, 0.5 );
		hair = rnd() < 0.15 ? [ ...lin( pick( rnd, HAIR.slice( 7, 9 ) ) ).toArray(), 1 ] : paint( HAIR, 1 );

	}

	if ( T.heads.length ) hair = [ ...hair.slice( 0, 3 ), 2 + pick( rnd, T.heads ).t ];
	// A photo face as it is; the drawn one in the skin colour.
	const look = face.skin ? [ 1, 1, 1, 2 + face.t ] : [ ...( skin[ 3 ] === 1 ? skin.slice( 0, 3 ) : lin( SKIN[ 2 ] ).toArray() ), 2 + face.t ];
	return [ paint( TOPS, 0.9, T.clothes, 0.35 ), paint( BOTTOMS, 0.75, T.clothes, 0.2 ), hair, skin, look ];

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
	const t = mode.sub( 2 ).max( 0 ).round();
	const cell = vec2( t.mod( GRID ), t.div( GRID ).floor() );
	const tex = texture( wardrobe.map, cell.add( uv().fract().clamp( 0.004, 0.996 ) ).div( GRID ) ).rgb.mul( l.xyz );
	m.colorNode = select( mode.lessThan( 0.5 ), base, select( mode.lessThan( 1.5 ), l.xyz, tex ) );
	return m;

}

let SKINNED = null, INSTANCED = null;
export function useWardrobe( wardrobe ) {

	SKINNED = lookMaterial( wardrobe, () => attribute( 'look', 'vec4' ) );
	INSTANCED = lookMaterial( wardrobe, k => attribute( LOOKS[ k ], 'vec4' ) );

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

	let headUV = null;
	// The box head: the dropped head's extent in the head bone's frame, a little slimmer than the hair was.
	if ( BLOCK_HEADS && headBone >= 0 ) {

		const inv = skeleton.boneInverses[ headBone ].clone().multiply( Winv ), toBody = inv.clone().invert();
		const box = new THREE.Box3();
		for ( let i = 0; i < dominant.length; i ++ ) if ( dominant[ i ] ) box.expandByPoint( v.fromArray( position, i * 3 ).applyMatrix4( inv ) );
		// A blocky head: no taller than 1.2 times its width, keeping the top where the crown was.
		const size = box.getSize( new THREE.Vector3() ).multiplyScalar( 0.88 ), mid = box.getCenter( new THREE.Vector3() );
		const up = new THREE.Vector3( 0, 1, 0 ).transformDirection( inv ), ax = [ 'x', 'y', 'z' ].reduce( ( a, b ) => Math.abs( up[ b ] ) > Math.abs( up[ a ] ) ? b : a );
		const width = Math.max( ...[ 'x', 'y', 'z' ].filter( k => k !== ax ).map( k => size[ k ] ) ), tall = Math.min( size[ ax ], 1.2 * width );
		mid[ ax ] += Math.sign( up[ ax ] ) * ( size[ ax ] - tall ) / 2;
		size[ ax ] = tall;
		box.setFromCenterAndSize( mid, size );
		const h = headBox( box.min, box.max, l => l.applyMatrix4( toBody ) );
		const vo = position.length / 3;
		position.push( ...h.pos );
		normal.push( ...h.nor );
		slot.push( ...h.slot );
		for ( let i = 0; i < h.slot.length; i ++ ) {

			color.push( 1, 1, 1 );
			skinIndex.push( headBone, 0, 0, 0 );
			skinWeight.push( 1, 0, 0, 0 );

		}

		index.push( ...h.index.map( i => i + vo ) );
		headUV = { from: vo, uvs: h.uvs }; // replaces the box projection there

	}

	const geometry = new THREE.BufferGeometry();
	const P = new Float32Array( position ), Nn = new Float32Array( normal );
	geometry.setAttribute( 'position', new THREE.BufferAttribute( P, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( Nn, 3 ) );
	const UV = boxUV( P, Nn, 1 / 1.75 * ( new THREE.Box3().setFromArray( P ).getSize( v ).y ) );
	if ( headUV ) UV.set( headUV.uvs, headUV.from * 2 );
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

// Positions of a skinned mesh in its current pose, as a static geometry (normals from the faces).
function bake( mesh ) {

	const src = mesh.geometry, count = src.attributes.position.count;
	const position = new Float32Array( count * 3 ), v = new THREE.Vector3();
	for ( let i = 0; i < count; i ++ ) mesh.getVertexPosition( i, v ).applyMatrix4( mesh.matrixWorld ).toArray( position, i * 3 );
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
	for ( const name of [ 'uv', 'color', 'slot' ] ) g.setAttribute( name, src.attributes[ name ] );
	g.setIndex( src.index );
	g.computeVertexNormals();
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

	// Mid-stride, for the instanced walkers further away.
	mixer.setTime( walk.duration * 0.3 );
	root.updateMatrixWorld( true );
	const walking = bake( mesh );
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
		let bottom = Infinity;
		for ( let i = 0; i < p.count; i ++ ) {

			const y = p.getY( i ), z = p.getZ( i );
			if ( y > 0.1 * height && Math.abs( z - hips.z ) < 0.1 * height ) bottom = Math.min( bottom, y );

		}

		sitting = { geometry, hipsZ: hips.z, bottom };
		sit.stop();

	}

	mixer.stopAllAction();
	mixer.uncacheRoot( root );
	root.updateMatrixWorld( true );
	return { spec, root, clips, height, pace, walking, sitting };

}

// The per-vertex look of one person on a body geometry.
function lookAttribute( geometry, look ) {

	const slot = geometry.attributes.slot.array, out = new Float32Array( slot.length * 4 );
	for ( let i = 0; i < slot.length; i ++ ) if ( slot[ i ] > 0 ) out.set( look[ slot[ i ] - 1 ], i * 4 );
	return new THREE.BufferAttribute( out, 4 );

}

// A skinned person: a clone of the body, scaled to their height, wearing their look, with a mixer.
export function makeSkinned( body, look, height ) {

	const object = cloneSkinned( body.root );
	const s = height / body.height;
	object.scale.setScalar( s );
	let mesh = null;
	object.traverse( o => {

		if ( o.isSkinnedMesh ) mesh = o;

	} );

	const src = body.root.getObjectByName( 'body' ).geometry;
	const geometry = new THREE.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight', 'slot' ] ) geometry.setAttribute( name, src.attributes[ name ] );
	geometry.setIndex( src.index );
	geometry.setAttribute( 'look', lookAttribute( src, look ) );
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
		let bottom = Infinity, z = 0;
		for ( let i = 0; i < p.count; i ++ ) {

			const y = p.getY( i );
			if ( y > 0.12 * height && y < bottom && p.getZ( i ) < g.boundingBox.min.z + 0.08 * height ) {

				bottom = y;
				z = p.getZ( i );

			}

		}

		return { bottom, z };

	};

	return { height, geometry, seat };

}
