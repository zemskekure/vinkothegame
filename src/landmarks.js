// Hand-modelled landmarks without a house footprint of their own (tools/places.mjs): the Šítkov water tower
// beside Mánes (a square sandstone tower with a corbelled cornice and a copper onion dome on a gallery), and the
// music pavilion in the Žofín garden (an octagonal cast-iron bandstand on a stone base under a grey roof).

import * as THREE from 'three/webgpu';
import { Kit, M, plain, ashlar, box, cyl, ball, textTexture, board, SUN } from './kit.js';

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

// Betlémská kaple's front on the square (after street photos): white plaster under two tall white gables with
// small openings, four large pointed windows with leaded glass in sandstone frames, a sandstone plinth and corner
// stones, a small pointed door at the east end, and the slender copper spire on the ridge. The front line, eave
// and gable pitch come from the twin roof (tools/build-scene.mjs).
function leaded() {

	const c = document.createElement( 'canvas' );
	c.width = 128;
	c.height = 512;
	const x = c.getContext( '2d' );
	x.fillStyle = '#26323a';
	x.fillRect( 0, 0, 128, 512 );
	x.strokeStyle = '#5d6a6e';
	x.lineWidth = 3;
	for ( let i = - 512; i < 640; i += 22 ) {

		x.beginPath();
		x.moveTo( 0, i );
		x.lineTo( 128, i + 64 );
		x.moveTo( 0, i + 64 );
		x.lineTo( 128, i );
		x.stroke();

	}

	x.lineWidth = 7;
	x.strokeStyle = '#3a3f3f';
	for ( const X of [ 43, 86 ] ) {

		x.beginPath();
		x.moveTo( X, 0 );
		x.lineTo( X, 512 );
		x.stroke();

	}

	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	return t;

}

function pointed( w, h ) {

	// A lancet: straight jambs, a pointed head of two arcs.
	const r = w * 0.85, spring = h - Math.sqrt( r * r - ( r - w / 2 ) ** 2 );
	const s = new THREE.Shape().moveTo( - w / 2, 0 ).lineTo( w / 2, 0 ).lineTo( w / 2, spring );
	s.absarc( w / 2 - r, spring, r, 0, Math.acos( ( r - w / 2 ) / r ), false );
	s.absarc( - w / 2 + r, spring, r, Math.PI - Math.acos( ( r - w / 2 ) / r ), Math.PI, false );
	s.lineTo( - w / 2, 0 );
	return s;

}

// "Za pravdu" (Jirkal, Papcún, Koza): eight thin stone ledges stepping down the chapel's west end whose shadows,
// on sunny summer afternoons, spell ZA PRAVDU. Each ledge is a letter sheared by the sun's direction (the letter's
// top row against the wall, its foot furthest out), so its shadow on the wall is the upright letter. The scene's sun
// is fixed at that hour, so the shadow is drawn exactly as a shadow-toned overlay too (the city-wide shadow map is
// far too coarse for letters). Block letters on a 4 × 6 grid; outer contour, then holes.
const GLYPHS = {
	Z: [ [ [ 0, 6 ], [ 4, 6 ], [ 4, 5 ], [ 1.4, 1 ], [ 4, 1 ], [ 4, 0 ], [ 0, 0 ], [ 0, 1 ], [ 2.6, 5 ], [ 0, 5 ] ] ],
	A: [ [ [ 0, 0 ], [ 1, 0 ], [ 1.35, 1.5 ], [ 2.65, 1.5 ], [ 3, 0 ], [ 4, 0 ], [ 2.5, 6 ], [ 1.5, 6 ] ], [ [ 1.65, 2.5 ], [ 2, 4.1 ], [ 2.35, 2.5 ] ] ],
	P: [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 2.5 ], [ 4, 2.5 ], [ 4, 6 ], [ 0, 6 ] ], [ [ 1, 3.5 ], [ 1, 5 ], [ 3, 5 ], [ 3, 3.5 ] ] ],
	R: [ [ [ 0, 0 ], [ 1, 0 ], [ 1, 2.5 ], [ 1.8, 2.5 ], [ 3, 0 ], [ 4.1, 0 ], [ 2.9, 2.5 ], [ 4, 2.5 ], [ 4, 6 ], [ 0, 6 ] ], [ [ 1, 3.5 ], [ 1, 5 ], [ 3, 5 ], [ 3, 3.5 ] ] ],
	V: [ [ [ 0, 6 ], [ 1.5, 0 ], [ 2.5, 0 ], [ 4, 6 ], [ 3, 6 ], [ 2, 1.8 ], [ 1, 6 ] ] ],
	D: [ [ [ 0, 0 ], [ 3, 0 ], [ 4, 1 ], [ 4, 5 ], [ 3, 6 ], [ 0, 6 ] ], [ [ 1, 1 ], [ 1, 5 ], [ 2.6, 5 ], [ 3, 4.6 ], [ 3, 1.4 ], [ 2.6, 1 ] ] ],
	U: [ [ [ 0, 6 ], [ 0, 0 ], [ 4, 0 ], [ 4, 6 ], [ 3, 6 ], [ 3, 1 ], [ 1, 1 ], [ 1, 6 ] ] ]
};
// The ledges as photographed: metres from the front's west end, and height of the ledge above the ground.
const ZA_PRAVDU = [ [ 'Z', 2.3, 9.0 ], [ 'A', 3.2, 8.4 ], [ 'P', 2.1, 7.0 ], [ 'R', 1.9, 6.0 ], [ 'A', 3.0, 5.3 ], [ 'V', 4.0, 4.6 ], [ 'D', 3.3, 3.8 ], [ 'U', 4.4, 3.1 ] ];

