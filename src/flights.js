// Stairs and the underpass at Čapadlo (tools/places.mjs): the stone steps down a trench beside the Faculty of
// Social Sciences, the underpass under Smetanovo nábřeží out to the riverside terrace, and the steel stair from
// the terrace up to the pavement. Tread heights match the walking heights in src/main.js (zoneHeight).

import * as THREE from 'three/webgpu';
import { Kit, M, plain, glow, box, cyl, ashlar, tiles } from './kit.js';

const F = {
	granite: tiles( 0xa8a39a, 0x9d978d, 0.6 ),
	wall: ashlar( 0xa49b8a, 0xb6ad9b ),
	steel: plain( 0x4c5357, { metalness: 0.6, roughness: 0.45 } ),
	plaster: plain( 0xd9d4ca, { roughness: 0.9, side: THREE.DoubleSide } ),
	floor: plain( 0x6f6c66, { roughness: 0.9 } ),
	road: plain( 0x3f4042, { roughness: 0.85 } ),
	lamp: glow( 0xfff0d0, 1.6 )
};

// A group at the bottom of a flight, local +z up the stairs.
function flightGroup( f ) {

	const [ bx, by, bz ] = f.bottom, [ tx, , tz ] = f.top;
	const g = new THREE.Group();
	g.position.set( bx, by, bz );
	g.rotation.y = Math.atan2( tx - bx, tz - bz );
	return g;

}

function rail( kit, x, y0, z0, y1, z1, h = 0.95 ) {

	const len = Math.hypot( z1 - z0, y1 - y0 ), slope = Math.atan2( y1 - y0, z1 - z0 );
	kit.add( M.iron, new THREE.CylinderGeometry( 0.025, 0.025, len, 8 ).rotateX( Math.PI / 2 - slope ).translate( x, ( y0 + y1 ) / 2 + h, ( z0 + z1 ) / 2 ) );
	for ( let s = 0; s <= 1.001; s += 1 / Math.max( 1, Math.round( len / 1.6 ) ) ) kit.add( M.iron, cyl( 0.02, 0.02, h, x, y0 + ( y1 - y0 ) * s, z0 + ( z1 - z0 ) * s, 6 ) );

}

// Stone steps in a trench: treads between walls that stay at street level, an iron railing along their tops.
function addTrench( scene, f ) {

	const g = flightGroup( f );
	const kit = new Kit();
	const [ bx, , bz ] = f.bottom, [ tx, ty, tz ] = f.top;
	const len = Math.hypot( tx - bx, tz - bz ), drop = ty - f.bottom[ 1 ], N = f.steps, w = f.w;
	for ( let k = 1; k <= N; k ++ ) {

		const s0 = len * ( k - 1 ) / N, s1 = k === N ? len + 0.3 : len * k / N;
		const y = drop * k / N;
		kit.add( F.granite, box( w, y + 0.6, s1 - s0 + 0.02, 0, - 0.6, ( s0 + s1 ) / 2 ) );

	}

	kit.add( F.granite, box( w, 0.6, 1.2, 0, - 0.6, - 0.6 ) ); // foot of the steps, at the underpass's floor
	for ( const side of [ - 1, 1 ] ) {

		kit.add( F.wall, box( 0.4, drop + 0.8, len + 1.4, side * ( w / 2 + 0.2 ), - 0.6, len / 2 - 0.5 ) );
		kit.add( F.wall, box( 0.5, 0.12, len + 1.4, side * ( w / 2 + 0.2 ), drop + 0.2, len / 2 - 0.5 ) );
		rail( kit, side * ( w / 2 + 0.2 ), drop + 0.32, - 1.2, drop + 0.32, len + 0.2 );
		rail( kit, side * ( w / 2 - 0.12 ), 0, 0, drop, len, 0.9 ); // handrail along the treads

	}

	kit.build( g );
	scene.add( g );

}

// Open granite steps across a square's edge, no walls or railings (the piazzetta from Národní). Each step is a solid
// block down to well below the pavement, so no gap shows under a sagging survey surface.
function addOpen( scene, f ) {

	const g = flightGroup( f );
	const kit = new Kit();
	const [ bx, , bz ] = f.bottom, [ tx, ty, tz ] = f.top;
	const len = Math.hypot( tx - bx, tz - bz ), drop = ty - f.bottom[ 1 ], N = f.steps;
	for ( let k = 1; k <= N; k ++ ) {

		const s0 = len * ( k - 1 ) / N, s1 = k === N ? len + 0.3 : len * k / N;
		kit.add( F.granite, box( f.w, drop * k / N + 1.2, s1 - s0 + 0.02, 0, - 1.2, ( s0 + s1 ) / 2 ) );

	}

	kit.build( g );
	scene.add( g );

}

