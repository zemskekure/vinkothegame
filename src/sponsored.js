// Sponsored venues (data/venues.json → tools/venues.mjs → places.interiors with `shell`): the room is built from
// data, a vaulted shell with real openings, then furnished by a layout preset (LAYOUTS) and, if the venue has one,
// its own furnishing function (FURNISH, keyed by `style`). How to add the next one: docs/venues.md.
//
// Everything inside is placed in the room's frame (src/kit.js onFront): x along the room, z out through its front
// wall (the room lies at z from −d to 0). The presets think in two distances instead: `a` along the room from the
// door's end and `c` across it from the front wall, so the same layout works whichever end the door is at.

import * as THREE from 'three/webgpu';
import { Kit, M, plain, glow, box, cyl, ball, planks } from './kit.js';

// Room surfaces lit from within (a warm glow instead of point lights, which every surface would pay for).
const lit = ( m, k = 0.35 ) => {

	m.emissive = new THREE.Color( m.color ).multiplyScalar( k );
	return m;

};

const canvasTexture = ( draw, w, h ) => {

	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	draw( canvas.getContext( '2d' ), w, h );
	const t = new THREE.CanvasTexture( canvas );
	t.colorSpace = THREE.SRGBColorSpace;
	return t;

};

let seed = 11;
const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;

// One material per colour, shared across the venue (the kit merges by material: few draw calls).
const mats = new Map();
const mat = ( hex, opts = {} ) => {

	const key = `${hex}|${JSON.stringify( opts )}`;
	if ( ! mats.has( key ) ) mats.set( key, plain( hex, { flatShading: true, ...opts } ) );
	return mats.get( key );

};

const litMat = ( hex, k = 0.3, opts ) => {

	const key = `lit${hex}|${k}`;
	if ( ! mats.has( key ) ) mats.set( key, lit( plain( hex, { flatShading: true, ...opts } ), k ) );
	return mats.get( key );

};

// ---------------------------------------------------------------------------
// The brand mark, drawn: the Bjukitchen "B·j·u" from half and quarter discs (owner photos 2026-10, the shop window).

export function bjuMark( ctx, x, y, r, colour = '#e8483c' ) {

	ctx.fillStyle = colour;
	for ( const cy of [ y + r, y + 3 * r ] ) {

		ctx.beginPath();
		ctx.arc( x, cy, r, - Math.PI / 2, Math.PI / 2 );
		ctx.fill();

	}

	ctx.beginPath();
	ctx.moveTo( x + 1.1 * r, y + 3 * r );
	ctx.arc( x + 1.1 * r, y + 3 * r, r, 0, Math.PI / 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.arc( x + 3.45 * r, y + 3 * r, 1.08 * r, 0, Math.PI );
	ctx.fill();

}

// ---------------------------------------------------------------------------
// The shell: floor, walls with openings and reveals out to the house front, a barrel vault along the room.

function vaultProfile( room ) {

	const { d, h } = room, spring = room.spring ?? h - 1.05;
	return c => {

		const t = Math.min( 1, Math.abs( c - d / 2 ) / ( d / 2 ) );
		return spring + ( h - spring ) * Math.pow( 1 - t * t, 0.55 );

	};

}

function shell( kit, room, P ) {

	const { poly, d } = room;
	const vaultY = vaultProfile( room );
	const wall = litMat( P.wall || '#f2efe8', 0.2 );
	const t = 0.12;

	// The floor: planks along the room.
	const floor = lit( planks( ...( P.floor || [ '#7d776d', '#5d5850' ] ) ), 0.1 );
	kit.add( floor, new THREE.ShapeGeometry( new THREE.Shape( poly.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) ) ).rotateX( - Math.PI / 2 ).translate( 0, 0.002, 0 ) );

	// Walls: an outline up to the vault (straight along the sides, the vault's curve at the ends), the openings cut
	// out, reveals out to the house front around each one.
	const cx = poly.reduce( ( s, p ) => s + p[ 0 ], 0 ) / 4, cz = poly.reduce( ( s, p ) => s + p[ 1 ], 0 ) / 4;
	for ( const w of room.walls ) {

		let a = w.a, b = w.b, openings = w.openings;
		let dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
		const len = Math.hypot( dx, dz );
		dx /= len;
		dz /= len;
		// Build in the wall's own frame (u along it, y up, out through it), right-handed: swap ends if needed.
		if ( ( - dz ) * ( ( a[ 0 ] + b[ 0 ] ) / 2 - cx ) + dx * ( ( a[ 1 ] + b[ 1 ] ) / 2 - cz ) < 0 ) {

			[ a, b ] = [ b, a ];
			dx = - dx;
			dz = - dz;
			openings = openings.map( ( [ u0, u1, ...rest ] ) => [ len - u1, len - u0, ...rest ] );

		}

		const top = u => vaultY( - ( a[ 1 ] + dz * u ) ) + 0.05;
		const outline = new THREE.Shape().moveTo( 0, 0 ).lineTo( len, 0 );
		for ( let k = 12; k >= 0; k -- ) outline.lineTo( len * k / 12, top( len * k / 12 ) );
		for ( const [ u0, u1, y0, y1 ] of openings ) outline.holes.push( new THREE.Path().moveTo( u0, Math.max( 0.001, y0 ) ).lineTo( u1, Math.max( 0.001, y0 ) ).lineTo( u1, y1 ).lineTo( u0, y1 ).closePath() );
		const m = new THREE.Matrix4().makeBasis( new THREE.Vector3( dx, 0, dz ), new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( - dz, 0, dx ) ).setPosition( a[ 0 ], 0, a[ 1 ] );
		kit.add( wall, new THREE.ExtrudeGeometry( outline, { depth: t, bevelEnabled: false, curveSegments: 4 } ).applyMatrix4( m ) );
		for ( const [ u0, u1, y0, y1, depth ] of openings ) {

			const D = depth + 0.05, parts = [ box( 0.05, y1 - y0, D, u0 - 0.025, y0, D / 2 ), box( 0.05, y1 - y0, D, u1 + 0.025, y0, D / 2 ), box( u1 - u0 + 0.1, 0.05, D, ( u0 + u1 ) / 2, y1, D / 2 ) ];
			if ( y0 > 0.05 ) parts.push( box( u1 - u0 + 0.1, 0.05, D, ( u0 + u1 ) / 2, y0 - 0.05, D / 2 ) );
			kit.add( wall, ...parts.map( g => g.applyMatrix4( m ) ) );

		}

	}

	// The vault: one strip across the room from end to end (it only curves across), the ends following the walls.
	const n = 14, pos = [], idx = [];
	const endX = ( k, z ) => {

		const [ p, q ] = k ? [ poly[ 1 ], poly[ 2 ] ] : [ poly[ 0 ], poly[ 3 ] ];
		return p[ 0 ] + ( z - p[ 1 ] ) * ( q[ 0 ] - p[ 0 ] ) / ( q[ 1 ] - p[ 1 ] );

	};
	for ( let i = 0; i <= n; i ++ ) {

		const c = d * i / n, z = - c;
		pos.push( endX( 0, z ), vaultY( c ), z, endX( 1, z ), vaultY( c ), z );
		if ( i ) idx.push( 2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1 );

	}

	const vault = new THREE.BufferGeometry();
	vault.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	vault.setIndex( idx );
	vault.computeVertexNormals();
	kit.add( litMat( P.vault || P.wall || '#f2efe8', 0.16, { side: THREE.DoubleSide } ), vault );
	return vaultY;

}

