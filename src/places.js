// Signature places, positioned at build time by tools/places.mjs:
//   Rotunda sv. Kříže Menšího · Hostinec U Rotundy · Standard Café · Champagneria (walk-in rooms behind real doors,
//   outdoor seating, signs, festoon lights over Průchodní) · the gate of Náprstkovo muzeum · the chimney courtyard
//   in Náprstkova · the stairs from Národní down to Divadelní.
// Stylised rather than realistic: simple solids, flat colours and a few procedural patterns (stone, tiles, wood).

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, positionLocal, mix, float, vec2, floor, fract, abs, max, min, smoothstep, atan, length, step } from 'three/tsl';
import { hash2D, noise2D } from './shading/common.js';

// ---------------------------------------------------------------------------
// Materials

const plain = ( hex, opts = {} ) => new THREE.MeshStandardNodeMaterial( { color: hex, roughness: 0.8, ...opts } );
const glow = ( hex, intensity = 1.5 ) => new THREE.MeshStandardNodeMaterial( { color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.4 } );

const M = {
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
function rubbleStone() {

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
function roofTiles( base = 0xa4513a ) {

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
function ashlar( a = 0xb3aa98, b = 0xc8bfad ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } );
	const p = positionLocal;
	const course = p.y.div( 0.45 );
	const along = p.x.add( p.z ).div( 0.9 ).add( floor( course ).mul( 0.5 ) );
	const joint = max( smoothstep( 0.45, 0.5, abs( fract( course ).sub( 0.5 ) ) ), smoothstep( 0.46, 0.5, abs( fract( along ).sub( 0.5 ) ) ) );
	m.colorNode = mix( mix( color( a ), color( b ), hash2D( vec2( floor( along ), floor( course ) ) ) ), color( 0x7d766a ), joint.mul( 0.5 ) );
	return m;

}

// Floors: planks along x, or square tiles in two colours.
function planks( a, b ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.55 } );
	const p = positionLocal;
	const board = floor( p.z.div( 0.16 ) );
	const seg = floor( p.x.div( 1.6 ).add( hash2D( vec2( board, 1.3 ) ) ) );
	const gap = smoothstep( 0.44, 0.5, abs( fract( p.z.div( 0.16 ) ).sub( 0.5 ) ) );
	m.colorNode = mix( mix( color( a ), color( b ), hash2D( vec2( board, seg ) ) ), color( 0x1e140c ), gap.mul( 0.6 ) );
	return m;

}

function tiles( a, b, size ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.35 } );
	const p = positionLocal;
	const cx = floor( p.x.div( size ) ), cz = floor( p.z.div( size ) );
	const checker = fract( cx.add( cz ).mul( 0.5 ) ).mul( 2 );
	const grout = max( smoothstep( 0.45, 0.5, abs( fract( p.x.div( size ) ).sub( 0.5 ) ) ), smoothstep( 0.45, 0.5, abs( fract( p.z.div( size ) ).sub( 0.5 ) ) ) );
	m.colorNode = mix( mix( color( a ), color( b ), checker ), color( 0x5c5a55 ), grout.mul( 0.5 ) );
	return m;

}

// Walls: plaster above, wood panelling (or a darker band) below `dado` m.
function roomWall( upper, lower, dado ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.85 } );
	const p = positionLocal;
	const panel = step( p.y, dado );
	const stile = smoothstep( 0.46, 0.5, abs( fract( p.x.add( p.z ).div( 0.6 ) ).sub( 0.5 ) ) ).mul( panel );
	m.colorNode = mix( mix( color( upper ), color( lower ), panel ), color( lower ).mul( 0.6 ), stile.add( smoothstep( dado - 0.06, dado, p.y ).mul( panel ).mul( 0.8 ) ).min( 1 ) );
	return m;

}

// ---------------------------------------------------------------------------
// Geometry helpers (bottom-anchored boxes and cylinders)

const box = ( w, h, d, x = 0, y = 0, z = 0 ) => new THREE.BoxGeometry( w, h, d ).translate( x, y + h / 2, z );
const cyl = ( r0, r1, h, x = 0, y = 0, z = 0, seg = 14 ) => new THREE.CylinderGeometry( r0, r1, h, seg ).translate( x, y + h / 2, z );
const ball = ( r, x, y, z, seg = 10 ) => new THREE.SphereGeometry( r, seg, Math.max( 4, seg >> 1 ) ).translate( x, y, z );

// Collects geometries per material, merged into one mesh each.
class Kit {

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
function onFront( x, y, z, n ) {

	const g = new THREE.Group();
	const X = new THREE.Vector3( n[ 1 ], 0, - n[ 0 ] ), Y = new THREE.Vector3( 0, 1, 0 ), Z = new THREE.Vector3( n[ 0 ], 0, n[ 1 ] );
	g.matrix.makeBasis( X, Y, Z ).setPosition( x, y, z );
	g.matrixAutoUpdate = false;
	g.matrixWorldNeedsUpdate = true;
	return g;

}

// Text on a canvas, as a texture.
function textTexture( lines, { w = 1024, h = 256, bg, ink, font = 'Georgia, serif', weight = '700', border, spacing = 0 } ) {

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

const board = ( tex, w, h, opts = {} ) => new THREE.Mesh( new THREE.PlaneGeometry( w, h ), new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.6, transparent: !! opts.transparent, ...opts.material } ) );

// ---------------------------------------------------------------------------
// Rotunda sv. Kříže Menšího: round nave of rubble stone, semicircular apse, red tiled cone roof with a round
// lantern (arched openings, its own little cone), a cross on top; the wrought-iron fence around it.

