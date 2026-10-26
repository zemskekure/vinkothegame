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
import { AREA, WEST_AREA, FIRST_AREA, ORIGIN } from './area.mjs';
import { loadStreets, buildPavementMesh, collectFurniture } from './streets.mjs';
import { collectPlaces } from './places.mjs';
import { lonLatToSJTSK, lonLatToSJTSKBeyond, toCadastre } from './geo.mjs';
import { TOWER_CODES as KARLUV_TOWERS, GATE_WAY as KARLUV_GATE, underKarluv } from './karluv.mjs';
import { PETRIN_TOWER } from './petrin.mjs';
import { ROOF_CAP, DOME_TOWERS } from './domes.mjs';
import { OLDTOWN_HAND } from './oldtown.mjs';
import { findOpenings, openingBox, clipToBox } from './openings.mjs';
import { buildQuay } from './quay.mjs';
import { buildTerraces } from './terraces.mjs';
import { packColumns } from './pack.mjs';
import { rtin, rtinSize } from './rtin.mjs';

const RAW = new URL( '../data/raw/', import.meta.url );
const OUT = new URL( '../public/data/', import.meta.url );

const BASE_HEIGHT = 184;
const ROOF_GRID = 1.0; // spacing of interior roof samples (m)
// The roof meshes are coarser, as a late-90s game would have built them: every second sample each way (the heights
// are still measured from all of them) and a point every few metres along the eaves (m). The walls keep their finer
// steps (the facade shader fits window bays to them).
const ROOF_MESH = 2, ROOF_EDGE_STEP = 4.0;
const EDGE_STEP = 1.5; // max wall segment length (m)
// Outside the first area (Malá Strana, Kampa, Petřín, the strip north of Karlova), modelled from the data alone,
// houses get half as many roof samples each way and wall segments twice as long: the area is three times the size,
// and these meshes are most of what the game downloads and draws.
const ROOF_GRID_WIDE = 2.0, ROOF_EDGE_STEP_WIDE = 6.0, EDGE_STEP_WIDE = 3.0;
const EDGE_INSET = 0.7; // roof edge heights are sampled this far inside the footprint

// ---------------------------------------------------------------------------
// Rasters

async function loadRaster( name ) {

	const tiff = await fromFile( new URL( `${name}.tif`, RAW ).pathname );
	const image = await tiff.getImage();
	const bounds = image.getBoundingBox();
	if ( [ AREA.xmin, AREA.ymin, AREA.xmax, AREA.ymax ].some( ( v, i ) => Math.abs( v - bounds[ i ] ) > 0.01 ) ) throw new Error( `${name}: raster bounds do not match AREA; run node tools/fetch-data.mjs` );
	const [ data ] = await image.readRasters();
	const width = image.getWidth(), height = image.getHeight();
	await tiff.close();
	const cell = ( AREA.xmax - AREA.xmin ) / width;
	return { data, width, height, cell, westWidth: Math.round( ( WEST_AREA.xmax - AREA.xmin ) / cell ), westRow: Math.round( ( AREA.ymax - WEST_AREA.ymax ) / cell ) };

}

