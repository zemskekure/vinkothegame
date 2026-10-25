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
import { collectPlaces } from './places.mjs';
import { lonLatToSJTSK } from './geo.mjs';
import { findOpenings, openingBox, clipToBox } from './openings.mjs';
import { buildQuay } from './quay.mjs';
import { buildTerraces } from './terraces.mjs';

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

function rasterize( b ) {

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

for ( const b of buildings ) rasterize( b );

// Houses OpenStreetMap has (traced from the cadastre) that RÚIAN lacks, e.g. the Ursuline school's wing along
// Voršilská: an OSM building outline less than a fifth covered by RÚIAN footprints is added.
{

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	let added = 0;
	for ( const w of osm ) {

		const t = w.tags || {};
		if ( w.type !== 'way' || ! t.building || t.building === 'no' || t.building === 'roof' || ( Number( t.layer ) || 0 ) < 0 || t.location === 'underground' ) continue;
		const ring = w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) );
		if ( ring.length < 4 ) continue;
		ring.pop();
		const xs = ring.map( p => p[ 0 ] ), ys = ring.map( p => p[ 1 ] );
		if ( Math.max( ...xs ) < AREA.xmin || Math.min( ...xs ) > AREA.xmax || Math.max( ...ys ) < AREA.ymin || Math.min( ...ys ) > AREA.ymax ) continue;
		let cells = 0, covered = 0;
		for ( let X = Math.min( ...xs ); X < Math.max( ...xs ); X += 1 ) for ( let Y = Math.min( ...ys ); Y < Math.max( ...ys ); Y += 1 ) {

			if ( ! pointInRings( [ ring ], X, Y ) ) continue;
			cells ++;
			if ( buildingAt( X, Y ) >= 0 ) covered ++;

		}

		if ( cells < 60 || covered > cells * 0.2 ) continue;
		const b = { id: buildings.length, code: 900000000 + w.id % 100000000, floors: Number( t[ 'building:levels' ] ) || 0, use: 0, number: t[ 'addr:conscriptionnumber' ] || null, poly: { outer: ring, holes: [] }, name: t.name };
		buildings.push( b );
		rasterize( b );
		added ++;

	}

	console.log( `buildings: ${added} added from OpenStreetMap (missing in RÚIAN)` );

}

function buildingAt( X, Y ) {

	const c = Math.floor( ( X - AREA.xmin ) / dsm.cell ), r = Math.floor( ( AREA.ymax - Y ) / dsm.cell );
	if ( c < 0 || r < 0 || c >= dsm.width || r >= dsm.height ) return - 1;
	return idGrid[ r * dsm.width + c ];

}

// Arcades and passages through houses, from OpenStreetMap (tools/openings.mjs).
const openings = await findOpenings( { AREA, buildingAt, buildings } );
const openingBoxes = openings.map( o => ( { o, box: openingBox( o, 0.05, 0.4 ) } ) );
console.log( `openings: ${openings.filter( o => o.kind === 'arcade' ).length} arcade stretches, ${openings.filter( o => o.kind === 'passage' ).length} passage stretches` );

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

const WALL_STRIDE = 24; // x y z  u  wallWidth  base  top  floorH  seed  kind  r g b  bay  window  shop  style  trim r g b  ground grilles rustic graffiti
// Ground floor kinds and rustication from data/houses.json (−1 / 0 = not described: the shader decides).
const GROUND = { default: 0, gate: 1, blank: 2, restaurant: 3, shops: 3, windows: 4 };
const RUSTIC = { none: 0, banded: 1, ornate: 2, clad: 3 };
// Described ground floors (data/houses.json edges.<i>.ground): the openings of one street front from left to right,
// as seen from the street, e.g. [ "shop", { "kind": "door", "frame": "dark", "glazed": true }, "garage" ]. Widths are
// typical for each kind (narrow / normal / wide), not measured; the piers between the openings share the rest of the
// front. Each front becomes a row of openings [ u0, u1, kind, frame, flags ] for the facade shader (src/main.js).
const GF_KIND = { door: 1, gate: 2, shop: 3, window: 4, garage: 5, niche: 6, blank: 7 };
const GF_FRAME = { wood: 0, dark: 1, white: 2, green: 3, grey: 4 };
const GF_DEFAULT_FRAME = { door: 'wood', gate: 'wood', shop: 'dark', window: 'white', garage: 'grey', niche: 'white' };
const GF_WIDTH = { door: [ 1.0, 1.3, 1.8 ], gate: [ 2.6, 3.0, 3.6 ], shop: [ 1.8, 2.6, 4.2 ], window: [ 0.9, 1.2, 1.5 ], garage: [ 2.4, 2.8, 3.4 ], niche: [ 1.4, 1.8, 2.2 ], blank: [ 1, 2, 4 ] };
const GF_MIN_PIER = 0.45;
const groundFloors = [], groundFloorRow = new Map();

