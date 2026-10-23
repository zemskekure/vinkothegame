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
import { ShapeUtils, Vector2, Color, SRGBColorSpace } from 'three';
import { AREA, ORIGIN } from './area.mjs';
import { loadStreets, buildPavementMesh, collectFurniture } from './streets.mjs';
import { lonLatToSJTSK } from './geo.mjs';

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

const WALL_STRIDE = 17; // x y z  u  wallWidth  base  top  floorH  seed  kind  r g b  bay  window  shop  style
// r g b: measured plaster colour (sRGB, -1 when unknown); bay (m) / window (fraction of bay): measured window
// rhythm, 0 when unknown; shop: 1 shops, 0 none, -1 unknown. See tools/facades.mjs and tools/facade-params.mjs.
const WALL_KIND = { street: 0, rear: 2, party: 3 };
const ROOF_STRIDE = 8; // x y z  kind  seed  r g b (roof colour from the aerial photo, sRGB)
const ROOF_SLOPE = Math.tan( THREE_DEG( 40 ) );
const ROOF_KIND = { tiles: 0, copper: 1, flat: 2, slate: 3, theatre: 4 };

// Hand-modelled landmarks, by OpenStreetMap way id. style: facade style in src/shading/facade.js.
const STYLE = { default: 0, theatre: 1, maj: 2, chapel: 3 };
const LANDMARKS = {
	7649971: { name: 'Národní divadlo', style: STYLE.theatre, roof: ROOF_KIND.theatre, statues: true },
	25921716: { name: 'Máj', style: STYLE.maj, roof: ROOF_KIND.flat },
	173149696: { name: 'Betlémská kaple', style: STYLE.chapel, twinGables: true }
};

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

// Facade measurements from street-level photos (optional; see tools/facade-params.mjs).
const facadeParams = await ( async () => {

	let all = {};
	try {

		all = JSON.parse( await readFile( new URL( 'facade-params.json', RAW ) ) );

	} catch {

		console.log( 'no facade-params.json: facades stay procedural' );

	}

	// Photo colours vary with exposure and shade: keep hue and saturation, settle the lightness.
	const normalise = ( [ r, g, b ] ) => {

		const c = new Color().setRGB( r / 255, g / 255, b / 255, SRGBColorSpace );
		const hsl = c.getHSL( {}, SRGBColorSpace );
		c.setHSL( hsl.h, Math.min( 0.6, hsl.s * 1.25 ), Math.min( 0.84, Math.max( 0.5, hsl.l * 1.12 ) ), SRGBColorSpace );
		const out = { r: 0, g: 0, b: 0 };
		c.getRGB( out, SRGBColorSpace );
		return [ out.r, out.g, out.b ];

	};

	return {
		forWall: ( code, edge ) => all[ `${code}_${edge}` ] || null,
		forBuilding( code ) {

			const own = Object.entries( all ).filter( ( [ k ] ) => k.startsWith( `${code}_` ) ).map( ( [ , v ] ) => v );
			if ( ! own.length ) return {};
			const med = ch => own.map( v => v.colour[ ch ] ).sort( ( x, y ) => x - y )[ own.length >> 1 ];
			return { colour: normalise( [ med( 0 ), med( 1 ), med( 2 ) ] ) };

		}
	};

} )();

// Which landmark (if any) a point lies in, from the OSM outlines.
const landmarkAt = await ( async () => {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	const polys = osm.filter( e => e.type === 'way' && LANDMARKS[ e.id ] ).map( w => ( {
		landmark: LANDMARKS[ w.id ],
		ring: w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) )
	} ) );
	return ( X, Y ) => polys.find( p => pointInRings( [ p.ring ], X, Y ) )?.landmark || null;

} )();
const landmarkStatues = [];

