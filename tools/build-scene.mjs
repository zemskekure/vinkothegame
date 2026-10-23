// Turns the raw ČÚZK data in data/raw/ into compact runtime buffers in public/data/.
//
// Buildings:  RÚIAN footprints (one polygon per building, with floor counts),
//             walls extruded from the terrain (DMR 5G) up to the eave and hipped
//             roofs, both measured from the 0.5 m digital surface model (DMP).
// Surface:    sidewalks, asphalt, tram rails and parks as a 1 m RGBA map.
// Terrain:    DMR 5G resampled to a 2 m grid.
// Trees:      canopy peaks of (surface - terrain) outside buildings.
//
// Scene frame: 1 unit = 1 m, x = east, y = up, z = south,
// origin at Betlémské náměstí, y = 0 at BASE_HEIGHT metres above sea level (Bpv).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { fromFile } from 'geotiff';
import poly2tri from 'poly2tri';
import { ShapeUtils, Vector2 } from 'three';
import { AREA, ORIGIN } from './area.mjs';

const RAW = new URL( '../data/raw/', import.meta.url );
const OUT = new URL( '../public/data/', import.meta.url );

const BASE_HEIGHT = 184;
const ROOF_GRID = 1.0; // spacing of interior roof samples (m)
const EDGE_STEP = 1.5; // max wall / roof-edge segment length (m)
const EDGE_INSET = 0.7; // roof edge heights are sampled this far inside the footprint

// ---------------------------------------------------------------------------
// Rasters

async function loadRaster( name ) {

	const tiff = await fromFile( new URL( `${name}.tif`, RAW ).pathname );
	const image = await tiff.getImage();
	const [ data ] = await image.readRasters();
	const width = image.getWidth(), height = image.getHeight();
	return { data, width, height, cell: ( AREA.xmax - AREA.xmin ) / width };

}

// Bilinear sample at S-JTSK coordinates; row 0 is the northern edge.
function sample( r, X, Y ) {

	const fx = Math.min( Math.max( ( X - AREA.xmin ) / r.cell - 0.5, 0 ), r.width - 1.001 );
	const fy = Math.min( Math.max( ( AREA.ymax - Y ) / r.cell - 0.5, 0 ), r.height - 1.001 );
	const x0 = Math.floor( fx ), y0 = Math.floor( fy );
	const tx = fx - x0, ty = fy - y0;
	const i = y0 * r.width + x0;
	const d = r.data;
	return ( d[ i ] * ( 1 - tx ) + d[ i + 1 ] * tx ) * ( 1 - ty ) +
		( d[ i + r.width ] * ( 1 - tx ) + d[ i + r.width + 1 ] * tx ) * ty;

}

function medianFilter( r ) {

	const out = new Float32Array( r.data.length );
	const w = r.width, h = r.height;
	const win = new Float32Array( 9 );

	for ( let y = 0; y < h; y ++ ) {

		for ( let x = 0; x < w; x ++ ) {

			let n = 0;
			for ( let dy = - 1; dy <= 1; dy ++ ) {

				for ( let dx = - 1; dx <= 1; dx ++ ) {

					const xx = Math.min( Math.max( x + dx, 0 ), w - 1 );
					const yy = Math.min( Math.max( y + dy, 0 ), h - 1 );
					win[ n ++ ] = r.data[ yy * w + xx ];

				}

			}

			win.sort();
			out[ y * w + x ] = win[ 4 ];

		}

	}

	return { ...r, data: out };

}

// ---------------------------------------------------------------------------
// Polygon helpers (S-JTSK coordinates, [x, y] pairs)

function signedArea( ring ) {

	let a = 0;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		a += ( ring[ j ][ 0 ] - ring[ i ][ 0 ] ) * ( ring[ j ][ 1 ] + ring[ i ][ 1 ] );

	}

	return a / 2; // > 0 for counter-clockwise in a y-up frame

}

function pointInRings( rings, x, y ) {

	let inside = false;
	for ( const ring of rings ) {

		for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

			const [ xi, yi ] = ring[ i ], [ xj, yj ] = ring[ j ];
			if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) inside = ! inside;

		}

	}

	return inside;

}

function distToRings( rings, x, y ) {

	let best = Infinity;
	for ( const ring of rings ) {

		for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

			const [ ax, ay ] = ring[ j ], [ bx, by ] = ring[ i ];
			const dx = bx - ax, dy = by - ay;
			const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( y - ay ) * dy ) / ( dx * dx + dy * dy ) ) );
			best = Math.min( best, Math.hypot( x - ax - t * dx, y - ay - t * dy ) );

		}

	}

	return best;

}

