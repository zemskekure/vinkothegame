// Roofs, street surfaces and water, in the same procedural, filter-width antialiased style as the facades.

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, color, attribute, texture, positionWorld, normalWorldGeometry, cameraPosition,
	floor, fract, mod, max, mix, step, smoothstep, abs, length, fwidth, time
} from 'three/tsl';
import { hash2D, noise2D, bumpNormal, gridLine, lineAA } from './common.js';

const distFade = ( near, far ) => float( 1 ).sub( smoothstep( near, far, length( positionWorld.sub( cameraPosition ) ) ) );

// Roofs: beaver-tail clay tiles (most houses), green copper (churches), grey gravel (flat roofs).
// Tile rows follow the roof's contour lines, so the pattern works on every face of a hipped roof.
export function createRoofMaterial() {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.8 } );
	const kind = attribute( 'roofKind', 'float' );
	const seed = attribute( 'seed', 'float' );

	const n = normalWorldGeometry;
	const slope2 = n.xz.div( max( length( n.xz ), 0.001 ) );
	const across = positionWorld.x.mul( slope2.y.negate() ).add( positionWorld.z.mul( slope2.x ) );

	const isTiles = step( kind, 0.5 );
	const isCopper = step( 0.5, kind ).mul( step( kind, 1.5 ) );
	const isFlat = step( 1.5, kind );

	// Clay tiles
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
	const roofTone = fract( seed.mul( 9.1 ) );
	const clay = mix( mix( color( 0xb4532e ), color( 0x9a4630 ), roofTone ), color( 0xc36d3e ), step( 0.75, roofTone ) );
	const weathering = smoothstep( 0.35, 0.85, noise2D( positionWorld.xz.mul( 0.12 ).add( seed.mul( 50 ) ) ) );
	const moss = smoothstep( 0.6, 0.9, noise2D( positionWorld.xz.mul( 0.5 ) ) ).mul( 0.25 );
	const tiles = clay.mul( float( 1 ).add( tileRnd.mul( 0.22 ).mul( tileFade ) ) )
		.mul( float( 1 ).sub( max( tailShadow, gap ).mul( tileFade ) ) )
		.mul( float( 1 ).sub( weathering.mul( 0.22 ) ) );
	const tilesCol = mix( tiles, vec3( 0.33, 0.32, 0.22 ), moss );

	// Copper: green patina with standing seams down the slope.
	const seam = gridLine( across, 0.55, 0.02 );
	const patina = mix( color( 0x6ea58c ), color( 0x4f7f6c ), noise2D( positionWorld.xz.mul( 0.3 ) ) );
	const copperCol = patina.mul( float( 1 ).sub( seam.mul( 0.25 ) ) );

	// Flat roofs: grey gravel / tar.
	const gravel = mix( color( 0x7b7a76 ), color( 0x8e8c86 ), noise2D( positionWorld.xz.mul( 3.0 ) ) );

	mat.colorNode = tilesCol.mul( isTiles ).add( copperCol.mul( isCopper ) ).add( gravel.mul( isFlat ) );
	mat.roughnessNode = mix( float( 0.75 ), float( 0.45 ), isCopper );
	mat.normalNode = Fn( () => {

		const relief = isTiles.mul( cv.sub( arc ).clamp( 0, 1 ).mul( 0.02 ) ).mul( tileFade )
			.add( isCopper.mul( seam ).mul( 0.01 ) );
		return bumpNormal( relief.mul( distFade( 30, 160 ) ) );

	} )();

	return mat;

}

/**
 * Streets from the surface map (see tools/build-scene.mjs): granite setts ("kočičí hlavy") by default, Prague
 * mosaic sidewalks with granite kerbs along the houses, asphalt with tram rails on the main roads, grass in parks,
 * dressed-stone embankment walls on steep ground.
 */