// Real shopfronts: every named shop / café / restaurant… in OSM is pinned to the nearest building wall,
// whose ground floor then becomes a shop front, with a name board above it (placed after the geometry pass).
const SIGN_AMENITIES = new Set( [ 'cafe', 'restaurant', 'bar', 'pub', 'fast_food', 'ice_cream', 'pharmacy', 'bank', 'bureau_de_change', 'theatre', 'cinema', 'nightclub' ] );
const shopEdges = new Set();
const pendingSigns = [];
{

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	for ( const n of osm ) {

		const t = n.tags || {};
		if ( n.type !== 'node' || ! t.name || ! ( t.shop || SIGN_AMENITIES.has( t.amenity ) || t.tourism === 'hotel' ) ) continue;
		const [ X, Y ] = project( n.lon, n.lat );
		if ( X < AREA.xmin || X > AREA.xmax || Y < AREA.ymin || Y > AREA.ymax ) continue;

		let best = null;
		for ( const b of buildings ) {

			if ( X < b.bbox[ 0 ] - 10 || X > b.bbox[ 2 ] + 10 || Y < b.bbox[ 1 ] - 10 || Y > b.bbox[ 3 ] + 10 ) continue;
			const ring = b.poly.outer;
			for ( let i = 0; i < ring.length; i ++ ) {

				const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ];
				const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
				if ( l2 < 4 ) continue;
				const tt = Math.max( 0.1, Math.min( 0.9, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / l2 ) );
				const d = Math.hypot( X - ax - tt * dx, Y - ay - tt * dy );
				// Prefer walls facing a street: a node inside the building snaps to its street front.
				const facing = streetDistance( ax + tt * dx, ay + tt * dy ) < 12 ? 0 : 6;
				if ( ! best || d + facing < best.score ) best = { b, i, t: tt, score: d + facing };

			}

		}

		if ( ! best || best.score > 14 ) continue;
		shopEdges.add( `${best.b.code}_${best.i}` );
		pendingSigns.push( { ...best, name: t.name, kind: t.shop ? 'shop' : t.amenity || t.tourism } );

	}

}
const buildingInfo = new Map();