// Drops the closing duplicate, near-duplicate and near-collinear vertices.
function cleanRing( ring ) {

	let pts = ring.slice();
	if ( pts.length > 1 && pts[ 0 ][ 0 ] === pts.at( - 1 )[ 0 ] && pts[ 0 ][ 1 ] === pts.at( - 1 )[ 1 ] ) pts.pop();

	for ( let changed = true; changed && pts.length > 3; ) {

		changed = false;
		for ( let i = 0; i < pts.length && pts.length > 3; i ++ ) {

			const a = pts[ ( i + pts.length - 1 ) % pts.length ], b = pts[ i ], c = pts[ ( i + 1 ) % pts.length ];
			const ab = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
			const ac = Math.hypot( c[ 0 ] - a[ 0 ], c[ 1 ] - a[ 1 ] );
			const cross = ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] );
			const dev = ac > 0 ? Math.abs( cross ) / ac : 0;

			if ( ab < 0.25 || dev < 0.05 ) {

				pts.splice( i, 1 );
				changed = true;
				i --;

			}

		}

	}

	return pts.length >= 3 ? pts : null;

}

// Splits ESRI rings into polygons: outer rings are clockwise, holes counter-clockwise.
function toPolygons( rings ) {

	const outers = [], holes = [];
	for ( const raw of rings ) {

		const ring = cleanRing( raw );
		if ( ! ring ) continue;
		( signedArea( ring ) < 0 ? outers : holes ).push( ring );

	}

	const polys = outers.map( outer => ( { outer, holes: [] } ) );
	for ( const hole of holes ) {

		const owner = polys.find( p => pointInRings( [ p.outer ], hole[ 0 ][ 0 ], hole[ 0 ][ 1 ] ) );
		if ( owner ) owner.holes.push( hole );

	}

	return polys;

}

function densify( ring, step ) {

	const out = [];
	for ( let i = 0; i < ring.length; i ++ ) {

		const a = ring[ i ], b = ring[ ( i + 1 ) % ring.length ];
		const len = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		const n = Math.max( 1, Math.ceil( len / step ) );
		for ( let k = 0; k < n; k ++ ) {

			// x, y, source edge index, distance along that edge, edge length
			out.push( [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * k / n, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * k / n, i, len * k / n, len ] );

		}

	}

	return out;

}

// Deterministic hash → [0, 1)
function hash01( n ) {

	n = Math.imul( n ^ ( n >>> 16 ), 0x45d9f3b );
	n = Math.imul( n ^ ( n >>> 16 ), 0x45d9f3b );
	return ( ( n ^ ( n >>> 16 ) ) >>> 0 ) / 4294967296;

}

// ---------------------------------------------------------------------------

const toLocal = ( X, Y, H ) => [ X - ORIGIN.x, H - BASE_HEIGHT, - ( Y - ORIGIN.y ) ];

console.log( 'loading rasters…' );
const dsmRaw = await loadRaster( 'dsm' );
const dsm = medianFilter( dsmRaw );
const dtm = await loadRaster( 'dtm' );

const ruian = JSON.parse( await readFile( new URL( 'buildings.json', RAW ) ) );
const zabaged = JSON.parse( await readFile( new URL( 'zabaged-buildings.json', RAW ) ) );

// Building-id raster on the DSM grid, used to find party walls and keep trees off roofs.
const idGrid = new Int32Array( dsm.width * dsm.height ).fill( - 1 );

const buildings = [];
for ( const f of ruian ) {

	if ( ! f.geometry?.rings ) continue;
	for ( const poly of toPolygons( f.geometry.rings ) ) {

		buildings.push( {
			id: buildings.length,
			code: f.attributes.kod,
			floors: f.attributes.pocetpodlazi,
			use: f.attributes.zpusobvyuzitikod,
			number: f.attributes.cisladomovni,
			poly
		} );

	}

}

for ( const b of buildings ) {

	const rings = [ b.poly.outer, ...b.poly.holes ];
	const xs = b.poly.outer.map( p => p[ 0 ] ), ys = b.poly.outer.map( p => p[ 1 ] );
	b.bbox = [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ];
	const c0 = Math.max( 0, Math.floor( ( b.bbox[ 0 ] - AREA.xmin ) / dsm.cell ) );
	const c1 = Math.min( dsm.width - 1, Math.ceil( ( b.bbox[ 2 ] - AREA.xmin ) / dsm.cell ) );
	const r0 = Math.max( 0, Math.floor( ( AREA.ymax - b.bbox[ 3 ] ) / dsm.cell ) );
	const r1 = Math.min( dsm.height - 1, Math.ceil( ( AREA.ymax - b.bbox[ 1 ] ) / dsm.cell ) );
	for ( let r = r0; r <= r1; r ++ ) {

		for ( let c = c0; c <= c1; c ++ ) {

			const X = AREA.xmin + ( c + 0.5 ) * dsm.cell, Y = AREA.ymax - ( r + 0.5 ) * dsm.cell;
			if ( pointInRings( rings, X, Y ) ) idGrid[ r * dsm.width + c ] = b.id;

		}

	}

}