export function createGroundMaterial( surfaceTex, bounds ) {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } );
	const wx = positionWorld.x, wz = positionWorld.z;
	const suv = vec2( wx.sub( bounds.minX ).div( bounds.maxX - bounds.minX ), wz.sub( bounds.minZ ).div( bounds.maxZ - bounds.minZ ) );
	const s = texture( surfaceTex, suv );

	const buildingDist = s.r.mul( 255 / 40 );
	const park = s.g;
	const asphalt = smoothstep( 0.5, 0.56, s.b );
	const tramDist = s.a.mul( 255 / 50 );

	const SIDEWALK = 1.7, KERB = 0.22;
	const sidewalk = float( 1 ).sub( smoothstep( SIDEWALK - 0.02, SIDEWALK + 0.02, buildingDist ) ).mul( float( 1 ).sub( park ) );
	const kerb = smoothstep( SIDEWALK - 0.02, SIDEWALK + 0.02, buildingDist ).mul( float( 1 ).sub( smoothstep( SIDEWALK + KERB - 0.02, SIDEWALK + KERB + 0.02, buildingDist ) ) ).mul( asphalt.max( 0.0 ) );
	const road = asphalt.mul( float( 1 ).sub( sidewalk ) ).mul( float( 1 ).sub( kerb ) );
	const steep = smoothstep( 0.8, 0.6, normalWorldGeometry.y );

	// Granite setts in staggered rows.
	const setRow = wz.div( 0.13 );
	const setRowIdx = floor( setRow );
	const setCol = wx.div( 0.13 ).add( hash2D( vec2( setRowIdx, 3.1 ) ) );
	const setId = vec2( floor( setCol ), setRowIdx );
	const setFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( setRow ) ) );
	const setRnd = hash2D( setId );
	const sett = mix( mix( color( 0x7d7268 ), color( 0x948a7c ), setRnd ), color( 0x6a5a4c ), step( 0.85, setRnd ).mul( 0.6 ) );
	const setDome = smoothstep( 0.0, 0.3, float( 0.5 ).sub( abs( fract( setCol ).sub( 0.5 ) ) ) )
		.mul( smoothstep( 0.0, 0.3, float( 0.5 ).sub( abs( fract( setRow ).sub( 0.5 ) ) ) ) );
	const cobbles = mix( sett.mul( 0.82 ), sett.mul( mix( float( 0.55 ), float( 1.0 ), setDome ) ), setFade );

	// Mosaic sidewalk: small limestone cubes, light with a dark diagonal-square pattern now and then.
	const mos = vec2( wx, wz ).div( 0.055 );
	const mosId = floor( mos );
	const mosFade = float( 1 ).sub( smoothstep( 0.35, 0.9, fwidth( mos.x ) ) );
	const mosRnd = hash2D( mosId.add( 7.7 ) );
	// Sparse dark diamonds, as in the classic Prague mosaic.
	const pattern = step( 0.5, fract( floor( mos.x.add( mos.y ).div( 9 ) ).mul( 0.5 ) ) ).mul( step( 0.5, fract( floor( mos.x.sub( mos.y ).div( 9 ) ).mul( 0.5 ) ) ) )
		.mul( step( 0.75, hash2D( floor( mos.add( vec2( mos.y, mos.x.negate() ) ).div( 36 ) ) ) ) );
	const mosaicStone = mix( mix( color( 0xcfc8bb ), color( 0xb9b1a3 ), mosRnd ), color( 0x4a4541 ), pattern.mul( 0.8 ) );
	const mosJoint = max( gridLine( wx, 0.055, 0.004 ), gridLine( wz, 0.055, 0.004 ) );
	const mosaic = mix( mix( color( 0xb5ad9f ), color( 0x8a8580 ), pattern.mul( 0.4 ) ), mosaicStone.mul( float( 1 ).sub( mosJoint.mul( 0.4 ) ) ), mosFade );

	const kerbCol = mix( color( 0xa8a59e ), color( 0x96938b ), noise2D( vec2( wx, wz ).mul( 4 ) ) );

	// Asphalt with tram rails (standard gauge: rails 0.72 m either side of the track centreline).
	const asphaltCol = mix( color( 0x3d3e40 ), color( 0x4c4c4c ), noise2D( vec2( wx, wz ).mul( 2.5 ) ) ).mul( mix( float( 0.9 ), float( 1.05 ), noise2D( vec2( wx, wz ).mul( 0.2 ) ) ) );
	const rail = lineAA( abs( tramDist.sub( 0.72 ) ), 0.035 );
	const railCol = color( 0x9c9a96 );

	const grass = mix( color( 0x4f6b2f ), color( 0x6a8338 ), noise2D( vec2( wx, wz ).mul( 0.6 ) ) ).mul( mix( float( 0.85 ), float( 1.1 ), noise2D( vec2( wx, wz ).mul( 7 ) ) ) );

	// Embankment and terrain steps: dressed sandstone blocks.
	const ashlar = mix( color( 0x8b8170 ), color( 0x9c927e ), hash2D( floor( vec2( wx.add( wz ).div( 0.9 ), positionWorld.y.div( 0.45 ) ) ) ) )
		.mul( float( 1 ).sub( max( gridLine( positionWorld.y, 0.45, 0.02 ), gridLine( wx.add( wz ), 0.9, 0.02 ) ).mul( 0.4 ) ) );

	let col = cobbles;
	col = mix( col, mix( asphaltCol, railCol, rail ), road );
	col = mix( col, mosaic, sidewalk );
	col = mix( col, kerbCol, kerb );
	col = mix( col, grass, park.mul( float( 1 ).sub( sidewalk ) ) );
	col = mix( col, ashlar, steep );

	// Soft contact shadow at the foot of the houses.
	col = col.mul( mix( float( 0.6 ), float( 1 ), smoothstep( 0.0, 0.9, buildingDist ) ) );
	mat.colorNode = col;
	mat.roughnessNode = mix( mix( float( 0.85 ), float( 0.55 ), rail.mul( road ) ), float( 1.0 ), park );

	mat.normalNode = Fn( () => {

		const relief = setDome.mul( 0.012 ).mul( setFade ).mul( float( 1 ).sub( sidewalk ).mul( float( 1 ).sub( road ) ) )
			.add( sidewalk.mul( 0.004 ).mul( float( 1 ).sub( mosJoint ) ).mul( mosFade ) );
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
