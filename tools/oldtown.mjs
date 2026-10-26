// The Old Town's landmarks east of the river, from the data (drawn by src/oldtown.js):
//
//   - Týnský chrám (RÚIAN 46662022): its two west towers found as the two tops of the surface model (DMP 1G) in the
//     church's footprint, their shafts as the area round each top standing over the roof's ridge.
//   - Staroměstská radnice (RÚIAN 21642028): the tower as the top of the surface model in the hall's footprint and
//     the area within 14 m of its top round it; the orloj on the face of the tower nearest the OSM point
//     "Staroměstský orloj" (node 4748580936, its face pointing 155°: south), set on the house wall nearest it.
//   - Prašná brána (RÚIAN 46669353): its footprint, the gallery where most of its top stands, its spire's top; the
//     passage along the street (Celetná to náměstí Republiky) through it.
//   - Obecní dům (RÚIAN 21650381): the copper dome as the highest point in its footprint and the area round it within
//     7 m of the top; the front under it on the nearest edge of the footprint.
//   - On Staroměstské náměstí: the Jan Hus monument (OSM way 176442801, Šaloun's group, 8 m over its base: OSM
//     height), the Marian column (OSM way 815041625, rebuilt 2020, the Virgin 13.5 m up on it: OSM min_height,
//     the four angels on the corners of its base: OSM nodes), the Prague meridian (OSM way 340086966, a brass strip
//     in the paving).
//
// OSM points are moved onto the cadastre everywhere here, as in tools/karluv.mjs.

import { readFileSync } from 'node:fs';

export const OLDTOWN_CODES = { tyn: 46662022, hall: 21642028, powder: 46669353, obecni: 21650381 };
// Modelled whole (no generic walls or roof): the gate tower with its passage.
export const OLDTOWN_HAND = [ OLDTOWN_CODES.powder ];

