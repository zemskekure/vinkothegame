// Hand-modelled landmarks without a house footprint of their own (tools/places.mjs): the Šítkov water tower
// beside Mánes (a square sandstone tower with a corbelled cornice and a copper onion dome on a gallery), and the
// music pavilion in the Žofín garden (an octagonal cast-iron bandstand on a stone base under a grey roof).

import * as THREE from 'three/webgpu';
import { Kit, M, plain, ashlar, box, cyl, textTexture, board } from './kit.js';

const L = {
	stone: ashlar( 0x9c8c72, 0xb3a184 ),
	copper: plain( 0x4f7a68, { roughness: 0.55, metalness: 0.35, flatShading: true } ),
	iron: plain( 0x26352d, { metalness: 0.5, roughness: 0.5 } ),
	roof: plain( 0x5d6266, { roughness: 0.7, flatShading: true } ),
	base: plain( 0xa69d8e, { roughness: 0.9 } ),
	floor: plain( 0x8a8378, { roughness: 0.9 } ),
	gold: plain( 0xc9a046, { metalness: 0.9, roughness: 0.3 } )
};

function addSitkovTower( scene, t, waterLevel ) {

	const kit = new Kit();
	const W = 8.2, base = waterLevel - 1.5, top = t.y + 27;
	kit.add( L.stone, box( W, top - base, W, 0, base, 0 ) );
	// Corbelled cornice and the gallery parapet.
	kit.add( L.stone, box( W + 0.8, 0.5, W + 0.8, 0, top - 2.2, 0 ), box( W + 1.4, 0.4, W + 1.4, 0, top - 1.7, 0 ), box( W + 1.4, 1.1, W + 1.4, 0, top - 1.3, 0 ) );
	// Small windows (dark recesses) up the shaft.
	for ( const s of [ - 1, 1 ] ) for ( let y = t.y + 4; y < top - 4; y += 5.5 ) {

		kit.add( L.iron, box( 0.9, 1.5, 0.12, 0, y, s * ( W / 2 + 0.01 ) ), box( 0.12, 1.5, 0.9, s * ( W / 2 + 0.01 ), y, 0 ) );

	}

	// Octagonal drum, onion dome, lantern and finial.
	kit.add( L.copper, cyl( 3.6, 3.6, 2.2, 0, top - 0.2, 0, 8 ) );
	const prof = [ [ 3.7, 0 ], [ 4.2, 0.8 ], [ 4.3, 1.6 ], [ 3.9, 2.6 ], [ 3.0, 3.4 ], [ 1.8, 4.1 ], [ 0.8, 4.6 ], [ 0.45, 5.0 ], [ 0.4, 5.6 ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) );
	kit.add( L.copper, new THREE.LatheGeometry( prof, 8 ).translate( 0, top + 2.0, 0 ) );
	kit.add( L.copper, cyl( 0.55, 0.6, 1.2, 0, top + 7.4, 0, 8 ), cyl( 0.05, 0.25, 1.5, 0, top + 8.6, 0, 8 ) );
	kit.add( L.gold, new THREE.SphereGeometry( 0.22, 10, 6 ).translate( 0, top + 10.2, 0 ) );

	const g = new THREE.Group();
	g.position.set( t.x, 0, t.z );
	g.rotation.y = t.rot || 0;
	kit.build( g );
	scene.add( g );

}

function addBandstand( scene, b ) {

	const kit = new Kit();
	const R = b.r, H = 3.4;
	kit.add( L.base, cyl( R, R + 0.15, 0.9, 0, b.y - 0.2, 0, 8 ) );
	kit.add( L.floor, cyl( R - 0.05, R - 0.05, 0.05, 0, b.y + 0.7, 0, 8 ) );
	// Steps on one side.
	for ( let k = 0; k < 3; k ++ ) kit.add( L.base, box( 2.2, 0.23 * ( k + 1 ), 0.4, 0, b.y - 0.1, R + 0.15 + ( 2 - k ) * 0.4 ) );
	for ( let k = 0; k < 8; k ++ ) {

		const a = ( k + 0.5 ) / 8 * Math.PI * 2, x = Math.sin( a ) * ( R - 0.25 ), z = Math.cos( a ) * ( R - 0.25 );
		kit.add( L.iron, cyl( 0.09, 0.11, H, x, b.y + 0.7, z, 8 ) );
		// Railing between the columns, except at the steps.
		if ( k !== 7 ) {

			const a2 = ( k + 1.5 ) / 8 * Math.PI * 2, x2 = Math.sin( a2 ) * ( R - 0.25 ), z2 = Math.cos( a2 ) * ( R - 0.25 );
			const len = Math.hypot( x2 - x, z2 - z );
			const rail = new THREE.BoxGeometry( len, 0.05, 0.05 );
			rail.rotateY( - Math.atan2( z2 - z, x2 - x ) );
			for ( const y of [ 0.95, 0.15 ] ) kit.add( L.iron, rail.clone().translate( ( x + x2 ) / 2, b.y + 0.7 + y, ( z + z2 ) / 2 ) );

		}

	}

	// Frieze ring and the eight-sided bell roof with a lantern.
	kit.add( L.iron, cyl( R - 0.1, R - 0.1, 0.4, 0, b.y + 0.7 + H - 0.4, 0, 8 ).toNonIndexed() );
	kit.add( L.roof, new THREE.ConeGeometry( R + 0.6, 2.6, 8, 1 ).translate( 0, b.y + 0.7 + H + 1.3, 0 ) );
	kit.add( L.roof, cyl( 0.6, 0.7, 0.7, 0, b.y + 0.7 + H + 2.3, 0, 8 ), new THREE.ConeGeometry( 0.8, 0.9, 8 ).translate( 0, b.y + 0.7 + H + 3.45, 0 ) );

	const g = new THREE.Group();
	g.position.set( b.x, 0, b.z );
	g.rotation.y = b.rot || 0;
	kit.build( g );
	scene.add( g );

}

