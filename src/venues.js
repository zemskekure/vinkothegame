// The three venues, modelled from photographs (positions from tools/places.mjs):
//
//   Hostinec U Rotundy (Karoliny Světlé 17): a cream rusticated ground floor of four round arches with radiating
//   voussoirs; dark green doors, the pub's window in the second arch, fanlights with radial grilles; the red sign with
//   gold letters and a grey relief frieze of figures above; a green bench, a Staropramen A-board. Inside: a vaulted
//   white room with a dark red-brown dado, terrazzo floor with a runner, long pine tables with red-and-white checked
//   cloths, spindle-back chairs, a brown tiled stove, the bar niche with bottles, framed prints, coat-hook rails, a
//   clock, the round Staropramen plaque over the doorway to the back room, an aluminium duct along the vault.
//
//   Standard Café (Karoliny Světlé 23): beige rusticated ground floor, grey-blue shopfronts with open shutters, the
//   door between them with a lattice gate swung open, three black awnings with STANDARD CAFE, white barrel planters
//   with ivy, folding teak tables and white bistro tables, a young tree. Inside: bottle shelves behind the bar.
//
//   Champagneria (Průchodní 4): a weathered ochre wall with patches of bare stone and graffiti facing the little
//   square, the black doorway with white glazed double doors and steps at its east end; folding black chairs at small
//   wooden tables with dark grey parasols on a chequered paving strip; a round bench around the square's tree. Inside:
//   black floorboards, white walls, a raw pine ceiling, a beech bar on a black base, a wall of corks behind it with
//   lit glass shelves and blackboards, pendant bottle lamps, black sconces, narrow ledges with stools.
//
// Fronts are built in a frame on the house front (src/places.js onFront): x to the right seen from the street,
// y up, z out of the wall.

import * as THREE from 'three/webgpu';
import { color, positionLocal, mix, float, vec2, floor, fract, abs, max, smoothstep, step } from 'three/tsl';
import { hash2D, noise2D } from './shading/common.js';
import { Kit, M, plain, glow, box, cyl, ball, onFront, textTexture, board, planks, tiles, roomWall } from './kit.js';

// ---------------------------------------------------------------------------
// Materials

const tex = ( draw, w, h, repeat ) => {

	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	draw( canvas.getContext( '2d' ), w, h );
	const t = new THREE.CanvasTexture( canvas );
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 4;
	if ( repeat ) {

		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.repeat.set( ...repeat );

	}

	return t;

};

const mapped = ( map, opts = {} ) => new THREE.MeshStandardNodeMaterial( { map, roughness: 0.8, ...opts } );

// Room surfaces lit from within (a warm glow instead of a point light, which every surface would pay for).
const lit = ( m, k = 0.35 ) => {

	m.emissiveNode = ( m.colorNode || color( m.color ) ).mul( k );
	return m;

};

let seed = 7;
const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;

// Banded rustication: courses `course` high with deep grooves, blocks `block` long (staggered), cream sandstone.
function rustication( base, course = 0.42, block = 0.86, vertical = true ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.85 } );
	const p = positionLocal;
	const row = p.y.div( course );
	const along = p.x.div( block ).add( floor( row ).mul( 0.5 ) );
	const groove = smoothstep( 0.4, 0.5, abs( fract( row ).sub( 0.5 ) ) );
	const joint = vertical ? smoothstep( 0.44, 0.5, abs( fract( along ).sub( 0.5 ) ) ) : float( 0 );
	const tone = color( base ).mul( mix( float( 0.93 ), float( 1.05 ), hash2D( vec2( floor( along ), floor( row ) ) ) ) ).mul( mix( float( 0.94 ), float( 1.03 ), noise2D( p.xy.mul( 3 ) ) ) );
	m.colorNode = mix( tone, color( base ).mul( 0.62 ), max( groove, joint ).mul( 0.85 ) );
	return m;

}

const GREEN = 0x2f4a36, GREEN_DARK = 0x223629;
const MAT = {
	green: plain( GREEN, { roughness: 0.5 } ),
	greenDark: plain( GREEN_DARK, { roughness: 0.5 } ),
	glassWarm: glow( 0xf3d9a8, 0.35 ),
	glassDark: plain( 0x26313a, { roughness: 0.08, metalness: 0.35 } ),
	greyBlue: plain( 0x8a9db0, { roughness: 0.55 } ),
	black: plain( 0x161616, { roughness: 0.6 } ),
	white: plain( 0xeeeeea, { roughness: 0.5 } ),
	teak: plain( 0x9a5b33, { roughness: 0.65 } ),
	pine: plain( 0xb98a55, { roughness: 0.6 } ),
	beech: plain( 0xd9b27a, { roughness: 0.45 } ),
	stone: plain( 0xc9bda5, { roughness: 0.9 } ),
	awning: plain( 0x1b1b1d, { roughness: 0.9, side: THREE.DoubleSide } ),
	parasol: plain( 0x3a3b3e, { roughness: 0.9, side: THREE.DoubleSide } ),
	chrome: M.chrome,
	ivy: plain( 0x3f6a2e, { roughness: 0.9, flatShading: true } ),
	leafLight: plain( 0x7da34a, { roughness: 0.9, flatShading: true } ),
	brownTile: plain( 0x4a2a1c, { roughness: 0.3 } ),
	duct: plain( 0xb9bcbf, { metalness: 0.8, roughness: 0.35 } ),
	frame: plain( 0x2a1c12, { roughness: 0.6 } )
};

// Red-and-white gingham.
const gingham = tex( ( c, w, h ) => {

	c.fillStyle = '#fff';
	c.fillRect( 0, 0, w, h );
	c.fillStyle = 'rgba(200,30,40,0.55)';
	for ( let i = 0; i < 8; i ++ ) {

		c.fillRect( i * w / 8, 0, w / 16, h );
		c.fillRect( 0, i * h / 8, w, h / 16 );

	}

}, 64, 64 );

// A sepia print in a frame, varied.
function printTexture( k ) {

	return tex( ( c, w, h ) => {

		seed = 101 + k * 17;
		c.fillStyle = [ '#d8c9a8', '#cbbd9e', '#e4d8bd' ][ k % 3 ];
		c.fillRect( 0, 0, w, h );
		c.fillStyle = 'rgba(70,50,30,0.55)';
		for ( let i = 0; i < 14; i ++ ) c.fillRect( rnd() * w, h * 0.3 + rnd() * h * 0.6, 4 + rnd() * w * 0.3, 3 + rnd() * h * 0.3 );
		c.beginPath();
		c.arc( w * 0.5, h * 0.35, w * 0.18, 0, Math.PI * 2 );
		c.fill();

	}, 64, 80 );

}

// ---------------------------------------------------------------------------
// Furniture

function chairAt( kit, x, y, z, rot, kind ) {

	const g = [];
	const add = ( mat, geo ) => g.push( [ mat, geo ] );
	if ( kind === 'spindle' ) {

		add( MAT.frame, box( 0.42, 0.05, 0.42, 0, 0.44, 0 ) );
		for ( const a of [ - 0.17, 0.17 ] ) for ( const b of [ - 0.17, 0.17 ] ) add( MAT.frame, cyl( 0.018, 0.022, 0.44, a, 0, b, 6 ) );
		add( MAT.frame, box( 0.42, 0.05, 0.05, 0, 0.86, 0.2 ) );
		for ( let k = - 2; k <= 2; k ++ ) add( MAT.frame, cyl( 0.01, 0.01, 0.38, k * 0.08, 0.49, 0.2, 5 ) );

	} else if ( kind === 'foldBlack' || kind === 'foldWood' ) {

		const mat = kind === 'foldBlack' ? MAT.black : MAT.teak;
		for ( let k = - 2; k <= 2; k ++ ) add( mat, box( 0.4, 0.02, 0.07, 0, 0.45, k * 0.08 ) );
		for ( let k = 0; k < 3; k ++ ) add( mat, box( 0.4, 0.06, 0.02, 0, 0.58 + k * 0.1, 0.2 + k * 0.012 ) );
		for ( const a of [ - 0.19, 0.19 ] ) {

			add( kind === 'foldBlack' ? MAT.black : MAT.teak, box( 0.025, 0.95, 0.03, a, 0, 0.0 ).rotateX( - 0.22 ).translate( 0, 0, 0.12 ) );
			add( kind === 'foldBlack' ? MAT.black : MAT.teak, box( 0.025, 0.5, 0.03, a, 0, 0 ).rotateX( 0.4 ).translate( 0, 0, - 0.1 ) );

		}

	} else if ( kind === 'bistroWhite' ) {

		add( MAT.white, cyl( 0.2, 0.2, 0.03, 0, 0.45, 0, 16 ) );
		for ( const a of [ - 0.15, 0.15 ] ) for ( const b of [ - 0.15, 0.15 ] ) add( MAT.white, cyl( 0.012, 0.012, 0.45, a, 0, b, 5 ) );
		for ( const a of [ - 0.16, 0.16 ] ) add( MAT.white, cyl( 0.012, 0.012, 0.4, a, 0.46, 0.17, 5 ) );
		for ( const y of [ 0.62, 0.78 ] ) add( MAT.white, box( 0.34, 0.02, 0.015, 0, y, 0.17 ) );

	} else if ( kind === 'stool' ) {

		add( MAT.black, box( 0.34, 0.04, 0.34, 0, 0.74, 0 ) );
		for ( const a of [ - 0.14, 0.14 ] ) for ( const b of [ - 0.14, 0.14 ] ) add( MAT.black, box( 0.03, 0.74, 0.03, a, 0, b ) );
		for ( const a of [ - 0.14, 0.14 ] ) add( MAT.black, box( 0.03, 0.03, 0.3, a, 0.25, 0 ) );

	}

	for ( const [ mat, geo ] of g ) kit.add( mat, geo.rotateY( rot ).translate( x, y, z ) );

}

function tableAt( kit, x, y, z, rot, kind ) {

	const g = [];
	const add = ( mat, geo ) => g.push( [ mat, geo ] );
	if ( kind === 'pubLong' ) {

		add( MAT.pine, box( 1.6, 0.05, 0.8, 0, 0.72, 0 ) );
		for ( const a of [ - 0.7, 0.7 ] ) for ( const b of [ - 0.32, 0.32 ] ) add( MAT.frame, box( 0.06, 0.72, 0.06, a, 0, b ) );
		add( mapped( gingham, { roughness: 0.9 } ), box( 0.45, 0.004, 0.45, - 0.3, 0.77, 0 ) );
		add( mapped( gingham, { roughness: 0.9 } ), box( 0.45, 0.004, 0.45, 0.35, 0.77, 0.05 ) );

	} else if ( kind === 'fold' || kind === 'champagne' ) {

		add( kind === 'fold' ? MAT.teak : MAT.pine, box( 0.6, 0.03, 0.6, 0, 0.72, 0 ) );
		// Crossed legs at either end.
		for ( const s of [ - 1, 1 ] ) for ( const zz of [ - 0.22, 0.22 ] ) add( kind === 'fold' ? MAT.teak : MAT.black, new THREE.BoxGeometry( 0.03, 0.95, 0.04 ).rotateZ( s * 0.65 ).translate( 0, 0.36, zz ) );

	} else if ( kind === 'bistro' ) {

		add( MAT.white, cyl( 0.32, 0.32, 0.03, 0, 0.72, 0, 24 ) );
		for ( let k = 0; k < 3; k ++ ) add( MAT.white, box( 0.025, 0.75, 0.025, 0, 0, 0 ).rotateZ( 0.12 ).rotateY( k * Math.PI * 2 / 3 ) );

	}

	for ( const [ mat, geo ] of g ) if ( geo ) kit.add( mat, geo.rotateY( rot ).translate( x, y, z ) );

}

