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

	const places = { zones: [], cutouts: [], seats: [], signs: [], interiors: [], terraces: [], lights: [] };

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

	// A walk-in room behind a front: as wide as the front allows (≤ maxW), as deep as the house (≤ maxD).
	function interior( name, style, f, s, { maxW = 8, maxD = 9, door = 0 } = {} ) {

		const w = Math.min( maxW, f.len - 1.2, 2 * Math.min( s, f.len - s ) - 0.6 );
		let depth = maxD;
		for ( let k = - w / 2; k <= w / 2 + 1e-6; k += 0.5 ) {

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
		const room = { name, style, x: c.x, z: c.z, u: c.u, n: c.n, w: + w.toFixed( 2 ), d: + depth.toFixed( 2 ), h: + Math.min( 3.6, floorH * 0.95 ).toFixed( 2 ), y: + ( c.y + 0.02 ).toFixed( 2 ), door, doorW: 1.3, doorH: 2.5 };
		places.interiors.push( room );

		// Walkable: the room (0.3 m inside its walls) and the doorway through the front wall.
		const inward = ( d ) => [ c.x - c.n[ 0 ] * d, c.z - c.n[ 1 ] * d ];
		const [ rx, rz ] = inward( depth / 2 );
		zone( rx, rz, c.u, w / 2 - 0.3, depth / 2 - 0.3, { y: room.y } );
		const [ dx, dz ] = inward( 0 );
		zone( dx + c.u[ 0 ] * door, dz + c.u[ 1 ] * door, c.u, room.doorW / 2 - 0.15, 0.7, { y: room.y } );
		cutout( dx + c.u[ 0 ] * door, room.y - 0.5, dz + c.u[ 1 ] * door, c.u, room.doorW / 2, 0.45, room.y + room.doorH );
		return room;

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

	// --- Hostinec U Rotundy (Karoliny Světlé 17, house no. 1035)
	{

		const node = nodeById( 552405058 );
		const f = facadeNear( node.X, node.Y, { number: 1035 } ) || facadeNear( node.X, node.Y );
		const s = Math.max( 3, Math.min( f.len - 3, f.t * f.len ) );
		interior( 'Hostinec U Rotundy', 'pub', f, s, { maxW: 8, maxD: 9 } );
		sign( f, s, 3.0, 'HOSTINEC U ROTUNDY', 'pub' );
		sign( f, s + 3.2 < f.len - 0.6 ? s + 3.2 : s - 3.2, 3.4, 'Pilsner Urquell', 'beer' );
		if ( f.len > 9 ) terrace( f, Math.max( 1.5, s - 4.5 ), Math.max( 1.5, s - 4.5 ), 1.4, 'pub' );

	}

	// --- Standard Café (Karoliny Světlé 23)
	{

		const node = nodeById( 1257276111 );
		const f = facadeNear( node.X, node.Y );
		const s = Math.max( 3, Math.min( f.len - 3, f.t * f.len ) );
		interior( 'Standard', 'cafe', f, s, { maxW: 7, maxD: 8 } );
		sign( f, s, 2.95, 'STANDARD', 'cafe' );
		terrace( f, Math.min( f.len - 1.5, s + 2.6 ), Math.min( f.len - 1.5, s + 2.6 ), 1.1, 'cafe' );

	}

	// --- Champagneria (Průchodní 2): bistro tables in the gas-lit passage, festoon lights across it.
	{

		const node = nodeById( 4781897274 );
		const f = facadeNear( node.X, node.Y );
		const s = Math.max( 3, Math.min( f.len - 3, f.t * f.len ) );
		interior( 'Champagneria', 'champagne', f, s, { maxW: 7, maxD: 8 } );
		sign( f, s, 2.95, 'CHAMPAGNERIA', 'champagne' );
		const free = side => {

			let d = 0.5;
			while ( d < 12 && ! inKept( f.a[ 0 ] + f.ux * side + f.n[ 0 ] * d, f.a[ 1 ] + f.uy * side + f.n[ 1 ] * d ) ) d += 0.25;
			return d;

		};

		const across = Math.min( free( s ), 9 );
		terrace( f, Math.max( 1.5, s - 4.8 ), Math.max( 1.5, s - 2.4 ), Math.min( 1.3, across * 0.3 ), 'champagne' );
		terrace( f, Math.min( f.len - 1.5, s + 2.4 ), Math.min( f.len - 1.5, s + 4.8 ), Math.min( 1.3, across * 0.3 ), 'champagne' );
		for ( let k = - 2; k <= 2; k ++ ) {

			const c = frame( f, Math.max( 0.5, Math.min( f.len - 0.5, s + k * 2.5 ) ) );
			places.lights.push( { a: [ c.x, + ( c.y + 3.6 ).toFixed( 2 ), c.z ], b: [ + ( c.x + c.n[ 0 ] * across ).toFixed( 2 ), + ( c.y + 3.4 ).toFixed( 2 ), + ( c.z + c.n[ 1 ] * across ).toFixed( 2 ) ] } );

		}

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

				if ( ! p || blocked( p[ 0 ], p[ 1 ] ) ) {

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
		const parkRight = meanWidth - 2.2 >= ( chain.oneway ? 3 : 6 );
		const parkLeft = parkRight && meanWidth - 4.4 >= ( chain.oneway ? 3 : 6 );
		const laneShift = ( parkRight ? 1.1 : 0 ) - ( parkLeft ? 1.1 : 0 );
		for ( const [ dir, off ] of lanes ) {

			const line = offsetLine( chain, i => centre( i ) + off + laneShift ).filter( Boolean ).map( ( [ X, Y ] ) => [ X, Y ] );
			if ( dir < 0 ) line.reverse();
			drives.push( line.flatMap( ( [ X, Y ] ) => L( X, Y ) ) );

		}

		for ( const [ on, side, sign ] of [ [ parkRight, 'right', - 1 ], [ parkLeft, 'left', 1 ] ] ) {

			if ( ! on ) continue;
			const line = offsetLine( chain, i => sign * ( chain[ side ][ i ] - 1.1 ) );
			let since = 0;
			for ( let i = 7; i < line.length - 7; i ++ ) {

				since += 1.5;
				if ( since < 5.6 ) continue;
				since = 0;
				const p = line[ i ];
				if ( ! p || blocked( p[ 0 ], p[ 1 ] ) || ctx.inPark( p[ 0 ], p[ 1 ] ) || rnd() > 0.65 ) continue;
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
	return { walks, drives, parked };

}