function addZaPravdu( g, sun ) {

	const U = 0.13, H = 6 * U; // grid unit, letter height
	const ledges = [], shadows = [];
	const shape = ( rings, map ) => {

		const s = new THREE.Shape( rings[ 0 ].map( p => new THREE.Vector2( ...map( p ) ) ) );
		for ( const hole of rings.slice( 1 ) ) s.holes.push( new THREE.Path( hole.map( p => new THREE.Vector2( ...map( p ) ) ) ) );
		return s;

	};

	for ( const [ ch, x0, h ] of ZA_PRAVDU ) {

		const rings = GLYPHS[ ch ];
		// Shadow on the wall: the upright letter, top at the ledge, to the side of and below it.
		const sh = shape( rings, ( [ gx, gy ] ) => [ x0 + gx * U, h - H + gy * U ] );
		shadows.push( new THREE.ShapeGeometry( sh ).translate( 0, 0, 0.16 ) );
		// The ledge: shadow point (u, y) comes from the point on the ledge at depth z = (h − y)·sz/sy, x = u + z·sx/sz.
		const ledge = shape( rings, ( [ gx, gy ] ) => {

			const z = ( H - gy * U ) * sun.z / sun.y;
			return [ x0 + gx * U + z * sun.x / sun.z, z ];

		} );
		// The shape lies in x–y; turn it to lie flat (y → z out of the wall), 6 cm thick, its top at h.
		ledges.push( new THREE.ExtrudeGeometry( ledge, { depth: 0.06, bevelEnabled: false } ).rotateX( Math.PI / 2 ).translate( 0, h, 0.14 ) );

	}

	const stone = plain( 0xc9c3b6, { roughness: 0.85 } );
	new Kit().add( stone, ...ledges ).build( g, { shadows: false } );
	const tone = new THREE.MeshBasicNodeMaterial( { color: 0x2b2f38, transparent: true, opacity: 0.42, depthWrite: false } );
	g.add( new THREE.Mesh( mergeShapes( shadows ), tone ) );

}

function mergeShapes( geos ) {

	const pos = [];
	for ( const geo of geos ) {

		const g2 = geo.index ? geo.toNonIndexed() : geo;
		pos.push( ...g2.attributes.position.array );

	}

	const out = new THREE.BufferGeometry();
	out.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	return out;

}

