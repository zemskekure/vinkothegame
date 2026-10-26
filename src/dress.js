// Betlémské náměstí's own signs and fixtures (tools/dress.mjs): name boards and lettering as photographed, the
// Švejk badge, U Zeleného stromu's portal, flags, wall lamps, the Oliva Nera terrace and the street clock; and
// Prague's enamel plates (house numbers and street names) on the houses round the square, all from one texture.

import * as THREE from 'three/webgpu';
import { Kit, M, plain, glow, box, cyl, ball, onFront } from './kit.js';

const D = {
	stone: plain( 0xd2c6ad, { roughness: 0.9 } ),
	castIron: plain( 0x22362b, { metalness: 0.5, roughness: 0.5 } ),
	wicker: plain( 0x8a6440, { roughness: 0.95 } ),
	cloth: plain( 0xe8dcc0, { roughness: 0.9, side: THREE.DoubleSide } ),
	tablecloth: plain( 0xf3efe6, { roughness: 0.9 } ),
	lamp: glow( 0xffe0a8, 1.8 ),
	face: plain( 0xf7f4ea, { roughness: 0.5 } )
};

// A canvas font: an 'italic …' family moves the style to the front, where canvas fonts want it.
const fontOf = ( weight, size, font ) => font.startsWith( 'italic ' ) ? `italic ${weight} ${size}px ${font.slice( 7 )}` : `${weight} ${size}px ${font}`;

// Text on a canvas sized to the text: returns the texture and the board's width for a given height.
function lettering( lines, { h, bg, ink, font, weight = '700', spacing = 0, pad = 0.35, border, minW = 0 } ) {

	const H = 160, canvas = document.createElement( 'canvas' ), ctx = canvas.getContext( '2d' );
	const sizes = lines.length > 1 ? [ H * 0.5, H * 0.24 ] : [ H * 0.72 ];
	let width = 0;
	lines.forEach( ( t, i ) => {

		ctx.font = fontOf( i ? '400' : weight, sizes[ i ], font );
		if ( 'letterSpacing' in ctx ) ctx.letterSpacing = `${i ? 2 : spacing}px`;
		width = Math.max( width, ctx.measureText( t ).width );

	} );
	const W = Math.max( Math.ceil( width + H * pad * 2 ), Math.round( minW / h * H ) );
	canvas.width = W;
	canvas.height = H;
	if ( bg ) {

		ctx.fillStyle = bg;
		ctx.fillRect( 0, 0, W, H );

	}

	if ( border ) {

		ctx.strokeStyle = border;
		ctx.lineWidth = H * 0.04;
		ctx.strokeRect( H * 0.07, H * 0.07, W - H * 0.14, H - H * 0.14 );

	}

	ctx.fillStyle = ink;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	lines.forEach( ( t, i ) => {

		ctx.font = fontOf( i ? '400' : weight, sizes[ i ], font );
		if ( 'letterSpacing' in ctx ) ctx.letterSpacing = `${i ? 2 : spacing}px`;
		ctx.fillText( t, W / 2, lines.length > 1 ? ( i ? H * 0.76 : H * 0.4 ) : H * 0.54 );

	} );
	const tex = new THREE.CanvasTexture( canvas );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return { tex, w: h * W / H };

}

const flat = ( tex, w, h, opts = {} ) => new THREE.Mesh( new THREE.PlaneGeometry( w, h ), new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.6, ...opts } ) );

function addBoard( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const { tex, w } = lettering( s.sub ? [ s.text, s.sub ] : [ s.text ], { h: s.h, bg: s.bg, ink: s.ink, font: s.font, weight: s.weight, spacing: s.spacing, minW: s.w, border: s.frame === 'gold' ? '#c9a046' : null } );
	const W = Math.min( w, s.w * 1.4 );
	const m = flat( tex, W, s.h );
	m.position.z = 0.1;
	g.add( m );
	if ( s.frame !== 'none' ) new Kit().add( s.frame === 'gold' ? M.woodDark : M.woodDark, box( W + 0.14, s.h + 0.14, 0.08, 0, - ( s.h + 0.14 ) / 2, 0.02 ) ).build( g );
	else new Kit().add( M.black, box( W, s.h, 0.06, 0, - s.h / 2, 0.03 ) ).build( g );
	scene.add( g );

}

function addLetters( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const { tex, w } = lettering( [ s.text ], { h: s.h * 1.5, ink: s.ink, font: s.italic ? `italic ${s.font}` : s.font, weight: s.weight, spacing: s.spacing, pad: 0.1 } );
	const m = flat( tex, w, s.h * 1.5, { transparent: true, depthWrite: false, ...( s.glow ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.2 } : {} ) } );
	m.position.z = 0.16; // clear of the ground floor's relief
	g.add( m );
	scene.add( g );

}

function addBadge( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const { tex } = lettering( [ s.text ], { h: 1, bg: s.bg, ink: s.ink, font: 'Georgia, serif', weight: '700', minW: 1 } );
	const disc = new THREE.Mesh( new THREE.CircleGeometry( s.r, 40 ), new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.5 } ) );
	disc.position.z = 0.16;
	g.add( disc );
	new Kit().add( plain( s.ring, { metalness: 0.7, roughness: 0.35 } ), new THREE.TorusGeometry( s.r, 0.05, 8, 40 ).translate( 0, 0, 0.15 ) ).add( M.woodDark, cyl( s.r + 0.02, s.r + 0.02, 0.12, 0, - 0.06, 0, 32 ).rotateX( Math.PI / 2 ).translate( 0, 0, 0.09 ) ).build( g );
	scene.add( g );

}

function addLantern( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	new Kit().add( M.iron, box( 0.04, 0.04, 0.5, 0, 0.25, 0.25 ), box( 0.03, 0.3, 0.03, 0, - 0.05, 0.02 ).rotateX( 0.8 ).translate( 0, 0, 0.12 ),
		new THREE.ConeGeometry( 0.17, 0.16, 4 ).rotateY( Math.PI / 4 ).translate( 0, 0.3, 0.5 ), box( 0.2, 0.06, 0.2, 0, - 0.12, 0.5 ) )
		.add( D.lamp, new THREE.CylinderGeometry( 0.13, 0.09, 0.32, 4 ).rotateY( Math.PI / 4 ).translate( 0, 0.06, 0.5 ) ).build( g, { shadows: false } );
	scene.add( g );

}

