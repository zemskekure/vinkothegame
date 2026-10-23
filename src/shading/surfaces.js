// Roofs, street surfaces and water, in the same procedural, filter-width antialiased style as the facades.

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, color, attribute, texture, positionWorld, normalWorldGeometry, cameraPosition,
	floor, fract, mod, max, mix, step, smoothstep, abs, length, fwidth, time, dot
} from 'three/tsl';
import { hash2D, noise2D, bumpNormal, gridLine, lineAA } from './common.js';

const distFade = ( near, far ) => float( 1 ).sub( smoothstep( near, far, length( positionWorld.sub( cameraPosition ) ) ) );

// Roofs in their real colour (median of the aerial photo over each roof): clay tiles, green copper, grey sheet
// metal / slate, flat roofs. The pattern only modulates that colour, keeping its average.
// Tile rows follow the roof's contour lines, so the pattern works on every face of a hipped roof.
export function createRoofMaterial() {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.8 } );
	const kind = attribute( 'roofKind', 'float' );
	const seed = attribute( 'seed', 'float' );
	const photo = attribute( 'roofColor', 'vec3' );
	// The aerial photo is hazy: restore saturation and contrast before converting sRGB → linear.
	const luma = dot( photo, vec3( 0.3, 0.59, 0.11 ) );
	const graded = mix( vec3( luma ), photo, 1.7 ).sub( 0.5 ).mul( 1.15 ).add( 0.47 ).clamp( 0.02, 1 );
	const real = graded.pow( vec3( 2.2 ) );

	const n = normalWorldGeometry;
	const slope2 = n.xz.div( max( length( n.xz ), 0.001 ) );
	const across = positionWorld.x.mul( slope2.y.negate() ).add( positionWorld.z.mul( slope2.x ) );

	const isTiles = step( kind, 0.5 );
	const isCopper = step( 0.5, kind ).mul( step( kind, 1.5 ) );
	const isFlat = step( 1.5, kind ).mul( step( kind, 2.5 ) );
	const isMetal = step( 2.5, kind ).mul( step( kind, 3.5 ) );
	const isTheatre = step( 3.5, kind ); // Národní divadlo: deep blue roof sown with gold stars

	// Clay beaver-tail tiles
	const row = positionWorld.y.div( 0.11 );
	const rowIdx = floor( row );
	const col = across.div( 0.19 ).add( mod( rowIdx, 2 ).mul( 0.5 ) );
	const cu = fract( col ), cv = fract( row );
	const tileId = vec2( floor( col ), rowIdx );
	const arcX = cu.sub( 0.5 ).mul( 2 );
	const arc = arcX.mul( arcX ).mul( 0.35 ); // rounded tail of each tile
	const tailShadow = smoothstep( 0.0, 0.18, cv.sub( arc ).add( 0.1 ) ).oneMinus().mul( 0.5 );
	const gap = gridLine( col, 1, 0.025 ).mul( 0.35 );
	const tileFade = float( 1 ).sub( smoothstep( 0.4, 1.0, fwidth( row ) ) );
	const tileRnd = hash2D( tileId.add( seed.mul( 17 ) ) ).sub( 0.5 );
	const tiles = real.mul( float( 1 ).add( tileRnd.mul( 0.25 ).mul( tileFade ) ) )
		.mul( float( 1 ).sub( max( tailShadow, gap ).mul( tileFade ) ).add( tileFade.mul( 0.08 ) ) );

	// Standing seams down the slope (copper and sheet metal).
	const seam = gridLine( across, 0.55, 0.02 );
	const sheets = real.mul( float( 1 ).sub( seam.mul( 0.3 ) ) ).mul( mix( float( 0.94 ), float( 1.06 ), noise2D( positionWorld.xz.mul( 0.4 ) ) ) );

	// Flat roofs: gravel / tar.
	const gravel = real.mul( mix( float( 0.85 ), float( 1.1 ), noise2D( positionWorld.xz.mul( 3.0 ) ) ) );

	const starCell = vec2( across.div( 0.9 ), positionWorld.y.div( 0.9 ) );
	const starUV = fract( starCell.add( vec2( mod( floor( starCell.y ), 2 ).mul( 0.5 ), 0 ) ) ).sub( 0.5 );
	const star = smoothstep( 0.13, 0.1, abs( starUV.x ).add( abs( starUV.y ) ) ).max( smoothstep( 0.05, 0.03, abs( starUV.x ).max( abs( starUV.y ) ) ) );
	const theatreRoof = mix( color( 0x223a6b ).mul( float( 1 ).sub( seam.mul( 0.3 ) ) ), color( 0xd6a63c ), star );

	mat.colorNode = tiles.mul( isTiles ).add( sheets.mul( isCopper.add( isMetal ) ) ).add( gravel.mul( isFlat ) ).add( theatreRoof.mul( isTheatre ) );
	mat.roughnessNode = mix( mix( float( 0.78 ), float( 0.45 ), isCopper.add( isMetal ).add( isTheatre ).min( 1 ) ), float( 0.3 ), star.mul( isTheatre ) );
	mat.metalnessNode = isMetal.mul( 0.3 ).add( star.mul( isTheatre ).mul( 0.9 ) );
	mat.normalNode = Fn( () => {

		const relief = isTiles.mul( cv.sub( arc ).clamp( 0, 1 ).mul( 0.02 ) ).mul( tileFade )
			.add( isCopper.add( isMetal ).mul( seam ).mul( 0.01 ) );
		return bumpNormal( relief.mul( distFade( 30, 160 ) ) );

	} )();

	return mat;

}