const mug = ( kit, x, y, z ) => kit.add( M.beer, cyl( 0.045, 0.045, 0.13, x, y, z, 10 ) ).add( M.foam, cyl( 0.047, 0.047, 0.03, x, y + 0.13, z, 10 ) );
const flute = ( kit, x, y, z ) => kit.add( MAT.glassWarm, cyl( 0.03, 0.02, 0.14, x, y + 0.12, z, 8 ), cyl( 0.004, 0.004, 0.12, x, y, z, 4 ), cyl( 0.03, 0.03, 0.005, x, y, z, 8 ) );
const bottle = ( kit, x, y, z, mat = M.bottle ) => kit.add( mat, cyl( 0.038, 0.038, 0.2, x, y, z, 8 ), cyl( 0.014, 0.038, 0.1, x, y + 0.2, z, 8 ) );
const bucket = ( kit, x, y, z ) => {

	kit.add( M.chrome, cyl( 0.1, 0.08, 0.2, x, y, z, 12 ) );
	bottle( kit, x, y + 0.05, z );
	kit.add( M.gold, cyl( 0.016, 0.016, 0.06, x, y + 0.33, z, 6 ) );

};

function addTables( kit, terrace, seats ) {

	for ( const [ x, y, z, rot, kind ] of terrace.tables ) {

		tableAt( kit, x, y, z, rot, kind );
		const ux = Math.sin( rot ), uz = Math.cos( rot );
		const chairKind = { fold: 'foldWood', bistro: 'bistroWhite', champagne: 'foldBlack' }[ kind ] || 'foldWood';
		for ( const side of [ - 1, 1 ] ) chairAt( kit, x + ux * 0.55 * side, y, z + uz * 0.55 * side, Math.atan2( ux * side, uz * side ), chairKind );
		if ( kind === 'champagne' ) {

			bucket( kit, x + 0.1, y + 0.74, z );
			flute( kit, x - 0.15, y + 0.74, z + 0.1 );

		} else flute( kit, x, y + 0.74, z );

	}

}

// A square parasol (pole and four-sided canopy).
const parasol = ( kit, x, y, z, rot, size = 2.2 ) => kit.add( MAT.black, cyl( 0.025, 0.025, 2.35, x, y, z, 6 ) ).add( MAT.parasol, new THREE.ConeGeometry( size * 0.72, 0.38, 4, 1, true ).rotateY( Math.PI / 4 + rot ).translate( x, y + 2.35 + 0.12, z ) );

// ---------------------------------------------------------------------------
// Hostinec U Rotundy

// The relief frieze: grey figures in procession, lit from above-left.
const frieze = tex( ( c, w, h ) => {

	seed = 33;
	const g = c.createLinearGradient( 0, 0, 0, h );
	g.addColorStop( 0, '#a7a8a3' );
	g.addColorStop( 1, '#8e908b' );
	c.fillStyle = g;
	c.fillRect( 0, 0, w, h );
	c.strokeStyle = '#b9bab4';
	c.lineWidth = 6;
	c.strokeRect( 3, 3, w - 6, h - 6 );
	for ( let x = 30; x < w - 20; x += 34 + rnd() * 26 ) {

		const s = 0.8 + rnd() * 0.35, bx = x, by = h * 0.92;
		for ( const [ col, dx, dy ] of [ [ '#6f716c', 3, 3 ], [ '#d5d6d0', 0, 0 ] ] ) {

			c.fillStyle = col;
			c.beginPath();
			c.arc( bx + dx, by - 84 * s + dy, 9 * s, 0, Math.PI * 2 ); // head
			c.fill();
			c.beginPath();
			c.moveTo( bx - 12 * s + dx, by - 72 * s + dy );
			c.lineTo( bx + 12 * s + dx, by - 72 * s + dy );
			c.lineTo( bx + 16 * s + dx + rnd() * 6, by + dy );
			c.lineTo( bx - 16 * s + dx - rnd() * 6, by + dy );
			c.closePath();
			c.fill(); // robe
			c.lineWidth = 6 * s;
			c.strokeStyle = col;
			c.beginPath();
			c.moveTo( bx + dx, by - 66 * s + dy );
			c.lineTo( bx + ( rnd() - 0.3 ) * 34 * s + dx, by - ( 40 + rnd() * 50 ) * s + dy );
			c.stroke(); // an arm, raised or carrying

		}

	}

}, 1024, 128 );

function addPubFront( scene, F ) {

	const g = onFront( F.x, F.y, F.z, F.n );
	scene.add( g );
	const kit = new Kit();
	const W = F.width + 0.6, bay = F.bay, H = 4.6;
	const ow = Math.min( 2.2, bay - 0.8 ), spring = 2.9, r = ow / 2;
	const arches = [ - 1.5, - 0.5, 0.5, 1.5 ].map( k => k * bay );

	// Rusticated wall with the four arched openings, standing just proud of the house front.
	const shape = new THREE.Shape().moveTo( - W / 2, 0 ).lineTo( W / 2, 0 ).lineTo( W / 2, H ).lineTo( - W / 2, H ).closePath();
	for ( const cx of arches ) {

		const hole = new THREE.Path().moveTo( cx - r, 0 ).lineTo( cx + r, 0 ).lineTo( cx + r, spring );
		hole.absarc( cx, spring, r, 0, Math.PI, false );
		hole.lineTo( cx - r, 0 );
		shape.holes.push( hole );

	}

	kit.add( rustication( 0xe4d4b2 ), new THREE.ExtrudeGeometry( shape, { depth: 0.24, bevelEnabled: false, curveSegments: 20 } ) );
	kit.add( MAT.stone, box( W + 0.1, 0.18, 0.36, 0, H, 0 ) ); // cornice over the ground floor
	// Voussoirs radiating round each arch, the keystone taller.
	const vous = rustication( 0xe9dbbb, 10, 10, false );
	for ( const cx of arches ) {

		for ( let k = 0; k <= 10; k ++ ) {

			const a = Math.PI * k / 10, len = k === 5 ? 0.78 : 0.58;
			kit.add( vous, new THREE.BoxGeometry( 0.27, len, 0.3 ).translate( 0, r + len / 2 + 0.02, 0.14 ).rotateZ( Math.PI / 2 - a ).translate( cx, spring, 0 ) );

		}

	}

	// What fills each arch: the open door (the room's door), the pub window, a double door, the ornate door.
	const ext = new Kit();
	arches.forEach( ( cx, i ) => {

		// Fanlight: dark glass with a radial grille.
		ext.add( MAT.glassDark, new THREE.CircleGeometry( r, 24, 0, Math.PI ).translate( cx, spring, 0.05 ) );
		for ( let k = 1; k < 8; k ++ ) ext.add( MAT.greenDark, new THREE.BoxGeometry( 0.035, r, 0.03 ).translate( 0, r / 2, 0 ).rotateZ( Math.PI / 2 - Math.PI * k / 8 ).translate( cx, spring, 0.07 ) );
		ext.add( MAT.greenDark, new THREE.TorusGeometry( r * 0.42, 0.025, 4, 16, Math.PI ).translate( cx, spring, 0.07 ), box( ow, 0.1, 0.1, cx, spring - 0.05, 0.05 ) );
		if ( i === 0 ) {

			// Door frame with the right-hand leaf open into the pub; a fixed leaf on the left.
			ext.add( MAT.green, box( ow - 1.32, spring - 0.05, 0.08, cx - 0.66 - ( ow - 1.32 ) / 2 + 0.0, 0, 0.04 ) );
			ext.add( MAT.green, box( 0.08, spring, 0.12, cx + 0.69, 0, 0.04 ), box( 0.08, spring, 0.12, cx - 0.69, 0, 0.04 ) );
			ext.add( MAT.green, new THREE.BoxGeometry( 1.25, 2.45, 0.05 ).translate( 0.62, 1.22, 0 ).rotateY( 1.35 ).translate( cx + 0.62 - 1.25, 0, - 0.3 ) );
			ext.add( MAT.stone, box( ow + 0.3, 0.15, 0.5, cx, - 0.12, 0.3 ) ); // step

		} else if ( i === 1 ) {

			// The pub window: green frame, lit display behind glass, a green panel below.
			ext.add( MAT.green, box( ow, 0.9, 0.12, cx, 0, 0.04 ) );
			ext.add( MAT.glassWarm, box( ow - 0.2, spring - 1.05, 0.04, cx, 0.95, 0.02 ) );
			ext.add( MAT.green, box( ow, 0.1, 0.14, cx, 0.9, 0.05 ), box( 0.08, spring - 0.9, 0.14, cx - r + 0.04, 0.9, 0.05 ), box( 0.08, spring - 0.9, 0.14, cx + r - 0.04, 0.9, 0.05 ), box( 0.05, spring - 1.0, 0.1, cx, 0.95, 0.05 ) );
			for ( let k = 0; k < 4; k ++ ) ext.add( [ M.beer, M.velvet, M.pot, MAT.ivy ][ k ], box( 0.16, 0.22, 0.12, cx - 0.5 + k * 0.33, 1.0, - 0.05 ) );

		} else {

			// Panelled double doors (the last one patterned like the photo's ornamental door).
			for ( const s of [ - 1, 1 ] ) {

				ext.add( MAT.green, box( ow / 2 - 0.02, spring - 0.05, 0.1, cx + s * ow / 4, 0, 0.03 ) );
				for ( const y of [ 0.3, 1.45 ] ) ext.add( MAT.greenDark, box( ow / 2 - 0.3, 0.95, 0.04, cx + s * ow / 4, y, 0.1 ) );
				if ( i === 3 ) for ( let k = 0; k < 4; k ++ ) ext.add( M.brass, ball( 0.045, cx + s * ow / 4, 0.55 + k * 0.5, 0.13, 6 ) );

			}

			ext.add( M.brass, ball( 0.04, cx - 0.08, 1.15, 0.14, 6 ), ball( 0.04, cx + 0.08, 1.15, 0.14, 6 ) );

		}

	} );

	// The sign: red board, gold serif letters, over the middle of the arcade; the frieze above.
	const signW = Math.min( 1.7 * bay, 5.4 );
	const signTex = textTexture( [ [ 'HOSTINEC u ROTUNDY', 160 ] ], { w: 1536, h: Math.round( 1536 * 0.62 / signW ), bg: '#c4552c', ink: '#f2cf6a', border: '#e9b44a', font: 'Georgia, "Times New Roman", serif', weight: '700' } );
	const sign = board( signTex, signW, 0.62 );
	sign.position.set( - 0.15 * bay, H - 0.38, 0.4 );
	g.add( sign );
	ext.add( MAT.frame, box( signW + 0.08, 0.7, 0.05, - 0.15 * bay, H - 0.73, 0.36 ) );
	const fr = board( frieze, W - 0.3, 1.05 );
	fr.position.set( 0, H + 0.95, 0.06 );
	g.add( fr );
	const numbers = textTexture( [ [ '1035', 90 ] ], { w: 256, h: 128, bg: '#b8302b', ink: '#fff', font: 'Arial, sans-serif' } );
	const n1 = board( numbers, 0.36, 0.18 );
	n1.position.set( 0.85 * bay, H - 0.35, 0.26 );
	const n2 = board( textTexture( [ [ '17', 90 ] ], { w: 128, h: 128, bg: '#1f4f9a', ink: '#fff', font: 'Arial, sans-serif' } ), 0.18, 0.18 );
	n2.position.set( 0.85 * bay + 0.3, H - 0.35, 0.26 );
	g.add( n1, n2 );

	// A green bench before the window, a Staropramen A-board by the door.
	const cx1 = arches[ 1 ];
	ext.add( MAT.green, box( 1.6, 0.05, 0.34, cx1, 0.45, 0.45 ), box( 1.6, 0.04, 0.05, cx1, 0.1, 0.45 ) );
	for ( const s of [ - 0.7, 0.7 ] ) ext.add( MAT.greenDark, box( 0.05, 0.45, 0.34, cx1 + s, 0, 0.45 ) );
	const aBoard = board( textTexture( [ [ 'Staropramen', 64, 60 ], [ 'polévka · guláš', 44, 170 ], [ 'pivo 10° 12°', 44, 240 ] ], { w: 256, h: 340, bg: '#1d1d1d', ink: '#f1efe6', font: 'Georgia, serif', weight: '600' } ), 0.52, 0.7, { material: { side: THREE.DoubleSide } } );
	aBoard.position.set( arches[ 0 ] - r - 0.5, 0.42, 0.5 );
	aBoard.rotation.x = - 0.15;
	g.add( aBoard );
	ext.add( plain( 0xc0392b ), box( 0.56, 0.12, 0.05, arches[ 0 ] - r - 0.5, 0.75, 0.52 ) );

	kit.build( g );
	ext.build( g );

}

