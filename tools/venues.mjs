// Sponsored walk-in venues from data/venues.json: one entry per place (see docs/venues.md). For each it finds the
// house fronts named in the entry and returns, in the scene frame, everything the game needs to build it:
//
//   - the room: a rectangle along one front of the house (`room.edge`), set `inFrom`…`inTo` m back from it, from
//     `from` to `to` m along it (from its left end as seen from the street, and allowed to run on past the front's
//     ends when the house does), or up to another front of the house (`room.end`), the shopfront the door is in;
//   - the door (a walk zone from the pavement into the room, the wall cut open), the glazing (the house front cut
//     away behind the drawn glass, and matching openings with reveals in the room's walls);
//   - outdoor tables, plants and pumpkins by the door, enamel plates, the minimap marker.
//
// The drawn shopfronts themselves are ordinary house edges in data/houses.json (`shopfront`); the room is furnished
// at runtime by the layout preset and the venue's own furnishing function (src/venues.js).

import { readFileSync } from 'node:fs';

const VENUES = new URL( '../data/venues.json', import.meta.url );

export function collectVenues( { places, edgeOf, frame, zone, cutout, sideK, tablesAt, terrainAt, S } ) {

	const venues = JSON.parse( readFileSync( VENUES, 'utf8' ) );
	for ( const [ id, v ] of Object.entries( venues ) ) {

		const front = e => edgeOf( v.house, e ) || console.warn( `venues: ${id} has no front ${v.house}/${e}` );
		// A point on a front `l` m from its left end as seen from the street (the way the drawn fronts run).
		const along = ( f, l ) => sideK( f ) > 0 ? l : f.len - l;
		const at = ( f, l ) => frame( f, along( f, l ) );
		const R = v.room, fr = front( R.edge ), fe = R.end !== undefined ? front( R.end ) : null, fd = front( v.door.edge );
		if ( ! fr || ( R.end !== undefined && ! fe ) || ! fd ) continue;

		// The room's frame: x to the right along its front, z out of it; the origin on the inner face of that front's
		// wall half way along the room, so the room lies at z from −d to 0.
		const l0 = R.from ?? 0, l1 = R.to ?? fr.len, lm = ( l0 + l1 ) / 2, d = R.inTo - R.inFrom;
		const c = at( fr, lm ), N = c.n, X = [ N[ 1 ], - N[ 0 ] ];
		const O = [ c.x - N[ 0 ] * R.inFrom, c.z - N[ 1 ] * R.inFrom ];
		const toF = ( x, z ) => [ ( x - O[ 0 ] ) * X[ 0 ] + ( z - O[ 1 ] ) * X[ 1 ], ( x - O[ 0 ] ) * N[ 0 ] + ( z - O[ 1 ] ) * N[ 1 ] ];
		const toL = ( fx, fz ) => [ O[ 0 ] + X[ 0 ] * fx + N[ 0 ] * fz, O[ 1 ] + X[ 1 ] * fx + N[ 1 ] * fz ];

		// Its ends: straight across, or along the inner face of the end front (a quarter metre in from its face).
		let xl = () => l0 - lm, xr = () => l1 - lm, endSide = null;
		if ( fe ) {

			const pa = at( fe, 0 ), pb = at( fe, fe.len );
			const [ ax, az ] = toF( pa.x - pa.n[ 0 ] * 0.25, pa.z - pa.n[ 1 ] * 0.25 ), [ bx, bz ] = toF( pb.x - pb.n[ 0 ] * 0.25, pb.z - pb.n[ 1 ] * 0.25 );
			const line = z => ax + ( z - az ) * ( bx - ax ) / ( bz - az );
			if ( ( ax + bx ) / 2 < 0 ) {

				xl = line;
				endSide = 'left';

			} else {

				xr = line;
				endSide = 'right';

			}

		}

		const r2 = q => q.map( p => + p.toFixed( 3 ) );
		const poly = [ [ xl( 0 ), 0 ], [ xr( 0 ), 0 ], [ xr( - d ), - d ], [ xl( - d ), - d ] ].map( r2 );

		// The floor at the pavement's level by the door, or higher where the ground inside rises.
		let y = at( fd, ( v.door.from + v.door.to ) / 2 ).y;
		for ( let fz = - d + 0.3; fz < 0; fz += 0.5 ) for ( let fx = Math.max( xl( fz ), xl( 0 ) ) + 0.3; fx < Math.min( xr( fz ), xr( 0 ) ) - 0.3; fx += 0.5 ) {

			y = Math.max( y, terrainAt( ...S( ...toL( fx, fz ) ) ) + 0.06 );

		}
		y = + ( y + 0.02 ).toFixed( 2 );

		// Walls in polygon order: 0 along the room's front, 1 the right end, 2 the back, 3 the left end.
		const walls = poly.map( ( a, i ) => ( { a, b: poly[ ( i + 1 ) % 4 ], openings: [] } ) );
		const endWall = endSide === 'left' ? walls[ 3 ] : walls[ 1 ];
		const onWall = ( w, fx, fz ) => {

			const dx = w.b[ 0 ] - w.a[ 0 ], dz = w.b[ 1 ] - w.a[ 1 ], len = Math.hypot( dx, dz );
			return ( ( fx - w.a[ 0 ] ) * dx + ( fz - w.a[ 1 ] ) * dz ) / len;

		};

		// An opening in a front: the house front cut away behind it, and the same opening in the room's wall.
		const open = ( g, door ) => {

			const f = front( g.edge );
			if ( ! f ) return null;
			const p0 = at( f, g.from ), p1 = at( f, g.to ), pm = at( f, ( g.from + g.to ) / 2 );
			const ground = pm.y, y0 = door ? y - 0.5 : ground + g.y0, y1 = ground + ( g.y1 ?? g.h );
			cutout( pm.x, + y0.toFixed( 2 ), pm.z, [ pm.n[ 1 ], - pm.n[ 0 ] ], Math.abs( g.to - g.from ) / 2, 0.45, + y1.toFixed( 2 ) );
			// The room's wall behind it: its front wall for a front facing the same way (the room's own front, or
			// another stretch of that side of the house), else the end wall at the end front.
			const facing = p0.n[ 0 ] * N[ 0 ] + p0.n[ 1 ] * N[ 1 ];
			const wall = facing > 0.9 ? walls[ 0 ] : g.edge === R.end ? endWall : null;
			if ( ! wall ) return null;
			const [ , fzm ] = toF( pm.x, pm.z );
			const depth = wall === walls[ 0 ] ? Math.max( 0.05, fzm ) : 0.25;
			const ends = [ p0, p1 ].map( p => {

				const [ fx, fz ] = toF( p.x - p.n[ 0 ] * depth, p.z - p.n[ 1 ] * depth );
				return { u: onWall( wall, fx, fz ), fz };

			} );
			const u0 = Math.min( ends[ 0 ].u, ends[ 1 ].u ), u1 = Math.max( ends[ 0 ].u, ends[ 1 ].u );
			wall.openings.push( [ u0, u1, door ? 0 : y0 - y, y1 - y, depth ].map( q => + q.toFixed( 3 ) ) );
			return { c0: - Math.max( ends[ 0 ].fz, ends[ 1 ].fz ), c1: - Math.min( ends[ 0 ].fz, ends[ 1 ].fz ) };

		};

		for ( const g of v.glazing || [] ) open( g, false );
		const doorAt = open( v.door, true );
		// Openings that overlap (a door inside its glazed bay) are one hole in the wall.
		for ( const w of walls ) w.openings = w.openings.sort( ( p, q ) => p[ 0 ] - q[ 0 ] ).reduce( ( out, o ) => {

			const last = out[ out.length - 1 ];
			if ( last && o[ 0 ] < last[ 1 ] ) out[ out.length - 1 ] = [ last[ 0 ], Math.max( last[ 1 ], o[ 1 ] ), Math.min( last[ 2 ], o[ 2 ] ), Math.max( last[ 3 ], o[ 3 ] ), Math.max( last[ 4 ], o[ 4 ] ) ];
			else out.push( o );
			return out;

		}, [] );

		// Walkable: the room (clear of its walls) and the doorway from 0.7 m out on the pavement into it.
		const x0 = Math.max( xl( 0 ), xl( - d ) ) + 0.35, x1 = Math.min( xr( 0 ), xr( - d ) ) - 0.35;
		const [ rx, rz ] = toL( ( x0 + x1 ) / 2, - d / 2 );
		zone( rx, rz, X, ( x1 - x0 ) / 2, d / 2 - 0.35, { y } );
		const pd = at( fd, ( v.door.from + v.door.to ) / 2 ), Xd = [ pd.n[ 1 ], - pd.n[ 0 ] ];
		const [ dfx ] = toF( pd.x, pd.z );
		const inward = Math.abs( dfx - ( endSide === 'left' ? x0 : x1 ) ) + 0.4;
		zone( pd.x - pd.n[ 0 ] * ( inward - 0.7 ) / 2, pd.z - pd.n[ 1 ] * ( inward - 0.7 ) / 2, Xd, Math.abs( v.door.to - v.door.from ) / 2 - 0.15, ( inward + 0.7 ) / 2, { y } );

		// Outdoor tables in front, two seats each for the street life (and the furniture drawn at runtime).
		if ( v.terrace ) {

			const f = front( v.terrace.edge );
			if ( f ) {

				const n = places.seats.length;
				tablesAt( f, along( f, 0 ), v.terrace.kind, v.terrace.spots );
				places.seats.length = n; // the chairs (and their seats) are laid out at runtime, three to a table
				places.terraces[ places.terraces.length - 1 ].colour = v.terrace.colour;

			}

		}

		// Pots by the door and seasonal pumpkins, standing on the pavement just out from the front.
		const outside = [];
		const step = v.doorstep && front( v.doorstep.edge );
		if ( step ) for ( const kind of [ 'plants', 'pumpkins' ] ) for ( const l of v.doorstep[ kind ] || [] ) {

			const p = at( step, l );
			outside.push( [ kind, + ( p.x + p.n[ 0 ] * 0.35 ).toFixed( 2 ), p.y, + ( p.z + p.n[ 1 ] * 0.35 ).toFixed( 2 ) ] );

		}

		for ( const p of v.plates || [] ) {

			const f = front( p.edge );
			if ( ! f ) continue;
			const q = at( f, p.at );
			places.plates?.push( { x: q.x, z: q.z, n: q.n, y: + ( q.y + p.y ).toFixed( 2 ), kind: p.kind, text: p.text, ...( p.sub ? { sub: p.sub } : {} ) } );

		}

		const [ mx, mz ] = toL( ( poly[ 0 ][ 0 ] + poly[ 1 ][ 0 ] ) / 2, - d / 2 );
		places.interiors.push( {
			name: v.name, style: v.style, layout: v.layout, venue: id, shell: true,
			x: + O[ 0 ].toFixed( 2 ), z: + O[ 1 ].toFixed( 2 ), n: N, y, h: R.h ?? 3.6, d: + d.toFixed( 2 ), poly, walls, end: endSide,
			door: doorAt && { c0: + doorAt.c0.toFixed( 2 ), c1: + doorAt.c1.toFixed( 2 ), h: v.door.h ?? 2.4 },
			palette: v.palette || {}, outside,
			marker: v.marker && { ...v.marker, x: + mx.toFixed( 1 ), z: + mz.toFixed( 1 ) }
		} );
		console.log( `venues: ${v.name} ${( poly[ 1 ][ 0 ] - poly[ 0 ][ 0 ] ).toFixed( 1 )} × ${d.toFixed( 1 )} m, floor ${y}, ${( v.glazing || [] ).length} windows` );

	}

}
