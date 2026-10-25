// Local icons: the one-off things that make a corner recognisable at a glance and that the house descriptions
// cannot express: big lettering on a department store, a sculpture hanging off a corner, a domed corner tower.
// Placed by hand in data/icons.json (scene frame, heights above the ground), each with the source it was seen in.

import * as THREE from 'three/webgpu';
import { Kit, plain, M, cyl, ball, textTexture } from './kit.js';

export function addIcons( scene, icons, groundHeight, buildings ) {

	for ( const icon of icons ) {

		if ( icon.kind === 'letters' ) addLetters( scene, icon, groundHeight );
		else if ( icon.kind === 'butterfly' ) addButterfly( scene, icon, groundHeight );
		else if ( icon.kind === 'cupola' ) addCupola( scene, icon, groundHeight, buildings );

	}

}

// Turns a group so that its local +z points along the given horizontal direction (scene frame).
const face = ( g, [ fx, fz ] ) => g.rotation.set( 0, Math.atan2( fx, fz ), 0 );

// ---------------------------------------------------------------------------
// Large letters fixed to a facade, standing a little off the wall: a dark shadow copy behind gives them depth.

function addLetters( scene, L, groundHeight ) {

	const g = new THREE.Group();
	g.position.set( L.x, groundHeight( L.x, L.z ) + L.y, L.z );
	face( g, L.facing );
	scene.add( g );

	const tex = textTexture( [ [ L.text, 640 ] ], { w: 2048, h: 820, ink: L.ink, font: 'Helvetica, Arial, sans-serif', weight: '800', spacing: 40 } );
	tex.colorSpace = THREE.SRGBColorSpace;
	const shade = textTexture( [ [ L.text, 640 ] ], { w: 2048, h: 820, ink: '#15161a', font: 'Helvetica, Arial, sans-serif', weight: '800', spacing: 40 } );
	const plane = new THREE.PlaneGeometry( L.width, L.width * 820 / 2048 );
	const front = new THREE.Mesh( plane, new THREE.MeshStandardNodeMaterial( { map: tex, transparent: true, alphaTest: 0.5, roughness: 0.5, metalness: 0.2 } ) );
	const back = new THREE.Mesh( plane, new THREE.MeshStandardNodeMaterial( { map: shade, transparent: true, alphaTest: 0.5, roughness: 0.9 } ) );
	front.position.z = 0.22;
	back.position.set( 0.05, - 0.06, 0.1 );
	front.castShadow = true;
	g.add( back, front );

}

// ---------------------------------------------------------------------------
// David Černý's Motýlek / Letadlo: a butterfly whose body is a small propeller plane, hung nose-up off the corner
// of Máj. Wings in violet shading to blue and pink with dark veins; a dark violet fuselage; a steel bracket to
// the wall.

function wingTexture() {

	const c = document.createElement( 'canvas' );
	c.width = c.height = 512;
	const ctx = c.getContext( '2d' );
	// u runs from the wing root (0) out to the tip (1), v across the wing.
	const grad = ctx.createRadialGradient( 0, 256, 20, 0, 256, 560 );
	grad.addColorStop( 0, '#4b2580' );
	grad.addColorStop( 0.35, '#7b3fb5' );
	grad.addColorStop( 0.65, '#4f78d8' );
	grad.addColorStop( 0.88, '#e070b8' );
	grad.addColorStop( 1, '#2a1640' );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, 512, 512 );
	ctx.strokeStyle = 'rgba(25, 12, 40, 0.75)';
	ctx.lineWidth = 6;
	for ( let k = - 6; k <= 6; k ++ ) {

		const a = k * 0.24;
		ctx.beginPath();
		ctx.moveTo( 0, 256 );
		ctx.quadraticCurveTo( 260 * Math.cos( a * 0.7 ), 256 + 260 * Math.sin( a * 0.7 ), 560 * Math.cos( a ), 256 + 560 * Math.sin( a ) );
		ctx.stroke();

	}

	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;

}

function wingGeometry( points, half ) {

	const s = new THREE.Shape();
	s.moveTo( ...points[ 0 ] );
	for ( let i = 1; i < points.length; i += 3 ) s.bezierCurveTo( ...points[ i ], ...points[ i + 1 ], ...points[ i + 2 ] );
	const geo = new THREE.ShapeGeometry( s, 24 );
	const pos = geo.attributes.position, uv = geo.attributes.uv;
	for ( let i = 0; i < pos.count; i ++ ) {

		uv.setXY( i, pos.getX( i ) / 1.05, ( pos.getY( i ) + 0.9 ) / 1.9 );
		pos.setXY( i, pos.getX( i ) * half, pos.getY( i ) * half );

	}

	return geo;

}

