// Downloads the raw source data for the play area from ČÚZK (Czech land survey)
// ArcGIS REST services into data/raw/. Run with NODE_USE_ENV_PROXY=1 behind a proxy.
//
// All coordinates are S-JTSK / Krovak East North (EPSG:5514), metres.

import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { fromFile } from 'geotiff';
import { AREA, WEST_AREA, FIRST_AREA, HI_TILES, WEST_HI_TILES, ORTHO_TILES } from './area.mjs';

const OUT = new URL( '../data/raw/', import.meta.url );
const AGS = 'https://ags.cuzk.cz/arcgis/rest/services';
const AGS1 = 'https://ags.cuzk.cz/arcgis1/rest/services';

const { xmin, ymin, xmax, ymax } = AREA;
const envelope = `${xmin},${ymin},${xmax},${ymax}`;

async function get( url, params ) {

	const u = new URL( url );
	for ( const [ k, v ] of Object.entries( params ) ) u.searchParams.set( k, v );

	for ( let attempt = 0; ; attempt ++ ) {

		try {

			const res = await fetch( u, { signal: AbortSignal.timeout( 600000 ) } );
			if ( ! res.ok ) throw new Error( `${res.status} ${res.statusText}` );
			return Buffer.from( await res.arrayBuffer() );

		} catch ( e ) {

			if ( attempt >= 3 ) throw new Error( `${u}: ${e.message}` );
			console.warn( `${url}: ${e.message}; retrying` );
			await new Promise( r => setTimeout( r, 2000 * 2 ** attempt ) );

		}

	}

}

// Paged feature query (servers cap results per request); several layers go into one file.
async function queryLayer( service, layers, name ) {

	const features = [];

	for ( const layer of [ layers ].flat() ) for ( let offset = 0; ; ) {

		const buf = await get( `${AGS}/${service}/MapServer/${layer}/query`, {
			geometry: envelope,
			geometryType: 'esriGeometryEnvelope',
			inSR: 5514,
			outSR: 5514,
			spatialRel: 'esriSpatialRelIntersects',
			outFields: '*',
			returnGeometry: true,
			resultOffset: offset,
			resultRecordCount: 1000,
			f: 'json'
		} );

		const json = JSON.parse( buf );
		if ( json.error ) throw new Error( `${name}: ${JSON.stringify( json.error )}` );
		features.push( ...json.features );
		offset += json.features.length;
		if ( ! json.exceededTransferLimit || json.features.length === 0 ) break;

	}

	await writeFile( new URL( `${name}.json`, OUT ), JSON.stringify( features ) );
	console.log( `${name}: ${features.length} features` );

}

async function exportRaster( service, name, cellSize ) {

	const width = Math.round( ( xmax - xmin ) / cellSize );
	const height = Math.round( ( ymax - ymin ) / cellSize );

	const buf = await get( `${AGS}/${service}/ImageServer/exportImage`, {
		bbox: envelope,
		bboxSR: 5514,
		imageSR: 5514,
		size: `${width},${height}`,
		format: 'tiff',
		pixelType: 'F32',
		interpolation: 'RSP_BilinearInterpolation',
		f: 'image'
	} );

	await writeFile( new URL( `${name}.tif`, OUT ), buf );
	console.log( `${name}: ${width}x${height} (${( buf.length / 1e6 ).toFixed( 1 )} MB)` );

}

// Orthophoto tiles (the service caps images at 4096 px): nx × ny tiles of an area (the play area unless given) at
// `cellSize`.
async function orthoTiles( cellSize, nx, ny, area = AREA ) {

	const tw = ( area.xmax - area.xmin ) / nx, th = ( area.ymax - area.ymin ) / ny;
	const tiles = [];
	for ( let i = 0; i < nx; i ++ ) for ( let j = 0; j < ny; j ++ ) {

		const bbox = [ area.xmin + i * tw, area.ymax - ( j + 1 ) * th, area.xmin + ( i + 1 ) * tw, area.ymax - j * th ];
		const buf = await get( `${AGS1}/ORTOFOTO/MapServer/export`, {
			bbox: bbox.join( ',' ), bboxSR: 5514, imageSR: 5514,
			size: `${Math.round( tw / cellSize )},${Math.round( th / cellSize )}`,
			format: 'jpg', f: 'image'
		} );
		tiles.push( { i, j, buf } );

	}

	return tiles;

}