const streetFacades = [];
const wallData = [];
const wallIdx = [];
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
	const landmark = landmarkAt( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2 );
	const grid = landmark ? ROOF_GRID / 2 : ROOF_GRID; // landmark roofs get a finer mesh: crisper hips and ridges
	for ( let X = Math.ceil( x0 / grid ) * grid; X < x1; X += grid ) {

		for ( let Y = Math.ceil( y0 / grid ) * grid; Y < y1; Y += grid ) {

			if ( ! pointInRings( rings, X, Y ) ) continue;
			const d = distToRings( rings, X, Y );
			if ( d > grid * 0.45 ) interior.push( { X, Y, d, measured: sample( dsm, X, Y ) } );

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
	const measured = facadeParams.forBuilding( b.code );


	// Roof material from its real colour: green = copper, grey = slate (or tar on flat roofs), else clay tiles.
	const deep = interior.filter( p => p.d > 1.2 );
	const rgb = roofColour( deep.length >= 6 ? deep : [ ...interior, ...edges.flat() ] ) || [ 0.62, 0.32, 0.22 ];
	const [ rr, rg, rb ] = rgb;
	const sat = Math.max( rr, rg, rb ) - Math.min( rr, rg, rb );
	let kind = ROOF_KIND.tiles;
	if ( flat ) kind = ROOF_KIND.flat;
	else if ( rg > rr * 1.02 && rg >= rb * 0.95 ) kind = ROOF_KIND.copper;
	else if ( sat < 0.07 ) kind = ROOF_KIND.slate;

	const style = landmark?.style ?? STYLE.default;
	if ( landmark?.roof !== undefined ) kind = landmark.roof;

	const eaveY = ground + eave;
	let roofAt = ( X, Y, d ) => d === undefined ? eaveY : eaveY + ( flat ? 0 : Math.min( d * ROOF_SLOPE, roofRise ) );

	if ( landmark?.twinGables ) {

		// Two steep parallel gable roofs whose gables face the longest street front (Betlémská kaple).
		const fronts = edges[ 0 ].map( ( p, i, arr ) => [ p, arr[ ( i + 1 ) % arr.length ] ] )
			.filter( ( [ p, q ] ) => streetDistance( ( p.X + q.X ) / 2, ( p.Y + q.Y ) / 2 ) < 25 );
		const [ fa, fb ] = ( fronts.length ? fronts : [ [ edges[ 0 ][ 0 ], edges[ 0 ][ 1 ] ] ] ).reduce( ( best, e ) => {

			return e[ 1 ].edgeLen > best[ 1 ].edgeLen ? e : best;

		} );
		const len = Math.hypot( fb.X - fa.X, fb.Y - fa.Y ) || 1;
		const tx = ( fb.X - fa.X ) / len, ty = ( fb.Y - fa.Y ) / len;
		const vs = edges[ 0 ].map( p => p.X * tx + p.Y * ty );
		const vmin = Math.min( ...vs ), half = ( Math.max( ...vs ) - vmin ) / 2;
		const slope = Math.tan( 55 * Math.PI / 180 );
		roofAt = ( X, Y ) => {

			const v = ( ( X * tx + Y * ty - vmin ) % half + half ) % half;
			return eaveY + slope * Math.min( v, half - v );

		};
		kind = ROOF_KIND.tiles;

	}

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

	for ( const p of points ) push( p.X, p.Y, roofAt( p.X, p.Y, p.d ) );

	for ( const [ a, c, d ] of tris ) {

		const at = i => roofData.slice( ( base + i ) * ROOF_STRIDE, ( base + i ) * ROOF_STRIDE + 3 );
		const pa = at( a ), pc = at( c ), pd = at( d );
		const ny = ( pc[ 2 ] - pa[ 2 ] ) * ( pd[ 0 ] - pa[ 0 ] ) - ( pc[ 0 ] - pa[ 0 ] ) * ( pd[ 2 ] - pa[ 2 ] );
		if ( ny >= 0 ) roofIdx.push( base + a, base + c, base + d );
		else roofIdx.push( base + a, base + d, base + c );

	}

	// --- walls: one quad per boundary chunk. u runs left to right for someone facing the wall and restarts
	// at every footprint corner, so the facade shader can fit whole window bays between the corners.
	for ( const [ ringIndex, ring ] of edges.entries() ) {

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

			// Statues standing on the attic balustrade, about every 7 m along the street fronts.
			if ( landmark?.statues && kind === WALL_KIND.street && ringIndex === 0 && Math.floor( a.along / 7 ) !== Math.floor( ( a.along + len ) / 7 ) ) {

				const [ x, y, z ] = toLocal( mx - nx * 0.6, my - ny * 0.6, eaveY );
				landmarkStatues.push( + x.toFixed( 2 ), + ( y - 2.1 ).toFixed( 2 ), + z.toFixed( 2 ), + Math.atan2( - ny, nx ).toFixed( 3 ), 0.8 );

			}

			const A0 = toLocal( a.X, a.Y, sample( dtm, a.X, a.Y ) - 1.0 ), A1 = toLocal( a.X, a.Y, roofAt( a.X, a.Y ) );
			const C0 = toLocal( c.X, c.Y, sample( dtm, c.X, c.Y ) - 1.0 ), C1 = toLocal( c.X, c.Y, roofAt( c.X, c.Y ) );

			// Scene frame: outward normal n = (nx, -ny); reading direction t = (n.z, -n.x).
			const ex = C0[ 0 ] - A0[ 0 ], ez = C0[ 2 ] - A0[ 2 ];
			const frontIsCCW = ex * - ny - ez * nx > 0;
			const readsAtoC = ex * - ny + ez * - nx > 0;

			const sA = a.along, sC = c.edge === a.edge ? c.along : a.edgeLen;
			const uA = readsAtoC ? sA : a.edgeLen - sA, uC = readsAtoC ? sC : a.edgeLen - sC;

			const wallParams = ringIndex === 0 ? facadeParams.forWall( b.code, a.edge ) : null;
			const [ cr, cg, cb ] = measured.colour || [ - 1, - 1, - 1 ];
			const bay = wallParams?.bay || 0, win = wallParams?.window || 0;
			const shop = ringIndex === 0 && shopEdges.has( `${b.code}_${a.edge}` ) ? 1 : wallParams ? ( wallParams.shop ? 1 : 0 ) : - 1;
			const v = ( P, uu ) => wallData.push( P[ 0 ], P[ 1 ], P[ 2 ], uu, a.edgeLen, ground - BASE_HEIGHT, eaveY - BASE_HEIGHT, floorH, seed, kind, cr, cg, cb, bay, win, shop, style );
			// Four corners per quad, two indexed triangles facing outwards.
			const q = wallData.length / WALL_STRIDE;
			v( A0, uA ); v( C0, uC ); v( C1, uC ); v( A1, uA );
			if ( frontIsCCW ) wallIdx.push( q, q + 1, q + 2, q, q + 2, q + 3 );
			else wallIdx.push( q, q + 2, q + 1, q, q + 3, q + 2 );

		}

	}

	// Whole street-facing footprint edges, for matching against street-level photos (tools/facades.mjs).
	for ( const ring of [ b.poly.outer ] ) {

		for ( let i = 0; i < ring.length; i ++ ) {

			const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ];
			const len = Math.hypot( bx - ax, by - ay );
			if ( len < 3 ) continue;
			const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
			let nx = ( by - ay ) / len, ny = - ( bx - ax ) / len;
			if ( pointInRings( rings, mx + nx * 0.3, my + ny * 0.3 ) ) {

				nx = - nx; ny = - ny;

			}

			const other = buildingAt( mx + nx * 0.75, my + ny * 0.75 );
			if ( other >= 0 && other !== b.id ) continue;
			if ( streetDistance( mx + nx * 3, my + ny * 3 ) >= 9 ) continue;
			streetFacades.push( { code: b.code, edge: i, a: [ ax, ay ], b: [ bx, by ], n: [ nx, ny ], ground, eave: eaveY, floors } );

		}

	}

	b.kept = true;
	buildingInfo.set( b.code, { ground, floorH, eaveY } );
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

