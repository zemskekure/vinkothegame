// Matches every street-facing facade (data/raw/street-facades.json, from build-scene.mjs) with the best
// Mapillary photo, projects the wall into it and saves a rectified, head-on crop of the facade to
// data/raw/facades/<building code>_<edge>.jpg, plus data/raw/facade-crops.json describing them.
//
// Needs MAPILLARY_TOKEN; run with NODE_USE_ENV_PROXY=1 behind a proxy.
// Usage: node tools/facades.mjs [max facades] [building code filter, comma separated]
// Imagery © Mapillary contributors, CC BY-SA 4.0.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { fromFile } from 'geotiff';
import { AREA } from './area.mjs';

const RAW = new URL( '../data/raw/', import.meta.url );
const CROPS = new URL( process.env.FACADE_OUT || 'facades/', RAW );
const TOKEN = process.env.MAPILLARY_TOKEN;
if ( ! TOKEN ) throw new Error( 'MAPILLARY_TOKEN is not set' );

const PX_PER_M = 16;
const CAMERA_HEIGHT = 2.0; // above the terrain; Mapillary altitudes are not reliable enough

const [ maxArg, codesArg ] = process.argv.slice( 2 );
const codes = codesArg ? new Set( codesArg.split( ',' ).map( Number ) ) : null;

// ---------------------------------------------------------------------------
// Inputs

let facades = JSON.parse( await readFile( new URL( 'street-facades.json', RAW ) ) );
if ( codes ) facades = facades.filter( f => codes.has( f.code ) );
facades = facades.filter( f => Math.hypot( f.b[ 0 ] - f.a[ 0 ], f.b[ 1 ] - f.a[ 1 ] ) >= 4 );
if ( Number( maxArg ) > 0 ) facades = facades.slice( 0, Number( maxArg ) );

const images = JSON.parse( await readFile( new URL( 'mapillary.json', RAW ) ) );

