// Signature places and street life, located in the data at build time (see src/places.js and src/life.js):
//
//   - Rotunda sv. Kříže Menšího (Konviktská): its round nave and apse fitted to the OSM outline; the generic
//     building is left out and modelled by hand at runtime.
//   - Hostinec U Rotundy, Standard Café, Champagneria: the house front each one is in (by house number / nearest
//     front), a walk-in room behind a real door in it, outdoor seating, signs.
//   - The courtyard with the brewery chimney in Náprstkova: the enclosed yard is found by flooding the open ground
//     around the chimney; a gateway passage is cut through the thinnest house to a street.
//   - Náprstkovo muzeum: its gate on the front nearest the museum's address point.
//   - The stairs from Národní down to Divadelní (OSM way 1201817510).
//   - Street life: pavement walking lines (from the kerb model), pedestrian lanes, driving lanes, parking spots.
//
// Input positions are S-JTSK; everything returned is in the scene frame (x east, y up, z south).

const ROTUNDA_WAY = 395230762;
const STAIRS_WAY = 1201817510;
// Čapadlo by the Faculty of Social Sciences: steps beside it, the underpass, the metal stair from the terrace.
const CAPADLO = { steps: 137806765, underpass: 1201427940, metal: 34056146 };

export function collectPlaces( ctx ) {

	const { buildings, streetFacades, toLocal, terrainAt, buildingAt, keptIds, dsm, AREA, ORIGIN, streetData, furniture, riverAt } = ctx;
	const L = ( X, Y ) => [ + ( X - ORIGIN.x ).toFixed( 2 ), + ( - ( Y - ORIGIN.y ) ).toFixed( 2 ) ];
	const LV = ( nx, ny ) => [ + nx.toFixed( 4 ), + ( - ny ).toFixed( 4 ) ];
	const S = ( x, z ) => [ x + ORIGIN.x, - z + ORIGIN.y ];
	const inKept = ( X, Y ) => keptIds.has( buildingAt( X, Y ) );
	const yAt = ( X, Y ) => + terrainAt( X, Y ).toFixed( 2 );
	const byCode = new Map( buildings.map( b => [ b.code, b ] ) );
	const wayById = new Map( streetData.ways.map( w => [ w.id, w ] ) );
	const nodeById = id => streetData.nodes.get( id );

	const places = { zones: [], cutouts: [], seats: [], signs: [], interiors: [], terraces: [], lights: [], fronts: [] };

	// --- house fronts
	const facadeNear = ( X, Y, { number, code } = {} ) => {

		let best = null;
		for ( const f of streetFacades ) {

			const b = byCode.get( f.code );
			if ( number && Number( b?.number ) !== number ) continue;
			if ( code && f.code !== code ) continue;
			const [ ax, ay ] = f.a, [ bx, by ] = f.b;
			const dx = bx - ax, dy = by - ay, len = Math.hypot( dx, dy );
			const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( len * len ) ) );
			const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
			if ( ! best || d < best.d ) best = { ...f, d, t, len, ux: dx / len, uy: dy / len, id: b?.id };

		}

		return best;

	};

	// The house front nearest a point that faces a given street point (outward normal towards it, open ground in
	// front), from the footprints themselves: also fronts on passages and lanes that are not in the street data.
	const frontFacing = ( X, Y, TX, TY, { number } = {} ) => {

		let best = null;
		for ( const b of buildings ) {

			if ( ! b.kept || ( number && Number( b.number ) !== number ) ) continue;
			if ( b.bbox[ 0 ] > X + 40 || b.bbox[ 2 ] < X - 40 || b.bbox[ 1 ] > Y + 40 || b.bbox[ 3 ] < Y - 40 ) continue;
			for ( const ring of [ b.poly.outer, ...b.poly.holes ] ) for ( let i = 0; i < ring.length; i ++ ) { // courtyards too

				const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ];
				const dx = bx - ax, dy = by - ay, len = Math.hypot( dx, dy );
				if ( len < 3 ) continue;
				let nx = dy / len, ny = - dx / len;
				const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
				if ( buildingAt( mx + nx * 0.5, my + ny * 0.5 ) === b.id ) { nx = - nx; ny = - ny; }
				if ( inKept( mx + nx * 1.0, my + ny * 1.0 ) ) continue; // a party wall
				if ( ( TX - mx ) * nx + ( TY - my ) * ny <= 0 ) continue; // faces away from the street
				const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( len * len ) ) );
				const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
				if ( ! best || d < best.d ) best = { code: b.code, id: b.id, a: [ ax, ay ], b: [ bx, by ], n: [ nx, ny ], d, t, len, ux: dx / len, uy: dy / len };

			}

		}

		return best;

	};

	// A frame on a house front at distance s (m) along it: local position, along-vector, outward normal, ground.
	const frame = ( f, s ) => {

		const X = f.a[ 0 ] + f.ux * s, Y = f.a[ 1 ] + f.uy * s;
		const [ x, z ] = L( X, Y );
		const out = [ X + f.n[ 0 ] * 0.6, Y + f.n[ 1 ] * 0.6 ];
		return { X, Y, x, z, u: LV( f.ux, f.uy ), n: LV( f.n[ 0 ], f.n[ 1 ] ), y: + ( terrainAt( ...out ) + streetData.raise( streetData.at( ...out ).Fk ) ).toFixed( 2 ) };

	};

	// An oriented walkable rectangle (local frame): centre, along-vector u, half sizes along u and along n.
	const zone = ( x, z, u, hu, hn, extra = {} ) => places.zones.push( { x, z, ux: u[ 0 ], uz: u[ 1 ], hu, hn, ...extra } );
	const cutout = ( x, y0, z, u, hu, hn, y1 ) => places.cutouts.push( { x, z, ux: u[ 0 ], uz: u[ 1 ], hu, hn, y0, y1 } );

	// Along a front, the viewer's right (seen from the street) is +X; k converts X offsets to distances along it.
	const sideK = f => ( - f.ux * f.n[ 1 ] + f.uy * f.n[ 0 ] ) >= 0 ? 1 : - 1;

	// A walk-in room behind a front: centred `s` m along it, as wide as asked (≤ the front), as deep as the house
	// (≤ maxD); its door `door` m to the right (+X) of the room's centre.
	function interior( name, style, f, s, { w = 7, maxD = 9, door = 0, h = null } = {} ) {

		w = Math.min( w, f.len - 1.2, 2 * Math.min( s, f.len - s ) - 0.6 );
		let depth = maxD;
		for ( let k = - w / 2 + 0.5; k <= w / 2 - 0.5 + 1e-6; k += 0.5 ) { // the corners of the front read short

			const X = f.a[ 0 ] + f.ux * ( s + k ), Y = f.a[ 1 ] + f.uy * ( s + k );
			// Through the front wall (its edge cells may read as street), then on while inside this house.
			const mine = d => buildings[ buildingAt( X - f.n[ 0 ] * d, Y - f.n[ 1 ] * d ) ]?.code === f.code;
			let d = 0.25;
			while ( d < 1.2 && ! mine( d ) ) d += 0.25;
			while ( d < maxD + 0.5 && mine( d ) ) d += 0.25;
			depth = Math.min( depth, d - 0.6 );

		}

		if ( depth < 3 || w < 3 ) {

			console.log( `places: no room for ${name} (${w.toFixed( 1 )} × ${depth.toFixed( 1 )} m)` );
			return null;

		}

		const c = frame( f, s );
		// The floor at the pavement's level, or higher where the ground inside rises (it must cover the terrain).
		for ( let k = - w / 2; k <= w / 2; k += 0.5 ) for ( let e = 0.3; e < depth; e += 0.5 ) {

			c.y = Math.max( c.y, terrainAt( f.a[ 0 ] + f.ux * ( s + k ) - f.n[ 0 ] * e, f.a[ 1 ] + f.uy * ( s + k ) - f.n[ 1 ] * e ) + 0.06 );

		}

		const floorH = ctx.buildingInfo.get( f.code )?.floorH || 3.4;
		const room = { name, style, x: c.x, z: c.z, n: c.n, w: + w.toFixed( 2 ), d: + depth.toFixed( 2 ), h: + ( h ?? Math.min( 3.6, Math.max( 3.0, floorH * 0.95 ) ) ).toFixed( 2 ), y: + ( c.y + 0.02 ).toFixed( 2 ), door: + door.toFixed( 2 ), doorW: 1.3, doorH: 2.5 };
		places.interiors.push( room );

		// Walkable: the room (0.3 m inside its walls) and the doorway through the front wall.
		const X = [ c.n[ 1 ], - c.n[ 0 ] ];
		const inward = d => [ c.x - c.n[ 0 ] * d, c.z - c.n[ 1 ] * d ];
		const [ rx, rz ] = inward( depth / 2 );
		zone( rx, rz, X, w / 2 - 0.3, depth / 2 - 0.3, { y: room.y } );
		const [ dx, dz ] = inward( 0 );
		zone( dx + X[ 0 ] * door, dz + X[ 1 ] * door, X, room.doorW / 2 - 0.15, 0.7, { y: room.y } );
		cutout( dx + X[ 0 ] * door, room.y - 0.5, dz + X[ 1 ] * door, X, room.doorW / 2, 0.45, room.y + room.doorH );
		return room;

	}

	// The composition on a house front for src/places.js: centre, normal, ground, how far the front runs either way.
	function venueFront( style, f, s, extra = {} ) {

		const c = frame( f, s ), k = sideK( f );
		const front = { style, x: c.x, y: c.y, z: c.z, n: c.n, left: + ( k > 0 ? s : f.len - s ).toFixed( 2 ), right: + ( k > 0 ? f.len - s : s ).toFixed( 2 ), ...extra };
		places.fronts.push( front );
		return front;

	}

	// Outdoor tables at X offsets along a front, `out` m in front of it: [ x, y, z, rot, kind ]; two seats each.
	function tablesAt( f, s, kind, spots ) {

		const k = sideK( f ), tables = [];
		for ( const [ dx, out, type = kind ] of spots ) {

			const c = frame( f, Math.max( 0.3, Math.min( f.len - 0.3, s + k * dx ) ) );
			const x = c.x + c.n[ 0 ] * out, z = c.z + c.n[ 1 ] * out, y = yAtLocal( x, z );
			const X = [ c.n[ 1 ], - c.n[ 0 ] ];
			tables.push( [ + x.toFixed( 2 ), y, + z.toFixed( 2 ), + Math.atan2( X[ 0 ], X[ 1 ] ).toFixed( 3 ), type ] );
			for ( const side of [ - 1, 1 ] ) places.seats.push( [ + ( x + X[ 0 ] * 0.55 * side ).toFixed( 2 ), y, + ( z + X[ 1 ] * 0.55 * side ).toFixed( 2 ), + Math.atan2( - X[ 0 ] * side, - X[ 1 ] * side ).toFixed( 3 ) ] );

		}

		places.terraces.push( { kind, tables } );

	}

	// Chairs at small tables along a front, `out` m in front of it; seats for the street-life module.
	function terrace( f, s0, s1, out, kind ) {

		const tables = [];
		for ( let s = s0; s <= s1 + 1e-6; s += 2.4 ) {

			const c = frame( f, s );
			const x = c.x + c.n[ 0 ] * out, z = c.z + c.n[ 1 ] * out;
			const y = yAtLocal( x, z );
			const rot = Math.atan2( c.u[ 0 ], c.u[ 1 ] );
			tables.push( [ + x.toFixed( 2 ), y, + z.toFixed( 2 ), + rot.toFixed( 3 ) ] );
			for ( const side of [ - 1, 1 ] ) places.seats.push( [ + ( x + c.u[ 0 ] * 0.55 * side ).toFixed( 2 ), y, + ( z + c.u[ 1 ] * 0.55 * side ).toFixed( 2 ), + ( Math.atan2( - c.u[ 0 ] * side, - c.u[ 1 ] * side ) ).toFixed( 3 ) ] );

		}

		places.terraces.push( { kind, tables } );

	}

	const yAtLocal = ( x, z ) => {

		const [ X, Y ] = S( x, z );
		return + ( terrainAt( X, Y ) + streetData.raise( streetData.at( X, Y ).Fk ) ).toFixed( 2 );

	};

	const sign = ( f, s, height, text, style ) => {

		const c = frame( f, s );
		places.signs.push( { x: c.x, z: c.z, y: + ( c.y + height ).toFixed( 2 ), u: c.u, n: c.n, text, style } );

	};

	// --- Rotunda sv. Kříže: a circle fitted to the outline (nave); the points off it are the apse.
	{

		const way = wayById.get( ROTUNDA_WAY );
		const pts = way.pts.map( p => [ p.X, p.Y ] );
		const fit = ps => {

			// Kåsa circle fit.
			let sx = 0, sy = 0;
			for ( const [ x, y ] of ps ) { sx += x; sy += y; }
			const mx = sx / ps.length, my = sy / ps.length;
			let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
			for ( const [ x, y ] of ps ) {

				const u = x - mx, v = y - my;
				suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;

			}

			const a = ( suuu + suvv ) / 2, b = ( svvv + svuu ) / 2, det = suu * svv - suv * suv;
			const uc = ( a * svv - b * suv ) / det, vc = ( b * suu - a * suv ) / det;
			return { X: mx + uc, Y: my + vc, r: Math.sqrt( uc * uc + vc * vc + ( suu + svv ) / ps.length ) };

		};

		let circle = fit( pts );
		for ( let k = 0; k < 4; k ++ ) circle = fit( pts.filter( ( [ x, y ] ) => Math.abs( Math.hypot( x - circle.X, y - circle.Y ) - circle.r ) < 0.45 ) );
		const apsePts = pts.filter( ( [ x, y ] ) => Math.hypot( x - circle.X, y - circle.Y ) > circle.r + 0.45 );
		const ax = apsePts.reduce( ( s, p ) => s + p[ 0 ], 0 ) / apsePts.length, ay = apsePts.reduce( ( s, p ) => s + p[ 1 ], 0 ) / apsePts.length;
		const dirX = ( ax - circle.X ), dirY = ( ay - circle.Y ), dl = Math.hypot( dirX, dirY );
		const apseCX = circle.X + dirX / dl * ( circle.r - 0.6 ), apseCY = circle.Y + dirY / dl * ( circle.r - 0.6 );
		const apseR = apsePts.reduce( ( m, [ x, y ] ) => Math.max( m, Math.hypot( x - apseCX, y - apseCY ) ), 0 );
		const [ x, z ] = L( circle.X, circle.Y ), [ apx, apz ] = L( apseCX, apseCY );
		places.rotunda = { x, z, y: yAt( circle.X, circle.Y ), r: + circle.r.toFixed( 2 ), apse: { x: apx, z: apz, r: + apseR.toFixed( 2 ) }, dir: LV( dirX / dl, dirY / dl ) };
		console.log( `places: rotunda r ${circle.r.toFixed( 2 )} m, apse r ${apseR.toFixed( 2 )} m` );

	}

	// --- Hostinec U Rotundy (Karoliny Světlé 17, house no. 1035): a rusticated ground floor of four round arches
	// (the door in the first, the pub's window in the second), the red sign, a relief frieze above. The room behind
	// the first two arches.
	{

		const node = nodeById( 552405058 );
		const f = facadeNear( node.X, node.Y, { number: 1035 } ) || facadeNear( node.X, node.Y );
		const W = Math.min( 14, f.len - 0.6 ), bay = W / 4;
		const s = Math.max( W / 2 + 0.3, Math.min( f.len - W / 2 - 0.3, f.t * f.len ) );
		const doorX = - 1.5 * bay, w = Math.min( 7.5, 2 * bay + 0.6 ), roomX = doorX + w / 2 - 1.1;
		interior( 'Hostinec U Rotundy', 'pub', f, s + sideK( f ) * roomX, { w, maxD: 9, door: doorX - roomX } );
		venueFront( 'pub', f, s, { width: + W.toFixed( 2 ), bay: + bay.toFixed( 2 ) } );

	}

	// --- Standard Café (Karoliny Světlé 25): black awnings over two grey-blue shopfronts with shutters and the
	// door between them, barrel planters, folding wooden tables and white bistro tables on the paving.
	{

		// Karoliny Světlé 25, where OSM still has the former R. M. Rilke restaurant.
		const f = frontFacing( ...S( - 277.7, 121.9 ), ...S( - 268, 121.9 ) );
		const s = Math.max( 4, Math.min( f.len - 4, f.t * f.len ) );
		interior( 'Standard', 'cafe', f, s, { w: 6.5, maxD: 8 } );
		venueFront( 'cafe', f, s );
		tablesAt( f, s, 'fold', [ [ - 2.5, 1.0 ], [ 2.6, 1.0 ], [ 0.9, 3.4, 'bistro' ], [ 3.8, 3.6, 'fold' ], [ - 1.6, 3.6, 'bistro' ] ] );

	}

	// --- Champagneria (Průchodní 4): at the Konviktská end of Průchodní, on the wall facing the little square with
	// the trees, where the lane begins. A weathered ochre wall with bare stone and graffiti, the doorway at its south
	// end by the lane; tables with parasols along it.
	{

		const f = frontFacing( ...S( - 40.8, 108.8 ), ...S( - 50, 108.8 ) );
		const s = f.t * f.len;
		const front = venueFront( 'champagne', f, s );
		const doorX = front.right - 1.0, w = Math.min( 6.5, front.left + front.right - 1.2 ), roomX = doorX - ( w / 2 - 1.0 );
		interior( 'Champagneria', 'champagne', f, s + sideK( f ) * roomX, { w, maxD: 8, door: doorX - roomX } );
		front.door = + doorX.toFixed( 2 );
		const spots = [];
		for ( let x = - front.left + 1.0; x < doorX - 1.6; x += 2.0 ) spots.push( [ x, 0.75 ] );
		tablesAt( f, s, 'champagne', spots );

	}

	// --- Náprstkovo muzeum gate (Betlémské náměstí 1, house no. 269)
	{

		const node = nodeById( 344975004 );
		const f = facadeNear( node.X, node.Y, { number: 269 } ) || facadeNear( node.X, node.Y );
		const s = Math.max( 2.6, Math.min( f.len - 2.6, f.t * f.len ) );
		const c = frame( f, s );
		places.gate = { x: c.x, z: c.z, y: c.y, u: c.u, n: c.n, w: 3.2, h: 4.4, name: 'NÁPRSTKOVO MUZEUM', sub: 'asijských, afrických a amerických kultur' };

	}

	// --- The chimney courtyard: flood the open ground around the chimney (0.5 m cells).
	{

		const ch = furniture.chimney;
		if ( ch.length ) {

			const [ X0, Y0 ] = S( ch[ 0 ], ch[ 2 ] );
			const W = dsm.width, H = dsm.height, cell = dsm.cell;
			const c0 = Math.floor( ( X0 - AREA.xmin ) / cell ), r0 = Math.floor( ( AREA.ymax - Y0 ) / cell );
			const yard = new Uint8Array( W * H );
			// Open ground at least 0.75 m from any house: hairline gaps between neighbouring outlines do not count.
			const near = new Uint8Array( W * H );
			for ( let i = 0; i < W * H; i ++ ) {

				if ( ! keptIds.has( ctx.idGrid[ i ] ) ) continue;
				const r = Math.floor( i / W ), c = i % W;
				for ( let dr = - 1; dr <= 1; dr ++ ) for ( let dc = - 1; dc <= 1; dc ++ ) {

					const rr = r + dr, cc = c + dc;
					if ( rr >= 0 && cc >= 0 && rr < H && cc < W ) near[ rr * W + cc ] = 1;

				}

			}

			// The yard ends where the street begins (near a carriageway) and 35 m from the chimney.
			const notStreet = new Map();
			const open = i => {

				if ( near[ i ] ) return false;
				const X = AREA.xmin + ( i % W + 0.5 ) * cell, Y = AREA.ymax - ( Math.floor( i / W ) + 0.5 ) * cell;
				if ( Math.hypot( X - X0, Y - Y0 ) > 35 ) return false;
				if ( ! notStreet.has( i ) ) notStreet.set( i, streetData.at( X, Y ).F > 2.5 );
				if ( ! notStreet.get( i ) ) entrance.push( [ X, Y ] );
				return notStreet.get( i );

			};
			const entrance = [];
			let stack = [ r0 * W + c0 ], count = 0;
			const LIMIT = 24000;
			yard[ stack[ 0 ] ] = 1;
			while ( stack.length && count < LIMIT ) {

				const i = stack.pop();
				count ++;
				const r = Math.floor( i / W ), c = i % W;
				for ( const [ dr, dc ] of [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ] ) {

					const rr = r + dr, cc = c + dc;
					if ( rr < 0 || cc < 0 || rr >= H || cc >= W ) continue;
					const j = rr * W + cc;
					if ( ! yard[ j ] && open( j ) ) {

						yard[ j ] = 1;
						stack.push( j );

					}

				}

			}

			const enclosed = entrance.length === 0;
			console.log( `places: chimney yard ${( count * cell * cell ).toFixed( 0 )} m², ${enclosed ? 'enclosed' : 'open to the street'}` );
			const inYard = ( X, Y ) => {

				const c = Math.floor( ( X - AREA.xmin ) / cell ), r = Math.floor( ( AREA.ymax - Y ) / cell );
				return c >= 0 && r >= 0 && c < W && r < H && yard[ r * W + c ] === 1;

			};

			if ( enclosed ) {

				// The thinnest house between a street front and the yard: march inwards from every street front.
				let best = null;
				for ( const f of streetFacades ) {

					const [ ax, ay ] = f.a, [ bx, by ] = f.b;
					const len = Math.hypot( bx - ax, by - ay );
					if ( Math.hypot( ( ax + bx ) / 2 - X0, ( ay + by ) / 2 - Y0 ) > 80 ) continue;
					for ( let s = 2; s <= len - 2; s += 0.5 ) {

						const X = ax + ( bx - ax ) * s / len, Y = ay + ( by - ay ) * s / len;
						for ( let d = 0.5; d < 22; d += 0.25 ) {

							const PX = X - f.n[ 0 ] * d, PY = Y - f.n[ 1 ] * d;
							if ( inYard( PX, PY ) ) {

								// The passage must stay clear of the corners: both sides 1.6 m away also reach the yard.
								const ok = [ - 1.6, 1.6 ].every( o => {

									for ( let e = d - 0.5; e < d + 2; e += 0.25 ) if ( inYard( X + ( bx - ax ) / len * o - f.n[ 0 ] * e, Y + ( by - ay ) / len * o - f.n[ 1 ] * e ) ) return true;
									return false;

								} );
								if ( ok && ( ! best || d < best.d ) ) best = { f, s, d, len };
								break;

							}

							if ( ! inKept( PX, PY ) ) break; // a gap that is not the yard

						}

					}

				}

				if ( best ) {

					const f = { ...best.f, len: best.len, ux: ( best.f.b[ 0 ] - best.f.a[ 0 ] ) / best.len, uy: ( best.f.b[ 1 ] - best.f.a[ 1 ] ) / best.len };
					const c = frame( f, best.s );
					const depth = best.d + 0.6;
					const [ ex, ez ] = [ c.x - c.n[ 0 ] * depth, c.z - c.n[ 1 ] * depth ];
					const [ EX, EY ] = S( ex, ez );
					const y1 = yAt( EX, EY );
					places.passage = { x: c.x, z: c.z, y0: c.y, y1, u: c.u, n: c.n, depth: + depth.toFixed( 2 ), w: 3.2, h: 3.8 };
					const mid = [ c.x - c.n[ 0 ] * depth / 2, c.z - c.n[ 1 ] * depth / 2 ];
					zone( mid[ 0 ], mid[ 1 ], c.u, 1.3, depth / 2 + 0.4, { y0: c.y, y1, along: [ - c.n[ 0 ], - c.n[ 1 ] ] } );
					cutout( mid[ 0 ], Math.min( c.y, y1 ) - 0.5, mid[ 1 ], c.u, 1.6, depth / 2 + 0.6, Math.max( c.y, y1 ) + 3.8 );
					console.log( `places: courtyard gateway through ${depth.toFixed( 1 )} m of house` );

				}

			}

			// Yard dressing: trees, benches and lamps on open cells clear of the walls.
			const spots = [];
			for ( let r = 0; r < H; r += 4 ) for ( let c = 0; c < W; c += 4 ) {

				if ( ! yard[ r * W + c ] ) continue;
				const X = AREA.xmin + ( c + 0.5 ) * cell, Y = AREA.ymax - ( r + 0.5 ) * cell;
				if ( Math.hypot( X - X0, Y - Y0 ) < 3 || Math.hypot( X - X0, Y - Y0 ) > 40 ) continue;
				let clear = 99;
				for ( let k = 0; k < 16; k ++ ) {

					const a = k * Math.PI / 8;
					for ( let d = 0.5; d < 6; d += 0.5 ) if ( ! inYard( X + Math.cos( a ) * d, Y + Math.sin( a ) * d ) ) { clear = Math.min( clear, d ); break; }

				}

				spots.push( { X, Y, clear } );

			}

			// Where the yard meets the street: an open gateway (two pillars with iron gates swung open).
			if ( ! enclosed ) {

				const mx = entrance.reduce( ( a, p ) => a + p[ 0 ], 0 ) / entrance.length, my = entrance.reduce( ( a, p ) => a + p[ 1 ], 0 ) / entrance.length;
				// The opening runs across the line from the yard to the street.
				const dx = mx - X0, dy = my - Y0, dl = Math.hypot( dx, dy );
				const ax = - dy / dl, ay = dx / dl;
				let half = 0;
				for ( const [ X, Y ] of entrance ) half = Math.max( half, Math.abs( ( X - mx ) * ax + ( Y - my ) * ay ) );
				// Pull the gateway back into the opening until both sides touch houses.
				let gx = mx, gy = my;
				for ( let k = 0; k < 20; k ++ ) {

					let w = 0;
					while ( w < 8 && ! inKept( gx + ax * w, gy + ay * w ) ) w += 0.25;
					let w2 = 0;
					while ( w2 < 8 && ! inKept( gx - ax * w2, gy - ay * w2 ) ) w2 += 0.25;
					if ( w < 8 && w2 < 8 ) {

						const cx = gx + ax * ( w - w2 ) / 2, cy = gy + ay * ( w - w2 ) / 2;
						places.yardGate = { x: L( cx, cy )[ 0 ], z: L( cx, cy )[ 1 ], y: yAt( cx, cy ), u: LV( ax, ay ), w: + ( w + w2 ).toFixed( 2 ) };
						break;

					}

					gx -= dx / dl * 0.5;
					gy -= dy / dl * 0.5;

				}

			}

			{

				const seeded = ( k ) => ( Math.sin( k * 91.7 ) * 43758.5453 ) % 1;
				const roomy = spots.filter( p => p.clear >= 3 ).sort( ( a, b ) => seeded( a.X + a.Y ) - seeded( b.X + b.Y ) );
				const nearWall = spots.filter( p => p.clear >= 1.2 && p.clear < 2 ).sort( ( a, b ) => seeded( a.X * 3 + a.Y ) - seeded( b.X * 3 + b.Y ) );
				const used = [];
				const take = ( list, n, minGap ) => {

					const out = [];
					for ( const p of list ) {

						if ( out.length >= n ) break;
						if ( used.some( q => Math.hypot( q.X - p.X, q.Y - p.Y ) < minGap ) ) continue;
						used.push( p );
						out.push( p );

					}

					return out;

				};

				places.yard = {
					trees: take( roomy, 3, 7 ).map( p => [ ...L( p.X, p.Y ), yAt( p.X, p.Y ) ] ),
					benches: take( nearWall, 4, 4 ).map( p => {

						// Back to the nearest wall.
						let best = 0, bd = 99;
						for ( let k = 0; k < 16; k ++ ) {

							const a = k * Math.PI / 8;
							for ( let d = 0.5; d < 3; d += 0.25 ) if ( ! inYard( p.X + Math.cos( a ) * d, p.Y + Math.sin( a ) * d ) ) { if ( d < bd ) { bd = d; best = a; } break; }

						}

						// The bench's back (model +z) towards the wall at angle `best` (S-JTSK).
						const [ wx, wz ] = LV( Math.cos( best ), Math.sin( best ) );
						return [ ...L( p.X, p.Y ), yAt( p.X, p.Y ), + Math.atan2( wx, wz ).toFixed( 3 ) ];

					} ),
					lamps: take( nearWall, 2, 6 ).map( p => [ ...L( p.X, p.Y ), yAt( p.X, p.Y ) ] )
				};

			}

		}

	}

	// --- Stairs from Národní down to Divadelní.
	{

		const way = wayById.get( STAIRS_WAY );
		if ( way ) {

			const [ p0, p1 ] = [ way.pts[ 0 ], way.pts[ way.pts.length - 1 ] ];
			const h0 = terrainAt( p0.X, p0.Y ), h1 = terrainAt( p1.X, p1.Y );
			const top = h0 >= h1 ? p0 : p1, bottom = h0 >= h1 ? p1 : p0;
			const steps = Math.max( 4, Math.round( Math.abs( h0 - h1 ) / 0.16 ) ); // the survey surface sets the drop
			const [ tx, tz ] = L( top.X, top.Y ), [ bx, bz ] = L( bottom.X, bottom.Y );
			const yTop = Math.max( h0, h1 ), yBottom = Math.min( h0, h1 );
			places.stairs = { top: [ tx, + yTop.toFixed( 2 ), tz ], bottom: [ bx, + yBottom.toFixed( 2 ), bz ], steps, w: 3.2 };
			console.log( `places: stairs ${steps} steps, ${( yTop - yBottom ).toFixed( 2 )} m over ${Math.hypot( tx - bx, tz - bz ).toFixed( 1 )} m` );
			const len = Math.hypot( tx - bx, tz - bz );
			const along = [ ( tx - bx ) / len, ( tz - bz ) / len ];
			zone( ( tx + bx ) / 2, ( tz + bz ) / 2, [ along[ 1 ], - along[ 0 ] ], 1.4, len / 2 + 0.3, { y0: + yBottom.toFixed( 2 ), y1: + yTop.toFixed( 2 ), along, steps } );

			// Cut the ground away under the stairway (the survey surface runs over the treads); its walls hide the cut.
			const { terrain, tw, th, cell } = ctx.terrainGrid;
			for ( let r = 0; r < th; r ++ ) for ( let c = 0; c < tw; c ++ ) {

				const [ x, z ] = L( ctx.AREA.xmin + c * cell, ctx.AREA.ymax - r * cell );
				const dx = x - bx, dz = z - bz;
				const s = dx * along[ 0 ] + dz * along[ 1 ], o = Math.abs( - dx * along[ 1 ] + dz * along[ 0 ] );
				if ( s > ( len + 0.6 ) / ( steps + 1 ) - 0.3 && s < len + 0.3 && o < 1.95 ) terrain[ r * tw + c ] = Math.min( terrain[ r * tw + c ], yBottom - 0.4 ); // where the treads are

			}

		}

	}

	// --- Čapadlo (Smetanovo nábřeží by the Faculty of Social Sciences): the steps down beside the faculty into the
	// underpass under the street and out onto the riverside terrace, and the metal stair from the terrace back up
	// to the riverside pavement. The railing along the street (tools/quay.mjs) is a walk barrier, open where the
	// stair lands on the pavement, and passable under it where the underpass comes out.
	places.flights = [];
	places.tunnels = [];
	places.barriers = [];
	{

		const way = id => wayById.get( id )?.pts.map( p => [ p.X, p.Y ] );
		const steps = way( CAPADLO.steps ), under = way( CAPADLO.underpass ), metal = way( CAPADLO.metal );
		const rail = ctx.quay?.rail || [];
		const { terrain, tw, th, cell } = ctx.terrainGrid;
		const cut = ( [ ax, ay ], [ bx, by ], half, y ) => {

			// Lower the ground under a stretch (the survey surface runs over steps and trenches).
			const len = Math.hypot( bx - ax, by - ay ), ux = ( bx - ax ) / len, uy = ( by - ay ) / len;
			for ( let s = - 0.5; s <= len + 0.5; s += 0.4 ) for ( let o = - half; o <= half; o += 0.4 ) {

				const X = ax + ux * s - uy * o, Y = ay + uy * s + ux * o;
				const c = Math.round( ( X - ctx.AREA.xmin ) / cell ), r = Math.round( ( ctx.AREA.ymax - Y ) / cell );
				if ( c >= 0 && r >= 0 && c < tw && r < th ) terrain[ r * tw + c ] = Math.min( terrain[ r * tw + c ], typeof y === 'function' ? y( s / len ) : y );

			}

		};

		if ( steps && under && rail.length ) {

			// The underpass floor is the terrace's level where it comes out under the railing.
			const mouth = rail.filter( p => p.portal );
			const floorY = mouth.length ? mouth.reduce( ( a, p ) => a + p.quay, 0 ) / mouth.length : rail[ 0 ].quay;
			const [ p0, p1 ] = [ steps[ 0 ], steps[ steps.length - 1 ] ];
			const top = terrainAt( ...p0 ) > terrainAt( ...p1 ) ? p0 : p1, bottom = top === p0 ? p1 : p0;
			const yTop = terrainAt( ...top ), n = Math.max( 6, Math.round( ( yTop - floorY ) / 0.16 ) );
			const [ tx, tz ] = L( ...top ), [ bx, bz ] = L( ...bottom );
			const len = Math.hypot( tx - bx, tz - bz ), along = [ ( tx - bx ) / len, ( tz - bz ) / len ];
			places.flights.push( { top: [ tx, + yTop.toFixed( 2 ), tz ], bottom: [ bx, + floorY.toFixed( 2 ), bz ], steps: n, w: 2.6, kind: 'trench' } );
			zone( ( tx + bx ) / 2, ( tz + bz ) / 2, [ along[ 1 ], - along[ 0 ] ], 1.15, len / 2 + 0.3, { y0: + floorY.toFixed( 2 ), y1: + yTop.toFixed( 2 ), along, steps: n } );
			cut( bottom, top, 1.6, t => floorY + ( yTop - floorY ) * t - 0.5 );

			// Underpass: from the foot of the steps to the terrace.
			// It ends at the opening in the wall under the railing.
			const end = mouth.length ? [ 0, 1 ].map( k => mouth.reduce( ( a, p ) => a + ( k ? p.Y + p.ny * 0.3 : p.X + p.nx * 0.3 ), 0 ) / mouth.length ) : under[ under.length - 1 ];
			const [ ex, ez ] = L( ...end );
			const ul = Math.hypot( ex - bx, ez - bz ), ua = [ ( ex - bx ) / ul, ( ez - bz ) / ul ];
			places.tunnels.push( { a: [ bx, bz ], b: [ ex, ez ], ya: + floorY.toFixed( 2 ), yb: + floorY.toFixed( 2 ), h: 2.8, w: 2.8 } );
			zone( ( bx + ex ) / 2, ( bz + ez ) / 2, [ ua[ 1 ], - ua[ 0 ] ], 1.25, ul / 2 + 0.6, { y: + floorY.toFixed( 2 ), ceil: + ( floorY + 2.7 ).toFixed( 2 ) } );
			console.log( `places: Čapadlo steps ${n} × ${( ( yTop - floorY ) / n ).toFixed( 3 )} m, underpass ${ul.toFixed( 1 )} m at ${floorY.toFixed( 2 )}` );

		}

		let landing = null;
		if ( metal && metal.length >= 3 && rail.length ) {

			// Metal stair along the wall from the terrace up to a landing on the pavement.
			const [ q0, q1, q2 ] = [ metal[ 0 ], metal[ 1 ], metal[ 2 ] ];
			const y0 = terrainAt( ...q0 ), y1 = terrainAt( ...q2 );
			const lo = y0 < y1 ? q0 : q2;
			const foot = lo === q0 ? q0 : q2, head = lo === q0 ? q1 : q1, top = lo === q0 ? q2 : q0;
			const yLow = Math.min( y0, y1 ), yHigh = Math.max( y0, y1 );
			const n = Math.max( 6, Math.round( ( yHigh - yLow ) / 0.17 ) );
			const [ fx, fz ] = L( ...foot ), [ hx, hz ] = L( ...head ), [ px, pz ] = L( ...top );
			const len = Math.hypot( hx - fx, hz - fz ), along = [ ( hx - fx ) / len, ( hz - fz ) / len ];
			places.flights.push( { top: [ hx, + yHigh.toFixed( 2 ), hz ], bottom: [ fx, + yLow.toFixed( 2 ), fz ], steps: n, w: 1.4, kind: 'metal', landing: [ px, + yHigh.toFixed( 2 ), pz ] } );
			zone( ( hx + fx ) / 2, ( hz + fz ) / 2, [ along[ 1 ], - along[ 0 ] ], 0.6, len / 2 + 0.2, { y0: + yLow.toFixed( 2 ), y1: + yHigh.toFixed( 2 ), along, steps: n } );
			const ll = Math.hypot( px - hx, pz - hz ), la = [ ( px - hx ) / ll, ( pz - hz ) / ll ];
			zone( ( hx + px ) / 2, ( hz + pz ) / 2, [ la[ 1 ], - la[ 0 ] ], 0.75, ll / 2 + 0.4, { y: + yHigh.toFixed( 2 ) } );
			landing = top;

		}

		// Walk barriers along the railings (this one, and the terraces' by the theatre): open at the stair's
		// landing; under them, the underpasses.
		for ( const line of [ rail, ...( ctx.terraces?.rails || [] ) ] ) for ( let i = 1; i < line.length; i ++ ) {

			const a = line[ i - 1 ], b = line[ i ];
			if ( a.river && b.river || Math.hypot( b.X - a.X, b.Y - a.Y ) > 2 ) continue;
			if ( landing && Math.hypot( ( a.X + b.X ) / 2 - landing[ 0 ], ( a.Y + b.Y ) / 2 - landing[ 1 ] ) < 1.6 ) continue;
			const [ x0, z0 ] = L( a.X, a.Y ), [ x1, z1 ] = L( b.X, b.Y );
			places.barriers.push( [ x0, z0, x1, z1, a.portal && b.portal ? + ( Math.min( a.quay, b.quay ) + 2.0 ).toFixed( 2 ) : - 99 ] );

		}

		// Divadelní under Národní: walkable at road level, under the deck.
		const tun = ctx.terraces?.tunnel;
		if ( tun ) {

			const [ ax, az ] = L( ...tun.a ), [ bx, bz ] = L( ...tun.b );
			const tl = Math.hypot( bx - ax, bz - az ), ta = [ ( bx - ax ) / tl, ( bz - az ) / tl ];
			places.tunnels.push( { a: [ ax, az ], b: [ bx, bz ], ya: + tun.ya.toFixed( 2 ), yb: + tun.yb.toFixed( 2 ), h: + ( tun.ceil - Math.max( tun.ya, tun.yb ) ).toFixed( 2 ), w: tun.w, road: true } );
			zone( ( ax + bx ) / 2, ( az + bz ) / 2, [ ta[ 1 ], - ta[ 0 ] ], tun.w / 2 - 0.3, tl / 2 + 1.0, { y0: + tun.ya.toFixed( 2 ), y1: + tun.yb.toFixed( 2 ), along: ta, ceil: + ( tun.ceil - 0.1 ).toFixed( 2 ) } );

		}

	}

	// --- landmark lettering and plaques, on the house fronts seen in street photos
	const edgeOf = ( code, edge ) => {

		const f = streetFacades.find( q => q.code === code && q.edge === edge );
		if ( ! f ) return null;
		const len = Math.hypot( f.b[ 0 ] - f.a[ 0 ], f.b[ 1 ] - f.a[ 1 ] );
		return { ...f, len, ux: ( f.b[ 0 ] - f.a[ 0 ] ) / len, uy: ( f.b[ 1 ] - f.a[ 1 ] ) / len };

	};
	const LANDMARK_SIGNS = [
		{ code: 21649685, edge: 7, at: 0.5, h: 4.9, text: 'KAVÁRNA SLAVIA', style: 'letters' },
		{ code: 21649685, edge: 0, at: 0.6, h: 4.9, text: 'KAVÁRNA SLAVIA', style: 'letters' },
		{ code: 21649685, edge: 1, at: 0.5, h: 3.3, text: 'FAMU', style: 'plaque' },
		{ code: 21649553, edge: 4, at: 0.5, h: 3.4, text: 'UNIVERZITA KARLOVA · FAKULTA SOCIÁLNÍCH VĚD', style: 'plaque' },
		{ code: 21643296, edge: 1, at: 0.5, h: 4.2, text: 'KARLOVY LÁZNĚ', style: 'neon' },
		{ code: 21645132, edge: 34, at: 0.5, h: 4.3, text: 'PLATÝZ', style: 'letters' },
		{ code: 21652252, edge: 31, at: 0.5, h: 4.6, text: 'ŽOFÍN', style: 'letters' }
	];
	for ( const s of LANDMARK_SIGNS ) {

		const f = edgeOf( s.code, s.edge );
		if ( f ) sign( f, f.len * s.at, s.h, s.text, s.style );
		else console.warn( `places: no front ${s.code}/${s.edge} for ${s.text}` );

	}

	// --- Kavárna Slavia (Národní 1, the corner of Lažanský palác): the café's tall windows run along the ground
	// floor on Národní and round the corner onto Smetanovo nábřeží, facing the theatre and the river; the entrance
	// is on Národní. A walk-in room behind the Národní front.
	{

		const f = edgeOf( 21649685, 7 ), g = edgeOf( 21649685, 0 );
		if ( f ) {

			const s = f.len * 0.5;
			const front = venueFront( 'slavia', f, s, { door: 3.6 } );
			const room = interior( 'Kavárna Slavia', 'slavia', f, s, { w: f.len - 2.2, maxD: 10, door: 3.6, h: 4.2 } );
			if ( room ) {

				// The windows show the room: open the house front along it, at window height.
				const c = frame( f, s ), X = [ c.n[ 1 ], - c.n[ 0 ] ];
				cutout( c.x, room.y + 0.5, c.z, X, room.w / 2 - 0.3, 0.45, room.y + 3.25 );
				front.room = true;

			}

		}

		if ( g ) venueFront( 'slavia', g, g.len * 0.5, { windowsOnly: true } );

	}

	// Fronts without street data beside them: found from the footprints, facing a point in the street.
	for ( const [ X0, Y0, TX, TY, h, text, style ] of [
		[ - 395, 783, - 370, 783, 7.2, 'MÁNES', 'letters' ],
		[ 72, 398, 55, 398, 6.0, 'QUADRIO', 'letters' ]
	] ) {

		const f = frontFacing( ...S( X0, Y0 ), ...S( TX, TY ) );
		if ( f ) sign( f, f.t * f.len, h, text, style );

	}

	// --- The piazzetta of the National Theatre (náměstí Václava Havla): Kurt Gebauer's red Heart for Václav Havel
	// with his signature (2016) facing the theatre, Josef Malejovský's bronze Rebirth (1983) on its round plinth at
	// the corner by Divadelní and Nová scéna; Nová scéna's granite-clad pillars along its ground floor.
	{

		const pz = ctx.terraces?.piazzetta;
		if ( pz ) {

			const y = + pz.level.toFixed( 2 );
			places.piazzetta = { heart: [ - 303, y, 377.5, 0 ], statue: [ - 342.5, y, 377, Math.PI / 2 + 0.4 ], pillars: [] };
			const b = null; // Nová scéna overhangs its recessed ground floor (no free-standing pillars, street photos)
			if ( b ) {

				const r = b.poly.outer;
				for ( let i = 0; i < r.length; i ++ ) {

					const [ ax, ay ] = r[ i ], [ bx, by ] = r[ ( i + 1 ) % r.length ];
					const len = Math.hypot( bx - ax, by - ay );
					if ( len < 8 ) continue;
					let nx = ( by - ay ) / len, ny = - ( bx - ax ) / len;
					if ( buildingAt( ( ax + bx ) / 2 + nx * 0.5, ( ay + by ) / 2 + ny * 0.5 ) === b.id ) { nx = - nx; ny = - ny; }
					if ( inKept( ( ax + bx ) / 2 + nx * 1.5, ( ay + by ) / 2 + ny * 1.5 ) ) continue;
					const n = Math.round( len / 6.5 );
					for ( let k = 0; k <= n; k ++ ) {

						const X = ax + ( bx - ax ) * k / n - nx * 0.45, Y = ay + ( by - ay ) * k / n - ny * 0.45;
						const [ x, z ] = L( X, Y );
						places.piazzetta.pillars.push( [ x, + ( terrainAt( X + nx, Y + ny ) + streetData.raise( streetData.at( X + nx, Y + ny ).Fk ) ).toFixed( 2 ), z, + Math.atan2( bx - ax, - ( by - ay ) ).toFixed( 3 ) ] );

					}

				}

			}

		}

	}

	// --- Šítkov water tower (no footprint of its own; its dome in the aerial photo) and the Žofín music pavilion.
	{

		places.sitkov = { x: - 423.5, z: 780.2, y: + yAt( ...S( - 430, 786 ) ).toFixed( 2 ), rot: 0.21 };
		const [ BX, BY ] = S( - 452, 644 );
		const by = yAt( BX, BY );
		places.bandstand = { x: - 452, z: 644, y: + by.toFixed( 2 ), r: 5.6, rot: Math.PI };
		zone( - 452, 644, [ 1, 0 ], 4.6, 4.6, { y: + ( by + 0.75 ).toFixed( 2 ) } );
		zone( - 452, 644 - 5.6 - 0.6, [ 1, 0 ], 1.1, 0.8, { y0: + ( by + 0.75 ).toFixed( 2 ), y1: + by.toFixed( 2 ), along: [ 0, - 1 ], steps: 3 } );
	}

	// --- arcades and passages through houses (tools/openings.mjs): floor heights from the pavement at their ends,
	// walkable zones sloping between them.
	places.openings = [];
	const groundY = ( X, Y ) => terrainAt( X, Y ) + streetData.raise( streetData.at( X, Y ).Fk );
	for ( const o of ctx.openings || [] ) {

		const [ lx, lz ] = LV( o.ux, o.uy );
		const across = [ lz, - lx ]; // zone u axis, so that the zone's n axis (its slope) runs along the opening
		if ( o.kind === 'passage' ) {

			const end = s => groundY( o.X + o.ux * s * ( o.len / 2 + 0.8 ), o.Y + o.uy * s * ( o.len / 2 + 0.8 ) );
			const y0 = + end( - 1 ).toFixed( 2 ), y1 = + end( 1 ).toFixed( 2 );
			const [ x, z ] = L( o.X, o.Y );
			places.openings.push( { kind: 'passage', x, z, lx, lz, len: o.len, w: o.w, h: o.h, y0, y1 } );
			zone( x, z, across, o.w / 2 - 0.15, o.len / 2 + 0.35, { y0, y1, along: [ lx, lz ], ceil: + ( Math.max( y0, y1 ) + o.h - 0.2 ).toFixed( 2 ) } );

		} else {

			const end = s => groundY( o.X + o.ux * s * ( o.len / 2 - 0.5 ) + o.nx * 0.9, o.Y + o.uy * s * ( o.len / 2 - 0.5 ) + o.ny * 0.9 );
			const y0 = + end( - 1 ).toFixed( 2 ), y1 = + end( 1 ).toFixed( 2 );
			const [ x, z ] = L( o.X, o.Y ), [ nx, nz ] = LV( o.nx, o.ny );
			places.openings.push( { kind: 'arcade', x, z, lx, lz, nx, nz, len: o.len, depth: o.depth, h: o.h, y0, y1 } );
			// From just outside the street face to 0.3 m short of the back wall.
			const depth = o.depth - 0.3;
			const mid = ( depth - 0.3 ) / 2;
			zone( x - nx * mid, z - nz * mid, across, ( depth + 0.3 ) / 2, o.len / 2, { y0, y1, along: [ lx, lz ], ceil: + ( Math.max( y0, y1 ) + o.h - 0.2 ).toFixed( 2 ) } );

		}

	}

	// --- bridges (OSM bridge=yes ways, clipped to the area): a deck strip per way segment at the height of the land
	// at its ends, walkable; piers down to the river under the road decks every 25 m (src/bridges.js).
	places.bridges = [];
	places.piers = [];
	const BRIDGE_W = { footway: 3.0, path: 2.5, cycleway: 2.5, pedestrian: 6, service: 4.5, residential: 7, unclassified: 7, tertiary: 7, secondary: 8, primary: 9, tram: 3.2 };
	const clipArea = ( [ ax, ay ], [ bx, by ] ) => {

		let t0 = 0, t1 = 1;
		const dx = bx - ax, dy = by - ay;
		for ( const [ p, q ] of [ [ - dx, ax - AREA.xmin ], [ dx, AREA.xmax - ax ], [ - dy, ay - AREA.ymin ], [ dy, AREA.ymax - ay ] ] ) {

			if ( Math.abs( p ) < 1e-9 ) {

				if ( q < 0 ) return null;
				continue;

			}

			const r = q / p;
			if ( p < 0 ) t0 = Math.max( t0, r );
			else t1 = Math.min( t1, r );

		}

		return t1 - t0 > 1e-3 ? [ [ ax + dx * t0, ay + dy * t0 ], [ ax + dx * t1, ay + dy * t1 ] ] : null;

	};

	const bridgeSegs = [];
	for ( const w of streetData.ways ) {

		const t = w.tags;
		if ( ! t.bridge || t.bridge === 'no' || t.highway === 'steps' ) continue;
		const kind = t.railway === 'tram' ? 'tram' : t.highway;
		if ( ! BRIDGE_W[ kind ] || w.pts.length < 2 ) continue;
		const width = parseFloat( t.width ) || BRIDGE_W[ kind ];
		// Deck height at an end: the land there, or the nearest land within 14 m (abutments inside the river outline).
		const land = p => {

			if ( p.X < AREA.xmin || p.X > AREA.xmax || p.Y < AREA.ymin || p.Y > AREA.ymax ) return null;
			for ( let r = 0; r <= 14; r += 1 ) for ( let a = 0; a < ( r ? 16 : 1 ); a ++ ) {

				const X = p.X + r * Math.cos( a * Math.PI / 8 ), Y = p.Y + r * Math.sin( a * Math.PI / 8 );
				if ( ! riverAt( X, Y ) ) return groundY( X, Y );

			}

			return null;

		};
		const [ h0, h1 ] = [ land( w.pts[ 0 ] ), land( w.pts[ w.pts.length - 1 ] ) ];
		if ( h0 === null && h1 === null ) continue;
		const total = w.pts.slice( 1 ).reduce( ( a, p, i ) => a + Math.hypot( p.X - w.pts[ i ].X, p.Y - w.pts[ i ].Y ), 0 );
		let s = 0;
		const heightAt = d => h0 !== null && h1 !== null ? h0 + ( h1 - h0 ) * d / total : h0 ?? h1;
		for ( let i = 1; i < w.pts.length; i ++ ) {

			const a = w.pts[ i - 1 ], b = w.pts[ i ], len = Math.hypot( b.X - a.X, b.Y - a.Y );
			const c = clipArea( [ a.X, a.Y ], [ b.X, b.Y ] );
			if ( c && Math.hypot( c[ 1 ][ 0 ] - c[ 0 ][ 0 ], c[ 1 ][ 1 ] - c[ 0 ][ 1 ] ) > 0.3 ) {

				const da = s + Math.hypot( c[ 0 ][ 0 ] - a.X, c[ 0 ][ 1 ] - a.Y ), db = s + Math.hypot( c[ 1 ][ 0 ] - a.X, c[ 1 ][ 1 ] - a.Y );
				bridgeSegs.push( { A: c[ 0 ], B: c[ 1 ], w: width, kind, ya: heightAt( da ), yb: heightAt( db ) } );

			}

			s += len;

		}

	}

	// Ways side by side on one bridge (the road and its footways) make one deck: cluster parallel overlapping
	// segments and give each cluster one deck over them all, in the frame of its longest segment.
	{

		const frameOf = g => {

			const l = Math.hypot( g.B[ 0 ] - g.A[ 0 ], g.B[ 1 ] - g.A[ 1 ] );
			return { l, ux: ( g.B[ 0 ] - g.A[ 0 ] ) / l, uy: ( g.B[ 1 ] - g.A[ 1 ] ) / l };

		};

		const used = new Set(), decks = [];
		for ( const g of [ ...bridgeSegs ].sort( ( a, b ) => frameOf( b ).l - frameOf( a ).l ) ) {

			if ( used.has( g ) ) continue;
			used.add( g );
			const f = frameOf( g );
			const local = ( [ X, Y ] ) => [ ( X - g.A[ 0 ] ) * f.ux + ( Y - g.A[ 1 ] ) * f.uy, - ( X - g.A[ 0 ] ) * f.uy + ( Y - g.A[ 1 ] ) * f.ux ];
			let a0 = 0, a1 = f.l, l0 = - g.w / 2, l1 = g.w / 2;
			for ( const h of bridgeSegs ) {

				if ( used.has( h ) ) continue;
				const fh = frameOf( h );
				if ( Math.abs( fh.ux * f.ux + fh.uy * f.uy ) < Math.cos( 15 * Math.PI / 180 ) ) continue;
				const [ pa, pb ] = [ local( h.A ), local( h.B ) ];
				if ( Math.max( Math.abs( pa[ 1 ] ), Math.abs( pb[ 1 ] ) ) > 9 || Math.max( pa[ 0 ], pb[ 0 ] ) < - 2 || Math.min( pa[ 0 ], pb[ 0 ] ) > f.l + 2 ) continue;
				used.add( h );
				a0 = Math.min( a0, pa[ 0 ], pb[ 0 ] ); a1 = Math.max( a1, pa[ 0 ], pb[ 0 ] );
				l0 = Math.min( l0, pa[ 1 ] - h.w / 2, pb[ 1 ] - h.w / 2 ); l1 = Math.max( l1, pa[ 1 ] + h.w / 2, pb[ 1 ] + h.w / 2 );

			}

			const mid = ( l0 + l1 ) / 2, at = a => [ g.A[ 0 ] + f.ux * a - f.uy * mid, g.A[ 1 ] + f.uy * a + f.ux * mid ];
			const y = a => g.ya + ( g.yb - g.ya ) * Math.max( 0, Math.min( 1, a / f.l ) );
			decks.push( { A: at( a0 ), B: at( a1 ), w: l1 - l0, kind: g.kind, ya: y( a0 ), yb: y( a1 ) } );

		}

		bridgeSegs.length = 0;
		bridgeSegs.push( ...decks );

	}

	for ( const g of bridgeSegs ) {

		const [ ax, az ] = L( ...g.A ), [ bx, bz ] = L( ...g.B );
		const len = Math.hypot( bx - ax, bz - az ), lx = ( bx - ax ) / len, lz = ( bz - az ) / len;
		const y0 = + g.ya.toFixed( 2 ), y1 = + g.yb.toFixed( 2 );
		places.bridges.push( { x0: + ax.toFixed( 2 ), z0: + az.toFixed( 2 ), x1: + bx.toFixed( 2 ), z1: + bz.toFixed( 2 ), w: g.w, y0, y1, kind: g.kind } );
		zone( ( ax + bx ) / 2, ( az + bz ) / 2, [ lz, - lx ], g.w / 2, len / 2 + 0.2, { y0, y1, along: [ lx, lz ] } );
		if ( g.w >= 6 ) for ( let d = 12; d < len; d += 25 ) {

			const X = g.A[ 0 ] + ( g.B[ 0 ] - g.A[ 0 ] ) * d / len, Y = g.A[ 1 ] + ( g.B[ 1 ] - g.A[ 1 ] ) * d / len;
			if ( riverAt( X, Y ) ) places.piers.push( [ ...L( X, Y ), + ( y0 + ( y1 - y0 ) * d / len ).toFixed( 2 ), + Math.atan2( lx, lz ).toFixed( 3 ) ] );

		}

	}

	ctx.onBridge = ( X, Y ) => bridgeSegs.some( g => {

		const dx = g.B[ 0 ] - g.A[ 0 ], dy = g.B[ 1 ] - g.A[ 1 ], l2 = dx * dx + dy * dy;
		const t = Math.max( 0, Math.min( 1, ( ( X - g.A[ 0 ] ) * dx + ( Y - g.A[ 1 ] ) * dy ) / l2 ) );
		return Math.hypot( X - g.A[ 0 ] - t * dx, Y - g.A[ 1 ] - t * dy ) < g.w / 2 + 1;

	} );
	console.log( `places: ${bridgeSegs.length} bridge deck segments, ${places.piers.length} piers` );

	// --- tram stops: each platform's axis, length and the side its tracks are on, for the shelter, the stop sign
	// and the departure board (src/stops.js).
	places.stops = [];
	const trams = ( ctx.tramPaths || [] ).flatMap( p => p.slice( 1 ).map( ( b, i ) => [ p[ i ], b ] ) );
	for ( const p of streetData.platforms || [] ) {

		const pts = p.pts;
		// Axis: the longest edge's direction; extent along it and across it.
		let best = null;
		for ( let i = 0; i + 1 < pts.length; i ++ ) {

			const l = Math.hypot( pts[ i + 1 ][ 0 ] - pts[ i ][ 0 ], pts[ i + 1 ][ 1 ] - pts[ i ][ 1 ] );
			if ( ! best || l > best.l ) best = { l, ux: ( pts[ i + 1 ][ 0 ] - pts[ i ][ 0 ] ) / l, uy: ( pts[ i + 1 ][ 1 ] - pts[ i ][ 1 ] ) / l };

		}

		const { ux, uy } = best;
		const us = pts.map( ( [ X, Y ] ) => X * ux + Y * uy ), ns = pts.map( ( [ X, Y ] ) => - X * uy + Y * ux );
		const u0 = Math.min( ...us ), u1 = Math.max( ...us ), n0 = Math.min( ...ns ), n1 = Math.max( ...ns );
		const cu = ( u0 + u1 ) / 2, cn = p.closed ? ( n0 + n1 ) / 2 : ns.reduce( ( a, v ) => a + v, 0 ) / ns.length;
		const CX = cu * ux - cn * uy, CY = cu * uy + cn * ux;
		const width = p.closed ? n1 - n0 : p.half * 2;
		// Tracks: nearest tram line to the platform's middle; n points towards it.
		let tn = 1, td = Infinity;
		for ( const [ [ ax, ay ], [ bx, by ] ] of trams ) {

			const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
			const t = Math.max( 0, Math.min( 1, ( ( CX - ax ) * dx + ( CY - ay ) * dy ) / l2 ) );
			const d = Math.hypot( CX - ax - t * dx, CY - ay - t * dy );
			if ( d < td ) {

				td = d;
				tn = ( - ( ax + t * dx - CX ) * uy + ( ay + t * dy - CY ) * ux ) >= 0 ? 1 : - 1;

			}

		}

		if ( td > 25 ) continue; // a bus stop
		const [ x, z ] = L( CX, CY ), [ lx, lz ] = LV( ux, uy ), [ nx, nz ] = LV( - uy * tn, ux * tn );
		places.stops.push( { name: p.name, x, z, lx, lz, nx, nz, len: + ( u1 - u0 ).toFixed( 2 ), width: + Math.max( 1.6, width ).toFixed( 2 ), y: + Math.max( ...[ - 0.6, 0, 0.6 ].map( o => groundY( CX - uy * tn * o, CY + ux * tn * o ) ) ).toFixed( 2 ), island: p.island, shelter: p.shelter, bench: p.bench, bin: p.bin, board: p.board } );

	}

	places.life = streetLife( ctx, L );
	return places;

}