// Smooth the terrain over a few metres: the survey surface is slightly noisy at street scale, and Old Town streets
// are smooth slopes. Two passes of a 5 × 5 box blur on the 2 m grid.
for ( let pass = 0; pass < 2; pass ++ ) {

	const src = terrain.slice();
	for ( let r = 0; r < th; r ++ ) for ( let c = 0; c < tw; c ++ ) {

		let sum = 0, n = 0;
		for ( let dr = - 2; dr <= 2; dr ++ ) for ( let dc = - 2; dc <= 2; dc ++ ) {

			const rr = r + dr, cc = c + dc;
			if ( rr < 0 || cc < 0 || rr >= th || cc >= tw ) continue;
			sum += src[ rr * tw + cc ];
			n ++;

		}

		terrain[ r * tw + c ] = sum / n;

	}

}

// The Vltava: the terrain model interpolates across the water, so cut the river (ZABAGED water outline, islands
// excluded) down to a bed below the water surface; the embankments become walls. Water level: the lowest
// terrain height along the river.
const riverRings = JSON.parse( await readFile( new URL( 'water.json', RAW ) ) ).flatMap( f => f.geometry?.rings || [] );
const inRiver = ( X, Y ) => pointInRings( riverRings, X, Y );
const riverMask = new Uint8Array( tw * th );
let waterLevel = Infinity;
for ( let r = 0; r < th; r ++ ) for ( let c = 0; c < tw; c ++ ) {

	if ( ! inRiver( AREA.xmin + c * TERRAIN_CELL, AREA.ymax - r * TERRAIN_CELL ) ) continue;
	riverMask[ r * tw + c ] = 1;
	waterLevel = Math.min( waterLevel, terrain[ r * tw + c ] );

}