export function collectOldTown( ctx, { places, zone, L } ) {

	const { buildings, dsm, AREA, terrainAt, toLocal, projectCadastre, photoAt } = ctx;
	if ( ! dsm || ! projectCadastre ) return null;
	const BASE = - toLocal( 0, 0, 0 )[ 1 ];
	const at = ( X, Y ) => {

		const c = Math.floor( ( X - AREA.xmin ) / dsm.cell ), r = Math.floor( ( AREA.ymax - Y ) / dsm.cell );
		return c < 0 || r < 0 || c >= dsm.width || r >= dsm.height ? - 1e9 : dsm.data[ r * dsm.width + c ] - BASE;

	};
	const inRing = ( ring, X, Y ) => {

		let c = false;
		for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) if ( ( ring[ i ][ 1 ] > Y ) !== ( ring[ j ][ 1 ] > Y ) && X < ( ring[ j ][ 0 ] - ring[ i ][ 0 ] ) * ( Y - ring[ i ][ 1 ] ) / ( ring[ j ][ 1 ] - ring[ i ][ 1 ] ) + ring[ i ][ 0 ] ) c = ! c;
		return c;

	};
	const cellsIn = ring => {

		const xs = ring.map( p => p[ 0 ] ), ys = ring.map( p => p[ 1 ] ), out = [];
		for ( let X = Math.min( ...xs ); X <= Math.max( ...xs ); X += 0.5 ) for ( let Y = Math.min( ...ys ); Y <= Math.max( ...ys ); Y += 0.5 ) if ( inRing( ring, X, Y ) ) out.push( [ X, Y, at( X, Y ) ] );
		return out;

	};
	const pct = ( v, p ) => [ ...v ].sort( ( a, b ) => a - b )[ Math.min( v.length - 1, Math.floor( v.length * p ) ) ];
	// The smallest rectangle round an outline (S-JTSK): its direction.
	const dirOf = ring => {

		let best = null;
		for ( let i = 0; i < ring.length; i ++ ) {

			const a = ring[ i ], b = ring[ ( i + 1 ) % ring.length ], l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
			if ( l < 1 ) continue;
			const ux = ( b[ 0 ] - a[ 0 ] ) / l, uy = ( b[ 1 ] - a[ 1 ] ) / l;
			const us = ring.map( ( [ X, Y ] ) => X * ux + Y * uy ), vs = ring.map( ( [ X, Y ] ) => - X * uy + Y * ux );
			const area = ( Math.max( ...us ) - Math.min( ...us ) ) * ( Math.max( ...vs ) - Math.min( ...vs ) );
			if ( ! best || area < best.area ) best = { area, ux, uy };

		}

		return [ best.ux, best.uy ];

	};
	// A box (scene frame) round S-JTSK cells in the direction ( ux, uy ): centre, scene direction, half sizes.
	const boxOf = ( cells, [ ux, uy ] ) => {

		const us = cells.map( ( [ X, Y ] ) => X * ux + Y * uy ), vs = cells.map( ( [ X, Y ] ) => - X * uy + Y * ux );
		const u0 = Math.min( ...us ) - 0.25, u1 = Math.max( ...us ) + 0.25, v0 = Math.min( ...vs ) - 0.25, v1 = Math.max( ...vs ) + 0.25;
		const cu = ( u0 + u1 ) / 2, cv = ( v0 + v1 ) / 2;
		const [ x, z ] = L( cu * ux - cv * uy, cu * uy + cv * ux );
		// Scene direction of u: ( ux, −uy ).
		return { x, z, ux: + ux.toFixed( 4 ), uz: + ( - uy ).toFixed( 4 ), hu: + ( ( u1 - u0 ) / 2 ).toFixed( 2 ), hv: + ( ( v1 - v0 ) / 2 ).toFixed( 2 ) };

	};
	const colourAt = ( X, Y, R ) => {

		const px = [];
		for ( let dx = - R; dx <= R; dx += 0.5 ) for ( let dy = - R; dy <= R; dy += 0.5 ) if ( dx * dx + dy * dy <= R * R ) {

			const p = photoAt?.( X + dx, Y + dy );
			if ( p && p[ 0 ] + p[ 1 ] + p[ 2 ] > 120 && p[ 0 ] + p[ 1 ] + p[ 2 ] < 690 ) px.push( p );

		}

		if ( px.length < 4 ) return null;
		return '#' + [ 0, 1, 2 ].map( k => pct( px.map( p => p[ k ] ), 0.5 ).toString( 16 ).padStart( 2, '0' ) ).join( '' );

	};
	const byCode = new Map( buildings.map( b => [ b.code, b ] ) );
	const osm = JSON.parse( readFileSync( new URL( '../data/raw/osm.json', import.meta.url ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( q => [ q.id, q ] ) );
	const ways = new Map( osm.filter( e => e.type === 'way' ).map( w => [ w.id, w ] ) );
	const wayRing = id => ( ways.get( id )?.nodes || [] ).map( n => nodes.get( n ) ).filter( Boolean ).map( q => projectCadastre( q.lon, q.lat ) );
	const out = {};

	// Týn: two tops over the ridge, each tower's shaft the cells over the ridge round its top.
	{

		const b = byCode.get( OLDTOWN_CODES.tyn );
		if ( b ) {

			const cells = cellsIn( b.poly.outer ), ridge = pct( cells.map( c => c[ 2 ] ), 0.85 ), dir = dirOf( b.poly.outer );
			const ground = Math.min( ...b.poly.outer.map( ( [ X, Y ] ) => terrainAt( X, Y ) ) );
			const tops = [];
			for ( const c of [ ...cells ].sort( ( p, q ) => q[ 2 ] - p[ 2 ] ) ) {

				if ( tops.length === 2 ) break;
				if ( tops.every( t => Math.hypot( t[ 0 ] - c[ 0 ], t[ 1 ] - c[ 1 ] ) > 10 ) ) tops.push( c );

			}

			out.tyn = { ground: + ground.toFixed( 2 ), ridge: + ridge.toFixed( 2 ), towers: tops.map( t => {

				const shaft = cells.filter( c => Math.hypot( c[ 0 ] - t[ 0 ], c[ 1 ] - t[ 1 ] ) < 6.5 && c[ 2 ] > ridge + 2 );
				return { ...boxOf( shaft, dir ), top: + t[ 2 ].toFixed( 2 ) };

			} ) };

		}

	}

	// The Old Town Hall's tower and the orloj.
	{

		const b = byCode.get( OLDTOWN_CODES.hall );
		if ( b ) {

			const cells = cellsIn( b.poly.outer ), top = cells.reduce( ( a, c ) => c[ 2 ] > a[ 2 ] ? c : a );
			const shaft = cells.filter( c => Math.hypot( c[ 0 ] - top[ 0 ], c[ 1 ] - top[ 1 ] ) < 9 && c[ 2 ] > top[ 2 ] - 14 );
			const box = boxOf( shaft, dirOf( b.poly.outer ) );
			const hs = shaft.map( c => c[ 2 ] );
			out.hall = { ...box, ground: + terrainAt( top[ 0 ], top[ 1 ] ).toFixed( 2 ), eave: + pct( hs, 0.4 ).toFixed( 2 ), top: + top[ 2 ].toFixed( 2 ) };
			const o = nodes.get( 4748580936 );
			if ( o ) {

				// Onto the nearest house wall (the hall's outline or a house of it), facing out of it.
				const [ OX, OY ] = projectCadastre( o.lon, o.lat );
				let best = null;
				for ( const q of buildings ) {

					if ( ! q.kept || q.bbox && ( q.bbox[ 0 ] > OX + 20 || q.bbox[ 2 ] < OX - 20 || q.bbox[ 1 ] > OY + 20 || q.bbox[ 3 ] < OY - 20 ) ) continue;
					const ring = q.poly.outer;
					for ( let i = 0; i < ring.length; i ++ ) {

						const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ], dx = bx - ax, dy = by - ay, l = Math.hypot( dx, dy );
						if ( l < 4 ) continue;
						const t = Math.max( 0, Math.min( 1, ( ( OX - ax ) * dx + ( OY - ay ) * dy ) / ( l * l ) ) ), px = ax + dx * t, py = ay + dy * t, d = Math.hypot( OX - px, OY - py );
						if ( best && d >= best.d ) continue;
						let nx = dy / l, ny = - dx / l;
						if ( inRing( ring, px + nx * 0.5, py + ny * 0.5 ) ) [ nx, ny ] = [ - nx, - ny ];
						best = { d, px, py, nx, ny };

					}

				}

				const [ x, z ] = L( best.px, best.py );
				out.hall.orloj = [ x, z ];
				out.hall.orlojN = [ + best.nx.toFixed( 4 ), + ( - best.ny ).toFixed( 4 ) ];

			}

		}

	}

	// Prašná brána, with its passage.
	{

		const b = byCode.get( OLDTOWN_CODES.powder );
		if ( b ) {

			const cells = cellsIn( b.poly.outer ), hs = cells.map( c => c[ 2 ] );
			let [ ux, uy ] = dirOf( b.poly.outer );
			if ( Math.abs( ux ) < Math.abs( uy ) ) [ ux, uy ] = [ - uy, ux ]; // u: west to east, along the street
			if ( ux < 0 ) [ ux, uy ] = [ - ux, - uy ];
			const box = boxOf( b.poly.outer, [ ux, uy ] ), X = box.x, Z = box.z;
			const ground = terrainAt( ...b.poly.outer.reduce( ( a, p ) => [ a[ 0 ] + p[ 0 ] / b.poly.outer.length, a[ 1 ] + p[ 1 ] / b.poly.outer.length ], [ 0, 0 ] ) );
			const floor = Math.min( ...[ - 1, 1 ].map( s => terrainAt( X + s * ( box.hu + 1.5 ) * box.ux + ctx.ORIGIN.x, ctx.ORIGIN.y - ( Z + s * ( box.hu + 1.5 ) * box.uz ) ) ) );
			out.powder = { ...box, ground: + ground.toFixed( 2 ), floor: + floor.toFixed( 2 ), eave: + pct( hs, 0.35 ).toFixed( 2 ), top: + pct( hs, 1 ).toFixed( 2 ), passage: 2.4 };
			// Walking through the passage, under its vault.
			const P = out.powder, ends = [ - 1, 1 ].map( s => terrainAt( X + s * ( P.hu + 0.5 ) * P.ux + ctx.ORIGIN.x, ctx.ORIGIN.y - ( Z + s * ( P.hu + 0.5 ) * P.uz ) ) );
			zone( X, Z, [ - P.uz, P.ux ], P.passage - 0.3, P.hu + 0.6, { y0: + ends[ 0 ].toFixed( 2 ), y1: + ends[ 1 ].toFixed( 2 ), along: [ P.ux, P.uz ], ceil: + ( Math.max( ...ends ) + 6.5 ).toFixed( 2 ) } );

		}

	}

	// Obecní dům: the dome and the front under it.
	{

		const b = byCode.get( OLDTOWN_CODES.obecni );
		if ( b ) {

			const ring = b.poly.outer, cells = cellsIn( ring ), top = cells.reduce( ( a, c ) => c[ 2 ] > a[ 2 ] ? c : a );
			const dome = cells.filter( c => Math.hypot( c[ 0 ] - top[ 0 ], c[ 1 ] - top[ 1 ] ) < 8 && c[ 2 ] > top[ 2 ] - 7 );
			const cX = dome.reduce( ( a, c ) => a + c[ 0 ], 0 ) / dome.length, cY = dome.reduce( ( a, c ) => a + c[ 1 ], 0 ) / dome.length;
			const r = Math.sqrt( dome.length * 0.25 / Math.PI ) + 0.5;
			const rest = cells.filter( c => Math.hypot( c[ 0 ] - cX, c[ 1 ] - cY ) > r + 3 ).map( c => c[ 2 ] );
			// The front: the edge of the footprint nearest the dome, facing out.
			let best = null;
			for ( let i = 0; i < ring.length; i ++ ) {

				const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
				if ( l2 < 4 ) continue;
				const t = Math.max( 0, Math.min( 1, ( ( cX - ax ) * dx + ( cY - ay ) * dy ) / l2 ) ), px = ax + dx * t, py = ay + dy * t, d = Math.hypot( cX - px, cY - py );
				if ( ! best || d < best.d ) best = { d, px, py };

			}

			const [ x, z ] = L( cX, cY ), [ fx, fz ] = L( best.px, best.py ), l = Math.hypot( fx - x, fz - z ) || 1;
			out.obecni = { x, z, r: + r.toFixed( 2 ), top: + top[ 2 ].toFixed( 2 ), eave: + pct( rest, 0.5 ).toFixed( 2 ), ground: + terrainAt( best.px, best.py ).toFixed( 2 ), front: [ fx, fz ], nx: + ( ( fx - x ) / l ).toFixed( 4 ), nz: + ( ( fz - z ) / l ).toFixed( 4 ), colour: colourAt( cX, cY, r * 0.6 ) };

		}

	}

	// Staroměstské náměstí: the Hus monument, the Marian column and the meridian.
	{

		const hus = wayRing( 176442801 );
		if ( hus.length > 3 ) {

			const pts = hus.map( ( [ X, Y ] ) => L( X, Y ) ), cx = pts.reduce( ( a, p ) => a + p[ 0 ], 0 ) / pts.length, cz = pts.reduce( ( a, p ) => a + p[ 1 ], 0 ) / pts.length;
			const statue = nodes.get( 8798184462 ), [ sx, sz ] = statue ? L( ...projectCadastre( statue.lon, statue.lat ) ) : [ cx, cz ];
			out.hus = { ring: pts, x: + cx.toFixed( 2 ), z: + cz.toFixed( 2 ), y: + Math.min( ...hus.map( ( [ X, Y ] ) => terrainAt( X, Y ) ) ).toFixed( 2 ), statue: [ sx, sz ], h: 8 };
			// The base is a barrier.
			for ( let i = 0; i < pts.length; i ++ ) {

				const a = pts[ i ], b = pts[ ( i + 1 ) % pts.length ];
				places.barriers.push( [ a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ], - 99 ] );

			}

		}

		const col = wayRing( 815041625 );
		if ( col.length > 3 ) {

			const pts = col.map( ( [ X, Y ] ) => L( X, Y ) ), cx = pts.reduce( ( a, p ) => a + p[ 0 ], 0 ) / pts.length, cz = pts.reduce( ( a, p ) => a + p[ 1 ], 0 ) / pts.length;
			const angels = [ 12229465846, 12229465847, 12229465848 ].map( id => nodes.get( id ) ).filter( Boolean ).map( q => L( ...projectCadastre( q.lon, q.lat ) ) );
			out.marian = { x: + cx.toFixed( 2 ), z: + cz.toFixed( 2 ), y: + Math.min( ...col.map( ( [ X, Y ] ) => terrainAt( X, Y ) ) ).toFixed( 2 ), column: 13.5, angels };
			places.barriers.push( [ cx - 2.2, cz - 2.2, cx + 2.2, cz - 2.2, - 99 ], [ cx + 2.2, cz - 2.2, cx + 2.2, cz + 2.2, - 99 ], [ cx + 2.2, cz + 2.2, cx - 2.2, cz + 2.2, - 99 ], [ cx - 2.2, cz + 2.2, cx - 2.2, cz - 2.2, - 99 ] );

		}

		const mer = wayRing( 340086966 );
		if ( mer.length > 1 ) out.meridian = mer.map( ( [ X, Y ] ) => [ ...L( X, Y ), + terrainAt( X, Y ).toFixed( 2 ) ] );

	}

	console.log( `places: Old Town landmarks: Týn towers ${out.tyn?.towers.map( t => t.top.toFixed( 1 ) ).join( ', ' )}, hall tower ${out.hall?.top.toFixed( 1 )}${out.hall?.orloj ? ' with the orloj' : ''}, Prašná brána ${out.powder?.top.toFixed( 1 )}, Obecní dům dome ${out.obecni?.top.toFixed( 1 )} ${out.obecni?.colour}, Hus ${!! out.hus}, Marian column ${!! out.marian}, meridian ${out.meridian?.length || 0} points` );
	return out;

}