function addRotunda( scene, R ) {

	const g = new THREE.Group();
	g.position.set( R.x, R.y - 0.3, R.z );
	scene.add( g );
	const kit = new Kit();
	const stone = rubbleStone(), tile = roofTiles(), tileDark = roofTiles( 0x93452f );
	const r = R.r, H = 7.6;
	const dirA = Math.atan2( R.dir[ 0 ], R.dir[ 1 ] ); // towards the apse

	kit.add( stone, new THREE.CylinderGeometry( r, r + 0.08, H, 64, 1, true ).translate( 0, H / 2, 0 ) );
	kit.add( ashlar(), new THREE.CylinderGeometry( r + 0.16, r + 0.16, 0.28, 64 ).translate( 0, H - 0.1, 0 ) );
	const roofH = 3.4, roofR = r + 0.4;
	kit.add( tile, new THREE.ConeGeometry( roofR, roofH, 64, 1, true ).translate( 0, H + 0.04 + roofH / 2, 0 ) );

	// Lantern drum where the cone has narrowed to its radius, with arched openings all round.
	const lr = 1.15, lh = 2.1, ly = H + roofH * ( 1 - lr / roofR ) - 0.2;
	kit.add( stone, new THREE.CylinderGeometry( lr, lr, lh, 32 ).translate( 0, ly + lh / 2, 0 ) );
	for ( let k = 0; k < 8; k ++ ) {

		const a = k * Math.PI / 4;
		const o = new THREE.BoxGeometry( 0.32, 0.8, 0.2 ).translate( 0, ly + 1.1, lr - 0.05 ).rotateY( a );
		const top = new THREE.CylinderGeometry( 0.16, 0.16, 0.2, 10, 1, false, 0, Math.PI ).rotateZ( Math.PI / 2 ).rotateY( Math.PI / 2 ).translate( 0, ly + 1.5, lr - 0.05 ).rotateY( a );
		kit.add( M.black, o, top );

	}

	kit.add( tileDark, new THREE.ConeGeometry( lr + 0.3, 1.5, 32, 1, true ).translate( 0, ly + lh + 0.75, 0 ) );
	kit.add( M.gold, ball( 0.12, 0, ly + lh + 1.6, 0 ), box( 0.06, 0.9, 0.06, 0, ly + lh + 1.6 ), box( 0.5, 0.06, 0.06, 0, ly + lh + 2.2 ) );

	// Narrow arched windows; the door opposite the apse.
	for ( const off of [ Math.PI * 0.55, - Math.PI * 0.55, Math.PI * 0.25 ] ) {

		const a = dirA + Math.PI + off;
		kit.add( M.black, new THREE.BoxGeometry( 0.3, 1.0, 0.24 ).translate( 0, 4.6, r - 0.06 ).rotateY( a ) );
		kit.add( M.black, new THREE.CylinderGeometry( 0.15, 0.15, 0.24, 10, 1, false, 0, Math.PI ).rotateZ( Math.PI / 2 ).rotateY( Math.PI / 2 ).translate( 0, 5.1, r - 0.06 ).rotateY( a ) );

	}

	const doorA = dirA + Math.PI;
	kit.add( ashlar(), new THREE.BoxGeometry( 1.9, 3.0, 0.4 ).translate( 0, 1.5, r - 0.05 ).rotateY( doorA ) );
	kit.add( M.woodDark, new THREE.BoxGeometry( 1.1, 2.2, 0.42 ).translate( 0, 1.1 + 0.3, r - 0.04 ).rotateY( doorA ) );
	kit.add( M.woodDark, new THREE.CylinderGeometry( 0.55, 0.55, 0.42, 16, 1, false, 0, Math.PI ).rotateZ( Math.PI / 2 ).rotateY( Math.PI / 2 ).translate( 0, 2.5 + 0.3, r - 0.04 ).rotateY( doorA ) );

	// Apse: half drum and half cone towards dirA.
	const ax = R.apse.x - R.x, az = R.apse.z - R.z, ar = R.apse.r - 0.1, AH = 5.0;
	const start = dirA - Math.PI / 2;
	kit.add( stone, new THREE.CylinderGeometry( ar, ar + 0.05, AH, 32, 1, true, start, Math.PI ).translate( ax, AH / 2, az ) );
	kit.add( tile, new THREE.ConeGeometry( ar + 0.3, 2.3, 32, 1, true, start, Math.PI ).translate( ax, AH + 1.15, az ) );
	kit.add( ashlar(), new THREE.CylinderGeometry( ar + 0.12, ar + 0.12, 0.22, 32, 1, false, start, Math.PI ).translate( ax, AH - 0.08, az ) );
	kit.add( M.black, new THREE.BoxGeometry( 0.26, 0.8, 0.24 ).translate( 0, 3.2, ar - 0.06 ).rotateY( dirA ).translate( ax, 0, az ) );

	// Fence: around the nave and apse, 1 m out, with a gap at the door.
	const ring = [];
	const N = 96;
	for ( let k = 0; k <= N; k ++ ) {

		const a = k / N * Math.PI * 2;
		const dx = Math.sin( a ), dz = Math.cos( a );
		let t = r;
		const dc = dx * ax + dz * az, disc = dc * dc - ( ax * ax + az * az ) + ( ar + 0.1 ) ** 2;
		if ( disc >= 0 ) t = Math.max( t, dc + Math.sqrt( disc ) );
		ring.push( [ dx * ( t + 1.0 ), dz * ( t + 1.0 ), a ] );

	}

	const gap = a => {

		let d = Math.abs( ( ( a - doorA ) % ( Math.PI * 2 ) + Math.PI * 3 ) % ( Math.PI * 2 ) - Math.PI );
		return d < 0.2;

	};

	const bars = [];
	for ( let k = 1; k < ring.length; k ++ ) {

		const [ x0, z0, a0 ] = ring[ k - 1 ], [ x1, z1 ] = ring[ k ];
		if ( gap( a0 ) ) continue;
		const len = Math.hypot( x1 - x0, z1 - z0 ), rot = Math.atan2( x1 - x0, z1 - z0 );
		const mid = [ ( x0 + x1 ) / 2, ( z0 + z1 ) / 2 ];
		kit.add( ashlar(), new THREE.BoxGeometry( 0.32, 0.45, len + 0.02 ).rotateY( rot ).translate( mid[ 0 ], 0.3 + 0.225, mid[ 1 ] ) );
		for ( const y of [ 0.95, 1.85 ] ) kit.add( M.iron, new THREE.BoxGeometry( 0.03, 0.04, len + 0.01 ).rotateY( rot ).translate( mid[ 0 ], 0.3 + y, mid[ 1 ] ) );
		const n = Math.max( 1, Math.round( len / 0.14 ) );
		for ( let i = 0; i < n; i ++ ) bars.push( [ x0 + ( x1 - x0 ) * ( i + 0.5 ) / n, z0 + ( z1 - z0 ) * ( i + 0.5 ) / n ] );
		if ( k % 8 === 0 ) kit.add( M.iron, box( 0.09, 1.75, 0.09, x0, 0.75, z0 ), ball( 0.07, x0, 0.3 + 2.0, z0, 8 ) );

	}

	kit.build( g );

	const barGeo = mergeGeometries( [ new THREE.CylinderGeometry( 0.012, 0.012, 1.5, 5 ).translate( 0, 0.75 + 0.75, 0 ), new THREE.ConeGeometry( 0.03, 0.14, 5 ).translate( 0, 1.5 + 0.75 + 0.07, 0 ) ] );
	const barMesh = new THREE.InstancedMesh( barGeo, M.iron, bars.length );
	const m = new THREE.Matrix4();
	bars.forEach( ( [ x, z ], i ) => barMesh.setMatrixAt( i, m.makeTranslation( x, 0, z ) ) );
	barMesh.castShadow = true;
	g.add( barMesh );

}