function addChapel( scene, C ) {

	const [ ax, ay, az ] = C.a, [ bx, , bz ] = C.b;
	const L = Math.hypot( bx - ax, bz - az );
	let ux = ( bx - ax ) / L, uz = ( bz - az ) / L, ox = ax, oz = az;
	// Right-handed frame: x along the front, y up, z out of the wall.
	if ( - uz * C.n[ 0 ] + ux * C.n[ 1 ] < 0 ) {

		ux = - ux;
		uz = - uz;
		ox = bx;
		oz = bz;

	}

	const g = new THREE.Group();
	g.matrix.makeBasis( new THREE.Vector3( ux, 0, uz ), new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( C.n[ 0 ], 0, C.n[ 1 ] ) ).setPosition( ox, ay, oz );
	g.matrixAutoUpdate = false;
	const E = C.eave - ay, half = L / 2, rise = C.slope * half / 2;
	const plaster = plain( 0xf1efe9, { roughness: 0.95 } );
	const sand = ashlar( 0xb9a57e, 0xcbb994 );
	const tile = plain( 0x9c4a34, { roughness: 0.8 } );
	const kit = new Kit();
	kit.add( plaster, box( L, E + 1, 0.14, L / 2, - 1, 0.07 ) );
	for ( let k = 0; k < 2; k ++ ) {

		const x0 = k * half;
		const gable = new THREE.Shape().moveTo( x0, E - 0.05 ).lineTo( x0 + half, E - 0.05 ).lineTo( x0 + half / 2, E + rise ).closePath();
		kit.add( plaster, new THREE.ExtrudeGeometry( gable, { depth: 0.5, bevelEnabled: false } ).translate( 0, 0, - 0.36 ) );
		// Tiled copings along the raking edges.
		const slopeLen = Math.hypot( half / 2, rise ), a = Math.atan2( rise, half / 2 );
		for ( const side of [ - 1, 1 ] ) {

			kit.add( tile, new THREE.BoxGeometry( slopeLen + 0.3, 0.14, 0.62 ).rotateZ( - side * a ).translate( x0 + half / 2 + side * half / 4, E + rise / 2 + 0.07, - 0.1 ) );

		}

		// Small dark openings in the gable: a square one, and narrow slits.
		kit.add( M.black, box( 0.55, 0.7, 0.04, x0 + half / 2, E + rise * 0.48, 0.15 ), box( 0.18, 0.5, 0.04, x0 + half / 2 - 1.3, E + rise * 0.22, 0.15 ), box( 0.18, 0.5, 0.04, x0 + half / 2 + 1.3, E + rise * 0.22, 0.15 ) );

	}

	// The windows: two under each gable.
	const glass = new THREE.MeshStandardNodeMaterial( { map: leaded(), roughness: 0.2, metalness: 0.3 } );
	const wy0 = 3.4, wh = Math.min( 6.4, E - 4.2 ), ww = Math.min( 2.6, half * 0.17 );
	for ( const f of [ 0.5, 0.87, 1.34, 1.74 ] ) { // as photographed

		const x = f * half;
		kit.add( sand, new THREE.ExtrudeGeometry( pointed( ww + 0.5, wh + 0.35 ), { depth: 0.12, bevelEnabled: false, curveSegments: 10 } ).translate( x, wy0 - 0.25, 0.12 ) );
		const pane = new THREE.ShapeGeometry( pointed( ww, wh ), 10 );
		const uv = pane.attributes.uv;
		for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) / ww + 0.5, uv.getY( i ) / wh );
		kit.add( glass, pane.translate( x, wy0, 0.25 ) );
		kit.add( sand, box( ww + 0.6, 0.16, 0.3, x, wy0 - 0.4, 0.15 ) ); // sill

	}

	// Plinth, corner stones, the door and its lamp.
	kit.add( sand, box( L + 0.2, 1.6, 0.3, L / 2, - 1, 0.15 ) );
	for ( const x of [ 0.5, L - 0.5 ] ) kit.add( sand, box( 1.0, E - 0.4, 0.22, x, 0.4, 0.12 ) );
	const dx = 1.9; // the small door at the west end
	kit.add( sand, new THREE.ExtrudeGeometry( pointed( 1.8, 3.1 ), { depth: 0.1, bevelEnabled: false, curveSegments: 8 } ).translate( dx, 0, 0.14 ) );
	kit.add( M.woodDark, new THREE.ShapeGeometry( pointed( 1.3, 2.75 ), 8 ).translate( dx, 0, 0.25 ) );
	kit.build( g );
	const plaque = board( textTexture( [ [ 'BETLÉMSKÁ KAPLE', 92, 80 ], [ 'Bethlehem Chapel · 1391', 46, 170 ] ], { w: 1024, h: 256, bg: '#2a2a28', ink: '#e9e3d2', font: 'Georgia, serif', weight: '700', spacing: 6 } ), 1.2, 0.3 );
	plaque.position.set( dx + 1.9, 1.6, 0.32 );
	g.add( plaque );
	// The sun in the front's frame (x along it, y up, z out).
	addZaPravdu( g, new THREE.Vector3( SUN.x * ux + SUN.z * uz, SUN.y, SUN.x * C.n[ 0 ] + SUN.z * C.n[ 1 ] ) );
	scene.add( g );

	// The spire: where the aerial photo shows it, on the nearer gable roof's ridge.
	const [ px, pz ] = C.spire || [ ox + ux * ( L - half / 2 ) - C.n[ 0 ] * 12, oz + uz * ( L - half / 2 ) - C.n[ 1 ] * 12 ];
	const v = ( px - ox ) * ux + ( pz - oz ) * uz, back = - ( ( px - ox ) * C.n[ 0 ] + ( pz - oz ) * C.n[ 1 ] );
	const ridgeV = v < half ? half / 2 : half * 1.5;
	const sx = ox + ux * ridgeV - C.n[ 0 ] * back, sz = oz + uz * ridgeV - C.n[ 1 ] * back, sy = C.eave + rise - 0.6;
	const copper = plain( 0x5d8a74, { roughness: 0.5, metalness: 0.4, flatShading: true } );
	new Kit().add( copper, cyl( 0.7, 0.75, 1.8, sx, sy, sz, 8 ), cyl( 0.82, 0.82, 0.15, sx, sy + 1.8, sz, 8 ), new THREE.ConeGeometry( 0.78, 6.2, 8 ).translate( sx, sy + 1.95 + 3.1, sz ) )
		.add( M.gold, ball( 0.13, sx, sy + 8.25, sz, 10 ), box( 0.05, 0.7, 0.05, sx, sy + 8.3, sz ), box( 0.4, 0.05, 0.05, sx, sy + 8.75, sz ) ).build( scene );

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
	if ( places.chapel ) addChapel( scene, places.chapel );

	if ( places.sitkov ) addSitkovTower( scene, places.sitkov, waterLevel );
	if ( places.bandstand ) addBandstand( scene, places.bandstand );

}
