// Downloads Mapillary street-level image metadata for the play area into data/raw/mapillary.json.
// Needs a Mapillary client token in MAPILLARY_TOKEN (never commit it). Run with NODE_USE_ENV_PROXY=1 behind a proxy.
// Imagery © Mapillary contributors, CC BY-SA 4.0.

import { writeFile, mkdir } from 'node:fs/promises';

const TOKEN = process.env.MAPILLARY_TOKEN;
if ( ! TOKEN ) throw new Error( 'MAPILLARY_TOKEN is not set' );

// WGS 84 bounds of the play area (see area.mjs), split into tiles small enough for the API.
const BBOX = { west: 14.4080, south: 50.0757, east: 14.4245, north: 50.0875 };
const TILES = 11;
const FIELDS = 'id,captured_at,is_pano,camera_type,computed_compass_angle,computed_geometry,computed_altitude,sequence,width,height';

async function get( params ) {

	const u = new URL( 'https://graph.mapillary.com/images' );
	u.searchParams.set( 'access_token', TOKEN );
	for ( const [ k, v ] of Object.entries( params ) ) u.searchParams.set( k, v );

	for ( let attempt = 0; ; attempt ++ ) {

		const res = await fetch( u );
		const json = await res.json().catch( () => ( {} ) );
		if ( res.ok && json.data ) return json.data;
		if ( attempt >= 3 ) throw new Error( `${res.status} ${JSON.stringify( json.error || json )}` );
		await new Promise( r => setTimeout( r, 2000 * 2 ** attempt ) );

	}

}

const images = new Map();
const dx = ( BBOX.east - BBOX.west ) / TILES, dy = ( BBOX.north - BBOX.south ) / TILES;

for ( let i = 0; i < TILES; i ++ ) {

	for ( let j = 0; j < TILES; j ++ ) {

		const bbox = [ BBOX.west + i * dx, BBOX.south + j * dy, BBOX.west + ( i + 1 ) * dx, BBOX.south + ( j + 1 ) * dy ]
			.map( v => v.toFixed( 6 ) ).join( ',' );
		const data = await get( { bbox, fields: FIELDS, limit: 2000 } );
		for ( const im of data ) if ( im.computed_geometry ) images.set( im.id, im );
		if ( data.length >= 2000 ) console.warn( `tile ${i},${j} hit the 2000 limit` );

	}

}

await mkdir( new URL( '../data/raw/', import.meta.url ), { recursive: true } );
await writeFile( new URL( '../data/raw/mapillary.json', import.meta.url ), JSON.stringify( [ ...images.values() ] ) );
console.log( `mapillary: ${images.size} images` );