// Walking lines on the pavements (both sides of every kerbed street, half way across the pavement), along
// pedestrian streets, driving lanes and parking spots along the kerbs.
function streetLife( ctx, L ) {

	const { streetData, terrainAt, buildingAt, keptIds, riverAt } = ctx;
	const blocked = ( X, Y ) => keptIds.has( buildingAt( X, Y ) ) || riverAt( X, Y );
	const walks = [], drives = [], parked = [];
	const rnd = ( () => {

		let s = 12345;
		return () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;

	} )();

	const offsetLine = ( chain, offsetAt ) => {

		const out = [];
		const { pts } = chain;
		for ( let i = 0; i < pts.length; i ++ ) {

			const a = pts[ Math.max( 0, i - 1 ) ], b = pts[ Math.min( pts.length - 1, i + 1 ) ];
			const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) || 1;
			const nx = - ( b[ 1 ] - a[ 1 ] ) / l, ny = ( b[ 0 ] - a[ 0 ] ) / l;
			const o = offsetAt( i );
			out.push( Number.isFinite( o ) ? [ pts[ i ][ 0 ] + nx * o, pts[ i ][ 1 ] + ny * o, nx, ny ] : null );

		}

		return out;

	};

	const flush = ( list, run ) => {

		if ( run.length >= 6 ) list.push( run.flatMap( ( [ X, Y ] ) => L( X, Y ) ) );

	};

	for ( const chain of streetData.kerbs.chains ) {

		for ( const [ side, sign ] of [ [ 'left', 1 ], [ 'right', - 1 ] ] ) {

			const line = offsetLine( chain, i => {

				const rule = chain.rule[ side ][ i ];
				if ( rule === 'none' ) return NaN;
				const pave = rule === 'front' ? Math.max( 0.8, chain.outer[ side ][ i ] - 2 ) : 3;
				return sign * ( chain[ side ][ i ] + pave / 2 );

			} );

			let run = [];
			for ( const p of line ) {

				if ( ! p || blocked( p[ 0 ], p[ 1 ] ) || streetData.kerbs.sdf( p[ 0 ], p[ 1 ] ) < 0.4 ) { // off the carriageway

					flush( walks, run );
					run = [];

				} else if ( ! run.length || Math.hypot( p[ 0 ] - run[ run.length - 1 ][ 0 ], p[ 1 ] - run[ run.length - 1 ][ 1 ] ) > 2.5 ) run.push( p );

			}

			flush( walks, run );

		}

		// Driving lanes (right-hand traffic) and parked cars along the kerbs.
		if ( ! [ 'residential', 'tertiary', 'secondary', 'primary', 'unclassified' ].includes( chain.highway ) ) continue;
		const width = i => chain.left[ i ] + chain.right[ i ];
		const centre = i => ( chain.left[ i ] - chain.right[ i ] ) / 2;
		const meanWidth = chain.pts.reduce( ( s, _, i ) => s + width( i ), 0 ) / chain.pts.length;
		if ( meanWidth < 4.2 || chain.pts.length < 10 ) continue;
		const lanes = chain.oneway ? [ [ chain.oneway, 0 ] ] : [ [ 1, - 1.5 ], [ - 1, 1.5 ] ];
		const parkRight = meanWidth - 2.2 >= ( chain.oneway ? 3.6 : 6 );
		const parkLeft = parkRight && meanWidth - 4.4 >= ( chain.oneway ? 3 : 6 );
		const laneShift = ( parkRight ? 1.1 : 0 ) - ( parkLeft ? 1.1 : 0 );
		for ( const [ dir, off ] of lanes ) {

			const line = offsetLine( chain, i => centre( i ) + off + laneShift ).filter( Boolean ).map( ( [ X, Y ] ) => [ X, Y ] );
			if ( dir < 0 ) line.reverse();
			drives.push( line.flatMap( ( [ X, Y ] ) => L( X, Y ) ) );

		}

		// Cars park along the house fronts (not along the river or a park).
		const houses = side => chain.rule[ side ].filter( r => r === 'front' ).length > chain.rule[ side ].length / 2;
		for ( const [ on, side, sign ] of [ [ parkRight, 'right', - 1 ], [ parkLeft, 'left', 1 ] ] ) {

			if ( ! on || ! houses( side ) ) continue;
			const line = offsetLine( chain, i => sign * ( chain[ side ][ i ] - 1.1 ) );
			let since = 0;
			for ( let i = 7; i < line.length - 7; i ++ ) {

				since += 1.5;
				if ( since < 5.6 ) continue;
				since = 0;
				const p = line[ i ];
				if ( ! p || blocked( p[ 0 ], p[ 1 ] ) || ctx.inPark( p[ 0 ], p[ 1 ] ) || rnd() > 0.5 ) continue;
				const [ x, z ] = L( p[ 0 ], p[ 1 ] );
				const q = line[ i + 1 ] || p;
				const rot = Math.atan2( q[ 0 ] - p[ 0 ], - ( q[ 1 ] - p[ 1 ] ) ); // model faces +z → along the street
				parked.push( x, + terrainAt( p[ 0 ], p[ 1 ] ).toFixed( 2 ), z, + ( rot + ( rnd() < 0.5 ? Math.PI : 0 ) ).toFixed( 3 ) );

			}

		}

	}

	// Pedestrian streets, lanes and squares without kerbs: along their centre lines.
	for ( const w of streetData.ways ) {

		const t = w.tags;
		if ( ! [ 'pedestrian', 'footway', 'living_street' ].includes( t.highway ) || t.area === 'yes' || t.footway === 'sidewalk' || t.tunnel || t.layer ) continue;
		let run = [];
		for ( let i = 1; i < w.pts.length; i ++ ) {

			const a = w.pts[ i - 1 ], b = w.pts[ i ];
			const n = Math.max( 1, Math.round( Math.hypot( b.X - a.X, b.Y - a.Y ) / 2 ) );
			for ( let k = i === 1 ? 0 : 1; k <= n; k ++ ) {

				const X = a.X + ( b.X - a.X ) * k / n, Y = a.Y + ( b.Y - a.Y ) * k / n;
				if ( blocked( X, Y ) || ! streetData.inArea( X, Y ) ) {

					flush( walks, run );
					run = [];

				} else run.push( [ X, Y ] );

			}

		}

		flush( walks, run );

	}

	console.log( `places: ${walks.length} walking lines, ${drives.length} driving lanes, ${parked.length / 4} parked cars` );
	return { walks, drives, parked, trams: tramRoutes( ctx, L ) };

}

