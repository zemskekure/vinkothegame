// Reference photos of individual house fronts: for every street-facing facade of the buildings along the given
// streets, picks the best nearby Mapillary 360° panorama (recent, close, unobstructed, as head-on as possible) and
// renders a normal perspective photo aimed at the facade into data/raw/views/house-<code>_<edge>.jpg.
// These are what the per-house facade descriptions (data/houses.json) are read from.
//
// Needs MAPILLARY_TOKEN. Usage: node tools/facade-views.mjs "Náprstkova,Betlémská"
// Imagery © Mapillary contributors, CC BY-SA 4.0.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { AREA } from './area.mjs';

const RAW = new URL( '../data/raw/', import.meta.url );
const OUT = new URL( 'views/', RAW );
const TOKEN = process.env.MAPILLARY_TOKEN;
if ( ! TOKEN ) throw new Error( 'MAPILLARY_TOKEN is not set' );
const streetNames = new Set( ( process.argv[ 2 ] || '' ).split( ',' ).map( s => s.trim() ).filter( Boolean ) );

await mkdir( OUT, { recursive: true } );

// Street centrelines (ZABAGED) of the requested streets.
const segments = JSON.parse( await readFile( new URL( 'streets.json', RAW ) ) )
	.filter( f => streetNames.has( f.attributes.nazev ) && f.geometry?.paths )
	.flatMap( f => f.geometry.paths.flatMap( p => p.slice( 1 ).map( ( b, i ) => [ p[ i ], b, f.attributes.nazev ] ) ) );

function nearestStreet( X, Y ) {

	let best = { d: Infinity, name: null };
	for ( const [ [ ax, ay ], [ bx, by ], name ] of segments ) {

		const dx = bx - ax, dy = by - ay;
		const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
		const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
		if ( d < best.d ) best = { d, name };

	}

	return best;

}

// Facades (from build-scene.mjs) that face one of the streets.
const facades = JSON.parse( await readFile( new URL( 'street-facades.json', RAW ) ) ).filter( f => {

	const mx = ( f.a[ 0 ] + f.b[ 0 ] ) / 2 + f.n[ 0 ] * 3, my = ( f.a[ 1 ] + f.b[ 1 ] ) / 2 + f.n[ 1 ] * 3;
	f.len = Math.hypot( f.b[ 0 ] - f.a[ 0 ], f.b[ 1 ] - f.a[ 1 ] );
	const s = nearestStreet( mx, my );
	f.street = s.name;
	return s.d < 9 && f.len >= 3;

} );

// Panoramas with their S-JTSK positions (cached by facades.mjs).
const images = JSON.parse( await readFile( new URL( 'mapillary.json', RAW ) ) );
const positions = JSON.parse( await readFile( new URL( 'mapillary-sjtsk.json', RAW ) ) );
const isPano = im => im.camera_type === 'spherical' || im.camera_type === 'equirectangular';
const photos = images.map( ( im, i ) => ( { ...im, X: positions[ i ][ 0 ], Y: positions[ i ][ 1 ] } ) );

// Footprint mask for line-of-sight checks.
const scene = JSON.parse( await readFile( new URL( '../public/data/scene.json', import.meta.url ) ) );
const fp = scene.footprints;
const mask = new Uint8Array( await readFile( new URL( '../data/scene/footprints.bin', import.meta.url ) ) );
const blocked = ( X, Y ) => {

	const c = Math.floor( ( X - AREA.xmin ) / fp.cell ), r = Math.floor( ( AREA.ymax - Y ) / fp.cell );
	if ( c < 0 || r < 0 || c >= fp.width || r >= fp.height ) return false;
	const i = r * fp.width + c;
	return ( mask[ i >> 3 ] >> ( i & 7 ) ) & 1;

};

const clearView = ( cx, cy, tx, ty ) => {

	const d = Math.hypot( tx - cx, ty - cy );
	for ( let s = 0.5; s < d - 0.8; s += 0.4 ) if ( blocked( cx + ( tx - cx ) * s / d, cy + ( ty - cy ) * s / d ) ) return false;
	return true;

};

