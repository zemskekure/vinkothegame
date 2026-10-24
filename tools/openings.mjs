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

export async function findOpenings( { AREA, buildingAt } ) {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( e => [ e.id, e ] ) );
	const inside = ( X, Y ) => buildingAt( X, Y ) >= 0;
	const openings = [];

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
				openings.push( { kind: 'arcade', way: w.id, name: t.name, X: fx + ux * ( a0 + a1 ) / 2, Y: fy + uy * ( a0 + a1 ) / 2, ux, uy, nx, ny, len: + ( a1 - a0 ).toFixed( 2 ), depth: 3.6, h: 4.0 } );
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
			openings.push( { kind: 'arcade', way: w.id, name: t.name, X: mx + nx * face, Y: my + ny * face, ux, uy, nx, ny, len: + runLen.toFixed( 2 ), depth: + depth.toFixed( 2 ), h: 4.0 } );

		}

	}

	return openings;

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