// Tram routes: ZABAGED gives one centre line per double track, in pieces meeting at junctions. Pieces are joined into
// through routes (turning less than 50° at a junction), each run both ways on its right-hand track (1.5 m off the
// centre), cut to the modelled area and to dry land (the bridge deck over the Vltava is not modelled); stops where
// OSM has a tram stop.
function tramRoutes( ctx, L ) {

	const { AREA, riverAt, streetData } = ctx;
	const pieces = ( ctx.tramPaths || [] ).filter( p => p.length >= 2 );
	const nodes = [];
	const nodeOf = ( [ X, Y ] ) => {

		let n = nodes.find( q => Math.hypot( q.X - X, q.Y - Y ) < 2.5 );
		if ( ! n ) nodes.push( n = { X, Y, edges: [] } );
		return n;

	};

	pieces.forEach( ( p, k ) => {

		const a = nodeOf( p[ 0 ] ), b = nodeOf( p[ p.length - 1 ] );
		a.edges.push( { k, to: b, pts: p } );
		b.edges.push( { k, to: a, pts: [ ...p ].reverse() } );

	} );

	const heading = ( p, end ) => {

		const [ a, b ] = end ? [ p[ p.length - 2 ], p[ p.length - 1 ] ] : [ p[ 0 ], p[ 1 ] ];
		return Math.atan2( b[ 1 ] - a[ 1 ], b[ 0 ] - a[ 0 ] );

	};

	const routes = [];
	const walk = ( node, used, pts ) => {

		let extended = false;
		for ( const e of node.edges ) {

			if ( used.has( e.k ) ) continue;
			if ( pts.length ) {

				let turn = heading( e.pts, false ) - heading( pts, true );
				turn = Math.atan2( Math.sin( turn ), Math.cos( turn ) );
				if ( Math.abs( turn ) > 50 * Math.PI / 180 ) continue;

			}

			extended = true;
			walk( e.to, new Set( [ ...used, e.k ] ), [ ...pts, ...( pts.length ? e.pts.slice( 1 ) : e.pts ) ] );

		}

		if ( ! extended && pts.length ) routes.push( pts );

	};

	for ( const n of nodes ) if ( n.edges.length === 1 ) walk( n, new Set(), [] );

	const stops = [];
	for ( const n of streetData.nodes.values() ) if ( n.tags.railway === 'tram_stop' || ( n.tags.public_transport === 'stop_position' && n.tags.tram === 'yes' ) ) stops.push( n );

	const inside = ( X, Y ) => X > AREA.xmin + 5 && X < AREA.xmax - 5 && Y > AREA.ymin + 5 && Y < AREA.ymax - 5 && ( ! riverAt( X, Y ) || ctx.onBridge?.( X, Y ) );
	const out = [];
	for ( const route of routes ) {

		// Densify to 2 m, offset to the right-hand track.
		const dense = [];
		for ( let i = 1; i < route.length; i ++ ) {

			const [ ax, ay ] = route[ i - 1 ], [ bx, by ] = route[ i ];
			const n = Math.max( 1, Math.ceil( Math.hypot( bx - ax, by - ay ) / 2 ) );
			for ( let k = i === 1 ? 0 : 1; k <= n; k ++ ) dense.push( [ ax + ( bx - ax ) * k / n, ay + ( by - ay ) * k / n ] );

		}

		const track = dense.map( ( p, i ) => {

			const a = dense[ Math.max( 0, i - 2 ) ], b = dense[ Math.min( dense.length - 1, i + 2 ) ];
			const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) || 1;
			return [ p[ 0 ] + ( b[ 1 ] - a[ 1 ] ) / l * 1.5, p[ 1 ] - ( b[ 0 ] - a[ 0 ] ) / l * 1.5 ];

		} );

		// The longest run inside the area, on land.
		let best = [], run = [];
		for ( const p of track ) {

			if ( inside( ...p ) ) run.push( p );
			else {

				if ( run.length > best.length ) best = run;
				run = [];

			}

		}

		if ( run.length > best.length ) best = run;
		if ( best.length < 40 ) continue;

		let s = 0;
		const at = [ 0 ];
		for ( let i = 1; i < best.length; i ++ ) at.push( s += Math.hypot( best[ i ][ 0 ] - best[ i - 1 ][ 0 ], best[ i ][ 1 ] - best[ i - 1 ][ 1 ] ) );
		const stopAt = [];
		for ( const st of stops ) {

			let bi = - 1, bd = 9;
			best.forEach( ( p, i ) => {

				const d = Math.hypot( p[ 0 ] - st.X, p[ 1 ] - st.Y );
				if ( d < bd ) {

					bd = d;
					bi = i;

				}

			} );
			if ( bi >= 0 && ! stopAt.some( v => Math.abs( v - at[ bi ] ) < 20 ) ) stopAt.push( + at[ bi ].toFixed( 1 ) );

		}

		out.push( { pts: best.flatMap( ( [ X, Y ] ) => L( X, Y ) ), stops: stopAt.sort( ( a, b ) => a - b ) } );

	}

	console.log( `places: ${out.length} tram routes, ${out.reduce( ( n, r ) => n + r.stops.length, 0 )} stops` );
	return out;

}