function addPubInterior( g, room, kit, seat ) {

	const { w, d, h } = room;
	const wallMat = lit( roomWall( 0xf1e5d2, 0x5b2a1f, 1.2 ) );
	const terrazzo = new THREE.MeshStandardNodeMaterial( { roughness: 0.5 } );
	{

		const p = positionLocal;
		const speck = step( 0.82, hash2D( floor( p.xz.mul( 60 ) ) ) ).mul( 0.25 );
		const runner = smoothstep( 0.62, 0.58, abs( p.x ) );
		const grid = max( smoothstep( 0.47, 0.5, abs( fract( p.x.div( 0.3 ) ).sub( 0.5 ) ) ), smoothstep( 0.47, 0.5, abs( fract( p.z.div( 0.3 ) ).sub( 0.5 ) ) ) );
		terrazzo.colorNode = mix( mix( color( 0xd8cfba ), color( 0x8a7a68 ), speck ).mul( mix( float( 1 ), float( 0.86 ), grid ) ), mix( color( 0x8e4a3a ), color( 0x5a2c22 ), speck.mul( 2 ) ), runner );

	}

	lit( terrazzo, 0.25 );
	kit.add( terrazzo, box( w, 0.04, d, 0, - 0.04, - d / 2 ) );
	kit.add( wallMat, box( w, h, 0.08, 0, 0, - d ), box( 0.08, h, d, - w / 2, 0, - d / 2 ), box( 0.08, h, d, w / 2, 0, - d / 2 ) );

	// Segmental vault across the room.
	const vault = new THREE.PlaneGeometry( w, d, 16, 1 ).rotateX( Math.PI / 2 );
	const pos = vault.attributes.position;
	for ( let i = 0; i < pos.count; i ++ ) {

		const x = pos.getX( i ) / ( w / 2 );
		pos.setY( i, h - 0.55 + 0.55 * ( 1 - x * x ) );

	}

	vault.translate( 0, 0, - d / 2 );
	vault.computeVertexNormals();
	kit.add( lit( plain( 0xf3ead9, { side: THREE.DoubleSide } ), 0.45 ), vault );
	kit.add( MAT.duct, new THREE.CylinderGeometry( 0.16, 0.16, d - 0.3, 14 ).rotateX( Math.PI / 2 ).translate( w / 2 - 0.5, h - 0.35, - d / 2 ) );

	// Long pine tables across the room with gingham cloths, chairs on both sides; mugs.
	const rows = Math.max( 1, Math.floor( ( d - 2.0 ) / 1.75 ) );
	for ( let i = 0; i < rows; i ++ ) {

		const z = - 1.35 - i * 1.75;
		for ( const x of w > 5 ? [ - w / 2 + 1.0, w / 2 - 1.15 ] : [ w / 2 - 1.15 ] ) {

			tableAt( kit, x, 0, z, 0, 'pubLong' );
			for ( const dx of [ - 0.45, 0.45 ] ) {

				chairAt( kit, x + dx, 0, z - 0.6, Math.PI, 'spindle' );
				chairAt( kit, x + dx, 0, z + 0.6, 0, 'spindle' );
				seat( x + dx, z - 0.6, Math.PI );
				seat( x + dx, z + 0.6, 0 );
				mug( kit, x + dx, 0.77, z + ( dx > 0 ? 0.15 : - 0.15 ) );

			}

		}

	}

	// Back wall: the doorway to the back room (warm), the Staropramen plaque above it, the clock.
	kit.add( MAT.frame, box( 1.3, 0.12, 0.12, 0, 2.3, - d + 0.06 ), box( 0.12, 2.3, 0.12, - 0.6, 0, - d + 0.06 ), box( 0.12, 2.3, 0.12, 0.6, 0, - d + 0.06 ) );
	const backRoom = board( tex( ( c, W2, H2 ) => {

		c.fillStyle = '#e9d5b2';
		c.fillRect( 0, 0, W2, H2 );
		c.fillStyle = '#6a3a24';
		c.fillRect( 0, H2 * 0.55, W2, H2 * 0.45 );
		c.fillStyle = '#4a2c1a';
		c.fillRect( W2 * 0.2, H2 * 0.62, W2 * 0.5, H2 * 0.1 );
		for ( let k = 0; k < 4; k ++ ) c.fillRect( W2 * ( 0.1 + k * 0.22 ), H2 * ( 0.15 + ( k % 2 ) * 0.1 ), W2 * 0.12, H2 * 0.14 );

	}, 64, 128 ), 1.1, 2.25, { material: { emissive: 0x6b4a2a, emissiveIntensity: 0.6 } } );
	backRoom.position.set( 0, 1.12, - d + 0.05 );
	g.add( backRoom );
	const plaque = board( textTexture( [ [ 'Staropramen', 70, 128 ], [ 'NEPASTER', 34, 190 ] ], { w: 256, h: 256, bg: '#5a3a1e', ink: '#e4c27a', font: 'Georgia, serif' } ), 0.62, 0.62, { transparent: false } );
	plaque.position.set( 0, 2.85, - d + 0.06 );
	g.add( plaque );
	kit.add( M.gold, new THREE.TorusGeometry( 0.31, 0.02, 6, 32 ).translate( 0, 2.85, - d + 0.07 ) );
	// The round wall clock hangs on the back wall (turned to face the room first, then moved there: turned after
	// the move it swung out through the front and hung in the street as a floating disc).
	kit.add( MAT.frame, cyl( 0.2, 0.2, 0.05, 0, 0, 0, 20 ).rotateX( Math.PI / 2 ).translate( w / 2 - 1.6, 2.3, - d + 0.06 ) );

	// Left wall: the bar niche (dark frame, bottle shelves), the brown tiled stove with its flue, menu blackboards.
	const lx = - w / 2 + 0.05;
	kit.add( MAT.frame, box( 0.12, 2.3, 1.4, lx, 0, - 1.2 ) );
	kit.add( MAT.glassDark, box( 0.05, 2.0, 1.1, lx + 0.02, 0.1, - 1.2 ) );
	for ( const y of [ 0.9, 1.3, 1.7 ] ) {

		kit.add( MAT.frame, box( 0.2, 0.03, 1.0, lx + 0.12, y, - 1.2 ) );
		for ( let k = 0; k < 6; k ++ ) bottle( kit, lx + 0.12, y + 0.03, - 1.6 + k * 0.16, [ M.bottle, M.beer, MAT.glassWarm ][ k % 3 ] );

	}

	kit.add( MAT.brownTile, box( 0.55, 1.9, 0.55, lx + 0.3, 0, - 2.4 ) );
	kit.add( MAT.duct, cyl( 0.07, 0.07, h - 1.9, lx + 0.3, 1.9, - 2.4, 10 ) );
	for ( const [ z, text ] of [ [ - 3.4, [ 'Espresso', 'Káva turecká', 'Čaj dle výběru' ] ], [ - 4.3, [ 'Slivovice', 'Hruškovice', 'Meruňkovice', 'Fernet' ] ] ] ) {

		if ( - z > d - 0.5 ) continue;
		const bb = board( textTexture( text.map( ( t, i ) => [ t, 40, 60 + i * 56 ] ), { w: 256, h: 300, bg: '#1b2b2a', ink: '#f0a0b8', font: '"Comic Sans MS", cursive' } ), 0.55, 0.65 );
		bb.position.set( lx + 0.06, 1.85, z );
		bb.rotation.y = Math.PI / 2;
		g.add( bb );

	}

	// Framed prints, coat-hook rails, a mirror and a clock on the right wall.
	const rx = w / 2 - 0.06;
	for ( let k = 0; k < 7; k ++ ) {

		const z = - 0.9 - k * ( d - 1.6 ) / 7, y = 1.75 + ( k % 3 ) * 0.28, s = 0.25 + ( k % 2 ) * 0.12;
		kit.add( MAT.frame, box( 0.03, s * 1.25, s, rx, y, z ) );
		const pr = board( printTexture( k ), s * 0.8, s );
		pr.position.set( rx - 0.025, y + s * 0.625, z );
		pr.rotation.y = - Math.PI / 2;
		g.add( pr );

	}

	for ( const z of [ - 1.5, - 3.3 ] ) {

		kit.add( MAT.white, box( 0.03, 0.08, 0.9, rx, 1.55, z ) );
		for ( let k = 0; k < 5; k ++ ) kit.add( MAT.black, box( 0.08, 0.02, 0.02, rx - 0.04, 1.58, z - 0.36 + k * 0.18 ) );

	}

	kit.add( MAT.frame, box( 0.03, 0.4, 0.95, rx, 1.3, - d + 1.3 ) ).add( MAT.glassDark, box( 0.035, 0.34, 0.88, rx - 0.005, 1.33, - d + 1.3 ) );
	const clock = board( textTexture( [ [ '·', 10 ] ], { w: 64, h: 64, bg: '#f2efe6', ink: '#111' } ), 0.32, 0.32 );
	clock.position.set( rx - 0.03, 2.6, - 2.2 );
	clock.rotation.y = - Math.PI / 2;
	g.add( clock );

	// Track light with bulbs in the vault.
	kit.add( MAT.black, box( 0.04, 0.04, 1.4, 0, h - 0.05, - d / 2 ) );
	for ( const z of [ - d / 2 - 0.5, - d / 2, - d / 2 + 0.5 ] ) kit.add( M.bulb, ball( 0.06, 0, h - 0.25, z, 8 ) );

}

