// Arcades (podloubí) and passages through houses, from tools/openings.mjs via tools/places.mjs. The house walls
// are already left out below their ceilings; this builds the inside: paved floor, barrel vault and plastered
// sides for a passage with an arched stone portal at each end; for an arcade, square stone piers along the street
// with segmental arches between them, a vaulted ceiling with transverse arches and shopfronts on the back wall.

import * as THREE from 'three/webgpu';
import { color, positionLocal, mix, float, vec2, floor, fract, abs, max, smoothstep, step } from 'three/tsl';
import { Kit, ashlar, glow, plain } from './kit.js';
import { hash2D } from './shading/common.js';

// Paving: small granite setts in rows.
function setts() {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.9, side: THREE.DoubleSide } );
	const p = positionLocal;
	const row = floor( p.z.div( 0.14 ) );
	const along = p.x.div( 0.16 ).add( hash2D( vec2( row, 2.1 ) ) );
	const cell = vec2( floor( along ), row );
	const joint = max( smoothstep( 0.4, 0.5, abs( fract( along ).sub( 0.5 ) ) ), smoothstep( 0.38, 0.5, abs( fract( p.z.div( 0.14 ) ).sub( 0.5 ) ) ) );
	m.colorNode = mix( mix( color( 0x8d877d ), color( 0xa59e92 ), hash2D( cell ) ), color( 0x55524c ), joint.mul( 0.7 ) );
	return m;

}

// Back wall of an arcade: plaster with a shop window and door in every bay (bay = `bay` m, along local x).
function shopWall( bay ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.6, side: THREE.DoubleSide } );
	const p = positionLocal;
	const u = fract( p.x.div( bay ) );
	const glass = smoothstep( 0.12, 0.14, u ).mul( smoothstep( 0.88, 0.86, u ) ).mul( step( 0.45, p.y ) ).mul( step( p.y, 2.75 ) );
	const mullion = smoothstep( 0.012, 0.0, abs( u.sub( 0.62 ) ) ).mul( glass );
	const frame = smoothstep( 0.1, 0.12, u ).mul( smoothstep( 0.9, 0.88, u ) ).mul( step( 0.35, p.y ) ).mul( step( p.y, 2.85 ) ).sub( glass ).max( 0 );
	const shade = hash2D( vec2( floor( p.x.div( bay ) ), 4.2 ) );
	const window = mix( color( 0x2b3a40 ), color( 0x6d6047 ), shade.mul( 0.5 ) );
	m.colorNode = mix( mix( mix( color( 0xe4dccb ), color( 0x3a3833 ), frame ), window, glass ), color( 0x2a2722 ), mullion );
	m.emissiveNode = color( 0xffd49a ).mul( glass.mul( shade.mul( 0.35 ).add( 0.08 ) ) );
	return m;

}

const M = {
	floor: setts(),
	vault: plain( 0xeee6d6, { roughness: 0.95, side: THREE.DoubleSide } ),
	side: plain( 0xe2d9c6, { roughness: 0.9, side: THREE.DoubleSide } ),
	stone: ashlar( 0xb9b09e, 0xcfc6b3 ),
	plinth: plain( 0x8f8a80, { roughness: 0.9, side: THREE.DoubleSide } ),
	lamp: glow( 0xffdcaa, 1.8 ),
	// Under the modern theatre buildings: dark stone-clad walls and a dark ceiling.
	modernSide: plain( 0x3a3936, { roughness: 0.6, side: THREE.DoubleSide } ),
	modernCeiling: plain( 0x242424, { roughness: 0.8, side: THREE.DoubleSide } ),
	step: plain( 0x9e9a92, { roughness: 0.85, side: THREE.DoubleSide } )
};

// A quad from four corners (counter-clockwise seen from the front).
function quad( a, b, c, d ) {

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( [ ...a, ...b, ...c, ...a, ...c, ...d ], 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1 ], 2 ) );
	g.computeVertexNormals();
	return g;

}