function flagTexture( kind ) {

	const c = document.createElement( 'canvas' );
	c.width = 300;
	c.height = 200;
	const x = c.getContext( '2d' );
	if ( kind === 'eu' ) {

		x.fillStyle = '#103f9c';
		x.fillRect( 0, 0, 300, 200 );
		x.fillStyle = '#ffd200';
		for ( let i = 0; i < 12; i ++ ) {

			const a = i / 12 * Math.PI * 2;
			x.beginPath();
			x.arc( 150 + Math.cos( a ) * 62, 100 + Math.sin( a ) * 62, 8, 0, Math.PI * 2 );
			x.fill();

		}

	} else {

		// The Czech flag: white over red, a blue wedge from the hoist to the middle.
		x.fillStyle = '#ffffff';
		x.fillRect( 0, 0, 300, 100 );
		x.fillStyle = '#d7141a';
		x.fillRect( 0, 100, 300, 100 );
		x.fillStyle = '#11457e';
		x.beginPath();
		x.moveTo( 0, 0 );
		x.lineTo( 150, 100 );
		x.lineTo( 0, 200 );
		x.fill();

	}

	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	return t;

}

function addFlags( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	// The pole leans out from a bracket, 35° above the horizontal; the flag hangs from its outer part, the hoist
	// along the pole.
	const L = 2.2, a = THREE.MathUtils.degToRad( 35 ), d = new THREE.Vector3( 0, Math.sin( a ), Math.cos( a ) );
	const base = new THREE.Vector3( 0, 0, 0.08 ), tip = base.clone().addScaledVector( d, L );
	const pole = new THREE.CylinderGeometry( 0.025, 0.025, L, 8 ).translate( 0, L / 2, 0 ).rotateX( Math.PI / 2 - a ).translate( base.x, base.y, base.z );
	new Kit().add( M.chrome, pole, ball( 0.05, tip.x, tip.y, tip.z, 8 ) ).add( M.iron, box( 0.16, 0.22, 0.08, 0, - 0.11, 0.04 ) ).build( g );
	const top0 = tip.clone().addScaledVector( d, - 1.25 ), drop = new THREE.Vector3( 0, - 0.85, 0 );
	const c = [ top0, tip, tip.clone().add( drop ), top0.clone().add( drop ) ];
	const uv = [ [ 0, 1 ], [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ]; // hoist (u = 0) along the pole
	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 1, 2, 0, 2, 3 ].flatMap( i => c[ i ].toArray() ), 3 ) );
	geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 1, 2, 0, 2, 3 ].flatMap( i => uv[ i ] ), 2 ) );
	geo.computeVertexNormals();
	g.add( new THREE.Mesh( geo, new THREE.MeshStandardNodeMaterial( { map: flagTexture( s.flags[ 0 ] ), side: THREE.DoubleSide, roughness: 0.9 } ) ) );
	scene.add( g );

}

// A stone portal with a round-arched gateway, panelled double doors, and an inscription panel over it.
function addPortal( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const W = s.w, H = s.h, R = W / 2, F = 0.45;
	const face = new THREE.Shape().moveTo( - R - F, - 0.2 ).lineTo( R + F, - 0.2 ).lineTo( R + F, H + 0.4 ).lineTo( - R - F, H + 0.4 ).closePath();
	face.holes.push( new THREE.Path().moveTo( - R, - 0.2 ).lineTo( - R, H - R ).absarc( 0, H - R, R, Math.PI, 0, true ).lineTo( R, - 0.2 ).closePath() );
	const kit = new Kit();
	kit.add( D.stone, new THREE.ExtrudeGeometry( face, { depth: 0.22, bevelEnabled: false, curveSegments: 18 } ) );
	kit.add( D.stone, box( 0.6, 0.6, 0.3, 0, H - 0.25, 0.05 ) ); // keystone
	// Doors in the opening (wood, panels as raised boxes), a little recessed.
	const doorShape = new THREE.Shape().moveTo( - R, - 0.2 ).lineTo( - R, H - R ).absarc( 0, H - R, R, Math.PI, 0, true ).lineTo( R, - 0.2 ).closePath();
	kit.add( M.woodDark, new THREE.ShapeGeometry( doorShape, 18 ).translate( 0, 0, 0.04 ) );
	for ( const side of [ - 1, 1 ] ) for ( const y of [ 0.3, 1.5 ] ) kit.add( M.woodMid, box( R * 0.62, 1.0, 0.05, side * R * 0.5, y, 0.05 ) );
	kit.add( M.brass, ball( 0.05, - 0.12, 1.2, 0.1 ), ball( 0.05, 0.12, 1.2, 0.1 ) );
	kit.build( g );
	const { tex, w } = lettering( [ s.text ], { h: 0.62, bg: s.stone, ink: s.ink, font: 'Georgia, "Times New Roman", serif', weight: '400', spacing: 6, pad: 0.5 } );
	const panel = flat( tex, w, 0.62 );
	panel.position.set( 0, H + 0.95, 0.26 );
	g.add( panel );
	new Kit().add( D.stone, box( w + 0.3, 0.92, 0.2, 0, H + 0.49, 0.05 ), box( w + 0.6, 0.14, 0.32, 0, H + 1.4, 0.05 ) ).build( g );
	scene.add( g );

}

// Seats on the terraces built here: [ x, y, z, facing, seat height ].
export const SEATS = [];

