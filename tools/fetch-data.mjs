// Downloads the raw source data for the play area from ČÚZK (Czech land survey)
// ArcGIS REST services into data/raw/. Run with NODE_USE_ENV_PROXY=1 behind a proxy.
//
// All coordinates are S-JTSK / Krovak East North (EPSG:5514), metres.

import { mkdir, writeFile } from 'node:fs/promises';
import { AREA } from './area.mjs';

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

			const res = await fetch( u );
			if ( ! res.ok ) throw new Error( `${res.status} ${res.statusText}` );
			return Buffer.from( await res.arrayBuffer() );

		} catch ( e ) {

			if ( attempt >= 3 ) throw new Error( `${u}: ${e.message}` );
			await new Promise( r => setTimeout( r, 2000 * 2 ** attempt ) );

		}

	}

}

// Paged feature query (servers cap results per request).
async function queryLayer( service, layer, name ) {

	const features = [];

	for ( let offset = 0; ; ) {

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

async function exportOrtho( cellSize ) {

	const width = Math.round( ( xmax - xmin ) / cellSize );
	const height = Math.round( ( ymax - ymin ) / cellSize );

	const buf = await get( `${AGS1}/ORTOFOTO/MapServer/export`, {
		bbox: envelope,
		bboxSR: 5514,
		imageSR: 5514,
		size: `${width},${height}`,
		format: 'jpg',
		f: 'image'
	} );

	await writeFile( new URL( 'ortho.jpg', OUT ), buf );
	console.log( `ortho: ${width}x${height} (${( buf.length / 1e6 ).toFixed( 1 )} MB)` );

}

// High-resolution orthophoto (12.5 cm) for ground detail, in 2 × 2 tiles (the service caps images at 4096 px).
async function exportOrthoTiles( cellSize ) {

	const nx = 2, ny = 2;
	const tw = ( xmax - xmin ) / nx, th = ( ymax - ymin ) / ny;
	for ( let i = 0; i < nx; i ++ ) for ( let j = 0; j < ny; j ++ ) {

		const bbox = [ xmin + i * tw, ymax - ( j + 1 ) * th, xmin + ( i + 1 ) * tw, ymax - j * th ];
		const buf = await get( `${AGS1}/ORTOFOTO/MapServer/export`, {
			bbox: bbox.join( ',' ), bboxSR: 5514, imageSR: 5514,
			size: `${Math.round( tw / cellSize )},${Math.round( th / cellSize )}`,
			format: 'jpg', f: 'image'
		} );
		await writeFile( new URL( `ortho-hi-${i}-${j}.jpg`, OUT ), buf );
		console.log( `ortho tile ${i},${j}: ${( buf.length / 1e6 ).toFixed( 1 )} MB` );

	}

}

await mkdir( OUT, { recursive: true } );

await Promise.all( [
	queryLayer( 'RUIAN', 3, 'buildings' ),
	queryLayer( 'RUIAN', 4, 'streets-ruian' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 99, 'zabaged-buildings' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 84, 'streets' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 71, 'tram' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 132, 'water' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 134, 'greenery' ),
	queryLayer( 'ZABAGED_POLOHOPIS', 73, 'bridges' ),
	exportRaster( '3D/dmp', 'dsm', 0.5 ),
	exportRaster( '3D/dmr5g', 'dtm', 1 ),
	exportOrtho( 0.25 ),
	exportOrthoTiles( 0.125 )
] );