function buildingAt( X, Y ) {

	const c = Math.floor( ( X - AREA.xmin ) / dsm.cell ), r = Math.floor( ( AREA.ymax - Y ) / dsm.cell );
	if ( c < 0 || r < 0 || c >= dsm.width || r >= dsm.height ) return - 1;
	return idGrid[ r * dsm.width + c ];

}

// Landmark names from ZABAGED, matched by footprint overlap.
for ( const z of zabaged ) {

	const name = z.attributes.jmeno;
	if ( ! name || ! z.geometry?.rings ) continue;
	for ( const poly of toPolygons( z.geometry.rings ) ) {

		const counts = new Map();
		const xs = poly.outer.map( p => p[ 0 ] ), ys = poly.outer.map( p => p[ 1 ] );
		const minX = Math.min( ...xs ), maxX = Math.max( ...xs ), minY = Math.min( ...ys ), maxY = Math.max( ...ys );
		for ( let X = minX; X <= maxX; X += 2 ) {

			for ( let Y = minY; Y <= maxY; Y += 2 ) {

				if ( ! pointInRings( [ poly.outer ], X, Y ) ) continue;
				const id = buildingAt( X, Y );
				if ( id >= 0 ) counts.set( id, ( counts.get( id ) || 0 ) + 1 );

			}

		}

		const best = [ ...counts ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ];
		if ( best ) buildings[ best[ 0 ] ].name = name.trim();

	}

}

// ---------------------------------------------------------------------------
// Geometry: clean extruded walls up to the measured eave, hipped roofs generated
// from the footprint (constant slope from every edge, capped at the measured ridge).

const WALL_STRIDE = 10; // x y z  u  wallWidth  base  top  floorH  seed  kind
const WALL_KIND = { street: 0, rear: 2, party: 3 };
const ROOF_STRIDE = 8; // x y z  kind  seed  r g b (roof colour from the aerial photo, sRGB)
const ROOF_SLOPE = Math.tan( THREE_DEG( 40 ) );
const ROOF_KIND = { tiles: 0, copper: 1, flat: 2, slate: 3 };

function THREE_DEG( d ) {

	return d * Math.PI / 180;

}

// Aerial photo (ČÚZK Ortofoto): real roof colours, and a check that tree candidates are green.
const photo = jpeg.decode( await readFile( new URL( 'ortho.jpg', RAW ) ), { useTArray: true } );
function photoAt( X, Y ) {

	const c = Math.floor( ( X - AREA.xmin ) / ( AREA.xmax - AREA.xmin ) * photo.width );
	const r = Math.floor( ( AREA.ymax - Y ) / ( AREA.ymax - AREA.ymin ) * photo.height );
	if ( c < 0 || r < 0 || c >= photo.width || r >= photo.height ) return null;
	const i = ( r * photo.width + c ) * 4;
	return [ photo.data[ i ], photo.data[ i + 1 ], photo.data[ i + 2 ] ];

}

// Median colour of the sunlit roof pixels inside the footprint (shadows and glare left out).
function roofColour( points ) {

	const lit = [];
	for ( const p of points ) {

		const px = photoAt( p.X, p.Y );
		if ( ! px ) continue;
		const lum = 0.3 * px[ 0 ] + 0.59 * px[ 1 ] + 0.11 * px[ 2 ];
		if ( lum > 55 && lum < 235 ) lit.push( px );

	}

	if ( lit.length < 3 ) return null;
	const med = ch => lit.map( px => px[ ch ] ).sort( ( a, b ) => a - b )[ lit.length >> 1 ] / 255;
	return [ med( 0 ), med( 1 ), med( 2 ) ];

}

// Distance to the nearest named street centreline (classifies street fronts vs courtyard walls).
const streetSegments = JSON.parse( await readFile( new URL( 'streets.json', RAW ) ) )
	.flatMap( f => f.geometry?.paths || [] )
	.flatMap( p => p.slice( 1 ).map( ( b, i ) => [ p[ i ], b ] ) );

function streetDistance( X, Y ) {

	let best = Infinity;
	for ( const [ [ ax, ay ], [ bx, by ] ] of streetSegments ) {

		if ( Math.min( ax, bx ) - X > best || X - Math.max( ax, bx ) > best || Math.min( ay, by ) - Y > best || Y - Math.max( ay, by ) > best ) continue;
		const dx = bx - ax, dy = by - ay;
		const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
		best = Math.min( best, Math.hypot( X - ax - t * dx, Y - ay - t * dy ) );

	}

	return best;

}