// The piazzetta of the National Theatre: Gebauer's Heart for Václav Havel (red, lit, 1.6 m, his signature above it,
// two heart-shaped wire cages beside it), Malejovský's bronze Rebirth on a round stone plinth, Nová scéna's pillars.
function heartShape( s ) {

	const h = new THREE.Shape();
	h.moveTo( 0, - 0.5 * s );
	h.bezierCurveTo( 0.15 * s, - 0.3 * s, 0.55 * s, - 0.05 * s, 0.5 * s, 0.25 * s );
	h.bezierCurveTo( 0.45 * s, 0.55 * s, 0.05 * s, 0.6 * s, 0, 0.3 * s );
	h.bezierCurveTo( - 0.05 * s, 0.6 * s, - 0.45 * s, 0.55 * s, - 0.5 * s, 0.25 * s );
	h.bezierCurveTo( - 0.55 * s, - 0.05 * s, - 0.15 * s, - 0.3 * s, 0, - 0.5 * s );
	return h;

}

function addPiazzetta( scene, P ) {

	const kit = new Kit();
	const red = plain( 0xc4161c, { roughness: 0.35, emissive: 0x5a0508 } );
	const bronze = plain( 0x5e4a33, { metalness: 0.7, roughness: 0.45 } );
	const granite = plain( 0xb9b3aa, { roughness: 0.85 } );

	{

		const [ x, y, z, rot ] = P.heart;
		const g = new THREE.Group();
		g.position.set( x, y, z );
		g.rotation.y = rot;
		const k = new Kit();
		k.add( red, new THREE.ExtrudeGeometry( heartShape( 1.45 ), { depth: 0.35, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 16 } ).translate( 0, 0.85, - 0.17 ) );
		k.add( granite, box( 0.9, 0.12, 0.6, 0, 0, 0 ) );
		// The cages: heart outlines in wire, either side.
		for ( const s of [ - 1, 1 ] ) {

			const pts = heartShape( 1.0 ).getPoints( 40 ).map( p => new THREE.Vector3( p.x, p.y, 0 ) );
			const curve = new THREE.CatmullRomCurve3( pts, true );
			for ( const o of [ - 0.15, 0.15 ] ) k.add( M.iron, new THREE.TubeGeometry( curve, 60, 0.012, 4, true ).translate( s * 1.4, 0.6, o ) );

		}

		k.build( g );
		const sig = board( textTexture( [ [ 'Václav Havel ♥', 120 ] ], { w: 1024, h: 200, ink: '#c4161c', font: '"Brush Script MT", "Segoe Script", cursive', weight: '400' } ), 1.3, 0.25, { transparent: true, material: { side: THREE.DoubleSide } } );
		sig.position.set( 0, 2.05, 0 );
		g.add( sig );
		scene.add( g );

	}

	{

		const [ x, y, z, rot ] = P.statue;
		const g = new THREE.Group();
		g.position.set( x, y, z );
		g.rotation.y = rot;
		const k = new Kit();
		k.add( granite, cyl( 0.55, 0.55, 1.7, 0, 0, 0, 24 ) );
		// A standing woman in a long dress, arms lifted a little from her sides.
		const dress = [ [ 0.32, 0 ], [ 0.3, 0.3 ], [ 0.24, 0.9 ], [ 0.2, 1.25 ], [ 0.17, 1.42 ], [ 0.08, 1.52 ], [ 0.06, 1.58 ] ].map( ( [ r, h ] ) => new THREE.Vector2( r, h ) );
		k.add( bronze, new THREE.LatheGeometry( dress, 14 ).translate( 0, 1.7, 0 ) );
		k.add( bronze, new THREE.SphereGeometry( 0.12, 12, 8 ).scale( 0.9, 1.1, 1 ).translate( 0, 1.7 + 1.68, 0 ) );
		for ( const s of [ - 1, 1 ] ) k.add( bronze, new THREE.CylinderGeometry( 0.045, 0.04, 0.62, 8 ).translate( 0, - 0.31, 0 ).rotateZ( s * 0.35 ).translate( s * 0.2, 1.7 + 1.38, 0 ) );
		k.build( g );
		scene.add( g );

	}

	for ( const [ x, y, z, rot ] of P.pillars ) kit.add( granite, new THREE.BoxGeometry( 1.1, 4.7, 1.1 ).translate( 0, 2.35 - 0.1, 0 ).rotateY( rot ).translate( x, y, z ) );
	kit.build( scene );

}

export function addLandmarks( scene, places, waterLevel ) {

	if ( places.piazzetta ) addPiazzetta( scene, places.piazzetta );

	if ( places.sitkov ) addSitkovTower( scene, places.sitkov, waterLevel );
	if ( places.bandstand ) addBandstand( scene, places.bandstand );

}