function layoutGroundFloor( items, len ) {

	const list = items.map( it => typeof it === 'string' ? { kind: it } : it ).filter( it => GF_KIND[ it.kind ] );
	const widths = list.map( it => GF_WIDTH[ it.kind ][ { narrow: 0, wide: 2 }[ it.size ] ?? 1 ] );
	const sum = widths.reduce( ( a, w ) => a + w, 0 );
	let pier = ( len - sum ) / ( list.length + 1 ), scale = 1;
	if ( pier < GF_MIN_PIER ) {

		scale = Math.max( 0.2, ( len - GF_MIN_PIER * ( list.length + 1 ) ) / sum );
		pier = ( len - sum * scale ) / ( list.length + 1 );

	}

	const row = [];
	let u = pier;
	list.forEach( ( it, i ) => {

		const w = widths[ i ] * scale;
		const flags = ( it.arch ? 1 : 0 ) | ( it.bars ? 2 : 0 ) | ( it.glazed ? 4 : 0 ) | ( it.door ? 8 : 0 );
		if ( it.kind !== 'blank' ) row.push( [ + u.toFixed( 2 ), + ( u + w ).toFixed( 2 ), GF_KIND[ it.kind ], GF_FRAME[ it.frame || GF_DEFAULT_FRAME[ it.kind ] ] ?? 0, flags ] );
		u += w + pier;

	} );
	return row;

}
// r g b: measured plaster colour (sRGB, -1 when unknown); bay (m) / window (fraction of bay): measured window
// rhythm, 0 when unknown; shop: 1 shops, 0 none, -1 unknown. See tools/facades.mjs and tools/facade-params.mjs.
const WALL_KIND = { street: 0, rear: 2, party: 3 };
const ROOF_STRIDE = 8; // x y z  kind  seed  r g b (roof colour from the aerial photo, sRGB)
const ROOF_SLOPE = Math.tan( THREE_DEG( 40 ) );
const ROOF_KIND = { tiles: 0, copper: 1, flat: 2, slate: 3, theatre: 4 };

// Hand-modelled landmarks, by OpenStreetMap way id. style: facade style in src/shading/facade.js.
const STYLE = { default: 0, theatre: 1, maj: 2, chapel: 3, glassBlock: 4, curtain: 5, bronze: 6 };
const LANDMARKS = {
	7649971: { name: 'Národní divadlo', style: STYLE.theatre, roof: ROOF_KIND.theatre, statues: true },
	25921716: { name: 'Máj', style: STYLE.maj, roof: ROOF_KIND.flat },
	173149696: { name: 'Betlémská kaple', style: STYLE.chapel, twinGables: 'south' },
	27247992: { name: 'Nová scéna', style: STYLE.glassBlock, roof: ROOF_KIND.flat },
	27247993: { name: 'provozní budova Národního divadla', style: STYLE.bronze, roof: ROOF_KIND.flat },
	393675112: { name: 'DRN', style: STYLE.curtain, roof: ROOF_KIND.flat },
	202220820: { name: 'Quadrio', style: STYLE.curtain, roof: ROOF_KIND.flat },
	7649964: { name: 'Mánes', roof: ROOF_KIND.flat }
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

// ---------------------------------------------------------------------------
// Terrain (1 m grid): computed before the buildings so they stand on exactly the same ground as the streets.

const TERRAIN_CELL = 1;
const tw = Math.round( ( AREA.xmax - AREA.xmin ) / TERRAIN_CELL ) + 1;
const th = Math.round( ( AREA.ymax - AREA.ymin ) / TERRAIN_CELL ) + 1;
const terrain = new Float32Array( tw * th );
for ( let r = 0; r < th; r ++ ) {

	for ( let c = 0; c < tw; c ++ ) {

		terrain[ r * tw + c ] = sample( dtm, AREA.xmin + c * TERRAIN_CELL, AREA.ymax - r * TERRAIN_CELL ) - BASE_HEIGHT;

	}

}

// Smooth the terrain over a few metres: the survey surface is slightly noisy at street scale, and Old Town streets
// are smooth slopes. Two passes of a separable 9 m box blur.
for ( let pass = 0; pass < 2; pass ++ ) {

	for ( const [ n, stride, count, step ] of [ [ tw, 1, th, tw ], [ th, tw, tw, 1 ] ] ) {

		const line = new Float32Array( n );
		for ( let k = 0; k < count; k ++ ) {

			const base = k * step;
			for ( let i = 0; i < n; i ++ ) line[ i ] = terrain[ base + i * stride ];
			for ( let i = 0; i < n; i ++ ) {

				let sum = 0, m = 0;
				for ( let d = - 4; d <= 4; d ++ ) {

					const j = i + d;
					if ( j >= 0 && j < n ) {

						sum += line[ j ];
						m ++;

					}

				}

				terrain[ base + i * stride ] = sum / m;

			}

		}

	}

}

// The Vltava: the terrain model interpolates across the water, so cut the river (ZABAGED water outline, islands
// excluded) down to a bed below the water surface; the embankment walls are built along the outline below.
// Water level: the lowest terrain height along the river. The mask is filled row by row (even-odd scanlines).
const riverRings = JSON.parse( await readFile( new URL( 'water.json', RAW ) ) ).flatMap( f => f.geometry?.rings || [] );
const riverMask = new Uint8Array( tw * th );
for ( let r = 0; r < th; r ++ ) {

	const Y = AREA.ymax - r * TERRAIN_CELL;
	const xs = [];
	for ( const ring of riverRings ) {

		for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

			const [ xi, yi ] = ring[ i ], [ xj, yj ] = ring[ j ];
			if ( ( yi > Y ) !== ( yj > Y ) ) xs.push( xi + ( Y - yi ) * ( xj - xi ) / ( yj - yi ) );

		}

	}

	xs.sort( ( a, b ) => a - b );
	for ( let k = 0; k + 1 < xs.length; k += 2 ) {

		const c0 = Math.max( 0, Math.ceil( ( xs[ k ] - AREA.xmin ) / TERRAIN_CELL ) );
		const c1 = Math.min( tw - 1, Math.floor( ( xs[ k + 1 ] - AREA.xmin ) / TERRAIN_CELL ) );
		for ( let c = c0; c <= c1; c ++ ) riverMask[ r * tw + c ] = 1;

	}

}

