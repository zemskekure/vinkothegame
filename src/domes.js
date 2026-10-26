// Domes and towers out of the roofs (tools/domes.mjs): St Nicholas's dome on Malá Strana and its town belfry with the
// tall copper helmet, St Francis's dome on Křižovnické náměstí, Klementinum's Astronomical Tower with the Atlas on
// its cupola. Proportions of drum, cupola and lantern as on baroque domes, their heights from the surface model,
// the copper's colour from the aerial photo.

import * as THREE from 'three/webgpu';
import { Kit, plain, box, cyl } from './kit.js';

const D = {
	drum: plain( 0xe4dac3, { roughness: 0.9 } ),
	cornice: plain( 0xcfc4ab, { roughness: 0.9 } ),
	dark: plain( 0x1d1c1b, { roughness: 0.9 } ),
	gold: plain( 0xc9a046, { metalness: 0.9, roughness: 0.3 } ),
	lead: plain( 0x55595c, { roughness: 0.6, metalness: 0.3, flatShading: true } ),
	// Klementinum's tower is yellow (OSM building:colour), the belfry cream (#FFF4AC).
	astro: plain( 0xdcc27a, { roughness: 0.9 } ),
	belfry: plain( 0xeee3b8, { roughness: 0.9 } )
};
const copper = new Map();
const metal = hex => {

	if ( ! copper.has( hex ) ) copper.set( hex, plain( new THREE.Color( hex || '#5f8a78' ).getHex(), { roughness: 0.6, metalness: 0.25, flatShading: true } ) );
	return copper.get( hex );

};

const lathe = ( prof, seg = 16 ) => new THREE.LatheGeometry( prof.map( ( [ r, y ] ) => new THREE.Vector2( Math.max( 0.001, r ), y ) ), seg );

function addDome( kit, d ) {

	const H = d.top - d.base, r = d.r, roof = metal( d.colour );
	const drumH = H * 0.3, domeH = H * 0.42, lanternH = H * 0.16;
	// The drum with its windows and pilasters, a cornice on top.
	kit.add( D.drum, cyl( r, r, drumH, d.x, d.base - 2, d.z, 16 ) );
	for ( let k = 0; k < 8; k ++ ) {

		const a = k * Math.PI / 4;
		kit.add( D.dark, box( 1.1, drumH * 0.45, 0.2, 0, 0, r - 0.05 ).rotateY( a ).translate( d.x, d.base - 2 + drumH * 0.3, d.z ) );
		kit.add( D.cornice, box( 0.6, drumH, 0.4, 0, 0, r ).rotateY( a + Math.PI / 8 ).translate( d.x, d.base - 2, d.z ) );

	}

	kit.add( D.cornice, cyl( r + 0.5, r + 0.5, 0.6, d.x, d.base - 2 + drumH, d.z, 16 ) );
	// The cupola, ribbed by its flat facets, the lantern and the cross.
	const y0 = d.base - 2 + drumH + 0.6;
	kit.add( roof, lathe( [ [ r + 0.2, 0 ], [ r * 0.95, domeH * 0.35 ], [ r * 0.8, domeH * 0.62 ], [ r * 0.5, domeH * 0.88 ], [ r * 0.22, domeH ] ] ).translate( d.x, y0, d.z ) );
	const ly = y0 + domeH;
	kit.add( D.drum, cyl( r * 0.2, r * 0.2, lanternH * 0.55, d.x, ly, d.z, 8 ) );
	for ( let k = 0; k < 4; k ++ ) kit.add( D.dark, box( 0.35, lanternH * 0.3, 0.1, 0, 0, r * 0.2 ).rotateY( k * Math.PI / 2 ).translate( d.x, ly + lanternH * 0.12, d.z ) );
	kit.add( roof, lathe( [ [ r * 0.24, 0 ], [ r * 0.15, lanternH * 0.25 ], [ 0.08, lanternH * 0.45 ] ], 8 ).translate( d.x, ly + lanternH * 0.55, d.z ) );
	const cy = d.top - 1.4;
	kit.add( D.gold, box( 0.1, 1.4, 0.1, d.x, cy, d.z ), box( 0.7, 0.1, 0.1, d.x, cy + 0.9, d.z ), new THREE.SphereGeometry( 0.25, 8, 5 ).translate( d.x, cy, d.z ) );

}

// A rectangle round an outline (scene frame), its first long edge giving the turn.
function frame( ring ) {

	let best = null;
	for ( let i = 0; i < ring.length; i ++ ) {

		const a = ring[ i ], b = ring[ ( i + 1 ) % ring.length ], l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		if ( l < 1 ) continue;
		const ux = ( b[ 0 ] - a[ 0 ] ) / l, uz = ( b[ 1 ] - a[ 1 ] ) / l;
		const us = ring.map( ( [ x, z ] ) => x * ux + z * uz ), vs = ring.map( ( [ x, z ] ) => - x * uz + z * ux );
		const area = ( Math.max( ...us ) - Math.min( ...us ) ) * ( Math.max( ...vs ) - Math.min( ...vs ) );
		if ( ! best || area < best.area ) best = { area, ux, uz, us: [ Math.min( ...us ), Math.max( ...us ) ], vs: [ Math.min( ...vs ), Math.max( ...vs ) ] };

	}

	const cu = ( best.us[ 0 ] + best.us[ 1 ] ) / 2, cv = ( best.vs[ 0 ] + best.vs[ 1 ] ) / 2;
	return { x: cu * best.ux - cv * best.uz, z: cu * best.uz + cv * best.ux, ry: Math.atan2( - best.uz, best.ux ), w: best.us[ 1 ] - best.us[ 0 ], d: best.vs[ 1 ] - best.vs[ 0 ] };

}

