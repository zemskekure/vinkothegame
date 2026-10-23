// Shading helpers ported from Slop New York (js/tsl-materials.js):
// https://github.com/mrdoob/slop-newyork
//
// MIT License, Copyright (c) 2026 Mr.doob
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
//
// Changes: the interior mapping takes an explicit wall frame (tangent / normal) so it works on walls at any angle,
// not only on Manhattan's grid.

import {
	Fn, float, vec2, vec3, vec4, color, positionWorld, positionView, normalView, cameraPosition,
	sin, abs, floor, fract, min, max, clamp, mix, step, smoothstep, dot, length, normalize, sign, fwidth
} from 'three/tsl';

export const hash2D = Fn( ( [ p ] ) => {

	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ).mul( 43758.5453 ) );

} );

export const noise2D = Fn( ( [ p ] ) => {

	const pv = vec2( p ).toVar();
	const i = floor( pv ).toVar();
	const f = fract( pv ).toVar();
	const u = f.mul( f ).mul( float( 3.0 ).sub( f.mul( 2.0 ) ) ).toVar();
	const a = hash2D( i );
	const b = hash2D( i.add( vec2( 1.0, 0.0 ) ) );
	const c = hash2D( i.add( vec2( 0.0, 1.0 ) ) );
	const d = hash2D( i.add( vec2( 1.0, 1.0 ) ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );

} );

// Mikkelsen's surface-gradient bump mapping from hardware derivatives. Returns a view-space normal.
export const bumpNormal = Fn( ( [ height ] ) => {

	const h = float( height ).toVar();
	const dpdx = positionView.dFdx();
	const dpdy = positionView.dFdy();
	const r1 = dpdy.cross( normalView );
	const r2 = normalView.cross( dpdx );
	const det = dpdx.dot( r1 );
	const grad = det.sign().mul( h.dFdx().mul( r1 ).add( h.dFdy().mul( r2 ) ) );
	return det.abs().mul( normalView ).sub( grad ).normalize();

} );

// Filter-width antialiased band of half width `halfWidth` around 0.
export const lineAA = Fn( ( [ coord, halfWidth ] ) => {

	const c = float( coord ).toVar();
	const hw = float( halfWidth ).toVar();
	const aa = fwidth( c ).max( 0.0001 ).toVar();
	const effHw = max( hw, aa.mul( 0.5 ) ).toVar();
	const cov = smoothstep( effHw.add( aa ), effHw.sub( aa ), abs( c ) );
	return cov.mul( min( float( 1.0 ), hw.div( effHw ) ) );

} );

// Filter-width antialiased repeating grid line.
export const gridLine = Fn( ( [ coord, period, halfWidth ] ) => {

	const p = float( period ).toVar();
	const g = float( coord ).div( p ).toVar();
	const d = float( 0.5 ).sub( abs( fract( g ).sub( 0.5 ) ) ).toVar();
	const aa = fwidth( g ).max( 0.0001 ).toVar();
	const hw = float( halfWidth ).div( p ).toVar();
	const effHw = max( hw, aa.mul( 0.5 ) ).toVar();
	const cov = smoothstep( effHw.add( aa ), effHw.sub( aa ), d );
	return cov.mul( min( float( 1.0 ), hw.div( effHw ) ) );

} );

// Box-filtered periodic pulse: fraction of a footprint `w` wide around `x` where fract() lies in [a, b].
// Settles to the mean coverage (b - a) once a period shrinks below a pixel, so facade grids don't shimmer.
export const filteredPulse = Fn( ( [ x, a, b, w ] ) => {

	const p = float( x ).toVar();
	const lo = float( a ).toVar();
	const hi = float( b ).toVar();
	const hw = max( float( w ), 0.0001 ).mul( 0.5 ).toVar();
	const integral = t => floor( t ).mul( hi.sub( lo ) ).add( clamp( fract( t ), lo, hi ).sub( lo ) );
	return integral( p.add( hw ) ).sub( integral( p.sub( hw ) ) ).div( hw.mul( 2.0 ) );

} );

/**
 * Parallax room interior behind a window (after `interior()` in three/addons/generators/city/SkyscraperGenerator.js).
 * gridU: bay coordinate along the wall (bays), h: height above the building's ground (m), winUV: 0..1 inside the
 * opening, bayW / floorH: cell size (m), tangent / normal: the wall's reading direction and outward normal (world).
 * Returns vec4( roomColor, litEmit ).
 */
export const evaluateApartmentInterior = Fn( ( [ gridUNode, hNode, winUVNode, cellIdNode, bayWNode, floorHNode, seedNode, warmthNode, litProbNode, fwNode, tangent, normal ] ) => {

	const gridU = float( gridUNode ).toVar();
	const v = float( hNode ).toVar();
	const wUV = vec2( winUVNode ).toVar();
	const cid = vec2( cellIdNode ).toVar();
	const wW = float( bayWNode ).toVar();
	const fH = float( floorHNode ).toVar();

	// Each room spans 2 or 3 bays, with a per-floor phase so partitions land behind piers.
	const floorIdx = floor( v.div( fH ) ).toVar();
	const fHash1 = fract( sin( floorIdx.mul( 41.3 ).add( seedNode ) ).mul( 43758.5453 ) );
	const fHash2 = fract( sin( floorIdx.mul( 73.7 ).add( seedNode.mul( 1.7 ) ) ).mul( 43758.5453 ) );
	const roomBays = mix( float( 2.0 ), float( 3.0 ), step( 0.5, fHash1 ) ).toVar();
	const roomPhase = floor( fHash2.mul( roomBays ) ).toVar();

	const roomU = gridU.add( roomPhase ).div( roomBays ).toVar();
	const roomId = vec2( floor( roomU ), floorIdx ).toVar();

	const roomW = wW.mul( roomBays ).toVar();
	const roomH = fH.mul( 0.92 ).toVar();
	const setback = float( 0.12 );
	const depth = roomH.mul( 1.55 ).toVar();

	const originX = fract( roomU ).sub( 0.5 ).mul( roomW ).toVar();
	const originY = wUV.y.sub( 0.46 ).mul( roomH.mul( 0.62 ) ).toVar();

	const rayWorld = normalize( positionWorld.sub( cameraPosition ) ).toVar();
	const dirX = dot( rayWorld, tangent ).toVar();
	const dirY = rayWorld.y.toVar();
	const dirZ = max( abs( dot( rayWorld, normal ) ), 0.05 ).toVar();

	const halfW = roomW.mul( 0.5 ).toVar();
	const halfH = roomH.mul( 0.5 ).toVar();
	const tFarX = halfW.sub( originX.mul( sign( dirX ) ) ).div( max( abs( dirX ), 0.0001 ) ).toVar();
	const tFarY = halfH.sub( originY.mul( sign( dirY ) ) ).div( max( abs( dirY ), 0.0001 ) ).toVar();
	const tFarZ = setback.add( depth ).div( dirZ ).toVar();
	const t = min( min( tFarX, tFarY ), tFarZ ).toVar();
	const hit = vec3( originX.add( dirX.mul( t ) ), originY.add( dirY.mul( t ) ), dirZ.mul( t ) ).toVar();

	const q = clamp(
		vec3( hit.x.div( roomW ).add( 0.5 ), hit.y.div( roomH ).add( 0.5 ), hit.z.sub( setback ).div( depth ) ),
		vec3( 0.0 ), vec3( 1.0 )
	).toVar();

	const onBack = step( tFarZ, tFarX ).mul( step( tFarZ, tFarY ) ).toVar();
	const isYPlane = step( tFarY, tFarX ).mul( step( tFarY, tFarZ ) ).toVar();
	const onCeil = isYPlane.mul( step( 0.0, dirY ) ).toVar();
	const onFloor = isYPlane.mul( float( 1.0 ).sub( step( 0.0, dirY ) ) ).toVar();

	const seed1 = hash2D( roomId.add( vec2( seedNode, 19.4 ) ) ).toVar();
	const seed2 = hash2D( roomId.add( vec2( seedNode.mul( 1.9 ), 83.1 ) ) ).toVar();
	const seed3 = hash2D( roomId.add( vec2( 63.2, seedNode.mul( 0.7 ) ) ) ).toVar();
	const lod = smoothstep( 0.3, 0.8, max( fwNode.x, fwNode.y ) ).toVar();
	const litRoom = step( float( 1.0 ).sub( litProbNode ), seed3 ).toVar();
	const lit = mix( litRoom, 1.0, lod ).toVar();

	const warmLight = mix( color( 0xffb845 ), color( 0xffe49c ), seed1 );
	const coolLight = mix( color( 0xdfe8ff ), color( 0x9fb6ff ), seed2 );
	const lightCol = mix( coolLight, warmLight, step( float( 1.0 ).sub( warmthNode ), seed2 ) ).toVar();

	const wallBase = mix( mix( color( 0x9a8b73 ), color( 0x6f7a82 ), seed1 ), color( 0xb9ad97 ), seed2.mul( 0.6 ) ).toVar();
	const wallCol = mix( wallBase, wallBase.mul( 0.5 ), smoothstep( 0.06, 0.04, q.y ) ).toVar();

	const seam = step( 0.92, fract( q.x.mul( 7.0 ) ) );
	const boards = mix( color( 0x4a3320 ), color( 0x6a4c30 ), seed1 ).mul( float( 1.0 ).sub( seam.mul( 0.3 ) ) );
	const rug = mix( color( 0x7a3b32 ), color( 0x3a5760 ), seed2 );
	const inRug = step( abs( q.x.sub( 0.5 ) ), 0.28 ).mul( step( abs( q.z.sub( 0.58 ) ), 0.25 ) );
	const floorCol = mix( boards, rug, inRug.mul( 0.88 ) ).toVar();

	const lamp = smoothstep( 0.18, 0.11, length( vec2( q.x.sub( 0.5 ), q.z.sub( 0.5 ) ) ) ).mul( float( 1.0 ).sub( lod ) );
	const ceilBase = mix( wallBase, color( 0xe8e2d5 ), 0.28 );
	const ceilCol = mix( ceilBase, lightCol.mul( mix( float( 0.85 ), float( 3.8 ), lit ) ), lamp ).toVar();

	const doorX = mix( float( 0.24 ), float( 0.76 ), seed1 );
	const doorCol = mix( color( 0x5a4631 ), color( 0x39383c ), step( 0.5, seed2 ) );
	const inDoor = step( abs( q.x.sub( doorX ) ), 0.09 ).mul( step( abs( q.y.sub( 0.34 ) ), 0.34 ) );
	const picX = mix( float( 0.72 ), float( 0.28 ), step( 0.5, seed1 ) );
	const inPicFrame = step( abs( q.x.sub( picX ) ), 0.085 ).mul( step( abs( q.y.sub( 0.56 ) ), 0.095 ) );
	const inPicCanvas = step( abs( q.x.sub( picX ) ), 0.065 ).mul( step( abs( q.y.sub( 0.56 ) ), 0.075 ) );
	const picCol = mix( color( 0x2c3a4a ), color( 0x7a5a3a ), fract( seed1.add( seed2 ) ) );
	const backCol = mix( mix( mix( wallCol, doorCol, inDoor ), color( 0x141210 ), inPicFrame ), picCol, inPicCanvas ).toVar();

	const shellCol = mix( mix( mix( wallCol, floorCol, onFloor ), ceilCol, onCeil ), backCol, onBack ).toVar();

	const aoX = smoothstep( 0.0, 0.16, q.x ).mul( smoothstep( 0.0, 0.16, float( 1.0 ).sub( q.x ) ) ).toVar();
	const aoY = smoothstep( 0.0, 0.16, q.y ).mul( smoothstep( 0.0, 0.16, float( 1.0 ).sub( q.y ) ) ).toVar();
	const aoZ = smoothstep( 0.0, 0.16, q.z ).mul( smoothstep( 0.0, 0.16, float( 1.0 ).sub( q.z ) ) ).toVar();
	const edgeAO = mix( mix( aoY.mul( aoZ ), aoX.mul( aoZ ), isYPlane ), aoX.mul( aoY ), onBack );
	const shadedRoom = shellCol.mul( mix( float( 0.66 ), float( 1.0 ), edgeAO ) ).mul( mix( float( 1.0 ), float( 0.42 ), q.z ) ).toVar();

	// Curtains just inside the glass.
	const cUVx = clamp( wUV.x.add( dirX.div( dirZ ).mul( 0.06 ) ), 0.0, 1.0 ).toVar();
	const wSeed1 = hash2D( cid.add( vec2( seedNode.mul( 0.8 ), 41.2 ) ) ).toVar();
	const wSeed2 = hash2D( cid.add( vec2( 17.9, seedNode.mul( 1.3 ) ) ) ).toVar();
	const sL = smoothstep( 0.18, 1.0, wSeed1 );
	const sR = smoothstep( 0.18, 1.0, wSeed2 );
	const lw = sL.mul( sL ).mul( 0.48 );
	const rw = sR.mul( sR ).mul( 0.48 );
	const cFw = fwidth( cUVx ).toVar();
	const drapeAA = cFw.add( 0.015 ).toVar();
	const inLeftDrape = smoothstep( lw.add( drapeAA ), lw.sub( drapeAA ), cUVx ).mul( step( 0.03, lw ) );
	const inRightDrape = smoothstep( float( 1.0 ).sub( rw ).sub( drapeAA ), float( 1.0 ).sub( rw ).add( drapeAA ), cUVx ).mul( step( 0.03, rw ) );
	const inDrape = mix( clamp( max( inLeftDrape, inRightDrape ), 0.0, 1.0 ), 0.29, lod ).toVar();

	const pick = fract( seed1.mul( 5.7 ) ).mul( 5.0 );
	const fabric = mix(
		mix( mix( mix( mix( color( 0xcabfa6 ), color( 0xd8cdb8 ), seed2 ), mix( color( 0x8a7a64 ), color( 0x9b8c72 ), seed2 ), step( 1.0, pick ) ),
			mix( color( 0x5f7079 ), color( 0x6f818b ), seed2 ), step( 2.0, pick ) ), mix( color( 0x6c7558 ), color( 0x79835f ), seed2 ), step( 3.0, pick ) ),
		mix( color( 0x8c5a44 ), color( 0x9a6a52 ), seed2 ), step( 4.0, pick ) );
	const pleatWave = sin( cUVx.mul( 48.0 ).add( wSeed1.mul( 6.28 ) ) ).mul( float( 1.0 ).sub( smoothstep( 0.6, 1.6, cFw.mul( 48.0 ) ) ) );
	const drapeCol = fabric.mul( pleatWave.mul( 0.205 ).add( 0.945 ) ).mul( 0.92 ).toVar();

	const bestCol = mix( shadedRoom, drapeCol, inDrape );
	const bestEmit = mix( float( 1.0 ), float( 0.20 ), inDrape );
	const roomWarmth = mix( vec3( 1.0 ), lightCol, lit.mul( 0.85 ) );
	const finalRoomCol = bestCol.mul( roomWarmth ).mul( mix( float( 0.85 ), float( 1.35 ), lit ) );

	return vec4( finalRoomCol, mix( litRoom, litProbNode, lod ).mul( bestEmit ) );

} );