// ---------------------------------------------------------------------------
// Signs on house fronts

function addSign( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	scene.add( g );
	if ( s.style === 'beer' ) {

		// Round sign hanging from an iron bracket at right angles to the wall.
		const tex = textTexture( [ [ 'Pilsner', 120, 200 ], [ 'Urquell', 120, 330 ], [ 'PLZEŇ', 54, 430 ] ], { w: 512, h: 512, bg: null, ink: '#e9d9a6', font: 'Georgia, serif', weight: '700' } );
		const disc = new THREE.Mesh( new THREE.CircleGeometry( 0.48, 40 ), new THREE.MeshStandardNodeMaterial( { color: 0x1f4a2e, roughness: 0.6 } ) );
		const face = new THREE.Mesh( new THREE.CircleGeometry( 0.44, 40 ), new THREE.MeshStandardNodeMaterial( { map: tex, transparent: true, roughness: 0.6 } ) );
		const face2 = face.clone();
		face.position.z = 0.006;
		face2.position.z = - 0.006;
		face2.rotation.y = Math.PI;
		const sign = new THREE.Group().add( disc, face, face2 );
		sign.rotation.y = Math.PI / 2;
		sign.position.set( 0, - 0.55, 0.75 );
		disc.material.side = THREE.DoubleSide;
		g.add( sign );
		new Kit().add( M.iron, box( 0.04, 0.04, 1.2, 0, 0, 0.6 ), box( 0.02, 0.08, 0.02, 0, - 0.08, 0.75 ), box( 0.03, 0.5, 0.03, 0, - 0.5, 0.05 ).rotateX( 0.9 ).translate( 0, 0, 0.3 ) ).add( M.gold, new THREE.TorusGeometry( 0.48, 0.02, 6, 40 ).rotateY( Math.PI / 2 ).translate( 0, - 0.55, 0.75 ) ).build( g );
		return;

	}

	const styles = {
		pub: { lines: [ [ s.text, 150 ] ], bg: '#1e3b2b', ink: '#dcb65c', border: '#dcb65c', font: 'Georgia, serif', h: 0.62 },
		cafe: { lines: [ [ s.text, 150 ] ], bg: '#151515', ink: '#f2efe8', font: '"Helvetica Neue", Arial, sans-serif', weight: '300', spacing: 28, h: 0.5 },
		champagne: { lines: [ [ s.text, 140 ] ], bg: '#0f0f10', ink: '#d8b45e', border: '#d8b45e', font: 'Didot, "Bodoni 72", Georgia, serif', weight: '400', spacing: 16, h: 0.52 }
	};
	const st = styles[ s.style ];
	const w = Math.max( 1.8, s.text.length * st.h * 0.44 );
	const tex = textTexture( st.lines, { w: 1024, h: Math.round( 1024 * st.h / w ), bg: st.bg, ink: st.ink, border: st.border, font: st.font, weight: st.weight || '700', spacing: st.spacing || 0 } );
	const b = board( tex, w, st.h );
	b.position.z = 0.09;
	g.add( b );
	new Kit().add( s.style === 'champagne' ? M.gold : M.woodDark, box( w + 0.12, st.h + 0.12, 0.07, 0, - ( st.h + 0.12 ) / 2, 0.03 ) ).build( g );
	if ( s.style === 'champagne' || s.style === 'cafe' ) {

		// Little lamps over the board.
		const kit = new Kit();
		for ( const x of [ - w / 3, 0, w / 3 ] ) kit.add( M.iron, box( 0.02, 0.02, 0.35, x, st.h / 2 + 0.12, 0.2 ) ).add( M.lampShade, new THREE.ConeGeometry( 0.09, 0.12, 10, 1, true ).translate( x, st.h / 2 + 0.06, 0.37 ) );
		kit.build( g, { shadows: false } );

	}

}

