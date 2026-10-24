// Tram stops (from tools/places.mjs): the raised platform itself comes with the pavements (tools/kerbs.mjs); this
// adds what stands on it, after Prague's stops: a glass shelter with a dark steel frame, a bench and a backlit
// advert panel; the stop pole (označník) with the tram pictogram, the stop name and the timetable case; an LED
// departure board; white tactile strips along the platform edges.

import * as THREE from 'three/webgpu';
import { Kit, plain, glow, box, cyl, onFront, textTexture, board } from './kit.js';

const S = {
	frame: plain( 0x3a3f44, { metalness: 0.5, roughness: 0.45 } ),
	glass: new THREE.MeshStandardNodeMaterial( { color: 0xcfe0e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false } ),
	roof: plain( 0x4a5056, { roughness: 0.5 } ),
	pole: plain( 0x8a9096, { metalness: 0.6, roughness: 0.4 } ),
	strip: plain( 0xe8e6df, { roughness: 0.8 } ),
	bench: plain( 0x6d7378, { metalness: 0.5, roughness: 0.4 } ),
	advert: glow( 0xf3efe2, 0.9 ),
	white: plain( 0xf4f4f0, { roughness: 0.6 } ),
	led: plain( 0x121212, { roughness: 0.4 } )
};

// The tram pictogram on the stop pole: a white plate, red rim, black tram.
function pictogram() {

	const c = document.createElement( 'canvas' );
	c.width = c.height = 256;
	const g = c.getContext( '2d' );
	g.fillStyle = '#ffffff';
	g.fillRect( 0, 0, 256, 256 );
	g.strokeStyle = '#d0202a';
	g.lineWidth = 18;
	g.strokeRect( 9, 9, 238, 238 );
	g.fillStyle = '#111111';
	// Pantograph, body with windows, wheels.
	g.fillRect( 118, 40, 20, 26 );
	g.fillRect( 96, 40, 64, 8 );
	g.beginPath();
	g.roundRect( 58, 66, 140, 120, 14 );
	g.fill();
	g.fillStyle = '#ffffff';
	for ( const x of [ 72, 112, 152 ] ) g.fillRect( x, 82, 32, 40 );
	g.fillStyle = '#111111';
	for ( const x of [ 82, 174 ] ) {

		g.beginPath();
		g.arc( x, 196, 12, 0, Math.PI * 2 );
		g.fill();

	}

	g.fillRect( 40, 212, 176, 8 );
	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	return t;

}

let picto = null;