const riverAt = ( X, Y ) => riverMask[ Math.round( ( AREA.ymax - Y ) / TERRAIN_CELL ) * tw + Math.round( ( X - AREA.xmin ) / TERRAIN_CELL ) ] === 1;

if ( ! Number.isFinite( waterLevel ) ) waterLevel = terrain.reduce( ( m, v ) => Math.min( m, v ), Infinity );
waterLevel += 0.1;
for ( let r = 0; r < th; r ++ ) for ( let c = 0; c < tw; c ++ ) {

	if ( riverMask[ r * tw + c ] ) terrain[ r * tw + c ] = waterLevel - 2.5;

}

console.log( `river: water level ${( waterLevel + BASE_HEIGHT ).toFixed( 2 )} m` );

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
// Street-surface maps (1 m cells, row 0 = north), from OpenStreetMap (see streets.mjs):
// surface.bin   R  distance to the nearest building × 40
//               G  park / maintained greenery mask
//               B  128 − F × 25, F = signed distance to a carriageway edge (< 0 on the road)
//               A  distance to a tram track centreline × 50   (rails)
// surface2.bin  R  carriageway surface: 255 asphalt, 128 paving stones, 0 setts
//               G  pedestrian / open area surface, same coding
//               B  128 − Fk × 25, Fk = signed distance to a kerbed carriageway edge (> 0 on raised pavement)

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

const streetData = await loadStreets( { AREA, buildingDist } );
const surface2 = new Uint8Array( sw * sh * 4 );
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
		const st = streetData.at( X, Y );
		surface[ i + 2 ] = clamp( 128 - st.F * 25 );
		surface[ i + 3 ] = clamp( tramDist[ r * sw + c ] * 50 );
		surface2[ i ] = clamp( st.roadAsphalt * 255 );
		surface2[ i + 1 ] = clamp( st.openSurface * 255 );
		surface2[ i + 2 ] = clamp( 128 - st.Fk * 25 );
		surface2[ i + 3 ] = 255;

	}

}

// ---------------------------------------------------------------------------
// Ground detail from the aerial photo (25 cm): luminance divided by its local average over ~2 m, which keeps
// markings, mosaic patterns, kerb lines and wear but cancels the building shadows. 128 = neutral; neutral on
// roofs (inside footprints) and in the river. Row 0 = north, same frame as the photo.
{

	const W = photo.width, H = photo.height, cell = ( AREA.xmax - AREA.xmin ) / W;
	const lum = new Float32Array( W * H );
	for ( let i = 0; i < W * H; i ++ ) lum[ i ] = 0.3 * photo.data[ i * 4 ] + 0.59 * photo.data[ i * 4 + 1 ] + 0.11 * photo.data[ i * 4 + 2 ] + 4;

	// Box average through an integral image.
	const R = 4; // 9 × 9 px ≈ 2.25 m
	const integral = new Float64Array( ( W + 1 ) * ( H + 1 ) );
	for ( let y = 0; y < H; y ++ ) {

		let row = 0;
		for ( let x = 0; x < W; x ++ ) {

			row += lum[ y * W + x ];
			integral[ ( y + 1 ) * ( W + 1 ) + x + 1 ] = integral[ y * ( W + 1 ) + x + 1 ] + row;

		}

	}

	const detail = Buffer.alloc( W * H * 4 );
	for ( let y = 0; y < H; y ++ ) {

		const y0 = Math.max( 0, y - R ), y1 = Math.min( H, y + R + 1 );
		const Y = AREA.ymax - ( y + 0.5 ) * cell;
		for ( let x = 0; x < W; x ++ ) {

			const x0 = Math.max( 0, x - R ), x1 = Math.min( W, x + R + 1 );
			const sum = integral[ y1 * ( W + 1 ) + x1 ] - integral[ y0 * ( W + 1 ) + x1 ] - integral[ y1 * ( W + 1 ) + x0 ] + integral[ y0 * ( W + 1 ) + x0 ];
			const mean = sum / ( ( x1 - x0 ) * ( y1 - y0 ) );
			const X = AREA.xmin + ( x + 0.5 ) * cell;
			const masked = keptIds.has( buildingAt( X, Y ) ) || riverAt( X, Y );
			const v = masked ? 128 : Math.max( 0, Math.min( 255, Math.round( 128 + ( lum[ y * W + x ] / mean - 1 ) * 160 ) ) );
			detail[ y * W * 4 + x * 4 ] = detail[ y * W * 4 + x * 4 + 1 ] = detail[ y * W * 4 + x * 4 + 2 ] = v;
			detail[ y * W * 4 + x * 4 + 3 ] = 255;

		}

	}

	await mkdir( OUT, { recursive: true } );
	await writeFile( new URL( 'ground-detail.jpg', OUT ), jpeg.encode( { data: detail, width: W, height: H }, 88 ).data );
	console.log( `ground detail: ${W}x${H}` );

}