// An arch-topped opening in a wall of thickness `t` (local x across, y up, z through): the solid part above a
// segmental arch springing at `spring` and rising `rise` over a span from x0 to x1, up to `top`.
function spandrel( x0, x1, spring, rise, top, t, z0 ) {

	const span = x1 - x0, r = ( span * span / 4 + rise * rise ) / ( 2 * rise ), cx = ( x0 + x1 ) / 2, cy = spring + rise - r;
	const s = new THREE.Shape().moveTo( x0, spring );
	const a0 = Math.atan2( spring - cy, x0 - cx ), a1 = Math.atan2( spring - cy, x1 - cx );
	for ( let k = 1; k <= 12; k ++ ) {

		const a = a0 + ( a1 - a0 ) * k / 12;
		s.lineTo( cx + r * Math.cos( a ), cy + r * Math.sin( a ) );

	}

	s.lineTo( x1, top ).lineTo( x0, top ).lineTo( x0, spring );
	return new THREE.ExtrudeGeometry( s, { depth: t, bevelEnabled: false, curveSegments: 1 } ).translate( 0, 0, z0 );

}

// Frame: x along the opening, y up, z across (passage) or out to the street (arcade).
// All openings go into one kit (one mesh per material); each piece is moved from its opening's frame into place.
class FramedKit {

	constructor( kit, o, across ) {

		this.kit = kit;
		this.m = new THREE.Matrix4().makeBasis( new THREE.Vector3( o.lx, 0, o.lz ), new THREE.Vector3( 0, 1, 0 ), across ).setPosition( o.x, 0, o.z );

	}

	add( material, ...geometries ) {

		this.kit.add( material, ...geometries.map( g => g.applyMatrix4( this.m ) ) );
		return this;

	}

}

function addPassage( shared, o ) {

	const kit = new FramedKit( shared, o, new THREE.Vector3( - o.lz, 0, o.lx ) );
	const L = o.len / 2, W = o.w / 2;
	const y = x => o.y0 + ( o.y1 - o.y0 ) * ( x / o.len + 0.5 );
	const spring = Math.min( o.h - 0.5, 2.6 ), rise = o.h - spring;

	kit.add( M.floor, quad( [ - L - 0.3, y( - L - 0.3 ) + 0.02, W ], [ L + 0.3, y( L + 0.3 ) + 0.02, W ], [ L + 0.3, y( L + 0.3 ) + 0.02, - W ], [ - L - 0.3, y( - L - 0.3 ) + 0.02, - W ] ) );
	for ( const s of [ - 1, 1 ] ) {

		// Plastered side walls with a stone plinth, facing into the passage.
		const z = - s * W;
		const corners = [ [ - L, y( - L ) - 0.2, z ], [ L, y( L ) - 0.2, z ], [ L, y( L ) + spring, z ], [ - L, y( - L ) + spring, z ] ];
		kit.add( o.modern ? M.modernSide : M.side, quad( ...corners.map( ( [ px, py, pz ], i ) => [ px, i < 2 ? py : ( o.modern ? py - spring + o.h : py ), pz ] ) ) );
		kit.add( M.plinth, quad( ...corners.map( ( [ px, py, pz ], i ) => [ px, i < 2 ? py : py - spring + 0.65, pz - s * 0.04 ] ) ) );

	}

	// Under a modern building: a flat dark ceiling and no portals, just the cut in the front.
	if ( o.modern ) {

		kit.add( M.modernCeiling, quad( [ - L, y( - L ) + o.h, W ], [ L, y( L ) + o.h, W ], [ L, y( L ) + o.h, - W ], [ - L, y( - L ) + o.h, - W ] ) );
		kit.add( M.lamp, new THREE.SphereGeometry( 0.12, 10, 6 ).translate( 0, y( 0 ) + o.h - 0.2, 0 ) );
		return;

	}

	// Barrel vault (segmental), in 10 strips across.
	const r = ( W * W + rise * rise ) / ( 2 * rise ), cy = spring + rise - r, a0 = Math.atan2( spring - cy, - W ), a1 = Math.atan2( spring - cy, W );
	for ( let k = 0; k < 10; k ++ ) {

		const p = t => { const a = a0 + ( a1 - a0 ) * t; return [ r * Math.cos( a ), cy + r * Math.sin( a ) ]; };
		const [ za, ya ] = p( k / 10 ), [ zb, yb ] = p( ( k + 1 ) / 10 );
		kit.add( M.vault, quad( [ - L, y( - L ) + ya, za ], [ L, y( L ) + ya, za ], [ L, y( L ) + yb, zb ], [ - L, y( - L ) + yb, zb ] ) );

	}

	// Stone portals: an arch-shaped solid filling the house front's rectangular cut down to the vault, at both ends.
	for ( const s of [ - 1, 1 ] ) {

		const x = s * L, base = y( x );
		const portal = spandrel( - W - 0.05, W + 0.05, base + spring, rise, base + o.h + 0.15, 0.5, - 0.25 ).rotateY( Math.PI / 2 ).translate( x, 0, 0 );
		kit.add( M.stone, portal );

	}

	kit.add( M.lamp, new THREE.SphereGeometry( 0.12, 10, 6 ).translate( 0, y( 0 ) + o.h - 0.35, 0 ) );

}

