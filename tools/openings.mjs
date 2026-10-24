// Arcades (podloubí) and public passages through houses, from OpenStreetMap: footways, lanes and roads tagged
// tunnel=building_passage or covered=arcade where they run inside a house footprint. Each becomes an opening: the
// house walls are left out below its ceiling (tools/build-scene.mjs), the floor is walkable (a zone, see
// tools/places.mjs) and src/openings.js builds the inside: vaulted ceiling, side walls, arcade pillars and arches.
//
// All in S-JTSK metres. A passage: { kind: 'passage', X, Y (middle), ux, uy (along), len, w, h }.
// An arcade: { kind: 'arcade', X, Y (middle of its street face), ux, uy (along), nx, ny (out to the street), len,
// depth, h }.

import { readFile } from 'node:fs/promises';
import { lonLatToSJTSK } from './geo.mjs';

const RAW = new URL( '../data/raw/', import.meta.url );
const WALK = new Set( [ 'footway', 'pedestrian', 'path', 'service', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'cycleway' ] );
const WIDTH = { footway: 2.6, path: 2.2, pedestrian: 3.2, cycleway: 2.6, service: 3.4, living_street: 3.6 };

export async function findOpenings( { AREA, buildingAt, buildings = [] } ) {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( e => [ e.id, e ] ) );
	const inside = ( X, Y ) => buildingAt( X, Y ) >= 0;
	const openings = [];

	// House front edges, to set arcades on: the footprints' outer rings.
	const fronts = [];
	for ( const b of buildings ) {

		const r = b.poly.outer;
		for ( let i = 0; i < r.length; i ++ ) {

			const [ ax, ay ] = r[ i ], [ bx, by ] = r[ ( i + 1 ) % r.length ];
			const len = Math.hypot( bx - ax, by - ay );
			if ( len >= 2 ) fronts.push( { ax, ay, ux: ( bx - ax ) / len, uy: ( by - ay ) / len, len } );

		}

	}

	// An arcade stretch along its street face from (x0, y0) to (x1, y1), n out to the street: snapped onto the
	// house front it belongs to (OSM lines run a metre or two off).
	const addArcade = ( w, t, x0, y0, x1, y1, nx, ny, depth ) => {

		let ux = x1 - x0, uy = y1 - y0;
		const l = Math.hypot( ux, uy );
		ux /= l; uy /= l;
		const mx = ( x0 + x1 ) / 2, my = ( y0 + y1 ) / 2;
		let best = null;
		for ( const f of fronts ) {

			if ( Math.abs( f.ux * ux + f.uy * uy ) < Math.cos( 20 * Math.PI / 180 ) ) continue;
			const s = ( mx - f.ax ) * f.ux + ( my - f.ay ) * f.uy;
			if ( s < - 1 || s > f.len + 1 ) continue;
			const d = Math.abs( - ( mx - f.ax ) * f.uy + ( my - f.ay ) * f.ux );
			if ( d < 2.5 && ( ! best || d < best.d ) ) best = { f, d };

		}

		if ( best ) {

			const f = best.f, sg = f.ux * ux + f.uy * uy > 0 ? 1 : - 1;
			const proj = ( X, Y ) => ( X - f.ax ) * f.ux + ( Y - f.ay ) * f.uy;
			const s0 = Math.min( proj( x0, y0 ), proj( x1, y1 ) ), s1 = Math.max( proj( x0, y0 ), proj( x1, y1 ) );
			if ( s1 - s0 < 1.5 ) return;
			ux = f.ux * sg; uy = f.uy * sg;
			const pn = - f.uy * nx + f.ux * ny > 0 ? 1 : - 1; // keep n pointing to the street
			nx = - f.uy * pn; ny = f.ux * pn;
			x0 = f.ax + f.ux * s0; y0 = f.ay + f.uy * s0; x1 = f.ax + f.ux * s1; y1 = f.ay + f.uy * s1;

		}

		const len = Math.hypot( x1 - x0, y1 - y0 );
		openings.push( { kind: 'arcade', way: w.id, name: t.name, X: ( x0 + x1 ) / 2, Y: ( y0 + y1 ) / 2, ux, uy, nx, ny, len: + len.toFixed( 2 ), depth: + depth.toFixed( 2 ), h: 4.0 } );

	};

	for ( const w of osm ) {

		const t = w.tags || {};
		if ( w.type !== 'way' || ! WALK.has( t.highway ) || t.area === 'yes' ) continue;
		const arcade = t.covered === 'arcade' || /podloub/i.test( t.note || '' );
		if ( ! arcade && t.tunnel !== 'building_passage' ) continue;
		if ( [ 'no', 'private' ].includes( t.access ) || [ 'no', 'private' ].includes( t.foot ) ) continue;

		const pts = ( w.nodes || [] ).map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) );
		const width = Number( t.width ) || WIDTH[ t.highway ] || 6;

		for ( let i = 0; i + 1 < pts.length; i ++ ) {

			const [ ax, ay ] = pts[ i ], [ bx, by ] = pts[ i + 1 ];
			if ( ax < AREA.xmin || ax > AREA.xmax || ay < AREA.ymin || ay > AREA.ymax ) continue;
			const len = Math.hypot( bx - ax, by - ay );
			if ( len < 0.8 ) continue;
			const ux = ( bx - ax ) / len, uy = ( by - ay ) / len;

			// The stretch of this segment inside houses (short gaps between two houses bridged).
			let s0 = null, s1 = null;
			for ( let s = 0; s <= len; s += 0.25 ) if ( inside( ax + ux * s, ay + uy * s ) ) {

				if ( s0 === null ) s0 = s;
				s1 = s;

			}

			if ( arcade && s0 === null ) {

				// Mapped out in the street, beside the house (OSM lines run a few metres off here): the arcade is the
				// ground floor of the house along its front.
				const host = sgn => {

					for ( let d = 0.5; d < 6; d += 0.1 ) if ( inside( ( ax + bx ) / 2 + uy * sgn * d, ( ay + by ) / 2 - ux * sgn * d ) ) return d;
					return Infinity;

				};

				const [ dl, dr ] = [ host( 1 ), host( - 1 ) ];
				if ( Math.min( dl, dr ) > 5.5 ) continue;
				const sgn = dl < dr ? 1 : - 1, d = Math.min( dl, dr );
				const nx = - uy * sgn, ny = ux * sgn; // away from the house
				const fx = ( ax + bx ) / 2 - nx * d, fy = ( ay + by ) / 2 - ny * d;
				// The stretch of the front the house really has.
				let a0 = null, a1 = null;
				for ( let s = - len / 2; s <= len / 2; s += 0.25 ) if ( inside( fx + ux * s - nx * 0.5, fy + uy * s - ny * 0.5 ) ) {

					if ( a0 === null ) a0 = s;
					a1 = s;

				}

				if ( a0 === null || a1 - a0 < 2 ) continue;
				addArcade( w, t, fx + ux * a0, fy + uy * a0, fx + ux * a1, fy + uy * a1, nx, ny, 3.6 );
				continue;

			}

			if ( s0 === null || s1 - s0 < 1 ) continue;
			// Passage ends on the house fronts: carry on past the segment ends while still inside.
			if ( s0 === 0 && ! arcade ) while ( s0 > - 30 && inside( ax + ux * ( s0 - 0.25 ), ay + uy * ( s0 - 0.25 ) ) ) s0 -= 0.25;
			if ( s1 >= len - 0.25 && ! arcade ) while ( s1 < len + 30 && inside( ax + ux * ( s1 + 0.25 ), ay + uy * ( s1 + 0.25 ) ) ) s1 += 0.25;
			const mx = ax + ux * ( s0 + s1 ) / 2, my = ay + uy * ( s0 + s1 ) / 2;
			const runLen = s1 - s0 + 0.25;

			if ( ! arcade ) {

				openings.push( { kind: 'passage', way: w.id, name: t.name, X: mx, Y: my, ux, uy, len: + runLen.toFixed( 2 ), w: width, h: width > 4 ? 4.6 : 3.6 } );
				continue;

			}

			// Arcade: the open side is the nearer way out of the house, across the way.
			const out = sgn => {

				for ( let d = 0; d < 7; d += 0.2 ) if ( ! inside( mx - uy * sgn * d, my + ux * sgn * d ) ) return d;
				return Infinity;

			};

			const [ dl, dr ] = [ out( 1 ), out( - 1 ) ];
			if ( Math.min( dl, dr ) > 5 ) continue;
			const sgn = dl < dr ? 1 : - 1, face = Math.min( dl, dr );
			const nx = - uy * sgn, ny = ux * sgn;
			const depth = Math.min( 4.2, Math.max( 3.0, face * 2 ) );
			const half = runLen / 2;
			addArcade( w, t, mx + nx * face - ux * half, my + ny * face - uy * half, mx + nx * face + ux * half, my + ny * face + uy * half, nx, ny, depth );

		}

	}

	// One arcade per straight stretch of front: join a way's pieces along the same line, at one depth.
	const merged = [];
	for ( const o of openings ) {

		const m = o.kind === 'arcade' && merged.find( q => q.kind === 'arcade' && q.way === o.way && q.ux * o.ux + q.uy * o.uy > 0.995 &&
			Math.abs( - ( o.X - q.X ) * q.uy + ( o.Y - q.Y ) * q.ux ) < 1.0 &&
			Math.abs( ( o.X - q.X ) * q.ux + ( o.Y - q.Y ) * q.uy ) < ( o.len + q.len ) / 2 + 1.5 );
		if ( ! m ) {

			merged.push( o );
			continue;

		}

		const along = ( X, Y ) => ( X - m.X ) * m.ux + ( Y - m.Y ) * m.uy;
		const a = Math.min( - m.len / 2, along( o.X, o.Y ) - o.len / 2 ), b = Math.max( m.len / 2, along( o.X, o.Y ) + o.len / 2 );
		m.X += m.ux * ( a + b ) / 2;
		m.Y += m.uy * ( a + b ) / 2;
		m.len = + ( b - a ).toFixed( 2 );
		m.depth = Math.max( m.depth, o.depth );

	}

	return merged.filter( o => o.kind !== 'arcade' || o.len >= 3 );

}