// The terrace: a row of cream awnings on posts over tables and wicker armchairs, the name on the valances.
function addCanopy( scene, s ) {

	const g = new THREE.Group();
	g.position.set( s.x, s.y, s.z );
	g.rotation.y = s.rot;
	const kit = new Kit(), H = 2.6, W = s.w, Dd = s.d;
	const cloth = plain( s.cloth, { roughness: 0.9, side: THREE.DoubleSide } );
	// Roof: shallow gable along the length.
	const roof = new THREE.BufferGeometry();
	const r = ( x, y, z ) => [ x, y, z ];
	const P = [ r( - W / 2, H, - Dd / 2 ), r( W / 2, H, - Dd / 2 ), r( W / 2, H + 0.45, 0 ), r( - W / 2, H + 0.45, 0 ), r( - W / 2, H, Dd / 2 ), r( W / 2, H, Dd / 2 ) ];
	const idx = [ 0, 2, 1, 0, 3, 2, 3, 5, 2, 3, 4, 5 ];
	roof.setAttribute( 'position', new THREE.Float32BufferAttribute( idx.flatMap( i => P[ i ] ), 3 ) );
	roof.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Array( idx.length * 2 ).fill( 0 ), 2 ) );
	roof.computeVertexNormals();
	kit.add( cloth, roof );
	for ( const x of [ - W / 2, - W / 6, W / 6, W / 2 ] ) for ( const z of [ - Dd / 2, Dd / 2 ] ) kit.add( M.woodDark, box( 0.08, H, 0.08, x * 0.98, 0, z * 0.96 ) );
	// Tables with white cloths and two armchairs each.
	for ( let i = 0; i < 6; i ++ ) for ( const z of [ - Dd / 4, Dd / 4 ] ) {

		const x = - W / 2 + W * ( i + 0.5 ) / 6;
		kit.add( D.tablecloth, cyl( 0.4, 0.42, 0.06, x, 0.72, z, 16 ) ).add( M.iron, cyl( 0.03, 0.03, 0.72, x, 0, z, 6 ) );
		for ( const side of [ - 1, 1 ] ) {

			const cx = x + side * 0.62;
			kit.add( D.wicker, box( 0.56, 0.42, 0.56, cx, 0, z ), box( 0.12, 0.42, 0.56, cx + side * 0.24, 0.42, z ), box( 0.56, 0.2, 0.1, cx, 0.42, z - 0.24 ), box( 0.56, 0.2, 0.1, cx, 0.42, z + 0.24 ) );
			// A seat for the street-life module (scene frame, facing the table; seat 0.42 m).
			const c = Math.cos( s.rot ), sn = Math.sin( s.rot );
			SEATS.push( [ s.x + cx * c + z * sn, s.y, s.z - cx * sn + z * c, Math.atan2( - side * c, side * sn ), 0.42 ] );

		}

	}

	kit.build( g );
	// Valances lettered with the restaurant's name.
	const { tex, w } = lettering( [ s.text.repeat( 3 ) ], { h: 0.3, bg: s.cloth, ink: s.ink, font: 'Georgia, serif', weight: '700', spacing: 4, pad: 0.05 } );
	tex.wrapS = THREE.RepeatWrapping;
	for ( const [ len, x, z, ry ] of [ [ W, 0, Dd / 2 + 0.01, 0 ], [ W, 0, - Dd / 2 - 0.01, Math.PI ], [ Dd, W / 2 + 0.01, 0, Math.PI / 2 ], [ Dd, - W / 2 - 0.01, 0, - Math.PI / 2 ] ] ) {

		const t = tex.clone();
		t.repeat.set( len / w, 1 );
		t.needsUpdate = true;
		const m = flat( t, len, 0.3 );
		m.position.set( x, H - 0.15, z );
		m.rotation.y = ry;
		g.add( m );

	}

	scene.add( g );

}

// The cast-iron street clock: a fluted green column with a round case and two dials, keeping Prague time.
function addClock( scene, s ) {

	const g = new THREE.Group();
	g.position.set( s.x, s.y, s.z );
	const kit = new Kit(), top = 3.3;
	kit.add( D.castIron, cyl( 0.22, 0.26, 0.5, 0, 0, 0, 12 ), cyl( 0.16, 0.2, 0.2, 0, 0.5, 0, 12 ), cyl( 0.08, 0.1, top - 0.9, 0, 0.7, 0, 12 ), cyl( 0.14, 0.1, 0.25, 0, top - 0.45, 0, 12 ) );
	kit.add( D.castIron, cyl( 0.42, 0.42, 0.24, 0, - 0.12, 0, 32 ).rotateX( Math.PI / 2 ).translate( 0, top, 0 ), ball( 0.08, 0, top + 0.5, 0, 10 ), cyl( 0.03, 0.06, 0.12, 0, top + 0.4, 0, 8 ) );
	kit.build( g );
	const c = document.createElement( 'canvas' );
	c.width = c.height = 256;
	const x = c.getContext( '2d' );
	x.fillStyle = '#f7f4ea';
	x.fillRect( 0, 0, 256, 256 );
	x.fillStyle = '#1b1b1b';
	for ( let i = 0; i < 12; i ++ ) {

		const a = i / 12 * Math.PI * 2;
		x.save();
		x.translate( 128 + Math.sin( a ) * 100, 128 - Math.cos( a ) * 100 );
		x.rotate( a );
		x.fillRect( - 4, - 12, 8, 24 );
		x.restore();

	}

	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	const hands = [];
	for ( const side of [ - 1, 1 ] ) {

		const dial = new THREE.Mesh( new THREE.CircleGeometry( 0.36, 40 ), new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.4 } ) );
		dial.position.set( 0, top, side * 0.125 );
		if ( side < 0 ) dial.rotation.y = Math.PI;
		g.add( dial );
		for ( const [ len, wd ] of [ [ 0.2, 0.035 ], [ 0.3, 0.022 ] ] ) {

			const hand = new THREE.Mesh( new THREE.BoxGeometry( wd, len, 0.01 ).translate( 0, len / 2 - 0.03, 0 ), M.black );
			hand.position.set( 0, top, side * 0.135 );
			hand.userData.side = side;
			hand.userData.dynamic = true; // turned by the clock below: kept out of the static batches (src/batch.js)
			hands.push( hand );
			g.add( hand );

		}

	}

	const tick = () => {

		const now = new Date( new Date().toLocaleString( 'en-US', { timeZone: 'Europe/Prague' } ) );
		const m = now.getMinutes() + now.getSeconds() / 60, h = now.getHours() % 12 + m / 60;
		hands.forEach( ( hand, i ) => {

			const a = ( i % 2 ? m / 60 : h / 12 ) * Math.PI * 2;
			hand.rotation.z = - a * hand.userData.side;

		} );

	};

	tick();
	setInterval( tick, 20000 );
	scene.add( g );

}

