// Kerb lines: where the raised pavements end and the carriageways begin.
//
// OpenStreetMap gives each street's centre line and which sides have a pavement (sidewalk tags), but rarely
// widths, and in the Old Town its centre lines can be metres off. The house fronts (RÚIAN footprints) are
// exact, so a kerb next to houses runs at the pavement's width from the house fronts: every 1.5 m along a
// street the distance to the houses on either side is measured, and a low running quantile along the street
// takes the line of the fronts (ignoring doorways, passages and side-street mouths) so the kerb runs straight.
// Where a side has no houses (the riverfront, a square), the carriageway edge is found on the 12.5 cm aerial
// photo (ČÚZK ORTOFOTO): a profile across the street is followed from the centre while it still looks like this
// street's carriageway, and only profiles that end at something brighter or rougher (a kerb, a pavement) count.
//
// Consecutive OSM ways of a street are joined into chains. The carriageway is the union of the chains' strips,
// a signed distance field (< 0 on the road) on a 0.25 m grid: segments of one chain meet with round joints,
// different streets with rounded kerb corners (a smooth minimum).

import { readFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';

const RAW = new URL( '../data/raw/', import.meta.url );
const PHOTO_CELL = 0.125;
const STEP = 1.5; // station spacing along a street
const FIELD_CELL = 0.25;
const CORNER = 3; // smooth-minimum size where streets meet (kerb corner radius ≈ CORNER / 2)

async function loadPhoto( AREA ) {

	const tiles = [];
	for ( let i = 0; i < 2; i ++ ) for ( let j = 0; j < 2; j ++ ) tiles.push( { i, j, img: jpeg.decode( await readFile( new URL( `ortho-hi-${i}-${j}.jpg`, RAW ) ), { useTArray: true, maxMemoryUsageInMB: 2048 } ) } );
	const tw = tiles[ 0 ].img.width, th = tiles[ 0 ].img.height;
	const W = tw * 2, H = th * 2;
	const lum = new Uint8Array( W * H );
	for ( const { i, j, img } of tiles ) {

		for ( let y = 0; y < th; y ++ ) for ( let x = 0; x < tw; x ++ ) {

			const s = ( y * tw + x ) * 4;
			lum[ ( j * th + y ) * W + i * tw + x ] = Math.round( 0.3 * img.data[ s ] + 0.59 * img.data[ s + 1 ] + 0.11 * img.data[ s + 2 ] );

		}

	}

	const at = ( X, Y ) => {

		const x = Math.floor( ( X - AREA.xmin ) / PHOTO_CELL ), y = Math.floor( ( AREA.ymax - Y ) / PHOTO_CELL );
		return x < 0 || y < 0 || x >= W || y >= H ? - 1 : lum[ y * W + x ];

	};

	return { W, H, lum, at };

}

// Joins consecutive ways of one street (same name, shared end node, turning less than 40°) into chains,
// flipping ways so a chain runs one way (their pts, half widths and sides flip with them).
function chainRoads( roads ) {

	const flip = r => ( { ...r, pts: [ ...r.pts ].reverse(), left: r.right, right: r.left, half: [ ...r.half ].reverse(), oneway: - r.oneway } );
	const dir = ( a, b ) => {

		const l = Math.hypot( b.X - a.X, b.Y - a.Y ) || 1;
		return [ ( b.X - a.X ) / l, ( b.Y - a.Y ) / l ];

	};

	const byEnd = new Map();
	roads.forEach( ( r, k ) => {

		for ( const p of [ r.pts[ 0 ], r.pts[ r.pts.length - 1 ] ] ) {

			if ( ! byEnd.has( p.id ) ) byEnd.set( p.id, [] );
			byEnd.get( p.id ).push( k );

		}

	} );

	const used = new Set();
	const chains = [];
	for ( let k = 0; k < roads.length; k ++ ) {

		if ( used.has( k ) ) continue;
		used.add( k );
		let parts = [ roads[ k ] ];

		// Extend at the end, then (flipped) at the start.
		for ( let pass = 0; pass < 2; pass ++ ) {

			for ( ;; ) {

				const last = parts[ parts.length - 1 ];
				const end = last.pts[ last.pts.length - 1 ];
				const d0 = dir( last.pts[ last.pts.length - 2 ], end );
				let next = null;
				for ( const n of byEnd.get( end.id ) || [] ) {

					if ( used.has( n ) || roads[ n ].name !== last.name ) continue;
					const r = roads[ n ].pts[ 0 ].id === end.id ? roads[ n ] : flip( roads[ n ] );
					const d1 = dir( r.pts[ 0 ], r.pts[ 1 ] );
					if ( d0[ 0 ] * d1[ 0 ] + d0[ 1 ] * d1[ 1 ] > Math.cos( 40 * Math.PI / 180 ) ) {

						next = { n, r };
						break;

					}

				}

				if ( ! next ) break;
				used.add( next.n );
				parts.push( next.r );

			}

			parts = parts.reverse().map( flip );

		}

		chains.push( parts );

	}

	return chains;

}

const quantile = ( values, q ) => {

	const s = values.filter( v => Number.isFinite( v ) ).sort( ( a, b ) => a - b );
	return s.length ? s[ Math.min( s.length - 1, Math.floor( s.length * q ) ) ] : NaN;

};

// Running quantile over ±n stations, then a ±m moving average (non-finite values are skipped).
function steady( values, n, q, m, min = 4 ) {

	const N = values.length;
	const qs = values.map( ( _, i ) => {

		const win = values.slice( Math.max( 0, i - n ), Math.min( N, i + n + 1 ) );
		return win.filter( Number.isFinite ).length >= Math.min( min, n + 1 ) ? quantile( win, q ) : NaN;

	} );

	return qs.map( ( _, i ) => {

		let s = 0, c = 0;
		for ( let k = Math.max( 0, i - m ); k <= Math.min( N - 1, i + m ); k ++ ) if ( Number.isFinite( qs[ k ] ) ) {

			s += qs[ k ];
			c ++;

		}

		return c ? s / c : NaN;

	} );

}

function measureChain( parts, photo, inBuilding ) {

	// Stations every ~1.5 m along the chain, with each part's tagged half width and pavement sides.
	const line = [];
	for ( const part of parts ) {

		for ( let i = 1; i < part.pts.length; i ++ ) {

			const a = part.pts[ i - 1 ], b = part.pts[ i ];
			const n = Math.max( 1, Math.round( Math.hypot( b.X - a.X, b.Y - a.Y ) / STEP ) );
			for ( let k = line.length ? 1 : 0; k <= n; k ++ ) {

				const t = k / n;
				line.push( { X: a.X + ( b.X - a.X ) * t, Y: a.Y + ( b.Y - a.Y ) * t, half: part.half[ i - 1 ] + ( part.half[ i ] - part.half[ i - 1 ] ) * t, part } );

			}

		}

	}

	const N = line.length;
	if ( N < 2 ) return null;

	// Parts without any sidewalk tags take the chain's tagged sides (most of their length).
	const tagged = line.filter( p => p.part.sidewalkTagged );
	const majority = side => tagged.length ? tagged.filter( p => p.part[ side ] ).length * 2 > tagged.length : false;
	const chainSides = { left: majority( 'left' ), right: majority( 'right' ) };
	for ( const p of line ) {

		p.left = p.part.sidewalkTagged ? p.part.left : chainSides.left;
		p.right = p.part.sidewalkTagged ? p.part.right : chainSides.right;

	}

	for ( let i = 0; i < N; i ++ ) {

		const a = line[ Math.max( 0, i - 2 ) ], b = line[ Math.min( N - 1, i + 2 ) ];
		const l = Math.hypot( b.X - a.X, b.Y - a.Y ) || 1;
		line[ i ].nx = - ( b.Y - a.Y ) / l; // left normal
		line[ i ].ny = ( b.X - a.X ) / l;

	}

	// The street space across each station: from a free point near the centre line, out to the houses on either
	// side (NaN: no house within 25 m). In narrow streets (houses on both sides) the centre line, often metres off
	// in OSM, is moved to the middle of the street space, smoothly along the street.
	const across = p => {

		let o0 = NaN;
		for ( let o = 0; o <= 6; o += 0.25 ) {

			if ( ! inBuilding( p.X + p.nx * o, p.Y + p.ny * o ) ) { o0 = o; break; }
			if ( ! inBuilding( p.X - p.nx * o, p.Y - p.ny * o ) ) { o0 = - o; break; }

		}

		if ( Number.isNaN( o0 ) ) return { left: NaN, right: NaN, inside: true };
		const out = sign => {

			for ( let o = 0.25; o <= 25; o += 0.25 ) if ( inBuilding( p.X + p.nx * ( o0 + sign * o ), p.Y + p.ny * ( o0 + sign * o ) ) ) return sign * ( o0 + sign * o );
			return NaN;

		};

		return { left: out( 1 ), right: out( - 1 ), inside: false };

	};

	let space = line.map( across );
	const shift = steady( space.map( a => a.left + a.right < 24 ? ( a.left - a.right ) / 2 : NaN ), 4, 0.5, 4, 3 );
	for ( let i = 0; i < N; i ++ ) {

		if ( ! Number.isFinite( shift[ i ] ) ) continue;
		line[ i ].X += line[ i ].nx * shift[ i ];
		line[ i ].Y += line[ i ].ny * shift[ i ];

	}

	space = line.map( across );
	for ( let i = 0; i < N; i ++ ) if ( space[ i ].inside ) line[ i ].left = line[ i ].right = false; // a passage through a house

	const fronts = {
		left: steady( space.map( a => a.left ), 7, 0.25, 5 ),
		right: steady( space.map( a => a.right ), 7, 0.25, 5 )
	};

	// Carriageway edge on the photo (open sides).
	const R = 128, OFF = 0.125;
	const profiles = line.map( p => {

		const tx = p.ny, ty = - p.nx;
		const L = new Float32Array( 2 * R + 1 ), S = new Float32Array( 2 * R + 1 );
		for ( let o = - R; o <= R; o ++ ) {

			let sum = 0, sum2 = 0, cnt = 0;
			for ( let a = - 6; a <= 6; a ++ ) {

				const v = photo.at( p.X + p.nx * o * OFF + tx * a * 0.125, p.Y + p.ny * o * OFF + ty * a * 0.125 );
				if ( v < 0 ) continue;
				sum += v; sum2 += v * v; cnt ++;

			}

			const m = cnt ? sum / cnt : - 1;
			L[ o + R ] = m;
			S[ o + R ] = cnt ? Math.sqrt( Math.max( 0, sum2 / cnt - m * m ) ) : 99;

		}

		return { L, S };

	} );

	const centreL = [], centreS = [];
	for ( const pr of profiles ) for ( let o = - 8; o <= 8; o ++ ) {

		centreL.push( pr.L[ o + R ] );
		centreS.push( pr.S[ o + R ] );

	}

	const refL = quantile( centreL, 0.5 ), refS = quantile( centreS, 0.5 );
	const tolL = Math.max( 14, 2.5 * quantile( centreL.map( v => Math.abs( v - refL ) ), 0.5 ) ), tolS = Math.max( 6, refS * 0.8 );
	const like = ( pr, o ) => Math.abs( pr.L[ o + R ] - refL ) < tolL && pr.S[ o + R ] < refS + tolS;
	const reach = ( pr, sign ) => {

		let start = 0;
		while ( start < 16 && ! like( pr, sign * start ) ) start ++;
		if ( start >= 16 ) return NaN;
		let last = start, gap = 0;
		for ( let o = start + 1; o <= R; o ++ ) {

			if ( like( pr, sign * o ) ) {

				last = o;
				gap = 0;

			} else if ( ++ gap > 4 ) break;

		}

		if ( last >= R - 1 ) return NaN;
		let dark = 0, n = 0;
		for ( let o = last + 1; o <= Math.min( R, last + 6 ); o ++ ) {

			n ++;
			if ( pr.L[ sign * o + R ] < refL - tolL * 0.5 ) dark ++;

		}

		return dark * 2 > n ? NaN : ( last + 0.5 ) * OFF;

	};

	const photoEdge = {
		left: steady( profiles.map( pr => reach( pr, 1 ) ), 10, 0.75, 4, 5 ),
		right: steady( profiles.map( pr => reach( pr, - 1 ) ), 10, 0.75, 4, 5 )
	};

	// Pavement width next to houses: tagged, else about a fifth of the street (house front to house front).
	const streetWidth = quantile( line.map( ( _, i ) => fronts.left[ i ] + fronts.right[ i ] ), 0.5 );
	const tagWidth = parts.map( p => p.sidewalkWidthTag ).find( v => v > 0 );
	const paveWidth = tagWidth || ( Number.isFinite( streetWidth ) ? Math.max( 1.2, Math.min( 4.5, streetWidth * 0.2 ) ) : 3 );

	const halves = { left: [], right: [] }, outer = { left: [], right: [] };
	const rule = { left: [], right: [] };
	for ( const side of [ 'left', 'right' ] ) {

		for ( let i = 0; i < N; i ++ ) {

			const p = line[ i ], front = fronts[ side ][ i ];
			const open = ! Number.isFinite( front ) || front > p.half + paveWidth + 8;
			let h;
			if ( ! p[ side ] ) h = open ? p.half : front + 1, rule[ side ].push( 'none' ); // no pavement: carriageway to the houses
			else if ( ! open ) h = front - paveWidth, rule[ side ].push( 'front' );
			else if ( Number.isFinite( photoEdge[ side ][ i ] ) ) h = photoEdge[ side ][ i ], rule[ side ].push( 'photo' );
			else h = p.half, rule[ side ].push( 'tag' );
			halves[ side ].push( Math.max( 1.4, h ) );
			outer[ side ].push( ! p[ side ] ? 0 : open ? 9 : paveWidth + 2 ); // how far the raised pavement reaches

		}

		halves[ side ] = steady( halves[ side ], 0, 0.5, 8 ); // blend the switches between the rules
		outer[ side ] = steady( outer[ side ], 0, 0.5, 2 );

	}

	return { pts: line.map( p => [ p.X, p.Y ] ), left: halves.left, right: halves.right, outer, rule, kerbed: line.map( p => p.left || p.right ), name: parts[ 0 ].name, highway: parts[ 0 ].highway, oneway: parts[ 0 ].oneway, paveWidth };

}

/**
 * Builds the kerbed carriageway field. roads: OSM car roads from streets.mjs; inBuilding( X, Y ): inside a house.
 * Returns { sdf( X, Y ) → signed distance to the kerb line (< 0 on the carriageway, > 0 on the pavement), chains }.
 */
// Tram streets: the carriageway always holds both tracks and a traffic lane either side (half width about the
// double track's centre line).
const TRAM_HALF = 5.6;

export async function buildKerbs( { roads, AREA, inBuilding, tramPaths = [] } ) {

	const photo = await loadPhoto( AREA );
	const kerbed = roads.filter( r => r.highway !== 'service' && r.highway !== 'pedestrian' && r.pts.length >= 2 );
	const chains = chainRoads( kerbed ).map( parts => measureChain( parts, photo, inBuilding ) ).filter( c => c && c.kerbed.some( Boolean ) );

	const W = Math.round( ( AREA.xmax - AREA.xmin ) / FIELD_CELL ) + 1, H = Math.round( ( AREA.ymax - AREA.ymin ) / FIELD_CELL ) + 1;
	const FAR = 1000;
	const field = new Float32Array( W * H ).fill( FAR );
	const paved = new Float32Array( W * H ).fill( FAR ); // < 0 within a kerbed side's pavement band

	const tramStrips = tramPaths.filter( p => p.length >= 2 ).map( pts => {

		const zero = pts.map( () => 0 ), half = pts.map( () => TRAM_HALF );
		return { pts, left: half, right: half, outer: { left: zero, right: zero } };

	} );

	for ( const chain of [ ...chains, ...tramStrips ] ) {

		const { pts, left, right, outer } = chain;
		const reachOut = Math.max( ...left, ...right ) + 12;
		const xs = pts.map( p => p[ 0 ] ), ys = pts.map( p => p[ 1 ] );
		const c0 = Math.max( 0, Math.floor( ( Math.min( ...xs ) - reachOut - AREA.xmin ) / FIELD_CELL ) );
		const c1 = Math.min( W - 1, Math.ceil( ( Math.max( ...xs ) + reachOut - AREA.xmin ) / FIELD_CELL ) );
		const r0 = Math.max( 0, Math.floor( ( AREA.ymax - Math.max( ...ys ) - reachOut ) / FIELD_CELL ) );
		const r1 = Math.min( H - 1, Math.ceil( ( AREA.ymax - Math.min( ...ys ) + reachOut ) / FIELD_CELL ) );
		if ( c0 > c1 || r0 > r1 ) continue;
		const cw = c1 - c0 + 1;
		const local = new Float32Array( cw * ( r1 - r0 + 1 ) ).fill( FAR );
		const band = new Float32Array( cw * ( r1 - r0 + 1 ) ).fill( FAR );

		for ( let i = 1; i < pts.length; i ++ ) {

			const [ ax, ay ] = pts[ i - 1 ], [ bx, by ] = pts[ i ];
			const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
			if ( len2 < 1e-6 ) continue;
			const len = Math.sqrt( len2 );
			const first = i === 1, last = i === pts.length - 1;
			const range = Math.max( left[ i - 1 ], left[ i ], right[ i - 1 ], right[ i ] ) + 12;
			const sc0 = Math.max( c0, Math.floor( ( Math.min( ax, bx ) - range - AREA.xmin ) / FIELD_CELL ) );
			const sc1 = Math.min( c1, Math.ceil( ( Math.max( ax, bx ) + range - AREA.xmin ) / FIELD_CELL ) );
			const sr0 = Math.max( r0, Math.floor( ( AREA.ymax - Math.max( ay, by ) - range ) / FIELD_CELL ) );
			const sr1 = Math.min( r1, Math.ceil( ( AREA.ymax - Math.min( ay, by ) + range ) / FIELD_CELL ) );
			for ( let r = sr0; r <= sr1; r ++ ) {

				const Y = AREA.ymax - r * FIELD_CELL;
				for ( let c = sc0; c <= sc1; c ++ ) {

					const X = AREA.xmin + c * FIELD_CELL;
					const tRaw = ( ( X - ax ) * dx + ( Y - ay ) * dy ) / len2;
					const t = Math.max( 0, Math.min( 1, tRaw ) );
					const cross = ( dx * ( Y - ay ) - dy * ( X - ax ) ) / len; // > 0 on the left
					const side = cross >= 0 ? left : right, edge = outer[ cross >= 0 ? 'left' : 'right' ];
					const half = side[ i - 1 ] + ( side[ i ] - side[ i - 1 ] ) * t;
					const reach = half + edge[ i - 1 ] + ( edge[ i ] - edge[ i - 1 ] ) * t;
					const end = ( first && tRaw < 0 ) || ( last && tRaw > 1 );
					const dist = ( w ) => {

						if ( ! end ) return Math.hypot( X - ax - t * dx, Y - ay - t * dy ) - w;
						// Square end of the street.
						const ds = Math.abs( cross ) - w, da = ( tRaw < 0 ? - tRaw : tRaw - 1 ) * len;
						return ds > 0 ? Math.hypot( ds, da ) : da;

					};

					const k = ( r - r0 ) * cw + c - c0;
					const d = dist( half );
					if ( d < local[ k ] ) local[ k ] = d;
					const b = dist( reach );
					if ( b < band[ k ] ) band[ k ] = b;

				}

			}

		}

		// Merge into the field with a smooth minimum: rounded kerb corners where streets meet.
		for ( let r = r0; r <= r1; r ++ ) for ( let c = c0; c <= c1; c ++ ) {

			const a = field[ r * W + c ], b = local[ ( r - r0 ) * cw + c - c0 ];
			const h = Math.max( CORNER - Math.abs( a - b ), 0 ) / CORNER;
			field[ r * W + c ] = Math.min( a, b ) - h * h * CORNER / 4;
			paved[ r * W + c ] = Math.min( paved[ r * W + c ], band[ ( r - r0 ) * cw + c - c0 ] );

		}

	}

	const sample = ( grid, X, Y ) => {

		const fx = ( X - AREA.xmin ) / FIELD_CELL, fy = ( AREA.ymax - Y ) / FIELD_CELL;
		const c = Math.max( 0, Math.min( W - 2, Math.floor( fx ) ) ), r = Math.max( 0, Math.min( H - 2, Math.floor( fy ) ) );
		const u = Math.max( 0, Math.min( 1, fx - c ) ), v = Math.max( 0, Math.min( 1, fy - r ) );
		const f = ( rr, cc ) => grid[ rr * W + cc ];
		return ( f( r, c ) * ( 1 - u ) + f( r, c + 1 ) * u ) * ( 1 - v ) + ( f( r + 1, c ) * ( 1 - u ) + f( r + 1, c + 1 ) * u ) * v;

	};

	// Signed distance to the kerb line; FAR (no kerb) outside every pavement band, on the pavement side.
	const sdf = ( X, Y ) => {

		const d = sample( field, X, Y );
		return d > 0 && sample( paved, X, Y ) > 0 ? FAR : d;

	};

	// KERB_DEBUG=path: the kerb lines over the aerial photo (0.25 m), pavements tinted, street centre lines dotted.
	if ( process.env.KERB_DEBUG ) {

		const img = Buffer.alloc( W * H * 4 );
		for ( let r = 0; r < H; r ++ ) for ( let c = 0; c < W; c ++ ) {

			const v = photo.lum[ Math.min( photo.H - 1, 2 * r ) * photo.W + Math.min( photo.W - 1, 2 * c ) ];
			const f = field[ r * W + c ], i = ( r * W + c ) * 4;
			const edge = f > 0 && ( ( c > 0 && field[ r * W + c - 1 ] <= 0 ) || ( r > 0 && field[ ( r - 1 ) * W + c ] <= 0 ) || ( c < W - 1 && field[ r * W + c + 1 ] <= 0 ) || ( r < H - 1 && field[ ( r + 1 ) * W + c ] <= 0 ) );
			const house = inBuilding( AREA.xmin + c * FIELD_CELL, AREA.ymax - r * FIELD_CELL );
			const pave = f > 0 && f < 8.5 && paved[ r * W + c ] < 0 && ! house;
			img[ i ] = edge ? 255 : pave ? v * 0.75 : house ? 60 + v * 0.3 : v;
			img[ i + 1 ] = edge ? 30 : pave ? v * 0.85 : house ? 50 + v * 0.3 : v;
			img[ i + 2 ] = edge ? 30 : pave ? Math.min( 255, v * 0.8 + 70 ) : house ? 40 + v * 0.3 : v;
			img[ i + 3 ] = 255;

		}

		for ( const ch of chains ) for ( const [ X, Y ] of ch.pts ) {

			const c = Math.round( ( X - AREA.xmin ) / FIELD_CELL ), r = Math.round( ( AREA.ymax - Y ) / FIELD_CELL );
			if ( c >= 0 && r >= 0 && c < W && r < H ) img.set( [ 255, 220, 0 ], ( r * W + c ) * 4 );

		}

		const { writeFileSync } = await import( 'node:fs' );
		writeFileSync( process.env.KERB_DEBUG, jpeg.encode( { data: img, width: W, height: H }, 85 ).data );

	}

	return { sdf, chains, field, W, H, FIELD_CELL };

}