// Steel stair along the wall: open treads on two stringers, handrails, a landing out to the pavement, posts.
function addMetal( scene, f ) {

	const g = flightGroup( f );
	const kit = new Kit();
	const [ bx, , bz ] = f.bottom, [ tx, ty, tz ] = f.top;
	const len = Math.hypot( tx - bx, tz - bz ), drop = ty - f.bottom[ 1 ], N = f.steps, w = f.w;
	for ( let k = 1; k <= N; k ++ ) kit.add( F.steel, box( w, 0.04, len / N + 0.05, 0, drop * k / N - 0.04, len * ( k - 0.5 ) / N ) );
	const slope = Math.atan2( drop, len ), sl = Math.hypot( len, drop );
	for ( const side of [ - 1, 1 ] ) {

		kit.add( F.steel, new THREE.BoxGeometry( 0.06, 0.25, sl ).rotateX( - slope ).translate( side * ( w / 2 + 0.03 ), drop / 2 - 0.1, len / 2 ) );
		rail( kit, side * ( w / 2 + 0.03 ), 0, 0, drop, len );

	}

	for ( let s = len * 0.35; s < len; s += len * 0.35 ) kit.add( F.steel, box( 0.12, drop * s / len, 0.12, 0, 0, s ) );
	kit.build( g );
	scene.add( g );

	// Landing from the top of the flight to the pavement.
	if ( f.landing ) {

		const [ lx, ly, lz ] = f.landing;
		const L = Math.hypot( lx - tx, lz - tz );
		const h = new THREE.Group();
		h.position.set( tx, ly, tz );
		h.rotation.y = Math.atan2( lx - tx, lz - tz );
		const k2 = new Kit();
		k2.add( F.steel, box( 1.6, 0.06, L + 0.8, 0, - 0.06, L / 2 ) );
		for ( const side of [ - 1, 1 ] ) rail( k2, side * 0.8, 0, - 0.4, 0, L - 0.6 );
		k2.build( h );
		scene.add( h );

	}

}

// Underpass: floor, plastered walls and vault, lamps; stone portals at both mouths.
function addTunnel( scene, t ) {

	const [ ax, az ] = t.a, [ bx, bz ] = t.b;
	const len = Math.hypot( bx - ax, bz - az );
	const g = new THREE.Group();
	g.position.set( ax, t.ya, az );
	g.rotation.order = 'YXZ';
	g.rotation.y = Math.atan2( bx - ax, bz - az );
	g.rotation.x = - Math.atan2( t.yb - t.ya, len ); // sloping with the road
	const kit = new Kit();
	const W = t.w / 2, H = t.h;
	kit.add( t.road ? F.road : F.floor, box( t.w, 0.1, len + 0.6, 0, - 0.08, len / 2 ) );
	for ( const side of [ - 1, 1 ] ) kit.add( F.plaster, box( 0.2, t.road ? H : H - W, len + 0.6, side * ( W + 0.1 ), 0, len / 2 ) );
	if ( t.road ) kit.add( F.plaster, box( t.w + 0.4, 0.2, len + 0.6, 0, H, len / 2 ) );
	for ( let s = 3; s < len; s += 5 ) kit.add( F.lamp, box( 0.5, 0.05, 0.18, 0, H - 0.05, s ) );
	// Portals: a road tunnel's square stone frames; a footway's round-arched stone mouths (Čapadlo, after street
	// photos): a stone face with a semicircular opening at each end.
	for ( const s of [ 0, len ] ) {

		if ( t.road ) {

			for ( const side of [ - 1, 1 ] ) kit.add( F.wall, box( 0.35, H + 0.4, 0.5, side * ( W + 0.18 ), - 0.1, s ) );
			kit.add( F.wall, box( t.w + 0.7, 0.45, 0.5, 0, H, s ) );
			continue;

		}

		const R = W, spring = H - R, F0 = W + 0.8, top = H + 0.8;
		const face = new THREE.Shape().moveTo( - F0, - 0.1 ).lineTo( F0, - 0.1 ).lineTo( F0, top ).lineTo( - F0, top ).closePath();
		const hole = new THREE.Path().moveTo( - R, - 0.1 ).lineTo( - R, spring ).absarc( 0, spring, R, Math.PI, 0, true ).lineTo( R, - 0.1 ).closePath();
		face.holes.push( hole );
		kit.add( F.wall, new THREE.ExtrudeGeometry( face, { depth: 0.6, bevelEnabled: false, curveSegments: 16 } ).translate( 0, 0, s - 0.3 ) );
		// The vault inside follows the arch.
		const vault = new THREE.CylinderGeometry( R, R, len, 16, 1, true, - Math.PI / 2, Math.PI ).rotateX( Math.PI / 2 ).translate( 0, spring, len / 2 );
		if ( s === 0 ) kit.add( F.plaster, vault );

	}

	if ( ! t.road ) kit.add( F.wall, box( t.w + 0.8, 3.2, 0.6, 0, H + 0.4, - 0.3 ) );
	kit.build( g );
	scene.add( g );

}

export function addFlights( scene, flights = [], tunnels = [] ) {

	for ( const f of flights ) ( f.kind === 'metal' ? addMetal : f.kind === 'open' ? addOpen : addTrench )( scene, f );
	for ( const t of tunnels ) addTunnel( scene, t );

}