// Nová scéna's undercroft: granite steps up just inside the street face, a level floor behind, dark stone-clad back
// wall and ends, a dark ceiling under the building.
function addUndercroft( shared, o ) {

	const X = new THREE.Vector3( o.nz, 0, - o.nx );
	const kit = new FramedKit( shared, { ...o, lx: X.x, lz: X.z }, new THREE.Vector3( o.nx, 0, o.nz ) );
	const L = o.len / 2, D = o.depth, top = o.y0, N = o.steps, S = o.strip;
	for ( let k = 1; k <= N; k ++ ) {

		const y = o.foot + ( top - o.foot ) * k / N, base = o.foot - 1.2;
		kit.add( M.step, new THREE.BoxGeometry( 2 * L, y - base, S / N + 0.02 ).translate( 0, ( y + base ) / 2, - ( k - 0.5 ) * S / N ) );

	}

	kit.add( M.step, quad( [ - L, top, - S ], [ L, top, - S ], [ L, top, - D ], [ - L, top, - D ] ) );
	kit.add( M.modernSide, quad( [ - L, top - 0.2, - D ], [ L, top - 0.2, - D ], [ L, top + o.h, - D ], [ - L, top + o.h, - D ] ) );
	kit.add( M.modernCeiling, quad( [ - L, top + o.h, - D ], [ L, top + o.h, - D ], [ L, top + o.h, 0.3 ], [ - L, top + o.h, 0.3 ] ) );
	for ( const s of [ - 1, 1 ] ) kit.add( M.modernSide, quad( [ s * L, o.foot - 0.2, 0 ], [ s * L, o.foot - 0.2, - D ], [ s * L, top + o.h, - D ], [ s * L, top + o.h, 0 ] ) );
	for ( let k = 1; k < 4; k ++ ) kit.add( M.lamp, new THREE.SphereGeometry( 0.14, 10, 6 ).translate( - L + k * L / 2, top + o.h - 0.2, - D / 2 ) );

}

