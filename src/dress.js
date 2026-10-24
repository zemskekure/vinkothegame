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

// Text on a canvas sized to the text: returns the texture and the board's width for a given height.
function lettering( lines, { h, bg, ink, font, weight = '700', spacing = 0, pad = 0.35, border, minW = 0 } ) {

	const H = 160, canvas = document.createElement( 'canvas' ), ctx = canvas.getContext( '2d' );
	const sizes = lines.length > 1 ? [ H * 0.5, H * 0.24 ] : [ H * 0.72 ];
	let width = 0;
	lines.forEach( ( t, i ) => {

		ctx.font = `${i ? '400' : weight} ${sizes[ i ]}px ${font}`;
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

		ctx.font = `${i ? '400' : weight} ${sizes[ i ]}px ${font}`;
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
	const { tex, w } = lettering( [ s.text ], { h: s.h * 1.5, ink: s.ink, font: s.font, weight: s.weight, spacing: s.spacing, pad: 0.1 } );
	const m = flat( tex, w, s.h * 1.5, { transparent: true, depthWrite: false } );
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
	const AW = 2048;
	let x = 0, y = 0, rowH = 0;
	const cells = plates.map( p => {

		const [ , , cw, ch ] = SIZE[ p.kind ];
		if ( x + cw > AW ) {

			x = 0;
			y += rowH + 2;
			rowH = 0;

		}

		const cell = { x, y, w: cw, h: ch };
		x += cw + 2;
		rowH = Math.max( rowH, ch );
		return cell;

	} );
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
function addWalls( scene, walls ) {

	const kit = new Kit(), mats = new Map();
	const mat = c => mats.get( c ) || mats.set( c, plain( c, { roughness: 0.95 } ) ).get( c );
	const coping = plain( 0x8d4a35, { roughness: 0.8 } );
	for ( const w of walls ) {

		const len = Math.hypot( w.x1 - w.x0, w.z1 - w.z0 ), rot = Math.atan2( w.x1 - w.x0, w.z1 - w.z0 );
		const mx = ( w.x0 + w.x1 ) / 2, mz = ( w.z0 + w.z1 ) / 2;
		const place = geo => geo.rotateY( rot ).translate( mx, w.y, mz );
		if ( w.kind === 'wall' ) {

			kit.add( mat( w.colour ), place( box( 0.4, w.h + 0.6, len + 0.02, 0, - 0.6, 0 ) ) );
			kit.add( coping, place( box( 0.5, 0.08, len + 0.04, 0, w.h, 0 ) ) );

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

const ADD = { board: addBoard, letters: addLetters, badge: addBadge, lantern: addLantern, flags: addFlags, portal: addPortal, canopy: addCanopy, clock: addClock };

export function addDress( scene, places ) {

	for ( const s of places.dress || [] ) ADD[ s.kind ]?.( scene, s );
	addPlates( scene, places.plates || [] );
	addWalls( scene, places.walls || [] );

}
