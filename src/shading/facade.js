// Prague Old Town facade: stuccoed plaster in the house's colour, rusticated ground floor with shops or a door,
// a string course above it, upper floors of white double casement windows in stone surrounds with sills and
// window caps, quoins at the corners and a main cornice under the eaves. Courtyard walls are plainer; party walls
// are blank. Layout and filtering follow Slop New York's pre-war facade material (see common.js).
//
// Per-vertex attributes (see tools/build-scene.mjs, packed in src/main.js): u (m from the wall's left corner), wall
// width, base / top (ground and eave height), floor height, seed, kind (0 street, 2 courtyard, 3 party), measured
// bay / window / shop, landmark style, plaster (rgb).

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, color, uniform, attribute, positionWorld, normalWorldGeometry, cameraPosition,
	floor, fract, mod, min, max, clamp, mix, step, smoothstep, dot, normalize, pow, abs, length, fwidth, sin, cos
} from 'three/tsl';
import { hash2D, noise2D, bumpNormal, lineAA, gridLine, filteredPulse, evaluateApartmentInterior } from './common.js';

export const sceneUniforms = {
	interiorGlow: uniform( 0.12 ),
	skyHorizon: uniform( new THREE.Color( 0xc9d6e2 ) ),
	sunColor: uniform( new THREE.Color( 0xffe2bd ) )
};