// A wall across the room at x (thickness `t`), up to the vault, with an arched opening from c0 to c1.
function crossWall( kit, material, room, vaultY, x, t, c0, c1, spring, rise ) {

	const { d } = room;
	const s = new THREE.Shape().moveTo( 0, 0 ).lineTo( d, 0 );
	for ( let k = 14; k >= 0; k -- ) s.lineTo( d * k / 14, vaultY( d * k / 14 ) );
	const hole = new THREE.Path().moveTo( c0, 0 ).lineTo( c1, 0 ).lineTo( c1, spring );
	for ( let k = 1; k < 12; k ++ ) {

		const f = k / 12, cc = c1 + ( c0 - c1 ) * f;
		hole.lineTo( cc, spring + rise * Math.sqrt( 1 - Math.pow( 2 * f - 1, 2 ) ) );

	}

	hole.lineTo( c0, spring ).closePath();
	s.holes.push( hole );
	// Shape (c, y) extruded along +z, turned so c runs to −z and the extrusion along x.
	kit.add( material, new THREE.ExtrudeGeometry( s, { depth: t, bevelEnabled: false, curveSegments: 4 } ).applyMatrix4( new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, 0, - 1 ), new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 1, 0, 0 ) ) ).translate( x - t / 2, 0, 0 ) );

}

// A transverse rib under the vault at x: a band 0.14 m deep following its curve, on shallow pilasters.
function rib( kit, material, room, vaultY, x, w = 0.3 ) {

	const { d } = room;
	const s = new THREE.Shape().moveTo( 0, 0 ).lineTo( 0.1, 0 );
	for ( let k = 0; k <= 14; k ++ ) s.lineTo( Math.min( d - 0.1, Math.max( 0.1, d * k / 14 ) ), vaultY( d * k / 14 ) - 0.14 );
	s.lineTo( d - 0.1, 0 ).lineTo( d, 0 );
	for ( let k = 14; k >= 0; k -- ) s.lineTo( d * k / 14, vaultY( d * k / 14 ) + 0.02 );
	kit.add( material, new THREE.ExtrudeGeometry( s, { depth: w, bevelEnabled: false } ).applyMatrix4( new THREE.Matrix4().makeBasis( new THREE.Vector3( 0, 0, - 1 ), new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 1, 0, 0 ) ) ).translate( x - w / 2, 0, 0 ) );

}

// ---------------------------------------------------------------------------
// Furniture (built facing +z, the back towards −z, then turned: rot 0 faces the room's front wall).

const place = ( kit, parts, x, y, z, rot ) => {

	for ( const [ m, g ] of parts ) kit.add( m, g.rotateY( rot ).translate( x, y, z ) );

};

function chair( kind, colour ) {

	const m = mat( colour, { roughness: kind === 'wood' ? 0.7 : 0.45 } );
	const p = [];
	const leg = kind === 'wood' ? 0.035 : 0.018;
	for ( const a of [ - 0.18, 0.18 ] ) for ( const b of [ - 0.18, 0.18 ] ) p.push( [ m, box( leg, 0.45, leg, a, 0, b ) ] );
	p.push( [ m, box( 0.44, 0.04, 0.44, 0, 0.45, 0 ) ] );
	for ( const a of [ - 0.18, 0.18 ] ) p.push( [ m, box( leg, 0.42, leg, a, 0.47, - 0.19 ) ] );
	p.push( [ m, box( 0.42, kind === 'wood' ? 0.16 : 0.24, 0.03, 0, kind === 'wood' ? 0.7 : 0.64, - 0.2 ) ] );
	return p;

}