// Enamel plates, all on one texture: red house register numbers (with the district), blue street numbers, red
// street name plates; each a quad 2 cm off its wall.
function addPlates( scene, plates ) {

	if ( ! plates.length ) return;
	const SIZE = { cp: [ 0.3, 0.22, 132, 96 ], or: [ 0.22, 0.17, 100, 76 ], street: [ 0.74, 0.24, 360, 116 ] };
	const AW = 2048, MAXH = 2048;
	let x = 0, y = 0, rowH = 0;
	const cells = [];
	for ( const p of plates ) {

		const [ , , cw, ch ] = SIZE[ p.kind ];
		if ( x + cw > AW ) {

			x = 0;
			y += rowH + 2;
			rowH = 0;

		}

		if ( y + ch > MAXH ) break; // page full: the rest go on another texture
		cells.push( { x, y, w: cw, h: ch } );
		x += cw + 2;
		rowH = Math.max( rowH, ch );

	}

	if ( cells.length < plates.length ) {

		addPlates( scene, plates.slice( cells.length ) );
		plates = plates.slice( 0, cells.length );

	}

	const AH = THREE.MathUtils.ceilPowerOfTwo( y + rowH );
	const canvas = document.createElement( 'canvas' );
	canvas.width = AW;
	canvas.height = AH;
	const ctx = canvas.getContext( '2d' );
	const round = ( c, r ) => {

		ctx.beginPath();
		ctx.roundRect ? ctx.roundRect( c.x, c.y, c.w, c.h, r ) : ctx.rect( c.x, c.y, c.w, c.h );

	};

	const sans = '"Helvetica Neue", Arial, sans-serif';
	plates.forEach( ( p, i ) => {

		const c = cells[ i ];
		round( c, c.h * 0.12 );
		ctx.fillStyle = p.kind === 'or' ? '#1d3e8c' : '#c41f28';
		ctx.fill();
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = Math.max( 2, c.h * 0.035 );
		ctx.strokeRect( c.x + c.h * 0.08, c.y + c.h * 0.08, c.w - c.h * 0.16, c.h - c.h * 0.16 );
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const fit = ( text, size, wt, yy, maxW ) => {

			let s = size;
			ctx.font = `${wt} ${s}px ${sans}`;
			while ( ctx.measureText( text ).width > maxW && s > 8 ) ctx.font = `${wt} ${s -= 2}px ${sans}`;
			ctx.fillText( text, c.x + c.w / 2, yy );

		};

		if ( p.kind === 'cp' ) {

			fit( p.text, c.h * 0.46, '700', c.y + c.h * 0.36, c.w * 0.8 );
			fit( p.sub[ 0 ], c.h * 0.13, '700', c.y + c.h * 0.66, c.w * 0.8 );
			fit( p.sub[ 1 ], c.h * 0.12, '700', c.y + c.h * 0.8, c.w * 0.8 );

		} else if ( p.kind === 'or' ) {

			fit( p.text, c.h * 0.62, '700', c.y + c.h * 0.54, c.w * 0.78 );

		} else {

			fit( p.text, c.h * 0.4, '700', c.y + c.h * 0.42, c.w * 0.86 );
			fit( p.sub, c.h * 0.14, '700', c.y + c.h * 0.74, c.w * 0.8 );

		}

	} );
	const tex = new THREE.CanvasTexture( canvas );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;

	const pos = [], uv = [], nor = [];
	plates.forEach( ( p, i ) => {

		const [ w, h ] = SIZE[ p.kind ], c = cells[ i ];
		const [ nx, nz ] = p.n, rx = nz, rz = - nx; // along the wall, to the right seen from the street
		const cx = p.x + nx * 0.025, cz = p.z + nz * 0.025;
		const corner = ( sx, sy ) => [ cx + rx * sx * w / 2, p.y + sy * h / 2, cz + rz * sx * w / 2 ];
		const u0 = c.x / AW, u1 = ( c.x + c.w ) / AW, v0 = 1 - ( c.y + c.h ) / AH, v1 = 1 - c.y / AH;
		const quad = [ [ - 1, - 1, u0, v0 ], [ 1, - 1, u1, v0 ], [ 1, 1, u1, v1 ], [ - 1, - 1, u0, v0 ], [ 1, 1, u1, v1 ], [ - 1, 1, u0, v1 ] ];
		for ( const [ sx, sy, u, v ] of quad ) {

			pos.push( ...corner( sx, sy ) );
			uv.push( u, v );
			nor.push( nx, 0, nz );

		}

	} );
	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	geo.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	scene.add( new THREE.Mesh( geo, new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.3, metalness: 0.1 } ) ) );

}

// Garden walls (tools/walls.mjs): plastered, with a thin tiled coping; barred gates with iron bars between stone
// jambs; open gateways leave a gap with an arch-less lintel.
// Garden and retaining walls (a streamed square's: src/main.js), their materials shared by all the squares.
const wallMats = new Map();
let wallCoping = null;
export function addWalls( scene, walls ) {

	const kit = new Kit(), mats = wallMats;
	const mat = c => mats.get( c ) || mats.set( c, plain( c, { roughness: 0.95 } ) ).get( c );
	const coping = wallCoping ||= plain( 0x8d4a35, { roughness: 0.8 } );
	for ( const w of walls ) {

		const len = Math.hypot( w.x1 - w.x0, w.z1 - w.z0 ), rot = Math.atan2( w.x1 - w.x0, w.z1 - w.z0 );
		const mx = ( w.x0 + w.x1 ) / 2, mz = ( w.z0 + w.z1 ) / 2;
		const place = geo => geo.rotateY( rot ).translate( mx, w.y, mz );
		if ( w.kind === 'wall' ) {

			kit.add( mat( w.colour ), place( box( 0.4, w.h + 0.6, len + 0.02, 0, - 0.6, 0 ) ) );
			kit.add( coping, place( box( 0.5, 0.08, len + 0.04, 0, w.h, 0 ) ) );
			// A clipped hedge growing over the wall from the garden.
			if ( w.hedge ) kit.add( M.leaf, place( box( 0.9, w.hedge, len + 0.1, 0, w.h + 0.02, 0 ) ) );

		} else {

			for ( const e of [ - 1, 1 ] ) kit.add( mat( w.colour ), place( box( 0.45, w.h + 0.2, 0.25, 0, - 0.2, e * ( len / 2 + 0.05 ) ) ) );
			if ( w.kind === 'barred' ) {

				for ( let z = - len / 2 + 0.1; z <= len / 2 - 0.09; z += 0.12 ) kit.add( M.iron, place( box( 0.03, w.h - 0.3, 0.03, 0, 0, z ) ) );
				for ( const y of [ 0.15, w.h - 0.4 ] ) kit.add( M.iron, place( box( 0.04, 0.05, len, 0, y, 0 ) ) );

			} else kit.add( M.iron, place( box( 0.05, 0.08, len + 0.3, 0, w.h - 0.1, 0 ) ) );

		}

	}

	kit.build( scene );

}

// A sign hanging from an iron bracket at right angles to the wall: a board lettered on both faces, so it reads from
// either direction along the street.
function addHanging( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const { tex } = lettering( s.sub ? [ s.text, s.sub ] : [ s.text ], { h: s.h, bg: s.bg, ink: s.ink, font: s.font, weight: '700', minW: s.w, pad: 0.15 } );
	const out = s.w / 2 + 0.25;
	for ( const side of [ - 1, 1 ] ) {

		const face = flat( tex, s.w, s.h );
		face.rotation.y = side * Math.PI / 2;
		face.position.set( side * 0.026, - s.h / 2 - 0.08, out );
		g.add( face );

	}

	new Kit().add( M.woodDark, box( 0.05, s.h + 0.04, s.w + 0.04, 0, - s.h - 0.1, out ) )
		.add( M.iron, box( 0.04, 0.04, s.w + 0.45, 0, 0, ( s.w + 0.45 ) / 2 ), box( 0.02, 0.08, 0.02, 0, - 0.08, out - s.w / 2 + 0.05 ), box( 0.02, 0.08, 0.02, 0, - 0.08, out + s.w / 2 - 0.05 ),
			box( 0.03, 0.55, 0.03, 0, - 0.55, 0.04 ).rotateX( 0.75 ).translate( 0, 0, 0.32 ) ).build( g );
	scene.add( g );

}

