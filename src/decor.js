// Street decorations from the house descriptions (data/houses.json via tools/build-scene.mjs, `decor`):
// fabric awnings over restaurants, wall lanterns on iron brackets, vertical hanging banners and wrought-iron
// balconies.
// Every entry is positioned on its facade with `rot` turning the model's +z to point out of the wall.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, positionWorld, mix, vec2, floor, fract, abs, max, smoothstep } from 'three/tsl';
import { hash2D } from './shading/common.js';
import { mergeInstances } from './kit.js';

const iron = new THREE.MeshStandardNodeMaterial( { color: 0x232624, metalness: 0.6, roughness: 0.45 } );
const glass = new THREE.MeshStandardNodeMaterial( { color: 0xfff2d6, emissive: 0xffd9a0, emissiveIntensity: 0.4, roughness: 0.2 } );

export function addDecor( scene, decor ) {

	if ( ! decor ) return;
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
	const up = new THREE.Vector3( 0, 1, 0 );
	const c = new THREE.Color();

	// Awnings: a fabric slope 1.4 m deep falling 0.45 m, with a 25 cm valance, as wide as the shop front.
	if ( decor.awnings.length ) {

		const slope = new THREE.BoxGeometry( 1, 0.03, 1.4 ).translate( 0, 0, 0.7 ).rotateX( 0.33 );
		const valance = new THREE.BoxGeometry( 1, 0.25, 0.02 ).translate( 0, - 0.58, 1.33 );
		const geometry = mergeGeometries( [ slope, valance ] );
		const mesh = new THREE.InstancedMesh( geometry, new THREE.MeshStandardNodeMaterial( { roughness: 0.85 } ), decor.awnings.length );
		decor.awnings.forEach( ( [ x, y, z, rot, w, colour ], i ) => {

			mesh.setMatrixAt( i, m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( w, 1, 1 ) ) );
			mesh.setColorAt( i, c.set( colour ) );

		} );
		mesh.castShadow = mesh.receiveShadow = true;
		scene.add( mesh );

	}

	// Wall lanterns: an iron bracket 55 cm out from the wall with a four-sided lantern hanging from it.
	if ( decor.lanterns.length ) {

		const bracket = mergeGeometries( [
			new THREE.BoxGeometry( 0.03, 0.03, 0.55 ).translate( 0, 0, 0.275 ),
			new THREE.BoxGeometry( 0.02, 0.3, 0.02 ).rotateX( 0.8 ).translate( 0, - 0.12, 0.12 ),
			new THREE.CylinderGeometry( 0.0, 0.17, 0.18, 4 ).rotateY( Math.PI / 4 ).translate( 0, - 0.1, 0.55 )
		] );
		const lantern = new THREE.CylinderGeometry( 0.14, 0.1, 0.38, 4 ).rotateY( Math.PI / 4 ).translate( 0, - 0.38, 0.55 );
		for ( const [ geometry, material ] of [ [ bracket, iron ], [ lantern, glass ] ] ) {

			const mesh = new THREE.InstancedMesh( geometry, material, decor.lanterns.length );
			decor.lanterns.forEach( ( [ x, y, z, rot ], i ) => mesh.setMatrixAt( i, m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( 1, 1, 1 ) ) ) );
			mesh.castShadow = true;
			scene.add( mesh );

		}

	}

	// Balconies: a stone slab on two consoles with a wrought-iron railing, 1 m high, round its three open sides.
	// All of them go into two merged meshes (slabs, railings).
	if ( decor.balconies?.length ) {

		const slabs = [], rails = [];
		for ( const [ x, y, z, rot, w, d ] of decor.balconies ) {

			const place = g => g.rotateY( rot ).translate( x, y, z );
			slabs.push( place( new THREE.BoxGeometry( w, 0.18, d ).translate( 0, - 0.09, d / 2 ) ) );
			for ( const cx of [ - w / 2 + 0.25, w / 2 - 0.25 ] ) slabs.push( place( new THREE.BoxGeometry( 0.22, 0.45, d * 0.8 ).translate( cx, - 0.4, d * 0.4 ) ) );
			// Railing panels: the front and both ends, the pattern repeating every 0.8 m.
			const panel = ( len, tx, tz, ry ) => {

				const g = new THREE.PlaneGeometry( len, 1.0 ).translate( 0, 0.5, 0 );
				const uv = g.attributes.uv;
				for ( let i = 0; i < uv.count; i ++ ) uv.setX( i, uv.getX( i ) * Math.max( 1, Math.round( len / 0.8 ) ) );
				return place( g.rotateY( ry ).translate( tx, 0, tz ) );

			};
			rails.push( panel( w, 0, d - 0.04, 0 ), panel( d, - w / 2 + 0.02, d / 2, Math.PI / 2 ), panel( d, w / 2 - 0.02, d / 2, Math.PI / 2 ) );

		}

		const stone = new THREE.MeshStandardNodeMaterial( { color: 0xd8d0c0, roughness: 0.85 } );
		const slabMesh = new THREE.Mesh( mergeGeometries( slabs ), stone );
		const railMesh = new THREE.Mesh( mergeGeometries( rails ), new THREE.MeshStandardNodeMaterial( { map: railingTexture(), color: 0x2a2c2b, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.45 } ) );
		slabMesh.castShadow = slabMesh.receiveShadow = railMesh.castShadow = true;
		scene.add( slabMesh, railMesh );

	}

	// Vertical banners hung at right angles to the wall, lettered top to bottom.
	for ( const [ x, y, z, rot, text, board, ink ] of decor.banners ) {

		const canvas = document.createElement( 'canvas' );
		canvas.width = 128;
		canvas.height = 128 * text.length;
		const ctx = canvas.getContext( '2d' );
		ctx.fillStyle = board;
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		ctx.fillStyle = ink;
		ctx.font = '600 92px system-ui, "Helvetica Neue", Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		[ ...text ].forEach( ( ch, i ) => ctx.fillText( ch, 64, 64 + i * 128 ) );
		const texture = new THREE.CanvasTexture( canvas );
		texture.colorSpace = THREE.SRGBColorSpace;

		const width = 0.6, height = 0.6 * text.length;
		const banner = new THREE.Mesh( new THREE.PlaneGeometry( width, height ).rotateY( Math.PI / 2 ).translate( 0, - height / 2, width / 2 + 0.15 ),
			new THREE.MeshStandardNodeMaterial( { map: texture, side: THREE.DoubleSide, roughness: 0.7 } ) );
		banner.position.set( x, y, z );
		banner.rotation.y = rot;
		banner.castShadow = true;
		scene.add( banner );

	}

}