const dtmTiff = await ( await fromFile( new URL( 'dtm.tif', RAW ).pathname ) ).getImage();
const [ dtm ] = await dtmTiff.readRasters();
const dtmW = dtmTiff.getWidth(), dtmH = dtmTiff.getHeight(), dtmCell = ( AREA.xmax - AREA.xmin ) / dtmW;
const groundAt = ( X, Y ) => {

	const c = Math.min( dtmW - 1, Math.max( 0, Math.floor( ( X - AREA.xmin ) / dtmCell ) ) );
	const r = Math.min( dtmH - 1, Math.max( 0, Math.floor( ( AREA.ymax - Y ) / dtmCell ) ) );
	return dtm[ r * dtmW + c ];

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

// ---------------------------------------------------------------------------
// WGS 84 → S-JTSK through the ČÚZK geometry service, cached.

async function project( points ) {

	const out = [];
	for ( let i = 0; i < points.length; i += 500 ) {

		const body = new URLSearchParams( {
			geometries: JSON.stringify( { geometryType: 'esriGeometryPoint', geometries: points.slice( i, i + 500 ).map( ( [ x, y ] ) => ( { x, y } ) ) } ),
			inSR: 4326, outSR: 5514, f: 'json'
		} );
		const res = await fetch( 'https://ags.cuzk.cz/arcgis/rest/services/Utilities/Geometry/GeometryServer/project', { method: 'POST', body } );
		const json = await res.json();
		if ( ! json.geometries ) throw new Error( JSON.stringify( json ) );
		out.push( ...json.geometries.map( g => [ g.x, g.y ] ) );

	}

	return out;

}

const cacheFile = new URL( 'mapillary-sjtsk.json', RAW );
let positions;
try {

	positions = JSON.parse( await readFile( cacheFile ) );

} catch {

	positions = await project( images.map( im => im.computed_geometry.coordinates ) );
	await writeFile( cacheFile, JSON.stringify( positions ) );

}

images.forEach( ( im, i ) => {

	im.X = positions[ i ][ 0 ];
	im.Y = positions[ i ][ 1 ];

} );

// Grid convergence: angle from true north to the S-JTSK grid's +Y axis at the area.
const [ p0, p1 ] = await project( [ [ 14.4160, 50.0835 ], [ 14.4160, 50.0845 ] ] );
const convergence = Math.atan2( p1[ 0 ] - p0[ 0 ], p1[ 1 ] - p0[ 1 ] ); // grid azimuth of true north
// S-JTSK vector → local ENU (east, north)
const toENU = ( dx, dy ) => [
	dx * Math.cos( convergence ) - dy * Math.sin( convergence ),
	dx * Math.sin( convergence ) + dy * Math.cos( convergence )
];

// ---------------------------------------------------------------------------
// Camera model (OpenSfM conventions, as used by Mapillary)

function rotationMatrix( [ rx, ry, rz ] ) {

	const angle = Math.hypot( rx, ry, rz );
	if ( angle < 1e-12 ) return [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ];
	const [ x, y, z ] = [ rx / angle, ry / angle, rz / angle ];
	const c = Math.cos( angle ), s = Math.sin( angle ), t = 1 - c;
	return [
		t * x * x + c, t * x * y - s * z, t * x * z + s * y,
		t * x * y + s * z, t * y * y + c, t * y * z - s * x,
		t * x * z - s * y, t * y * z + s * x, t * z * z + c
	];

}

// World point (S-JTSK X, Y, height) → pixel in the image, or null when behind / outside.
function makeProjector( cam, width, height ) {

	const R = rotationMatrix( cam.computed_rotation );
	const C = [ cam.X, cam.Y, groundAt( cam.X, cam.Y ) + CAMERA_HEIGHT ];
	const spherical = cam.camera_type === 'spherical' || cam.camera_type === 'equirectangular';
	const focal = cam.camera_parameters?.[ 0 ] ?? 0.85;
	const k1 = cam.camera_parameters?.[ 1 ] ?? 0, k2 = cam.camera_parameters?.[ 2 ] ?? 0;
	const size = Math.max( width, height );

	return ( X, Y, H ) => {

		const [ e, n ] = toENU( X - C[ 0 ], Y - C[ 1 ] );
		const u = H - C[ 2 ];
		const x = R[ 0 ] * e + R[ 1 ] * n + R[ 2 ] * u;
		const y = R[ 3 ] * e + R[ 4 ] * n + R[ 5 ] * u;
		const z = R[ 6 ] * e + R[ 7 ] * n + R[ 8 ] * u;

		if ( spherical ) {

			const lon = Math.atan2( x, z );
			const lat = Math.atan2( - y, Math.hypot( x, z ) );
			return [ ( lon / ( 2 * Math.PI ) + 0.5 ) * width, ( - lat / Math.PI + 0.5 ) * height ];

		}

		if ( z <= 0.1 ) return null;
		const xn = x / z, yn = y / z;
		const r2 = xn * xn + yn * yn;
		const d = 1 + k1 * r2 + k2 * r2 * r2;
		const px = width / 2 + xn * d * focal * size, py = height / 2 + yn * d * focal * size;
		if ( px < 0 || py < 0 || px >= width || py >= height ) return null;
		return [ px, py ];

	};

}

// ---------------------------------------------------------------------------
// Candidate photos per facade

const cell = 40;
const grid = new Map();
for ( const im of images ) {

	const k = `${Math.floor( im.X / cell )},${Math.floor( im.Y / cell )}`;
	if ( ! grid.has( k ) ) grid.set( k, [] );
	grid.get( k ).push( im );

}

function nearby( X, Y ) {

	const out = [];
	const cx = Math.floor( X / cell ), cy = Math.floor( Y / cell );
	for ( let i = - 1; i <= 1; i ++ ) for ( let j = - 1; j <= 1; j ++ ) out.push( ...( grid.get( `${cx + i},${cy + j}` ) || [] ) );
	return out;

}

function lineOfSight( cx, cy, tx, ty ) {

	const d = Math.hypot( tx - cx, ty - cy );
	for ( let s = 0.5; s < d - 0.8; s += 0.4 ) {

		if ( blocked( cx + ( tx - cx ) * s / d, cy + ( ty - cy ) * s / d ) ) return false;

	}

	return true;

}

function candidates( f ) {

	const [ ax, ay ] = f.a, [ bx, by ] = f.b, [ nx, ny ] = f.n;
	const len = Math.hypot( bx - ax, by - ay );
	const tx = ( bx - ax ) / len, ty = ( by - ay ) / len;
	const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
	const now = Date.now();
	const out = [];

	for ( const im of nearby( mx, my ) ) {

		const vx = im.X - mx, vy = im.Y - my;
		const dn = vx * nx + vy * ny, dt = vx * tx + vy * ty;
		if ( dn < 4 || dn > 35 || Math.abs( dt ) > len / 2 + 10 ) continue;
		// Cameras under arcades and in passages stand inside a footprint: their view of this wall is meaningless.
		if ( blocked( im.X, im.Y ) || blocked( im.X + 1, im.Y ) || blocked( im.X - 1, im.Y ) || blocked( im.X, im.Y + 1 ) || blocked( im.X, im.Y - 1 ) ) continue;
		const angle = Math.atan2( Math.abs( dt ), dn );
		if ( angle > 1.1 ) continue;

		// Most of the wall must be in sight.
		let seen = 0;
		for ( const t of [ 0.1, 0.3, 0.5, 0.7, 0.9 ] ) {

			const px = ax + ( bx - ax ) * t + nx * 0.2, py = ay + ( by - ay ) * t + ny * 0.2;
			if ( lineOfSight( im.X, im.Y, px, py ) ) seen ++;

		}

		if ( seen < 3 ) continue;

		const spherical = im.camera_type === 'spherical' || im.camera_type === 'equirectangular';
		if ( ! spherical ) {

			// The wall's centre has to lie well inside a perspective photo's view.
			const bearing = Math.atan2( ...toENU( mx - im.X, my - im.Y ) ); // from north, clockwise
			const diff = Math.abs( ( bearing * 180 / Math.PI - im.computed_compass_angle + 540 ) % 360 - 180 );
			if ( diff > 32 ) continue;

		}

		const ageYears = ( now - im.captured_at ) / 3.15e10;
		const score = Math.cos( angle ) ** 2
			* ( spherical ? 1.3 : 1 )
			* Math.exp( - Math.max( 0, ageYears - 2 ) / 6 )
			* Math.exp( - ( ( ( dn - 10 ) / 9 ) ** 2 ) )
			* ( seen / 5 );
		out.push( { im, score } );

	}

	return out.sort( ( a, b ) => b.score - a.score );

}

// ---------------------------------------------------------------------------
// Download + rectify

async function details( id ) {

	const u = new URL( `https://graph.mapillary.com/${id}` );
	u.searchParams.set( 'access_token', TOKEN );
	u.searchParams.set( 'fields', 'thumb_2048_url,computed_rotation,camera_parameters,camera_type,width,height' );
	const res = await fetch( u );
	if ( ! res.ok ) throw new Error( `details ${id}: ${res.status}` );
	return res.json();

}

const photoCache = new Map();
async function photo( url ) {

	if ( ! photoCache.has( url ) ) {

		const res = await fetch( url );
		if ( ! res.ok ) throw new Error( `photo: ${res.status}` );
		photoCache.set( url, jpeg.decode( Buffer.from( await res.arrayBuffer() ), { useTArray: true, maxMemoryUsageInMB: 1024 } ) );
		if ( photoCache.size > 30 ) photoCache.delete( photoCache.keys().next().value );

	}

	return photoCache.get( url );

}

function rectify( f, cam, img ) {

	const [ ax, ay ] = f.a, [ bx, by ] = f.b;
	const len = Math.hypot( bx - ax, by - ay );
	const wallH = f.eave - f.ground;
	const W = Math.round( len * PX_PER_M ), H = Math.round( wallH * PX_PER_M );
	const projectPt = makeProjector( cam, img.width, img.height );

	// Read the wall left to right as seen from the street: start at the end on the viewer's left.
	const [ nx, ny ] = f.n;
	const leftToRight = ( bx - ax ) * ny - ( by - ay ) * nx < 0; // t × n sign
	const [ sx, sy, ex, ey ] = leftToRight ? [ ax, ay, bx, by ] : [ bx, by, ax, ay ];

	const out = Buffer.alloc( W * H * 4 );
	let valid = 0;
	for ( let j = 0; j < H; j ++ ) {

		const h = f.eave - ( j + 0.5 ) / PX_PER_M;
		for ( let i = 0; i < W; i ++ ) {

			const t = ( i + 0.5 ) / W;
			const p = projectPt( sx + ( ex - sx ) * t, sy + ( ey - sy ) * t, h );
			const o = ( j * W + i ) * 4;
			out[ o + 3 ] = 255;
			if ( ! p ) continue;
			const px = Math.min( img.width - 1, Math.max( 0, Math.round( p[ 0 ] ) ) );
			const py = Math.min( img.height - 1, Math.max( 0, Math.round( p[ 1 ] ) ) );
			const k = ( py * img.width + px ) * 4;
			out[ o ] = img.data[ k ]; out[ o + 1 ] = img.data[ k + 1 ]; out[ o + 2 ] = img.data[ k + 2 ];
			valid ++;

		}

	}

	let debug = null;
	if ( process.env.FACADE_DEBUG ) {

		// Full photo with the wall outline drawn in, for checking the registration.
		const dbg = Buffer.from( img.data );
		const mark = ( X, Y, Hh ) => {

			const p = projectPt( X, Y, Hh );
			if ( ! p ) return;
			for ( let dy = - 6; dy <= 6; dy ++ ) for ( let dx = - 6; dx <= 6; dx ++ ) {

				const px = Math.round( p[ 0 ] ) + dx, py = Math.round( p[ 1 ] ) + dy;
				if ( px < 0 || py < 0 || px >= img.width || py >= img.height ) continue;
				const k = ( py * img.width + px ) * 4;
				dbg[ k ] = 255; dbg[ k + 1 ] = 0; dbg[ k + 2 ] = 255;

			}

		};

		for ( let t = 0; t <= 1; t += 0.02 ) {

			const X = sx + ( ex - sx ) * t, Y = sy + ( ey - sy ) * t;
			mark( X, Y, f.ground );
			mark( X, Y, f.eave );

		}

		for ( let hh = f.ground; hh <= f.eave; hh += 0.5 ) {

			mark( sx, sy, hh );
			mark( ex, ey, hh );

		}

		debug = jpeg.encode( { data: dbg, width: img.width, height: img.height }, 80 ).data;

	}

	return { jpg: jpeg.encode( { data: out, width: W, height: H }, 85 ).data, W, H, coverage: valid / ( W * H ), debug };

}

// ---------------------------------------------------------------------------

await mkdir( CROPS, { recursive: true } );
let done = 0;

// One facade: pick the photo, rectify, write the crop plus a small JSON sidecar (so reruns can resume).
async function processFacade( f ) {

	const name = `${f.code}_${f.edge}`;
	const sidecar = new URL( `${name}.json`, CROPS );
	const cands = candidates( f );

	// Resume: keep an earlier result while its photo still passes the selection rules.
	try {

		const prev = JSON.parse( await readFile( sidecar ) );
		if ( prev.photo === null ? ! cands.length : cands.some( c => c.im.id === prev.photo ) ) return prev;

	} catch { /* not done yet */ }

	let result = { name, code: f.code, edge: f.edge, photo: null, candidates: cands.length };

	// Best photo whose view covers (nearly) the whole wall.
	for ( const { im } of cands.slice( 0, 4 ) ) {

		try {

			const det = await details( im.id );
			const cam = { ...im, ...det };
			const img = await photo( det.thumb_2048_url );
			const crop = rectify( f, cam, img );
			if ( crop.coverage < 0.9 ) continue;
			await writeFile( new URL( `${name}.jpg`, CROPS ), crop.jpg );
			if ( crop.debug ) await writeFile( new URL( `${name}.debug.jpg`, CROPS ), crop.debug );
			result = { ...result, photo: im.id, captured: im.captured_at, type: cam.camera_type, coverage: + crop.coverage.toFixed( 2 ) };
			break;

		} catch ( e ) {

			result.error = e.message;

		}

	}

	if ( result.photo ) delete result.error;
	else await rm( new URL( `${name}.jpg`, CROPS ), { force: true } );

	if ( ! result.error ) await writeFile( sidecar, JSON.stringify( result ) );
	if ( ++ done % 50 === 0 ) console.log( `${done}/${facades.length}` );
	return result;

}

const CONCURRENCY = 8;
const results = new Array( facades.length );
let next = 0;
await Promise.all( Array.from( { length: CONCURRENCY }, async () => {

	while ( next < facades.length ) {

		const i = next ++;
		results[ i ] = await processFacade( facades[ i ] );

	}

} ) );

await writeFile( new URL( 'facade-crops.json', RAW ), JSON.stringify( results, null, 1 ) );
const ok = results.filter( r => r.photo ).length;
console.log( `facades: ${ok}/${results.length} with a photo` );