function addMemorial1711( scene, s ) {

	// The memorial of 17 November 1989 in its arch on Národní 16: a white stone panel standing on a stone step in the
	// glazed arch, the dark bronze of raised hands (one making the V sign) with the date under it, candles and
	// flowers on the step and on the pavement in front (Street View 2025-09). The group stands on the pavement at
	// the arch's middle, z out of the wall.
	const g = onFront( s.x, s.ground ?? s.y, s.z, s.n );
	const c = document.createElement( 'canvas' );
	c.width = 512;
	c.height = 400;
	const x = c.getContext( '2d' );
	x.fillStyle = '#2a241d';
	x.fillRect( 0, 0, 512, 400 );
	x.fillStyle = '#6e5a3c';
	for ( let k = 0; k < 7; k ++ ) {

		// Open palms reaching up, with the fingers spread; the middle one the V sign.
		const hx = 70 + k * 62, hy = 120 + ( k % 3 ) * 22;
		x.beginPath();
		x.ellipse( hx, hy + 40, 22, 30, 0, 0, Math.PI * 2 );
		x.fill();
		x.fillRect( hx - 13, hy + 60, 26, 110 );
		const fingers = k === 3 ? [ - 0.25, 0.25 ] : [ - 0.42, - 0.15, 0.08, 0.3, 0.75 ];
		for ( const a of fingers ) {

			x.save();
			x.translate( hx, hy + 30 );
			x.rotate( a );
			x.fillRect( - 5, - ( a > 0.6 ? 40 : 62 ), 10, a > 0.6 ? 40 : 62 );
			x.restore();

		}

	}

	x.fillStyle = '#b89a62';
	x.font = '700 44px Georgia, serif';
	x.textAlign = 'center';
	x.fillText( '17. 11. 1989', 256, 370 );
	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	const plaque = flat( tex, 1.0, 0.78, { metalness: 0.55, roughness: 0.5 } );
	plaque.position.set( 0, 1.75, 0.17 );
	g.add( plaque );

	const stone = plain( 0xece9e2, { roughness: 0.7 } );
	const k = new Kit();
	k.add( plain( 0xc9c3b6 ), box( 2.5, 0.28, 0.5, 0, 0, 0.2 ) ); // the step in the arch
	k.add( stone, box( 1.5, 2.3, 0.14, 0, 0.28, 0.08 ) ); // the panel
	k.add( plain( 0x1f1a14, { metalness: 0.5, roughness: 0.5 } ), box( 1.1, 0.88, 0.04, 0, 1.31, 0.15 ) ); // the bronze's dark frame

	// Candles in red and clear glass on the step and in a cluster on the pavement, and bunches of flowers.
	const cups = [ 0xc8202a, 0xf2efe6, 0xc8202a, 0xd8d2c0 ];
	const candle = ( cx, y, cz, i ) => {

		k.add( plain( cups[ i % 4 ], { roughness: 0.3, transparent: true, opacity: 0.85 } ), cyl( 0.04, 0.035, 0.12, cx, y, cz, 8 ) );
		k.add( glow( 0xffb04a, 2.5 ), ball( 0.013, cx, y + 0.14, cz, 5 ) );

	};

	for ( let i = 0; i < 11; i ++ ) candle( - 1.05 + i * 0.21, 0.28, 0.32 + ( i % 2 ) * 0.07, i );
	for ( let i = 0; i < 14; i ++ ) candle( - 0.9 + ( i % 7 ) * 0.3 + ( i % 3 ) * 0.04, 0, 0.6 + Math.floor( i / 7 ) * 0.22 + ( i % 2 ) * 0.05, i + 1 );
	for ( let i = 0; i < 5; i ++ ) {

		const fx = - 0.8 + i * 0.4, fz = 0.95 + ( i % 2 ) * 0.1;
		k.add( plain( [ 0xc8102e, 0xf4f4f0, 0x2a5fb0, 0xc8102e, 0xf4f4f0 ][ i ] ), ball( 0.07, fx, 0.06, fz, 6 ), ball( 0.06, fx + 0.08, 0.05, fz - 0.1, 6 ) );
		k.add( M.leaf, cyl( 0.012, 0.012, 0.35, 0, 0, 0, 4 ).rotateX( 1.35 ).translate( fx, 0.04, fz ) ); // stems lying on the pavement

	}

	k.build( g, { shadows: false } );
	scene.add( g );

}

// The art nouveau cartouche of Česká pojišťovna: red, a gold frame and the Czech lion, the company's name.
function addCartouche( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const c = document.createElement( 'canvas' );
	c.width = 768;
	c.height = 300;
	const x = c.getContext( '2d' );
	x.fillStyle = '#e9e1c8';
	x.fillRect( 0, 0, 768, 300 );
	x.fillStyle = '#b3211e';
	x.beginPath();
	x.ellipse( 384, 150, 370, 140, 0, 0, Math.PI * 2 );
	x.fill();
	x.strokeStyle = '#d8a83a';
	x.lineWidth = 12;
	x.stroke();
	x.fillStyle = '#f2e7c4';
	x.textAlign = 'center';
	x.font = '700 40px Georgia, serif';
	x.fillText( s.text, 384, 110 );
	x.font = '700 64px Georgia, serif';
	x.fillText( s.sub, 384, 180 );
	x.font = '400 26px Georgia, serif';
	x.fillText( '( ZAL. R. 1827 )', 384, 225 );
	// The lion, rampant, in gold, on the right.
	x.fillStyle = '#e2b64a';
	x.beginPath();
	x.ellipse( 650, 150, 38, 55, 0.3, 0, Math.PI * 2 );
	x.fill();
	x.beginPath();
	x.arc( 668, 90, 22, 0, Math.PI * 2 );
	x.fill();
	for ( const [ ax, ay, bx, by ] of [ [ 640, 195, 615, 250 ], [ 665, 195, 690, 250 ], [ 670, 120, 715, 100 ], [ 630, 160, 600, 120 ] ] ) {

		x.lineWidth = 14;
		x.strokeStyle = '#e2b64a';
		x.beginPath();
		x.moveTo( ax, ay );
		x.lineTo( bx, by );
		x.stroke();

	}

	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	const m = flat( tex, 3.4, 1.33 );
	m.position.z = 0.12;
	g.add( m );
	new Kit().add( M.gold, box( 3.5, 1.43, 0.08, 0, - 0.715, 0.06 ) ).build( g );
	scene.add( g );

}

