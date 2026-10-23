// Prague Old Town facade: stuccoed plaster in the house's colour, rusticated ground floor with shops or a door,
// a string course above it, upper floors of white double casement windows in stone surrounds with sills and
// window caps, quoins at the corners and a main cornice under the eaves. Courtyard walls are plainer; party walls
// are blank. Layout and filtering follow Slop New York's pre-war facade material (see common.js).
//
// Per-vertex attributes (see tools/build-scene.mjs): wallU (m from the wall's left corner), wallW (wall width),
// wallBase / wallTop (ground and eave height), floorH, seed, kind (0 street, 2 courtyard, 3 party), plaster (rgb).

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, color, uniform, attribute, positionWorld, normalWorldGeometry, cameraPosition,
	floor, fract, min, max, clamp, mix, step, smoothstep, dot, normalize, pow, abs, length, fwidth
} from 'three/tsl';
import { hash2D, noise2D, bumpNormal, lineAA, gridLine, filteredPulse, evaluateApartmentInterior } from './common.js';

export const sceneUniforms = {
	interiorGlow: uniform( 0.12 ),
	skyHorizon: uniform( new THREE.Color( 0xc9d6e2 ) ),
	sunColor: uniform( new THREE.Color( 0xffe2bd ) )
};

export function createFacadeMaterial() {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.85, metalness: 0 } );

	const u = attribute( 'wallU', 'float' );
	const W = attribute( 'wallW', 'float' );
	const base = attribute( 'wallBase', 'float' );
	const top = attribute( 'wallTop', 'float' );
	const fH = attribute( 'floorH', 'float' );
	const seed = attribute( 'seed', 'float' );
	const kind = attribute( 'kind', 'float' );
	const plaster = attribute( 'plaster', 'vec3' );

	const n = normalWorldGeometry;
	const tangent = vec3( n.z, 0, n.x.negate() );

	const isStreet = step( kind, 0.5 );
	const isParty = step( 2.5, kind );
	const isRear = float( 1 ).sub( isStreet ).sub( isParty ).max( 0 );

	// --- facade grid: whole bays between corner piers
	const h = positionWorld.y.sub( base );
	const fromTop = top.sub( positionWorld.y );
	const gridV = h.div( fH );
	const level = floor( gridV );
	const cellV = fract( gridV );

	const pier = min( float( 0.95 ), W.mul( 0.16 ) );
	const inner = W.sub( pier.mul( 2 ) );
	const bayTarget = float( 2.7 ).add( fract( seed.mul( 13.1 ) ).mul( 0.7 ) );
	const bays = max( floor( inner.div( bayTarget ).add( 0.5 ) ), 1 );
	const bayW = inner.div( bays );
	const gridU = u.sub( pier ).div( bayW );
	const bayIdx = floor( gridU );
	const cellU = fract( gridU );
	const cellId = vec2( bayIdx, level );
	const fw = vec2( fwidth( gridU ), fwidth( gridV ) );

	const inPier = float( 1 ).sub( step( pier, u ).mul( step( u, W.sub( pier ) ) ) );
	const tooNarrow = step( W, 2.2 );
	const ground = float( 1 ).sub( step( 1, gridV ) );
	const upper = float( 1 ).sub( ground );
	const mainCornice = float( 1 ).sub( smoothstep( 0.55, 0.75, fromTop ) );
	const underCornice = step( fromTop, 1.1 ); // no windows cut into the main cornice
	const solid = max( max( max( inPier, tooNarrow ), isParty ), underCornice );

	// Ground floor of street fronts: shops in most houses, one door bay per wall.
	const hasShops = step( 0.3, fract( seed.mul( 7.7 ) ) ).mul( isStreet );
	const doorBay = min( floor( fract( seed.mul( 3.3 ) ).mul( bays ) ), bays.sub( 1 ) );
	const door = ground.mul( isStreet ).mul( step( abs( bayIdx.sub( doorBay ) ), 0.5 ) ).mul( float( 1 ).sub( solid ) );
	const shop = ground.mul( hasShops ).mul( float( 1 ).sub( door ) ).mul( float( 1 ).sub( solid ) );

	// Window opening in the cell.
	const wx0 = mix( float( 0.3 ), float( 0.15 ), shop );
	const wy0 = mix( float( 0.25 ), float( 0.1 ), shop );
	const wy1 = mix( float( 0.8 ), float( 0.74 ), shop );
	const open = float( 1 ).sub( solid ).mul( float( 1 ).sub( door ) ).mul( max( upper, max( shop, isRear.mul( ground ) ) ) );
	const inX = filteredPulse( cellU, wx0, float( 1 ).sub( wx0 ), fw.x ).mul( open );
	const inY = filteredPulse( cellV, wy0, wy1, fw.y );
	const opening = inX.mul( inY );
	const winUV = clamp( vec2(
		cellU.sub( wx0 ).div( float( 1 ).sub( wx0.mul( 2 ) ) ),
		cellV.sub( wy0 ).div( wy1.sub( wy0 ) )
	), vec2( 0 ), vec2( 1 ) );

	// Stone surround, cap and sill (street fronts, upper floors).
	const dressed = isStreet.mul( upper ).mul( float( 1 ).sub( solid ) );
	const surround = filteredPulse( cellU, 0.25, 0.75, fw.x ).mul( filteredPulse( cellV, 0.21, 0.85, fw.y ) ).mul( dressed ).sub( opening ).max( 0 );
	const cap = filteredPulse( cellU, 0.22, 0.78, fw.x ).mul( filteredPulse( cellV, 0.85, 0.92, fw.y ) ).mul( dressed );
	const sill = filteredPulse( cellU, 0.26, 0.74, fw.x ).mul( filteredPulse( cellV, 0.205, 0.25, fw.y ) ).mul( upper ).mul( float( 1 ).sub( solid ) );

	// String course above the ground floor and the rusticated ground floor.
	const stringCourse = isStreet.mul( filteredPulse( gridV, 0.9, 1.0, fw.y ) ).mul( step( gridV, 1.5 ) );
	const rusticated = isStreet.mul( ground ).mul( float( 1 ).sub( stringCourse ) );
	const rustGroove = gridLine( h, 0.45, 0.018 ).mul( rusticated ).mul( float( 1 ).sub( opening ) );
	const plinth = float( 1 ).sub( step( 0.55, h ) ).mul( float( 1 ).sub( isParty ) );
	const quoin = inPier.mul( isStreet ).mul( upper ).mul( float( 1 ).sub( mainCornice ) );
	const quoinGroove = gridLine( h, 0.6, 0.02 ).mul( quoin );

	// --- colours
	const pal = fract( seed.mul( 5.3 ) );
	const trim = mix( mix( plaster, vec3( 0.93, 0.91, 0.86 ), 0.45 ), plaster.mul( 0.8 ), step( 0.72, pal ) );
	const wallPlaster = mix( plaster, mix( plaster, vec3( 0.62, 0.6, 0.57 ), 0.45 ), isRear.add( isParty.mul( 1.3 ) ).min( 1 ) );

	const camDist = length( positionWorld.sub( cameraPosition ) );
	const grain = noise2D( vec2( u.mul( 1.3 ), h.mul( 1.3 ) ).add( seed.mul( 91 ) ) ).sub( 0.5 ).mul( 0.07 );
	const patches = smoothstep( 0.55, 0.8, noise2D( vec2( u.mul( 0.25 ), h.mul( 0.3 ) ).add( seed.mul( 37 ) ) ) ).mul( 0.08 );
	const soot = smoothstep( 2.4, 0.0, h ).mul( 0.16 );
	const streak = smoothstep( 0.45, 0.8, noise2D( vec2( u.mul( 2.1 ), h.mul( 0.08 ) ) ) ).mul( 0.06 ).mul( upper );

	const stucco = wallPlaster.mul( float( 1 ).add( grain ).sub( patches ).sub( soot ).sub( streak ) );
	const trimMix = max( max( max( stringCourse, mainCornice.mul( float( 1 ).sub( isParty ) ) ), max( surround, cap ) ), quoin.mul( 0.8 ) );
	let wall = mix( stucco, trim.mul( float( 1 ).sub( soot.mul( 0.6 ) ) ), trimMix );
	wall = mix( wall, wall.mul( 0.88 ), rusticated.mul( 0.6 ) );
	wall = mix( wall, wall.mul( 0.55 ), max( rustGroove, quoinGroove ) );
	wall = mix( wall, vec3( 0.42, 0.41, 0.39 ), plinth );
	wall = mix( wall, trim.mul( 1.05 ).min( 1 ), sill );

	// Windows: white casement frames (centre mullion, transom, glazing bars), glass over the room interior.
	const frameBorder = float( 1 ).sub( filteredPulse( winUV.x, 0.06, 0.94, fwidth( winUV.x ) ).mul( filteredPulse( winUV.y, 0.05, 0.95, fwidth( winUV.y ) ) ) );
	const casement = max( max( lineAA( winUV.x.sub( 0.5 ), 0.025 ), lineAA( winUV.y.sub( 0.68 ), 0.022 ) ),
		max( lineAA( winUV.y.sub( 0.34 ), 0.012 ), lineAA( fract( winUV.x.mul( 2 ) ).sub( 0.5 ), 0.012 ).mul( step( winUV.y, 0.68 ) ) ) ).mul( upper );
	const shopBars = max( lineAA( winUV.y.sub( 0.8 ), 0.015 ), lineAA( fract( winUV.x.mul( 2 ) ).sub( 0.5 ), 0.012 ) ).mul( shop );
	const frame = max( max( frameBorder, casement ), shopBars ).min( 1 );
	const frameColor = mix( vec3( 0.93, 0.92, 0.88 ), vec3( 0.2, 0.17, 0.14 ), shop.max( step( 0.82, fract( seed.mul( 2.9 ) ) ) ) );

	const room = evaluateApartmentInterior( gridU, h, winUV, cellId, bayW, fH, seed.mul( 97 ), float( 0.75 ), float( 0.3 ), fw, tangent, n );
	const shopLit = step( 0.2, hash2D( cellId.add( vec2( seed.mul( 31 ), 4.1 ) ) ) );
	const shopInterior = mix( color( 0x2a2622 ), color( 0xd8b98a ), smoothstep( 0.0, 0.9, winUV.y ).mul( 0.5 ).add( 0.2 ).mul( shopLit ) );

	const viewDir = normalize( cameraPosition.sub( positionWorld ) );
	const fresnel = pow( clamp( float( 1 ).sub( abs( dot( viewDir, n ) ) ), 0, 1 ), 2.0 );
	const recess = float( 1 ).sub( smoothstep( 0.86, 1.0, winUV.y ).mul( 0.45 ) ).sub( float( 1 ).sub( smoothstep( 0.0, 0.1, winUV.x ) ).mul( 0.3 ) );
	const behindGlass = mix( room.xyz.mul( 0.8 ), shopInterior, shop );
	const glass = mix( mix( behindGlass, color( 0x1b2630 ), 0.42 ), sceneUniforms.skyHorizon, fresnel.mul( 0.5 ).add( 0.06 ) ).mul( recess );

	// Door: dark panelled wooden door with a fanlight, in a stone surround.
	const doorWay = filteredPulse( cellU, 0.3, 0.7, fw.x ).mul( filteredPulse( cellV, 0.0, 0.82, fw.y ) ).mul( door );
	const doorFrame = filteredPulse( cellU, 0.24, 0.76, fw.x ).mul( filteredPulse( cellV, 0.0, 0.88, fw.y ) ).mul( door ).sub( doorWay ).max( 0 );
	const doorUV = vec2( cellU.sub( 0.3 ).div( 0.4 ), cellV.div( 0.82 ) );
	const fanlight = step( 0.8, doorUV.y );
	const doorPaint = mix( color( 0x3b2618 ), color( 0x22301f ), step( 0.6, fract( seed.mul( 17.3 ) ) ) );
	const doorPanels = max( gridLine( doorUV.x, 0.5, 0.025 ), gridLine( doorUV.y, 0.27, 0.02 ) );
	const doorColor = mix( doorPaint.mul( float( 1 ).sub( doorPanels.mul( 0.45 ) ) ), glass, fanlight );

	let col = mix( wall, frameColor, opening.mul( frame ) );
	col = mix( col, glass, opening.mul( float( 1 ).sub( frame ) ) );
	col = mix( col, trim, doorFrame );
	col = mix( col, doorColor, doorWay );
	mat.colorNode = col;

	const glassMask = opening.mul( float( 1 ).sub( frame ) ).add( doorWay.mul( fanlight ) );
	mat.roughnessNode = mix( float( 0.88 ).add( grain ), float( 0.1 ), glassMask );

	// Street-canyon sky occlusion: darker low down in narrow lanes.
	mat.aoNode = mix( float( 0.55 ), float( 1.0 ), smoothstep( 0.0, 16.0, h ) );

	mat.emissiveNode = room.xyz.mul( room.w ).mul( opening ).mul( float( 1 ).sub( frame ) ).mul( upper )
		.add( color( 0xffd29a ).mul( shop ).mul( shopLit ).mul( opening ).mul( float( 1 ).sub( frame ) ).mul( 0.6 ) )
		.mul( sceneUniforms.interiorGlow );

	// Relief: cornices, string course, caps and sills stand out; openings and grooves are recessed.
	mat.normalNode = Fn( () => {

		const fade = float( 1 ).sub( smoothstep( 25.0, 140.0, camDist ) );
		const relief = mainCornice.mul( smoothstep( 0.75, 0.2, fromTop ) ).mul( 0.06 )
			.add( stringCourse.mul( 0.035 ) )
			.add( cap.mul( 0.04 ) ).add( sill.mul( 0.03 ) ).add( surround.mul( 0.015 ) ).add( quoin.mul( 0.015 ) )
			.sub( opening.mul( float( 1 ).sub( frame ) ).mul( 0.03 ) )
			.sub( doorWay.mul( 0.03 ) )
			.sub( max( rustGroove, quoinGroove ).mul( 0.01 ) );
		return bumpNormal( relief.mul( fade ) );

	} )();

	return mat;

}

// Muted Prague facade palette: ochres, creams, salmon pinks, pale greens and greys.
export const PLASTER = [
	0xd9b56a, 0xe3cf9c, 0xd49a55, 0xc98a6c, 0xdcd3c2, 0xd4a28c, 0xbf8263,
	0xaebd98, 0xe6c47a, 0xc4b8a2, 0xd8ac97, 0xb89d72, 0xdcbd92, 0x9fb1b6,
	0xc99780, 0xdcc27e, 0xa9b78f, 0xcda97a, 0xb9c4a8, 0xe0b8a4
];