// ---------------------------------------------------------------------------
// Standard Café

const awningTex = ( logo ) => tex( ( c, w, h ) => {

	c.fillStyle = '#1b1b1d';
	c.fillRect( 0, 0, w, h );
	c.fillStyle = '#f2f0ea';
	c.textAlign = 'center';
	c.textBaseline = 'middle';
	if ( logo ) {

		c.strokeStyle = '#f2f0ea';
		c.lineWidth = 4;
		c.beginPath();
		c.ellipse( w / 2, h * 0.38, w * 0.16, h * 0.2, 0, 0, Math.PI * 2 );
		c.stroke();
		c.font = `600 ${ h * 0.12 }px "Helvetica Neue", Arial, sans-serif`;
		c.fillText( 'standard', w / 2, h * 0.38 );

	}

	c.font = `600 ${ h * 0.15 }px "Helvetica Neue", Arial, sans-serif`;
	c.fillText( 'STANDARD CAFE', w / 2, h * 0.85 );

}, 512, 256 );

function addCafeFront( scene, F ) {

	const g = onFront( F.x, F.y, F.z, F.n );
	scene.add( g );
	const kit = new Kit();
	const L = - F.left + 0.1, R = F.right - 0.1, H = 3.7;
	const openings = [ { x: Math.max( L + 1.05, - 2.0 ), w: 1.6, y0: 0.55, y1: 2.55, kind: 'window' }, { x: 0, w: 1.3, y0: 0, y1: 2.7, kind: 'door' }, { x: Math.min( R - 1.05, 2.15 ), w: 1.5, y0: 0.55, y1: 2.55, kind: 'window' } ];

	const shape = new THREE.Shape().moveTo( L, 0 ).lineTo( R, 0 ).lineTo( R, H ).lineTo( L, H ).closePath();
	for ( const o of openings ) shape.holes.push( new THREE.Path().moveTo( o.x - o.w / 2, o.y0 ).lineTo( o.x + o.w / 2, o.y0 ).lineTo( o.x + o.w / 2, o.y1 ).lineTo( o.x - o.w / 2, o.y1 ).closePath() );
	kit.add( rustication( 0xe2d5b6, 0.55, 40, false ), new THREE.ExtrudeGeometry( shape, { depth: 0.18, bevelEnabled: false } ) );
	kit.add( MAT.stone, box( R - L, 0.16, 0.3, ( L + R ) / 2, H, 0 ) );

	const logo = tex( ( c, w, h ) => {

		c.strokeStyle = 'rgba(240,240,236,0.8)';
		c.lineWidth = 5;
		c.beginPath();
		c.arc( w / 2, h / 2, w * 0.36, 0, Math.PI * 2 );
		c.stroke();
		c.fillStyle = 'rgba(240,240,236,0.85)';
		c.textAlign = 'center';
		c.font = `600 ${ w * 0.12 }px "Helvetica Neue", Arial, sans-serif`;
		c.fillText( 'STANDARD', w / 2, h * 0.53 );
		c.font = `400 ${ w * 0.08 }px "Helvetica Neue", Arial, sans-serif`;
		c.fillText( 'café', w / 2, h * 0.64 );

	}, 256, 256 );

	for ( const o of openings ) {

		if ( o.kind === 'window' ) {

			kit.add( MAT.greyBlue, box( o.w + 0.1, o.y0 + 0.05, 0.12, o.x, 0, 0.05 ) ); // panel below
			kit.add( MAT.glassDark, box( o.w - 0.1, o.y1 - o.y0 - 0.1, 0.03, o.x, o.y0 + 0.05, 0.02 ) );
			kit.add( MAT.greyBlue, box( o.w, 0.08, 0.12, o.x, o.y1 - 0.08, 0.05 ), box( 0.06, o.y1 - o.y0, 0.12, o.x - o.w / 2 + 0.03, o.y0, 0.05 ), box( 0.06, o.y1 - o.y0, 0.12, o.x + o.w / 2 - 0.03, o.y0, 0.05 ) );
			const l = board( logo, 0.9, 0.9, { transparent: true } );
			l.position.set( o.x, ( o.y0 + o.y1 ) / 2, 0.06 );
			g.add( l );
			// Shutters swung open against the wall.
			for ( const s of [ - 1, 1 ] ) kit.add( MAT.greyBlue, new THREE.BoxGeometry( o.w / 2, o.y1 - o.y0, 0.04 ).translate( s * o.w / 4, ( o.y0 + o.y1 ) / 2, 0 ).rotateY( s * 1.45 ).translate( o.x + s * o.w / 2, 0, 0.22 ) );

		} else {

			kit.add( MAT.greyBlue, box( 0.08, o.y1, 0.14, o.x - o.w / 2, 0, 0.04 ), box( 0.08, o.y1, 0.14, o.x + o.w / 2, 0, 0.04 ), box( o.w, 0.1, 0.14, o.x, o.y1 - 0.1, 0.04 ) );
			// Lattice gate swung open to the right, against the wall.
			const gate = [];
			for ( let k = 0; k <= 4; k ++ ) gate.push( new THREE.BoxGeometry( 0.025, 2.5, 0.025 ).translate( k * 0.3, 1.25, 0 ) );
			for ( let k = 0; k <= 7; k ++ ) gate.push( new THREE.BoxGeometry( 1.2, 0.025, 0.025 ).translate( 0.6, 0.1 + k * 0.34, 0 ) );
			for ( const geo of gate ) kit.add( plain( 0xc9d1d6 ), geo.rotateY( - 1.5 ).translate( o.x + o.w / 2 + 0.05, 0, 0.18 ) );
			kit.add( MAT.stone, box( o.w + 0.4, 0.14, 0.5, o.x, - 0.1, 0.3 ) );
			// Planters: white oil barrels with ivy, either side of the door.
			for ( const s of [ - 1, 1 ] ) {

				const px = o.x + s * ( o.w / 2 + 0.45 );
				kit.add( MAT.white, cyl( 0.29, 0.29, 0.88, px, 0, 0.55, 16 ) );
				for ( let k = 0; k < 5; k ++ ) kit.add( MAT.ivy, new THREE.IcosahedronGeometry( 0.24 - k * 0.02, 0 ).translate( px + Math.cos( k * 2.1 ) * 0.15, 0.95 + k * 0.12, 0.55 + Math.sin( k * 2.1 ) * 0.15 ) );

			}

		}

		// Black awning with the name (the door's with the round logo).
		const aw = board( awningTex( o.kind === 'door' ), o.w + 0.35, 0.95, { material: { side: THREE.DoubleSide } } );
		aw.position.set( o.x, o.y1 + 0.38, 0.45 );
		aw.rotation.x = - 1.05;
		g.add( aw );
		kit.add( MAT.awning, box( o.w + 0.35, 0.24, 0.02, o.x, o.y1 - 0.08, 0.86 ) );
		kit.add( MAT.white, box( 0.02, 0.02, 0.85, o.x - o.w / 2 - 0.15, o.y1 - 0.02, 0.45 ), box( 0.02, 0.02, 0.85, o.x + o.w / 2 + 0.15, o.y1 - 0.02, 0.45 ) );
		const val = board( textTexture( [ [ 'STANDARD CAFE', 90 ] ], { w: 1024, h: 140, bg: '#1b1b1d', ink: '#f2f0ea', font: '"Helvetica Neue", Arial, sans-serif', weight: '600', spacing: 6 } ), o.w + 0.3, 0.2 );
		val.position.set( o.x, o.y1 + 0.04, 0.875 );
		g.add( val );

	}

	// The forecourt tree (young, light green) with an iron guard; a chalkboard.
	const tx = Math.min( R + 1.5, 4.6 ), tz = 4.2;
	kit.add( M.woodDark, cyl( 0.05, 0.07, 2.6, tx, 0, tz, 7 ) );
	for ( let k = 0; k < 6; k ++ ) kit.add( MAT.leafLight, new THREE.IcosahedronGeometry( 0.7 - k * 0.04, 0 ).translate( tx + Math.cos( k * 1.9 ) * 0.55, 2.7 + ( k % 3 ) * 0.35, tz + Math.sin( k * 1.9 ) * 0.55 ) );
	for ( let k = 0; k < 6; k ++ ) kit.add( MAT.black, cyl( 0.012, 0.012, 1.2, tx + Math.cos( k * 1.05 ) * 0.3, 0, tz + Math.sin( k * 1.05 ) * 0.3, 4 ) );
	kit.add( MAT.black, new THREE.TorusGeometry( 0.3, 0.012, 4, 18 ).rotateX( Math.PI / 2 ).translate( tx, 1.18, tz ) );
	const chalk = board( textTexture( [ [ 'ESPRESSO 55,-', 44, 60 ], [ 'AMERICANO 70,-', 44, 120 ], [ 'FLAT WHITE 80,-', 44, 180 ], [ 'COLD BREW', 44, 240 ] ], { w: 320, h: 300, bg: '#202020', ink: '#f4f1ea', font: '"Comic Sans MS", cursive', weight: '400' } ), 0.5, 0.48 );
	chalk.position.set( - 0.95, 1.35, 0.2 );
	g.add( chalk );
	kit.add( M.woodMid, box( 0.56, 0.54, 0.03, - 0.95, 1.08, 0.18 ) );

	kit.build( g );

}

function addCafeInterior( g, room, kit, seat ) {

	const { w, d, h } = room;
	kit.add( lit( planks( 0x3a2a1f, 0x46331f ), 0.25 ), box( w, 0.04, d, 0, - 0.04, - d / 2 ) );
	kit.add( lit( roomWall( 0xeeece6, 0x8a9db0, 1.0 ) ), box( w, h, 0.08, 0, 0, - d ), box( 0.08, h, d, - w / 2, 0, - d / 2 ), box( 0.08, h, d, w / 2, 0, - d / 2 ) );
	kit.add( lit( plain( 0x2b2b2b ) ), box( w, 0.04, d, 0, h, - d / 2 ) );
	// The bar across the back, shelves of bottles behind it, a copper pendant.
	const bw = w - 1.4;
	kit.add( M.woodDark, box( bw, 1.02, 0.6, 0.3, 0, - d + 1.0 ) ).add( M.woodMid, box( bw + 0.06, 0.04, 0.66, 0.3, 1.02, - d + 1.0 ) );
	kit.add( M.chrome, box( 0.65, 0.42, 0.42, 0.3 + bw / 2 - 0.5, 1.06, - d + 0.95 ) );
	for ( const y of [ 1.25, 1.6, 1.95, 2.3 ] ) {

		kit.add( M.woodMid, box( w - 0.3, 0.03, 0.26, 0, y, - d + 0.15 ) );
		for ( let x = - w / 2 + 0.3; x < w / 2 - 0.25; x += 0.13 ) bottle( kit, x, y + 0.03, - d + 0.15, [ M.bottle, M.beer, MAT.glassWarm, plain( 0x7a1f2a ) ][ Math.floor( Math.abs( x * 7.3 + y * 3 ) ) % 4 ] );

	}

	kit.add( M.brass, new THREE.ConeGeometry( 0.22, 0.25, 16, 1, true ).translate( 0, h - 0.9, - d / 2 ) ).add( M.iron, cyl( 0.006, 0.006, 0.8, 0, h - 0.8, - d / 2, 4 ) ).add( M.bulb, ball( 0.06, 0, h - 1.0, - d / 2, 8 ) );
	// Two small tables with stools by the window side; plants.
	for ( const [ x, z ] of [ [ - w / 2 + 0.8, - 1.2 ], [ - w / 2 + 0.8, - 2.6 ] ] ) {

		if ( - z > d - 1.8 ) continue;
		tableAt( kit, x, 0, z, 0, 'bistro' );
		chairAt( kit, x + 0.55, 0, z, Math.PI / 2, 'foldWood' );
		seat( x + 0.55, z, Math.PI / 2 );

	}

	kit.add( M.pot, cyl( 0.2, 0.15, 0.4, w / 2 - 0.4, 0, - 0.6, 10 ) ).add( MAT.ivy, new THREE.IcosahedronGeometry( 0.4, 0 ).translate( w / 2 - 0.4, 0.8, - 0.6 ) );

}