const wallData = [];
const roofData = [];
const roofIdx = [];
const meta = [];
let skipped = 0, fallbacks = 0;

function insetHeight( rings, X, Y, nx, ny ) {

	// Sample the surface model just inside the footprint (it blurs into the street at the edge).
	for ( const d of [ EDGE_INSET, EDGE_INSET * 0.5, 0.15 ] ) {

		for ( const s of [ 1, - 1 ] ) {

			const px = X + nx * d * s, py = Y + ny * d * s;
			if ( pointInRings( rings, px, py ) ) return sample( dsm, px, py );

		}

	}

	return sample( dsm, X, Y );

}

const percentile = ( values, p ) => {

	const v = values.slice().sort( ( a, c ) => a - c );
	return v[ Math.min( v.length - 1, Math.floor( p * v.length ) ) ];

};

const SACRED = /kostel|kaple|Svat|Nejsvětější|Betlémská|klášter|Klementinum/i;

for ( const b of buildings ) {

	const rings = [ b.poly.outer, ...b.poly.holes ];

	let ground = Infinity;
	for ( const ring of rings ) for ( const [ X, Y ] of ring ) ground = Math.min( ground, sample( dtm, X, Y ) );

	const edges = rings.map( ring => densify( ring, EDGE_STEP ).map( ( [ X, Y, edge, along, edgeLen ], i, arr ) => {

		const prev = arr[ ( i + arr.length - 1 ) % arr.length ], next = arr[ ( i + 1 ) % arr.length ];
		let nx = - ( next[ 1 ] - prev[ 1 ] ), ny = next[ 0 ] - prev[ 0 ];
		const l = Math.hypot( nx, ny ) || 1;
		return { X, Y, edge, along, edgeLen, measured: insetHeight( rings, X, Y, nx / l, ny / l ) };

	} ) );

	const interior = [];
	const [ x0, y0, x1, y1 ] = b.bbox;
	for ( let X = Math.ceil( x0 / ROOF_GRID ) * ROOF_GRID; X < x1; X += ROOF_GRID ) {

		for ( let Y = Math.ceil( y0 / ROOF_GRID ) * ROOF_GRID; Y < y1; Y += ROOF_GRID ) {

			if ( ! pointInRings( rings, X, Y ) ) continue;
			const d = distToRings( rings, X, Y );
			if ( d > ROOF_GRID * 0.45 ) interior.push( { X, Y, d, measured: sample( dsm, X, Y ) } );

		}

	}

	const interiorHeights = interior.map( p => p.measured );
	const edgeHeights = edges.flat().map( p => p.measured );
	const eaveAbs = percentile( edgeHeights, 0.5 );
	const ridgeAbs = interiorHeights.length ? percentile( interiorHeights, 0.9 ) : eaveAbs;

	if ( percentile( [ ...interiorHeights, ...edgeHeights ], 0.5 ) - ground < 2.2 ) {

		skipped ++; // underground or demolished
		continue;

	}

	const eave = Math.max( 3, eaveAbs - ground );
	const rise = Math.max( 0, ridgeAbs - ground - eave );
	const flat = rise < 1.3;
	const maxDepth = interior.reduce( ( m, p ) => Math.max( m, p.d ), 0 );
	const roofRise = flat ? 0 : Math.min( rise, maxDepth * ROOF_SLOPE, 22 );

	const floors = b.floors > 0 ? b.floors : Math.max( 1, Math.round( eave / 3.4 ) );
	const floorH = Math.min( 5.5, Math.max( 2.7, eave / floors ) );
	const seed = hash01( b.code | 0 );


	// Roof material from its real colour: green = copper, grey = slate (or tar on flat roofs), else clay tiles.
	const deep = interior.filter( p => p.d > 1.2 );
	const rgb = roofColour( deep.length >= 6 ? deep : [ ...interior, ...edges.flat() ] ) || [ 0.62, 0.32, 0.22 ];
	const [ rr, rg, rb ] = rgb;
	const sat = Math.max( rr, rg, rb ) - Math.min( rr, rg, rb );
	let kind = ROOF_KIND.tiles;
	if ( flat ) kind = ROOF_KIND.flat;
	else if ( rg > rr * 1.02 && rg >= rb * 0.95 ) kind = ROOF_KIND.copper;
	else if ( sat < 0.07 ) kind = ROOF_KIND.slate;

	const eaveY = ground + eave;
	const roofHeight = d => eaveY + ( flat ? 0 : Math.min( d * ROOF_SLOPE, roofRise ) );

	// --- roof
	const base = roofData.length / ROOF_STRIDE;
	const push = ( X, Y, H ) => roofData.push( ...toLocal( X, Y, H ), kind, seed, rr, rg, rb );
	let tris;

	const boundary = edges.flat();
	const points = flat ? boundary : [ ...boundary, ...interior ];
	try {

		let n = 0;
		const mk = () => p => Object.assign( new poly2tri.Point( p.X, p.Y ), { idx: n ++ } );
		const ctx = new poly2tri.SweepContext( edges[ 0 ].map( mk() ) );
		for ( let h = 1; h < edges.length; h ++ ) ctx.addHole( edges[ h ].map( mk() ) );
		if ( ! flat ) ctx.addPoints( interior.map( mk() ) );
		ctx.triangulate();
		tris = ctx.getTriangles().map( t => t.getPoints().map( p => p.idx ) );

	} catch ( e ) {

		fallbacks ++;
		const contour = edges[ 0 ].map( p => new Vector2( p.X, p.Y ) );
		const holes = edges.slice( 1 ).map( h => h.map( p => new Vector2( p.X, p.Y ) ) );
		tris = ShapeUtils.triangulateShape( contour, holes );
		points.length = boundary.length;

	}

	for ( const p of points ) push( p.X, p.Y, p.d === undefined ? eaveY : roofHeight( p.d ) );

	for ( const [ a, c, d ] of tris ) {

		const at = i => roofData.slice( ( base + i ) * ROOF_STRIDE, ( base + i ) * ROOF_STRIDE + 3 );
		const pa = at( a ), pc = at( c ), pd = at( d );
		const ny = ( pc[ 2 ] - pa[ 2 ] ) * ( pd[ 0 ] - pa[ 0 ] ) - ( pc[ 0 ] - pa[ 0 ] ) * ( pd[ 2 ] - pa[ 2 ] );
		if ( ny >= 0 ) roofIdx.push( base + a, base + c, base + d );
		else roofIdx.push( base + a, base + d, base + c );

	}

	// --- walls: one quad per boundary chunk. u runs left to right for someone facing the wall and restarts
	// at every footprint corner, so the facade shader can fit whole window bays between the corners.
	for ( const ring of edges ) {

		for ( let i = 0; i < ring.length; i ++ ) {

			const a = ring[ i ], c = ring[ ( i + 1 ) % ring.length ];
			const len = Math.hypot( c.X - a.X, c.Y - a.Y );

			const mx = ( a.X + c.X ) / 2, my = ( a.Y + c.Y ) / 2;
			let nx = ( c.Y - a.Y ) / len, ny = - ( c.X - a.X ) / len;
			if ( pointInRings( rings, mx + nx * 0.3, my + ny * 0.3 ) ) {

				nx = - nx; ny = - ny;

			}

			// Party wall: another building directly behind this face. Street front: a street centreline ahead.
			const other = buildingAt( mx + nx * 0.75, my + ny * 0.75 );
			let kind = WALL_KIND.rear;
			if ( other >= 0 && other !== b.id ) kind = WALL_KIND.party;
			else if ( streetDistance( mx + nx * 3, my + ny * 3 ) < 9 ) kind = WALL_KIND.street;

			const A0 = toLocal( a.X, a.Y, sample( dtm, a.X, a.Y ) - 1.0 ), A1 = toLocal( a.X, a.Y, eaveY );
			const C0 = toLocal( c.X, c.Y, sample( dtm, c.X, c.Y ) - 1.0 ), C1 = toLocal( c.X, c.Y, eaveY );

			// Scene frame: outward normal n = (nx, -ny); reading direction t = (n.z, -n.x).
			const ex = C0[ 0 ] - A0[ 0 ], ez = C0[ 2 ] - A0[ 2 ];
			const frontIsCCW = ex * - ny - ez * nx > 0;
			const readsAtoC = ex * - ny + ez * - nx > 0;

			const sA = a.along, sC = c.edge === a.edge ? c.along : a.edgeLen;
			const uA = readsAtoC ? sA : a.edgeLen - sA, uC = readsAtoC ? sC : a.edgeLen - sC;

			const v = ( P, uu ) => wallData.push( P[ 0 ], P[ 1 ], P[ 2 ], uu, a.edgeLen, ground - BASE_HEIGHT, eaveY - BASE_HEIGHT, floorH, seed, kind );
			const quad = frontIsCCW ? [ [ A0, uA ], [ C0, uC ], [ C1, uC ], [ A0, uA ], [ C1, uC ], [ A1, uA ] ]
				: [ [ A0, uA ], [ C1, uC ], [ C0, uC ], [ A0, uA ], [ A1, uA ], [ C1, uC ] ];
			for ( const [ P, uu ] of quad ) v( P, uu );

		}

	}

	b.kept = true;
	const [ lx, , lz ] = toLocal( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, 0 );
	meta.push( { id: b.id, x: + lx.toFixed( 1 ), z: + lz.toFixed( 1 ), eave: + eave.toFixed( 1 ), rise: + roofRise.toFixed( 1 ), floors, name: b.name } );

}