function addButterfly( scene, B, groundHeight ) {

	const g = new THREE.Group();
	g.position.set( B.x, groundHeight( B.x, B.z ) + B.y, B.z );
	face( g, B.facing );
	scene.add( g );

	// The butterfly itself, nose up and leaning, wings across the view from the street.
	const fly = new THREE.Group();
	fly.rotation.z = - 0.45;
	g.add( fly );
	const half = B.span / 2;
	const wingMat = new THREE.MeshStandardNodeMaterial( { map: wingTexture(), side: THREE.DoubleSide, roughness: 0.45, metalness: 0.15 } );
	const fore = wingGeometry( [ [ 0, 0.05 ], [ 0.35, 0.55 ], [ 0.85, 0.95 ], [ 1.0, 0.8 ], [ 1.05, 0.5 ], [ 0.7, 0.15 ], [ 0, - 0.05 ] ], half );
	const hind = wingGeometry( [ [ 0, - 0.05 ], [ 0.6, - 0.1 ], [ 0.8, - 0.55 ], [ 0.55, - 0.75 ], [ 0.3, - 0.85 ], [ 0.1, - 0.45 ], [ 0, - 0.2 ] ], half );
	for ( const side of [ 1, - 1 ] ) {

		for ( const geo of [ fore, hind ] ) {

			const w = new THREE.Mesh( geo, wingMat );
			w.scale.x = side;
			w.rotation.y = side * - 0.4; // wings raised towards the viewer in a shallow V
			w.castShadow = true;
			fly.add( w );

		}

	}

	// Fuselage of a small plane along the body, a propeller at the nose.
	const kit = new Kit();
	const body = plain( 0x3d2160, { metalness: 0.5, roughness: 0.35 } );
	const len = B.span * 0.42;
	kit.add( body, new THREE.CapsuleGeometry( 0.26, len, 6, 14 ).translate( 0, - len * 0.15, 0.05 ) );
	kit.add( body, new THREE.BoxGeometry( 1.4, 0.08, 0.5 ).translate( 0, - len * 0.62, 0.05 ) ); // tailplane
	kit.add( M.iron, cyl( 0.12, 0.02, 0.35, 0, len * 0.35 + 0.15, 0.05, 10 ) );
	kit.add( M.iron, new THREE.BoxGeometry( 0.12, 0.04, 1.6 ).translate( 0, len * 0.35 + 0.3, 0.05 ) );
	kit.build( fly );

	// Steel bracket back to the wall.
	const rod = new THREE.Mesh( cyl( 0.05, 0.05, 2.4, 0, 0, 0, 8 ), M.iron );
	rod.rotation.x = Math.PI / 2;
	rod.position.z = - 1.2;
	g.add( rod );

}

// ---------------------------------------------------------------------------
// Domed corner tower: a round drum with arched windows above the house's main cornice, a cornice ring, a green
// copper cupola and a small lantern with a finial.

function addCupola( scene, C, groundHeight, buildings ) {

	const eave = buildings.find( b => b.code === C.code )?.eave ?? 20;
	const g = new THREE.Group();
	g.position.set( C.x, groundHeight( C.x, C.z ) + eave - 0.4, C.z );
	scene.add( g );

	const c = document.createElement( 'canvas' );
	c.width = 1024;
	c.height = 256;
	const ctx = c.getContext( '2d' );
	ctx.fillStyle = C.plaster;
	ctx.fillRect( 0, 0, 1024, 256 );
	for ( let k = 0; k < 8; k ++ ) {

		const x = k * 128 + 40, w = 48;
		ctx.fillStyle = '#efe6d2';
		ctx.fillRect( x - 8, 60, w + 16, 170 );
		ctx.fillStyle = '#1f262c';
		ctx.beginPath();
		ctx.moveTo( x, 222 );
		ctx.lineTo( x, 100 );
		ctx.arc( x + w / 2, 100, w / 2, Math.PI, 0 );
		ctx.lineTo( x + w, 222 );
		ctx.fill();

	}

	const drumTex = new THREE.CanvasTexture( c );
	drumTex.colorSpace = THREE.SRGBColorSpace;
	drumTex.wrapS = THREE.RepeatWrapping;

	const kit = new Kit();
	const plaster = plain( C.plaster ), light = plain( 0xf0e8d6 );
	const copper = plain( C.copper, { metalness: 0.35, roughness: 0.5 } );
	const r = C.r, H = C.drum;
	kit.add( new THREE.MeshStandardNodeMaterial( { map: drumTex, roughness: 0.85 } ), new THREE.CylinderGeometry( r, r, H, 40, 1, true ).translate( 0, H / 2, 0 ) );
	kit.add( light, cyl( r + 0.22, r + 0.22, 0.3, 0, H, 0, 40 ) );
	kit.add( plaster, cyl( r + 0.1, r + 0.1, 0.25, 0, - 0.1, 0, 40 ) );
	const dome = new THREE.SphereGeometry( r + 0.12, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2 ).scale( 1, 1.25, 1 ).translate( 0, H + 0.3, 0 );
	kit.add( copper, dome );
	const top = H + 0.3 + ( r + 0.12 ) * 1.25;
	kit.add( copper, cyl( 0.42, 0.42, 0.9, 0, top - 0.15, 0, 16 ) );
	kit.add( copper, new THREE.SphereGeometry( 0.48, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2 ).translate( 0, top + 0.75, 0 ) );
	kit.add( M.gold, cyl( 0.04, 0.04, 1.0, 0, top + 1.1, 0, 8 ) );
	kit.add( M.gold, ball( 0.12, 0, top + 1.6, 0 ) );
	kit.build( g );

}
