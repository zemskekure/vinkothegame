// Signature places, positioned at build time by tools/places.mjs:
//   Rotunda sv. Kříže Menšího · Hostinec U Rotundy · Standard Café · Champagneria (src/venues.js) · the gate of
//   Náprstkovo muzeum · the chimney courtyard in Náprstkova · the National Theatre node (src/theatre.js).
// Stylised rather than realistic: simple solids, flat colours and a few procedural patterns (stone, tiles, wood).

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit, M, plain, glow, box, cyl, ball, onFront, textTexture, board, rubbleStone, roofTiles, ashlar, planks, tiles, roomWall } from './kit.js';
import { addOpenings } from './openings.js';
import { addStops } from './stops.js';
import { addBridges, addLegie } from './bridges.js';
import { addLandmarks } from './landmarks.js';
import { addDress, SEATS as dressSeats } from './dress.js';
import { addFlights } from './flights.js';
import { addVenues } from './venues.js';
import { addTheatre } from './theatre.js';

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
		ring.push( [ dx * ( t + 0.7 ), dz * ( t + 0.7 ), a ] );

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
		champagne: { lines: [ [ s.text, 140 ] ], bg: '#0f0f10', ink: '#d8b45e', border: '#d8b45e', font: 'Didot, "Bodoni 72", Georgia, serif', weight: '400', spacing: 16, h: 0.52 },
		// Lettering straight on the wall (Kavárna Slavia, Mánes…), an institution's plaque, a neon sign.
		letters: { lines: [ [ s.text, 150 ] ], ink: '#3a3327', font: 'Georgia, "Times New Roman", serif', spacing: 24, h: 0.55, bare: true },
		plaque: { lines: [ [ s.text, 120 ] ], bg: '#1f2d4d', ink: '#ffffff', font: '"Helvetica Neue", Arial, sans-serif', weight: '600', spacing: 6, h: 0.42 },
		neon: { lines: [ [ s.text, 150 ] ], ink: '#ff5fb0', font: '"Helvetica Neue", Arial, sans-serif', weight: '700', spacing: 10, h: 0.6, bare: true, glow: true }
	};
	const st = styles[ s.style ];
	const w = Math.max( 1.8, s.text.length * st.h * 0.44 );
	const tex = textTexture( st.lines, { w: 1024, h: Math.round( 1024 * st.h / w ), bg: st.bg, ink: st.ink, border: st.border, font: st.font, weight: st.weight || '700', spacing: st.spacing || 0 } );
	const b = board( tex, w, st.h, st.bare ? { transparent: true, material: { depthWrite: false, ...( st.glow ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6 } : {} ) } } : {} );
	b.position.z = st.bare ? 0.04 : 0.09;
	g.add( b );
	if ( st.bare ) return;
	new Kit().add( s.style === 'champagne' ? M.gold : M.woodDark, box( w + 0.12, st.h + 0.12, 0.07, 0, - ( st.h + 0.12 ) / 2, 0.03 ) ).build( g );
	if ( s.style === 'champagne' || s.style === 'cafe' ) {

		// Little lamps over the board.
		const kit = new Kit();
		for ( const x of [ - w / 3, 0, w / 3 ] ) kit.add( M.iron, box( 0.02, 0.02, 0.35, x, st.h / 2 + 0.12, 0.2 ) ).add( M.lampShade, new THREE.ConeGeometry( 0.09, 0.12, 10, 1, true ).translate( x, st.h / 2 + 0.06, 0.37 ) );
		kit.build( g, { shadows: false } );

	}

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

export function addPlaces( scene, places, furniture = {}, waterLevel = 0 ) {

	if ( ! places ) return { seats: [] };
	const seats = [ ...( places.seats || [] ) ];
	if ( places.rotunda ) addRotunda( scene, places.rotunda );
	// The venues' own signs (modelled from photos); generic lettering and plaques only with ?signs.
	const generic = new Set( [ 'letters', 'plaque', 'neon' ] );
	const showGeneric = new URLSearchParams( location.search ).has( 'signs' );
	for ( const s of places.signs ) if ( showGeneric || ! generic.has( s.style ) ) addSign( scene, s );
	seats.push( ...addVenues( scene, places, furniture ) );
	if ( places.lights?.length ) addFestoons( scene, places.lights );
	if ( places.gate ) addMuseumGate( scene, places.gate );
	addOpenings( scene, places.openings );
	addStops( scene, places.stops );
	addBridges( scene, places.bridges, places.piers, waterLevel );
	addLegie( scene, places.legie, waterLevel );
	addLandmarks( scene, places, waterLevel );
	addDress( scene, places );
	seats.push( ...dressSeats );
	addFlights( scene, places.flights, places.tunnels );
	if ( places.theatre ) addTheatre( scene, places.theatre );
	return { seats };

}