console.log( `buildings: ${meta.length} (skipped ${skipped}, fallback triangulations ${fallbacks})` );
console.log( `roof vertices: ${roofData.length / ROOF_STRIDE}, roof triangles: ${roofIdx.length / 3}, wall vertices: ${wallData.length / WALL_STRIDE}` );

// ---------------------------------------------------------------------------
// Terrain (2 m grid) and trees

const TERRAIN_CELL = 2;
const tw = Math.round( ( AREA.xmax - AREA.xmin ) / TERRAIN_CELL ) + 1;
const th = Math.round( ( AREA.ymax - AREA.ymin ) / TERRAIN_CELL ) + 1;
const terrain = new Float32Array( tw * th );
for ( let r = 0; r < th; r ++ ) {

	for ( let c = 0; c < tw; c ++ ) {

		terrain[ r * tw + c ] = sample( dtm, AREA.xmin + c * TERRAIN_CELL, AREA.ymax - r * TERRAIN_CELL ) - BASE_HEIGHT;

	}

}

// Canopy peaks only count as trees where the aerial photo is green (not a boat or a sculpture).
function isGreen( X, Y ) {

	let g = 0, n = 0;
	for ( let dy = - 1; dy <= 1; dy += 0.5 ) {

		for ( let dx = - 1; dx <= 1; dx += 0.5 ) {

			const px = photoAt( X + dx, Y + dy );
			if ( ! px ) continue;
			const [ R, G, B ] = px;
			if ( G > R * 1.02 && G > B * 1.02 ) g ++;
			n ++;

		}

	}

	return n > 0 && g / n > 0.45;

}