export function createFacadeMaterial() {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.85, metalness: 0 } );

	// Packed wall attributes (see src/main.js): A = u, width, base, top; B = floor height, seed, kind, (red);
	// C = measured bay, measured window width, measured shop flag, landmark style.
	const wallA = attribute( 'wallA', 'vec4' ), wallB = attribute( 'wallB', 'vec4' ), wallC = attribute( 'wallC', 'vec4' );
	const u = wallA.x;
	const W = wallA.y;
	const base = wallA.z;
	const top = wallA.w;
	const fH = wallB.x;
	const seed = wallB.y;
	const kind = wallB.z;
	const realBay = wallC.x; // measured from street photos, 0 = unknown
	const realWindow = wallC.y;
	const realShop = wallC.z; // 1 / 0, -1 = unknown
	const plaster = attribute( 'plaster', 'vec3' );
	// Hand-modelled landmarks (tools/build-scene.mjs LANDMARKS): 1 Národní divadlo, 2 Máj, 3 Betlémská kaple.
	const style = wallC.w;
	// House description (data/houses.json): trim colour (r < 0: derive it), ground floor kind (1 gate, 2 blank,
	// 3 shops, 4 windows), window bars, rustication (−1 default, 0 none, 1 banded, 2 ornate), graffiti.
	const trimColour = attribute( 'trimColour', 'vec3' );
	const house = attribute( 'house', 'vec4' );
	const isGate = step( abs( house.x.sub( 1 ) ), 0.5 );
	const isBlank = step( abs( house.x.sub( 2 ) ), 0.5 );
	const groundWindows = step( abs( house.x.sub( 4 ) ), 0.5 );
	const grilles = house.y;
	const rusticKind = house.z;
	const ornate = step( abs( rusticKind.sub( 2 ) ), 0.5 );
	const graffiti = house.w;
	const sTheatre = step( abs( style.sub( 1 ) ), 0.5 );
	const sMaj = step( abs( style.sub( 2 ) ), 0.5 );
	const sChapel = step( abs( style.sub( 3 ) ), 0.5 );
	const plain = float( 1 ).sub( sMaj ).sub( sChapel ); // styles with classical dressings

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
	const bayTarget = mix( mix( mix( mix( float( 2.7 ).add( fract( seed.mul( 13.1 ) ).mul( 0.7 ) ), realBay, step( 0.5, realBay ) ),
		float( 3.7 ), sTheatre ), float( 1.5 ), sMaj ), float( 4.6 ), sChapel );
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
	const underCornice = step( fromTop, mix( float( 1.1 ), float( 1.8 ), sTheatre ) ); // no windows cut into the cornice / attic
	// Máj: blank panel walls above the shops (its glazing is drawn separately); the chapel only has its gothic windows.
	const solid = max( max( max( max( inPier, tooNarrow ), isParty ), underCornice ), max( sMaj.mul( step( 1, gridV ) ), sChapel ) );

	// Ground floor of street fronts: shops in most houses, one door bay per wall.
	const hasShops = mix( step( 0.3, fract( seed.mul( 7.7 ) ) ), step( 0.5, realShop ), step( - 0.5, realShop ) ).mul( isStreet );
	const doorBay = min( floor( fract( seed.mul( 3.3 ) ).mul( bays ) ), bays.sub( 1 ) );
	const door = ground.mul( isStreet ).mul( step( abs( bayIdx.sub( doorBay ) ), 0.5 ) ).mul( float( 1 ).sub( solid ) ).mul( float( 1 ).sub( isBlank ) );
	const shop = ground.mul( hasShops ).mul( float( 1 ).sub( door ) ).mul( float( 1 ).sub( solid ) );

	// Window opening in the cell.
	const upperX0 = mix( float( 0.3 ), float( 1 ).sub( realWindow ).mul( 0.5 ).clamp( 0.18, 0.38 ), step( 0.1, realWindow ) );
	const wx0 = mix( upperX0, float( 0.15 ), shop );
	const wy0 = mix( float( 0.25 ), float( 0.1 ), shop );
	const wy1 = mix( float( 0.8 ), float( 0.74 ), shop );
	const open = float( 1 ).sub( solid ).mul( float( 1 ).sub( door ) ).mul( max( upper, max( shop, max( isRear, groundWindows.mul( isStreet ) ).mul( ground ) ) ) );
	const inX = filteredPulse( cellU, wx0, float( 1 ).sub( wx0 ), fw.x ).mul( open );
	const inY = filteredPulse( cellV, wy0, wy1, fw.y );
	const opening = inX.mul( inY );
	const winUVgrid = clamp( vec2(
		cellU.sub( wx0 ).div( float( 1 ).sub( wx0.mul( 2 ) ) ),
		cellV.sub( wy0 ).div( wy1.sub( wy0 ) )
	), vec2( 0 ), vec2( 1 ) );

	// Betlémská kaple: tall pointed gothic windows, one per bay, 2.6–9.2 m above the ground.
	const gothicY0 = 2.6, gothicY1 = 9.2;
	const chapelUV = clamp( vec2( cellU.sub( 0.36 ).div( 0.28 ), h.sub( gothicY0 ).div( gothicY1 - gothicY0 ) ), vec2( 0 ), vec2( 1 ) );
	const chapelOpen = sChapel.mul( float( 1 ).sub( isParty ) ).mul( float( 1 ).sub( inPier ) ).mul( float( 1 ).sub( tooNarrow ) )
		.mul( filteredPulse( cellU, 0.36, 0.64, fw.x ) ).mul( step( gothicY0, h ) ).mul( step( h, gothicY1 ) ).mul( step( gothicY1 + 0.8, fromTop.add( h ) ) );
	const winUV = mix( winUVgrid, chapelUV, sChapel );

	// Arched window heads: round arches on the theatre's ground floor and piano nobile, pointed ones on the chapel.
	const ax = winUV.x.sub( 0.5 ).mul( 2 );
	const roundArch = step( length( vec2( ax, winUV.y.sub( 0.78 ).div( 0.22 ) ) ), 1 ).max( step( winUV.y, 0.78 ) );
	const pointedArch = step( abs( ax ).add( winUV.y.sub( 0.72 ).div( 0.28 ) ), 1.0 ).max( step( winUV.y, 0.72 ) );
	const arched = sTheatre.mul( step( level, 0.5 ).add( step( abs( level.sub( 2 ) ), 0.5 ) ).min( 1 ) );
	const archMask = mix( mix( float( 1 ), roundArch, arched ), pointedArch, sChapel );
	const openingAll = opening.add( chapelOpen ).min( 1 ).mul( archMask );

	// Stone surround, cap and sill (street fronts, upper floors).
	const dressed = isStreet.mul( upper ).mul( float( 1 ).sub( solid ) ).mul( plain );
	const surround = filteredPulse( cellU, 0.25, 0.75, fw.x ).mul( filteredPulse( cellV, 0.21, 0.85, fw.y ) ).mul( dressed ).sub( openingAll ).max( 0 );
	const cap = filteredPulse( cellU, 0.22, 0.78, fw.x ).mul( filteredPulse( cellV, 0.85, 0.92, fw.y ) ).mul( dressed );
	const sill = filteredPulse( cellU, 0.26, 0.74, fw.x ).mul( filteredPulse( cellV, 0.205, 0.25, fw.y ) ).mul( upper ).mul( float( 1 ).sub( solid ) ).mul( plain );
	// Chapel: dressed sandstone frame around each gothic window.
	const chapelFrame = sChapel.mul( float( 1 ).sub( isParty ) ).mul( float( 1 ).sub( inPier ) ).mul( filteredPulse( cellU, 0.33, 0.67, fw.x ) )
		.mul( step( gothicY0 - 0.2, h ) ).mul( step( h, gothicY1 + 0.3 ) ).mul( step( gothicY1 + 0.8, fromTop.add( h ) ) ).sub( openingAll ).max( 0 );

	// String course above the ground floor and the rusticated ground floor.
	const stringCourse = max( isStreet, sTheatre.mul( float( 1 ).sub( isParty ) ) ).mul( filteredPulse( gridV, 0.9, 1.0, fw.y ) ).mul( step( gridV, mix( float( 1.5 ), float( 2.5 ), sTheatre ) ) ).mul( plain );
	// Rusticated base: the ground floor of street fronts; the theatre's whole two-storey base, in ashlar blocks.
	// Described houses: rustication only when the description says so (banded or ornate).
	const rusticAllowed = mix( float( 1 ), step( 0.5, rusticKind ), step( - 0.5, rusticKind ) );
	const rusticated = max( isStreet.mul( ground ).mul( rusticAllowed ), sTheatre.mul( step( h, fH.mul( 2 ) ) ).mul( float( 1 ).sub( isParty ) ) ).mul( float( 1 ).sub( stringCourse ) ).mul( plain );
	const course = floor( h.div( 0.45 ) );
	const blockJoint = gridLine( u.add( mod( course, 2 ).mul( 0.6 ) ), 1.2, 0.016 ).mul( sTheatre );
	const rustGroove = max( gridLine( h, 0.45, 0.018 ), blockJoint ).mul( rusticated ).mul( float( 1 ).sub( openingAll ) );
	const plinth = float( 1 ).sub( step( 0.55, h ) ).mul( float( 1 ).sub( isParty ) );
	const quoin = inPier.mul( isStreet ).mul( upper ).mul( float( 1 ).sub( mainCornice ) ).mul( plain );

	// Theatre attic: a balustrade with balusters every 32 cm below the top cornice.
	const attic = sTheatre.mul( float( 1 ).sub( isParty ) ).mul( step( 0.45, fromTop ) ).mul( step( fromTop, 1.45 ) );
	const balusterGap = lineAA( fract( u.div( 0.32 ) ).sub( 0.5 ), 0.17 ).mul( step( 0.6, fromTop ) ).mul( step( fromTop, 1.25 ) ).mul( attic );

	// Máj: large beige façade panels; a recessed glass shopfront along the street; a yellow-framed glazed band at the top.
	const panelJoint = max( gridLine( u, 1.5, 0.012 ), gridLine( h, 1.25, 0.012 ) ).mul( sMaj );
	const majShopfront = sMaj.mul( isStreet ).mul( step( h, 4.4 ) ).mul( step( 0.25, h ) );
	const majBand = sMaj.mul( isStreet ).mul( step( 1.0, fromTop ) ).mul( step( fromTop, 3.8 ) );
	const majFrame = max( max( lineAA( fromTop.sub( 1.05 ), 0.08 ), lineAA( fromTop.sub( 3.75 ), 0.08 ) ), lineAA( fract( u.div( 3.0 ) ).sub( 0.5 ), 0.012 ) ).mul( majBand );
	const quoinGroove = gridLine( h, 0.6, 0.02 ).mul( quoin );

	// --- colours
	const pal = fract( seed.mul( 5.3 ) );
	const trim = mix( mix( mix( plaster, vec3( 0.93, 0.91, 0.86 ), 0.45 ), plaster.mul( 0.8 ), step( 0.72, pal ) ), trimColour, step( 0, trimColour.x ) );
	const wallPlaster = mix( plaster, mix( plaster, vec3( 0.62, 0.6, 0.57 ), 0.45 ), isRear.add( isParty.mul( 1.3 ) ).min( 1 ) );

	const camDist = length( positionWorld.sub( cameraPosition ) );
	const grain = noise2D( vec2( u.mul( 1.3 ), h.mul( 1.3 ) ).add( seed.mul( 91 ) ) ).sub( 0.5 ).mul( 0.07 );
	const patches = smoothstep( 0.55, 0.8, noise2D( vec2( u.mul( 0.25 ), h.mul( 0.3 ) ).add( seed.mul( 37 ) ) ) ).mul( 0.08 );
	const soot = smoothstep( 2.4, 0.0, h ).mul( 0.16 );
	const streak = smoothstep( 0.45, 0.8, noise2D( vec2( u.mul( 2.1 ), h.mul( 0.08 ) ) ) ).mul( 0.06 ).mul( upper );

	const stucco = wallPlaster.mul( float( 1 ).add( grain ).sub( patches ).sub( soot ).sub( streak ) );
	const trimMix = max( max( max( max( stringCourse, mainCornice.mul( float( 1 ).sub( isParty ) ).mul( plain ) ), max( surround, cap ) ), quoin.mul( 0.8 ) ), max( attic, chapelFrame ) );
	let wall = mix( stucco, trim.mul( float( 1 ).sub( soot.mul( 0.6 ) ) ), trimMix );
	wall = mix( wall, wall.mul( 0.88 ), rusticated.mul( 0.6 ) );
	wall = mix( wall, wall.mul( 0.55 ), max( rustGroove, quoinGroove ) );
	wall = mix( wall, trim.mul( 0.4 ), balusterGap );
	wall = mix( wall, wall.mul( 0.7 ), panelJoint );
	// Ornate neo-renaissance stucco: a scrolled frieze under every window row, panels between the windows and a
	// heavy grey stone base on the ground floor.
	const frieze = filteredPulse( cellV, 0.86, 0.99, fw.y ).mul( upper );
	const scroll = smoothstep( 0.2, 0.6, sin( u.mul( 9 ) ).mul( cos( cellV.mul( 60 ) ) ).abs() ).mul( frieze );
	const panel = filteredPulse( cellU, 0.05, 0.25, fw.x ).add( filteredPulse( cellU, 0.75, 0.95, fw.x ) ).mul( filteredPulse( cellV, 0.3, 0.75, fw.y ) ).mul( upper );
	const ornament = ornate.mul( float( 1 ).sub( isParty ) ).mul( max( frieze, panel ) );
	wall = mix( wall, mix( trim, trim.mul( 0.55 ), scroll ), ornament.mul( 0.9 ) );
	const stoneBase = ornate.mul( ground ).mul( float( 1 ).sub( isParty ) );
	wall = mix( wall, mix( color( 0x8f8a83 ), color( 0x7d7871 ), gridLine( h, 0.5, 0.02 ) ), stoneBase );

	// Graffiti tags on the lower wall.
	const tagCell = floor( u.div( 2.2 ) );
	// Tags are spray strokes: thin lines along a contour of the noise field, not filled blobs.
	const tagField = noise2D( vec2( u.mul( 2.4 ), h.mul( 3.0 ) ).add( tagCell.mul( 3.1 ) ) );
	const tag = lineAA( tagField.sub( 0.5 ), 0.025 )
		.mul( step( 0.3, h ) ).mul( step( h, 2.4 ) ).mul( step( 0.35, hash2D( vec2( tagCell, seed ) ) ) ).mul( graffiti );
	const tagPick = hash2D( vec2( tagCell, 7.3 ) );
	const tagColour = mix( mix( color( 0x2a5fb5 ), color( 0x1b1b1b ), step( 0.35, tagPick ) ), mix( color( 0xc03a2b ), color( 0xf0f0ea ), step( 0.85, tagPick ) ), step( 0.65, tagPick ) );
	wall = mix( wall, tagColour, tag );

	wall = mix( wall, vec3( 0.42, 0.41, 0.39 ), plinth );
	wall = mix( wall, trim.mul( 1.05 ).min( 1 ), sill );

	// Windows: white casement frames (centre mullion, transom, glazing bars), glass over the room interior.
	const frameBorder = float( 1 ).sub( filteredPulse( winUV.x, 0.06, 0.94, fwidth( winUV.x ) ).mul( filteredPulse( winUV.y, 0.05, 0.95, fwidth( winUV.y ) ) ) );
	const casement = max( max( lineAA( winUV.x.sub( 0.5 ), 0.025 ), lineAA( winUV.y.sub( 0.68 ), 0.022 ) ),
		max( lineAA( winUV.y.sub( 0.34 ), 0.012 ), lineAA( fract( winUV.x.mul( 2 ) ).sub( 0.5 ), 0.012 ).mul( step( winUV.y, 0.68 ) ) ) ).mul( upper );
	const shopBars = max( lineAA( winUV.y.sub( 0.8 ), 0.015 ), lineAA( fract( winUV.x.mul( 2 ) ).sub( 0.5 ), 0.012 ) ).mul( shop );
	// Chapel windows: leaded diamond panes.
	const leaded = max( lineAA( fract( winUV.x.mul( 4 ).add( winUV.y.mul( 7 ) ) ).sub( 0.5 ), 0.04 ), lineAA( fract( winUV.x.mul( 4 ).sub( winUV.y.mul( 7 ) ) ).sub( 0.5 ), 0.04 ) );
	const frame = mix( max( max( frameBorder, casement ), shopBars ).min( 1 ), max( frameBorder, leaded ), sChapel );
	const frameColor = mix( vec3( 0.93, 0.92, 0.88 ), vec3( 0.2, 0.17, 0.14 ), shop.max( step( 0.82, fract( seed.mul( 2.9 ) ) ) ).max( sTheatre ).max( sChapel ) );

	const room = evaluateApartmentInterior( gridU, h, winUV, cellId, bayW, fH, seed.mul( 97 ), float( 0.75 ), float( 0.3 ), fw, tangent, n );
	const shopLit = step( 0.2, hash2D( cellId.add( vec2( seed.mul( 31 ), 4.1 ) ) ) );
	const shopInterior = mix( color( 0x2a2622 ), color( 0xd8b98a ), smoothstep( 0.0, 0.9, winUV.y ).mul( 0.5 ).add( 0.2 ).mul( shopLit ) );

	const viewDir = normalize( cameraPosition.sub( positionWorld ) );
	const fresnel = pow( clamp( float( 1 ).sub( abs( dot( viewDir, n ) ) ), 0, 1 ), 2.0 );
	const recess = float( 1 ).sub( smoothstep( 0.86, 1.0, winUV.y ).mul( 0.45 ) ).sub( float( 1 ).sub( smoothstep( 0.0, 0.1, winUV.x ) ).mul( 0.3 ) );
	const behindGlass = mix( room.xyz.mul( 0.8 ), shopInterior, shop );
	const glass = mix( mix( behindGlass, color( 0x1b2630 ), 0.42 ), sceneUniforms.skyHorizon, fresnel.mul( 0.5 ).add( 0.06 ) ).mul( recess );

	// Door: dark panelled wooden door with a fanlight, in a stone surround.
	// A gate (house description) is a wide, round-arched carriage entrance; otherwise a plain door.
	// Doors are a real door's height (2.7 m, a gate 3.9 m), not a proportion of a tall ground floor.
	const dx0 = mix( float( 0.3 ), float( 0.14 ), isGate );
	const dy1 = min( mix( float( 0.82 ), float( 0.94 ), isGate ), mix( float( 2.7 ), float( 3.9 ), isGate ).div( fH ) );
	const doorUV = vec2( cellU.sub( dx0 ).div( float( 1 ).sub( dx0.mul( 2 ) ) ), cellV.div( dy1 ) );
	const gateArch = step( length( vec2( doorUV.x.sub( 0.5 ).mul( 2 ), doorUV.y.sub( 0.72 ).div( 0.28 ) ) ), 1 ).max( step( doorUV.y, 0.72 ) );
	const doorWay = filteredPulse( cellU, dx0, float( 1 ).sub( dx0 ), fw.x ).mul( filteredPulse( cellV, 0.0, dy1, fw.y ) ).mul( door ).mul( mix( float( 1 ), gateArch, isGate ) );
	const doorFrame = filteredPulse( cellU, dx0.sub( 0.06 ), float( 1.06 ).sub( dx0 ), fw.x ).mul( filteredPulse( cellV, 0.0, dy1.add( 0.05 ), fw.y ) ).mul( door ).sub( doorWay ).max( 0 );
	const fanlight = step( 0.8, doorUV.y ).mul( float( 1 ).sub( isGate ) );
	const doorPaint = mix( color( 0x3b2618 ), color( 0x22301f ), step( 0.6, fract( seed.mul( 17.3 ) ) ) );
	const doorPanels = max( gridLine( doorUV.x, 0.5, 0.025 ), gridLine( doorUV.y, 0.27, 0.02 ) );
	const planks = gridLine( doorUV.x, 0.125, 0.012 ).add( gridLine( doorUV.x, 0.5, 0.02 ) ).min( 1 );
	const doorColor = mix( mix( doorPaint.mul( float( 1 ).sub( doorPanels.mul( 0.45 ) ) ), color( 0x4a2f1d ).mul( float( 1 ).sub( planks.mul( 0.4 ) ) ), isGate ), glass, fanlight );

	// Máj glazing: dark glass, lit shop interiors along the street, the band's yellow frames.
	const majGlass = mix( mix( color( 0x1c2228 ), color( 0xcbb48a ), step( 0.35, hash2D( vec2( floor( u.div( 3 ) ), seed ) ) ).mul( smoothstep( 4.4, 0.5, h ) ).mul( 0.55 ) ), sceneUniforms.skyHorizon, fresnel.mul( 0.5 ).add( 0.05 ) );
	wall = mix( wall, majGlass, max( majShopfront, majBand ) );
	wall = mix( wall, color( 0xe8b030 ), max( majFrame, lineAA( fract( u.div( 1.5 ) ).sub( 0.5 ), 0.01 ).mul( majShopfront ).mul( 0.6 ) ) );

	let col = mix( wall, frameColor, openingAll.mul( frame ) );
	// Iron bars over the ground-floor windows.
	const bars = max( lineAA( fract( winUV.x.mul( 5 ) ).sub( 0.5 ), 0.035 ), lineAA( fract( winUV.y.mul( 4 ) ).sub( 0.5 ), 0.03 ) )
		.mul( grilles ).mul( ground ).mul( openingAll );
	col = mix( col, glass, openingAll.mul( float( 1 ).sub( frame ) ) );
	col = mix( col, trim, doorFrame );
	col = mix( col, doorColor, doorWay );
	col = mix( col, color( 0x1f1f1d ), bars );
	mat.colorNode = col;

	const glassMask = openingAll.mul( float( 1 ).sub( frame ) ).add( doorWay.mul( fanlight ) ).add( max( majShopfront, majBand ) ).min( 1 );
	mat.roughnessNode = mix( float( 0.88 ).add( grain ), float( 0.1 ), glassMask );

	// Street-canyon sky occlusion: darker low down in narrow lanes.
	mat.aoNode = mix( float( 0.55 ), float( 1.0 ), smoothstep( 0.0, 16.0, h ) );

	mat.emissiveNode = room.xyz.mul( room.w ).mul( openingAll ).mul( float( 1 ).sub( frame ) ).mul( upper )
		.add( color( 0xffd29a ).mul( shop ).mul( shopLit ).mul( openingAll ).mul( float( 1 ).sub( frame ) ).mul( 0.6 ) )
		.mul( sceneUniforms.interiorGlow );

	// Relief: cornices, string course, caps and sills stand out; openingAlls and grooves are recessed.
	mat.normalNode = Fn( () => {

		const fade = float( 1 ).sub( smoothstep( 25.0, 140.0, camDist ) );
		const relief = mainCornice.mul( smoothstep( 0.75, 0.2, fromTop ) ).mul( 0.06 ).mul( plain )
			.add( attic.mul( 0.03 ) ).sub( balusterGap.mul( 0.03 ) ).add( chapelFrame.mul( 0.03 ) )
			.add( stringCourse.mul( 0.035 ) )
			.add( cap.mul( 0.04 ) ).add( sill.mul( 0.03 ) ).add( surround.mul( 0.015 ) ).add( quoin.mul( 0.015 ) )
			.sub( openingAll.mul( float( 1 ).sub( frame ) ).mul( 0.03 ) )
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