// Grid convergence (S-JTSK grid north vs true north) from the cached control points.
const control = JSON.parse( await readFile( new URL( 'geo-control.json', RAW ) ) );
const [ c0, c1 ] = [ control[ 3 ], control[ 4 ] ]; // same longitude, increasing latitude
const convergence = Math.atan2( c1[ 2 ] - c0[ 2 ], c1[ 3 ] - c0[ 3 ] );
const toENU = ( dx, dy ) => [ dx * Math.cos( convergence ) - dy * Math.sin( convergence ), dx * Math.sin( convergence ) + dy * Math.cos( convergence ) ];

function rotationMatrix( [ rx, ry, rz ] ) {

	const angle = Math.hypot( rx, ry, rz );
	const [ x, y, z ] = [ rx / angle, ry / angle, rz / angle ];
	const c = Math.cos( angle ), s = Math.sin( angle ), t = 1 - c;
	return [ t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c ];

}

const now = Date.now();
const out = [];
for ( const f of facades ) {

	const mx = ( f.a[ 0 ] + f.b[ 0 ] ) / 2, my = ( f.a[ 1 ] + f.b[ 1 ] ) / 2;
	let best = null;
	for ( const im of photos ) {

		const vx = im.X - mx, vy = im.Y - my;
		const dn = vx * f.n[ 0 ] + vy * f.n[ 1 ];
		const dist = Math.hypot( vx, vy );
		if ( dn < 3 || dist > 28 ) continue;
		if ( blocked( im.X, im.Y ) ) continue;
		if ( ! isPano( im ) ) {

			// A normal photo has to be pointing at the facade.
			const [ e, n ] = toENU( mx - im.X, my - im.Y );
			const bearing = Math.atan2( e, n ) * 180 / Math.PI;
			if ( Math.abs( ( bearing - im.computed_compass_angle + 540 ) % 360 - 180 ) > 28 ) continue;

		}
		let seen = 0;
		for ( const t of [ 0.2, 0.5, 0.8 ] ) {

			if ( clearView( im.X, im.Y, f.a[ 0 ] + ( f.b[ 0 ] - f.a[ 0 ] ) * t + f.n[ 0 ] * 0.3, f.a[ 1 ] + ( f.b[ 1 ] - f.a[ 1 ] ) * t + f.n[ 1 ] * 0.3 ) ) seen ++;

		}

		if ( seen < 2 ) continue;
		const ageYears = ( now - im.captured_at ) / 3.15e10;
		const score = ( dn / dist ) * Math.exp( - Math.max( 0, ageYears - 2 ) / 5 ) * Math.exp( - ( ( ( dist - 12 ) / 10 ) ** 2 ) ) * seen * ( isPano( im ) ? 1.2 : 1 );
		if ( ! best || score > best.score ) best = { im, score, dist };

	}

	if ( ! best ) continue;

	const u = new URL( `https://graph.mapillary.com/${best.im.id}` );
	u.searchParams.set( 'access_token', TOKEN );
	u.searchParams.set( 'fields', 'thumb_2048_url,thumb_1024_url,computed_rotation' );
	const det = await ( await fetch( u ) ).json();
	if ( ! det.thumb_2048_url || ! det.computed_rotation ) continue;
	const name = `house-${f.code}_${f.edge}`;
	const record = { name, code: f.code, edge: f.edge, street: f.street, length: + f.len.toFixed( 1 ), height: + ( f.eave - f.ground ).toFixed( 1 ), floors: f.floors, photo: best.im.id, date: new Date( best.im.captured_at ).toISOString().slice( 0, 10 ), distance: + best.dist.toFixed( 1 ) };

	if ( ! isPano( best.im ) ) {

		// Normal photo: keep it as it is.
		await writeFile( new URL( `${name}.jpg`, OUT ), Buffer.from( await ( await fetch( det.thumb_1024_url ) ).arrayBuffer() ) );
		out.push( record );
		console.log( `${name} ${f.street} ${f.len.toFixed( 0 )} m ← photo ${best.im.id} (${record.date}, ${best.dist.toFixed( 0 )} m)` );
		continue;

	}

	const pano = jpeg.decode( Buffer.from( await ( await fetch( det.thumb_2048_url ) ).arrayBuffer() ), { useTArray: true, maxMemoryUsageInMB: 1024 } );
	const R = rotationMatrix( det.computed_rotation );

	// Aim at the middle of the facade; field of view wide enough for the whole front.
	const [ e, n ] = toENU( mx - best.im.X, my - best.im.Y );
	const az = Math.atan2( e, n );
	const groundToCam = 2.0, wallMid = ( f.eave - f.ground ) / 2 - groundToCam;
	const pitch = Math.atan2( wallMid, best.dist );
	const fov = Math.min( 110, Math.max( 60, 2 * Math.atan2( Math.max( f.len, f.eave - f.ground ) * 0.65, best.dist ) * 180 / Math.PI ) );
	const fw = [ Math.sin( az ) * Math.cos( pitch ), Math.cos( az ) * Math.cos( pitch ), Math.sin( pitch ) ];
	const rt = [ Math.cos( az ), - Math.sin( az ), 0 ];
	const up = [ rt[ 1 ] * fw[ 2 ] - rt[ 2 ] * fw[ 1 ], rt[ 2 ] * fw[ 0 ] - rt[ 0 ] * fw[ 2 ], rt[ 0 ] * fw[ 1 ] - rt[ 1 ] * fw[ 0 ] ];
	const W = 900, H = 700, tanHalf = Math.tan( fov / 2 * Math.PI / 180 );
	const img = Buffer.alloc( W * H * 4 );
	for ( let j = 0; j < H; j ++ ) for ( let i = 0; i < W; i ++ ) {

		const sx = ( ( i + 0.5 ) / W * 2 - 1 ) * tanHalf, sy = ( 1 - ( j + 0.5 ) / H * 2 ) * tanHalf * H / W;
		const d = [ 0, 1, 2 ].map( k => fw[ k ] + rt[ k ] * sx + up[ k ] * sy );
		const x = R[ 0 ] * d[ 0 ] + R[ 1 ] * d[ 1 ] + R[ 2 ] * d[ 2 ];
		const y = R[ 3 ] * d[ 0 ] + R[ 4 ] * d[ 1 ] + R[ 5 ] * d[ 2 ];
		const z = R[ 6 ] * d[ 0 ] + R[ 7 ] * d[ 1 ] + R[ 8 ] * d[ 2 ];
		const lon = Math.atan2( x, z ), lat = Math.atan2( - y, Math.hypot( x, z ) );
		const px = Math.min( pano.width - 1, Math.floor( ( lon / ( 2 * Math.PI ) + 0.5 ) * pano.width ) );
		const py = Math.min( pano.height - 1, Math.floor( ( - lat / Math.PI + 0.5 ) * pano.height ) );
		const s = ( py * pano.width + px ) * 4, o = ( j * W + i ) * 4;
		img[ o ] = pano.data[ s ]; img[ o + 1 ] = pano.data[ s + 1 ]; img[ o + 2 ] = pano.data[ s + 2 ]; img[ o + 3 ] = 255;

	}

	await writeFile( new URL( `${name}.jpg`, OUT ), jpeg.encode( { data: img, width: W, height: H }, 85 ).data );
	out.push( record );
	console.log( `${name} ${f.street} ${f.len.toFixed( 0 )} m ← ${best.im.id} (${out.at( - 1 ).date}, ${best.dist.toFixed( 0 )} m)` );

}

await writeFile( new URL( `views/index-${[ ...streetNames ].join( '+' )}.json`, RAW ), JSON.stringify( out, null, 1 ) );
console.log( `${out.length} of ${facades.length} facades with a view` );
