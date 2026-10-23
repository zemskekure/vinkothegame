// Reference views of a landmark from Mapillary 360° panoramas: for panoramas around the building it renders a
// normal perspective photo aimed at the building (slightly upwards), one per side, into data/raw/views/<name>_<k>.jpg.
// Needs MAPILLARY_TOKEN. Usage: node tools/landmark-views.mjs <name> <osm way id> [min m] [max m]
// Imagery © Mapillary contributors, CC BY-SA 4.0.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import jpeg from 'jpeg-js';

const [ name, wayId, minArg, maxArg ] = process.argv.slice( 2 );
const TOKEN = process.env.MAPILLARY_TOKEN;
const MIN = Number( minArg ) || 18, MAX = Number( maxArg ) || 70;
const OUT = new URL( '../data/raw/views/', import.meta.url );
await mkdir( OUT, { recursive: true } );

const osm = JSON.parse( await readFile( new URL( '../data/raw/osm.json', import.meta.url ) ) );
const nodes = new Map( osm.filter( e => e.type === 'node' ).map( n => [ n.id, n ] ) );
const way = osm.find( e => e.type === 'way' && e.id === Number( wayId ) );
const pts = way.nodes.map( id => nodes.get( id ) ).filter( Boolean );
const lon0 = pts.reduce( ( a, p ) => a + p.lon, 0 ) / pts.length, lat0 = pts.reduce( ( a, p ) => a + p.lat, 0 ) / pts.length;

// Local east / north metres around the building.
const R = 6371008.8;
const enu = ( lon, lat ) => [ ( lon - lon0 ) * Math.PI / 180 * R * Math.cos( lat0 * Math.PI / 180 ), ( lat - lat0 ) * Math.PI / 180 * R ];

const images = JSON.parse( await readFile( new URL( '../data/raw/mapillary.json', import.meta.url ) ) )
	.filter( im => im.camera_type === 'spherical' || im.camera_type === 'equirectangular' )
	.map( im => ( { ...im, p: enu( ...im.computed_geometry.coordinates ) } ) )
	.filter( im => {

		const d = Math.hypot( ...im.p );
		return d >= MIN && d <= MAX;

	} );

// One panorama per 45° sector around the building: the most recent, then the closest.
const sectors = new Map();
for ( const im of images ) {

	const sector = Math.round( Math.atan2( im.p[ 0 ], im.p[ 1 ] ) / ( Math.PI / 4 ) );
	const best = sectors.get( sector );
	const score = im.captured_at / 3.15e10 - Math.hypot( ...im.p ) / 40;
	if ( ! best || score > best.score ) sectors.set( sector, { im, score } );

}

function rotationMatrix( [ rx, ry, rz ] ) {

	const angle = Math.hypot( rx, ry, rz );
	const [ x, y, z ] = [ rx / angle, ry / angle, rz / angle ];
	const c = Math.cos( angle ), s = Math.sin( angle ), t = 1 - c;
	return [ t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c ];

}

let k = 0;
for ( const { im } of sectors.values() ) {

	const u = new URL( `https://graph.mapillary.com/${im.id}` );
	u.searchParams.set( 'access_token', TOKEN );
	u.searchParams.set( 'fields', 'thumb_2048_url,computed_rotation' );
	const det = await ( await fetch( u ) ).json();
	if ( ! det.thumb_2048_url || ! det.computed_rotation ) continue;
	const pano = jpeg.decode( Buffer.from( await ( await fetch( det.thumb_2048_url ) ).arrayBuffer() ), { useTArray: true, maxMemoryUsageInMB: 1024 } );
	const Rm = rotationMatrix( det.computed_rotation );

	// Virtual camera at the panorama, looking at the building centre, tilted up.
	const az = Math.atan2( - im.p[ 0 ], - im.p[ 1 ] ), pitch = 0.22;
	const f = [ Math.sin( az ) * Math.cos( pitch ), Math.cos( az ) * Math.cos( pitch ), Math.sin( pitch ) ];
	const r = [ Math.cos( az ), - Math.sin( az ), 0 ];
	const up = [ r[ 1 ] * f[ 2 ] - r[ 2 ] * f[ 1 ], r[ 2 ] * f[ 0 ] - r[ 0 ] * f[ 2 ], r[ 0 ] * f[ 1 ] - r[ 1 ] * f[ 0 ] ];
	const W = 1200, H = 800, tanHalf = Math.tan( 75 / 2 * Math.PI / 180 );
	const out = Buffer.alloc( W * H * 4 );
	for ( let j = 0; j < H; j ++ ) {

		for ( let i = 0; i < W; i ++ ) {

			const sx = ( ( i + 0.5 ) / W * 2 - 1 ) * tanHalf, sy = ( 1 - ( j + 0.5 ) / H * 2 ) * tanHalf * H / W;
			const d = [ 0, 1, 2 ].map( a => f[ a ] + r[ a ] * sx + up[ a ] * sy );
			const x = Rm[ 0 ] * d[ 0 ] + Rm[ 1 ] * d[ 1 ] + Rm[ 2 ] * d[ 2 ];
			const y = Rm[ 3 ] * d[ 0 ] + Rm[ 4 ] * d[ 1 ] + Rm[ 5 ] * d[ 2 ];
			const z = Rm[ 6 ] * d[ 0 ] + Rm[ 7 ] * d[ 1 ] + Rm[ 8 ] * d[ 2 ];
			const lon = Math.atan2( x, z ), lat = Math.atan2( - y, Math.hypot( x, z ) );
			const px = Math.min( pano.width - 1, Math.floor( ( lon / ( 2 * Math.PI ) + 0.5 ) * pano.width ) );
			const py = Math.min( pano.height - 1, Math.floor( ( - lat / Math.PI + 0.5 ) * pano.height ) );
			const s = ( py * pano.width + px ) * 4, o = ( j * W + i ) * 4;
			out[ o ] = pano.data[ s ]; out[ o + 1 ] = pano.data[ s + 1 ]; out[ o + 2 ] = pano.data[ s + 2 ]; out[ o + 3 ] = 255;

		}

	}

	await writeFile( new URL( `${name}_${k}.jpg`, OUT ), jpeg.encode( { data: out, width: W, height: H }, 85 ).data );
	console.log( `${name}_${k}: ${im.id} ${new Date( im.captured_at ).toISOString().slice( 0, 10 )} ${Math.round( Math.hypot( ...im.p ) )} m, from ${Math.round( ( Math.atan2( im.p[ 0 ], im.p[ 1 ] ) * 180 / Math.PI + 360 ) % 360 )}°` );
	k ++;

}