// ---------------------------------------------------------------------------
// Raised pavements and street furniture

// Street-level ground height in the scene frame: the same 2 m grid the terrain mesh is built from.
function terrainAt( X, Y ) {

	const fx = Math.min( Math.max( ( X - AREA.xmin ) / TERRAIN_CELL, 0 ), tw - 1.001 );
	const fy = Math.min( Math.max( ( AREA.ymax - Y ) / TERRAIN_CELL, 0 ), th - 1.001 );
	const x0 = Math.floor( fx ), y0 = Math.floor( fy ), tx = fx - x0, ty = fy - y0;
	const i = y0 * tw + x0;
	return ( terrain[ i ] * ( 1 - tx ) + terrain[ i + 1 ] * tx ) * ( 1 - ty ) + ( terrain[ i + tw ] * ( 1 - tx ) + terrain[ i + tw + 1 ] * tx ) * ty;

}

const inKeptBuilding = ( X, Y ) => keptIds.has( buildingAt( X, Y ) );
const pavement = buildPavementMesh( streetData, { AREA, toLocal, heightAt: terrainAt, inBuilding: inKeptBuilding } );
console.log( `pavements: ${pavement.positions.length / 3} vertices, ${( pavement.kerbLength / 1000 ).toFixed( 1 )} km of kerb` );

const furniture = collectFurniture( streetData, {
	toLocal,
	heightAt: ( X, Y ) => terrainAt( X, Y ) + 0.03 + streetData.raise( streetData.at( X, Y ).Fk ),
	dsmTrees: trees,
	treeHeightAt: ( X, Y ) => {

		// Mapped trees: height from the surface model where it shows a canopy, else a typical street tree.
		let h = 0;
		for ( let dy = - 2; dy <= 2; dy += 1 ) for ( let dx = - 2; dx <= 2; dx += 1 ) h = Math.max( h, sample( dsmRaw, X + dx, Y + dy ) - sample( dtm, X + dx, Y + dy ) );
		return h > 4 && h < 30 ? h : 9;

	}
} );
furniture.statue.push( ...landmarkStatues );