// River embankment (tools/build-scene.mjs): dressed-stone wall and parapet, and an iron railing on top.
// Wrought-iron railing, one 0.8 m panel: top and bottom rails, upright bars, a scroll pair in the middle.
function railingTexture() {

	const c = document.createElement( 'canvas' );
	c.width = 256;
	c.height = 320;
	const ctx = c.getContext( '2d' );
	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 14;
	ctx.beginPath(); ctx.moveTo( 0, 10 ); ctx.lineTo( 256, 10 ); ctx.moveTo( 0, 300 ); ctx.lineTo( 256, 300 ); ctx.stroke();
	ctx.lineWidth = 6;
	for ( let x = 8; x < 256; x += 32 ) {

		ctx.beginPath(); ctx.moveTo( x, 10 ); ctx.lineTo( x, 300 ); ctx.stroke();

	}

	ctx.lineWidth = 7;
	for ( const [ cx, dir ] of [ [ 96, - 1 ], [ 160, 1 ] ] ) {

		ctx.beginPath(); ctx.arc( cx, 120, 30, 0, Math.PI * 2 ); ctx.stroke();
		ctx.beginPath(); ctx.arc( cx, 200, 30, 0, Math.PI * 2 ); ctx.stroke();
		ctx.beginPath(); ctx.arc( cx + dir * 20, 160, 14, 0, Math.PI * 2 ); ctx.stroke();

	}

	const tex = new THREE.CanvasTexture( c );
	tex.wrapS = THREE.RepeatWrapping;
	return tex;

}