function addBelfry( kit, t ) {

	const f = frame( t.ring ), roof = metal( t.colour ), base = t.ground - 0.5, H = t.top - t.eave;
	const put = ( m, g ) => kit.add( m, g.rotateY( f.ry ).translate( f.x, 0, f.z ) );
	put( D.belfry, box( f.w, t.eave - base, f.d, 0, base ) );
	// Cornices, and the belfry stage's tall arched openings.
	for ( const y of [ t.eave - 12, t.eave - 0.5 ] ) put( D.cornice, box( f.w + 0.5, 0.5, f.d + 0.5, 0, y ) );
	for ( const s of [ - 1, 1 ] ) {

		put( D.dark, box( 1.4, 4.5, 0.1, 0, t.eave - 7, s * ( f.d / 2 + 0.02 ) ) );
		put( D.dark, box( 0.1, 4.5, 1.4, s * ( f.w / 2 + 0.02 ), t.eave - 7, 0 ) );

	}

	// The helmet: a bell-shaped copper cap, the open lantern, a slender spire.
	const r = Math.min( f.w, f.d ) / 2;
	put( roof, lathe( [ [ r * 1.0, 0 ], [ r * 0.92, H * 0.12 ], [ r * 0.55, H * 0.3 ], [ r * 0.42, H * 0.36 ] ], 8 ).rotateY( Math.PI / 8 ).translate( 0, t.eave, 0 ) );
	put( D.belfry, cyl( r * 0.35, r * 0.35, H * 0.14, 0, t.eave + H * 0.36, 0, 8 ) );
	put( roof, lathe( [ [ r * 0.45, 0 ], [ r * 0.38, H * 0.08 ], [ r * 0.12, H * 0.25 ], [ 0.05, H * 0.47 ] ], 8 ).rotateY( Math.PI / 8 ).translate( 0, t.eave + H * 0.5, 0 ) );
	put( D.gold, new THREE.SphereGeometry( 0.25, 8, 5 ).translate( 0, t.top - 0.6, 0 ) );

}

function addAstro( kit, t ) {

	const body = t.top - 11, roof = metal( '#5f8a78' );
	kit.add( D.astro, box( t.w, body - t.ground, t.d, t.x, t.ground, t.z ) );
	kit.add( D.cornice, box( t.w + 0.5, 0.5, t.d + 0.5, t.x, body - 0.5, t.z ) );
	for ( const [ dx, dz, w, dd ] of [ [ 0, t.d / 2, 1.0, 0.1 ], [ 0, - t.d / 2, 1.0, 0.1 ], [ t.w / 2, 0, 0.1, 1.0 ], [ - t.w / 2, 0, 0.1, 1.0 ] ] ) kit.add( D.dark, box( w, 2.4, dd, t.x + dx, body - 4, t.z + dz ) );
	// The cupola, its lantern, and Atlas with the sky on his shoulders.
	const r = Math.min( t.w, t.d ) / 2;
	kit.add( roof, lathe( [ [ r, 0 ], [ r * 0.85, 2.0 ], [ r * 0.45, 3.6 ], [ r * 0.3, 4.2 ] ], 8 ).rotateY( Math.PI / 8 ).translate( t.x, body, t.z ) );
	kit.add( D.astro, cyl( r * 0.3, r * 0.3, 1.4, t.x, body + 4.2, t.z, 8 ) );
	kit.add( roof, new THREE.ConeGeometry( r * 0.38, 0.9, 8 ).translate( t.x, body + 6.05, t.z ) );
	const y = body + 6.5;
	kit.add( D.lead, cyl( 0.25, 0.35, 1.1, t.x, y, t.z, 6 ), cyl( 0.28, 0.22, 0.7, t.x, y + 1.1, t.z, 6 ), new THREE.IcosahedronGeometry( 0.18, 0 ).translate( t.x, y + 1.95, t.z + 0.1 ) );
	kit.add( D.lead, box( 0.14, 0.7, 0.14, t.x - 0.35, y + 1.6, t.z ), box( 0.14, 0.7, 0.14, t.x + 0.35, y + 1.6, t.z ) );
	kit.add( D.lead, new THREE.IcosahedronGeometry( 0.95, 1 ).translate( t.x, t.top - 0.95, t.z - 0.1 ) );

}

export function addDomes( scene, domes ) {

	if ( ! domes?.length ) return;
	const kit = new Kit();
	for ( const d of domes ) {

		if ( d.kind === 'dome' ) addDome( kit, d );
		else if ( d.kind === 'belfry' ) addBelfry( kit, d );
		else if ( d.kind === 'astro' ) addAstro( kit, d );

	}

	kit.build( scene );

}
