// Shared building blocks for the hand-modelled places (src/places.js, src/venues.js): materials and procedural
// patterns, bottom-anchored primitives, a per-material geometry merger, a frame on a house front, text textures.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, positionLocal, mix, float, vec2, floor, fract, abs, max, min, smoothstep, atan, length, step } from 'three/tsl';
import { hash2D, noise2D } from './shading/common.js';

// ---------------------------------------------------------------------------
// Materials

// The sun, late afternoon from the south-west (scene frame: +x east, +z south; azimuth from +z towards +x).
export const SUN = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 55 ), THREE.MathUtils.degToRad( 315 ) );

export const plain = ( hex, opts = {} ) => new THREE.MeshStandardNodeMaterial( { color: hex, roughness: 0.8, ...opts } );
export const glow = ( hex, intensity = 1.5 ) => new THREE.MeshStandardNodeMaterial( { color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4 } );

export const M = {
	iron: plain( 0x1f2321, { metalness: 0.6, roughness: 0.45 } ),
	gold: plain( 0xc9a046, { metalness: 0.9, roughness: 0.3 } ),
	brass: plain( 0xb08a3e, { metalness: 0.8, roughness: 0.35 } ),
	chrome: plain( 0xd8dcdf, { metalness: 1, roughness: 0.18 } ),
	woodDark: plain( 0x4a2f1f, { roughness: 0.6 } ),
	woodMid: plain( 0x7a5235, { roughness: 0.6 } ),
	woodLight: plain( 0xb48a5e, { roughness: 0.6 } ),
	marble: plain( 0xeeebe4, { roughness: 0.25 } ),
	black: plain( 0x1c1c1c, { roughness: 0.5 } ),
	velvet: plain( 0x6e1f2b, { roughness: 0.9 } ),
	bottle: plain( 0x1f3d26, { roughness: 0.15, metalness: 0.2 } ),
	beer: plain( 0xd9a032, { roughness: 0.2, emissive: 0x3a2400 } ),
	foam: plain( 0xf6f1e4, { roughness: 0.9 } ),
	cream: plain( 0xefe6d0, { roughness: 0.85 } ),
	leaf: plain( 0x4e7a34, { roughness: 0.9, flatShading: true } ),
	pot: plain( 0x9a5a3c, { roughness: 0.9 } ),
	darkGlass: plain( 0x1d2a33, { roughness: 0.1, metalness: 0.3 } ),
	bulb: glow( 0xffd9a0, 2.2 ),
	lampShade: glow( 0xffe2b0, 1.2 )
};

// Rough rubble masonry (the rotunda): irregular courses of grey-brown stones in light mortar.
export function rubbleStone() {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.95 } );
	const p = positionLocal;
	const around = atan( p.x, p.z ).mul( length( p.xz ) ); // arc length around the drum
	const course = p.y.div( 0.34 );
	const row = floor( course );
	const along = around.div( mix( float( 0.38 ), float( 0.62 ), hash2D( vec2( row, 3.1 ) ) ) ).add( hash2D( vec2( row, 7.7 ) ) );
	const cell = vec2( floor( along ), row );
	const fx = fract( along ), fy = fract( course.add( hash2D( cell ).sub( 0.5 ).mul( 0.25 ) ) );
	const joint = max( smoothstep( 0.42, 0.5, abs( fx.sub( 0.5 ) ) ), smoothstep( 0.4, 0.5, abs( fy.sub( 0.5 ) ) ) );
	const tone = mix( color( 0x7f776b ), color( 0xa69c8b ), hash2D( cell.add( 0.37 ) ) ).mul( mix( float( 0.85 ), float( 1.08 ), noise2D( vec2( around, p.y ).mul( 1.7 ) ) ) );
	m.colorNode = mix( tone, color( 0xc4bba9 ), joint.mul( 0.7 ) );
	return m;

}

// Clay roof tiles in rows down the slope (by height), each tile a slightly different red.
export function roofTiles( base = 0xa4513a ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.8 } );
	const p = positionLocal;
	const row = floor( p.y.div( 0.16 ) );
	const around = atan( p.x, p.z ).mul( 24 ).add( row.mul( 0.5 ) );
	const cell = vec2( floor( around ), row );
	const shadow = smoothstep( 0.0, 0.25, fract( p.y.div( 0.16 ) ) );
	m.colorNode = color( base ).mul( mix( float( 0.78 ), float( 1.12 ), hash2D( cell ) ) ).mul( mix( float( 0.7 ), float( 1 ), shadow ) );
	return m;

}

// Dressed stone blocks (portals, stairs walls): courses 0.45 m, blocks 0.9 m, in local coordinates.
export function ashlar( a = 0xb3aa98, b = 0xc8bfad ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } );
	const p = positionLocal;
	const course = p.y.div( 0.45 );
	const along = p.x.add( p.z ).div( 0.9 ).add( floor( course ).mul( 0.5 ) );
	const joint = max( smoothstep( 0.45, 0.5, abs( fract( course ).sub( 0.5 ) ) ), smoothstep( 0.46, 0.5, abs( fract( along ).sub( 0.5 ) ) ) );
	m.colorNode = mix( mix( color( a ), color( b ), hash2D( vec2( floor( along ), floor( course ) ) ) ), color( 0x7d766a ), joint.mul( 0.5 ) );
	return m;

}