let waterLevel = Infinity;
for ( let i = 0; i < tw * th; i ++ ) if ( riverMask[ i ] ) waterLevel = Math.min( waterLevel, terrain[ i ] );
const riverAt = ( X, Y ) => {

	const r = Math.round( ( AREA.ymax - Y ) / TERRAIN_CELL ), c = Math.round( ( X - AREA.xmin ) / TERRAIN_CELL );
	return r >= 0 && c >= 0 && r < th && c < tw && riverMask[ r * tw + c ] === 1;

};

// The terrain model (and the smoothing) slope the last metres of land down towards the water, where in reality the
// street runs level to the embankment wall. Within 14 m of the river, the land is held up to the level of the land
// behind it: cells are raised to the mean of their neighbours further from the water, from 14 m in to the edge.
{

	const BANK = 14;
	const dist = new Uint8Array( tw * th ).fill( 255 );
	let front = [];
	for ( let i = 0; i < tw * th; i ++ ) if ( riverMask[ i ] ) {

		dist[ i ] = 0;
		front.push( i );

	}

	for ( let d = 1; d <= BANK + 1 && front.length; d ++ ) {

		const next = [];
		for ( const i of front ) {

			const r = Math.floor( i / tw ), c = i % tw;
			for ( const [ dr, dc ] of [ [ - 1, 0 ], [ 1, 0 ], [ 0, - 1 ], [ 0, 1 ], [ - 1, - 1 ], [ - 1, 1 ], [ 1, - 1 ], [ 1, 1 ] ] ) {

				const rr = r + dr, cc = c + dc;
				if ( rr < 0 || cc < 0 || rr >= th || cc >= tw || dist[ rr * tw + cc ] !== 255 ) continue;
				dist[ rr * tw + cc ] = d;
				next.push( rr * tw + cc );

			}

		}

		front = next;

	}

	for ( let d = BANK; d >= 1; d -- ) {

		for ( let i = 0; i < tw * th; i ++ ) {

			if ( dist[ i ] !== d ) continue;
			const r = Math.floor( i / tw ), c = i % tw;
			let sum = 0, n = 0;
			for ( let dr = - 1; dr <= 1; dr ++ ) for ( let dc = - 1; dc <= 1; dc ++ ) {

				const rr = r + dr, cc = c + dc;
				if ( rr < 0 || cc < 0 || rr >= th || cc >= tw || dist[ rr * tw + cc ] <= d ) continue;
				sum += terrain[ rr * tw + cc ];
				n ++;

			}

			if ( n ) terrain[ i ] = Math.max( terrain[ i ], sum / n );

		}

	}

}

if ( ! Number.isFinite( waterLevel ) ) waterLevel = terrain.reduce( ( m, v ) => Math.min( m, v ), Infinity );
waterLevel += 0.1;
for ( let i = 0; i < tw * th; i ++ ) if ( riverMask[ i ] ) terrain[ i ] = waterLevel - 2.5;

console.log( `river: water level ${( waterLevel + BASE_HEIGHT ).toFixed( 2 )} m` );

// Street-level ground height in the scene frame: the same 2 m grid the terrain mesh is built from.
function terrainAt( X, Y ) {

	const fx = Math.min( Math.max( ( X - AREA.xmin ) / TERRAIN_CELL, 0 ), tw - 1.001 );
	const fy = Math.min( Math.max( ( AREA.ymax - Y ) / TERRAIN_CELL, 0 ), th - 1.001 );
	const x0 = Math.floor( fx ), y0 = Math.floor( fy ), tx = fx - x0, ty = fy - y0;
	const i = y0 * tw + x0;
	return ( terrain[ i ] * ( 1 - tx ) + terrain[ i + 1 ] * tx ) * ( 1 - ty ) + ( terrain[ i + tw ] * ( 1 - tx ) + terrain[ i + tw + 1 ] * tx ) * ty;

}