function addStop( scene, st ) {

	const kit = new Kit();
	// Frame on the platform: x along it, z towards the tracks.
	const g = onFront( st.x, st.y, st.z, [ st.nx, st.nz ] );
	const L = st.len / 2, W = st.width / 2;

	// Tactile strips along the edges of an island.
	if ( st.island ) for ( const s of [ - 1, 1 ] ) kit.add( S.strip, box( st.len - 1.2, 0.012, 0.32, 0, 0.0, s * ( W - 0.35 ) ) );

	// Shelter: back to the far side (an island's middle, or the pavement's house side), open towards the tracks.
	if ( st.shelter && st.len > 6 ) {

		const SL = Math.min( 6.5, st.len * 0.4 ) / 2, D = 1.45, Hs = 2.45;
		const zc = st.island ? 0 : - 1.2;
		const zb = zc - D / 2; // back wall line
		for ( const x of [ - SL, SL ] ) for ( const z of [ zb, zb + D ] ) kit.add( S.frame, box( 0.08, Hs, 0.08, x, 0, z ) );
		kit.add( S.frame, box( 0.08, Hs, 0.08, 0, 0, zb ) );
		kit.add( S.roof, box( SL * 2 + 0.5, 0.12, D + 0.5, 0, Hs, zb + D / 2 + 0.05 ) );
		kit.add( S.glass, box( SL * 2, Hs - 0.25, 0.02, 0, 0.15, zb ) );
		kit.add( S.glass, box( 0.02, Hs - 0.25, D * 0.7, SL, 0.15, zb + D * 0.35 ) );
		// Advert lightbox at one end, bench along the back.
		kit.add( S.frame, box( 0.14, 1.9, 1.3, - SL, 0.2, zb + D * 0.45 ) );
		kit.add( S.advert, box( 0.16, 1.7, 1.15, - SL, 0.3, zb + D * 0.45 ) );
		kit.add( S.bench, box( SL * 1.2, 0.05, 0.42, SL * 0.2, 0.45, zb + 0.3 ), box( SL * 1.2, 0.4, 0.04, SL * 0.2, 0.5, zb + 0.08 ) );
		for ( const x of [ - SL * 0.35, SL * 0.75 ] ) kit.add( S.bench, box( 0.05, 0.45, 0.4, x, 0, zb + 0.3 ) );

	} else if ( st.bench ) {

		kit.add( S.bench, box( 1.8, 0.05, 0.42, 0, 0.45, - W + 0.6 ), box( 1.8, 0.4, 0.04, 0, 0.5, - W + 0.4 ) );
		for ( const x of [ - 0.75, 0.75 ] ) kit.add( S.bench, box( 0.05, 0.45, 0.4, x, 0, - W + 0.6 ) );

	}

	// Stop pole at the front end, by the tracks: pictogram, name plate, timetable case.
	const px = L - 1.6, pz = Math.min( W - 0.5, 1.0 );
	kit.add( S.pole, cyl( 0.04, 0.04, 3.1, px, 0, pz, 10 ) );
	kit.add( S.white, box( 0.5, 0.75, 0.06, px, 1.05, pz + 0.05 ) );
	kit.add( S.frame, box( 0.54, 0.79, 0.04, px, 1.03, pz + 0.01 ) );
	if ( st.bin ) kit.add( S.frame, cyl( 0.2, 0.18, 0.75, px - 1.2, 0, pz - 0.2, 12 ) );
	picto ||= pictogram();
	const sign = new THREE.Mesh( new THREE.PlaneGeometry( 0.5, 0.5 ), new THREE.MeshStandardNodeMaterial( { map: picto, roughness: 0.5, side: THREE.DoubleSide } ) );
	sign.position.set( px, 2.75, pz );
	g.add( sign );
	if ( st.name ) {

		const plate = board( textTexture( [ [ st.name, 92 ] ], { w: 1024, h: 160, bg: '#ffffff', ink: '#111111', font: 'Arial, Helvetica, sans-serif', weight: '700' } ), 1.1, 0.17, { material: { side: THREE.DoubleSide } } );
		plate.position.set( px, 2.36, pz );
		g.add( plate );

	}

	// Departure board on its own post near the other end.
	if ( st.board ) {

		const bx = - L + 2.4;
		kit.add( S.pole, cyl( 0.05, 0.05, 2.4, bx, 0, 0, 10 ) );
		kit.add( S.led, box( 1.3, 0.55, 0.12, bx, 2.35, 0 ) );
		const lines = [ [ '9  Sídliště Spořilov     2', 46, 46 ], [ '22  Bílá Hora           4', 46, 110 ], [ '18  Vozovna Pankrác      7', 46, 174 ] ];
		const led = textTexture( lines, { w: 512, h: 220, bg: '#0b0b0b', ink: '#ffb52e', font: 'Courier New, monospace', weight: '700' } );
		for ( const s of [ - 1, 1 ] ) {

			const face = board( led, 1.2, 0.48, { material: { emissive: 0xffffff, emissiveMap: led, emissiveIntensity: 0.9 } } );
			face.position.set( bx, 2.62, s * 0.065 );
			if ( s < 0 ) face.rotation.y = Math.PI;
			g.add( face );

		}

	}

	kit.build( g );
	scene.add( g );

}

export function addStops( scene, stops = [] ) {

	for ( const st of stops ) addStop( scene, st );

}