// Floors: planks along x, or square tiles in two colours.
export function planks( a, b ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.55 } );
	const p = positionLocal;
	const board = floor( p.z.div( 0.16 ) );
	const seg = floor( p.x.div( 1.6 ).add( hash2D( vec2( board, 1.3 ) ) ) );
	const gap = smoothstep( 0.44, 0.5, abs( fract( p.z.div( 0.16 ) ).sub( 0.5 ) ) );
	m.colorNode = mix( mix( color( a ), color( b ), hash2D( vec2( board, seg ) ) ), color( 0x1e140c ), gap.mul( 0.6 ) );
	return m;

}

export function tiles( a, b, size ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.35 } );
	const p = positionLocal;
	const cx = floor( p.x.div( size ) ), cz = floor( p.z.div( size ) );
	const checker = fract( cx.add( cz ).mul( 0.5 ) ).mul( 2 );
	const grout = max( smoothstep( 0.45, 0.5, abs( fract( p.x.div( size ) ).sub( 0.5 ) ) ), smoothstep( 0.45, 0.5, abs( fract( p.z.div( size ) ).sub( 0.5 ) ) ) );
	m.colorNode = mix( mix( color( a ), color( b ), checker ), color( 0x5c5a55 ), grout.mul( 0.5 ) );
	return m;

}

// Walls: plaster above, wood panelling (or a darker band) below `dado` m.
export function roomWall( upper, lower, dado ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.85 } );
	const p = positionLocal;
	const panel = step( p.y, dado );
	const stile = smoothstep( 0.46, 0.5, abs( fract( p.x.add( p.z ).div( 0.6 ) ).sub( 0.5 ) ) ).mul( panel );
	m.colorNode = mix( mix( color( upper ), color( lower ), panel ), color( lower ).mul( 0.6 ), stile.add( smoothstep( dado - 0.06, dado, p.y ).mul( panel ).mul( 0.8 ) ).min( 1 ) );
	return m;

}

// ---------------------------------------------------------------------------
// Geometry helpers (bottom-anchored boxes and cylinders)

export const box = ( w, h, d, x = 0, y = 0, z = 0 ) => new THREE.BoxGeometry( w, h, d ).translate( x, y + h / 2, z );
export const cyl = ( r0, r1, h, x = 0, y = 0, z = 0, seg = 14 ) => new THREE.CylinderGeometry( r0, r1, h, seg ).translate( x, y + h / 2, z );
export const ball = ( r, x, y, z, seg = 10 ) => new THREE.SphereGeometry( r, seg, Math.max( 4, seg >> 1 ) ).translate( x, y, z );

// Collects geometries per material, merged into one mesh each.
export class Kit {

	constructor() {

		this.parts = new Map();

	}

	add( material, ...geometries ) {

		if ( ! this.parts.has( material ) ) this.parts.set( material, [] );
		for ( const g of geometries ) this.parts.get( material ).push( g.index ? g.toNonIndexed() : g );
		return this;

	}

	build( parent, { shadows = true } = {} ) {

		for ( const [ material, list ] of this.parts ) {

			for ( const g of list ) for ( const name of Object.keys( g.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( name ) ) g.deleteAttribute( name );
			const mesh = new THREE.Mesh( mergeGeometries( list ), material );
			mesh.castShadow = shadows;
			mesh.receiveShadow = true;
			parent.add( mesh );

		}

		return parent;

	}

}

// A group standing on a house front: x along the front (to the right seen from the street), y up, z out of the wall.
export function onFront( x, y, z, n ) {

	const g = new THREE.Group();
	const X = new THREE.Vector3( n[ 1 ], 0, - n[ 0 ] ), Y = new THREE.Vector3( 0, 1, 0 ), Z = new THREE.Vector3( n[ 0 ], 0, n[ 1 ] );
	g.matrix.makeBasis( X, Y, Z ).setPosition( x, y, z );
	g.matrixAutoUpdate = false;
	g.matrixWorldNeedsUpdate = true;
	return g;

}

// Text on a canvas, as a texture.
export function textTexture( lines, { w = 1024, h = 256, bg, ink, font = 'Georgia, serif', weight = '700', border, spacing = 0 } ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );
	if ( bg ) {

		ctx.fillStyle = bg;
		ctx.fillRect( 0, 0, w, h );

	}

	if ( border ) {

		ctx.strokeStyle = border;
		ctx.lineWidth = h * 0.04;
		ctx.strokeRect( h * 0.06, h * 0.06, w - h * 0.12, h * 0.12 > 0 ? h - h * 0.12 : h );

	}

	ctx.fillStyle = ink;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	if ( 'letterSpacing' in ctx ) ctx.letterSpacing = `${spacing}px`;
	lines.forEach( ( [ text, size, y ], i ) => {

		ctx.font = `${weight} ${size}px ${font}`;
		let s = size;
		while ( ctx.measureText( text ).width > w * 0.9 && s > 10 ) ctx.font = `${weight} ${s -= 4}px ${font}`;
		ctx.fillText( text, w / 2, y ?? h / 2 );

	} );

	const tex = new THREE.CanvasTexture( canvas );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;

}

export const board = ( tex, w, h, opts = {} ) => new THREE.Mesh( new THREE.PlaneGeometry( w, h ), new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.6, transparent: !! opts.transparent, ...opts.material } ) );