// Polívka's mosaic panels between the windows: deep blue with gold leafy scrolls.
const mosaicTex = ( () => {

	let t = null;
	return () => t || ( t = ( () => {

		const c = document.createElement( 'canvas' );
		c.width = 512;
		c.height = 160;
		const x = c.getContext( '2d' );
		x.fillStyle = '#1f3d7a';
		x.fillRect( 0, 0, 512, 160 );
		x.strokeStyle = '#e2b64a';
		x.lineWidth = 7;
		for ( let k = 0; k < 4; k ++ ) {

			x.beginPath();
			x.arc( 64 + k * 128, 80, 44, 0.3, Math.PI * 1.7 );
			x.stroke();
			x.beginPath();
			x.moveTo( 64 + k * 128, 80 );
			x.quadraticCurveTo( 100 + k * 128, 20, 128 + k * 128, 80 );
			x.stroke();

		}

		x.fillStyle = '#e2b64a';
		for ( let k = 0; k < 40; k ++ ) x.fillRect( ( k * 53 ) % 512, ( k * 37 ) % 160, 6, 6 );
		const tex = new THREE.CanvasTexture( c );
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;

	} )() );

} )();

function addMosaic( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const m = flat( mosaicTex(), s.w, s.h, { metalness: 0.35, roughness: 0.35 } );
	m.position.z = 0.06;
	g.add( m );
	scene.add( g );

}

// Diamant's door (Spálená 4, 1912–13, Emil Králíček): crystalline cubist pilasters with faceted capitals either side.
function addCubistDoor( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const stone = plain( 0xd8d4c8, { flatShading: true, roughness: 0.85 } );
	const k = new Kit();
	for ( const side of [ - 1, 1 ] ) {

		const x = side * s.w / 2;
		k.add( stone, new THREE.CylinderGeometry( 0.22, 0.3, s.h, 4 ).rotateY( Math.PI / 4 ).translate( x, s.h / 2, 0.25 ) );
		k.add( stone, new THREE.ConeGeometry( 0.48, 0.9, 4 ).rotateY( Math.PI / 4 ).rotateX( Math.PI ).translate( x, s.h + 0.45, 0.3 ) );
		k.add( stone, new THREE.OctahedronGeometry( 0.32, 0 ).scale( 1, 1.5, 0.7 ).translate( x, s.h + 1.05, 0.3 ) );

	}

	k.add( stone, box( s.w + 1.2, 0.35, 0.5, 0, s.h + 1.3, 0.25 ) );
	k.build( g );
	scene.add( g );

}