// ---------------------------------------------------------------------------
// Furniture pieces (local: seat facing −z; table centred)

function chair( kit, x, y, z, rot, style ) {

	const parts = style === 'champagne'
		? [ [ M.velvet, box( 0.44, 0.08, 0.44, 0, 0.44, 0 ), box( 0.44, 0.5, 0.06, 0, 0.5, 0.2 ) ], [ M.gold, ...[ - 0.18, 0.18 ].flatMap( a => [ - 0.18, 0.18 ].map( b => cyl( 0.015, 0.015, 0.44, a, 0, b, 6 ) ) ) ] ]
		: style === 'cafe'
			? [ [ M.woodDark, cyl( 0.21, 0.21, 0.05, 0, 0.44, 0, 16 ), new THREE.TorusGeometry( 0.2, 0.018, 6, 16, Math.PI ).translate( 0, 0.72, 0.18 ).rotateX( - 0.1 ), ...[ - 0.15, 0.15 ].flatMap( a => [ - 0.15, 0.15 ].map( b => cyl( 0.015, 0.015, 0.44, a, 0, b, 6 ) ) ) ] ]
			: [ [ M.woodMid, box( 0.42, 0.05, 0.42, 0, 0.44, 0 ), box( 0.42, 0.45, 0.04, 0, 0.5, 0.19 ), ...[ - 0.18, 0.18 ].flatMap( a => [ - 0.18, 0.18 ].map( b => box( 0.04, 0.44, 0.04, a, 0, b ) ) ) ] ];
	for ( const [ mat, ...geos ] of parts ) kit.add( mat, ...geos.map( geo => geo.rotateY( rot ).translate( x, y, z ) ) );

}

function table( kit, x, y, z, style, { round = true, w = 0.7, d = 0.7, h = 0.75 } = {} ) {

	if ( style === 'pub' && ! round ) {

		kit.add( M.woodMid, box( w, 0.05, d, x, y + h - 0.05, z ) ).add( M.woodDark, ...[ - 1, 1 ].flatMap( a => [ - 1, 1 ].map( b => box( 0.06, h - 0.05, 0.06, x + a * ( w / 2 - 0.08 ), y, z + b * ( d / 2 - 0.08 ) ) ) ) );
		return;

	}

	const top = style === 'pub' ? M.woodMid : M.marble;
	const base = style === 'champagne' ? M.gold : M.iron;
	kit.add( top, cyl( w / 2, w / 2, 0.04, x, y + h - 0.04, z, 24 ) ).add( base, cyl( 0.03, 0.03, h - 0.04, x, y, z, 8 ), cyl( 0.22, 0.25, 0.03, x, y, z, 16 ) );

}

const mug = ( kit, x, y, z ) => kit.add( M.beer, cyl( 0.045, 0.045, 0.13, x, y, z, 10 ) ).add( M.foam, cyl( 0.047, 0.047, 0.03, x, y + 0.13, z, 10 ) );
const cup = ( kit, x, y, z ) => kit.add( M.cream, cyl( 0.04, 0.03, 0.06, x, y, z, 10 ), cyl( 0.07, 0.07, 0.01, x, y, z, 12 ) );
const bottleAt = ( kit, x, y, z ) => kit.add( M.bottle, cyl( 0.04, 0.04, 0.22, x, y, z, 8 ), cyl( 0.015, 0.04, 0.1, x, y + 0.22, z, 8 ) ).add( M.gold, cyl( 0.017, 0.017, 0.05, x, y + 0.31, z, 6 ) );
const plant = ( kit, x, y, z, s = 1 ) => kit.add( M.pot, cyl( 0.16 * s, 0.12 * s, 0.3 * s, x, y, z, 10 ) ).add( M.leaf, new THREE.IcosahedronGeometry( 0.32 * s, 0 ).scale( 1, 1.3, 1 ).translate( x, y + 0.62 * s, z ) );

// ---------------------------------------------------------------------------
// Walk-in rooms: the shell (floor, ceiling, walls, the front wall with the doorway), the open door, furniture by
// style, a warm light. Returns seats (scene frame) for the street-life module.