// The outdoor café chair: thin olive metal frame, quilted seat and back cushions (owner photos 2026-10).
function gardenChair( colour ) {

	const frame = mat( colour, { roughness: 0.5, metalness: 0.3 } ), cushion = mat( new THREE.Color( colour ).multiplyScalar( 1.12 ).getHex(), { roughness: 0.95 } );
	const p = [];
	for ( const a of [ - 0.26, 0.26 ] ) {

		p.push( [ frame, box( 0.02, 0.42, 0.02, a, 0, 0.22 ) ], [ frame, new THREE.BoxGeometry( 0.02, 0.85, 0.02 ).rotateX( - 0.22 ).translate( a, 0.42, - 0.24 ) ] );

	}

	for ( let k = 0; k < 3; k ++ ) p.push( [ cushion, box( 0.54, 0.09, 0.17, 0, 0.36, 0.17 - k * 0.18 ) ] );
	for ( let k = 0; k < 3; k ++ ) p.push( [ cushion, new THREE.BoxGeometry( 0.54, 0.17, 0.09 ).rotateX( - 0.22 ).translate( 0, 0.55 + k * 0.17, - 0.3 - k * 0.04 ) ] );
	return p;

}

export function addGardenTerrace( kit, terrace, seats ) {

	const colour = terrace.colour || '#5d6b4b';
	const top = mat( colour, { roughness: 0.45, metalness: 0.25 } );
	for ( const [ x, y, z, rot ] of terrace.tables ) {

		kit.add( top, cyl( 0.4, 0.4, 0.025, x, y + 0.72, z, 18 ), cyl( 0.025, 0.025, 0.72, x, y, z, 6 ), cyl( 0.24, 0.26, 0.03, x, y, z, 12 ) );
		kit.add( glow( 0xf2e6cf, 0.1 ), cyl( 0.03, 0.025, 0.1, x + 0.1, y + 0.745, z - 0.05, 8 ) );
		kit.add( mat( 0xe8792c ), ball( 0.04, x - 0.08, y + 0.78, z + 0.06, 6 ) ); // a little pumpkin on each table
		for ( const k of [ 0, 1, 2 ] ) {

			const a = rot + Math.PI / 2 + k * Math.PI * 2 / 3, cx = x + Math.sin( a ) * 0.68, cz = z + Math.cos( a ) * 0.68;
			place( kit, gardenChair( colour ), cx, y, cz, a + Math.PI );
			seats.push( [ + cx.toFixed( 2 ), y, + cz.toFixed( 2 ), + Math.atan2( Math.sin( a ), Math.cos( a ) ).toFixed( 3 ) ] );

		}

	}

}

// Grey pots of herbs and flowers by the door, and pumpkins on the pavement (October, owner photos 2026-10).
export function addDoorstep( kit, outside ) {

	const pot = mat( 0xb9bab4, { roughness: 0.9 } ), leaves = [ mat( 0x4f7a3a ), mat( 0x6e9a48 ), mat( 0x3e6634 ) ], pumpkin = mat( 0xe0761f, { roughness: 0.7 } );
	for ( const [ kind, x, y, z ] of outside ) {

		if ( kind === 'plants' ) {

			kit.add( pot, cyl( 0.2, 0.15, 0.32, x, y, z, 10 ) );
			for ( let k = 0; k < 5; k ++ ) kit.add( leaves[ k % 3 ], new THREE.IcosahedronGeometry( 0.17 + rnd() * 0.08, 0 ).translate( x + ( rnd() - 0.5 ) * 0.25, y + 0.42 + rnd() * 0.3, z + ( rnd() - 0.5 ) * 0.25 ) );

		} else {

			kit.add( pumpkin, new THREE.SphereGeometry( 0.16 + rnd() * 0.06, 9, 6 ).scale( 1, 0.75, 1 ).translate( x, y + 0.12, z ) );
			kit.add( leaves[ 2 ], cyl( 0.015, 0.02, 0.06, x, y + 0.22, z, 5 ) );

		}

	}

}

// A glass-door drinks fridge face: rows of bottles and cans behind the glass, lit.
const fridgeFace = () => canvasTexture( ( c, w, h ) => {

	seed = 5;
	c.fillStyle = '#dfe9ee';
	c.fillRect( 0, 0, w, h );
	const cols = [ '#e9b23a', '#d8452f', '#f0f0ea', '#6aa04a', '#2c4f8a', '#f2d24a', '#9a3f6c' ];
	for ( let r = 0; r < 4; r ++ ) {

		const y = 8 + r * h / 4;
		c.fillStyle = '#b8c3c8';
		c.fillRect( 0, y + h / 4 - 12, w, 3 );
		for ( let x = 4; x < w - 8; x += 9 ) {

			c.fillStyle = cols[ Math.floor( rnd() * cols.length ) ];
			const bh = h / 4 - 22 - rnd() * 10;
			c.fillRect( x, y + h / 4 - 12 - bh, 7, bh );

		}

	}

	c.strokeStyle = '#8f9a9f';
	c.lineWidth = 4;
	c.strokeRect( 2, 2, w / 2 - 3, h - 4 );
	c.strokeRect( w / 2 + 1, 2, w / 2 - 3, h - 4 );

}, 128, 96 );