// Trees: local maxima of canopy height (DSM - DTM) on a 2 m grid, away from buildings.
const trees = [];
const TREE_CELL = 2;
const cw = Math.floor( ( AREA.xmax - AREA.xmin ) / TREE_CELL ), ch = Math.floor( ( AREA.ymax - AREA.ymin ) / TREE_CELL );
const canopy = new Float32Array( cw * ch );
for ( let r = 0; r < ch; r ++ ) {

	for ( let c = 0; c < cw; c ++ ) {

		const X = AREA.xmin + ( c + 0.5 ) * TREE_CELL, Y = AREA.ymax - ( r + 0.5 ) * TREE_CELL;
		let near = false;
		for ( const [ dx, dy ] of [ [ 0, 0 ], [ 1.5, 0 ], [ - 1.5, 0 ], [ 0, 1.5 ], [ 0, - 1.5 ] ] ) {

			if ( buildingAt( X + dx, Y + dy ) >= 0 ) near = true;

		}

		canopy[ r * cw + c ] = near ? 0 : sample( dsmRaw, X, Y ) - sample( dtm, X, Y );

	}

}

for ( let r = 2; r < ch - 2; r ++ ) {

	for ( let c = 2; c < cw - 2; c ++ ) {

		const h = canopy[ r * cw + c ];
		if ( h < 4 || h > 35 ) continue;
		let isMax = true;
		for ( let dy = - 2; dy <= 2 && isMax; dy ++ ) {

			for ( let dx = - 2; dx <= 2; dx ++ ) {

				if ( ( dx || dy ) && canopy[ ( r + dy ) * cw + c + dx ] > h ) {

					isMax = false;
					break;

				}

			}

		}

		if ( ! isMax ) continue;
		if ( ! isGreen( AREA.xmin + ( c + 0.5 ) * TREE_CELL, AREA.ymax - ( r + 0.5 ) * TREE_CELL ) ) continue;

		// Canopy radius: distance at which the height drops below 60 % of the peak.
		let radius = 1;
		while ( radius < 6 && r - radius - 1 >= 0 && r + radius + 1 < ch && c - radius - 1 >= 0 && c + radius + 1 < cw ) {

			const ring = [ canopy[ r * cw + c + radius + 1 ], canopy[ r * cw + c - radius - 1 ], canopy[ ( r + radius + 1 ) * cw + c ], canopy[ ( r - radius - 1 ) * cw + c ] ];
			if ( ring.reduce( ( s, v ) => s + v, 0 ) / 4 < h * 0.6 ) break;
			radius ++;

		}

		const X = AREA.xmin + ( c + 0.5 ) * TREE_CELL, Y = AREA.ymax - ( r + 0.5 ) * TREE_CELL;
		const [ x, y, z ] = toLocal( X, Y, sample( dtm, X, Y ) );
		trees.push( + x.toFixed( 1 ), + y.toFixed( 2 ), + z.toFixed( 1 ), + h.toFixed( 1 ), radius * TREE_CELL + 1 );

	}

}