// River embankment: a dressed-stone wall from below the water up to the street along the official river outline,
// wherever the bank stands more than 2.5 m above the water, topped by a stone parapet with an iron railing.
// Stone: non-indexed triangles; railing: a post every 2 m and a top rail per stretch.
const embankment = { stone: [], posts: [], rails: [] };
{

	const PARAPET = 0.3, THICK = 0.45, RAIL = 0.95;
	const push = ( ...pts ) => {

		for ( const [ X, Y, H ] of pts ) embankment.stone.push( ...toLocal( X, Y, H + BASE_HEIGHT ).map( v => + v.toFixed( 3 ) ) );

	};

	for ( const ring of riverRings ) {

		for ( let i = 0; i < ring.length; i ++ ) {

			const [ ax, ay ] = ring[ i ], [ bx, by ] = ring[ ( i + 1 ) % ring.length ];
			const len = Math.hypot( bx - ax, by - ay );
			if ( len < 0.01 ) continue;
			const n = Math.max( 1, Math.ceil( len / 2 ) );
			for ( let k = 0; k < n; k ++ ) {

				const x0 = ax + ( bx - ax ) * k / n, y0 = ay + ( by - ay ) * k / n;
				const x1 = ax + ( bx - ax ) * ( k + 1 ) / n, y1 = ay + ( by - ay ) * ( k + 1 ) / n;
				const mx = ( x0 + x1 ) / 2, my = ( y0 + y1 ) / 2;
				if ( mx < AREA.xmin + 3 || mx > AREA.xmax - 3 || my < AREA.ymin + 3 || my > AREA.ymax - 3 ) continue;

				// Land side: the normal pointing away from the water.
				let nx = ( y1 - y0 ) / ( len / n ), ny = - ( x1 - x0 ) / ( len / n );
				if ( riverAt( mx + nx * 1.5, my + ny * 1.5 ) ) {

					nx = - nx; ny = - ny;

				}

				const h0 = terrainAt( x0 + nx * 1.5, y0 + ny * 1.5 ), h1 = terrainAt( x1 + nx * 1.5, y1 + ny * 1.5 );
				if ( Math.min( h0, h1 ) - waterLevel < 2.5 ) continue;

				const low = waterLevel - 1, t0 = h0 + PARAPET, t1 = h1 + PARAPET;
				const ix0 = x0 + nx * THICK, iy0 = y0 + ny * THICK, ix1 = x1 + nx * THICK, iy1 = y1 + ny * THICK;
				// Water face, parapet top, parapet back (both windings: drawn double-sided).
				push( [ x0, y0, low ], [ x1, y1, low ], [ x1, y1, t1 ], [ x0, y0, low ], [ x1, y1, t1 ], [ x0, y0, t0 ] );
				push( [ x0, y0, t0 ], [ x1, y1, t1 ], [ ix1, iy1, t1 ], [ x0, y0, t0 ], [ ix1, iy1, t1 ], [ ix0, iy0, t0 ] );
				push( [ ix0, iy0, t0 ], [ ix1, iy1, t1 ], [ ix1, iy1, h1 - 0.3 ], [ ix0, iy0, t0 ], [ ix1, iy1, h1 - 0.3 ], [ ix0, iy0, h0 - 0.3 ] );

				// Railing on the parapet's centre line.
				const cx0 = x0 + nx * THICK / 2, cy0 = y0 + ny * THICK / 2, cx1 = x1 + nx * THICK / 2, cy1 = y1 + ny * THICK / 2;
				const p0 = toLocal( cx0, cy0, t0 + RAIL + BASE_HEIGHT ), p1 = toLocal( cx1, cy1, t1 + RAIL + BASE_HEIGHT );
				embankment.rails.push( ...p0.map( v => + v.toFixed( 2 ) ), ...p1.map( v => + v.toFixed( 2 ) ) );
				const post = toLocal( cx0, cy0, t0 + BASE_HEIGHT );
				embankment.posts.push( + post[ 0 ].toFixed( 2 ), + post[ 1 ].toFixed( 2 ), + post[ 2 ].toFixed( 2 ) );

			}

		}

	}

	console.log( `embankment: ${embankment.stone.length / 9} triangles, ${embankment.posts.length / 3} railing posts` );

}

// Smetanovo nábřeží's river edge (tools/quay.mjs): the railing all along the riverside pavement, a retaining wall
// down to the Čapadlo terrace; drawn with the embankment (same stone, same railing).
const quay = await buildQuay( { terrain, tw, th, cell: TERRAIN_CELL, AREA, terrainAt, riverAt } );
// By the National Theatre: Národní's deck over Divadelní, the piazzetta's terrace (tools/terraces.mjs).
const terraces = await buildTerraces( { terrain, tw, th, cell: TERRAIN_CELL, AREA, terrainAt, buildingAt } );

