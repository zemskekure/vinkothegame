// The National Theatre node (tools/terraces.mjs, tools/theatre.mjs), the parts below the terrain's surface and the
// stonework on it:
//   - the road tunnel under Národní: asphalt, a raised pavement on its east side, rendered walls, a flat ceiling,
//     lamps; it runs out under the open cells at both mouths;
//   - the pavement along Divadelní under the piazzetta's cantilever: the street's edge, the paved walk, the soffit
//     with its lamps (the back wall and the parapet are drawn with the railings, tools/build-scene.mjs);
//   - the granite flight from Národní down to Divadelní and the stone balustrades (plinth, turned balusters,
//     handrail) on it and over the tunnel mouths (owner's photos 2022/2023, Street View 2025);
//   - Nová scéna's open undercroft: the paved floor and the steps up from Národní, the soffit of the glass-block mass
//     with downlights, the two stone-clad blocks, the lobby's glass wall (Street View 2019).

import * as THREE from 'three/webgpu';
import { Kit, M, plain, glow, box, cyl } from './kit.js';

const F = {
	road: plain( 0x3d3e40, { roughness: 0.85 } ),
	paving: plain( 0x8e8a83, { roughness: 0.85 } ),
	granite: plain( 0xa8a39a, { roughness: 0.8 } ),
	render: plain( 0x8f897d, { roughness: 0.9 } ), // the tunnel's walls, grey stone cladding (photo 2022)
	soffit: plain( 0x6d6a64, { roughness: 0.85 } ),
	sandstone: plain( 0xd6cdb8, { roughness: 0.85 } ),
	clad: plain( 0x9b958a, { roughness: 0.7 } ),
	dark: plain( 0x2c2c2b, { roughness: 0.7 } ),
	glass: new THREE.MeshStandardNodeMaterial( { color: 0x2b3438, roughness: 0.08, metalness: 0.5 } ),
	warm: glow( 0xf6e2b8, 0.8 ),
	lamp: glow( 0xfff0d0, 1.6 )
};

// A box between two points on the ground plane (a, b: [x, z]), w wide, from y0 to y1.
function slab( kit, mat, a, b, w, y0, y1 ) {

	const len = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
	const g = new THREE.BoxGeometry( w, y1 - y0, len ).translate( 0, ( y0 + y1 ) / 2, 0 );
	g.rotateY( Math.atan2( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) );
	g.translate( ( a[ 0 ] + b[ 0 ] ) / 2, 0, ( a[ 1 ] + b[ 1 ] ) / 2 );
	kit.add( mat, g );

}

// --- the tunnel under Národní, along z
function addTunnel( kit, T ) {

	const ext = 0, y = z => T.ya + ( T.yb - T.ya ) * Math.max( 0, Math.min( 1, ( z - T.zN ) / ( T.zS - T.zN ) ) );
	const PAVE = 1.8;
	for ( let z = T.zN - ext; z < T.zS + ext - 1e-6; z += 1 ) {

		const z1 = Math.min( z + 1, T.zS + ext ), ya = y( z ), yb = y( z1 ), ym = Math.max( ya, yb );
		slab( kit, F.road, [ ( T.xW + T.xE - PAVE ) / 2, z ], [ ( T.xW + T.xE - PAVE ) / 2, z1 ], T.xE - PAVE - T.xW + 0.6, ym - 0.6, ( ya + yb ) / 2 + 0.01 );
		slab( kit, F.paving, [ T.xE - PAVE / 2 + 0.15, z ], [ T.xE - PAVE / 2 + 0.15, z1 ], PAVE + 0.3, ym - 0.6, ( ya + yb ) / 2 + 0.13 );

	}

	for ( const x of [ T.xW, T.xE ] ) slab( kit, F.render, [ x + ( x === T.xW ? - 0.15 : 0.15 ), T.zN - 0.05 ], [ x + ( x === T.xW ? - 0.15 : 0.15 ), T.zS + 0.05 ], 0.3, Math.min( T.ya, T.yb ) - 0.5, T.ceil + 0.2 );
	slab( kit, F.render, [ ( T.xW + T.xE ) / 2, T.zN ], [ ( T.xW + T.xE ) / 2, T.zS ], T.xE - T.xW + 0.6, T.ceil, T.ceil + 0.25 );
	for ( let z = T.zN + 3; z < T.zS - 1; z += 5 ) kit.add( F.lamp, box( 0.6, 0.06, 0.2, ( T.xW + T.xE ) / 2, T.ceil - 0.06, z ) );

}