// St John of Nepomuk, baroque, on a pedestal: cassock and surplice, the fur cape, biretta, a crucifix held across
// him, the halo of five gold stars. With frame 'cubist': inside Diamant's cubist niche, a pointed, faceted arch.
function addSaint( scene, s ) {

	const g = new THREE.Group();
	g.position.set( s.x, s.y, s.z );
	g.rotation.y = s.rot;
	const stone = plain( 0xbdb5a5, { roughness: 0.9 } ), dark = plain( 0x8c8578, { roughness: 0.9 } );
	const k = new Kit();
	k.add( stone, box( 1.3, 0.35, 1.1, 0, 0, 0 ), box( 1.0, 1.55, 0.85, 0, 0.35, 0 ), box( 1.25, 0.25, 1.05, 0, 1.9, 0 ) );
	const b = 2.15; // the figure's feet
	k.add( dark, new THREE.LatheGeometry( [ [ 0.0, 0 ], [ 0.42, 0 ], [ 0.36, 0.6 ], [ 0.27, 1.2 ], [ 0.0, 1.25 ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), 10 ).translate( 0, b, 0 ) );
	k.add( stone, new THREE.LatheGeometry( [ [ 0.0, 0 ], [ 0.4, 0 ], [ 0.33, 0.45 ], [ 0.0, 0.5 ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), 10 ).translate( 0, b + 0.55, 0 ) );
	k.add( stone, new THREE.ConeGeometry( 0.36, 0.35, 10 ).translate( 0, b + 1.33, 0 ) );
	k.add( stone, ball( 0.15, 0, b + 1.62, 0.02, 10 ), box( 0.24, 0.12, 0.24, 0, b + 1.72, 0.02 ) );
	k.add( dark, box( 0.04, 0.55, 0.04, 0.05, b + 0.85, 0.32 ).rotateZ( 0.3 ), box( 0.26, 0.04, 0.04, 0.05, b + 1.2, 0.33 ) );
	for ( let i = 0; i < 5; i ++ ) {

		const a = - 0.9 + i * 0.45;
		k.add( M.gold, new THREE.OctahedronGeometry( 0.05, 0 ).translate( Math.sin( a ) * 0.3, b + 1.68 + Math.cos( a ) * 0.3, - 0.02 ) );

	}

	if ( s.frame === 'cubist' ) {

		// The niche: two faceted piers and a pointed arch over the statue, a low cubist grille in front.
		const white = plain( 0xe8e5dc, { flatShading: true, roughness: 0.85 } );
		const arch = new THREE.Shape().moveTo( - 1.6, 0 ).lineTo( 1.6, 0 ).lineTo( 1.6, 4.4 ).lineTo( 0, 5.6 ).lineTo( - 1.6, 4.4 ).closePath();
		arch.holes.push( new THREE.Path().moveTo( - 1.1, 0 ).lineTo( 1.1, 0 ).lineTo( 1.1, 4.0 ).lineTo( 0, 4.9 ).lineTo( - 1.1, 4.0 ).closePath() );
		k.add( white, new THREE.ExtrudeGeometry( arch, { depth: 0.6, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 1 } ).translate( 0, 0, - 0.75 ) );
		for ( let i = - 3; i <= 3; i ++ ) k.add( M.iron, box( 0.03, 0.9, 0.03, i * 0.16, 0, 0.8 ) );
		k.add( M.iron, box( 1.1, 0.04, 0.04, 0, 0.88, 0.8 ) );

	}

	k.build( g );
	scene.add( g );

}

// A bronze triga on its pylon: Victory standing in a chariot behind three rearing horses (the National Theatre).
function addTriga( scene, s ) {

	const g = new THREE.Group();
	g.position.set( s.x, s.y, s.z );
	g.rotation.y = s.rot;
	const bronze = plain( 0x3f6b55, { metalness: 0.55, roughness: 0.5, flatShading: true } );
	const stone = plain( 0xb59a74, { roughness: 0.85 } );
	const k = new Kit();
	k.add( stone, box( 3.2, 2.2, 3.6, 0, - 2.2, - 0.2 ), box( 3.6, 0.3, 4.0, 0, - 0.3, - 0.2 ) );
	for ( const hx of [ - 0.75, 0, 0.75 ] ) {

		// A horse rearing forwards (+z).
		k.add( bronze, new THREE.CapsuleGeometry( 0.28, 0.9, 3, 7 ).rotateX( Math.PI / 2 + 0.5 ).translate( hx, 1.1, 0.7 ) );
		k.add( bronze, new THREE.CapsuleGeometry( 0.14, 0.45, 3, 6 ).rotateX( 0.35 ).translate( hx, 1.75, 1.15 ) );
		k.add( bronze, new THREE.BoxGeometry( 0.18, 0.2, 0.42 ).rotateX( 0.4 ).translate( hx, 2.05, 1.38 ) );
		for ( const lz of [ 0.25, 0.3 ] ) for ( const lx of [ - 0.1, 0.1 ] ) k.add( bronze, new THREE.CylinderGeometry( 0.05, 0.04, 0.85, 5 ).translate( 0, - 0.42, 0 ).rotateX( lz === 0.25 ? 0.15 : - 0.9 ).translate( hx + lx, lz === 0.25 ? 0.8 : 1.15, lz === 0.25 ? 0.25 : 1.05 ) );

	}

	k.add( bronze, box( 1.3, 0.7, 0.9, 0, 0.35, - 0.6 ) );
	for ( const side of [ - 1, 1 ] ) k.add( bronze, new THREE.TorusGeometry( 0.42, 0.05, 5, 14 ).rotateY( Math.PI / 2 ).translate( side * 0.7, 0.45, - 0.6 ) );
	// Victory: a long dress, raised arm with a wreath, wings.
	k.add( bronze, new THREE.LatheGeometry( [ [ 0, 0 ], [ 0.3, 0 ], [ 0.22, 0.9 ], [ 0.16, 1.4 ], [ 0, 1.45 ] ].map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), 8 ).translate( 0, 1.05, - 0.6 ) );
	k.add( bronze, ball( 0.13, 0, 2.62, - 0.6, 7 ), new THREE.CylinderGeometry( 0.04, 0.04, 0.8, 5 ).rotateX( - 0.6 ).translate( 0.15, 2.8, - 0.4 ), new THREE.TorusGeometry( 0.16, 0.03, 4, 10 ).translate( 0.15, 3.2, - 0.15 ) );
	for ( const side of [ - 1, 1 ] ) k.add( bronze, new THREE.BoxGeometry( 0.05, 1.1, 0.5 ).rotateZ( side * 0.5 ).translate( side * 0.45, 2.3, - 0.8 ) );
	k.build( g );
	scene.add( g );

}

// The Prague metro sign: a grey post with a square box, the white M-and-arrow on the line's colour (B: yellow),
// both faces, and the station name under it.
const metroTex = ( () => {

	const cache = {};
	return ( line, name ) => cache[ line + name ] || ( cache[ line + name ] = ( () => {

		const c = document.createElement( 'canvas' );
		c.width = 256;
		c.height = 320;
		const x = c.getContext( '2d' );
		x.fillStyle = { A: '#1b9e4b', B: '#f7c600', C: '#d4202a' }[ line ];
		x.fillRect( 0, 0, 256, 256 );
		x.fillStyle = '#ffffff';
		// The M whose middle point runs down into an arrow.
		x.beginPath();
		x.moveTo( 48, 200 );
		x.lineTo( 48, 56 );
		x.lineTo( 128, 150 );
		x.lineTo( 208, 56 );
		x.lineTo( 208, 200 );
		x.lineTo( 176, 200 );
		x.lineTo( 176, 128 );
		x.lineTo( 146, 168 );
		x.lineTo( 166, 168 );
		x.lineTo( 128, 222 );
		x.lineTo( 90, 168 );
		x.lineTo( 110, 168 );
		x.lineTo( 80, 128 );
		x.lineTo( 80, 200 );
		x.closePath();
		x.fill();
		x.fillStyle = '#2a2d31';
		x.fillRect( 0, 256, 256, 64 );
		x.fillStyle = '#ffffff';
		x.font = '700 30px "Helvetica Neue", Arial, sans-serif';
		x.textAlign = 'center';
		x.fillText( name, 128, 298 );
		const t = new THREE.CanvasTexture( c );
		t.colorSpace = THREE.SRGBColorSpace;
		return t;

	} )() );

} )();

function addPylon( scene, s ) {

	const g = new THREE.Group();
	g.position.set( s.x, s.y, s.z );
	g.rotation.y = s.rot;
	new Kit().add( plain( 0x50555b, { metalness: 0.4, roughness: 0.5 } ), box( 0.14, 2.6, 0.14, 0, 0, 0 ), box( 0.72, 0.92, 0.16, 0, 2.6, 0 ) ).build( g );
	for ( const side of [ - 1, 1 ] ) {

		const m = flat( metroTex( s.line, s.name ), 0.64, 0.8, { emissive: 0xffffff, emissiveMap: metroTex( s.line, s.name ), emissiveIntensity: 0.35 } );
		m.position.set( 0, 3.06, side * 0.085 );
		if ( side < 0 ) m.rotation.y = Math.PI;
		g.add( m );

	}

	scene.add( g );

}

// Brand signs drawn after the brands' public look (colours, lettering, the shape of the mark), simplified; no logo
// files are used. s.brand picks the drawing, s.w × s.h its size (m); s.blade hangs it out from the wall on a bracket,
// seen from both directions along the street.
const LOGOS = {

	// Pilsner Urquell: the bottle-green label with a gold rule, the name in a cream script, the red seal with the
	// brewery gate under it.
	pilsner( x, W, H ) {

		x.fillStyle = '#16452c';
		x.fillRect( 0, 0, W, H );
		x.strokeStyle = '#c9a24a';
		x.lineWidth = W * 0.02;
		x.strokeRect( W * 0.04, H * 0.04, W * 0.92, H * 0.92 );
		x.fillStyle = '#f3e7c4';
		x.textAlign = 'center';
		x.font = `italic 700 ${H * 0.2}px "Brush Script MT", "Segoe Script", Georgia, serif`;
		x.fillText( 'Pilsner', W / 2, H * 0.34 );
		x.fillText( 'Urquell', W / 2, H * 0.56 );
		x.fillStyle = '#b3202a';
		x.beginPath();
		x.arc( W / 2, H * 0.76, H * 0.12, 0, Math.PI * 2 );
		x.fill();
		x.fillStyle = '#f3e7c4';
		x.fillRect( W / 2 - H * 0.06, H * 0.74, H * 0.12, H * 0.07 );
		x.beginPath();
		x.arc( W / 2, H * 0.74, H * 0.06, Math.PI, 0 );
		x.fill();
		x.fillStyle = '#b3202a';
		x.fillRect( W / 2 - H * 0.025, H * 0.75, H * 0.05, H * 0.06 );

	},

	// KFC: the square box sign, a white field with the red stripes along the top, the Colonel's head (white hair,
	// glasses, goatee, black string tie) in red outline and KFC in heavy red letters.
	kfc( x, W, H ) {

		x.fillStyle = '#ffffff';
		x.fillRect( 0, 0, W, H );
		x.fillStyle = '#e4002b';
		for ( let k = 0; k < 3; k ++ ) x.fillRect( W * ( 0.12 + k * 0.28 ), 0, W * 0.18, H * 0.14 );
		const cx = W / 2, cy = H * 0.44, r = H * 0.2;
		x.fillStyle = '#e4002b';
		x.beginPath();
		x.arc( cx, cy, r * 1.25, 0, Math.PI * 2 );
		x.fill();
		x.fillStyle = '#ffffff';
		x.beginPath();
		x.ellipse( cx, cy, r * 0.8, r, 0, 0, Math.PI * 2 );
		x.fill();
		x.strokeStyle = '#1b1b1b';
		x.lineWidth = r * 0.09;
		for ( const s of [ - 1, 1 ] ) x.strokeRect( cx + s * r * 0.36 - r * 0.24, cy - r * 0.3, r * 0.48, r * 0.3 );
		x.beginPath();
		x.moveTo( cx - r * 0.12, cy - r * 0.15 );
		x.lineTo( cx + r * 0.12, cy - r * 0.15 );
		x.stroke();
		x.fillStyle = '#e4002b';
		x.beginPath();
		x.ellipse( cx, cy + r * 0.62, r * 0.3, r * 0.34, 0, 0, Math.PI * 2 );
		x.fill();
		x.fillStyle = '#1b1b1b';
		x.beginPath();
		x.moveTo( cx - r * 0.3, cy + r * 1.05 );
		x.lineTo( cx + r * 0.3, cy + r * 1.05 );
		x.lineTo( cx, cy + r * 1.3 );
		x.fill();
		x.fillStyle = '#e4002b';
		x.textAlign = 'center';
		x.font = `900 ${H * 0.2}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
		x.fillText( 'KFC', cx, H * 0.95 );

	},

	// Česká spořitelna: the bank's bright blue with white lettering, its round white mark on the left.
	cs( x, W, H ) {

		x.fillStyle = '#2870ed';
		x.fillRect( 0, 0, W, H );
		x.fillStyle = '#ffffff';
		x.beginPath();
		x.arc( H * 0.5, H * 0.5, H * 0.3, 0, Math.PI * 2 );
		x.fill();
		x.fillStyle = '#2870ed';
		x.beginPath();
		x.arc( H * 0.5, H * 0.5, H * 0.13, 0, Math.PI * 2 );
		x.fill();
		x.fillStyle = '#ffffff';
		x.textAlign = 'left';
		x.font = `700 ${H * 0.36}px "Helvetica Neue", Arial, sans-serif`;
		x.fillText( 'Česká spořitelna', H * 0.95, H * 0.63 );

	},

	// The bank's ATM wall on Na Perštýně: the whole bay in its blue, BANKOMAT / ATM over two cash machines.
	csAtm( x, W, H ) {

		x.fillStyle = '#2b78f0';
		x.fillRect( 0, 0, W, H );
		x.fillStyle = '#ffffff';
		x.textAlign = 'center';
		x.font = `700 ${H * 0.06}px "Helvetica Neue", Arial, sans-serif`;
		x.fillText( 'BANKOMAT / ATM', W / 2, H * 0.14 );
		for ( const s of [ - 1, 1 ] ) {

			const mx = W / 2 + s * W * 0.17;
			x.fillStyle = '#d7dde4';
			x.fillRect( mx - W * 0.09, H * 0.28, W * 0.18, H * 0.5 );
			x.fillStyle = '#20262c';
			x.fillRect( mx - W * 0.06, H * 0.33, W * 0.12, H * 0.13 );
			x.fillStyle = '#7d868f';
			x.fillRect( mx - W * 0.07, H * 0.55, W * 0.14, H * 0.08 );

		}

	}

};

function addLogo( scene, s ) {

	const g = onFront( s.x, s.y, s.z, s.n );
	const c = document.createElement( 'canvas' );
	const px = 360 / Math.max( s.w, s.h );
	c.width = Math.round( s.w * px );
	c.height = Math.round( s.h * px );
	LOGOS[ s.brand ]( c.getContext( '2d' ), c.width, c.height );
	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	const k = new Kit();
	if ( s.blade ) {

		// A box sign on an arm, its faces along the street.
		const out = s.w / 2 + 0.3;
		for ( const side of [ - 1, 1 ] ) {

			const face = flat( tex, s.w, s.h, s.glow ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 } : {} );
			face.rotation.y = side * Math.PI / 2;
			face.position.set( side * 0.081, 0, out );
			g.add( face );

		}

		k.add( M.black, box( 0.16, s.h + 0.04, s.w + 0.04, 0, - s.h / 2 - 0.02, out ), box( 0.05, 0.05, 0.32, 0, 0.1, 0.16 ) );

	} else {

		const face = flat( tex, s.w, s.h );
		face.position.z = 0.11;
		g.add( face );
		k.add( M.black, box( s.w + 0.04, s.h + 0.04, 0.08, 0, - s.h / 2 - 0.02, 0.04 ) );

	}

	k.build( g );
	scene.add( g );

}

const ADD = { logo: addLogo, memorial1711: addMemorial1711, cartouche: addCartouche, mosaic: addMosaic, cubistDoor: addCubistDoor, saint: addSaint, triga: addTriga, pylon: addPylon, hanging: addHanging, board: addBoard, letters: addLetters, badge: addBadge, lantern: addLantern, flags: addFlags, portal: addPortal, canopy: addCanopy, clock: addClock };

export function addDress( scene, places ) {

	for ( const s of places.dress || [] ) ADD[ s.kind ]?.( scene, s );
	addPlates( scene, places.plates || [] );
	if ( places.walls?.length ) addWalls( scene, places.walls );

}