// ---------------------------------------------------------------------------
// Champagneria

// The weathered wall: ochre plaster flaking to bare stone low down, graffiti over it, an old blackboard frame.
function champagneWall( wallW ) {

	return tex( ( c, w, h ) => {

		seed = 77;
		c.fillStyle = '#d6a45e';
		c.fillRect( 0, 0, w, h );
		for ( let k = 0; k < 120; k ++ ) {

			c.fillStyle = `rgba(${ 150 + rnd() * 60 },${ 100 + rnd() * 40 },${ 50 + rnd() * 30 },${ 0.08 + rnd() * 0.12 })`;
			c.beginPath();
			c.ellipse( rnd() * w, rnd() * h, 10 + rnd() * 60, 6 + rnd() * 40, rnd() * 3, 0, Math.PI * 2 );
			c.fill();

		}

		// Bare stone band where the plaster has fallen off.
		c.save();
		c.beginPath();
		c.moveTo( 0, h );
		for ( let x = 0; x <= w; x += 20 ) c.lineTo( x, h * ( 0.55 + 0.1 * Math.sin( x * 0.013 ) + rnd() * 0.05 ) );
		c.lineTo( w, h );
		c.closePath();
		c.clip();
		c.fillStyle = '#8c8173';
		c.fillRect( 0, 0, w, h );
		for ( let k = 0; k < 500; k ++ ) {

			const v = 100 + rnd() * 70;
			c.fillStyle = `rgb(${ v + 10 },${ v },${ v - 12 })`;
			c.beginPath();
			c.ellipse( rnd() * w, h * 0.5 + rnd() * h * 0.5, 8 + rnd() * 18, 5 + rnd() * 10, rnd() * 3, 0, Math.PI * 2 );
			c.fill();

		}

		c.restore();
		// Graffiti tags.
		const inks = [ '#c0392b', '#1d1d1d', '#2e86c1', '#e84393', '#f5f5f5', '#27ae60' ];
		for ( let k = 0; k < 16; k ++ ) {

			c.strokeStyle = inks[ k % inks.length ];
			c.lineWidth = 3 + rnd() * 7;
			c.lineCap = 'round';
			c.beginPath();
			let x = rnd() * w, y = h * ( 0.55 + rnd() * 0.35 );
			c.moveTo( x, y );
			for ( let s = 0; s < 6; s ++ ) {

				x += ( rnd() - 0.3 ) * 50;
				y += ( rnd() - 0.5 ) * 40;
				c.quadraticCurveTo( x + ( rnd() - 0.5 ) * 40, y - 30 * rnd(), x, y );

			}

			c.stroke();

		}

		// A boarded-up niche covered in tags.
		c.fillStyle = '#3b3a35';
		c.fillRect( w * 0.45, h * 0.52, w * 0.13, h * 0.17 );
		c.fillStyle = '#9b9b92';
		for ( let k = 0; k < 10; k ++ ) c.fillRect( w * 0.45 + rnd() * w * 0.12, h * 0.53 + rnd() * h * 0.15, 6 + rnd() * 20, 3 );

	}, Math.round( 128 * wallW ), 512 );

}

// Chequered black-and-white setts (the strip along the wall).
const chequer = tex( ( c, w, h ) => {

	for ( let y = 0; y < 8; y ++ ) for ( let x = 0; x < 8; x ++ ) {

		c.fillStyle = ( x + y ) % 2 ? '#3a3b3d' : '#d9d8d3';
		c.fillRect( x * w / 8, y * h / 8, w / 8, h / 8 );
		c.strokeStyle = 'rgba(0,0,0,0.25)';
		c.strokeRect( x * w / 8, y * h / 8, w / 8, h / 8 );

	}

}, 128, 128 );

function addChampagneFront( scene, F, furniture ) {

	const g = onFront( F.x, F.y, F.z, F.n );
	scene.add( g );
	const kit = new Kit();
	const L = - F.left, R = F.right, wallW = R - L, H = 4.3;
	const wall = board( champagneWall( wallW ), wallW, H );
	wall.position.set( ( L + R ) / 2, H / 2, 0.05 );
	g.add( wall );

	// Street sign and house number.
	const sign = board( textTexture( [ [ 'PRŮCHODNÍ', 90, 80 ], [ 'STARÉ MĚSTO – PRAHA 1', 34, 150 ] ], { w: 512, h: 190, bg: '#c62d2d', ink: '#fff', border: '#fff', font: '"Helvetica Neue", Arial, sans-serif', weight: '800' } ), 0.75, 0.28 );
	sign.position.set( ( L + R ) / 2 - 0.4, 3.0, 0.08 );
	const num = board( textTexture( [ [ '4', 100 ] ], { w: 128, h: 128, bg: '#1f4f9a', ink: '#fff', border: '#fff', font: 'Arial, sans-serif' } ), 0.17, 0.17 );
	num.position.set( ( L + R ) / 2 - 0.4, 2.7, 0.08 );
	g.add( sign, num );

	// The doorway at the east end: black reveal, white glazed double doors open against it, steps up.
	const dx = F.door;
	kit.add( MAT.black, box( 1.55, 2.75, 0.12, dx, 0, 0.06 ) );
	for ( const s of [ - 1, 1 ] ) {

		const leaf = [];
		leaf.push( new THREE.BoxGeometry( 0.62, 2.45, 0.05 ).translate( s * 0.31, 1.25, 0 ) );
		kit.add( MAT.white, leaf[ 0 ].rotateY( s * - 1.4 ).translate( dx + s * 0.64, 0.15, 0.1 ) );
		for ( let k = 0; k < 3; k ++ ) kit.add( MAT.glassDark, new THREE.BoxGeometry( 0.45, 0.42, 0.06 ).translate( s * 0.31, 1.25 + k * 0.48, 0 ).rotateY( s * - 1.4 ).translate( dx + s * 0.64, 0.15, 0.1 ) );

	}

	kit.add( MAT.black, box( 1.4, 0.15, 0.35, dx, 0, 0.25 ), box( 1.4, 0.15, 0.2, dx, 0.15, 0.08 ) );
	bucket( kit, dx - 0.55, 0.15, 0.25 );
	kit.add( M.bulb, cyl( 0.04, 0.04, 0.09, dx + 0.55, 0.15, 0.3, 8 ), cyl( 0.04, 0.04, 0.09, dx - 0.35, 0.0, 0.5, 8 ) );
	const aboard = board( textTexture( [ [ 'CHAMPAGNERIA', 46, 60 ], [ '❦', 120, 190 ] ], { w: 256, h: 320, bg: '#151515', ink: '#d8b45e', font: 'Didot, Georgia, serif', weight: '400' } ), 0.5, 0.65, { material: { side: THREE.DoubleSide } } );
	aboard.position.set( dx - 1.15, 0.4, 0.55 );
	aboard.rotation.x = - 0.15;
	g.add( aboard );

	// Chequered paving strip along the wall.
	const strip = new THREE.Mesh( new THREE.PlaneGeometry( wallW, 1.7 ).rotateX( - Math.PI / 2 ), mapped( chequer.clone(), { roughness: 0.9 } ) );
	strip.material.map.wrapS = strip.material.map.wrapT = THREE.RepeatWrapping;
	strip.material.map.repeat.set( wallW / 1.6, 1.7 / 1.6 );
	strip.material.map.needsUpdate = true;
	strip.position.set( ( L + R ) / 2, 0.025, 0.85 );
	strip.receiveShadow = true;
	g.add( strip );

	kit.build( g );

}