// A ribbon between rows of [ x0, x1, y, z ] (z increasing): faces up (or down with `down`).
function ribbon( kit, mat, rows, down = false ) {

	const pos = [];
	for ( let i = 1; i < rows.length; i ++ ) {

		const [ a0, a1, ay, az ] = rows[ i - 1 ], [ b0, b1, by, bz ] = rows[ i ];
		const A = [ a0, ay, az ], B = [ b0, by, bz ], C = [ b1, by, bz ], E = [ a1, ay, az ];
		if ( down ) pos.push( ...A, ...C, ...B, ...A, ...E, ...C );
		else pos.push( ...A, ...B, ...C, ...A, ...C, ...E );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.computeVertexNormals();
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( pos.length / 3 * 2 ), 2 ) );
	kit.add( mat, g );

}

// A vertical face along rows of [ x, y0, y1, z ], facing −x (towards the street).
function wallFace( kit, mat, rows ) {

	const pos = [];
	for ( let i = 1; i < rows.length; i ++ ) {

		const [ ax, a0, a1, az ] = rows[ i - 1 ], [ bx, b0, b1, bz ] = rows[ i ];
		pos.push( ax, a0, az, bx, b0, bz, bx, b1, bz, ax, a0, az, bx, b1, bz, ax, a1, az );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.computeVertexNormals();
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( pos.length / 3 * 2 ), 2 ) );
	kit.add( mat, g );

}

// --- the covered pavement under the piazzetta's cantilever: the paved walk with its granite kerb, the soffit
function addCovered( kit, rows, coverEnd ) {

	const cov = rows.filter( r => r.z <= coverEnd + 1e-6 );
	// The walk's width changes where the back wall steps back: split the ribbons there.
	const runs = [];
	for ( const r of cov ) {

		const last = runs[ runs.length - 1 ];
		if ( ! last || Math.abs( last[ last.length - 1 ].back - r.back ) > 0.01 ) {

			if ( last ) last.push( { ...r, back: last[ last.length - 1 ].back } ); // close the run on this row
			runs.push( [ r ] );

		} else last.push( r );

	}

	for ( const run of runs ) {

		ribbon( kit, F.paving, run.map( r => [ r.edge - 0.3, r.back, r.floor + 0.12, r.z ] ) );
		wallFace( kit, F.granite, run.map( r => [ r.edge - 0.3, r.floor - 0.05, r.floor + 0.12, r.z ] ) );
		ribbon( kit, F.soffit, run.map( r => [ r.edge, r.back, r.soffit, r.z ] ), true );

	}

	// Lamps in the soffit; the cantilever's end over the street where the office building begins.
	for ( const r of cov ) if ( Math.round( r.z ) % 4 === 0 ) kit.add( F.lamp, box( 0.5, 0.04, 0.2, ( r.edge + r.back ) / 2 + 0.3, r.soffit - 0.04, r.z ) );
	const e = cov[ cov.length - 1 ];
	kit.add( F.render, box( e.back - e.edge + 0.2, e.deck - e.soffit, 0.3, ( e.edge + e.back ) / 2, e.soffit, e.z - 0.15 ) );

}