// ---------------------------------------------------------------------------
// Layout presets. longCafe: a long vaulted room entered at one end. The front part is the café's counter (rounded
// end towards the windows, drinks fridges facing the room), the coffee bar along the end wall and the open kitchen
// along the back wall; through an arch, the seating: an upholstered bench under the windows with tables and chairs,
// tubular shelving along the back wall, a few tables in the accent colour at the far end, a door to the toilets.
// Colours from the venue's palette; the venue's own function adds what is particular to it.

function longCafe( kit, room, P, seat, vaultY ) {

	const { poly, d } = room;
	const dir = room.end === 'right' ? - 1 : 1;
	const endAt = c => {

		const [ p, q ] = dir > 0 ? [ poly[ 0 ], poly[ 3 ] ] : [ poly[ 1 ], poly[ 2 ] ];
		return p[ 0 ] + ( - c - p[ 1 ] ) * ( q[ 0 ] - p[ 0 ] ) / ( q[ 1 ] - p[ 1 ] );

	};
	const farAt = c => {

		const [ p, q ] = dir > 0 ? [ poly[ 1 ], poly[ 2 ] ] : [ poly[ 0 ], poly[ 3 ] ];
		return p[ 0 ] + ( - c - p[ 1 ] ) * ( q[ 0 ] - p[ 0 ] ) / ( q[ 1 ] - p[ 1 ] );

	};
	const x0 = endAt( d / 2 );
	const X = ( a, c ) => ( c === undefined ? x0 : endAt( c ) ) + dir * a; // along from the door end (at depth c: from that end's wall)
	const length = Math.abs( farAt( d / 2 ) - x0 );
	const R = dir > 0 ? 0 : Math.PI; // turns a piece built along +x to run along the room
	const L = room.layoutAt = { hall: P.hall ?? 8.0, arch: 0.4 };

	const cream = mat( P.counter || '#e7d9a1', { roughness: 0.6 } ), top = mat( P.top || '#dcc6a0', { roughness: 0.5 } );
	const steel = mat( 0xc2c4c3, { metalness: 0.05, roughness: 0.4 } ), dark = mat( 0x2a2c2e, { roughness: 0.5 } );
	const white = mat( 0xf2f0ea, { roughness: 0.6 } );

	// --- the counter: across the room, its rounded end towards the windows, drinks fridges facing the seating.
	const ca = L.hall - 4.0, cc0 = 1.75, cc1 = Math.min( d - 2.3, 4.4 ), cw = 0.72;
	const xc = X( ca );
	kit.add( cream, box( cw, 0.98, cc1 - cc0, xc, 0, - ( cc0 + cc1 ) / 2 ), new THREE.CylinderGeometry( cw / 2, cw / 2, 0.98, 14, 1, false, Math.PI / 2, Math.PI ).translate( xc, 0.49, - cc0 ) );
	kit.add( top, box( cw + 0.1, 0.045, cc1 - cc0 + 0.05, xc, 0.98, - ( cc0 + cc1 ) / 2 ), new THREE.CylinderGeometry( cw / 2 + 0.05, cw / 2 + 0.05, 0.045, 14, 1, false, Math.PI / 2, Math.PI ).translate( xc, 1.0, - cc0 ) );
	const fridge = lit( new THREE.MeshStandardNodeMaterial( { map: fridgeFace(), roughness: 0.2 } ), 0.6 );
	kit.add( fridge, new THREE.PlaneGeometry( 1.3, 0.72 ).rotateY( dir * Math.PI / 2 ).translate( xc + dir * ( cw / 2 + 0.005 ), 0.5, - ( cc0 + 0.95 ) ) );
	kit.add( steel, box( 0.02, 0.12, 1.32, xc + dir * ( cw / 2 + 0.01 ), 0.02, - ( cc0 + 0.95 ) ) );
	// On top: the till and card terminal, pastries on boards, a cake stand.
	kit.add( dark, box( 0.3, 0.03, 0.22, xc - dir * 0.1, 1.03, - ( cc1 - 0.5 ) ), new THREE.BoxGeometry( 0.32, 0.22, 0.02 ).rotateZ( dir * 0.35 ).translate( xc - dir * 0.05, 1.2, - ( cc1 - 0.5 ) ) );
	const pastry = mat( 0xb9773a, { roughness: 0.7 } ), board = mat( 0xa8794b );
	for ( const k of [ 0, 1 ] ) {

		const zc = - ( cc0 + 0.45 + k * 0.6 );
		kit.add( board, box( 0.34, 0.02, 0.5, xc, 1.025, zc ) );
		for ( let j = 0; j < 6; j ++ ) kit.add( pastry, new THREE.SphereGeometry( 0.05, 7, 4 ).scale( 1.3, 0.5, 1 ).translate( xc - 0.08 + ( j % 2 ) * 0.16, 1.06, zc - 0.17 + Math.floor( j / 2 ) * 0.17 ) );

	}

	// --- the coffee bar along the end wall: cream cabinets, a steel top, the machine and grinders; crates above.
	const b0 = Math.max( 2.2, ( room.door?.c1 ?? 1.8 ) + 0.4 ), b1 = d - 2.2;
	for ( let c = b0; c < b1 - 0.1; c += 0.62 ) {

		const cl = Math.min( 0.6, b1 - c );
		kit.add( cream, box( 0.62, 0.88, cl - 0.02, X( 0.36, c ), 0, - ( c + cl / 2 ) ) );

	}

	kit.add( steel, box( 0.66, 0.04, b1 - b0, X( 0.36, ( b0 + b1 ) / 2 ), 0.88, - ( b0 + b1 ) / 2 ) );
	const cm = b0 + 0.9;
	kit.add( steel, box( 0.5, 0.42, 0.75, X( 0.32, cm ), 0.92, - cm ) ).add( dark, box( 0.52, 0.06, 0.77, X( 0.32, cm ), 1.34, - cm ) );
	for ( const k of [ - 0.2, 0.2 ] ) kit.add( dark, cyl( 0.03, 0.03, 0.08, X( 0.6, cm + k ), 1.08, - ( cm + k ), 6 ) );
	for ( const k of [ 0, 1 ] ) {

		const c = cm + 0.75 + k * 0.32;
		kit.add( dark, cyl( 0.07, 0.08, 0.38, X( 0.3, c ), 0.92, - c, 8 ) ).add( mat( 0x6b4a32 ), cyl( 0.09, 0.05, 0.16, X( 0.3, c ), 1.3, - c, 8 ) );

	}

	const crates = ( P.crates || [ '#f0d35a', '#3d74c9', '#5aa56a' ] ).map( h => mat( h, { roughness: 0.8 } ) );
	const shelfBoard = mat( 0xd6d2c6 );
	for ( const y of [ 1.75, 2.2 ] ) {

		kit.add( shelfBoard, box( 0.42, 0.03, b1 - b0 + 1.4, X( 0.24, ( b0 + b1 + 1.4 ) / 2 ), y, - ( b0 + b1 + 1.4 ) / 2 ) );
		for ( let c = b0 + 0.05; c < b1 + 1.3; c += 0.44 ) kit.add( crates[ Math.floor( rnd() * crates.length ) ], box( 0.38, 0.26, 0.4, X( 0.24, c + 0.2 ), y + 0.03, - ( c + 0.2 ) ) );

	}

	// --- the open kitchen along the back wall: deck ovens in the corner, a hood over them, cream cabinets with steel
	// tops and open steel shelves above, the island, a tall steel fridge by the arch.
	const kc = d - 0.35;
	kit.add( steel, box( 1.0, 0.62, 0.9, X( 0.6, kc - 0.2 ), 0, - ( kc - 0.2 ) ) );
	for ( const y of [ 0.64, 1.12 ] ) kit.add( steel, box( 1.0, 0.44, 0.9, X( 0.6, kc - 0.2 ), y, - ( kc - 0.2 ) ) ).add( dark, box( 0.02, 0.22, 0.55, X( 0.6, kc - 0.2 ) + dir * 0.5, y + 0.11, - ( kc - 0.2 ) ) );
	kit.add( steel, box( 1.3, 0.45, 1.1, X( 0.7, kc - 0.3 ), 2.25, - ( kc - 0.3 ) ), cyl( 0.16, 0.16, vaultY( kc - 0.3 ) - 2.7, X( 0.7, kc - 0.3 ), 2.7, - ( kc - 0.3 ), 8 ) );
	for ( let a = 1.4; a < L.hall - 1.2; a += 0.62 ) kit.add( cream, box( 0.6, 0.86, 0.62, X( a + 0.3 ), 0, - kc ) );
	kit.add( steel, box( L.hall - 2.6, 0.04, 0.66, X( ( 1.4 + L.hall - 1.2 ) / 2 ), 0.86, - kc ) );
	for ( const y of [ 1.55, 2.05 ] ) {

		kit.add( steel, box( L.hall - 2.6, 0.03, 0.34, X( ( 1.4 + L.hall - 1.2 ) / 2 ), y, - ( d - 0.2 ) ) );
		for ( let a = 1.5; a < L.hall - 1.4; a += 0.3 + rnd() * 0.25 ) kit.add( rnd() < 0.5 ? white : crates[ Math.floor( rnd() * crates.length ) ], box( 0.22, 0.12 + rnd() * 0.14, 0.26, X( a ), y + 0.03, - ( d - 0.2 ) ) );

	}

	kit.add( steel, box( 0.72, 2.0, 0.72, X( L.hall - 0.8 ), 0, - ( d - 0.42 ) ) );
	const ia0 = ca + 1.0, ia1 = L.hall - 1.6, ic = Math.min( d - 1.75, cc1 + 0.35 );
	if ( ia1 - ia0 > 0.8 ) {

		kit.add( cream, box( ia1 - ia0, 0.86, 0.8, X( ( ia0 + ia1 ) / 2 ), 0, - ic ) ).add( steel, box( ia1 - ia0 + 0.06, 0.04, 0.86, X( ( ia0 + ia1 ) / 2 ), 0.86, - ic ) );
		// The extractor hood over the island, stainless, with its duct into the vault.
		kit.add( steel, box( ia1 - ia0 + 0.3, 0.42, 1.2, X( ( ia0 + ia1 ) / 2 ), 2.3, - ic ), cyl( 0.18, 0.18, vaultY( ic ) - 2.72, X( ( ia0 + ia1 ) / 2 ), 2.72, - ic, 8 ) );
		kit.add( glow( 0xf4f1e6, 0.9 ), box( ia1 - ia0, 0.01, 0.08, X( ( ia0 + ia1 ) / 2 ), 2.29, - ic ) );

	}

	// --- the arch between the counter and the seating.
	const archX = X( L.hall + L.arch / 2 );
	crossWall( kit, litMat( P.wall || '#f2efe8', 0.2 ), room, vaultY, archX, L.arch, 0.75, Math.min( d - 0.9, 5.3 ), 2.45, 0.6 );

	// --- the seating: the bench under the windows, tables and chairs along it, accent tables at the far end.
	const s0 = L.hall + L.arch + 0.3, s1 = length - 0.3;
	const bench = mat( P.bench || '#2d5b47', { roughness: 0.95 } ), base = mat( P.benchBase || '#7a3a2e' );
	kit.add( base, box( s1 - s0, 0.34, 0.5, X( ( s0 + s1 ) / 2 ), 0, - 0.3 ) ).add( bench, box( s1 - s0, 0.1, 0.56, X( ( s0 + s1 ) / 2 ), 0.34, - 0.33 ) );
	for ( let a = s0; a < s1 - 0.2; a += 0.92 ) {

		const l = Math.min( 0.9, s1 - a );
		kit.add( bench, new THREE.BoxGeometry( l - 0.03, 0.46, 0.12 ).rotateX( - 0.12 ).translate( X( a + l / 2 ), 0.7, - 0.08 ) );

	}

	const accentFrom = s1 - ( P.accentRun ?? 4.4 );
	const table = mat( P.table || '#ede3c1', { roughness: 0.5 } ), foot = mat( 0xe9e7e0, { roughness: 0.4 } );
	const chairParts = chair( 'wood', P.chair || '#d7c097' );
	let k = 0;
	for ( let a = s0 + 0.85; a < accentFrom - 0.6; a += 1.55, k ++ ) {

		const x = X( a );
		kit.add( table, new THREE.CylinderGeometry( 0.5, 0.5, 0.035, 18 ).scale( 1.25, 1, 0.68 ).translate( x, 0.74, - 1.0 ) );
		kit.add( foot, cyl( 0.035, 0.035, 0.72, x, 0, - 1.0, 6 ), cyl( 0.26, 0.28, 0.025, x, 0, - 1.0, 14 ) );
		place( kit, chairParts.map( ( [ m, g ] ) => [ m, g.clone() ] ), x, 0, - 1.72, 0 );
		seat( x, - 1.72, 0 );
		seat( x, - 0.42, Math.PI );

	}

	room.tablesTo = accentFrom;

	// Accent tables: half-round ends towards the aisle, metal chairs.
	const red = mat( P.accentTable || '#e8483c', { roughness: 0.45 } ), accentChair = chair( 'metal', P.accentChair || '#28319a' );
	for ( let a = accentFrom + 0.6; a < s1 - 0.6; a += 1.7 ) {

		const x = X( a );
		kit.add( red, box( 0.8, 0.035, 0.42, x, 0.74, - 0.95 ), new THREE.CylinderGeometry( 0.4, 0.4, 0.035, 16, 1, false, Math.PI / 2, Math.PI ).rotateY( Math.PI / 2 ).translate( x, 0.757, - 1.16 ) );
		kit.add( foot, cyl( 0.035, 0.035, 0.72, x, 0, - 1.1, 6 ), cyl( 0.24, 0.26, 0.025, x, 0, - 1.1, 14 ) );
		place( kit, accentChair.map( ( [ m, g ] ) => [ m, g.clone() ] ), x, 0, - 1.95, 0 );
		seat( x, - 1.95, 0 );
		seat( x, - 0.42, Math.PI );

	}

	// --- shelving along the back wall: cream tubular frames, wooden shelves, a deeper ledge at standing height;
	// cookbooks, coffee bags, jars.
	const shelfFrom = s0 + 0.4, shelfTo = s1 - 1.6, sc = d - 0.2;
	const tube = mat( P.shelf || '#ece4cd', { roughness: 0.4 } ), wood = mat( P.shelfWood || '#c7a273', { roughness: 0.6 } );
	for ( let a = shelfFrom; a <= shelfTo + 0.01; a += ( shelfTo - shelfFrom ) / Math.max( 1, Math.round( ( shelfTo - shelfFrom ) / 1.5 ) ) ) {

		for ( const c of [ sc - 0.16, sc + 0.12 ] ) kit.add( tube, cyl( 0.018, 0.018, 2.75, X( a ), 0, - c, 5 ) );

	}

	const items = [ 0xd8452f, 0x2f5f8a, 0xe9c34a, 0x3f7a4a, 0xf1ece0, 0x1f1f22, 0xc98a5a, 0x8a5aa0 ].map( h => mat( h ) );
	const kraft = mat( 0xf3efe4 ), amber = mat( 0x9a4f22, { roughness: 0.25 } );
	for ( const [ y, deep ] of [ [ 1.0, 0.44 ], [ 1.55, 0.32 ], [ 2.05, 0.32 ], [ 2.55, 0.32 ] ] ) {

		kit.add( y === 1.0 ? mat( 0x77736c, { roughness: 0.5 } ) : wood, box( shelfTo - shelfFrom + 0.2, 0.03, deep, X( ( shelfFrom + shelfTo ) / 2 ), y, - ( d - 0.06 - deep / 2 ) ) );
		for ( let a = shelfFrom + 0.1; a < shelfTo - 0.1; ) {

			const kind = rnd(), zc = - ( d - 0.22 );
			if ( kind < 0.45 ) { // a run of books standing

				const n = 4 + Math.floor( rnd() * 8 );
				for ( let j = 0; j < n; j ++ ) kit.add( items[ Math.floor( rnd() * items.length ) ], box( 0.035, 0.2 + rnd() * 0.08, 0.2, X( a + j * 0.04 ), y + 0.03, zc ) );
				a += n * 0.04 + 0.15;

			} else if ( kind < 0.75 ) { // coffee bags

				for ( let j = 0; j < 3; j ++ ) kit.add( kraft, box( 0.12, 0.22, 0.08, X( a + j * 0.14 ), y + 0.03, zc ) );
				a += 0.55;

			} else { // jars

				for ( let j = 0; j < 2; j ++ ) kit.add( amber, cyl( 0.07, 0.07, 0.2, X( a + j * 0.17 ), y + 0.03, zc, 8 ) );
				a += 0.5;

			}

			a += rnd() * 0.3;

		}

	}

	place( kit, chair( 'wood', P.chair || '#d7c097' ).map( ( [ m, g ] ) => [ m, g.scale( 1, 1.6, 1 ) ] ), X( shelfFrom + 2.0 ), 0, - ( d - 0.75 ), Math.PI );

	// --- the far end: the toilets' door, the air conditioner above.
	const xf = c => farAt( c ) - dir * 0.02;
	kit.add( white, box( 0.04, 2.05, 0.85, xf( d - 1.4 ), 0, - ( d - 1.4 ) ) ).add( mat( 0xdedbd2 ), box( 0.03, 2.12, 0.98, xf( d - 1.4 ) + dir * 0.01, 0, - ( d - 1.4 ) ) );
	kit.add( dark, box( 0.06, 0.02, 0.12, xf( d - 1.1 ) - dir * 0.04, 1.0, - ( d - 1.1 ) ) );
	kit.add( white, box( 0.22, 0.3, 0.9, xf( 2.4 ) - dir * 0.1, 2.45, - 2.4 ) );
	// The same unit on the end wall of the counter part, over the coffee bar.
	kit.add( white, box( 0.22, 0.3, 0.9, X( 0.12, b0 + 0.6 ), 2.55, - ( b0 + 0.6 ) ) );

	// --- light: pendants over the tables, spotlights on a track along the crown, glowing in the vault.
	const shade = mat( 0xf3f1ea, { roughness: 0.4, side: THREE.DoubleSide } ), bulb = M.bulb, cable = mat( P.cable || '#2f6b4a' );
	for ( let a = s0 + 0.85; a < s1 - 0.4; a += 3.1 ) {

		const x = X( a ), drop = vaultY( 1.0 ) - 2.15;
		kit.add( cable, cyl( 0.006, 0.006, drop, x, 2.15, - 1.0, 4 ) );
		kit.add( shade, new THREE.ConeGeometry( 0.2, 0.07, 14, 1, true ).translate( x, 2.12, - 1.0 ) ).add( bulb, ball( 0.04, x, 2.08, - 1.0, 6 ) );

	}

	for ( let a = 1.2; a < length - 0.5; a += 2.4 ) {

		const x = X( a );
		kit.add( white, cyl( 0.035, 0.035, 0.14, x, vaultY( d / 2 ) - 0.16, - d / 2 - 0.15, 7 ) ).add( bulb, ball( 0.02, x, vaultY( d / 2 ) - 0.17, - d / 2 - 0.15, 4 ) );

	}

	kit.add( mat( 0xe8e6e0 ), box( Math.abs( length - 2 ), 0.025, 0.04, X( length / 2 ), vaultY( d / 2 ) - 0.03, - d / 2 - 0.15 ) );
	room.at = { X, R, dir, length, hall: L.hall, s0, s1, d };

}