// A railing line (tools/quay.mjs format): a stone curb with the railing on top, a retaining wall down to the
// lower level where there is one, open below `openTop` (or 2.8 m over the low side) where a passage runs under.
function drawRail( R ) {

	const push = ( ...pts ) => {

		for ( const [ X, Y, H ] of pts ) embankment.stone.push( ...toLocal( X, Y, H + BASE_HEIGHT ).map( v => + v.toFixed( 3 ) ) );

	};

	for ( let i = 1; i < R.length; i ++ ) {

		const a = R[ i - 1 ], b = R[ i ];
		if ( a.river || b.river || Math.hypot( b.X - a.X, b.Y - a.Y ) > 2 ) continue;
		// A heavy stone parapet (the piazzetta) or a low curb under an iron railing.
		const CURB = a.parapet ? 1.0 : 0.3, THICK = a.parapet ? 0.6 : 0.4;
		const ta = a.top + CURB, tb = b.top + CURB;
		const bx0 = a.X - a.nx * THICK, by0 = a.Y - a.ny * THICK, bx1 = b.X - b.nx * THICK, by1 = b.Y - b.ny * THICK;
		if ( a.wall || b.wall ) {

			// Retaining wall face down to the low side (both windings: double-sided); over a passage only a lintel.
			const open = a.portal && b.portal;
			const bottom = p => open ? ( p.openTop ?? Math.min( p.quay, p.top ) + 2.8 ) : Math.min( p.quay, p.top ) - 0.3;
			const la = bottom( a ), lb = bottom( b );
			push( [ a.X, a.Y, la ], [ b.X, b.Y, lb ], [ b.X, b.Y, tb ], [ a.X, a.Y, la ], [ b.X, b.Y, tb ], [ a.X, a.Y, ta ] );
			push( [ a.X, a.Y, la ], [ b.X, b.Y, tb ], [ b.X, b.Y, lb ], [ a.X, a.Y, la ], [ a.X, a.Y, ta ], [ b.X, b.Y, tb ] );

		}

		// Stone curb under the railing: top and street side.
		push( [ a.X, a.Y, ta ], [ b.X, b.Y, tb ], [ bx1, by1, tb ], [ a.X, a.Y, ta ], [ bx1, by1, tb ], [ bx0, by0, ta ] );
		push( [ a.X, a.Y, ta ], [ bx1, by1, tb ], [ b.X, b.Y, tb ], [ a.X, a.Y, ta ], [ bx0, by0, ta ], [ bx1, by1, tb ] );
		push( [ bx0, by0, ta ], [ bx1, by1, tb ], [ bx1, by1, b.top - 0.2 ], [ bx0, by0, ta ], [ bx1, by1, b.top - 0.2 ], [ bx0, by0, a.top - 0.2 ] );
		push( [ bx0, by0, ta ], [ bx1, by1, b.top - 0.2 ], [ bx1, by1, tb ], [ bx0, by0, ta ], [ bx0, by0, a.top - 0.2 ], [ bx1, by1, b.top - 0.2 ] );

		if ( a.parapet ) continue;
		// Railing on the curb's centre line, a post every 2 m.
		const cx0 = a.X - a.nx * THICK / 2, cy0 = a.Y - a.ny * THICK / 2, cx1 = b.X - b.nx * THICK / 2, cy1 = b.Y - b.ny * THICK / 2;
		const p0 = toLocal( cx0, cy0, ta + 0.95 + BASE_HEIGHT ), p1 = toLocal( cx1, cy1, tb + 0.95 + BASE_HEIGHT );
		embankment.rails.push( ...p0.map( v => + v.toFixed( 2 ) ), ...p1.map( v => + v.toFixed( 2 ) ) );
		if ( i % 2 === 0 ) {

			const post = toLocal( cx0, cy0, ta + BASE_HEIGHT );
			embankment.posts.push( + post[ 0 ].toFixed( 2 ), + post[ 1 ].toFixed( 2 ), + post[ 2 ].toFixed( 2 ) );

		}

	}

}

if ( quay ) drawRail( quay.rail );
if ( terraces.tunnel ) for ( const line of terraces.rails.slice( 0, 2 ) ) for ( const p of line ) p.openTop = terraces.tunnel.ceil;
for ( const line of terraces.rails ) drawRail( line );

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
const twinGableFronts = [];


// Hand-written house descriptions read from street photos (data/houses.json), and the street decorations they
// ask for: awnings, wall lanterns, hanging banners.
const HOUSES = JSON.parse( await readFile( new URL( '../data/houses.json', import.meta.url ) ) );
const srgb = hex => [ 1, 3, 5 ].map( i => parseInt( hex.slice( i, i + 2 ), 16 ) / 255 );
const decor = { awnings: [], lanterns: [], banners: [] };

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
		if ( HOUSES[ best.b.code ]?.signs === false ) continue; // described from photos: only what was seen there (data/houses.json)
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

// Modelled by hand at runtime (src/places.js): kept for collisions, no generic walls or roof.
const HAND_MODELLED = new Set( [ 40354954 ] ); // Rotunda sv. Kříže Menšího

