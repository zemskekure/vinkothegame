// Street-level photos looking at a point: Mapillary images within `radius` m of a target (scene frame x, z) with a
// clear line of sight, aimed at it (normal photos within ±35° of the bearing; 360° panoramas cropped to a 100° view
// towards it), newest first. Saved as data/raw/views/look-<name>-<k>.jpg for reading a facade or a shopfront.
//
// Needs MAPILLARY_TOKEN. Usage: node tools/look-at.mjs <name> <x> <z> [radius m] [count]
// Imagery © Mapillary contributors, CC BY-SA 4.0.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { AREA, ORIGIN } from './area.mjs';

const RAW = new URL( '../data/raw/', import.meta.url );
const OUT = new URL( 'views/', RAW );
const TOKEN = process.env.MAPILLARY_TOKEN;
if ( ! TOKEN ) throw new Error( 'MAPILLARY_TOKEN is not set' );
const [ name, xs, zs, rs, ns ] = process.argv.slice( 2 );
const TX = Number( xs ) + ORIGIN.x, TY = - Number( zs ) + ORIGIN.y;
const RADIUS = Number( rs ) || 30, COUNT = Number( ns ) || 8;
await mkdir( OUT, { recursive: true } );

const images = JSON.parse( await readFile( new URL( 'mapillary.json', RAW ) ) );
const positions = JSON.parse( await readFile( new URL( 'mapillary-sjtsk.json', RAW ) ) );

const control = JSON.parse( await readFile( new URL( 'geo-control.json', RAW ) ) );
const [ c0, c1 ] = [ control[ 3 ], control[ 4 ] ];
const convergence = Math.atan2( c1[ 2 ] - c0[ 2 ], c1[ 3 ] - c0[ 3 ] );
const bearingTo = ( dx, dy ) => {

	const e = dx * Math.cos( convergence ) - dy * Math.sin( convergence ), n = dx * Math.sin( convergence ) + dy * Math.cos( convergence );
	return ( Math.atan2( e, n ) * 180 / Math.PI + 360 ) % 360;

};

const scene = JSON.parse( await readFile( new URL( '../public/data/scene.json', import.meta.url ) ) );
const fp = scene.footprints;
const mask = new Uint8Array( await readFile( new URL( '../public/data/footprints.bin', import.meta.url ) ) );
const blocked = ( X, Y ) => {

	const c = Math.floor( ( X - AREA.xmin ) / fp.cell ), r = Math.floor( ( AREA.ymax - Y ) / fp.cell );
	if ( c < 0 || r < 0 || c >= fp.width || r >= fp.height ) return false;
	const i = r * fp.width + c;
	return ( mask[ i >> 3 ] >> ( i & 7 ) ) & 1;

};

const clear = ( cx, cy ) => {

	const d = Math.hypot( TX - cx, TY - cy );
	for ( let s = 0.5; s < d - 1.2; s += 0.4 ) if ( blocked( cx + ( TX - cx ) * s / d, cy + ( TY - cy ) * s / d ) ) return false;
	return true;

};

const candidates = images.map( ( im, i ) => ( { im, X: positions[ i ][ 0 ], Y: positions[ i ][ 1 ] } ) ).filter( c => {

	const d = Math.hypot( c.X - TX, c.Y - TY );
	if ( d < 3 || d > RADIUS || ! clear( c.X, c.Y ) ) return false;
	c.d = d;
	c.bearing = bearingTo( TX - c.X, TY - c.Y );
	const pano = c.im.is_pano || c.im.camera_type === 'spherical' || c.im.camera_type === 'equirectangular';
	c.pano = pano;
	const off = Math.abs( ( ( c.bearing - c.im.computed_compass_angle ) % 360 + 540 ) % 360 - 180 );
	return pano || off < 35;

} ).sort( ( a, b ) => b.im.captured_at - a.im.captured_at );

// Spread over capture days: at most two photos per sequence.
const perSeq = new Map(), picked = [];
for ( const c of candidates ) {

	const n = perSeq.get( c.im.sequence ) || 0;
	if ( n >= 2 ) continue;
	perSeq.set( c.im.sequence, n + 1 );
	picked.push( c );
	if ( picked.length >= COUNT ) break;

}

console.log( `${candidates.length} candidates, ${picked.length} picked` );
let k = 0;
for ( const c of picked ) {

	const u = new URL( `https://graph.mapillary.com/${c.im.id}` );
	u.searchParams.set( 'access_token', TOKEN );
	u.searchParams.set( 'fields', 'thumb_2048_url' );
	const det = await ( await fetch( u ) ).json();
	if ( ! det.thumb_2048_url ) continue;
	let buf = Buffer.from( await ( await fetch( det.thumb_2048_url ) ).arrayBuffer() );
	if ( c.pano ) {

		// Crop a 100° wide band towards the target (the panorama's centre column faces its compass angle).
		const img = jpeg.decode( buf, { useTArray: true, maxMemoryUsageInMB: 1024 } );
		const W = img.width, H = img.height;
		const cw = Math.round( W * 100 / 360 ), y0 = Math.round( H * 0.22 ), y1 = Math.round( H * 0.72 );
		const centre = ( ( ( c.bearing - c.im.computed_compass_angle ) / 360 + 0.5 ) % 1 + 1 ) % 1 * W;
		const out = Buffer.alloc( cw * ( y1 - y0 ) * 4 );
		for ( let y = y0; y < y1; y ++ ) for ( let x = 0; x < cw; x ++ ) {

			const sx = ( Math.round( centre - cw / 2 + x ) % W + W ) % W;
			img.data.subarray( ( y * W + sx ) * 4, ( y * W + sx ) * 4 + 4 ).forEach( ( v, j ) => { out[ ( ( y - y0 ) * cw + x ) * 4 + j ] = v; } );

		}

		buf = jpeg.encode( { data: out, width: cw, height: y1 - y0 }, 88 ).data;

	}

	const file = `look-${name}-${k ++}.jpg`;
	await writeFile( new URL( file, OUT ), buf );
	console.log( file, new Date( c.im.captured_at ).toISOString().slice( 0, 10 ), `${c.d.toFixed( 0 )} m`, c.pano ? 'pano' : 'photo' );

}