function addChampagneInterior( g, room, kit, seat ) {

	const { w, d, h } = room;
	kit.add( lit( planks( 0x1c1c1c, 0x262624 ), 0.3 ), box( w, 0.04, d, 0, - 0.04, - d / 2 ) );
	kit.add( lit( roomWall( 0xf3f1ec, 0xe9e6df, 0.05 ), 0.3 ), box( w, h, 0.08, 0, 0, - d ), box( 0.08, h, d, - w / 2, 0, - d / 2 ), box( 0.08, h, d, w / 2, 0, - d / 2 ) );
	kit.add( lit( planks( 0xc49560, 0xa97a46 ), 0.4 ), box( w, 0.05, d, 0, h, - d / 2 ) );

	// The bar: beech top on a black base along the right-hand wall, turning across at the front.
	const bx = w / 2 - 1.35, bl = d - 2.2;
	kit.add( MAT.black, box( 0.6, 1.02, bl, bx, 0, - 1.6 - bl / 2 ), box( 1.0, 1.02, 0.6, bx + 0.2, 0, - 1.3 ) );
	kit.add( MAT.beech, box( 0.72, 0.05, bl + 0.06, bx, 1.02, - 1.6 - bl / 2 ), box( 1.12, 0.05, 0.72, bx + 0.2, 1.02, - 1.3 ) );
	kit.add( M.chrome, box( 0.45, 0.42, 0.4, bx, 1.07, - 2.4 ) );
	kit.add( MAT.glassDark, box( 0.6, 0.35, 0.5, bx, 1.07, - 1.35 ) ).add( MAT.glassWarm, box( 0.5, 0.06, 0.4, bx, 1.12, - 1.35 ) );
	flute( kit, bx - 0.15, 1.07, - 3.2 );
	flute( kit, bx + 0.1, 1.07, - 3.6 );
	// Behind the bar: a wall of corks, lit glass shelves, blackboards above.
	const cork = tex( ( c, W2, H2 ) => {

		seed = 9;
		c.fillStyle = '#7a4a26';
		c.fillRect( 0, 0, W2, H2 );
		for ( let k = 0; k < 900; k ++ ) {

			const v = rnd();
			c.fillStyle = `rgb(${ 150 + v * 70 },${ 95 + v * 50 },${ 50 + v * 30 })`;
			c.beginPath();
			c.ellipse( rnd() * W2, rnd() * H2, 5 + rnd() * 4, 5 + rnd() * 4, 0, 0, Math.PI * 2 );
			c.fill();

		}

	}, 256, 256, [ 2, 1 ] );
	const corkWall = board( cork, bl, 1.5 );
	corkWall.position.set( w / 2 - 0.05, 1.85, - 1.6 - bl / 2 );
	corkWall.rotation.y = - Math.PI / 2;
	g.add( corkWall );
	for ( const y of [ 1.45, 1.85 ] ) {

		kit.add( MAT.beech, box( 0.24, 0.03, bl, w / 2 - 0.17, y, - 1.6 - bl / 2 ) ).add( glow( 0xffc46b, 2 ), box( 0.02, 0.012, bl, w / 2 - 0.08, y - 0.015, - 1.6 - bl / 2 ) );
		for ( let z = - 1.8; z > - 1.6 - bl + 0.1; z -= 0.16 ) flute( kit, w / 2 - 0.15, y + 0.03, z );

	}

	const menu = board( textTexture( [ [ 'TEPLÁ JÍDLA · STUDENÁ JÍDLA', 34, 50 ], [ 'BRUT 25/39 · ROSÉ 45 · CAVA 32', 34, 110 ], [ 'CHAMPAGNE · PROSECCO · CRÉMANT', 34, 170 ] ], { w: 1024, h: 220, bg: '#141414', ink: '#ece9df', font: '"Comic Sans MS", cursive', weight: '400' } ), bl, 0.55 );
	menu.position.set( w / 2 - 0.05, h - 0.45, - 1.6 - bl / 2 );
	menu.rotation.y = - Math.PI / 2;
	g.add( menu );

	// Pendant bottle lamps over the bar; black sconces; the ledge with stools along the left wall.
	const bottleShape = new THREE.LatheGeometry( [ [ 0, 0 ], [ 0.09, 0 ], [ 0.1, 0.05 ], [ 0.1, 0.2 ], [ 0.04, 0.3 ], [ 0.02, 0.4 ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), 12 );
	for ( let k = 0; k < 4; k ++ ) {

		const z = - 1.9 - k * ( bl - 0.6 ) / 3, y = h - 1.1 - ( k % 2 ) * 0.25;
		kit.add( plain( 0xe8f0e6, { transparent: true, opacity: 0.45, roughness: 0.1 } ), bottleShape.clone().translate( bx - 0.05, y, z ) );
		kit.add( M.bulb, ball( 0.05, bx - 0.05, y + 0.1, z, 8 ) ).add( MAT.black, cyl( 0.005, 0.005, h - y - 0.4, bx - 0.05, y + 0.4, z, 4 ) );

	}

	for ( const z of [ - 1.0, - d + 1.5 ] ) kit.add( MAT.black, box( 0.08, 0.12, 0.14, - w / 2 + 0.08, 2.2, z ) ).add( M.lampShade, box( 0.02, 0.12, 0.1, - w / 2 + 0.13, 2.2, z ) );
	kit.add( MAT.beech, box( 0.22, 0.04, d - 1.4, - w / 2 + 0.15, 1.1, - d / 2 - 0.3 ) );
	for ( let z = - 1.2; z > - d + 1.0; z -= 1.3 ) {

		kit.add( MAT.black, box( 0.03, 0.18, 0.03, - w / 2 + 0.06, 0.95, z ) );
		chairAt( kit, - w / 2 + 0.6, 0, z, Math.PI / 2, 'stool' );
		seat( - w / 2 + 0.6, z, Math.PI / 2 );
		kit.add( M.bulb, cyl( 0.035, 0.035, 0.07, - w / 2 + 0.15, 1.14, z - 0.3, 8 ) );

	}

	kit.add( MAT.glassWarm, cyl( 0.05, 0.04, 0.2, - w / 2 + 0.15, 1.14, - 2.0, 8 ) ).add( plain( 0xf4f4ef ), ball( 0.09, - w / 2 + 0.15, 1.4, - 2.0, 8 ) ); // flowers

}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kavárna Slavia (Národní 1): the corner café of Lažanský palác facing the National Theatre and the river. A row of
// tall plate-glass windows in slim dark frames between the palace's stone piers, along Národní and round the corner;
// the entrance on Národní. Inside: cream walls over dark wood, a herringbone parquet, rows of small tables with
// white marble tops and bentwood chairs along the windows, opaline globe lamps, a long bar with a mirror, a black
// grand piano, and Viktor Oliva's Absinthe Drinker on the back wall.

function addSlaviaFront( scene, F ) {

	const g = onFront( F.x, F.y, F.z, F.n );
	scene.add( g );
	const kit = new Kit();
	const L = - F.left + 0.6, R = F.right - 0.6, top = 3.25, bay = 2.7;
	const n = Math.max( 1, Math.round( ( R - L ) / bay ) ), bw = ( R - L ) / n;
	const glass = new THREE.MeshStandardNodeMaterial( { color: 0x9fb2b4, roughness: 0.05, metalness: 0.2, transparent: true, opacity: F.room ? 0.18 : 0.55, depthWrite: false } );
	const behind = lit( plain( 0x6b5338 ), 0.5 ); // where no room is modelled: a warm-lit interior seen through glass
	for ( let k = 0; k <= n; k ++ ) kit.add( MAT.stone, box( 0.5, top + 0.35, 0.3, L + k * bw, 0, 0.05 ) );
	for ( let k = 0; k < n; k ++ ) {

		const x = L + ( k + 0.5 ) * bw, w = bw - 0.5;
		const isDoor = ! F.windowsOnly && Math.abs( x - F.door ) < bw / 2;
		const y0 = isDoor ? 0 : 0.45;
		kit.add( MAT.frame, box( w, 0.08, 0.1, x, y0, 0.06 ), box( w, 0.1, 0.1, x, top - 0.1, 0.06 ), box( 0.06, top - y0, 0.1, x - w / 2 + 0.03, y0, 0.06 ), box( 0.06, top - y0, 0.1, x + w / 2 - 0.03, y0, 0.06 ) );
		kit.add( MAT.frame, box( w, 0.05, 0.08, x, top - 0.75, 0.06 ) ); // transom
		if ( ! isDoor ) kit.add( MAT.stone, box( w, 0.45, 0.25, x, 0, 0.0 ) ); // stone sill wall below the glass
		if ( isDoor ) {

			// Double door: dark wood frames with glass, brass push bars, a step.
			for ( const s of [ - 1, 1 ] ) {

				kit.add( MAT.frame, box( w / 2 - 0.05, 2.5, 0.06, x + s * w / 4, 0, 0.04 ) );
				kit.add( M.brass, box( 0.03, 0.6, 0.04, x + s * 0.12, 0.9, 0.11 ) );

			}

			kit.add( MAT.stone, box( w + 0.4, 0.12, 0.6, x, - 0.12, 0.4 ) );

		}

		const pane = new THREE.Mesh( new THREE.PlaneGeometry( w - 0.1, top - y0 - 0.15 ), isDoor ? glass : glass );
		pane.position.set( x, ( y0 + top ) / 2, 0.07 );
		g.add( pane );
		if ( ! F.room ) kit.add( behind, box( w, top - y0, 0.05, x, y0, - 0.4 ) );

	}

	kit.build( g, { shadows: false } );

}

// Viktor Oliva's Absinthe Drinker (1901): a man at a café table at night, the green fairy at his shoulder.
const absinthe = tex( ( c, w, h ) => {

	const sky = c.createLinearGradient( 0, 0, 0, h );
	sky.addColorStop( 0, '#2c2a22' );
	sky.addColorStop( 1, '#4b3b26' );
	c.fillStyle = sky;
	c.fillRect( 0, 0, w, h );
	c.fillStyle = '#1a1612';
	c.beginPath();
	c.ellipse( w * 0.58, h * 0.42, w * 0.14, h * 0.2, 0, 0, Math.PI * 2 );
	c.fill(); // the drinker's dark coat
	c.fillStyle = '#c9a77c';
	c.beginPath();
	c.arc( w * 0.6, h * 0.22, w * 0.06, 0, Math.PI * 2 );
	c.fill(); // his face
	c.fillStyle = 'rgba(120,200,120,0.55)';
	c.beginPath();
	c.ellipse( w * 0.36, h * 0.38, w * 0.1, h * 0.28, - 0.2, 0, Math.PI * 2 );
	c.fill(); // the green fairy
	c.fillStyle = '#5a4630';
	c.fillRect( w * 0.25, h * 0.7, w * 0.6, h * 0.05 ); // table
	c.fillStyle = 'rgba(150,220,150,0.8)';
	c.fillRect( w * 0.62, h * 0.62, w * 0.03, h * 0.08 ); // the glass
	c.strokeStyle = '#b08a3e';
	c.lineWidth = w * 0.04;
	c.strokeRect( 0, 0, w, h );

}, 256, 320 );

function addSlaviaInterior( g, room, kit, seat ) {

	const { w, d, h } = room;
	const marble = plain( 0xf1eee8, { roughness: 0.2 } );
	kit.add( lit( planks( 0x4a2f1d, 0x5c3b24 ), 0.22 ), box( w, 0.04, d, 0, - 0.04, - d / 2 ) );
	kit.add( lit( roomWall( 0xece3cf, 0x3d2a1c, 1.1 ) ), box( w, h, 0.08, 0, 0, - d ), box( 0.08, h, d, - w / 2, 0, - d / 2 ), box( 0.08, h, d, w / 2, 0, - d / 2 ) );
	kit.add( lit( plain( 0xf2ebdc ), 0.3 ), box( w, 0.06, d, 0, h, - d / 2 ) );
	kit.add( lit( plain( 0xd9c9a8 ), 0.2 ), box( w, 0.25, 0.1, 0, h - 0.25, - d + 0.05 ) );

	// Two rows of small marble tables with bentwood chairs: along the windows, and one further in.
	for ( const z of [ - 1.1, - 3.4 ] ) {

		if ( - z > d - 2.5 ) continue;
		for ( let x = - w / 2 + 1.0; x < w / 2 - 0.8; x += 1.9 ) {

			if ( Math.abs( x - room.door ) < 1.2 ) continue;
			kit.add( marble, cyl( 0.33, 0.33, 0.03, x, 0.72, z, 20 ) );
			kit.add( MAT.black, cyl( 0.03, 0.05, 0.72, x, 0, z, 8 ), cyl( 0.22, 0.22, 0.03, x, 0, z, 12 ) );
			for ( const s of [ - 1, 1 ] ) {

				chairAt( kit, x + s * 0.55, 0, z, s * Math.PI / 2, 'spindle' );
				seat( x + s * 0.55, z, s * Math.PI / 2 );

			}

			kit.add( MAT.white, cyl( 0.05, 0.04, 0.06, x + 0.1, 0.75, z, 10 ) ); // a cup

		}

	}

	// The bar with a mirror behind it along the left wall; the piano at the right back.
	const bd = Math.min( 6, d - 2 );
	kit.add( MAT.frame, box( 0.6, 1.05, bd, - w / 2 + 0.9, 0, - d + 0.5 + bd / 2 ) );
	kit.add( marble, box( 0.7, 0.04, bd + 0.06, - w / 2 + 0.9, 1.05, - d + 0.5 + bd / 2 ) );
	kit.add( plain( 0xc7d3d6, { roughness: 0.05, metalness: 0.9 } ), box( 0.04, 1.4, bd, - w / 2 + 0.06, 1.3, - d + 0.5 + bd / 2 ) );
	for ( let z = - d + 0.8; z < - d + 0.5 + bd; z += 0.18 ) bottle( kit, - w / 2 + 0.3, 1.25, z, [ M.bottle, M.beer, MAT.glassWarm ][ Math.floor( - z * 5 ) % 3 ] );
	const px = w / 2 - 1.6, pz = - d + 1.6;
	kit.add( MAT.black, box( 1.5, 0.3, 1.9, px, 0.72, pz ), box( 1.5, 0.25, 0.4, px, 0.72, pz + 1.1 ) );
	for ( const [ a, b ] of [ [ - 0.6, - 0.8 ], [ 0.6, - 0.8 ], [ 0, 0.8 ] ] ) kit.add( MAT.black, cyl( 0.05, 0.05, 0.72, px + a, 0, pz + b, 8 ) );
	kit.add( MAT.white, box( 1.2, 0.03, 0.15, px, 0.98, pz + 1.15 ) ); // keys

	// The Absinthe Drinker in a gilt frame on the back wall.
	const painting = board( absinthe, 1.3, 1.62 );
	painting.position.set( 0, 2.1, - d + 0.06 );
	g.add( painting );

	// Opaline globe lamps on brass rods, in rows.
	for ( let x = - w / 2 + 2; x < w / 2 - 1; x += 3 ) for ( const z of [ - 1.6, - d + 2.2 ] ) {

		kit.add( M.brass, cyl( 0.01, 0.01, 0.7, x, h - 0.7, z, 5 ) );
		kit.add( M.lampShade, ball( 0.2, x, h - 0.85, z, 12 ) );

	}

}

// The room shell's floor, walls and ceiling come from each style; this adds the front wall with the doorway and
// lets the style furnish the room. Returns seats (scene frame).
// ---------------------------------------------------------------------------
// Večerka on Náprstkova 7 (from the owner's photos): a corner shop in front (shelves of goods, the drinks fridge,
// the counter with the cigarette wall), and through an arch at the back the phở room, a white vaulted room with the
// red menu board of dishes, the wooden counter with porcelain vases, pink flowers, a laughing Buddha and a lucky cat;
// light wood tables with chopsticks in wooden boxes and Sriracha, a rattan lamp and bare bulbs on cables, the
// chalkboard "Vaříme jako u nás doma ve Vietnamu".

function menuBoard() {

	return tex( ( c, w, h ) => {

		c.fillStyle = '#8e1717';
		c.fillRect( 0, 0, w, h );
		c.fillStyle = '#f6d34a';
		c.font = '700 22px sans-serif';
		[ 'PHỞ / NUDLOVÉ POLÉVKY', 'BÚN / NUDLE', 'CƠM / RÝŽE · SPECIAL' ].forEach( ( t, i ) => c.fillText( t, 14 + i * ( w / 3 ), 28 ) );
		const food = [ '#c9893f', '#e2b45a', '#7a9a3c', '#b8542f', '#d8c08a', '#9c3b25' ];
		for ( let r = 0; r < 3; r ++ ) for ( let k = 0; k < 9; k ++ ) {

			const x = 30 + k * ( w - 50 ) / 9 + 22, y = 70 + r * 70;
			c.fillStyle = '#f4f1ea';
			c.beginPath();
			c.arc( x, y, 25, 0, Math.PI * 2 );
			c.fill();
			c.fillStyle = food[ ( r * 9 + k ) % food.length ];
			c.beginPath();
			c.arc( x, y, 18, 0, Math.PI * 2 );
			c.fill();
			c.fillStyle = '#4e8a3a';
			c.fillRect( x - 6, y - 4, 7, 3 );
			c.fillStyle = '#f6d34a';
			c.font = '700 13px sans-serif';
			c.fillText( `${ 129 + ( ( r * 9 + k ) * 17 ) % 90 },-`, x - 16, y + 40 );

		}

	}, 1024, 300 );

}

function chalkboard() {

	return tex( ( c, w, h ) => {

		c.fillStyle = '#22262a';
		c.fillRect( 0, 0, w, h );
		c.strokeStyle = '#5a4630';
		c.lineWidth = 18;
		c.strokeRect( 0, 0, w, h );
		c.fillStyle = '#f2f0e8';
		c.textAlign = 'center';
		c.font = 'italic 40px "Brush Script MT", "Segoe Script", cursive';
		[ 'Vaříme', 'jako u nás doma', 've Vietnamu' ].forEach( ( t, i ) => c.fillText( t, w / 2, 90 + i * 70 ) );
		c.strokeStyle = '#f2f0e8';
		c.lineWidth = 3;
		c.beginPath();
		c.ellipse( w / 2, 330, 70, 22, 0, 0, Math.PI );
		c.stroke();
		c.beginPath();
		c.moveTo( w / 2 + 20, 290 );
		c.lineTo( w / 2 + 110, 250 );
		c.moveTo( w / 2 + 30, 300 );
		c.lineTo( w / 2 + 120, 265 );
		c.stroke();

	}, 512, 400 );

}

function addVecerkaInterior( g, room, kit, seat ) {

	const { w, d, h, door } = room;
	const white = lit( plain( 0xf3f1ec ) );
	const floorMat = lit( tiles( 0xb9b3a7, 0xa7a196, 0.45 ), 0.25 );
	kit.add( floorMat, box( w, 0.04, d, 0, - 0.04, - d / 2 ) );
	kit.add( white, box( w, h, 0.08, 0, 0, - d ), box( 0.08, h, d, - w / 2, 0, - d / 2 ), box( 0.08, h, d, w / 2, 0, - d / 2 ) );

	// The partition between shop and back room, with a round-headed arch lined up with the door.
	const ds = Math.min( 3.8, d * 0.42 ), ax = THREE.MathUtils.clamp( door, - w / 2 + 1.1, w / 2 - 1.1 ), aw = 1.5, ah = 2.45;
	const wall = new THREE.Shape().moveTo( - w / 2, 0 ).lineTo( w / 2, 0 ).lineTo( w / 2, h ).lineTo( - w / 2, h ).closePath();
	wall.holes.push( new THREE.Path().moveTo( ax - aw / 2, 0 ).lineTo( ax - aw / 2, ah - aw / 2 ).absarc( ax, ah - aw / 2, aw / 2, Math.PI, 0, true ).lineTo( ax + aw / 2, 0 ).closePath() );
	kit.add( white, new THREE.ExtrudeGeometry( wall, { depth: 0.3, bevelEnabled: false, curveSegments: 12 } ).translate( 0, 0, - ds - 0.3 ) );

	// --- the shop
	kit.add( white, box( w, 0.05, ds, 0, h, - ds / 2 ) );
	kit.add( M.bulb, box( 1.2, 0.03, 0.12, 0, h - 0.04, - ds / 2 ) );
	const far = door > 0 ? - 1 : 1; // the side away from the door
	const product = [ 0xd33b2c, 0xf2c230, 0x2f6fb5, 0x3e9a4a, 0xf08a24, 0xffffff, 0x8a3a8f, 0x1d1d1d ].map( c => plain( c, { roughness: 0.5 } ) );
	// Shelves along the far side wall.
	const sx = far * ( w / 2 - 0.25 );
	for ( const y of [ 0.15, 0.6, 1.05, 1.5, 1.95 ] ) {

		kit.add( M.woodLight, box( 0.42, 0.03, ds - 0.6, sx, y, - ds / 2 ) );
		for ( let z = - 0.45; z > - ds + 0.4; z -= 0.14 ) kit.add( product[ Math.floor( rnd() * product.length ) ], box( 0.3, 0.18 + rnd() * 0.16, 0.11, sx, y + 0.03, z ) );

	}

	// The drinks fridge against the partition, lit, bottles behind its glass.
	const fx = far * ( w / 2 - 1.2 );
	kit.add( plain( 0xe9ebee ), box( 0.9, 2.0, 0.65, fx, 0, - ds + 0.35 ) );
	kit.add( glow( 0xdff3ff, 0.7 ), box( 0.78, 1.7, 0.02, fx, 0.15, - ds + 0.68 ) );
	for ( const y of [ 0.3, 0.75, 1.2, 1.6 ] ) for ( let k = 0; k < 6; k ++ ) kit.add( product[ ( k + Math.round( y * 3 ) ) % product.length ], cyl( 0.035, 0.035, 0.3, fx - 0.33 + k * 0.13, y, - ds + 0.5, 6 ) );
	// The counter by the door, cigarettes on the wall behind it.
	const cx = door - far * 0, cz = - 1.1;
	const counterX = THREE.MathUtils.clamp( - far * ( w / 2 - 0.9 ), - w / 2 + 0.9, w / 2 - 0.9 );
	kit.add( M.woodMid, box( 1.4, 1.0, 0.6, counterX, 0, cz - 0.9 ) ).add( M.woodLight, box( 1.5, 0.04, 0.7, counterX, 1.0, cz - 0.9 ) );
	for ( let r = 0; r < 4; r ++ ) for ( let k = 0; k < 9; k ++ ) kit.add( product[ ( r * 3 + k ) % product.length ], box( 0.09, 0.13, 0.04, counterX - 0.6 + k * 0.15, 1.3 + r * 0.2, - ds + 0.05 ) );
	kit.add( plain( 0x1d1d1d ), box( 0.35, 0.25, 0.25, counterX + 0.4, 1.04, cz - 0.9 ) ); // the till
	void cx;
	// Crates of fruit and a stack of beer crates inside the door.
	for ( let k = 0; k < 3; k ++ ) {

		const x = far * ( w / 2 - 1.4 ) - far * k * 0.55;
		kit.add( M.woodLight, box( 0.5, 0.25, 0.35, x, 0.0, - 0.45 ) );
		for ( let j = 0; j < 6; j ++ ) kit.add( [ plain( 0xf09a2a ), plain( 0xf2d23a ), plain( 0x7ab83a ) ][ k ], ball( 0.05, x - 0.18 + ( j % 3 ) * 0.18, 0.3, - 0.55 + Math.floor( j / 3 ) * 0.2, 6 ) );

	}

	for ( let k = 0; k < 4; k ++ ) kit.add( plain( 0x2a6a3a ), box( 0.4, 0.28, 0.3, - far * ( w / 2 - 0.4 ), k * 0.29, - ds + 0.4 ) );

	// --- the phở room, vaulted
	const D = d - ds - 0.3, z0 = - ds - 0.3; // its depth and front edge
	const vault = new THREE.PlaneGeometry( w, D, 16, 1 ).rotateX( Math.PI / 2 );
	const pos = vault.attributes.position;
	for ( let i = 0; i < pos.count; i ++ ) {

		const x = pos.getX( i ) / ( w / 2 );
		pos.setY( i, h - 0.6 + 0.6 * ( 1 - x * x ) );

	}

	vault.computeVertexNormals();
	kit.add( lit( plain( 0xf6f4ee, { side: THREE.DoubleSide } ) ), vault.translate( 0, 0, z0 - D / 2 ) );
	// Menu board and the counter under it, on the back wall.
	const mw = Math.min( 3.8, w - 1.4 );
	const menu = mapped( menuBoard() );
	lit( menu, 0.12 );
	kit.add( menu, new THREE.PlaneGeometry( mw, mw * 300 / 1024 ).translate( 0, 2.05, - d + 0.06 ) );
	const cw = Math.min( 3.2, w - 1.6 );
	kit.add( M.woodMid, box( cw, 1.0, 0.55, 0, 0, - d + 0.62 ) ).add( M.woodDark, box( cw + 0.06, 0.05, 0.6, 0, 1.0, - d + 0.62 ) );
	kit.add( M.woodMid, box( cw, 0.03, 0.25, 0, 1.45, - d + 0.15 ) );
	for ( let k = 0; k < 10; k ++ ) kit.add( MAT_GLASS, cyl( 0.03, 0.03, 0.1, - cw / 2 + 0.2 + k * ( cw - 0.4 ) / 9, 1.48, - d + 0.15, 6 ) );
	// Vases (blue, and white with flowers), pink flowers, the laughing Buddha, the lucky cat.
	const porcelain = plain( 0xf3efe6, { roughness: 0.3 } ), cobalt = plain( 0x223a8c, { roughness: 0.3 } );
	const vase = ( m, x, hgt ) => kit.add( m, new THREE.LatheGeometry( [ [ 0.0, 0 ], [ 0.07, 0 ], [ 0.11, hgt * 0.35 ], [ 0.06, hgt * 0.8 ], [ 0.08, hgt ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), 10 ).translate( x, 1.05, - d + 0.62 ) );
	vase( cobalt, - cw / 2 + 0.3, 0.42 );
	vase( porcelain, 0.15, 0.5 );
	for ( let k = 0; k < 9; k ++ ) kit.add( plain( [ 0xd88ac8, 0xb05aa8, 0xf2e6f0 ][ k % 3 ] ), ball( 0.07, 0.15 + ( rnd() - 0.5 ) * 0.4, 1.6 + rnd() * 0.3, - d + 0.62 + ( rnd() - 0.5 ) * 0.2, 5 ) );
	const gold = plain( 0xd9b36a, { roughness: 0.4 } );
	kit.add( gold, ball( 0.2, cw / 2 - 0.3, 1.25, - d + 0.62, 8 ), ball( 0.12, cw / 2 - 0.3, 1.52, - d + 0.62, 8 ) );
	for ( const s of [ - 1, 1 ] ) kit.add( gold, new THREE.CylinderGeometry( 0.03, 0.03, 0.3, 5 ).rotateZ( s * 0.5 ).translate( cw / 2 - 0.3 + s * 0.15, 1.7, - d + 0.62 ) );
	kit.add( plain( 0xf8f6f0 ), ball( 0.09, cw / 2 - 0.85, 1.12, - d + 0.62, 7 ), ball( 0.07, cw / 2 - 0.85, 1.26, - d + 0.62, 7 ) ).add( plain( 0xd83a2a ), box( 0.03, 0.12, 0.03, cw / 2 - 0.78, 1.3, - d + 0.66 ) );
	// Tables: light wood, two chairs each; chopsticks in a wooden box, Sriracha, a steaming bowl now and then.
	const wood = lit( planks( 0xcdb48e, 0xbfa57f ), 0.15 );
	const chair = [ plain( 0xe9e9e6 ), plain( 0x9aa1a8 ) ];
	const rows = [];
	for ( let z = z0 - 1.0; z > - d + 1.9; z -= 1.7 ) rows.push( z );
	let n = 0;
	for ( const z of rows ) for ( const x of [ - w / 4, w / 4 ] ) {

		if ( Math.abs( x - ax ) < 0.8 && z > z0 - 1.3 ) continue; // keep the way through the arch clear
		kit.add( wood, box( 1.1, 0.04, 0.7, x, 0.74, z ) ).add( M.iron, box( 0.06, 0.74, 0.06, x, 0, z ) );
		kit.add( M.woodLight, box( 0.12, 0.12, 0.12, x - 0.35, 0.78, z ) );
		for ( let k = 0; k < 6; k ++ ) kit.add( M.woodLight, box( 0.01, 0.24, 0.01, x - 0.38 + ( k % 3 ) * 0.03, 0.82, z - 0.03 + Math.floor( k / 3 ) * 0.04 ) );
		kit.add( plain( 0xd8301e ), cyl( 0.03, 0.03, 0.17, x - 0.18, 0.78, z + 0.15, 7 ) ).add( plain( 0x2f8a3a ), cyl( 0.015, 0.02, 0.04, x - 0.18, 0.95, z + 0.15, 6 ) );
		if ( n ++ % 2 === 0 ) {

			kit.add( porcelain, new THREE.SphereGeometry( 0.12, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2 ).translate( x + 0.2, 0.9, z - 0.05 ) );
			kit.add( plain( 0x9c6a32, { roughness: 0.2 } ), cyl( 0.11, 0.11, 0.01, x + 0.2, 0.86, z - 0.05, 12 ) ).add( plain( 0x5d9a3a ), box( 0.06, 0.012, 0.03, x + 0.24, 0.875, z - 0.08 ) );

		}

		for ( const sd of [ - 1, 1 ] ) {

			const czz = z + sd * 0.55;
			kit.add( chair[ ( n + sd ) & 1 ], box( 0.44, 0.04, 0.42, x, 0.45, czz ), box( 0.44, 0.42, 0.04, x, 0.47, czz + sd * 0.2 ) ).add( M.woodLight, box( 0.36, 0.45, 0.32, x, 0, czz ).scale( 1, 1, 1 ) );
			seat( x, czz, sd > 0 ? Math.PI : 0 );

		}

	}

	// The chalkboard on the side wall, a rattan lamp and bare bulbs on cables.
	const cb = mapped( chalkboard() );
	lit( cb, 0.3 );
	const side = - far;
	kit.add( cb, new THREE.PlaneGeometry( 0.9, 0.7 ).rotateY( - side * Math.PI / 2 ).translate( side * ( w / 2 - 0.05 ), 1.7, z0 - 1.2 ) );
	const rattan = glow( 0xc9a05a, 0.35 );
	kit.add( rattan, new THREE.TorusGeometry( 0.26, 0.07, 6, 14 ).rotateX( Math.PI / 2 ).translate( 0, h - 0.95, z0 - D / 2 ) ).add( M.iron, cyl( 0.005, 0.005, 0.85, 0, h - 0.88, z0 - D / 2, 4 ) );
	for ( let k = 0; k < 5; k ++ ) {

		const bx = - w / 2 + 0.8 + k * ( w - 1.6 ) / 4, bz = z0 - 0.8 - ( k % 2 ) * ( D - 1.6 ) * 0.6, drop = 0.6 + ( k % 3 ) * 0.3;
		kit.add( M.iron, cyl( 0.005, 0.005, drop, bx, h - drop - 0.1, bz, 4 ) ).add( M.bulb, ball( 0.05, bx, h - drop - 0.15, bz, 8 ) );

	}

}

const MAT_GLASS = new THREE.MeshStandardNodeMaterial( { color: 0xdfe8ea, roughness: 0.1, transparent: true, opacity: 0.6 } );

function addVenueInterior( scene, room ) {

	const g = onFront( room.x, room.y, room.z, room.n );
	scene.add( g );
	g.updateMatrixWorld( true );
	const { w, d, h, door, doorW, doorH } = room;
	const kit = new Kit();
	const seats = [];
	const seat = ( x, z, rot ) => {

		const p = new THREE.Vector3( x, 0, z ).applyMatrix4( g.matrixWorld );
		const dir = new THREE.Vector3( Math.sin( rot ), 0, Math.cos( rot ) ).transformDirection( g.matrixWorld );
		seats.push( [ + p.x.toFixed( 2 ), + room.y.toFixed( 2 ), + p.z.toFixed( 2 ), + Math.atan2( - dir.x, - dir.z ).toFixed( 3 ) ] );

	};

	const dl = door - doorW / 2, dr = door + doorW / 2, t = 0.08;
	if ( room.style === 'slavia' ) {

		// The windows are the front wall; inside, only a band above them.
		kit.add( lit( plain( 0xece3cf ) ), box( w, h - 3.25, t, 0, 3.25, - 0.14 ) );

	} else {

		const front = lit( { pub: roomWall( 0xf1e5d2, 0x5b2a1f, 1.2 ), cafe: roomWall( 0xeeece6, 0x8a9db0, 1.0 ), champagne: roomWall( 0xf3f1ec, 0xe9e6df, 0.05 ), vecerka: roomWall( 0xf3f1ec, 0xe4e0d6, 0.9 ) }[ room.style ] );
		kit.add( front, box( dl + w / 2, h, t, ( - w / 2 + dl ) / 2, 0, - 0.14 ), box( w / 2 - dr, h, t, ( dr + w / 2 ) / 2, 0, - 0.14 ), box( doorW, h - doorH, t, door, doorH, - 0.14 ) );

	}

	( { pub: addPubInterior, cafe: addCafeInterior, champagne: addChampagneInterior, slavia: addSlaviaInterior, vecerka: addVecerkaInterior } )[ room.style ]( g, room, kit, seat );
	kit.build( g );
	return seats;

}

export function addVenues( scene, places, furniture ) {

	const seats = [];
	for ( const F of places.fronts || [] ) ( { pub: addPubFront, cafe: addCafeFront, champagne: addChampagneFront, slavia: addSlaviaFront } )[ F.style ]?.( scene, F, furniture );
	for ( const room of places.interiors ) seats.push( ...addVenueInterior( scene, room ) );
	const kit = new Kit();
	for ( const t of places.terraces ) addTables( kit, t, seats );
	// Champagneria: parasols over every other table; a round bench around the square's tree.
	const champ = places.terraces.find( t => t.kind === 'champagne' );
	champ?.tables.forEach( ( [ x, y, z, rot ], i ) => {

		if ( i % 2 === 0 ) parasol( kit, x - Math.sin( rot ) * 0.0, y, z, rot );

	} );
	const F = places.fronts.find( f => f.style === 'champagne' );
	if ( F && furniture.tree ) {

		const px = F.x + F.n[ 0 ] * 9, pz = F.z + F.n[ 1 ] * 9;
		let best = null, bd = 12;
		for ( let i = 0; i < furniture.tree.length; i += 5 ) {

			const d = Math.hypot( furniture.tree[ i ] - px, furniture.tree[ i + 2 ] - pz );
			if ( d < bd ) {

				bd = d;
				best = [ furniture.tree[ i ], furniture.tree[ i + 1 ], furniture.tree[ i + 2 ] ];

			}

		}

		if ( best ) {

			const [ x, y, z ] = best;
			kit.add( M.woodMid, new THREE.TorusGeometry( 1.05, 0.2, 3, 32 ).rotateX( Math.PI / 2 ).scale( 1, 0.15, 1 ).translate( x, y + 0.45, z ) );
			for ( let k = 0; k < 6; k ++ ) kit.add( MAT.black, box( 0.05, 0.45, 0.4, x + Math.cos( k * 1.047 ) * 1.05, y, z + Math.sin( k * 1.047 ) * 1.05 ) );

		}

	}

	kit.build( scene );
	return seats;

}