for ( const b of buildings ) {

	const rings = [ b.poly.outer, ...b.poly.holes ];
	if ( HAND_MODELLED.has( b.code ) ) {

		b.kept = true;
		continue;

	}

	let ground = Infinity;
	for ( const ring of rings ) for ( const [ X, Y ] of ring ) ground = Math.min( ground, terrainAt( X, Y ) + BASE_HEIGHT );

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
	const flat = rise < 1.3 || landmark?.roof === ROOF_KIND.flat;
	const maxDepth = interior.reduce( ( m, p ) => Math.max( m, p.d ), 0 );
	const roofRise = flat ? 0 : Math.min( rise, maxDepth * ROOF_SLOPE, 22 );

	const house = HOUSES[ b.code ];
	const floors = house?.floors ?? ( b.floors > 0 ? b.floors : Math.max( 1, Math.round( eave / 3.4 ) ) );
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

	// A house description can name a facade style too ("curtain": a modern glass office block).
	const style = landmark?.style ?? STYLE[ house?.style ] ?? STYLE.default;
	if ( landmark && ! b.name ) b.name = landmark.name;
	if ( landmark?.roof !== undefined ) kind = landmark.roof;

	const eaveY = ground + eave;
	let roofAt = ( X, Y, d ) => d === undefined ? eaveY : eaveY + ( flat ? 0 : Math.min( d * ROOF_SLOPE, roofRise ) );

	if ( landmark?.twinGables ) {

		// Two steep parallel gable roofs whose gables face the longest street front (Betlémská kaple).
		// twinGables 'south': the gables face south (Betlémská kaple, onto its square): the southernmost wall
		// running east–west.
		const south = landmark.twinGables === 'south';
		const fronts = edges[ 0 ].map( ( p, i, arr ) => [ p, arr[ ( i + 1 ) % arr.length ] ] )
			.filter( ( [ p, q ] ) => south ? Math.abs( q.X - p.X ) > 0.7 * Math.hypot( q.X - p.X, q.Y - p.Y ) : streetDistance( ( p.X + q.X ) / 2, ( p.Y + q.Y ) / 2 ) < 25 );
		const [ fa, fb ] = ( fronts.length ? fronts : [ [ edges[ 0 ][ 0 ], edges[ 0 ][ 1 ] ] ] ).reduce( ( best, e ) => {

			if ( south ) return e[ 0 ].Y + e[ 1 ].Y < best[ 0 ].Y + best[ 1 ].Y ? e : best;
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
		// The gable walls, windows and spire are modelled by hand (src/landmarks.js): the front, its outward side,
		// and the gables' run along it.
		const cx = edges[ 0 ].reduce( ( a, p ) => a + p.X, 0 ) / edges[ 0 ].length, cy = edges[ 0 ].reduce( ( a, p ) => a + p.Y, 0 ) / edges[ 0 ].length;
		let nx = ty, ny = - tx;
		if ( ( ( fa.X + fb.X ) / 2 - cx ) * nx + ( ( fa.Y + fb.Y ) / 2 - cy ) * ny < 0 ) {

			nx = - nx;
			ny = - ny;

		}

		const at = v => [ tx * v + nx * ( fa.X * nx + fa.Y * ny ), ty * v + ny * ( fa.X * nx + fa.Y * ny ) ];
		const local = ( [ X, Y ], H ) => toLocal( X, Y, H ).map( c => + c.toFixed( 2 ) );
		twinGableFronts.push( { a: local( at( vmin ), ground ), b: local( at( vmin + 2 * half ), ground ), eave: + ( toLocal( fa.X, fa.Y, eaveY )[ 1 ] ).toFixed( 2 ), n: [ + nx.toFixed( 4 ), + ( - ny ).toFixed( 4 ) ], slope } );

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

			const A0 = toLocal( a.X, a.Y, terrainAt( a.X, a.Y ) + BASE_HEIGHT - 1.0 );
			const C0 = toLocal( c.X, c.Y, terrainAt( c.X, c.Y ) + BASE_HEIGHT - 1.0 );

			// Scene frame: outward normal n = (nx, -ny); reading direction t = (n.z, -n.x).
			const ex = C0[ 0 ] - A0[ 0 ], ez = C0[ 2 ] - A0[ 2 ];
			const frontIsCCW = ex * - ny - ez * nx > 0;
			const readsAtoC = ex * - ny + ez * - nx > 0;

			const sA = a.along, sC = c.edge === a.edge ? c.along : a.edgeLen;
			const uA = readsAtoC ? sA : a.edgeLen - sA, uC = readsAtoC ? sC : a.edgeLen - sC;

			const wallParams = ringIndex === 0 ? facadeParams.forWall( b.code, a.edge ) : null;
			const [ cr, cg, cb ] = house?.colour ? srgb( house.colour ) : measured.colour || [ - 1, - 1, - 1 ];
			const [ tr, tg, tb ] = house?.trim ? srgb( house.trim ) : [ - 1, - 1, - 1 ];
			const houseGround = GROUND[ house?.ground ] ?? 0;
			// Window bars in the low bit; above it the row of this front's described ground floor (0 = none).
			let grilles = house?.grilles ? 1 : 0;
			const gfItems = ringIndex === 0 && kind === WALL_KIND.street ? house?.edges?.[ a.edge ]?.ground : null;
			if ( Array.isArray( gfItems ) ) {

				const key = `${b.code}_${a.edge}`;
				if ( ! groundFloorRow.has( key ) ) {

					groundFloorRow.set( key, groundFloors.length );
					groundFloors.push( layoutGroundFloor( gfItems, a.edgeLen ) );

				}

				grilles += 2 * ( groundFloorRow.get( key ) + 1 );

			}

			const rustic = house?.rustic ? RUSTIC[ house.rustic ] : - 1, graffiti = house?.graffiti ? 1 : 0;
			const bay = wallParams?.bay || 0, win = wallParams?.window || 0;
			let shop = ringIndex === 0 && shopEdges.has( `${b.code}_${a.edge}` ) ? 1 : wallParams ? ( wallParams.shop ? 1 : 0 ) : - 1;
			if ( house?.ground ) shop = house.ground === 'restaurant' || house.ground === 'shops' ? 1 : 0;
			// Floors count from the ground in front of a street front: on a slope the house's lowest ground can be
			// a street lower down (Lažanský palác: the embankment side), which would bury this front's shops.
			let wallBase = ground;
			if ( kind === WALL_KIND.street ) {

				const ring0 = rings[ ringIndex ], e0 = ring0[ a.edge ], e1 = ring0[ ( a.edge + 1 ) % ring0.length ];
				const front = terrainAt( ( e0[ 0 ] + e1[ 0 ] ) / 2 + nx * 1.5, ( e0[ 1 ] + e1[ 1 ] ) / 2 + ny * 1.5 ) + BASE_HEIGHT;
				wallBase = Math.max( ground, Math.min( front, eaveY - 2 * floorH ) );

			}

			const v = ( P, uu ) => wallData.push( P[ 0 ], P[ 1 ], P[ 2 ], uu, a.edgeLen, wallBase - BASE_HEIGHT, eaveY - BASE_HEIGHT, floorH, seed, kind, cr, cg, cb, bay, win, shop, style, tr, tg, tb, houseGround, grilles, rustic, graffiti );

			// Arcades and passages (tools/openings.mjs): the wall stops at their ceiling where it crosses them.
			const pieces = [ [ 0, 1, 0 ] ];
			for ( const { o, box } of openingBoxes ) {

				const r = clipToBox( box, a.X, a.Y, c.X, c.Y );
				if ( ! r ) continue;
				for ( let k = pieces.length - 1; k >= 0; k -- ) {

					const [ t0, t1, h ] = pieces[ k ];
					const lo = Math.max( t0, r[ 0 ] ), hi = Math.min( t1, r[ 1 ] );
					if ( hi - lo < 1e-4 ) continue;
					const parts = [ [ t0, lo, h ], [ lo, hi, Math.max( h, o.h ) ], [ hi, t1, h ] ].filter( ( [ p0, p1 ] ) => p1 - p0 > 1e-4 );
					pieces.splice( k, 1, ...parts );

				}

			}

			// Four corners per quad, two indexed triangles facing outwards.
			for ( const [ t0, t1, cut ] of pieces ) {

				const P = t => [ a.X + ( c.X - a.X ) * t, a.Y + ( c.Y - a.Y ) * t ];
				const [ PX, PY ] = P( t0 ), [ QX, QY ] = P( t1 );
				const bottom = ( X, Y ) => terrainAt( X, Y ) + BASE_HEIGHT + ( cut ? cut : - 1.0 );
				if ( cut && bottom( PX, PY ) > roofAt( PX, PY ) - 0.3 ) continue;
				const q = wallData.length / WALL_STRIDE;
				v( toLocal( PX, PY, bottom( PX, PY ) ), uA + ( uC - uA ) * t0 );
				v( toLocal( QX, QY, bottom( QX, QY ) ), uA + ( uC - uA ) * t1 );
				v( toLocal( QX, QY, roofAt( QX, QY ) ), uA + ( uC - uA ) * t1 );
				v( toLocal( PX, PY, roofAt( PX, PY ) ), uA + ( uC - uA ) * t0 );
				if ( frontIsCCW ) wallIdx.push( q, q + 1, q + 2, q, q + 2, q + 3 );
				else wallIdx.push( q, q + 2, q + 1, q, q + 3, q + 2 );

			}

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

			// Decorations this facade has in its house description.
			const extra = house?.edges?.[ i ];
			if ( extra ) {

				const rot = + Math.atan2( nx, - ny ).toFixed( 3 ); // faces outwards (scene frame)
				// Heights from the ground in front of the facade (a house's lowest ground can be a street below).
				const at = ( t, out, h ) => {

					const X = ax + ( bx - ax ) * t + nx * out, Y = ay + ( by - ay ) * t + ny * out;
					const front = terrainAt( X + nx * 1.5, Y + ny * 1.5 ) + BASE_HEIGHT;
					const [ x, y, z ] = toLocal( X, Y, Math.max( ground, front ) + h );
					return [ + x.toFixed( 2 ), + y.toFixed( 2 ), + z.toFixed( 2 ) ];

				};

				if ( extra.awning ) decor.awnings.push( [ ...at( 0.5, 0, Math.min( 3.0, floorH * 0.9 ) ), rot, + ( len * 0.8 ).toFixed( 2 ), extra.awning ] );
				if ( extra.lanterns ) for ( let d = 4; d < len - 2; d += 9 ) decor.lanterns.push( [ ...at( d / len, 0, Math.min( 3.6, floorH * 1.05 ) ), rot ] );
				if ( extra.banner ) decor.banners.push( [ ...at( Math.min( 0.9, 1.5 / len ), 0, Math.min( floorH * 1.6, 6 ) ), rot, extra.banner.text, extra.banner.board, extra.banner.ink ] );

			}

		}

	}

	b.kept = true;
	buildingInfo.set( b.code, { ground, floorH, eaveY } );
	const [ lx, , lz ] = toLocal( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, 0 );
	meta.push( { id: b.id, code: b.code, area: + Math.abs( signedArea( b.poly.outer ) ).toFixed( 0 ), x: + lx.toFixed( 1 ), z: + lz.toFixed( 1 ), eave: + eave.toFixed( 1 ), rise: + roofRise.toFixed( 1 ), floors, name: b.name } );

}

console.log( `buildings: ${meta.length} (skipped ${skipped}, fallback triangulations ${fallbacks})` );
console.log( `roof vertices: ${roofData.length / ROOF_STRIDE}, roof triangles: ${roofIdx.length / 3}, wall vertices: ${wallData.length / WALL_STRIDE}` );

// ---------------------------------------------------------------------------
// Trees

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
//               G  pedestrian / open area surface, same coding; 40 where no open area is mapped near
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

// Kerbs follow the house fronts; the free-standing rotunda is not one (the street runs round it at full width).
const streetData = await loadStreets( { AREA, buildingDist, inBuilding: ( X, Y ) => {

	const id = buildingAt( X, Y );
	return keptIds.has( id ) && ! HAND_MODELLED.has( buildings[ id ]?.code );

}, tramPaths: JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ) } );
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
		surface2[ i + 1 ] = st.openSurface === null ? 40 : clamp( st.openSurface * 255 );
		surface2[ i + 2 ] = clamp( 128 - st.Fk * 25 );
		surface2[ i + 3 ] = streetData.onPlatform( X, Y ) ? 0 : 255; // pavement kind: 0 tram stop island, 255 mosaic

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


