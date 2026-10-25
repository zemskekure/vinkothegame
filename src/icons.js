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
	const shade = textTexture( [ [ L.text, 640 ] ], { w: 2048, h: 820, ink: L.side || '#2b2c30', font: 'Helvetica, Arial, sans-serif', weight: '800', spacing: 40 } );
	const plane = new THREE.PlaneGeometry( L.width, L.width * 820 / 2048 );
	const front = new THREE.Mesh( plane, new THREE.MeshStandardNodeMaterial( { map: tex, transparent: true, alphaTest: 0.5, roughness: 0.5, metalness: 0.2 } ) );
	const back = new THREE.Mesh( plane, new THREE.MeshStandardNodeMaterial( { map: shade, transparent: true, alphaTest: 0.5, roughness: 0.9 } ) );
	front.position.z = 0.22;
	back.position.set( 0.05, - 0.06, 0.1 );
	front.castShadow = true;
	g.add( back, front );

}

// ---------------------------------------------------------------------------
// David Černý's Motýlek / Letadlo: a light-blue and violet propeller plane, nose up close to the wall, with
// butterfly wings of open violet wire lattice raised away from the wall in a V, as if it had just landed on the
// corner of Máj. On a short steel bracket.

const WING = 0x6a3a9e;

function latticeTexture() {

	const c = document.createElement( 'canvas' );
	c.width = c.height = 512;
	const ctx = c.getContext( '2d' );
	ctx.strokeStyle = '#6a3a9e';
	// A fine net of wire in two diagonals, and heavier veins fanning out from the wing root (u = 0, v = ½).
	ctx.lineWidth = 3;
	for ( let k = - 512; k < 1024; k += 26 ) {

		ctx.beginPath(); ctx.moveTo( k, 0 ); ctx.lineTo( k + 512, 512 ); ctx.stroke();
		ctx.beginPath(); ctx.moveTo( k, 512 ); ctx.lineTo( k + 512, 0 ); ctx.stroke();

	}

	ctx.lineWidth = 9;
	for ( let k = - 5; k <= 5; k ++ ) {

		const a = k * 0.28;
		ctx.beginPath();
		ctx.moveTo( 0, 256 );
		ctx.quadraticCurveTo( 260 * Math.cos( a * 0.7 ), 256 + 260 * Math.sin( a * 0.7 ), 560 * Math.cos( a ), 256 + 560 * Math.sin( a ) );
		ctx.stroke();

	}

	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;

}

const FORE = [ [ 0, 0.05 ], [ 0.35, 0.55 ], [ 0.85, 0.95 ], [ 1.0, 0.8 ], [ 1.05, 0.5 ], [ 0.7, 0.15 ], [ 0, - 0.05 ] ];
const HIND = [ [ 0, - 0.05 ], [ 0.6, - 0.1 ], [ 0.8, - 0.55 ], [ 0.55, - 0.75 ], [ 0.3, - 0.85 ], [ 0.1, - 0.45 ], [ 0, - 0.2 ] ];

function wingShape( points ) {

	const s = new THREE.Shape();
	s.moveTo( ...points[ 0 ] );
	for ( let i = 1; i < points.length; i += 3 ) s.bezierCurveTo( ...points[ i ], ...points[ i + 1 ], ...points[ i + 2 ] );
	return s;

}

function wingGeometry( points, half ) {

	const geo = new THREE.ShapeGeometry( wingShape( points ), 24 );
	const pos = geo.attributes.position, uv = geo.attributes.uv;
	for ( let i = 0; i < pos.count; i ++ ) {

		uv.setXY( i, pos.getX( i ) / 1.05, ( pos.getY( i ) + 0.9 ) / 1.9 );
		pos.setXY( i, pos.getX( i ) * half, pos.getY( i ) * half );

	}

	return geo;

}

// The heavy wire rim round a wing.
function wingRim( points, half ) {

	const pts = wingShape( points ).getPoints( 40 ).map( p => new THREE.Vector3( p.x * half, p.y * half, 0 ) );
	return new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts, true ), 120, 0.05, 5, true );

}

function addButterfly( scene, B, groundHeight ) {

	const g = new THREE.Group();
	g.position.set( B.x, groundHeight( B.x, B.z ) + B.y, B.z );
	face( g, B.facing );
	scene.add( g );

	// Local axes: y up the body (nose up), x out from the wall, z along it.
	const fly = new THREE.Group();
	fly.rotation.z = - 0.15;
	g.add( fly );
	const half = B.span / 2;
	const lattice = new THREE.MeshStandardNodeMaterial( { map: latticeTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.4 } );
	const rimMat = plain( WING, { metalness: 0.5, roughness: 0.35 } );
	for ( const side of [ 1, - 1 ] ) {

		for ( const pts of [ FORE, HIND ] ) {

			const wing = new THREE.Group();
			wing.add( new THREE.Mesh( wingGeometry( pts, half ), lattice ), new THREE.Mesh( wingRim( pts, half ), rimMat ) );
			wing.rotation.y = side * 0.3; // both pairs out from the wall, opened in a V
			wing.traverse( o => o.castShadow = true );
			fly.add( wing );

		}

	}

	// The plane: a light-blue fuselage with violet paint, tailplane and fin, a two-bladed propeller at the nose.
	const kit = new Kit();
	const blue = plain( 0x5aa2dc, { metalness: 0.3, roughness: 0.35 } ), violet = plain( 0x7444b0, { metalness: 0.3, roughness: 0.35 } );
	const len = B.span * 0.5;
	kit.add( blue, new THREE.CapsuleGeometry( 0.32, len, 6, 16 ).translate( 0, - len * 0.1, 0.1 ) );
	kit.add( violet, new THREE.CapsuleGeometry( 0.34, len * 0.35, 6, 16 ).translate( 0, - len * 0.05, 0.1 ) );
	kit.add( violet, new THREE.BoxGeometry( 1.8, 0.1, 0.7 ).translate( 0, - len * 0.58, 0.1 ) );
	kit.add( violet, new THREE.BoxGeometry( 0.1, 0.9, 0.8 ).translate( 0, - len * 0.55, 0.45 ) );
	kit.add( violet, cyl( 0.2, 0.06, 0.4, 0, len * 0.4 + 0.1, 0.1, 12 ) );
	kit.add( M.iron, new THREE.BoxGeometry( 0.14, 0.05, 2.2 ).translate( 0, len * 0.4 + 0.45, 0.1 ) );
	kit.build( fly );

	// Steel bracket back to the wall.
	const rod = new THREE.Mesh( cyl( 0.06, 0.06, 1.3, 0, 0, 0, 8 ), M.iron );
	rod.rotation.z = Math.PI / 2;
	rod.position.x = - 0.1;
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
