// Downloads the raw source data for the play area from ČÚZK (Czech land survey)
// ArcGIS REST services into data/raw/. Run with NODE_USE_ENV_PROXY=1 behind a proxy.
//
// All coordinates are S-JTSK / Krovak East North (EPSG:5514), metres.

import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { fromFile, fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import { AREA, EAST_AREA, ORIGIN, WEST_AREA, FIRST_AREA, HI_TILES, EAST_HI_TILES, WEST_HI_TILES, ORTHO_TILES } from './area.mjs';

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

	const columns = Math.ceil( width / 4096 ), rows = Math.ceil( height / 4096 );
	const data = columns * rows > 1 ? new Float32Array( width * height ) : null;
	let buf;
	for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < columns; i ++ ) {

		const x0 = Math.round( i * width / columns ), x1 = Math.round( ( i + 1 ) * width / columns );
		const y0 = Math.round( j * height / rows ), y1 = Math.round( ( j + 1 ) * height / rows );
		buf = await get( `${AGS}/${service}/ImageServer/exportImage`, {
			bbox: [ xmin + x0 * cellSize, ymax - y1 * cellSize, xmin + x1 * cellSize, ymax - y0 * cellSize ].join( ',' ),
			bboxSR: 5514, imageSR: 5514, size: `${x1 - x0},${y1 - y0}`,
			format: 'tiff', pixelType: 'F32', interpolation: 'RSP_BilinearInterpolation', f: 'image'
		} );
		if ( buf[ 0 ] === 123 ) throw new Error( `${name}: ${buf.toString()}` );
		if ( data ) {

			const tiff = await fromArrayBuffer( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
			const image = await tiff.getImage();
			if ( image.getWidth() !== x1 - x0 || image.getHeight() !== y1 - y0 ) throw new Error( `${name}: unexpected raster tile dimensions` );
			const [ tile ] = await image.readRasters();
			for ( let y = 0; y < y1 - y0; y ++ ) data.set( tile.subarray( y * ( x1 - x0 ), ( y + 1 ) * ( x1 - x0 ) ), ( y0 + y ) * width + x0 );
			console.log( `${name}: tile ${i + 1}/${columns},${j + 1}/${rows}` );

		}

	}
	if ( data ) buf = Buffer.from( writeArrayBuffer( data, {
		width, height, BitsPerSample: [ 32 ], SampleFormat: [ 3 ], PhotometricInterpretation: 1,
		ModelPixelScale: [ cellSize, cellSize, 0 ], ModelTiepoint: [ 0, 0, 0, xmin, ymax, 0 ],
		GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 5514
	} ) );

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

// Keep the earlier building mask as the fixed context for its street-width measurements.
// Buildings arriving across a former edge must not change the width along a whole existing street.
if ( ! existsSync( new URL( 'building-mask-east.bin', OUT ) ) ) {

	const built = JSON.parse( await readFile( new URL( '../public/data/scene.json', import.meta.url ) ).catch( () => 'null' ) );
	if ( built && built.bounds.minX === EAST_AREA.xmin - ORIGIN.x && built.bounds.maxX === EAST_AREA.xmax - ORIGIN.x &&
		built.bounds.minZ === ORIGIN.y - EAST_AREA.ymax && built.bounds.maxZ === ORIGIN.y - EAST_AREA.ymin ) {

		await copyFile( new URL( '../data/scene/footprints.bin', import.meta.url ), new URL( 'building-mask-east.bin', OUT ) );
		console.log( 'kept the earlier building mask for street measurements' );

	}

}

// Save each earlier area's exact JPEG cuts before the larger exports replace them.
if ( existsSync( new URL( 'dtm.tif', OUT ) ) ) {

	const tiff = await fromFile( new URL( 'dtm.tif', OUT ).pathname );
	const box = ( await tiff.getImage() ).getBoundingBox();
	await tiff.close();
	for ( const [ area, tiles, prefix ] of [ [ WEST_AREA, WEST_HI_TILES, 'ortho-west' ], [ EAST_AREA, EAST_HI_TILES, 'ortho-east' ] ] ) {

		if ( existsSync( new URL( `${prefix}.jpg`, OUT ) ) ) continue;
		if ( ! [ area.xmin, area.ymin, area.xmax, area.ymax ].every( ( v, i ) => Math.abs( v - box[ i ] ) < 0.01 ) ) continue;
		await copyFile( new URL( 'ortho.jpg', OUT ), new URL( `${prefix}.jpg`, OUT ) );
		for ( let i = 0; i < tiles[ 0 ]; i ++ ) for ( let j = 0; j < tiles[ 1 ]; j ++ ) {

			await copyFile( new URL( `ortho-hi-${i}-${j}.jpg`, OUT ), new URL( `${prefix}-hi-${i}-${j}.jpg`, OUT ) );

		}
		console.log( `kept ${prefix} photo cuts before extending the cache` );

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
	exportOrtho( 0.25, 'ortho-east', [ 5, 2 ], EAST_AREA ),
	exportOrtho( 0.25, 'ortho-west', [ 4, 2 ], WEST_AREA ),
	exportOrtho( 0.25, 'ortho-first', [ 1, 2 ], FIRST_AREA ),
	exportOrthoTiles( 0.125 ),
	exportOrthoTiles( 0.125, EAST_HI_TILES, EAST_AREA, 'ortho-east-hi' ),
	exportOrthoTiles( 0.125, WEST_HI_TILES, WEST_AREA, 'ortho-west-hi' )
] );