const inKeptBuilding = ( X, Y ) => keptIds.has( buildingAt( X, Y ) );
const pavement = buildPavementMesh( streetData, { AREA, toLocal, heightAt: terrainAt, inBuilding: ( X, Y ) => inKeptBuilding( X, Y ) || !! quay?.beyond( X, Y ) } );
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

const places = collectPlaces( { project: await lonLatToSJTSK(), quay, terraces, openings, buildings, streetFacades, toLocal, terrainAt, buildingAt, keptIds, dsm, idGrid, AREA, ORIGIN, streetData, furniture, riverAt, buildingInfo, terrainGrid: { terrain, tw, th, cell: TERRAIN_CELL }, inPark: ( X, Y ) => parks.some( rings => pointInRings( rings, X, Y ) ), tramPaths: JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ) } );
places.chapel = twinGableFronts[ 0 ] ? { ...twinGableFronts[ 0 ], spire: [ - 36.5, 42.8 ] } : null; // spire: from the aerial photo
// Awnings on fronts away from the street network (on squares), placed by places.mjs.
decor.awnings.push( ...places.awnings );
delete places.awnings;

// Name boards over the shop windows, one per wall position (several shops on one spot are spread along the wall).
const signs = [];
const used = new Map();
// OSM points that are out of date or that the modelled venues replace.
const STALE_SIGNS = new Set( [ 'R. M. Rilke', 'Champagneria', 'Standard Cafe', 'Hostinec u Rotundy' ] );
for ( const sg of pendingSigns ) {

	const info = buildingInfo.get( sg.b.code );
	if ( ! info ) continue;
	const ring = sg.b.poly.outer;
	const [ ax, ay ] = ring[ sg.i ], [ bx, by ] = ring[ ( sg.i + 1 ) % ring.length ];
	const len = Math.hypot( bx - ax, by - ay );
	// The signature places carry their own signs (tools/places.mjs).
	const [ sx, , sz ] = toLocal( ax + ( bx - ax ) * sg.t, ay + ( by - ay ) * sg.t, 0 );
	if ( [ ...places.signs, ...places.fronts ].some( p => Math.hypot( p.x - sx, p.z - sz ) < ( p.width ? p.width / 2 + 3 : 9 ) ) ) continue;
	if ( STALE_SIGNS.has( sg.name ) ) continue;
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

	const front = terrainAt( px + nx * 1.5, py + ny * 1.5 ) + BASE_HEIGHT; // the street in front, not the house's lowest ground
	const h = Math.max( info.ground, Math.min( front, info.eaveY - 2 * info.floorH ) ) + Math.min( 3.9, Math.max( 3.0, info.floorH * 0.88 ) );
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
await writeFile( new URL( 'embankment.bin', OUT ), new Float32Array( embankment.stone ) );
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
	groundFloors,
	roofStride: ROOF_STRIDE,
	buildings: meta,
	furniture,
	signs,
	kerbHeight: streetData.KERB_HEIGHT,
	decor,
	embankment: { posts: embankment.posts, rails: embankment.rails },
	places,
	streets
} ) );

console.log( 'written to public/data/' );