function addInterior( scene, room ) {

	const g = onFront( room.x, room.y, room.z, room.n );
	scene.add( g );
	g.updateMatrixWorld( true );
	const { w, d, h, door, doorW, doorH } = room;
	const kit = new Kit();
	const seats = [];
	const seat = ( x, z, rot ) => {

		const p = new THREE.Vector3( x, 0, z ).applyMatrix4( g.matrixWorld );
		const dir = new THREE.Vector3( Math.sin( rot ), 0, Math.cos( rot ) ).transformDirection( g.matrixWorld );
		// Chairs face −z: the sitter faces the chair's −z.
		seats.push( [ + p.x.toFixed( 2 ), + ( room.y ).toFixed( 2 ), + p.z.toFixed( 2 ), + Math.atan2( - dir.x, - dir.z ).toFixed( 3 ) ] );

	};

	const style = room.style;
	const look = {
		pub: { floor: tiles( 0x9a4a32, 0x7d3a28, 0.3 ), wall: roomWall( 0xd8c08e, 0x4a2f1f, 1.25 ), ceiling: plain( 0xcdb68a ), light: 0xffc27a },
		cafe: { floor: tiles( 0xeeeae2, 0x262626, 0.25 ), wall: roomWall( 0xece7dc, 0x9aa597, 0.9 ), ceiling: plain( 0xf2efe8 ), light: 0xffe0b8 },
		champagne: { floor: planks( 0x3b2618, 0x4d331f ), wall: roomWall( 0x1f3a33, 0x14231f, 1.1 ), ceiling: plain( 0x222222 ), light: 0xffd08a }
	}[ style ];

	// Shell. The front wall stands just inside the house front, with the doorway.
	const t = 0.08;
	kit.add( look.floor, box( w, 0.04, d, 0, - 0.04, - d / 2 ) );
	kit.add( look.ceiling, box( w, 0.04, d, 0, h, - d / 2 ) );
	kit.add( look.wall, box( w, h, t, 0, 0, - d ), box( t, h, d, - w / 2, 0, - d / 2 ), box( t, h, d, w / 2, 0, - d / 2 ) );
	const dl = door - doorW / 2, dr = door + doorW / 2;
	kit.add( look.wall, box( dl + w / 2, h, t, ( - w / 2 + dl ) / 2, 0, - 0.12 ), box( w / 2 - dr, h, t, ( dr + w / 2 ) / 2, 0, - 0.12 ), box( doorW, h - doorH, t, door, doorH, - 0.12 ) );
	// Door frame and the door leaf swung open into the room.
	kit.add( M.woodDark, box( 0.1, doorH, 0.3, dl - 0.05, 0, - 0.05 ), box( 0.1, doorH, 0.3, dr + 0.05, 0, - 0.05 ), box( doorW + 0.3, 0.12, 0.3, door, doorH, - 0.05 ) );
	kit.add( style === 'cafe' ? M.black : M.woodDark, new THREE.BoxGeometry( doorW - 0.05, doorH - 0.05, 0.05 ).translate( ( doorW - 0.05 ) / 2, ( doorH - 0.05 ) / 2, 0 ).rotateY( 1.45 ).translate( dl, 0, - 0.2 ) );
	kit.add( M.woodDark, box( doorW, 0.03, 0.6, door, - 0.02, 0.32 ) ); // step / mat outside

	if ( style === 'pub' ) {

		// Bar counter across the back with taps and a glass shelf; long tables with benches; beams; lamps.
		const bw = Math.min( w - 1.2, 3.6 );
		kit.add( M.woodDark, box( bw, 1.05, 0.6, w / 2 - bw / 2 - 0.3, 0, - d + 1.1 ) ).add( M.woodMid, box( bw + 0.1, 0.05, 0.7, w / 2 - bw / 2 - 0.3, 1.05, - d + 1.1 ) );
		for ( let k = 0; k < 3; k ++ ) kit.add( M.chrome, cyl( 0.03, 0.03, 0.4, w / 2 - 0.9 - k * 0.35, 1.1, - d + 1.0, 8 ), box( 0.12, 0.03, 0.03, w / 2 - 0.9 - k * 0.35, 1.48, - d + 1.0 ) ).add( M.black, box( 0.03, 0.18, 0.03, w / 2 - 0.9 - k * 0.35, 1.5, - d + 1.0 ) );
		kit.add( M.woodMid, box( bw, 0.04, 0.3, w / 2 - bw / 2 - 0.3, 1.6, - d + 0.2 ), box( bw, 0.04, 0.3, w / 2 - bw / 2 - 0.3, 2.0, - d + 0.2 ) );
		for ( let x = - bw / 2 + 0.15; x < bw / 2; x += 0.2 ) mug( kit, w / 2 - bw / 2 - 0.3 + x, 1.64, - d + 0.2 );
		const rows = Math.max( 1, Math.floor( ( d - 2.2 ) / 1.9 ) );
		for ( let i = 0; i < rows; i ++ ) {

			const z = - 1.0 - i * 1.9;
			for ( const x of [ - w / 2 + 1.0, w / 2 - 1.6 ].slice( 0, w > 4 ? 2 : 1 ) ) {

				table( kit, x, 0, z, 'pub', { round: false, w: 1.4, d: 0.8 } );
				kit.add( M.woodDark, box( 1.4, 0.05, 0.32, x, 0.44, z - 0.65 ), box( 1.4, 0.05, 0.32, x, 0.44, z + 0.65 ), box( 0.05, 0.44, 0.3, x - 0.6, 0, z - 0.65 ), box( 0.05, 0.44, 0.3, x + 0.6, 0, z - 0.65 ), box( 0.05, 0.44, 0.3, x - 0.6, 0, z + 0.65 ), box( 0.05, 0.44, 0.3, x + 0.6, 0, z + 0.65 ) );
				for ( const dx of [ - 0.4, 0.4 ] ) {

					mug( kit, x + dx, 0.75, z + 0.2 );
					seat( x + dx, z - 0.65, Math.PI ); // facing the table (+z)
					seat( x + dx, z + 0.65, 0 );

				}

			}

		}

		for ( let z = - 0.8; z > - d; z -= 1.2 ) kit.add( M.woodDark, box( w, 0.16, 0.14, 0, h - 0.16, z ) );
		for ( const z of [ - d * 0.3, - d * 0.7 ] ) kit.add( M.iron, cyl( 0.008, 0.008, 0.8, 0, h - 0.8, z, 4 ) ).add( M.lampShade, new THREE.SphereGeometry( 0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2 ).translate( 0, h - 0.85, z ) );
		// Pictures on the side walls.
		for ( const z of [ - 1.2, - 2.8 ] ) kit.add( M.woodDark, box( 0.04, 0.5, 0.65, - w / 2 + 0.06, 1.55, z ) ).add( M.cream, box( 0.045, 0.38, 0.52, - w / 2 + 0.06, 1.61, z ) );

	} else if ( style === 'cafe' ) {

		// Counter with an espresso machine and a cake case; marble bistro tables; pendant lamps; plants.
		const bw = Math.min( w - 1.4, 3.2 );
		kit.add( M.woodDark, box( bw, 1.0, 0.6, w / 2 - bw / 2 - 0.3, 0, - d + 0.9 ) ).add( M.marble, box( bw + 0.06, 0.04, 0.66, w / 2 - bw / 2 - 0.3, 1.0, - d + 0.9 ) );
		kit.add( M.chrome, box( 0.7, 0.45, 0.4, w / 2 - 0.9, 1.04, - d + 0.85 ) ).add( M.black, box( 0.6, 0.06, 0.05, w / 2 - 0.9, 1.3, - d + 0.64 ) );
		kit.add( M.darkGlass, box( 0.9, 0.4, 0.5, w / 2 - 2.0, 1.04, - d + 0.9 ) );
		for ( let k = 0; k < 4; k ++ ) kit.add( [ M.beer, M.foam, M.velvet, M.pot ][ k ], cyl( 0.08, 0.08, 0.08, w / 2 - 2.3 + k * 0.2, 1.08, - d + 0.9, 10 ) );
		for ( let x = - w / 2 + 0.3; x < w / 2 - 0.3; x += 0.25 ) cup( kit, x, 1.5, - d + 0.1 );
		kit.add( M.woodDark, box( w - 0.4, 0.03, 0.22, 0, 1.47, - d + 0.15 ) );
		const cols = Math.max( 1, Math.floor( ( w - 0.8 ) / 1.6 ) ), rows = Math.max( 1, Math.floor( ( d - 2.3 ) / 1.5 ) );
		for ( let i = 0; i < cols; i ++ ) for ( let j = 0; j < rows; j ++ ) {

			const x = - w / 2 + 0.8 + i * ( ( w - 1.6 ) / Math.max( 1, cols - 1 || 1 ) ) * ( cols > 1 ? 1 : 0 ) + ( cols === 1 ? ( w - 1.6 ) / 2 : 0 );
			const z = - 1.1 - j * 1.5;
			table( kit, x, 0, z, 'cafe', { w: 0.6 } );
			cup( kit, x + 0.1, 0.75, z );
			chair( kit, x - 0.5, 0, z, - Math.PI / 2, 'cafe' );
			chair( kit, x + 0.5, 0, z, Math.PI / 2, 'cafe' );
			seat( x - 0.5, z, - Math.PI / 2 );
			seat( x + 0.5, z, Math.PI / 2 );

		}

		for ( const z of [ - d * 0.3, - d * 0.65 ] ) for ( const x of [ - w / 4, w / 4 ] ) kit.add( M.iron, cyl( 0.006, 0.006, 0.9, x, h - 0.9, z, 4 ) ).add( M.brass, new THREE.ConeGeometry( 0.17, 0.2, 14, 1, true ).translate( x, h - 1.0, z ) ).add( M.bulb, ball( 0.05, x, h - 1.08, z, 8 ) );
		plant( kit, - w / 2 + 0.4, 0, - d + 0.5, 1.4 );
		plant( kit, w / 2 - 0.4, 0, - 0.6, 1.1 );

	} else {

		// Champagne bar: marble bar with gold rail along one side, a back bar of bottles, stools, small round tables
		// with ice buckets, a ring chandelier.
		const bl = Math.min( d - 1.6, 5 );
		kit.add( M.black, box( 0.6, 1.05, bl, - w / 2 + 1.1, 0, - d + 0.5 + bl / 2 ) ).add( M.marble, box( 0.72, 0.05, bl + 0.1, - w / 2 + 1.1, 1.05, - d + 0.5 + bl / 2 ) ).add( M.gold, box( 0.03, 0.03, bl, - w / 2 + 1.42, 0.2, - d + 0.5 + bl / 2 ) );
		for ( const y of [ 1.2, 1.6, 2.0 ] ) {

			kit.add( M.gold, box( 0.25, 0.03, bl, - w / 2 + 0.2, y, - d + 0.5 + bl / 2 ) );
			for ( let z = - d + 0.65; z < - d + 0.4 + bl; z += 0.16 ) bottleAt( kit, - w / 2 + 0.2, y + 0.03, z );

		}

		for ( let z = - d + 0.9; z < - d + 0.3 + bl; z += 0.85 ) {

			kit.add( M.velvet, cyl( 0.19, 0.19, 0.07, - w / 2 + 1.75, 0.72, z, 14 ) ).add( M.gold, cyl( 0.02, 0.02, 0.72, - w / 2 + 1.75, 0, z, 6 ), new THREE.TorusGeometry( 0.15, 0.012, 5, 14 ).rotateX( Math.PI / 2 ).translate( - w / 2 + 1.75, 0.3, z ) );
			seat( - w / 2 + 1.75, z, Math.PI / 2 ); // stool, facing the bar (−x)

		}

		const tablesX = w / 2 - 1.1;
		for ( let z = - 1.1; z > - d + 0.9; z -= 1.6 ) {

			table( kit, tablesX, 0, z, 'champagne', { w: 0.6 } );
			kit.add( M.chrome, cyl( 0.09, 0.075, 0.2, tablesX, 0.75, z, 12 ) );
			bottleAt( kit, tablesX, 0.8, z );
			chair( kit, tablesX - 0.55, 0, z, - Math.PI / 2, 'champagne' );
			chair( kit, tablesX + 0.55, 0, z, Math.PI / 2, 'champagne' );
			seat( tablesX - 0.55, z, - Math.PI / 2 );
			seat( tablesX + 0.55, z, Math.PI / 2 );

		}

		kit.add( M.gold, new THREE.TorusGeometry( 0.7, 0.03, 6, 32 ).rotateX( Math.PI / 2 ).translate( 0.3, h - 0.7, - d / 2 ), cyl( 0.006, 0.006, 0.7, 0.3, h - 0.7, - d / 2, 4 ) );
		for ( let k = 0; k < 10; k ++ ) kit.add( M.bulb, ball( 0.045, 0.3 + Math.cos( k * 0.628 ) * 0.7, h - 0.66, - d / 2 + Math.sin( k * 0.628 ) * 0.7, 6 ) );
		kit.add( M.gold, box( w - 0.2, 0.03, 0.03, 0, h - 0.05, - d + 0.1 ), box( 0.03, 0.03, d - 0.2, w / 2 - 0.1, h - 0.05, - d / 2 ) );

	}

	// Lit from within: the room's own surfaces glow warmly (cheaper than a point light, which every surface in the
	// scene would pay for).
	for ( const m of [ look.floor, look.wall, look.ceiling ] ) m.emissiveNode = ( m.colorNode || color( m.color ) ).mul( color( look.light ) ).mul( 0.45 );
	kit.build( g );
	return seats;

}