// The opening's box (S-JTSK): centre, along u, across n, half sizes; with `pad` metres more all round, and
// passages `ends` metres longer at both ends (to take out the house fronts they cross).
export function openingBox( o, pad = 0, ends = 0 ) {

	if ( o.kind === 'passage' ) return { X: o.X, Y: o.Y, ux: o.ux, uy: o.uy, hu: o.len / 2 + ends + pad, hn: o.w / 2 + pad };
	// Arcade: from just outside its street face back to its depth.
	const mid = ( o.depth - 0.4 ) / 2;
	return { X: o.X - o.nx * mid, Y: o.Y - o.ny * mid, ux: o.ux, uy: o.uy, hu: o.len / 2 + pad, hn: ( o.depth + 0.4 ) / 2 + pad };

}

// Parameter interval [t0, t1] of the segment a → b inside the box (or null): Liang–Barsky in the box frame.
export function clipToBox( box, ax, ay, bx, by ) {

	const lu = ( X, Y ) => ( X - box.X ) * box.ux + ( Y - box.Y ) * box.uy;
	const ln = ( X, Y ) => - ( X - box.X ) * box.uy + ( Y - box.Y ) * box.ux;
	const p0 = [ lu( ax, ay ), ln( ax, ay ) ], d = [ lu( bx, by ) - p0[ 0 ], ln( bx, by ) - p0[ 1 ] ];
	let t0 = 0, t1 = 1;
	for ( const [ k, half ] of [ [ 0, box.hu ], [ 1, box.hn ] ] ) {

		for ( const [ p, q ] of [ [ - d[ k ], p0[ k ] + half ], [ d[ k ], half - p0[ k ] ] ] ) {

			if ( Math.abs( p ) < 1e-9 ) {

				if ( q < 0 ) return null;

			} else {

				const r = q / p;
				if ( p < 0 ) t0 = Math.max( t0, r );
				else t1 = Math.min( t1, r );

			}

		}

	}

	return t1 - t0 > 1e-4 ? [ t0, t1 ] : null;

}