function addArcade( scene, shared, o, others ) {

	if ( o.undercroft ) return addUndercroft( shared, o );

	// Frame: z out to the street, x along the street front (x × y = z).
	const X = new THREE.Vector3( o.nz, 0, - o.nx );
	const kit = new FramedKit( shared, { ...o, lx: X.x, lz: X.z }, new THREE.Vector3( o.nx, 0, o.nz ) );
	const sgn = X.x * o.lx + X.z * o.lz; // ±1: frame x along or against the opening's direction
	const L = o.len / 2, D = o.depth;
	const y = x => o.y0 + ( o.y1 - o.y0 ) * ( sgn * x / o.len + 0.5 );
	const bays = Math.max( 1, Math.round( o.len / 3.8 ) ), bay = o.len / bays;
	const pier = 0.62, spring = Math.min( o.h - 1.0, 2.9 ), rise = o.h - 0.25 - spring;

	kit.add( M.floor, quad( [ - L, y( - L ) + 0.02, 0.4 ], [ L, y( L ) + 0.02, 0.4 ], [ L, y( L ) + 0.02, - D ], [ - L, y( - L ) + 0.02, - D ] ) );
	// Back wall with shopfronts, facing the street (its own mesh: the shop pattern runs in the arcade's frame).
	const back = new THREE.Mesh( quad( [ - L, y( - L ) - 0.2, - D ], [ L, y( L ) - 0.2, - D ], [ L, y( L ) + o.h + 0.1, - D ], [ - L, y( - L ) + o.h + 0.1, - D ] ), shopWall( bay ) );
	back.matrixAutoUpdate = false;
	back.matrix.copy( kit.m );
	back.receiveShadow = true;
	scene.add( back );
	kit.add( M.vault, quad( [ - L, y( - L ) + o.h, - D ], [ L, y( L ) + o.h, - D ], [ L, y( L ) + o.h, 0 ], [ - L, y( - L ) + o.h, 0 ] ) );

	// Piers on the street front (the end ones flush with the arcade's ends), pilasters on the back wall.
	const piers = [];
	for ( let k = 0; k <= bays; k ++ ) piers.push( - L + k * bay + ( k === 0 ? pier / 2 : k === bays ? - pier / 2 : 0 ) );
	piers.forEach( ( x, k ) => {

		const base = y( x );
		kit.add( M.stone, new THREE.BoxGeometry( pier, spring + 0.2, pier ).translate( x, base - 0.2 + ( spring + 0.2 ) / 2, - pier / 2 ) );
		kit.add( M.plinth, new THREE.BoxGeometry( 0.4, spring, 0.18 ).translate( x, base + spring / 2, - D + 0.09 ) );
		// Transverse arch across the arcade from pier to pilaster.
		if ( k > 0 && k < bays ) kit.add( M.vault, spandrel( - D, 0, base + spring, Math.min( rise, D / 2 ), base + o.h + 0.01, 0.35, - 0.175 ).rotateY( - Math.PI / 2 ).translate( x, 0, 0 ) );
		if ( k === bays ) return;
		// Segmental arch between this pier and the next, filling up to the ceiling; a lamp in the bay.
		const x0 = x + pier / 2, x1 = piers[ k + 1 ] - pier / 2, b = ( base + y( piers[ k + 1 ] ) ) / 2;
		kit.add( M.stone, spandrel( x0, x1, b + spring, Math.min( rise, ( x1 - x0 ) / 2 ), b + o.h + 0.2, pier, - pier ) );
		kit.add( M.lamp, new THREE.SphereGeometry( 0.11, 10, 6 ).translate( ( x0 + x1 ) / 2, b + o.h - 0.45, - D / 2 ) );

	} );

	// End walls where the arcade does not carry on into the next stretch.
	for ( const s of [ - 1, 1 ] ) {

		const px = o.x + X.x * s * ( L + 0.6 ) - o.nx * D / 2, pz = o.z + X.z * s * ( L + 0.6 ) - o.nz * D / 2;
		if ( others.some( q => q !== o && inArcade( q, px, pz ) ) ) continue;
		const x = s * L;
		kit.add( M.side, quad( [ x, y( x ) - 0.2, 0 ], [ x, y( x ) - 0.2, - D ], [ x, y( x ) + o.h, - D ], [ x, y( x ) + o.h, 0 ] ) );

	}

}

function inArcade( o, x, z ) {

	const dx = x - o.x, dz = z - o.z;
	const a = dx * o.lx + dz * o.lz, n = dx * o.nx + dz * o.nz;
	return Math.abs( a ) < o.len / 2 + 0.3 && n < 0.5 && n > - o.depth - 0.5;

}

export function addOpenings( scene, openings = [] ) {

	if ( ! openings.length ) return;
	const kit = new Kit();
	const arcades = openings.filter( o => o.kind === 'arcade' );
	for ( const o of openings ) {

		if ( o.kind === 'passage' ) addPassage( kit, o );
		else addArcade( scene, kit, o, arcades );

	}

	kit.build( scene );

}