// Overview orthophoto (25 cm), stitched into one image: ortho.jpg over the play area, and ortho-first.jpg over the
// first area cut as it always was (1 × 2 tiles), so the colours read off it there (roofs, trees, the ground detail)
// stay exactly what they were before the area grew.
async function exportOrtho( cellSize, name, [ nx, ny ], area ) {

	if ( name !== 'ortho' && existsSync( new URL( `${name}.jpg`, OUT ) ) ) {

		console.log( `${name}: kept the existing fixed-area photo` );
		return;

	}

	const tiles = await orthoTiles( cellSize, nx, ny, area );
	const imgs = tiles.map( t => ( { ...t, img: jpeg.decode( t.buf, { useTArray: true, maxMemoryUsageInMB: 2048 } ) } ) );
	const tw = imgs[ 0 ].img.width, th = imgs[ 0 ].img.height, W = tw * nx, H = th * ny;
	const data = Buffer.alloc( W * H * 4 );
	for ( const { i, j, img } of imgs ) for ( let y = 0; y < th; y ++ ) data.set( img.data.subarray( y * tw * 4, ( y + 1 ) * tw * 4 ), ( ( j * th + y ) * W + i * tw ) * 4 );
	const buf = jpeg.encode( { data, width: W, height: H }, 92 ).data;
	await writeFile( new URL( `${name}.jpg`, OUT ), buf );
	console.log( `${name}: ${W}x${H} (${( buf.length / 1e6 ).toFixed( 1 )} MB)` );

}

// High-resolution orthophoto (12.5 cm) for ground detail, as ortho-hi-<i>-<j>.jpg tiles (read by tools/kerbs.mjs).
async function exportOrthoTiles( cellSize, tiles = HI_TILES, area = AREA, prefix = 'ortho-hi' ) {

	const cached = [];
	for ( let i = 0; i < tiles[ 0 ]; i ++ ) for ( let j = 0; j < tiles[ 1 ]; j ++ ) cached.push( existsSync( new URL( `${prefix}-${i}-${j}.jpg`, OUT ) ) );
	if ( prefix !== 'ortho-hi' && cached.every( Boolean ) ) {

		console.log( `${prefix}: kept the existing fixed-area tiles` );
		return;

	}

	for ( const { i, j, buf } of await orthoTiles( cellSize, ...tiles, area ) ) {

		await writeFile( new URL( `${prefix}-${i}-${j}.jpg`, OUT ), buf );
		console.log( `${prefix} tile ${i},${j}: ${( buf.length / 1e6 ).toFixed( 1 )} MB` );

	}

}

await mkdir( OUT, { recursive: true } );

// On an existing west-area cache, save its exact JPEGs before the larger exports replace them. A clean cache
// downloads the same fixed cuts below. The TIFF extent distinguishes the earlier cache from an expanded one.
if ( existsSync( new URL( 'dtm.tif', OUT ) ) && ! existsSync( new URL( 'ortho-west.jpg', OUT ) ) ) {

	const tiff = await fromFile( new URL( 'dtm.tif', OUT ).pathname );
	const box = ( await tiff.getImage() ).getBoundingBox();
	await tiff.close();
	if ( [ WEST_AREA.xmin, WEST_AREA.ymin, WEST_AREA.xmax, WEST_AREA.ymax ].every( ( v, i ) => Math.abs( v - box[ i ] ) < 0.01 ) ) {

		await copyFile( new URL( 'ortho.jpg', OUT ), new URL( 'ortho-west.jpg', OUT ) );
		for ( let i = 0; i < WEST_HI_TILES[ 0 ]; i ++ ) for ( let j = 0; j < WEST_HI_TILES[ 1 ]; j ++ ) {

			await copyFile( new URL( `ortho-hi-${i}-${j}.jpg`, OUT ), new URL( `ortho-west-hi-${i}-${j}.jpg`, OUT ) );

		}

		console.log( 'kept the west-area photo cuts before extending the cache' );

	}

}

await Promise.all( [
	queryLayer( 'RUIAN', 3, 'buildings' ),
	queryLayer( 'RUIAN', 4, 'streets-ruian' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 99, 'zabaged-buildings' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 84, 'streets' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 71, 'tram' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 132, 'water' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 134, 'greenery' ),
	// Orchards and gardens, vineyards, grassland, scrub and woods (Petřín, the Strahov gardens): greenery beyond the
	// first area.
	queryLayer( 'ZABAGED_POLOHOPIS', [ 135, 136, 139, 140, 142 ], 'landcover' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 73, 'bridges' ),
	exportRaster( '3D/dmp', 'dsm', 0.5 ),
	exportRaster( '3D/dmr5g', 'dtm', 1 ),
	exportOrtho( 0.25, 'ortho', ORTHO_TILES, AREA ),
	exportOrtho( 0.25, 'ortho-west', [ 4, 2 ], WEST_AREA ),
	exportOrtho( 0.25, 'ortho-first', [ 1, 2 ], FIRST_AREA ),
	exportOrthoTiles( 0.125 ),
	exportOrthoTiles( 0.125, WEST_HI_TILES, WEST_AREA, 'ortho-west-hi' )
] );