/**
 * Streets from the surface maps (see tools/build-scene.mjs and tools/streets.mjs, after OpenStreetMap): carriageways
 * in asphalt (with tram rails), granite setts or paving stones; Prague mosaic pavements with granite kerbs along
 * roads that have them; pedestrian streets and squares in their own surface; grass in parks; dressed-stone
 * embankment walls on steep ground. Also used for the raised pavement mesh.
 */
export function createGroundMaterial( surfaceTex, surface2Tex, bounds ) {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } );
	const wx = positionWorld.x, wz = positionWorld.z;
	const suv = vec2( wx.sub( bounds.minX ).div( bounds.maxX - bounds.minX ), wz.sub( bounds.minZ ).div( bounds.maxZ - bounds.minZ ) );
	const s = texture( surfaceTex, suv );
	const s2 = texture( surface2Tex, suv );

	const buildingDist = s.r.mul( 255 / 40 );
	const park = s.g;
	const F = float( 128 / 255 ).sub( s.b ).mul( 255 / 25 ); // signed distance to a carriageway edge, < 0 on the road
	const Fk = float( 128 / 255 ).sub( s2.b ).mul( 255 / 25 ); // same for kerbed carriageways, > 0 on the pavement
	const tramDist = s.a.mul( 255 / 50 );

	const KERB = 0.22;
	const road = smoothstep( 0.06, - 0.06, F );
	const kerbTop = smoothstep( - 0.02, 0.02, Fk ).mul( smoothstep( KERB + 0.02, KERB - 0.02, Fk ) );
	const pavement = smoothstep( KERB - 0.02, KERB + 0.02, Fk ).mul( smoothstep( 4.2, 3.8, Fk ) ).mul( float( 1 ).sub( park ) );
	const steep = smoothstep( 0.8, 0.6, normalWorldGeometry.y );
	const kerbFace = steep.mul( smoothstep( 0.5, 0.3, abs( Fk ) ) );

	// Granite setts ("kostky") in staggered rows: grey granite, about 16 × 13 cm, domed, with dark joints.
	const setRow = wz.div( 0.13 );
	const setRowIdx = floor( setRow );
	const setCol = wx.div( 0.16 ).add( hash2D( vec2( setRowIdx, 3.1 ) ) );
	const setId = vec2( floor( setCol ), setRowIdx );
	const setFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( setRow ) ) );
	const setRnd = hash2D( setId );
	const sett = mix( mix( color( 0x6c6a66 ), color( 0x858079 ), setRnd ), color( 0x8a7a68 ), step( 0.82, setRnd ).mul( 0.7 ) );
	const setDome = smoothstep( 0.0, 0.32, float( 0.5 ).sub( abs( fract( setCol ).sub( 0.5 ) ) ) )
		.mul( smoothstep( 0.0, 0.32, float( 0.5 ).sub( abs( fract( setRow ).sub( 0.5 ) ) ) ) );
	const cobbles = mix( sett.mul( 0.75 ), sett.mul( mix( float( 0.35 ), float( 1.0 ), setDome ) ), setFade );

	// Prague mosaic pavement: 5 cm white limestone cubes laid in bold black basalt patterns. Each stretch of
	// pavement (an 8 m cell) gets one of three classic patterns: a checkerboard of squares, a diagonal lattice,
	// or plain white with a black border band.
	const mos = vec2( wx, wz ).div( 0.055 );
	const mosId = floor( mos );
	const mosFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( mos.x ) ) );
	const mosRnd = hash2D( mosId.add( 7.7 ) );
	const patternKind = hash2D( floor( vec2( wx, wz ).div( 8 ) ).add( 1.7 ) );
	const checker = step( 0.5, fract( floor( mosId.x.div( 6 ) ).add( floor( mosId.y.div( 6 ) ) ).mul( 0.5 ) ) );
	const lattice = step( mod( mosId.x.add( mosId.y ), 10 ), 0.5 ).add( step( mod( mosId.x.sub( mosId.y ), 10 ), 0.5 ) ).min( 1 );
	const border = step( mod( mosId.x.add( 2 ), 24 ), 1.5 ).add( step( mod( mosId.y.add( 2 ), 24 ), 1.5 ) ).min( 1 );
	const pattern = mix( mix( checker, lattice, step( 0.4, patternKind ) ), border, step( 0.75, patternKind ) );
	const mosaicStone = mix( mix( color( 0xdcd7cd ), color( 0xc5beb1 ), mosRnd ), mix( color( 0x2c2b2a ), color( 0x3d3b39 ), mosRnd ), pattern );
	const mosJoint = max( gridLine( wx, 0.055, 0.005 ), gridLine( wz, 0.055, 0.005 ) );
	const mosaic = mix( mix( color( 0xc0bab0 ), color( 0x4a4846 ), pattern.mul( 0.9 ) ), mosaicStone.mul( float( 1 ).sub( mosJoint.mul( 0.45 ) ) ), mosFade );

	const kerbCol = mix( color( 0xa8a59e ), color( 0x96938b ), noise2D( vec2( wx, wz ).mul( 4 ) ) )
		.mul( float( 1 ).sub( gridLine( wx.add( wz ), 1.0, 0.008 ).mul( 0.35 ) ) );

	// Paving stones: larger rectangular slabs in running bond.
	const slabRow = wz.div( 0.3 );
	const slabCol = wx.div( 0.45 ).add( mod( floor( slabRow ), 2 ).mul( 0.5 ) );
	const slabFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( slabRow ) ) );
	const slab = mix( color( 0x9d968b ), color( 0xb2ab9e ), hash2D( vec2( floor( slabCol ), floor( slabRow ) ).add( 3.3 ) ) );
	const paving = mix( slab.mul( 0.92 ), slab.mul( float( 1 ).sub( max( gridLine( slabCol, 1, 0.012 ), gridLine( slabRow, 1, 0.02 ) ).mul( 0.4 ) ) ), slabFade );

	// Asphalt with tram rails (standard gauge: rails 0.72 m either side of the track centreline).
	const asphaltCol = mix( color( 0x3d3e40 ), color( 0x4c4c4c ), noise2D( vec2( wx, wz ).mul( 2.5 ) ) ).mul( mix( float( 0.9 ), float( 1.05 ), noise2D( vec2( wx, wz ).mul( 0.2 ) ) ) );
	const rail = lineAA( abs( tramDist.sub( 0.72 ) ), 0.035 );
	const railCol = color( 0x9c9a96 );

	const grass = mix( color( 0x4f6b2f ), color( 0x6a8338 ), noise2D( vec2( wx, wz ).mul( 0.6 ) ) ).mul( mix( float( 0.85 ), float( 1.1 ), noise2D( vec2( wx, wz ).mul( 7 ) ) ) );

	// Embankment and terrain steps: dressed sandstone blocks.
	const ashlar = mix( color( 0x8b8170 ), color( 0x9c927e ), hash2D( floor( vec2( wx.add( wz ).div( 0.9 ), positionWorld.y.div( 0.45 ) ) ) ) )
		.mul( float( 1 ).sub( max( gridLine( positionWorld.y, 0.45, 0.02 ), gridLine( wx.add( wz ), 0.9, 0.02 ) ).mul( 0.4 ) ) );

	// Surface codes: 0 setts, 0.5 paving stones, 1 asphalt.
	const surfaceColour = code => mix( mix( cobbles, paving, step( 0.25, code ) ), asphaltCol, step( 0.75, code ) );
	const roadSurface = s2.r, openSurface = s2.g;

	let col = surfaceColour( openSurface );
	col = mix( col, mix( surfaceColour( roadSurface ), railCol, rail ), road );
	col = mix( col, mosaic, pavement );
	col = mix( col, grass, park.mul( float( 1 ).sub( pavement ) ) );
	col = mix( col, ashlar, steep );
	col = mix( col, kerbCol, max( kerbTop, kerbFace ) );

	// Soft contact shadow at the foot of the houses.
	col = col.mul( mix( float( 0.6 ), float( 1 ), smoothstep( 0.0, 0.9, buildingDist ) ) );
	mat.colorNode = col;
	mat.roughnessNode = mix( mix( float( 0.85 ), float( 0.55 ), rail.mul( road ) ), float( 1.0 ), park );
	const isSetts = float( 1 ).sub( step( 0.25, mix( openSurface, roadSurface, road ) ) ).mul( float( 1 ).sub( pavement ) );

	mat.normalNode = Fn( () => {

		const relief = setDome.mul( 0.012 ).mul( setFade ).mul( isSetts ).mul( float( 1 ).sub( steep ) )
			.add( pavement.mul( 0.004 ).mul( float( 1 ).sub( mosJoint ) ).mul( mosFade ) );
		return bumpNormal( relief.mul( distFade( 12, 60 ) ) );

	} )();

	return mat;

}

export function createWaterMaterial() {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.06, metalness: 0.0 } );
	const p = positionWorld.xz;
	const waves = noise2D( p.mul( 0.35 ).add( vec2( time.mul( 0.15 ), time.mul( 0.05 ) ) ) ).mul( 0.6 )
		.add( noise2D( p.mul( 1.3 ).sub( vec2( time.mul( 0.25 ), 0 ) ) ).mul( 0.3 ) )
		.add( noise2D( p.mul( 4.1 ).add( vec2( 0, time.mul( 0.4 ) ) ) ).mul( 0.1 ) );
	mat.colorNode = mix( color( 0x1d2b2a ), color( 0x2c3d38 ), noise2D( p.mul( 0.05 ) ) );
	mat.normalNode = bumpNormal( waves.mul( 0.08 ) );
	return mat;

}