console.log( `trees: ${trees.length / 5}` );

// ---------------------------------------------------------------------------
// Street names (ZABAGED street centrelines) for labels

const streets = JSON.parse( await readFile( new URL( 'streets.json', RAW ) ) )
	.filter( f => f.attributes.nazev && f.geometry?.paths )
	.map( f => ( {
		name: f.attributes.nazev,
		paths: f.geometry.paths.map( p => p.flatMap( ( [ X, Y ] ) => {

			const [ x, y, z ] = toLocal( X, Y, sample( dtm, X, Y ) );
			return [ + x.toFixed( 1 ), + y.toFixed( 2 ), + z.toFixed( 1 ) ];

		} ) )
	} ) );

// ---------------------------------------------------------------------------
// Street-surface map (1 m cells, row 0 = north), RGBA:
//   R  distance to the nearest building × 40   (sidewalks along the houses)
//   G  park / maintained greenery mask
//   B  128 + (half width − distance to a carriageway centreline) × 32   (> 128 = asphalt)
//   A  distance to a tram track centreline × 50   (rails)

const SURF_CELL = 1;
const sw = Math.round( ( AREA.xmax - AREA.xmin ) / SURF_CELL ), sh = Math.round( ( AREA.ymax - AREA.ymin ) / SURF_CELL );
const surface = new Uint8Array( sw * sh * 4 );

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) of the kept-building mask.
function edt1d( f, n, d, v, z ) {

	let k = 0;
	v[ 0 ] = 0; z[ 0 ] = - Infinity; z[ 1 ] = Infinity;
	for ( let q = 1; q < n; q ++ ) {

		let s;
		do {

			const p = v[ k ];
			s = ( ( f[ q ] + q * q ) - ( f[ p ] + p * p ) ) / ( 2 * q - 2 * p );

		} while ( s <= z[ k ] && -- k >= 0 );

		k ++;
		v[ k ] = q; z[ k ] = s; z[ k + 1 ] = Infinity;

	}

	k = 0;
	for ( let q = 0; q < n; q ++ ) {

		while ( z[ k + 1 ] < q ) k ++;
		d[ q ] = ( q - v[ k ] ) ** 2 + f[ v[ k ] ];

	}

}

const keptIds = new Set( buildings.filter( b => b.kept ).map( b => b.id ) );
const W = dsm.width, H = dsm.height, BIG = 1e12;
const dist2 = new Float64Array( W * H );
for ( let i = 0; i < W * H; i ++ ) dist2[ i ] = keptIds.has( idGrid[ i ] ) ? 0 : BIG;
{

	const n = Math.max( W, H );
	const f = new Float64Array( n ), d = new Float64Array( n ), v = new Int32Array( n ), z = new Float64Array( n + 1 );
	for ( let x = 0; x < W; x ++ ) {

		for ( let y = 0; y < H; y ++ ) f[ y ] = dist2[ y * W + x ];
		edt1d( f, H, d, v, z );
		for ( let y = 0; y < H; y ++ ) dist2[ y * W + x ] = d[ y ];

	}

	for ( let y = 0; y < H; y ++ ) {

		for ( let x = 0; x < W; x ++ ) f[ x ] = dist2[ y * W + x ];
		edt1d( f, W, d, v, z );
		for ( let x = 0; x < W; x ++ ) dist2[ y * W + x ] = d[ x ];

	}

}

const buildingDist = ( X, Y ) => {

	const c = Math.min( W - 1, Math.max( 0, Math.floor( ( X - AREA.xmin ) / dsm.cell ) ) );
	const r = Math.min( H - 1, Math.max( 0, Math.floor( ( AREA.ymax - Y ) / dsm.cell ) ) );
	return Math.sqrt( dist2[ r * W + c ] ) * dsm.cell;

};