// --- a stone balustrade from a to b ([ x, y, z ], y the floor it stands on): plinth, balusters, handrail
function addBalustrade( kit, { a, b, stair } ) {

	const [ ax, ay, az ] = a, [ bx, by, bz ] = b;
	const len = Math.hypot( bx - ax, bz - az ), H = 1.05, PLINTH = 0.22, RAIL = 0.16;
	const along = [ ( bx - ax ) / len, ( bz - az ) / len ];
	const yAt = s => ay + ( by - ay ) * s / len;
	// Plinth and handrail in pieces (following the slope on the stair).
	const n = Math.max( 1, Math.ceil( len / ( stair ? 0.6 : 4 ) ) );
	for ( let k = 0; k < n; k ++ ) {

		const s0 = len * k / n, s1 = len * ( k + 1 ) / n, y0 = Math.max( yAt( s0 ), yAt( s1 ) );
		const p0 = [ ax + along[ 0 ] * s0, az + along[ 1 ] * s0 ], p1 = [ ax + along[ 0 ] * s1, az + along[ 1 ] * s1 ];
		slab( kit, F.sandstone, p0, p1, 0.5, Math.min( yAt( s0 ), yAt( s1 ) ) - ( stair ? 0.5 : 0.2 ), y0 + PLINTH );
		slab( kit, F.sandstone, p0, p1, 0.42, y0 + H - RAIL, y0 + H );

	}

	// Turned balusters (a vase on a square foot) every 0.3 m; square pedestals every 3 m and at the ends.
	for ( let s = 0.25; s < len - 0.1; s += 0.3 ) {

		const x = ax + along[ 0 ] * s, z = az + along[ 1 ] * s, y = yAt( s ) + PLINTH;
		const h = H - RAIL - PLINTH;
		kit.add( F.sandstone, new THREE.CylinderGeometry( 0.06, 0.09, h * 0.55, 8 ).translate( x, y + h * 0.275, z ), new THREE.CylinderGeometry( 0.09, 0.05, h * 0.45, 8 ).translate( x, y + h * 0.775, z ) );

	}

	for ( let s = 0; s <= len + 1e-6; s += len / Math.max( 1, Math.round( len / 3 ) ) ) {

		const x = ax + along[ 0 ] * s, z = az + along[ 1 ] * s, y = yAt( s );
		kit.add( F.sandstone, box( 0.5, H + 0.32, 0.5, x, y - 0.2, z ) );

	}

}

// --- the flight from Národní's north pavement down to Divadelní: solid granite steps, an iron handrail on the wall
function addStairs( kit, S ) {

	const [ bx, by, bz ] = S.bottom, [ tx, ty, tz ] = S.top;
	const len = Math.hypot( tx - bx, tz - bz ), drop = ty - by, N = S.steps;
	const g = new THREE.Group();
	g.position.set( bx, by, bz );
	g.rotation.y = Math.atan2( tx - bx, tz - bz );
	g.updateMatrix();
	const local = new Kit();
	for ( let k = 1; k <= N; k ++ ) {

		const s0 = len * ( k - 1 ) / N, s1 = k === N ? len + 0.55 : len * k / N;
		local.add( F.granite, box( S.w, drop * k / N + 0.3, s1 - s0 + 0.02, 0, - 0.3, ( s0 + s1 ) / 2 ) );

	}

	// A landing at the foot, the wall-side handrail.
	local.add( F.granite, box( S.w, 0.32, 0.9, 0, - 0.3, - 0.45 ) );
	const slope = Math.atan2( drop, len ), sl = Math.hypot( len, drop );
	local.add( M.iron, new THREE.CylinderGeometry( 0.025, 0.025, sl, 8 ).rotateX( Math.PI / 2 - slope ).translate( S.w / 2 - 0.08, drop / 2 + 0.9, len / 2 ) );
	for ( let s = 1; s < len; s += 2.4 ) local.add( M.iron, cyl( 0.015, 0.015, 0.12, S.w / 2 - 0.05, drop * s / len + 0.8, s, 6 ) );
	for ( const [ mat, list ] of local.parts ) for ( const geo of list ) kit.add( mat, geo.applyMatrix4( g.matrix ) );

}

// --- Nová scéna's undercroft
function clipX( ring, xMax ) {

	// The part of a polygon west of x = xMax (Sutherland–Hodgman against one half-plane).
	const out = [];
	for ( let i = 0; i < ring.length; i ++ ) {

		const p = ring[ i ], q = ring[ ( i + 1 ) % ring.length ];
		const pin = p[ 0 ] <= xMax, qin = q[ 0 ] <= xMax;
		if ( pin ) out.push( p );
		if ( pin !== qin ) {

			const t = ( xMax - p[ 0 ] ) / ( q[ 0 ] - p[ 0 ] );
			out.push( [ xMax, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * t ] );

		}

	}

	return out;

}