// Bilinear sample at S-JTSK coordinates; row 0 is the northern edge. Inside the previous box, its edge samples
// keep the original clamp rather than picking up a new neighbour across the old boundary.
function sample( r, X, Y ) {

	const west = X >= WEST_AREA.xmin && X <= WEST_AREA.xmax && Y >= WEST_AREA.ymin && Y <= WEST_AREA.ymax;
	const fx = Math.min( Math.max( ( X - AREA.xmin ) / r.cell - 0.5, 0 ), ( west ? r.westWidth : r.width ) - 1.001 );
	const fy = Math.min( Math.max( ( AREA.ymax - Y ) / r.cell - 0.5, west ? r.westRow : 0 ), r.height - 1.001 );
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

			const west = x < r.westWidth && y >= r.westRow;
			let n = 0;
			for ( let dy = - 1; dy <= 1; dy ++ ) {

				for ( let dx = - 1; dx <= 1; dx ++ ) {

					const xx = Math.min( Math.max( x + dx, 0 ), ( west ? r.westWidth : w ) - 1 );
					const yy = Math.min( Math.max( y + dy, west ? r.westRow : 0 ), h - 1 );
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

	const project = await lonLatToSJTSKBeyond( FIRST_AREA, AREA ); // moved onto the cadastre beyond the first area
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
	let added = 0;
	const FOOTPRINT_FIXES = JSON.parse( await readFile( new URL( '../data/footprint-fixes.json', import.meta.url ) ) );
	for ( const w of osm ) {

		const t = w.tags || {};
		if ( w.type !== 'way' || ! t.building || t.building === 'no' || t.building === 'roof' || ( Number( t.layer ) || 0 ) < 0 || t.location === 'underground' ) continue;
		// The gate between the Lesser Town bridge towers is drawn by src/karluv.js (two walls, open between them); OSM's
		// outline of the Old Town bridge tower is RÚIAN's tower 10 m off (inside the first area OSM isn't moved onto the
		// cadastre), a second tower beside the real one.
		if ( w.id === KARLUV_GATE || w.id === 839278890 ) continue;
		const ring = w.nodes.map( id => nodes.get( id ) ).filter( Boolean ).map( n => project( n.lon, n.lat ) );
		if ( ring.length < 4 ) continue;
		ring.pop();
		// Hand corrections where an OSM outline is plainly off the aerial photo (data/footprint-fixes.json, scene frame).
		for ( const { from, to } of FOOTPRINT_FIXES[ w.id ]?.move || [] ) {

			const p = ring.find( q => Math.hypot( q[ 0 ] - ORIGIN.x - from[ 0 ], ORIGIN.y - q[ 1 ] - from[ 1 ] ) < 0.5 );
			if ( p ) p.splice( 0, 2, ORIGIN.x + to[ 0 ], ORIGIN.y - to[ 1 ] );
			else console.warn( `footprint fix: no corner of way ${w.id} at ${from}` );

		}

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
const RUSTIC = { none: 0, banded: 1, ornate: 2, clad: 3, rubble: 4 };
// Described ground floors (data/houses.json edges.<i>.ground): the openings of one street front from left to right,
// as seen from the street, e.g. [ "shop", { "kind": "door", "frame": "dark", "glazed": true }, "garage" ]. Widths are
// typical for each kind (narrow / normal / wide), not measured; the piers between the openings share the rest of the
// front. Each front becomes a row of openings [ u0, u1, kind, frame, flags ] for the facade shader (src/main.js).
const GF_KIND = { door: 1, gate: 2, shop: 3, window: 4, garage: 5, niche: 6, blank: 7 };
const GF_FRAME = { wood: 0, dark: 1, white: 2, green: 3, grey: 4, red: 5 };
const GF_DEFAULT_FRAME = { door: 'wood', gate: 'wood', shop: 'dark', window: 'white', garage: 'grey', niche: 'white' };
const GF_WIDTH = { door: [ 1.0, 1.3, 1.8 ], gate: [ 2.6, 3.0, 3.6 ], shop: [ 1.8, 2.6, 4.2 ], window: [ 0.9, 1.2, 1.5 ], garage: [ 2.4, 2.8, 3.4 ], niche: [ 1.4, 1.8, 2.2 ], blank: [ 1, 2, 4 ] };
const GF_MIN_PIER = 0.45;
const groundFloors = [], groundFloorRow = new Map();
// Where a real passage or arcade cuts a described front: [ u0, u1, depth ] ranges per front key (see the wall
// loop); depth is how far an arcade's back wall, with the shops along it, stands behind the front (0: a passage).
const frontCuts = new Map();

// Doors where OpenStreetMap has an entrance (entrance=yes/main/…, 170-odd in the area), moved onto the cadastre
// (tools/geo.mjs). Each street front gets a door at every entrance on it: in a described ground floor the door
// is let into the opening there or set between the openings; a front left to the shader gets its door bay there.
const ENTRANCES = await ( async () => {

	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( 'osm.json', RAW ) ) );
	return osm.filter( e => e.type === 'node' && e.tags?.entrance && ! [ 'no', 'emergency', 'exit', 'garage' ].includes( e.tags.entrance ) )
		.map( e => toCadastre( project( e.lon, e.lat ) ) );

} )();

// Entrances on the footprint edge E0 → E1: distances along it (m), for those within 1.6 m of the edge line.
function entrancesOn( E0, E1 ) {

	const len = Math.hypot( E1[ 0 ] - E0[ 0 ], E1[ 1 ] - E0[ 1 ] ), ux = ( E1[ 0 ] - E0[ 0 ] ) / len, uy = ( E1[ 1 ] - E0[ 1 ] ) / len;
	const out = [];
	for ( const [ X, Y ] of ENTRANCES ) {

		const s = ( X - E0[ 0 ] ) * ux + ( Y - E0[ 1 ] ) * uy, d = Math.abs( - ( X - E0[ 0 ] ) * uy + ( Y - E0[ 1 ] ) * ux );
		if ( d < 1.6 && s > 0.7 && s < len - 0.7 ) out.push( s );

	}

	return out.sort( ( a, b ) => a - b );

}

// A described front's row of openings with a door at each entrance (u: m from the left as seen from the street).
// An entrance in a shop window gets the glazed double door in it; in a window, the window becomes a door; between
// openings a door is set into the wall (glazed on a front of shops), the openings either side kept clear of it.
// A front of shops with no door at all gets the glazed door in its middle shop window.
function withEntrances( row, us, len ) {

	const shops = row.some( o => o[ 2 ] === GF_KIND.shop );
	for ( const u of us ) {

		const hit = row.find( o => u >= o[ 0 ] - 0.2 && u <= o[ 1 ] + 0.2 );
		if ( hit ) {

			if ( hit[ 2 ] === GF_KIND.shop ) hit[ 4 ] |= 8;
			else if ( hit[ 2 ] === GF_KIND.window ) {

				hit[ 2 ] = GF_KIND.door;
				hit[ 4 ] |= 4;

			}

			continue;

		}

		const d0 = Math.max( 0.3, u - 0.65 ), d1 = Math.min( len - 0.3, u + 0.65 );
		for ( let k = row.length - 1; k >= 0; k -- ) {

			const o = row[ k ];
			if ( o[ 1 ] <= d0 - 0.3 || o[ 0 ] >= d1 + 0.3 ) continue;
			if ( o[ 0 ] < d0 ) o[ 1 ] = + ( d0 - 0.3 ).toFixed( 2 );
			else o[ 0 ] = + ( d1 + 0.3 ).toFixed( 2 );
			if ( o[ 1 ] - o[ 0 ] < 0.6 ) row.splice( k, 1 );

		}

		row.push( [ + d0.toFixed( 2 ), + d1.toFixed( 2 ), GF_KIND.door, shops ? GF_FRAME.dark : GF_FRAME.wood, shops ? 4 : 0 ] );

	}

	if ( shops && ! row.some( o => o[ 2 ] === GF_KIND.door || o[ 2 ] === GF_KIND.gate || ( o[ 4 ] & 8 ) ) ) {

		const list = row.filter( o => o[ 2 ] === GF_KIND.shop );
		list.sort( ( a, b ) => Math.abs( ( a[ 0 ] + a[ 1 ] ) / 2 - len / 2 ) - Math.abs( ( b[ 0 ] + b[ 1 ] ) / 2 - len / 2 ) );
		list[ 0 ][ 4 ] |= 8;

	}

	return row.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );

}

function layoutGroundFloor( items, len ) {

	const list = items.map( it => typeof it === 'string' ? { kind: it } : it ).filter( it => GF_KIND[ it.kind ] );
	const flagsOf = it => ( it.arch ? 1 : 0 ) | ( it.bars ? 2 : 0 ) | ( it.glazed ? 4 : 0 ) | ( it.door ? 8 : 0 );
	// Openings measured off a photo carry their own place on the front: `at: [ u0, u1 ]` m from the left end as seen
	// from the street; such a front is laid out exactly as given.
	if ( list.length && list.every( it => Array.isArray( it.at ) ) ) {

		return list.filter( it => it.kind !== 'blank' && it.at[ 0 ] < len ).map( it => [ + it.at[ 0 ].toFixed( 2 ), + Math.min( len - 0.2, it.at[ 1 ] ).toFixed( 2 ), GF_KIND[ it.kind ], GF_FRAME[ it.frame || GF_DEFAULT_FRAME[ it.kind ] ] ?? 0, flagsOf( it ) ] );

	}

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
		if ( it.kind !== 'blank' ) row.push( [ + u.toFixed( 2 ), + ( u + w ).toFixed( 2 ), GF_KIND[ it.kind ], GF_FRAME[ it.frame || GF_DEFAULT_FRAME[ it.kind ] ] ?? 0, flagsOf( it ) ] );
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
const STYLE = { default: 0, theatre: 1, maj: 2, chapel: 3, glassBlock: 4, curtain: 5, bronze: 6, gothic: 7 };
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

// Aerial photo (ČÚZK Ortofoto): real roof colours, and a check that tree candidates are green. The first area has a
// photo of its own, cut as before the area grew (tools/fetch-data.mjs), so what is read off it there stays the same.
const photo = jpeg.decode( await readFile( new URL( 'ortho.jpg', RAW ) ), { useTArray: true, maxMemoryUsageInMB: 2048 } );
const westPhoto = jpeg.decode( await readFile( new URL( 'ortho-west.jpg', RAW ) ), { useTArray: true, maxMemoryUsageInMB: 2048 } );
const firstPhoto = jpeg.decode( await readFile( new URL( 'ortho-first.jpg', RAW ) ), { useTArray: true, maxMemoryUsageInMB: 2048 } );
const inFirstArea = ( X, Y ) => X >= FIRST_AREA.xmin && X < FIRST_AREA.xmax && Y > FIRST_AREA.ymin && Y <= FIRST_AREA.ymax;
const inWestArea = ( X, Y ) => X >= WEST_AREA.xmin && X < WEST_AREA.xmax && Y > WEST_AREA.ymin && Y <= WEST_AREA.ymax;
function photoAt( X, Y ) {

	const [ img, A ] = inFirstArea( X, Y ) ? [ firstPhoto, FIRST_AREA ] : inWestArea( X, Y ) ? [ westPhoto, WEST_AREA ] : [ photo, AREA ];
	const c = Math.floor( ( X - A.xmin ) / ( A.xmax - A.xmin ) * img.width );
	const r = Math.floor( ( A.ymax - Y ) / ( A.ymax - A.ymin ) * img.height );
	if ( c < 0 || r < 0 || c >= img.width || r >= img.height ) return null;
	const i = ( r * img.width + c ) * 4;
	return [ img.data[ i ], img.data[ i + 1 ], img.data[ i + 2 ] ];

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
// are smooth slopes. Two passes of a separable 9 m box blur. The earlier box keeps its original blur boundary.
const westRow = Math.round( ( AREA.ymax - WEST_AREA.ymax ) / TERRAIN_CELL );
const westCol = Math.round( ( WEST_AREA.xmax - AREA.xmin ) / TERRAIN_CELL );
for ( let pass = 0; pass < 2; pass ++ ) {

	for ( const [ n, stride, count, step ] of [ [ tw, 1, th, tw ], [ th, tw, tw, 1 ] ] ) {

		const line = new Float32Array( n );
		for ( let k = 0; k < count; k ++ ) {

			const base = k * step;
			const westLine = stride === 1 ? k >= westRow : k <= westCol;
			const westMin = stride === 1 ? 0 : westRow, westMax = stride === 1 ? westCol : th - 1;
			for ( let i = 0; i < n; i ++ ) line[ i ] = terrain[ base + i * stride ];
			for ( let i = 0; i < n; i ++ ) {

				const keep = westLine && i >= westMin && i <= westMax;
				const lo = keep ? westMin : 0, hi = keep ? westMax : n - 1;
				let sum = 0, m = 0;
				for ( let d = - 4; d <= 4; d ++ ) {

					const j = i + d;
					if ( j >= lo && j <= hi ) {

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
// The same Vltava surface continues into the new strip without changing the level in the earlier area.
for ( let r = westRow; r < th; r ++ ) for ( let c = 0; c <= westCol; c ++ ) {

	const i = r * tw + c;
	if ( riverMask[ i ] ) waterLevel = Math.min( waterLevel, terrain[ i ] );

}
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
			const west = r >= westRow && c <= westCol;
			for ( const [ dr, dc ] of [ [ - 1, 0 ], [ 1, 0 ], [ 0, - 1 ], [ 0, 1 ], [ - 1, - 1 ], [ - 1, 1 ], [ 1, - 1 ], [ 1, 1 ] ] ) {

				const rr = r + dr, cc = c + dc;
				if ( rr < 0 || cc < 0 || rr >= th || cc >= tw || dist[ rr * tw + cc ] !== 255 ) continue;
				if ( ! west && rr >= westRow && cc <= westCol ) continue;
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
			const west = r >= westRow && c <= westCol;
			let sum = 0, n = 0;
			for ( let dr = - 1; dr <= 1; dr ++ ) for ( let dc = - 1; dc <= 1; dc ++ ) {

				const rr = r + dr, cc = c + dc;
				if ( rr < 0 || cc < 0 || rr >= th || cc >= tw || dist[ rr * tw + cc ] <= d ) continue;
				if ( west && ( rr < westRow || cc > westCol ) ) continue;
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

// Smetanovo nábřeží's river edge (tools/quay.mjs): the straight railing along the riverside pavement, the
// náplavka below it, Čapadlo; measured on the terrain model, so before the embankment that it shapes.
const quay = await buildQuay( { terrain, tw, th, cell: TERRAIN_CELL, AREA, riverAt, dtmAt: ( X, Y ) => sample( dtm, X, Y ) - BASE_HEIGHT } );

// Most Legií's deck (tools/places.mjs builds it on the ZABAGED axis): no embankment parapet or railing across it.
const legieAxis = ( ( b => b.features || b )( JSON.parse( await readFile( new URL( 'bridges.json', RAW ) ) ) ) ).find( f => f.attributes?.jmeno === 'most Legií' )?.geometry?.paths?.[ 0 ] || [];
const underLegie = ( X, Y ) => {

	const east = legieAxis.reduce( ( m, p ) => p[ 0 ] > m[ 0 ] ? p : m, [ - Infinity, 0 ] );
	if ( X > east[ 0 ] ) return false;
	for ( let i = 1; i < legieAxis.length; i ++ ) {

		const [ ax, ay ] = legieAxis[ i - 1 ], [ bx, by ] = legieAxis[ i ], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
		const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / l2 ) );
		if ( Math.hypot( X - ax - t * dx, Y - ay - t * dy ) < ( X > east[ 0 ] - 40 ? 11.8 : 8.6 ) ) return true;

	}

	return false;

};
if ( quay ) quay.rail = quay.lines[ 0 ] = quay.rail.filter( p => ! underLegie( p.X, p.Y ) );

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
				// Along Smetanovo nábřeží: the náplavka's edge is a plain stone wall with a flush coping and no railing;
				// where the street runs to the water, the wall goes up under the street's own railing (tools/quay.mjs).
				if ( underLegie( mx, my ) ) continue;
				const front = quay?.edge( mx + nx * 1.5, my + ny * 1.5 );
				if ( front ) {

					const t0 = h0 + 0.05, t1 = h1 + 0.05, low = waterLevel - 1;
					const ix0 = x0 + nx * THICK, iy0 = y0 + ny * THICK, ix1 = x1 + nx * THICK, iy1 = y1 + ny * THICK;
					push( [ x0, y0, low ], [ x1, y1, low ], [ x1, y1, t1 ], [ x0, y0, low ], [ x1, y1, t1 ], [ x0, y0, t0 ] );
					push( [ x0, y0, t0 ], [ x1, y1, t1 ], [ ix1, iy1, t1 ], [ x0, y0, t0 ], [ ix1, iy1, t1 ], [ ix0, iy0, t0 ] );
					continue;

				}

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

// By the National Theatre: Národní's deck over Divadelní, the piazzetta's terrace (tools/terraces.mjs).
const terraces = await buildTerraces( { terrain, tw, th, cell: TERRAIN_CELL, AREA, bareAt: ( X, Y ) => sample( dtm, X, Y ) - BASE_HEIGHT, buildings } );

// A railing line (tools/quay.mjs format): a stone curb with the railing on top, a retaining wall down to the
// lower level where there is one, open below `openTop` (or 2.8 m over the low side) where a passage runs under.
function drawRail( R ) {

	const push = ( ...pts ) => {

		for ( const [ X, Y, H ] of pts ) embankment.stone.push( ...toLocal( X, Y, H + BASE_HEIGHT ).map( v => + v.toFixed( 3 ) ) );

	};

	for ( let i = 1; i < R.length; i ++ ) {

		const a = R[ i - 1 ], b = R[ i ];
		if ( a.river || b.river || Math.hypot( b.X - a.X, b.Y - a.Y ) > 2 ) continue;
		// A heavy stone parapet (the piazzetta) or a low curb under an iron railing; a bare wall has neither (the
		// back wall under the piazzetta's cantilever, the deck's face over a tunnel mouth).
		const CURB = a.bare ? 0 : a.parapet ? 1.0 : 0.3, THICK = a.thick ?? ( a.parapet ? 0.6 : 0.4 );
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

		if ( a.bare ) continue;
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

if ( quay ) for ( const line of quay.lines ) drawRail( line );
if ( terraces?.tunnel && terraces.rails ) for ( const line of terraces.rails.slice( 0, 2 ) ) for ( const p of line ) p.openTop = terraces.tunnel.ceil;
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
// Passages under the modern landmarks (Nová scéna) are plain rectangular openings, not vaulted stone portals.
for ( const o of openings ) {

	const s = landmarkAt( o.X, o.Y )?.style;
	if ( s === STYLE.glassBlock || s === STYLE.curtain || s === STYLE.bronze || s === STYLE.maj ) o.modern = true;
	// DRN's passage from Národní to its courtyard: about 5 m wide under a flat ceiling (Street View 2025-09).
	if ( s === STYLE.curtain && o.kind === 'passage' ) o.drn = true;

}

// Nová scéna stands on an open undercroft (tools/terraces.mjs): its glass-block mass starts 3 m over the square
// (OSM min_height), and the west part of the ground floor is open from Národní through to the piazzetta, with two
// stone-clad blocks standing in it (Street View 2019). Its walls stop at the soffit there; the passages OSM maps
// under it (drawn ten metres off, with the rest of OSM) are part of that open floor and dropped.
if ( terraces.undercroft ) {

	const u = terraces.undercroft;
	const inside = ( X, Y ) => pointInRings( [ u.ring.map( ( [ x, z ] ) => [ x + ORIGIN.x, ORIGIN.y - z ] ) ], X, Y );
	for ( let k = openings.length - 1; k >= 0; k -- ) if ( inside( openings[ k ].X, openings[ k ].Y ) ) openings.splice( k, 1 );
	for ( const o of openings ) if ( o.modern && o.kind === 'passage' ) Object.assign( o, { w: o.drn ? 5 : 7, h: 4.6 } ); // as before, elsewhere
	const xs = u.ring.map( p => p[ 0 ] ), zs = u.ring.map( p => p[ 1 ] );
	const x0 = Math.min( ...xs ) - 1, x1 = u.lobby, z0 = Math.min( ...zs ) - 1, z1 = Math.max( ...zs ) + 1;
	const zf = Math.max( ...u.front.map( p => p[ 1 ] ) );
	const boxAt = ( xa, xb, za, zb, h ) => ( { o: { kind: 'passage', h }, box: { X: ( xa + xb ) / 2 + ORIGIN.x, Y: ORIGIN.y - ( za + zb ) / 2, ux: 1, uy: 0, hu: ( xb - xa ) / 2, hn: ( zb - za ) / 2 } } );
	openingBoxes.length = 0;
	openingBoxes.push( ...openings.map( o => ( { o, box: openingBox( o, 0.05, 0.4 ) } ) ) );
	// On Národní the street face stands on the pavement half a metre below the square.
	openingBoxes.push( boxAt( x0, x1, z0, zf + 1, + ( u.soffit - u.foot ).toFixed( 2 ) ), boxAt( x0, x1, zf + 1, z1, + ( u.soffit - u.level ).toFixed( 2 ) ) );

}

const landmarkStatues = [];
const twinGableFronts = [];


// Hand-written house descriptions read from street photos (data/houses.json), and the street decorations they
// ask for: awnings, wall lanterns, hanging banners.
const HOUSES = JSON.parse( await readFile( new URL( '../data/houses.json', import.meta.url ) ) );
const srgb = hex => [ 1, 3, 5 ].map( i => parseInt( hex.slice( i, i + 2 ), 16 ) / 255 );
const decor = { awnings: [], lanterns: [], banners: [], balconies: [], shopfronts: [] };

// Real shopfronts: every named shop / café / restaurant… in OSM is pinned to the nearest building wall,
// whose ground floor then becomes a shop front, with a name board above it (placed after the geometry pass).
const SIGN_AMENITIES = new Set( [ 'cafe', 'restaurant', 'bar', 'pub', 'fast_food', 'ice_cream', 'pharmacy', 'bank', 'bureau_de_change', 'theatre', 'cinema', 'nightclub' ] );
const shopEdges = new Set();
const pendingSigns = [];
{

	const project = await lonLatToSJTSKBeyond( FIRST_AREA, AREA );
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
// Rotunda sv. Kříže Menšího; the bridge towers of Karlův most (tools/karluv.mjs, src/karluv.js); the Petřín lookout
// tower (tools/petrin.mjs, src/petrin.js); St Nicholas's belfry (tools/domes.mjs, src/domes.js); Prašná brána (tools/oldtown.mjs, src/oldtown.js).
const HAND_MODELLED = new Set( [ 40354954, ...Object.values( KARLUV_TOWERS ), PETRIN_TOWER, ...DOME_TOWERS, ...OLDTOWN_HAND ] );
const inKarluvArches = underKarluv( JSON.parse( await readFile( new URL( 'bridges.json', RAW ) ) ) );

for ( const b of buildings ) {

	const rings = [ b.poly.outer, ...b.poly.holes ];
	if ( HAND_MODELLED.has( b.code ) ) {

		b.kept = true;
		continue;

	}

	if ( inKarluvArches( b.poly.outer ) ) {

		b.underKarluv = true;
		continue;

	}

	let ground = Infinity;
	for ( const ring of rings ) for ( const [ X, Y ] of ring ) ground = Math.min( ground, terrainAt( X, Y ) + BASE_HEIGHT );

	const wide = ! inFirstArea( ( b.bbox[ 0 ] + b.bbox[ 2 ] ) / 2, ( b.bbox[ 1 ] + b.bbox[ 3 ] ) / 2 );
	const edges = rings.map( ring => densify( ring, wide ? EDGE_STEP_WIDE : EDGE_STEP ).map( ( [ X, Y, edge, along, edgeLen ], i, arr ) => {

		const prev = arr[ ( i + arr.length - 1 ) % arr.length ], next = arr[ ( i + 1 ) % arr.length ];
		let nx = - ( next[ 1 ] - prev[ 1 ] ), ny = next[ 0 ] - prev[ 0 ];
		const l = Math.hypot( nx, ny ) || 1;
		return { X, Y, edge, along, edgeLen, measured: insetHeight( rings, X, Y, nx / l, ny / l ) };

	} ) );

	const interior = [];
	const [ x0, y0, x1, y1 ] = b.bbox;
	const landmark = landmarkAt( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2 );
	const grid = landmark ? ROOF_GRID / 2 : wide ? ROOF_GRID_WIDE : ROOF_GRID; // landmark roofs get a finer mesh: crisper hips and ridges
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
	const flat = rise < 1.3 || landmark?.roof === ROOF_KIND.flat || HOUSES[ b.code ]?.roof === 'flat';
	const maxDepth = interior.reduce( ( m, p ) => Math.max( m, p.d ), 0 );
	// Churches whose domes rise out of the roof (tools/domes.mjs) keep their roofs low.
	const roofRise = flat ? 0 : Math.min( rise, maxDepth * ROOF_SLOPE, ROOF_CAP[ b.code ] ?? 22 );

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
	else if ( house?.roof && ROOF_KIND[ house.roof ] !== undefined ) kind = ROOF_KIND[ house.roof ];

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

	// The roof's own outline: the footprint's corners and points every few metres between them (the eaves are level,
	// so the walls' finer steps meet it without gaps); the twin gables need every step of theirs.
	const roofEdges = landmark?.twinGables ? edges : rings.map( ring => densify( ring, wide ? ROOF_EDGE_STEP_WIDE : ROOF_EDGE_STEP ).map( ( [ X, Y ] ) => ( { X, Y } ) ) );
	const boundary = roofEdges.flat();
	const meshGrid = grid * ROOF_MESH, on = v => Math.abs( v / meshGrid - Math.round( v / meshGrid ) ) < 1e-6;
	const coarse = interior.filter( p => on( p.X ) && on( p.Y ) && p.d > meshGrid * 0.45 );
	// A house too narrow for the coarse grid keeps all its samples (else its roof would come out flat).
	const meshPoints = coarse.length * ROOF_MESH * ROOF_MESH >= interior.length * 0.5 ? coarse : interior;
	const points = flat ? boundary : [ ...boundary, ...meshPoints ];
	try {

		let n = 0;
		const mk = () => p => Object.assign( new poly2tri.Point( p.X, p.Y ), { idx: n ++ } );
		const ctx = new poly2tri.SweepContext( roofEdges[ 0 ].map( mk() ) );
		for ( let h = 1; h < roofEdges.length; h ++ ) ctx.addHole( roofEdges[ h ].map( mk() ) );
		if ( ! flat ) ctx.addPoints( meshPoints.map( mk() ) );
		ctx.triangulate();
		tris = ctx.getTriangles().map( t => t.getPoints().map( p => p.idx ) );

	} catch ( e ) {

		fallbacks ++;
		const contour = roofEdges[ 0 ].map( p => new Vector2( p.X, p.Y ) );
		const holes = roofEdges.slice( 1 ).map( h => h.map( p => new Vector2( p.X, p.Y ) ) );
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
			// A front with a described ground floor is a street front, whole: the street centrelines (OSM) run ~10 m
			// off the houses (tools/geo.mjs), which made the west half of Kaňkův palác on Národní a plain rear wall.
			else if ( ringIndex === 0 && Array.isArray( house?.edges?.[ a.edge ]?.ground ) ) kind = WALL_KIND.street;
			// On a street as wide as Národní (25 m between the fronts) a point 3 m out is still more than 9 m from the
			// centreline: open ground for 8 m out with the centreline near its end is a street front too (Café Louvre's
			// front was a rear wall, windows only). The theatre end of Národní is left as it was (worked on separately).
			else if ( ringIndex === 0 && ! ( mx - ORIGIN.x < - 240 && ORIGIN.y - my > 290 ) && streetDistance( mx + nx * 8, my + ny * 8 ) < 9 &&
				[ 1, 2, 3, 4, 5, 6, 7, 8 ].every( d => buildingAt( mx + nx * d, my + ny * d ) < 0 ) ) kind = WALL_KIND.street;

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
			// One RÚIAN building can join houses that look nothing alike (DRN's glass corner on Národní and the
			// baroque houses behind it on Mikulandská), so a front can name its own style, colours and stucco.
			const look = ringIndex === 0 ? house?.edges?.[ a.edge ] : null;
			const wallStyle = STYLE[ look?.style ] ?? style;
			const colour = look?.colour ?? house?.colour, trim = look?.trim ?? house?.trim;
			const [ cr, cg, cb ] = colour ? srgb( colour ) : measured.colour || [ - 1, - 1, - 1 ];
			const [ tr, tg, tb ] = trim ? srgb( trim ) : [ - 1, - 1, - 1 ];
			const houseGround = GROUND[ house?.ground ] ?? 0;
			// Window bars in the low bit; above it the row of this front's described ground floor (0 = none).
			let grilles = house?.grilles ? 1 : 0;
			// Entrances on this front, as u (see withEntrances); on a front left to the shader the first one is
			// its door bay, packed with the graffiti flag: graffiti + 2 × ( u in quarter metres + 1 ).
			const ring0 = rings[ ringIndex ], E0 = ring0[ a.edge ], E1 = ring0[ ( a.edge + 1 ) % ring0.length ];
			const entranceUs = ringIndex === 0 && kind === WALL_KIND.street ? entrancesOn( E0, E1 ).map( s => readsAtoC ? s : a.edgeLen - s ).sort( ( p, q ) => p - q ) : [];
			const gfItems = ringIndex === 0 && kind === WALL_KIND.street ? house?.edges?.[ a.edge ]?.ground : null;
			if ( Array.isArray( gfItems ) ) {

				const key = `${b.code}_${a.edge}`;
				if ( ! groundFloorRow.has( key ) ) {

					groundFloorRow.set( key, groundFloors.length );
					groundFloors.push( withEntrances( layoutGroundFloor( gfItems, a.edgeLen ), entranceUs, a.edgeLen ) );

				}

				grilles += 2 * ( groundFloorRow.get( key ) + 1 );

			}

			const rusticName = look?.rustic ?? house?.rustic;
			const rustic = rusticName ? RUSTIC[ rusticName ] : - 1, graffiti = ( house?.graffiti ? 1 : 0 ) + ( entranceUs.length ? 2 * ( Math.round( entranceUs[ 0 ] / 0.25 ) + 1 ) : 0 );
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

			const v = ( P, uu ) => wallData.push( P[ 0 ], P[ 1 ], P[ 2 ], uu, a.edgeLen, wallBase - BASE_HEIGHT, eaveY - BASE_HEIGHT, floorH, seed, kind, cr, cg, cb, bay, win, shop, wallStyle, tr, tg, tb, houseGround, grilles, rustic, graffiti );

			// Arcades and passages (tools/openings.mjs): the wall stops at their ceiling where it crosses them.
			const pieces = [ [ 0, 1, 0, 0 ] ];
			for ( const { o, box } of openingBoxes ) {

				const r = clipToBox( box, a.X, a.Y, c.X, c.Y );
				if ( ! r ) continue;
				for ( let k = pieces.length - 1; k >= 0; k -- ) {

					const [ t0, t1, h, deep ] = pieces[ k ];
					const lo = Math.max( t0, r[ 0 ] ), hi = Math.min( t1, r[ 1 ] );
					if ( hi - lo < 1e-4 ) continue;
					const parts = [ [ t0, lo, h, deep ], [ lo, hi, Math.max( h, o.h ), o.kind === 'arcade' ? o.depth : 0 ], [ hi, t1, h, deep ] ].filter( ( [ p0, p1 ] ) => p1 - p0 > 1e-4 );
					pieces.splice( k, 1, ...parts );

				}

			}

			// Four corners per quad, two indexed triangles facing outwards.
			for ( const [ t0, t1, cut, deep ] of pieces ) {

				const P = t => [ a.X + ( c.X - a.X ) * t, a.Y + ( c.Y - a.Y ) * t ];
				const [ PX, PY ] = P( t0 ), [ QX, QY ] = P( t1 );
				const bottom = ( X, Y ) => terrainAt( X, Y ) + BASE_HEIGHT + ( cut ? cut : - 1.0 );
				if ( cut && bottom( PX, PY ) > roofAt( PX, PY ) - 0.3 ) continue;
				if ( cut && ringIndex === 0 ) {

					const key = `${b.code}_${a.edge}`, ua = uA + ( uC - uA ) * t0, ub = uA + ( uC - uA ) * t1;
					if ( ! frontCuts.has( key ) ) frontCuts.set( key, [] );
					frontCuts.get( key ).push( [ Math.min( ua, ub ), Math.max( ua, ub ), deep ] );

				}

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
			if ( streetDistance( mx + nx * 3, my + ny * 3 ) >= 9 && ! Array.isArray( house?.edges?.[ i ]?.ground ) && ! ( ! ( mx - ORIGIN.x < - 240 && ORIGIN.y - my > 290 ) && streetDistance( mx + nx * 8, my + ny * 8 ) < 9 && [ 1, 2, 3, 4, 5, 6, 7, 8 ].every( d => buildingAt( mx + nx * d, my + ny * d ) < 0 ) ) ) continue;
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

				if ( extra.awning ) decor.awnings.push( [ ...at( 0.5, 0, extra.awningAt ?? Math.min( 3.0, floorH * 0.9 ) ), rot, + ( len * 0.8 ).toFixed( 2 ), extra.awning ] );
				if ( extra.lanterns ) for ( let d = 4; d < len - 2; d += 9 ) decor.lanterns.push( [ ...at( d / len, 0, Math.min( 3.6, floorH * 1.05 ) ), rot ] );
				// Balconies: { floor, from, to, depth }, floor 1 = the first floor above the ground floor, from / to
				// fractions of the front from the left as seen from the street.
				const aIsLeft = ( bx - ax ) * - ny + ( by - ay ) * nx > 0;
				if ( extra.shopfront ) {

					const key = `${b.code}_${i}`;
					const overlayHeight = Math.min( extra.shopfrontHeight ?? 4.2, floorH );
					const cuts = ( frontCuts.get( key ) || [] ).map( ( [ u0, u1, deep ] ) => aIsLeft ? [ u0, u1, deep ] : [ len - u1, len - u0, deep ] )
						.map( ( [ u0, u1, deep ] ) => [ Math.max( 0, u0 ), Math.min( len, u1 ), deep ] ).filter( ( [ u0, u1 ] ) => u1 > u0 ).sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
					// [ from, to, depth ]: a passage leaves its stretch of the drawing out; under an arcade the
					// drawing moves back onto the arcade's back wall, where the shop windows are.
					const visible = [];
					let u = 0;
					for ( const [ u0, u1, deep ] of cuts ) {

						if ( u0 > u + 0.01 ) visible.push( [ + u.toFixed( 2 ), + u0.toFixed( 2 ), 0 ] );
						if ( deep > 0 && u1 > Math.max( u, u0 ) + 0.01 ) visible.push( [ + Math.max( u, u0 ).toFixed( 2 ), + u1.toFixed( 2 ), + deep.toFixed( 2 ) ] );
						u = Math.max( u, u1 );

					}
					if ( u < len - 0.01 ) visible.push( [ + u.toFixed( 2 ), + len.toFixed( 2 ), 0 ] );
					decor.shopfronts.push( { front: key, file: extra.shopfront, at: at( 0.5, 0, overlayHeight / 2 ), rot, width: + len.toFixed( 2 ), height: + overlayHeight.toFixed( 2 ), visible } );

				}
				for ( const bal of extra.balconies || [] ) {

					const f0 = aIsLeft ? bal.from : 1 - bal.to, f1 = aIsLeft ? bal.to : 1 - bal.from;
					decor.balconies.push( [ ...at( ( f0 + f1 ) / 2, 0, floorH * ( bal.floor || 1 ) ), rot, + ( ( f1 - f0 ) * len ).toFixed( 2 ), bal.depth || 0.8 ] );

				}

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
const TRAM_SEGMENTS = JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ).flatMap( p => p.slice( 1 ).map( ( q, i ) => [ p[ i ], q ] ) );
const nearTram = ( X, Y, d ) => TRAM_SEGMENTS.some( ( [ [ ax, ay ], [ bx, by ] ] ) => {

	const dx = bx - ax, dy = by - ay, t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
	return Math.hypot( X - ax - t * dx, Y - ay - t * dy ) < d;

} );
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
		// No tree stands on a tram line: a canopy peak there is a street tree's crown leaning over the tracks
		// (Národní), whose trunk is on the pavement and is mapped on its own.
		if ( nearTram( X, Y, 4 ) ) continue;
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
const streetData = await loadStreets( { AREA, FIRST_AREA, buildingDist, westBuildingDist: ( X, Y ) => buildingDist( Math.max( WEST_AREA.xmin, Math.min( WEST_AREA.xmax - dsm.cell, X ) ), Math.min( WEST_AREA.ymax, Math.max( WEST_AREA.ymin + dsm.cell, Y ) ) ), inBuilding: ( X, Y ) => {

	const id = buildingAt( X, Y );
	return keptIds.has( id ) && ! HAND_MODELLED.has( buildings[ id ]?.code );

}, tramPaths: JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ) } );
const surface2 = new Uint8Array( sw * sh * 4 );
const tramDist = polylineDistance( JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ), 6 );
const parks = JSON.parse( await readFile( new URL( 'greenery.json', RAW ) ) ).flatMap( f => f.geometry?.rings ? [ f.geometry.rings ] : [] );
// Beyond the first area, ZABAGED's orchards and gardens, vineyards, grassland, scrub and woods are green too (Petřín,
// the Strahov and Seminary gardens), with the footpaths through them and the funicular's track (OpenStreetMap, within
// 1.2 m of the line) left clear, so the paths up the hill and the funicular's line show.
const withBox = rings => {

	const xs = rings.flat().map( p => p[ 0 ] ), ys = rings.flat().map( p => p[ 1 ] );
	return { rings, box: [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ] };

};
const landcover = JSON.parse( await readFile( new URL( 'landcover.json', RAW ) ).catch( () => '[]' ) ).flatMap( f => f.geometry?.rings ? [ withBox( f.geometry.rings ) ] : [] );
const inLandcover = ( X, Y ) => landcover.some( ( { rings, box } ) => X >= box[ 0 ] && X <= box[ 2 ] && Y >= box[ 1 ] && Y <= box[ 3 ] && pointInRings( rings, X, Y ) );
const footpaths = polylineDistance( streetData.ways.filter( w => ( /^(footway|path|steps|track|pedestrian|bridleway|cycleway)$/.test( w.tags.highway ) || w.tags.railway === 'funicular' ) && ! w.tags.tunnel ).map( w => w.pts.map( p => [ p.X, p.Y ] ) ), 2 );

for ( let r = 0; r < sh; r ++ ) {

	const Y = AREA.ymax - ( r + 0.5 ) * SURF_CELL;
	for ( let c = 0; c < sw; c ++ ) {

		const X = AREA.xmin + ( c + 0.5 ) * SURF_CELL;
		const i = ( r * sw + c ) * 4;
		const clamp = v => Math.max( 0, Math.min( 255, Math.round( v ) ) );
		surface[ i ] = clamp( buildingDist( X, Y ) * 40 );
		surface[ i + 1 ] = parks.some( rings => pointInRings( rings, X, Y ) ) || ( ! inFirstArea( X, Y ) && footpaths[ r * sw + c ] > 1.2 && inLandcover( X, Y ) ) ? 255 : 0;
		const st = streetData.at( X, Y );
		surface[ i + 2 ] = clamp( 128 - st.F * 25 );
		surface[ i + 3 ] = clamp( tramDist[ r * sw + c ] * 50 );
		surface2[ i ] = clamp( st.roadAsphalt * 255 );
		surface2[ i + 1 ] = st.openSurface === null ? 40 : clamp( st.openSurface * 255 );
		surface2[ i + 2 ] = clamp( 128 - st.Fk * 25 );
		surface2[ i + 3 ] = streetData.onPlatform( X, Y ) ? 0 : 255; // pavement kind: 0 tram stop island, 255 mosaic
		const trench = terraces.trenchStreet( X, Y );
		if ( trench === 'road' ) {

			// Divadelní by the theatre: asphalt from the theatre to the covered pavement's kerb (tools/terraces.mjs).
			surface[ i + 2 ] = surface2[ i + 2 ] = 153;
			surface2[ i ] = 255;

		} else if ( trench === 'deck' ) {

			// The piazzetta's edge over it: large granite slabs, like the rest of the square.
			surface[ i + 2 ] = surface2[ i + 2 ] = 53;
			surface2[ i ] = 0;
			surface2[ i + 3 ] = 0;

		}

	}

}

// ---------------------------------------------------------------------------
// Ground detail from the aerial photo (25 cm): luminance divided by its local average over ~2 m, which keeps
// markings, mosaic patterns, kerb lines and wear but cancels the building shadows. 128 = neutral; neutral on
// roofs (inside footprints) and in the river. Row 0 = north, same frame as the photo. At full resolution over the
// first area from its own photo (ground-detail.jpg), at half resolution over the whole area (ground-detail-wide.jpg):
// the whole area at 25 cm would take four times the first area's GPU memory.
function groundDetail( img, A ) {

	const W = img.width, H = img.height, cell = ( A.xmax - A.xmin ) / W;
	const lum = new Float32Array( W * H );
	for ( let i = 0; i < W * H; i ++ ) lum[ i ] = 0.3 * img.data[ i * 4 ] + 0.59 * img.data[ i * 4 + 1 ] + 0.11 * img.data[ i * 4 + 2 ] + 4;

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
		const Y = A.ymax - ( y + 0.5 ) * cell;
		for ( let x = 0; x < W; x ++ ) {

			const x0 = Math.max( 0, x - R ), x1 = Math.min( W, x + R + 1 );
			const sum = integral[ y1 * ( W + 1 ) + x1 ] - integral[ y0 * ( W + 1 ) + x1 ] - integral[ y1 * ( W + 1 ) + x0 ] + integral[ y0 * ( W + 1 ) + x0 ];
			const mean = sum / ( ( x1 - x0 ) * ( y1 - y0 ) );
			const X = A.xmin + ( x + 0.5 ) * cell;
			const masked = keptIds.has( buildingAt( X, Y ) ) || riverAt( X, Y );
			const v = masked ? 128 : Math.max( 0, Math.min( 255, Math.round( 128 + ( lum[ y * W + x ] / mean - 1 ) * 160 ) ) );
			detail[ y * W * 4 + x * 4 ] = detail[ y * W * 4 + x * 4 + 1 ] = detail[ y * W * 4 + x * 4 + 2 ] = v;
			detail[ y * W * 4 + x * 4 + 3 ] = 255;

		}

	}

	return { detail, W, H };

}

{

	await mkdir( OUT, { recursive: true } );
	// Averaged down (k × k texels into one) for the game: 50 cm over the first area, 1 m over the whole area.
	const shrink = ( { detail, W, H }, k ) => {

		const w = Math.floor( W / k ), h = Math.floor( H / k ), out = Buffer.alloc( w * h * 4 );
		for ( let y = 0; y < h; y ++ ) for ( let x = 0; x < w; x ++ ) {

			let sum = 0;
			for ( let dy = 0; dy < k; dy ++ ) for ( let dx = 0; dx < k; dx ++ ) sum += detail[ ( ( y * k + dy ) * W + x * k + dx ) * 4 ];
			const v = Math.round( sum / ( k * k ) );
			out[ ( y * w + x ) * 4 ] = out[ ( y * w + x ) * 4 + 1 ] = out[ ( y * w + x ) * 4 + 2 ] = v;
			out[ ( y * w + x ) * 4 + 3 ] = 255;

		}

		return { data: out, width: w, height: h };

	};
	const first = shrink( groundDetail( firstPhoto, FIRST_AREA ), 2 );
	await writeFile( new URL( 'ground-detail.jpg', OUT ), jpeg.encode( first, 75 ).data );
	const wide = shrink( groundDetail( photo, AREA ), 4 );
	// The earlier area (Malá Strana and the first area) keeps its own photo cut's local contrast and pixel
	// alignment, as before the northern and eastern strips were added.
	{

		const west = shrink( groundDetail( westPhoto, WEST_AREA ), 4 );
		const ox = Math.round( WEST_AREA.xmin - AREA.xmin ), oy = Math.round( AREA.ymax - WEST_AREA.ymax );
		for ( let y = 0; y < west.height; y ++ ) west.data.copy( wide.data, ( ( y + oy ) * wide.width + ox ) * 4, y * west.width * 4, ( y + 1 ) * west.width * 4 );

	}

	await writeFile( new URL( 'ground-detail-wide.jpg', OUT ), jpeg.encode( wide, 75 ).data );
	const [ hw, hh ] = [ wide.width, wide.height ];
	first.W = first.width;
	first.H = first.height;
	console.log( `ground detail: ${first.W}x${first.H} over the first area, ${hw}x${hh} over all` );

}

// ---------------------------------------------------------------------------
// Raised pavements and street furniture


const inKeptBuilding = ( X, Y ) => keptIds.has( buildingAt( X, Y ) );
// Over Divadelní the street is a deck above the terrain grid (tools/terraces.mjs); along the river the quay walls clamp it.
const pavementOptions = { toLocal, heightAt: ( X, Y ) => terraces.deckAt( X, Y ) ?? ( quay ? quay.clamp( X, Y, terrainAt( X, Y ) ) : terrainAt( X, Y ) ), inBuilding: ( X, Y ) => inKeptBuilding( X, Y ) || !! quay?.beyond( X, Y ) || !! terraces.trenchStreet( X, Y ), cut: quay?.beyond };
// On a 1 m grid (as the street surface maps), the flat stretches meshed coarser (tools/rtin.mjs).
// Inside a house, away from its arcades and passages, the pavement mesh may run under the walls unseen.
const underHouse = ( X, Y ) => inKeptBuilding( X, Y ) && ! openingBoxes.some( ( { box } ) => {

	const u = ( X - box.X ) * box.ux + ( Y - box.Y ) * box.uy, v = - ( X - box.X ) * box.uy + ( Y - box.Y ) * box.ux;
	return Math.abs( u ) < ( box.hu ?? 0 ) + 2 && Math.abs( v ) < ( box.hn ?? 0 ) + 2;

} );
const pavement = buildPavementMesh( streetData, { ...pavementOptions, hidden: underHouse, AREA, STEP: 1 } );
console.log( `pavements: ${pavement.positions.length / 3} vertices, ${( pavement.kerbLength / 1000 ).toFixed( 1 )} km of kerb` );

const furniture = collectFurniture( streetData, {
	toLocal,
	heightAt: ( X, Y ) => ( terraces.deckAt( X, Y ) ?? terrainAt( X, Y ) ) + 0.03 + streetData.raise( streetData.at( X, Y ).Fk ),
	dsmTrees: trees,
	stableTree: ( x, z, dsm ) => {

		const X = x + ORIGIN.x, Y = ORIGIN.y - z, edge = dsm ? TREE_CELL * 2 : 0;
		return X > WEST_AREA.xmin + edge && X < WEST_AREA.xmax - edge && Y > WEST_AREA.ymin + edge && Y < WEST_AREA.ymax - edge;

	},
	treeHeightAt: ( X, Y ) => {

		// Mapped trees: height from the surface model where it shows a canopy, else a typical street tree.
		let h = 0;
		for ( let dy = - 2; dy <= 2; dy += 1 ) for ( let dx = - 2; dx <= 2; dx += 1 ) h = Math.max( h, sample( dsmRaw, X + dx, Y + dy ) - sample( dtm, X + dx, Y + dy ) );
		return h > 4 && h < 30 ? h : 9;

	}, tramPaths: JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ) } );
// Street lamps mapped on bridge decks over the Vltava would stand on the river bed (the decks are modelled in
// places.mjs with their own lamps): leave them out.
{

	const L = furniture.lamp, kept = [];
	for ( let i = 0; i < L.length; i += 5 ) if ( L[ i + 1 ] > waterLevel + 0.5 ) kept.push( ...L.slice( i, i + 5 ) );
	furniture.lamp = kept;

}
furniture.statue.push( ...landmarkStatues );

const projectRaw = await lonLatToSJTSK();
const places = collectPlaces( { FIRST_AREA, project: await lonLatToSJTSKBeyond( FIRST_AREA, AREA ), projectCadastre: ( lon, lat ) => toCadastre( projectRaw( lon, lat ) ), photoAt, quay, terraces, openings, buildings, streetFacades, toLocal, terrainAt, buildingAt, keptIds, dsm, idGrid, AREA, ORIGIN, streetData, furniture, riverAt, buildingInfo, zabagedBridges: JSON.parse( await readFile( new URL( 'bridges.json', RAW ) ) ), terrainGrid: { terrain, tw, th, cell: TERRAIN_CELL }, inPark: ( X, Y ) => parks.some( rings => pointInRings( rings, X, Y ) ), tramPaths: JSON.parse( await readFile( new URL( 'tram.json', RAW ) ) ).flatMap( f => f.geometry?.paths || [] ) } );
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


// The game downloads all of this over a slow line: the buffers are packed (tools/pack.mjs; src/main.js unpacks
// them), coordinates in whole millimetres walked in order, attributes that are the same for a whole wall or roof in
// tables of their own.
const packed = {};
const writePacked = async ( name, columns, deltas ) => {

	const p = packColumns( columns, deltas );
	await writeFile( new URL( name, OUT ), p.buffer );
	packed[ name ] = { lengths: p.lengths, deltas: p.deltas, bytes: p.bytes };

};
const mm = v => Math.round( v * 1000 );

// Walls: four corners a quad (bottom left and right, top right and left), each with its u along the front, and the
// quad's wall: the 20 values that are the same for its whole stretch of wall, in walls-table.bin.
{

	const S = WALL_STRIDE, quads = wallData.length / S / 4, table = new Map(), rows = [];
	const cols = Array.from( { length: 12 }, () => new Int32Array( quads ) );
	for ( let q = 0; q < quads; q ++ ) {

		const at = ( k, f ) => wallData[ ( q * 4 + k ) * S + f ];
		const key = wallData.slice( q * 4 * S + 4, q * 4 * S + S ).join( ',' );
		if ( ! table.has( key ) ) {

			table.set( key, rows.length );
			rows.push( wallData.slice( q * 4 * S + 4, q * 4 * S + S ) );

		}

		// Wound one way or the other (frontIsCCW above).
		const flip = wallIdx[ q * 6 + 1 ] === q * 4 + 1 ? 0 : 1;
		[ table.get( key ), flip, mm( at( 0, 0 ) ), mm( at( 0, 2 ) ), mm( at( 1, 0 ) - at( 0, 0 ) ), mm( at( 1, 2 ) - at( 0, 2 ) ), mm( at( 0, 1 ) ), mm( at( 1, 1 ) - at( 0, 1 ) ),
			mm( at( 3, 1 ) - at( 0, 1 ) ), mm( at( 2, 1 ) - at( 3, 1 ) ), mm( at( 0, 3 ) ), mm( at( 1, 3 ) - at( 0, 3 ) ) ].forEach( ( v, k ) => cols[ k ][ q ] = v );

	}

	await writePacked( 'walls.bin', cols, [ 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0 ] );
	await writeFile( new URL( 'walls-table.bin', OUT ), new Float32Array( rows.flat() ) );
	console.log( `walls: ${quads} quads, ${rows.length} stretches of wall` );

}

// Roofs: the corners (x, y, z) and their roof (kind, seed, colour: roofs-table.bin), the triangles by corner.
{

	const S = ROOF_STRIDE, n = roofData.length / S, table = new Map(), rows = [];
	const xs = new Int32Array( n ), ys = new Int32Array( n ), zs = new Int32Array( n ), ids = new Int32Array( n );
	for ( let i = 0; i < n; i ++ ) {

		const key = roofData.slice( i * S + 3, i * S + S ).join( ',' );
		if ( ! table.has( key ) ) {

			table.set( key, rows.length );
			rows.push( roofData.slice( i * S + 3, i * S + S ) );

		}

		xs[ i ] = mm( roofData[ i * S ] );
		ys[ i ] = mm( roofData[ i * S + 1 ] );
		zs[ i ] = mm( roofData[ i * S + 2 ] );
		ids[ i ] = table.get( key );

	}

	await writePacked( 'roofs.bin', [ xs, ys, zs, ids, Int32Array.from( roofIdx ) ], [ 1, 1, 1, 1, 1 ] );
	await writeFile( new URL( 'roofs-table.bin', OUT ), new Float32Array( rows.flat() ) );

}

// Terrain: a mesh of the 1 m grid (tools/rtin.mjs), within 5 cm of the grid over the first area and 10 cm beyond,
// at full detail along the retaining walls (the client snaps the ground to them, src/main.js): its corners as grid
// points with their heights in centimetres, and its triangles. The client fills the 1 m grid back in from it, so
// the ground one walks on is the ground one sees.
const cliffs = ( quay?.lines || [] ).flatMap( line => line.slice( 1 ).map( ( b, i ) => [ line[ i ], b ] ) ).filter( ( [ a, b ] ) => a.wall && b.wall && ! ( a.portal && b.portal ) && Math.hypot( b.X - a.X, b.Y - a.Y ) < 2 ).map( ( [ a, b ] ) => {

	const [ x0, , z0 ] = toLocal( a.X, a.Y, 0 ), [ x1, , z1 ] = toLocal( b.X, b.Y, 0 );
	return [ x0, z0, x1, z1, a.nx, - a.ny, Math.min( a.top, b.top ), Math.max( a.quay, b.quay ) ].map( v => + v.toFixed( 3 ) );

} );
const terrainMin = terrain.reduce( ( m, v ) => Math.min( m, v ), Infinity );
{

	const near = new Uint8Array( tw * th );
	for ( const [ x0, z0, x1, z1 ] of cliffs ) {

		for ( let x = Math.min( x0, x1 ) - 2; x <= Math.max( x0, x1 ) + 2; x ++ ) for ( let z = Math.min( z0, z1 ) - 2; z <= Math.max( z0, z1 ) + 2; z ++ ) {

			const c = Math.round( ( x - ax0 ) / TERRAIN_CELL ), r = Math.round( ( z - az0 ) / TERRAIN_CELL );
			if ( c >= 0 && r >= 0 && c < tw && r < th ) near[ r * tw + c ] = 1;

		}

	}

	const n = rtinSize( Math.max( tw, th ) );
	const mesh = rtin( {
		n,
		heightAt: ( c, r ) => terrain[ Math.min( r, th - 1 ) * tw + Math.min( c, tw - 1 ) ],
		tolerance: ( c, r ) => inFirstArea( AREA.xmin + c * TERRAIN_CELL, AREA.ymax - r * TERRAIN_CELL ) ? 0.05 : 0.1,
		force: ( c, r ) => c < tw && r < th && near[ r * tw + c ] === 1,
		cellKind: ( c, r ) => c < tw - 1 && r < th - 1 ? 1 : 0
	} );
	// Corners numbered by first use; as grid points (row × width + column); triangles facing up.
	const number = new Map(), index = new Int32Array( mesh.triangles.length );
	for ( let k = 0; k < mesh.triangles.length; k ++ ) {

		const g = mesh.triangles[ k ], id = ( g / n | 0 ) * tw + g % n;
		if ( ! number.has( id ) ) number.set( id, number.size );
		index[ k ] = number.get( id );

	}

	const grid = [ ...number.keys() ];
	for ( let k = 0; k < index.length; k += 3 ) {

		const p = [ 0, 1, 2 ].map( j => [ grid[ index[ k + j ] ] % tw, grid[ index[ k + j ] ] / tw | 0 ] );
		// Scene frame: +x east (columns), +z south (rows); facing up means clockwise on the grid as drawn.
		const up = ( p[ 1 ][ 1 ] - p[ 0 ][ 1 ] ) * ( p[ 2 ][ 0 ] - p[ 0 ][ 0 ] ) - ( p[ 1 ][ 0 ] - p[ 0 ][ 0 ] ) * ( p[ 2 ][ 1 ] - p[ 0 ][ 1 ] );
		if ( up < 0 ) [ index[ k + 1 ], index[ k + 2 ] ] = [ index[ k + 2 ], index[ k + 1 ] ];

	}

	await writePacked( 'terrain.bin', [ Int32Array.from( grid ), Int32Array.from( grid, g => Math.round( ( terrain[ g ] - terrainMin ) * 100 ) ), index ], [ 1, 1, 1 ] );
	console.log( `terrain mesh: ${grid.length} corners, ${index.length / 3} triangles (was ${2 * ( tw - 1 ) * ( th - 1 )} on the grid)` );

}

// Street surface maps: each channel on its own, as the change from the texel to its left (wrapping).
{

	const out = new Uint8Array( sw * sh * 8 );
	[ surface, surface2 ].forEach( ( map, m ) => {

		for ( let c = 0; c < 4; c ++ ) for ( let r = 0; r < sh; r ++ ) for ( let x = 0; x < sw; x ++ ) {

			const i = ( r * sw + x ) * 4 + c, left = x ? map[ i - 4 ] : r ? map[ i - sw * 4 ] : 0;
			out[ ( m * 4 + c ) * sw * sh + r * sw + x ] = ( map[ i ] - left ) & 255;

		}

	} );
	await writeFile( new URL( 'surfaces.bin', OUT ), out );

}

await writeFile( new URL( 'embankment.bin', OUT ), new Float32Array( embankment.stone ) );
await writePacked( 'pavement.bin', [ Int32Array.from( pavement.positions.filter( ( v, i ) => i % 3 === 0 ), mm ), Int32Array.from( pavement.positions.filter( ( v, i ) => i % 3 === 1 ), mm ),
	Int32Array.from( pavement.positions.filter( ( v, i ) => i % 3 === 2 ), mm ), Int32Array.from( pavement.index ) ], [ 1, 1, 1, 1 ] );
await writeFile( new URL( 'street-facades.json', RAW ), JSON.stringify( streetFacades ) );

// Footprint mask on the DSM grid (1 bit per cell, row 0 = north) for walking collisions.
const mask = new Uint8Array( Math.ceil( idGrid.length / 8 ) );
for ( let i = 0; i < idGrid.length; i ++ ) if ( keptIds.has( idGrid[ i ] ) ) mask[ i >> 3 ] |= 1 << ( i & 7 );
await writeFile( new URL( 'footprints.bin', OUT ), mask );

// A painted gate on a front that has a real passage would sit beside the hole you can walk through: the real
// opening is the gate there, so painted gates and doors are dropped on those fronts, and anything painted over the
// hole goes too.
for ( const [ key, row ] of groundFloorRow ) {

	const cuts = frontCuts.get( key );
	if ( ! cuts ) continue;
	const items = groundFloors[ row ];
	groundFloors[ row ] = items.filter( ( [ u0, u1, kind ] ) => kind !== GF_KIND.gate && ! cuts.some( ( [ c0, c1 ] ) => u0 < c1 && u1 > c0 ) );

}

// Street life (walking lines, driving lanes, parked cars, tram routes) in a file of its own: the game loads it with
// the people, after the city is up (src/main.js).
await writeFile( new URL( 'life.json', OUT ), JSON.stringify( places.life ) );
delete places.life;

await writeFile( new URL( 'scene.json', OUT ), JSON.stringify( {
	attribution: 'Data © ČÚZK (RÚIAN, ZABAGED®, DMR 5G, DMP 1G) · © OpenStreetMap contributors (ODbL)',
	baseHeight: BASE_HEIGHT,
	bounds: { minX: ax0, maxX: ax1, minZ: az0, maxZ: az1 },
	// The first area, modelled in detail (tools/area.mjs): the finer ground detail and terrain mesh (src/main.js).
	firstBounds: ( ( [ x0, , z1 ], [ x1, , z0 ] ) => ( { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } ) )( toLocal( FIRST_AREA.xmin, FIRST_AREA.ymin, 0 ), toLocal( FIRST_AREA.xmax, FIRST_AREA.ymax, 0 ) ),
	waterLevel,
	terrain: { width: tw, height: th, cell: TERRAIN_CELL, min: terrainMin, scale: 0.01 },
	packed,
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
	// Wall lines the terrain mesh is snapped to (src/main.js): x0, z0, x1, z1, the low side's direction, top, foot.
	cliffs,
	places,
	streets
} ) );

console.log( 'written to public/data/' );