// The river wall's materials and shapes, shared by every square that has a piece of it (src/main.js).
let EMB = null;
function embankmentKit() {

	if ( EMB ) return EMB;
	const stone = new THREE.MeshStandardNodeMaterial( { roughness: 0.9, side: THREE.DoubleSide } );
	const course = positionWorld.y.div( 0.45 );
	const along = positionWorld.x.add( positionWorld.z ).div( 0.9 ).add( floor( course ).mul( 0.5 ) );
	const joint = max( smoothstep( 0.44, 0.5, abs( fract( course ).sub( 0.5 ) ) ), smoothstep( 0.45, 0.5, abs( fract( along ).sub( 0.5 ) ) ) );
	const block = mix( color( 0x8f8574 ), color( 0xa59a86 ), hash2D( vec2( floor( along ), floor( course ) ) ) );
	stone.colorNode = mix( block, color( 0x5f594f ), joint.mul( 0.6 ) );

	// The Prague embankment railing: dark green cast-iron panels (vertical bars, a band of rings) under a top rail,
	// between square sandstone pillars every other post (≈ 4 m) and thin iron posts in between.
	const green = new THREE.MeshStandardNodeMaterial( { color: 0x2b3a2f, metalness: 0.5, roughness: 0.5 } );
	const pillarStone = new THREE.MeshStandardNodeMaterial( { color: 0xa79c88, roughness: 0.9 } );
	const canvas = document.createElement( 'canvas' );
	canvas.width = 256;
	canvas.height = 128;
	const g = canvas.getContext( '2d' );
	g.strokeStyle = '#ffffff';
	g.fillStyle = '#ffffff';
	g.fillRect( 0, 0, 256, 8 );
	g.fillRect( 0, 120, 256, 8 );
	g.fillRect( 0, 40, 256, 5 );
	g.fillRect( 0, 86, 256, 5 );
	for ( let x = 8; x < 256; x += 16 ) g.fillRect( x - 2, 0, 4, 128 );
	g.lineWidth = 5;
	for ( let x = 32; x < 256; x += 64 ) {

		g.beginPath();
		g.arc( x, 65, 19, 0, Math.PI * 2 );
		g.stroke();

	}

	const pattern = new THREE.CanvasTexture( canvas );
	pattern.wrapS = THREE.RepeatWrapping;
	const panel = new THREE.MeshStandardNodeMaterial( { color: 0x2b3a2f, metalness: 0.5, roughness: 0.5, alphaMap: pattern, alphaTest: 0.5, side: THREE.DoubleSide } );
	EMB = {
		stone, green, pillarStone, panel,
		pillar: new THREE.BoxGeometry( 0.34, 1.05, 0.34 ).translate( 0, 0.525, 0 ), cap: new THREE.BoxGeometry( 0.42, 0.08, 0.42 ).translate( 0, 1.09, 0 ),
		post: new THREE.CylinderGeometry( 0.025, 0.03, 0.95, 6 ).translate( 0, 0.475, 0 ), rail: new THREE.BoxGeometry( 1, 0.05, 0.06 ), sheet: new THREE.PlaneGeometry( 1, 0.62 ).translate( 0, - 0.33, 0 )
	};
	return EMB;

}

// A piece of the river embankment (one streamed square's: src/main.js): the dressed-stone wall's triangles
// ({ position, normal }), and its railing: sandstone pillars and iron posts (x y z each), rails (two ends each).
export function addEmbankment( scene, stoneMesh, { pillars = [], thin = [], rails = [] } ) {

	const K = embankmentKit();
	if ( stoneMesh?.position?.length ) {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( stoneMesh.position, 3 ) );
		geometry.setAttribute( 'normal', new THREE.BufferAttribute( stoneMesh.normal, 3 ) );
		const wall = new THREE.Mesh( geometry, K.stone );
		wall.castShadow = wall.receiveShadow = true;
		scene.add( wall );

	}

	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3( 1, 1, 1 );
	const instanced = ( geometry, material, list, stride, matrixAt ) => {

		const n = list.length / stride;
		if ( ! n ) return;
		// Merged into one mesh (src/kit.js mergeInstances: an instanced mesh per square would cost its own node build).
		const merged = mergeInstances( geometry, Array.from( { length: n }, ( _, k ) => matrixAt( k * stride ).clone() ) );
		if ( material !== K.panel ) merged.deleteAttribute( 'uv' );
		const mesh = new THREE.Mesh( merged, material );
		mesh.castShadow = true;
		scene.add( mesh );

	};

	const at = list => i => m.makeTranslation( list[ i ], list[ i + 1 ], list[ i + 2 ] );
	instanced( K.pillar, K.pillarStone, pillars, 3, at( pillars ) );
	instanced( K.cap, K.pillarStone, pillars, 3, at( pillars ) );
	instanced( K.post, K.green, thin, 3, at( thin ) );
	const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3(), x = new THREE.Vector3( 1, 0, 0 );
	const flat = new THREE.Vector3();
	instanced( K.rail, K.green, rails, 6, i => {

		a.fromArray( rails, i );
		b.fromArray( rails, i + 3 );
		dir.subVectors( b, a );
		const len = dir.length();
		q.setFromUnitVectors( x, dir.normalize() );
		return m.compose( p.addVectors( a, b ).multiplyScalar( 0.5 ), q, s.set( len + 0.02, 1, 1 ) );

	} );
	instanced( K.sheet, K.panel, rails, 6, i => {

		a.fromArray( rails, i );
		b.fromArray( rails, i + 3 );
		// The panel stays upright: turned about the vertical only.
		flat.set( b.x - a.x, 0, b.z - a.z ).normalize();
		q.setFromUnitVectors( x, flat );
		return m.compose( p.addVectors( a, b ).multiplyScalar( 0.5 ), q, s.set( a.distanceTo( b ) + 0.02, 1, 1 ) );

	} );

}