// Name boards over the shop windows, one per wall position (several shops on one spot are spread along the wall).
const signs = [];
const used = new Map();
for ( const sg of pendingSigns ) {

	const info = buildingInfo.get( sg.b.code );
	if ( ! info ) continue;
	const ring = sg.b.poly.outer;
	const [ ax, ay ] = ring[ sg.i ], [ bx, by ] = ring[ ( sg.i + 1 ) % ring.length ];
	const len = Math.hypot( bx - ax, by - ay );
	const key = `${sg.b.code}_${sg.i}`;
	const slot = used.get( key ) || 0;
	used.set( key, slot + 1 );
	const width = Math.min( 4.2, Math.max( 1.6, sg.name.length * 0.24 + 0.6 ), len * 0.8 );
	const t = Math.min( 1 - width / 2 / len, Math.max( width / 2 / len, sg.t + slot * ( width + 0.6 ) / len * ( slot % 2 ? 1 : - 1 ) ) );
	let nx = ( by - ay ) / len, ny = - ( bx - ax ) / len;
	const px = ax + ( bx - ax ) * t, py = ay + ( by - ay ) * t;
	if ( pointInRings( [ ring ], px + nx * 0.3, py + ny * 0.3 ) ) {

		nx = - nx; ny = - ny;

	}

	const h = info.ground + Math.min( 3.9, Math.max( 3.0, info.floorH * 0.88 ) );
	const [ x, y, z ] = toLocal( px + nx * 0.07, py + ny * 0.07, h );
	signs.push( { x: + x.toFixed( 2 ), y: + y.toFixed( 2 ), z: + z.toFixed( 2 ), rot: + Math.atan2( nx, - ny ).toFixed( 3 ), w: + width.toFixed( 2 ), name: sg.name, kind: sg.kind } );

}

console.log( `shop signs: ${signs.length}` );
console.log( 'furniture:', Object.entries( furniture ).map( ( [ k, v ] ) => `${k} ${v.length / 5}` ).join( ', ' ) );

// ---------------------------------------------------------------------------

await mkdir( OUT, { recursive: true } );

const [ ax0, , az1 ] = toLocal( AREA.xmin, AREA.ymin, 0 );
const [ ax1, , az0 ] = toLocal( AREA.xmax, AREA.ymax, 0 );


await writeFile( new URL( 'walls.bin', OUT ), new Float32Array( wallData ) );
await writeFile( new URL( 'walls-index.bin', OUT ), new Uint32Array( wallIdx ) );
await writeFile( new URL( 'roofs.bin', OUT ), new Float32Array( roofData ) );
await writeFile( new URL( 'roofs-index.bin', OUT ), new Uint32Array( roofIdx ) );
await writeFile( new URL( 'terrain.bin', OUT ), terrain );
await writeFile( new URL( 'surface.bin', OUT ), surface );
await writeFile( new URL( 'surface2.bin', OUT ), surface2 );
await writeFile( new URL( 'pavement.bin', OUT ), pavement.positions );
await writeFile( new URL( 'pavement-index.bin', OUT ), pavement.index );
await writeFile( new URL( 'street-facades.json', RAW ), JSON.stringify( streetFacades ) );

// Footprint mask on the DSM grid (1 bit per cell, row 0 = north) for walking collisions.
const mask = new Uint8Array( Math.ceil( idGrid.length / 8 ) );
for ( let i = 0; i < idGrid.length; i ++ ) if ( keptIds.has( idGrid[ i ] ) ) mask[ i >> 3 ] |= 1 << ( i & 7 );
await writeFile( new URL( 'footprints.bin', OUT ), mask );

await writeFile( new URL( 'scene.json', OUT ), JSON.stringify( {
	attribution: 'Data © ČÚZK (RÚIAN, ZABAGED®, DMR 5G, DMP 1G) · © OpenStreetMap contributors (ODbL)',
	baseHeight: BASE_HEIGHT,
	bounds: { minX: ax0, maxX: ax1, minZ: az0, maxZ: az1 },
	waterLevel,
	terrain: { width: tw, height: th, cell: TERRAIN_CELL },
	surface: { width: sw, height: sh, cell: SURF_CELL },
	footprints: { width: dsm.width, height: dsm.height, cell: dsm.cell },
	wallStride: WALL_STRIDE,
	roofStride: ROOF_STRIDE,
	buildings: meta,
	furniture,
	signs,
	kerbHeight: streetData.KERB_HEIGHT,
	streets
} ) );

console.log( 'written to public/data/' );
