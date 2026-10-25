// WGS 84 (lon, lat) → S-JTSK (EPSG:5514) for the play area.
// Over a kilometre the Krovak projection is affine to well under a centimetre, so a 3 × 3 grid of control
// points projected once by the ČÚZK geometry service (cached in data/raw/geo-control.json) defines an exact
// enough least-squares affine transform.

import { readFile, writeFile } from 'node:fs/promises';

const CACHE = new URL( '../data/raw/geo-control.json', import.meta.url );
const BBOX = { west: 14.4085, south: 50.0790, east: 14.4235, north: 50.0880 };

async function controlPoints() {

	try {

		return JSON.parse( await readFile( CACHE ) );

	} catch { /* fetch below */ }

	const lonlat = [];
	for ( let i = 0; i < 3; i ++ ) for ( let j = 0; j < 3; j ++ ) {

		lonlat.push( [ BBOX.west + ( BBOX.east - BBOX.west ) * i / 2, BBOX.south + ( BBOX.north - BBOX.south ) * j / 2 ] );

	}

	const body = new URLSearchParams( {
		geometries: JSON.stringify( { geometryType: 'esriGeometryPoint', geometries: lonlat.map( ( [ x, y ] ) => ( { x, y } ) ) } ),
		inSR: 4326, outSR: 5514, f: 'json'
	} );
	const res = await fetch( 'https://ags.cuzk.cz/arcgis/rest/services/Utilities/Geometry/GeometryServer/project', { method: 'POST', body } );
	const json = await res.json();
	if ( ! json.geometries ) throw new Error( `geometry service: ${JSON.stringify( json )}` );
	const points = lonlat.map( ( p, i ) => [ ...p, json.geometries[ i ].x, json.geometries[ i ].y ] );
	await writeFile( CACHE, JSON.stringify( points ) );
	return points;

}

// Solves the 3 × 3 normal equations of a least-squares fit X = a·lon' + b·lat' + c (centred inputs).
function fit( points, k ) {

	const m = [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ], v = [ 0, 0, 0 ];
	for ( const p of points ) {

		const row = [ p[ 0 ] - 14.416, p[ 1 ] - 50.083, 1 ];
		for ( let i = 0; i < 3; i ++ ) {

			v[ i ] += row[ i ] * p[ k ];
			for ( let j = 0; j < 3; j ++ ) m[ i ][ j ] += row[ i ] * row[ j ];

		}

	}

	// Gaussian elimination
	for ( let i = 0; i < 3; i ++ ) {

		for ( let r = i + 1; r < 3; r ++ ) {

			const f = m[ r ][ i ] / m[ i ][ i ];
			for ( let c = i; c < 3; c ++ ) m[ r ][ c ] -= f * m[ i ][ c ];
			v[ r ] -= f * v[ i ];

		}

	}

	const x = [ 0, 0, 0 ];
	for ( let i = 2; i >= 0; i -- ) {

		let s = v[ i ];
		for ( let c = i + 1; c < 3; c ++ ) s -= m[ i ][ c ] * x[ c ];
		x[ i ] = s / m[ i ][ i ];

	}

	return x;

}

export async function lonLatToSJTSK() {

	const points = await controlPoints();
	const ax = fit( points, 2 ), ay = fit( points, 3 );
	return ( lon, lat ) => {

		const u = lon - 14.416, v = lat - 50.083;
		return [ ax[ 0 ] * u + ax[ 1 ] * v + ax[ 2 ], ay[ 0 ] * u + ay[ 1 ] * v + ay[ 2 ] ];

	};

}

// OpenStreetMap projected with the transform above lands (−6.18, −7.68) m off the ČÚZK data (RÚIAN footprints,
// the aerial photo, the terrain): measured as the median offset of 174 OSM building outlines imported from RÚIAN
// (source=cuzk:ruian) against the same buildings in RÚIAN, the same to a few centimetres in every corner of the
// area. Adding this puts an OSM point where the cadastre has it.
export const OSM_OFFSET = [ 6.18, 7.68 ];
export const toCadastre = ( [ X, Y ] ) => [ X + OSM_OFFSET[ 0 ], Y + OSM_OFFSET[ 1 ] ];