// ---------------------------------------------------------------------------
// Outdoor seating: tables with two chairs each (positions from the build), parasols at the pub and the café.

function addTerrace( scene, terrace ) {

	const kit = new Kit();
	for ( const [ x, y, z, rot ] of terrace.tables ) {

		const ux = Math.sin( rot ), uz = Math.cos( rot );
		table( kit, x, y, z, terrace.kind, { w: terrace.kind === 'pub' ? 0.8 : 0.6 } );
		for ( const side of [ - 1, 1 ] ) chair( kit, x + ux * 0.55 * side, y, z + uz * 0.55 * side, Math.atan2( ux * side, uz * side ), terrace.kind );
		if ( terrace.kind === 'champagne' ) {

			kit.add( M.chrome, cyl( 0.09, 0.075, 0.2, x, y + 0.75, z, 12 ) );
			bottleAt( kit, x, y + 0.8, z );

		} else if ( terrace.kind === 'pub' ) {

			mug( kit, x - 0.15, y + 0.75, z );
			mug( kit, x + 0.18, y + 0.75, z + 0.1 );

		} else cup( kit, x, y + 0.75, z );

		if ( terrace.kind !== 'champagne' ) {

			const canopy = terrace.kind === 'pub' ? plain( 0x2f5a3a, { side: THREE.DoubleSide } ) : plain( 0xf1ece0, { side: THREE.DoubleSide } );
			kit.add( M.woodLight, cyl( 0.025, 0.025, 2.3, x, y, z, 6 ) ).add( canopy, new THREE.ConeGeometry( 1.25, 0.45, 8, 1, true ).translate( x, y + 2.3 + 0.1, z ) );

		}

	}

	kit.build( scene );

}