// ---------------------------------------------------------------------------
// Bjukitchen (Jungmannova 33/27), from the owner's photos 2026-10: what the long café preset doesn't have. The
// white linen curtain inside the door on a green rail, the shelf of coffee bags by it, the counter's flowers in a
// striped blue vase, red oval wall lights between the windows, the arc floor lamp over the red tables, the B mark
// on the back wall, flowers in a blue vase on a window sill, vault ribs between the bays.

function furnishBju( kit, room, P, seat, vaultY ) {

	const { X, dir, hall, s0, s1, d } = room.at;
	const green = mat( '#2f6b4a', { roughness: 0.5 } );

	// The curtain: a rail across the doorway's inside, the linen gathered on the window side.
	const dc0 = room.door?.c0 ?? 0.6, dc1 = room.door?.c1 ?? 1.8;
	kit.add( green, new THREE.CylinderGeometry( 0.018, 0.018, dc1 - dc0 + 0.9, 6 ).rotateX( Math.PI / 2 ).translate( X( 0.45, ( dc0 + dc1 ) / 2 ), 2.55, - ( dc0 + dc1 ) / 2 + 0.2 ) );
	const linen = mat( 0xf1ede3, { roughness: 1, side: THREE.DoubleSide } );
	for ( let k = 0; k < 6; k ++ ) {

		const c = Math.max( 0.08, dc0 - 0.55 ) + k * 0.08;
		kit.add( linen, new THREE.PlaneGeometry( 0.12, 2.45 ).rotateY( ( k % 2 ? 0.6 : - 0.6 ) + Math.PI / 2 ).translate( X( 0.45, c ), 0.08 + 1.225, - c ) );

	}

	// Coffee bags on cream tubular shelves on the window wall, past the first window.
	const tube = mat( P.shelf || '#ece4cd', { roughness: 0.4 } ), wood = mat( P.shelfWood || '#c7a273' ), kraft = mat( 0xf3efe4 ), label = mat( P.brand || '#e8483c' );
	const sa = hall - 4.0 - 0.6;
	for ( const a of [ sa - 0.7, sa + 0.7 ] ) kit.add( tube, cyl( 0.018, 0.018, 2.2, X( a ), 0, - 0.3, 5 ) );
	for ( const y of [ 0.9, 1.3, 1.7, 2.1 ] ) {

		kit.add( wood, box( 1.5, 0.03, 0.3, X( sa ), y, - 0.18 ) );
		for ( let j = 0; j < 7; j ++ ) kit.add( j % 3 === 2 ? label : kraft, box( 0.13, 0.24, 0.09, X( sa - 0.6 + j * 0.2 ), y + 0.03, - 0.16 ) );

	}

	// Flowers on the counter in the striped vase.
	const ca = hall - 4.0, vc = 1.95;
	kit.add( mat( 0x2a4fb0, { roughness: 0.3 } ), cyl( 0.07, 0.09, 0.28, X( ca ), 1.02, - vc, 10 ) );
	for ( let k = 0; k < 7; k ++ ) kit.add( mat( [ 0xf2c94a, 0xe86a7a, 0xf6efe0 ][ k % 3 ] ), ball( 0.06, X( ca ) + ( rnd() - 0.5 ) * 0.3, 1.45 + rnd() * 0.35, - vc + ( rnd() - 0.5 ) * 0.25, 5 ) );
	kit.add( mat( 0x4f7a3a ), cyl( 0.01, 0.01, 0.4, X( ca ), 1.3, - vc, 4 ) );

	// Red oval wall lights on the window wall, glowing a little.
	const redGlow = glow( 0xe8483c, 0.45 );
	for ( const a of [ s0 + 3.9, s0 + 8.2 ] ) kit.add( redGlow, new THREE.CylinderGeometry( 0.07, 0.07, 0.05, 12 ).scale( 1, 1, 1.8 ).rotateX( Math.PI / 2 ).rotateZ( Math.PI / 2 ).translate( X( a ), 2.15, - 0.04 ).scale( 1, 1, 1 ) );

	// The arc floor lamp by the red tables: a tall blue stem curving over, a white shade.
	const a0 = s1 - 0.5, curve = new THREE.QuadraticBezierCurve3( new THREE.Vector3( X( a0 ), 0, - 2.5 ), new THREE.Vector3( X( a0 ), 2.9, - 2.4 ), new THREE.Vector3( X( a0 - 0.6 ), 2.2, - 1.35 ) );
	kit.add( mat( '#22307e', { roughness: 0.4 } ), new THREE.TubeGeometry( curve, 10, 0.015, 4 ) ).add( mat( 0x22307e ), cyl( 0.15, 0.16, 0.03, X( a0 ), 0, - 2.5, 10 ) );
	kit.add( mat( 0xf3f1ea, { side: THREE.DoubleSide } ), new THREE.ConeGeometry( 0.16, 0.07, 12, 1, true ).translate( X( a0 - 0.6 ), 2.14, - 1.35 ) ).add( M.bulb, ball( 0.035, X( a0 - 0.6 ), 2.1, - 1.35, 6 ) );

	// The B mark on the back wall above the shelving, and flowers in a blue vase on the second window's sill.
	const mark = canvasTexture( ( c, w, h ) => bjuMark( c, w * 0.12, h * 0.1, h * 0.2, P.brand || '#e8483c' ), 128, 128 );
	const markMat = lit( new THREE.MeshStandardNodeMaterial( { map: mark, transparent: true, alphaTest: 0.3, roughness: 0.6 } ), 0.3 );
	kit.add( markMat, new THREE.PlaneGeometry( 0.7, 0.7 ).translate( X( s1 - 1.0 ), 2.0, - ( d - 0.02 ) ) );
	const sill = room.walls[ 0 ].openings.filter( o => o[ 2 ] > 0.4 )[ 1 ];
	if ( sill ) {

		const w0 = room.walls[ 0 ].a, w1 = room.walls[ 0 ].b, f = ( sill[ 0 ] + sill[ 1 ] ) / 2 / Math.hypot( w1[ 0 ] - w0[ 0 ], w1[ 1 ] - w0[ 1 ] );
		const x = w0[ 0 ] + ( w1[ 0 ] - w0[ 0 ] ) * f;
		kit.add( mat( 0x2a4fb0, { roughness: 0.3 } ), cyl( 0.07, 0.06, 0.18, x, sill[ 2 ], 0.25, 10 ) );
		for ( let k = 0; k < 6; k ++ ) kit.add( mat( [ 0xc8457a, 0x9a4fa0, 0x5d8a3a ][ k % 3 ] ), ball( 0.06, x + ( rnd() - 0.5 ) * 0.25, sill[ 2 ] + 0.25 + rnd() * 0.15, 0.25 + ( rnd() - 0.5 ) * 0.15, 5 ) );

	}

	// Transverse ribs across the vault between the seating bays.
	const ribMat = litMat( P.wall || '#f2efe8', 0.14 );
	for ( let a = s0 + 4.6; a < s1 - 1; a += 4.6 ) rib( kit, ribMat, room, vaultY, X( a ), 0.28 );
	rib( kit, ribMat, room, vaultY, X( hall / 2 ), 0.28 );

}

const LAYOUTS = { longCafe };
const FURNISH = { bju: furnishBju };

// Builds the room into `g`, the group standing on the room's front (src/venues.js addVenueInterior).
export function addSponsoredInterior( g, room, seat ) {

	const kit = new Kit();
	seed = 11;
	const P = room.palette || {};
	const vaultY = shell( kit, room, P );
	LAYOUTS[ room.layout ]?.( kit, room, P, seat, vaultY );
	FURNISH[ room.style ]?.( kit, room, P, seat, vaultY );
	kit.build( g, { shadows: false } );
	return g;

}