function addUndercroft( kit, U ) {

	const ring = clipX( U.ring, U.lobby );
	const shape = new THREE.Shape( ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
	// The soffit of the glass-block mass, a dark fascia round its edge.
	kit.add( F.soffit, new THREE.ExtrudeGeometry( shape, { depth: 0.6, bevelEnabled: false } ).rotateX( - Math.PI / 2 ).translate( 0, U.soffit, 0 ) );
	// The floor at the square's level behind the steps.
	const zf = Math.max( ...U.front.map( p => p[ 1 ] ) ) + U.strip;
	const floorRing = clipX( ring.map( ( [ x, z ] ) => [ - z, x ] ), - zf ).map( ( [ a, b ] ) => [ b, - a ] ); // the part south of the steps
	const floor = new THREE.Shape( floorRing.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
	kit.add( F.paving, new THREE.ExtrudeGeometry( floor, { depth: 0.5, bevelEnabled: false } ).rotateX( - Math.PI / 2 ).translate( 0, U.level - 0.48, 0 ) );
	// The steps up from Národní, just inside the street face.
	const [ [ x0, z0 ], [ x1, z1 ] ] = U.front;
	const fl = Math.hypot( x1 - x0, z1 - z0 ), fu = [ ( x1 - x0 ) / fl, ( z1 - z0 ) / fl ], fn = [ - fu[ 1 ], fu[ 0 ] ];
	// Treads where the walking heights step up (src/main.js zoneHeight): the zone runs from `out` m in front of the
	// face to `strip` m inside it.
	for ( let k = 1; k <= U.steps; k ++ ) {

		const d0 = k * ( U.strip + U.out ) / ( U.steps + 1 ) - U.out, y = U.foot + ( U.level - U.foot ) * k / U.steps;
		const mid = ( d0 + U.strip + 0.3 ) / 2, half = ( U.strip + 0.3 - d0 ) / 2;
		const c = [ ( x0 + x1 ) / 2 + fn[ 0 ] * mid, ( z0 + z1 ) / 2 + fn[ 1 ] * mid ];
		slab( kit, F.granite, [ c[ 0 ] - fu[ 0 ] * ( fl / 2 + 2 ), c[ 1 ] - fu[ 1 ] * ( fl / 2 + 2 ) ], [ c[ 0 ] + fu[ 0 ] * ( fl / 2 + 2 ), c[ 1 ] + fu[ 1 ] * ( fl / 2 + 2 ) ], half * 2, U.foot - 0.4, y );

	}

	// The two stone-clad blocks, glazed on their sides to the square.
	for ( const [ a0, b0, a1, b1 ] of U.blocks ) {

		kit.add( F.clad, box( a1 - a0, U.soffit - U.level + 0.05, b1 - b0, ( a0 + a1 ) / 2, U.level - 0.05, ( b0 + b1 ) / 2 ) );
		kit.add( F.warm, box( ( a1 - a0 ) * 0.7, 2.4, 0.06, ( a0 + a1 ) / 2, U.level + 0.2, b1 + 0.02 ) );

	}

	// The lobby's glass wall closing the open floor to the east.
	const zs = ring.filter( p => Math.abs( p[ 0 ] - U.lobby ) < 0.01 ).map( p => p[ 1 ] );
	if ( zs.length >= 2 ) {

		const za = Math.min( ...zs ), zb = Math.max( ...zs );
		kit.add( F.glass, box( 0.12, U.soffit - U.level, zb - za, U.lobby, U.level, ( za + zb ) / 2 ) );
		for ( let z = za; z <= zb; z += 2.5 ) kit.add( F.dark, box( 0.16, U.soffit - U.level, 0.1, U.lobby, U.level, z ) );

	}

	// Downlights in the soffit.
	const xs = ring.map( p => p[ 0 ] ), zsr = ring.map( p => p[ 1 ] );
	for ( let x = Math.min( ...xs ) + 3; x < U.lobby - 1; x += 5 ) for ( let z = Math.min( ...zsr ) + 3; z < Math.max( ...zsr ) - 1; z += 5 ) {

		if ( U.blocks.some( ( [ a0, b0, a1, b1 ] ) => x > a0 - 0.5 && x < a1 + 0.5 && z > b0 - 0.5 && z < b1 + 0.5 ) ) continue;
		kit.add( F.lamp, cyl( 0.18, 0.18, 0.04, x, U.soffit - 0.04, z, 10 ) );

	}

}

export function addTheatre( scene, T ) {

	const kit = new Kit();
	addTunnel( kit, T.tunnel );
	addCovered( kit, T.rows, T.coverEnd );
	if ( T.stairs ) addStairs( kit, T.stairs );
	for ( const b of T.balustrades ) addBalustrade( kit, b );
	if ( T.undercroft ) addUndercroft( kit, T.undercroft );
	kit.build( scene );

}