// Festoon lights: bulbs on a sagging wire between two points.
function addFestoons( scene, lights ) {

	const bulbs = [], wires = [];
	for ( const { a, b } of lights ) {

		const A = new THREE.Vector3( ...a ), B = new THREE.Vector3( ...b );
		const len = A.distanceTo( B ), n = Math.max( 4, Math.round( len / 0.45 ) );
		let prev = null;
		for ( let i = 0; i <= n; i ++ ) {

			const t = i / n;
			const p = A.clone().lerp( B, t );
			p.y -= Math.sin( t * Math.PI ) * Math.min( 0.6, len * 0.08 );
			if ( i > 0 && i < n ) bulbs.push( p.clone().add( new THREE.Vector3( 0, - 0.07, 0 ) ) );
			if ( prev ) wires.push( [ prev, p ] );
			prev = p;

		}

	}

	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
	const bulbMesh = new THREE.InstancedMesh( new THREE.SphereGeometry( 0.045, 8, 6 ), M.bulb, bulbs.length );
	bulbs.forEach( ( p, i ) => bulbMesh.setMatrixAt( i, m.makeTranslation( p.x, p.y, p.z ) ) );
	const wireMesh = new THREE.InstancedMesh( new THREE.BoxGeometry( 0.008, 0.008, 1 ), M.iron, wires.length );
	wires.forEach( ( [ p0, p1 ], i ) => {

		const dir = p1.clone().sub( p0 );
		q.setFromUnitVectors( new THREE.Vector3( 0, 0, 1 ), dir.clone().normalize() );
		wireMesh.setMatrixAt( i, m.compose( p0.clone().add( p1 ).multiplyScalar( 0.5 ), q, s.set( 1, 1, dir.length() ) ) );

	} );

	scene.add( bulbMesh, wireMesh );

}

// ---------------------------------------------------------------------------
// Náprstkovo muzeum: a stone portal with a round arch and keystone, panelled double doors under a fanlight,
// the museum's name in bronze letters above, exhibition banners either side.