// Minimum distance from each cell to a set of polylines (only cells within `range`).
function polylineDistance( paths, range ) {

	const out = new Float32Array( sw * sh ).fill( Infinity );
	for ( const path of paths ) {

		for ( let i = 1; i < path.length; i ++ ) {

			const [ ax, ay ] = path[ i - 1 ], [ bx, by ] = path[ i ];
			const c0 = Math.max( 0, Math.floor( ( Math.min( ax, bx ) - range - AREA.xmin ) / SURF_CELL ) );
			const c1 = Math.min( sw - 1, Math.ceil( ( Math.max( ax, bx ) + range - AREA.xmin ) / SURF_CELL ) );
			const r0 = Math.max( 0, Math.floor( ( AREA.ymax - Math.max( ay, by ) - range ) / SURF_CELL ) );
			const r1 = Math.min( sh - 1, Math.ceil( ( AREA.ymax - Math.min( ay, by ) + range ) / SURF_CELL ) );
			const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
			for ( let r = r0; r <= r1; r ++ ) {

				const Y = AREA.ymax - ( r + 0.5 ) * SURF_CELL;
				for ( let c = c0; c <= c1; c ++ ) {

					const X = AREA.xmin + ( c + 0.5 ) * SURF_CELL;
					const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / l2 ) );
					const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
					if ( d < out[ r * sw + c ] ) out[ r * sw + c ] = d;

				}

			}

		}

	}

	return out;

}

// Asphalt carriageways: the tram streets and embankments; the rest of the Old Town is cobbled.
const ASPHALT = new Set( [ 'Národní', 'Smetanovo nábřeží', 'Masarykovo nábřeží', 'Most legií', 'Spálená', 'Vladislavova', '28. října', 'Křižovnické náměstí', 'nábřeží Karla Schwarzenberga' ] );
const ROAD_HALF_WIDTH = 4.5;
const rawStreets = JSON.parse( await readFile( new URL( 'streets.json', RAW ) ) );
const roadDist = polylineDistance( rawStreets.filter( f => ASPHALT.has( f.attributes.nazev ) ).flatMap( f => f.geometry.paths ), 8 );
const tramDist = polylineDistance( JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ), 6 );
const parks = JSON.parse( await readFile( new URL( 'greenery.json', RAW ) ) ).flatMap( f => f.geometry?.rings ? [ f.geometry.rings ] : [] );

for ( let r = 0; r < sh; r ++ ) {

	const Y = AREA.ymax - ( r + 0.5 ) * SURF_CELL;
	for ( let c = 0; c < sw; c ++ ) {

		const X = AREA.xmin + ( c + 0.5 ) * SURF_CELL;
		const i = ( r * sw + c ) * 4;
		const clamp = v => Math.max( 0, Math.min( 255, Math.round( v ) ) );
		surface[ i ] = clamp( buildingDist( X, Y ) * 40 );
		surface[ i + 1 ] = parks.some( rings => pointInRings( rings, X, Y ) ) ? 255 : 0;
		surface[ i + 2 ] = clamp( 128 + ( ROAD_HALF_WIDTH - roadDist[ r * sw + c ] ) * 32 );
		surface[ i + 3 ] = clamp( tramDist[ r * sw + c ] * 50 );

	}

}

// ---------------------------------------------------------------------------

await mkdir( OUT, { recursive: true } );

const [ ax0, , az1 ] = toLocal( AREA.xmin, AREA.ymin, 0 );
const [ ax1, , az0 ] = toLocal( AREA.xmax, AREA.ymax, 0 );

const waterLevel = terrain.reduce( ( m, v ) => Math.min( m, v ), Infinity ) + 0.25;

await writeFile( new URL( 'walls.bin', OUT ), new Float32Array( wallData ) );
await writeFile( new URL( 'roofs.bin', OUT ), new Float32Array( roofData ) );
await writeFile( new URL( 'roofs-index.bin', OUT ), new Uint32Array( roofIdx ) );
await writeFile( new URL( 'terrain.bin', OUT ), terrain );
await writeFile( new URL( 'surface.bin', OUT ), surface );

// Footprint mask on the DSM grid (1 bit per cell, row 0 = north) for walking collisions.
const mask = new Uint8Array( Math.ceil( idGrid.length / 8 ) );
for ( let i = 0; i < idGrid.length; i ++ ) if ( keptIds.has( idGrid[ i ] ) ) mask[ i >> 3 ] |= 1 << ( i & 7 );
await writeFile( new URL( 'footprints.bin', OUT ), mask );

await writeFile( new URL( 'scene.json', OUT ), JSON.stringify( {
	attribution: 'Data © ČÚZK (RÚIAN, ZABAGED®, DMR 5G, DMP 1G)',
	baseHeight: BASE_HEIGHT,
	bounds: { minX: ax0, maxX: ax1, minZ: az0, maxZ: az1 },
	waterLevel,
	terrain: { width: tw, height: th, cell: TERRAIN_CELL },
	surface: { width: sw, height: sh, cell: SURF_CELL },
	footprints: { width: dsm.width, height: dsm.height, cell: dsm.cell },
	wallStride: WALL_STRIDE,
	roofStride: ROOF_STRIDE,
	buildings: meta,
	trees,
	streets
} ) );

console.log( 'written to public/data/' );
