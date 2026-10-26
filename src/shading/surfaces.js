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
	// The starry blue covers the auditorium and stage; the south wing (Schulz's annexe, past z ≈ 402 in the scene) is
	// green copper on the aerial photo.
	const southWing = smoothstep( 401, 403, positionWorld.z );
	const theatreRoof = mix( mix( color( 0x1f3157 ).mul( float( 1 ).sub( seam.mul( 0.3 ) ) ), color( 0xd6a63c ), star ), color( 0x5f8f7c ).mul( float( 1 ).sub( seam.mul( 0.3 ) ) ), southWing );

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
export function createGroundMaterial( surfaceTex, surface2Tex, bounds, detailTex, detailBounds = bounds, wideTex = null ) {

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
	// Mosaic on the raised pavement: a strip along the kerb; where no square or pedestrian area with its own surface
	// is mapped (OSM), all of it, so the wide corners at crossings are mosaic too rather than setts.
	const unmapped = smoothstep( 22 / 255, 34 / 255, s2.g ).mul( smoothstep( 58 / 255, 46 / 255, s2.g ) );
	const pavementWidth = mix( float( 4.2 ), float( 8.6 ), unmapped );
	const pavement = smoothstep( KERB - 0.02, KERB + 0.02, Fk ).mul( smoothstep( pavementWidth, pavementWidth.sub( 0.4 ), Fk ) ).mul( float( 1 ).sub( park ) );
	const steep = smoothstep( 0.8, 0.6, normalWorldGeometry.y );
	const kerbFace = steep.mul( smoothstep( 0.5, 0.3, abs( Fk ) ) );

	// Granite setts ("kostky"): light cool-grey granite, slightly domed, with dark mossy joints.
	// Laid in segmental arcs ("Bogenpflaster"), as on Spálená and the Národní crossing: small cubes of about
	// 11 × 10 cm in rows that bow across 2 m wide arcs.
	const arcX = fract( wx.div( 2.0 ) ).sub( 0.5 );
	const setRow = wz.add( float( 1 ).sub( arcX.mul( arcX ).mul( 4 ) ).mul( 0.5 ) ).div( 0.10 );
	const setRowIdx = floor( setRow );
	const setCol = wx.div( 0.11 ).add( hash2D( vec2( setRowIdx, 3.1 ) ) );
	const setId = vec2( floor( setCol ), setRowIdx );
	const setFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( setRow ) ) );
	const setRnd = hash2D( setId );
	const sett = mix( mix( color( 0x8b8b88 ), color( 0xaaa9a4 ), setRnd ), color( 0x9a9284 ), step( 0.85, setRnd ).mul( 0.6 ) );
	const setDome = smoothstep( 0.0, 0.3, float( 0.5 ).sub( abs( fract( setCol ).sub( 0.5 ) ) ) )
		.mul( smoothstep( 0.0, 0.3, float( 0.5 ).sub( abs( fract( setRow ).sub( 0.5 ) ) ) ) );
	const joint = mix( color( 0x3d3f37 ), color( 0x4f5a3a ), noise2D( vec2( wx, wz ).mul( 1.7 ) ) );
	const cobbles = mix( mix( sett, joint, 0.35 ), mix( joint, sett.mul( mix( float( 0.8 ), float( 1.0 ), setDome ) ), smoothstep( 0.0, 0.25, setDome ) ), setFade );

	// Prague mosaic pavement: 5 cm limestone cubes, pale grey, with subtle mid-grey patterns (zigzag bands
	// or a diagonal lattice, chosen per stretch of pavement). Bold black-and-white patterns are left to the
	// big boulevards, which the aerial-photo detail brings in.
	const mos = vec2( wx, wz ).div( 0.055 );
	const mosId = floor( mos );
	const mosFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( mos.x ) ) );
	const mosRnd = hash2D( mosId.add( 7.7 ) );
	const patternKind = hash2D( floor( vec2( wx, wz ).div( 10 ) ).add( 1.7 ) );
	const zig = step( fract( mosId.x.add( abs( fract( mosId.y.div( 16 ) ).sub( 0.5 ) ).mul( 16 ) ).div( 12 ) ), 0.28 );
	const lattice = step( mod( mosId.x.add( mosId.y ), 9 ), 0.5 ).add( step( mod( mosId.x.sub( mosId.y ), 9 ), 0.5 ) ).min( 1 );
	const pattern = mix( zig, lattice, step( 0.55, patternKind ) );
	const mosaicStone = mix( mix( color( 0xd4d0c7 ), color( 0xbdb8ad ), mosRnd ), mix( color( 0x7a766f ), color( 0x8b867d ), mosRnd ), pattern );
	const mosJoint = max( gridLine( wx, 0.055, 0.005 ), gridLine( wz, 0.055, 0.005 ) );
	const mosaic = mix( mix( color( 0xc6c1b7 ), color( 0x8a867f ), pattern.mul( 0.7 ) ), mosaicStone.mul( float( 1 ).sub( mosJoint.mul( 0.4 ) ) ), mosFade );

	// Band of small reddish-brown setts along the kerb.
	const bandStone = mix( color( 0x6f5546 ), color( 0x8a6a56 ), hash2D( floor( vec2( wx, wz ).div( 0.09 ) ).add( 4.4 ) ) );
	const band = mix( bandStone.mul( 0.9 ), bandStone.mul( float( 1 ).sub( max( gridLine( wx, 0.09, 0.008 ), gridLine( wz, 0.09, 0.008 ) ).mul( 0.4 ) ) ), mosFade );

	const kerbCol = mix( color( 0xb9b7b0 ), color( 0xa6a49d ), noise2D( vec2( wx, wz ).mul( 4 ) ) )
		.mul( float( 1 ).sub( gridLine( wx.add( wz ), 1.0, 0.008 ).mul( 0.35 ) ) );

	// Paving stones: larger rectangular slabs in running bond.
	const slabRow = wz.div( 0.3 );
	const slabCol = wx.div( 0.45 ).add( mod( floor( slabRow ), 2 ).mul( 0.5 ) );
	const slabFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( slabRow ) ) );
	const slab = mix( color( 0x9d968b ), color( 0xb2ab9e ), hash2D( vec2( floor( slabCol ), floor( slabRow ) ).add( 3.3 ) ) );
	const paving = mix( slab.mul( 0.92 ), slab.mul( float( 1 ).sub( max( gridLine( slabCol, 1, 0.012 ), gridLine( slabRow, 1, 0.02 ) ).mul( 0.4 ) ) ), slabFade );

	// Asphalt with tram rails. The tram lines (ZABAGED) are the centre lines of double tracks, and every line here is
	// double (trams both ways, Street View): two tracks 1.5 m either side of the line, standard gauge, so rails at
	// 1.5 ∓ 0.72 m from it (the trams run on the same tracks, tools/places.mjs).
	const asphaltCol = mix( color( 0x3d3e40 ), color( 0x4c4c4c ), noise2D( vec2( wx, wz ).mul( 2.5 ) ) ).mul( mix( float( 0.9 ), float( 1.05 ), noise2D( vec2( wx, wz ).mul( 0.2 ) ) ) );
	const rail = max( lineAA( abs( tramDist.sub( 0.78 ) ), 0.035 ), lineAA( abs( tramDist.sub( 2.22 ) ), 0.035 ) );
	const railCol = color( 0x9c9a96 );

	const grass = mix( color( 0x4f6b2f ), color( 0x6a8338 ), noise2D( vec2( wx, wz ).mul( 0.6 ) ) ).mul( mix( float( 0.85 ), float( 1.1 ), noise2D( vec2( wx, wz ).mul( 7 ) ) ) );

	// Embankment and terrain steps: dressed sandstone blocks.
	const ashlar = mix( color( 0x8b8170 ), color( 0x9c927e ), hash2D( floor( vec2( wx.add( wz ).div( 0.9 ), positionWorld.y.div( 0.45 ) ) ) ) )
		.mul( float( 1 ).sub( max( gridLine( positionWorld.y, 0.45, 0.02 ), gridLine( wx.add( wz ), 0.9, 0.02 ) ).mul( 0.4 ) ) );

	// Surface codes: 0 setts, 0.5 paving stones, 1 asphalt.
	// The maps are filtered, so a boundary between asphalt and setts passes through the paving code on the way:
	// paving stones only right at 0.5, else a short blend, so no strip of slabs appears along the boundary.
	const surfaceColour = code => mix( mix( cobbles, asphaltCol, smoothstep( 0.55, 0.65, code ) ), paving, float( 1 ).sub( smoothstep( 0.03, 0.08, abs( code.sub( 0.5 ) ) ) ) );
	const roadSurface = s2.r, openSurface = s2.g;

	let col = surfaceColour( openSurface );
	col = mix( col, mix( surfaceColour( roadSurface ), railCol, rail ), road );
	const kerbBand = smoothstep( KERB + 0.28, KERB + 0.24, Fk ).mul( pavement );
	// Tram stop islands: light concrete slabs instead of mosaic.
	const island = float( 1 ).sub( s2.a );
	col = mix( col, mix( mix( mosaic, band, kerbBand ), paving.mul( 1.25 ), island ), pavement );
	col = mix( col, grass, park.mul( float( 1 ).sub( pavement ) ) );
	col = mix( col, ashlar, steep );
	col = mix( col, kerbCol, max( kerbTop, kerbFace ) );

	// Real ground detail from the aerial photo (shadow-free, see tools/build-scene.mjs): markings, mosaic patterns,
	// kerb lines, stains.
	// detailTex covers detailBounds (the first area, 25 cm); wideTex, when given, the whole area at 50 cm.
	const D = detailBounds;
	const duv = vec2( wx.sub( D.minX ).div( D.maxX - D.minX ), wz.sub( D.minZ ).div( D.maxZ - D.minZ ) );
	let detailValue = texture( detailTex, duv ).r;
	if ( wideTex ) {

		const inside = step( D.minX, wx ).mul( step( wx, D.maxX ) ).mul( step( D.minZ, wz ) ).mul( step( wz, D.maxZ ) );
		// The wide detail comes square by square without mipmaps (src/main.js): it fades to neutral with distance,
		// as the mipmapped picture's average did, so it doesn't sparkle far off.
		const wide = mix( texture( wideTex, suv ).r, float( 128 / 255 ), float( 1 ).sub( distFade( 90, 260 ) ) );
		detailValue = mix( wide, detailValue, inside );

	}

	const detail = float( 1 ).add( detailValue.mul( 255 ).sub( 128 ).div( 160 ) );
	const flat = float( 1 ).sub( steep );
	// Subtle on purpose: stronger, it turns parked cars and glare into white blotches on the road.
	col = col.mul( mix( float( 1 ), detail.clamp( 0.7, 1.3 ), mix( float( 0.5 ), float( 0.35 ), pavement ).mul( flat ) ) );

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