function addMuseumGate( scene, G ) {

	const g = onFront( G.x, G.y, G.z, G.n );
	scene.add( g );
	const kit = new Kit();
	const stone = ashlar( 0xc2b8a3, 0xd2c9b5 );
	const w = G.w, h = G.h, spring = h - w / 2;
	kit.add( stone, box( 0.6, h + 0.2, 0.36, - w / 2 - 0.3, 0, 0.12 ), box( 0.6, h + 0.2, 0.36, w / 2 + 0.3, 0, 0.12 ) );
	for ( let k = 0; k <= 10; k ++ ) {

		const a = Math.PI * k / 10;
		const vous = new THREE.BoxGeometry( 0.62, 0.36, 0.38 ).translate( 0, w / 2 + 0.3, 0 ).rotateZ( Math.PI / 2 - a ).translate( 0, spring, 0.12 );
		kit.add( k === 5 ? ashlar( 0xa89e88, 0xb7ad97 ) : stone, vous );

	}

	kit.add( stone, box( w + 2.2, 0.4, 0.5, 0, h + 0.55, 0.18 ), box( w + 2.6, 0.12, 0.6, 0, h + 0.95, 0.2 ) );
	// Doors and fanlight.
	kit.add( M.darkGlass, new THREE.CircleGeometry( w / 2, 24, 0, Math.PI ).translate( 0, spring, 0.04 ) );
	for ( let k = 0; k < 5; k ++ ) kit.add( M.woodDark, new THREE.BoxGeometry( 0.05, w / 2, 0.02 ).translate( 0, w / 4, 0 ).rotateZ( Math.PI / 2 - Math.PI * ( k + 1 ) / 6 ).translate( 0, spring, 0.06 ) );
	for ( const side of [ - 1, 1 ] ) {

		const cx = side * w / 4;
		kit.add( plain( 0x5b3a22, { roughness: 0.55 } ), box( w / 2 - 0.04, spring - 0.05, 0.1, cx, 0, 0.02 ) );
		for ( const y of [ 0.35, 1.55 ] ) kit.add( M.woodDark, box( w / 2 - 0.4, 1.0, 0.04, cx, y, 0.08 ) );
		kit.add( M.brass, ball( 0.05, side * 0.18, 1.15, 0.12, 8 ) );

	}

	kit.add( M.woodDark, box( w, 0.1, 0.12, 0, spring - 0.05, 0.03 ) );
	kit.build( g );

	// Name in bronze letters on the frieze; exhibition banners on rods either side.
	const nameTex = textTexture( [ [ G.name, 120, 92 ], [ G.sub, 46, 196 ] ], { w: 2048, h: 256, bg: null, ink: '#6e5420', font: 'Georgia, serif', weight: '700', spacing: 10 } );
	const plate = board( nameTex, 6.4, 0.8, { transparent: true, material: { metalness: 0.6, roughness: 0.35 } } );
	plate.position.set( 0, h + 1.6, 0.06 );
	g.add( plate );
	const banners = [ [ 'ASIE', '#8f2a22' ], [ 'AFRIKA · AMERIKA', '#1f5560' ] ];
	banners.forEach( ( [ text, bg ], i ) => {

		const side = i ? 1 : - 1;
		const tex = textTexture( [ [ 'NÁPRSTKOVO', 58, 120 ], [ 'MUZEUM', 58, 190 ], [ text, 66, 640 ] ], { w: 320, h: 1024, bg, ink: '#f4efe4', font: '"Helvetica Neue", Arial, sans-serif', weight: '700' } );
		const b = board( tex, 0.9, 2.9, { material: { side: THREE.DoubleSide } } );
		b.position.set( side * ( w / 2 + 1.7 ), 3.1 + 1.45, 0.25 );
		g.add( b );
		new Kit().add( M.iron, box( 1.1, 0.04, 0.04, side * ( w / 2 + 1.7 ), 6.0, 0.25 ), box( 0.04, 0.04, 0.3, side * ( w / 2 + 1.7 ), 5.98, 0.1 ) ).build( g );

	} );

}

// ---------------------------------------------------------------------------
// The stairs from Národní down to Divadelní: granite treads between stone walls with iron handrails.
// Tread heights match the walking heights in src/main.js (zoneHeight).

function addStairs( scene, S ) {

	const [ bx, by, bz ] = S.bottom, [ tx, ty, tz ] = S.top;
	const len = Math.hypot( tx - bx, tz - bz ), N = S.steps, drop = ty - by;
	const g = new THREE.Group();
	g.position.set( bx, by, bz );
	g.rotation.y = Math.atan2( tx - bx, tz - bz ); // local +z runs up the stairs
	scene.add( g );
	const kit = new Kit();
	const granite = tiles( 0xa8a39a, 0x9d978d, 0.6 );
	const walls = ashlar( 0xa49b8a, 0xb6ad9b );
	const L2 = len + 0.6, w = S.w;
	const sAt = t => t * L2 - 0.3;
	for ( let k = 1; k <= N; k ++ ) {

		const s0 = sAt( k / ( N + 1 ) ), s1 = k === N ? len + 0.3 : sAt( ( k + 1 ) / ( N + 1 ) );
		const y = drop * k / N;
		kit.add( granite, box( w, y + 1.0, s1 - s0 + 0.02, 0, - 1.0, ( s0 + s1 ) / 2 ) );
		for ( const side of [ - 1, 1 ] ) kit.add( walls, box( 0.35, y + 1.0 + 0.95, s1 - s0 + 0.02, side * ( w / 2 + 0.17 ), - 1.0, ( s0 + s1 ) / 2 ) );

	}

	// Handrails along the slope, on posts.
	const slope = Math.atan2( drop, len );
	for ( const side of [ - 1, 1 ] ) {

		kit.add( M.iron, new THREE.CylinderGeometry( 0.025, 0.025, Math.hypot( len, drop ), 8 ).rotateX( Math.PI / 2 - slope ).translate( side * ( w / 2 - 0.12 ), drop / 2 + 0.92, len / 2 ) );
		for ( let s = 0.5; s < len; s += 1.6 ) kit.add( M.iron, cyl( 0.02, 0.02, 0.92, side * ( w / 2 - 0.12 ), drop * s / len, s, 6 ) );

	}

	kit.build( g );

}

// ---------------------------------------------------------------------------

export function addPlaces( scene, places ) {

	if ( ! places ) return { seats: [] };
	const seats = [ ...( places.seats || [] ) ];
	if ( places.rotunda ) addRotunda( scene, places.rotunda );
	for ( const s of places.signs ) addSign( scene, s );
	for ( const room of places.interiors ) seats.push( ...addInterior( scene, room ) );
	for ( const t of places.terraces ) addTerrace( scene, t );
	if ( places.lights?.length ) addFestoons( scene, places.lights );
	if ( places.gate ) addMuseumGate( scene, places.gate );
	if ( places.stairs ) addStairs( scene, places.stairs );
	return { seats };

}
