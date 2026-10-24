// One grid square, made true to reality from street photos: the steps of docs/realism-workflow.md as commands.
//
//   npm run square -- prepare x-1_z0 [--budget 80]
//       List the square's house fronts with their addresses and the named places OSM puts in each house, and fetch
//       a Street View photo of every front (Google's own street imagery only; GMAPS_KEY in the environment; fronts
//       already photographed are skipped). Writes <work>/inventory.json; photos go to <photos>/<code>_<edge>.jpg.
//   (then a Claude session reads the photos as docs/review-brief.md says and writes <work>/review.json)
//   npm run square -- merge x-1_z0 [--protect 21644594,21644586]
//       Checks review.json and merges it into data/houses.json and data/signs.json. Then rebuild:
//       node tools/build-scene.mjs && npx vite build.
//
// The grid: square x<i>_z<j> covers 100·i ≤ x < 100·(i+1), 100·j ≤ z < 100·(j+1) m in the scene's frame (+x east,
// +z south, from ORIGIN in tools/area.mjs), so it lines up with any square added to the world later.
//
// Where things go (both outside git): SQUARE_WORK (default .square/<name>/, gitignored) and STREETVIEW_DIR
// (default ../vinko-streetview/). Street View images are reference only: never commit them, never use them as
// textures or measure geometry off them (CLAUDE.md).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lonLatToSJTSK } from './geo.mjs';

const ROOT = path.dirname( path.dirname( fileURLToPath( import.meta.url ) ) );
const RAW = path.join( ROOT, 'data/raw' );
const ORIGIN = { x: - 743087, y: - 1043282 };
const SIZE = 100;

const [ cmd, name, ...rest ] = process.argv.slice( 2 );
const opt = k => {

	const i = rest.indexOf( `--${k}` );
	return i >= 0 ? rest[ i + 1 ] : undefined;

};

const m = /^x(-?\d+)_z(-?\d+)$/.exec( name || '' );
if ( ! [ 'prepare', 'merge' ].includes( cmd ) || ! m ) {

	console.log( 'Usage: npm run square -- prepare|merge x<i>_z<j> [--budget N] [--protect code,code]' );
	process.exit( 1 );

}

const [ i, j ] = [ Number( m[ 1 ] ), Number( m[ 2 ] ) ];
const box = { x0: i * SIZE, x1: ( i + 1 ) * SIZE, z0: j * SIZE, z1: ( j + 1 ) * SIZE };
const WORK = process.env.SQUARE_WORK || path.join( ROOT, '.square', name );
const PHOTOS = process.env.STREETVIEW_DIR || path.join( ROOT, '..', 'vinko-streetview' );
const local = ( X, Y ) => [ X - ORIGIN.x, ORIGIN.y - Y ];

if ( cmd === 'prepare' ) await prepare();
else await merge();

// ---------------------------------------------------------------------------------------------------------------

async function prepare() {

	await mkdir( WORK, { recursive: true } );
	await mkdir( PHOTOS, { recursive: true } );
	const project = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( path.join( RAW, 'osm.json' ) ) );
	const B = JSON.parse( await readFile( path.join( RAW, 'buildings.json' ) ) );
	const H = JSON.parse( await readFile( path.join( ROOT, 'data/houses.json' ) ) );
	const fronts = JSON.parse( await readFile( path.join( RAW, 'street-facades.json' ) ) );

	// Which footprint a point is in (bounding boxes first).
	for ( const b of B ) {

		const r = b.geometry?.rings?.[ 0 ] || [ [ 0, 0 ] ];
		b.bb = [ Math.min( ...r.map( p => p[ 0 ] ) ), Math.min( ...r.map( p => p[ 1 ] ) ), Math.max( ...r.map( p => p[ 0 ] ) ), Math.max( ...r.map( p => p[ 1 ] ) ) ];

	}

	const inside = ( ring, X, Y ) => {

		let c = false;
		for ( let a = 0, b = ring.length - 1; a < ring.length; b = a ++ ) {

			const [ ax, ay ] = ring[ a ], [ bx, by ] = ring[ b ];
			if ( ( ay > Y ) !== ( by > Y ) && X < ax + ( Y - ay ) / ( by - ay ) * ( bx - ax ) ) c = ! c;

		}

		return c;

	};
	const codeAt = ( X, Y ) => {

		for ( const b of B ) {

			if ( X < b.bb[ 0 ] || X > b.bb[ 2 ] || Y < b.bb[ 1 ] || Y > b.bb[ 3 ] ) continue;
			if ( ( b.geometry?.rings || [] ).some( r => inside( r, X, Y ) ) ) return b.attributes.kod;

		}

		return null;

	};
	// The street a front faces: the nearest street centreline (ČÚZK street names).
	const segs = JSON.parse( await readFile( path.join( RAW, 'streets.json' ) ) ).filter( f => f.geometry?.paths )
		.flatMap( f => f.geometry.paths.flatMap( p => p.slice( 1 ).map( ( b, k ) => [ p[ k ], b, f.attributes.nazev ] ) ) );
	const streetAt = ( X, Y ) => {

		let best = { d: 12, n: null };
		for ( const [ [ ax, ay ], [ bx, by ], n ] of segs ) {

			const dx = bx - ax, dy = by - ay, t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
			const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
			if ( d < best.d ) best = { d, n };

		}

		return best.n;

	};
	const number = new Map( B.map( b => [ b.attributes.kod, b.attributes.cisladomovni ] ) );

	// Address points and named places, by the house they are in.
	const points = [];
	for ( const e of osm ) {

		const t = e.tags || {};
		if ( e.type !== 'node' ) continue;
		const named = t.name && ( t.amenity || t.shop || t.tourism || t.office || t.craft || t.historic || t.leisure );
		if ( ! named && ! t[ 'addr:conscriptionnumber' ] ) continue;
		const [ X, Y ] = project( e.lon, e.lat );
		const [ x, z ] = local( X, Y );
		if ( x < box.x0 - 30 || x > box.x1 + 30 || z < box.z0 - 30 || z > box.z1 + 30 ) continue;
		points.push( { X, Y, t, code: codeAt( X, Y ) } );

	}

	const list = [];
	for ( const f of fronts ) {

		const len = Math.hypot( f.b[ 0 ] - f.a[ 0 ], f.b[ 1 ] - f.a[ 1 ] );
		const [ mx, mz ] = local( ( f.a[ 0 ] + f.b[ 0 ] ) / 2, ( f.a[ 1 ] + f.b[ 1 ] ) / 2 );
		if ( len < 4 || mx < box.x0 || mx >= box.x1 || mz < box.z0 || mz >= box.z1 ) continue;
		const MX = ( f.a[ 0 ] + f.b[ 0 ] ) / 2, MY = ( f.a[ 1 ] + f.b[ 1 ] ) / 2;
		const mine = points.filter( p => p.code === f.code || ( ! p.code && Math.hypot( p.X - MX, p.Y - MY ) < len / 2 + 4 ) );
		const ux = ( f.b[ 0 ] - f.a[ 0 ] ) / len, uy = ( f.b[ 1 ] - f.a[ 1 ] ) / len;
		list.push( {
			front: `${f.code}_${f.edge}`, code: f.code, edge: f.edge, number: number.get( f.code ), street: streetAt( MX + f.n[ 0 ] * 3, MY + f.n[ 1 ] * 3 ), len: + len.toFixed( 1 ),
			mid: [ + mx.toFixed( 1 ), + mz.toFixed( 1 ) ], normal: [ + f.n[ 0 ].toFixed( 2 ), + ( - f.n[ 1 ] ).toFixed( 2 ) ],
			aIsLeft: ux * - f.n[ 1 ] + uy * f.n[ 0 ] > 0,
			addresses: [ ...new Set( mine.filter( p => p.t[ 'addr:conscriptionnumber' ] ).map( p => `${p.t[ 'addr:street' ] || ''} ${p.t[ 'addr:housenumber' ] || ''}`.trim() ) ) ],
			places: mine.filter( p => p.t.name ).map( p => `${p.t.name} — ${p.t.amenity || p.t.shop || p.t.tourism || p.t.office || p.t.craft || p.t.historic || p.t.leisure}` ),
			current: H[ f.code ] || null,
			a: f.a, b: f.b, n: f.n
		} );

	}

	console.log( `square ${name}: x ${box.x0}…${box.x1}, z ${box.z0}…${box.z1}: ${list.length} house fronts, ${new Set( list.map( f => f.code ) ).size} houses` );

	// Street View: one photo per front (two on fronts over 18 m), from across the street, Google's own imagery.
	const KEY = process.env.GMAPS_KEY;
	const budget = Number( opt( 'budget' ) ) || 80;
	let images = 0;
	if ( ! KEY ) console.log( 'GMAPS_KEY not set: no photos fetched (put your own photos in the photos folder, named <code>_<edge>.jpg)' );
	const toLL = ( X, Y ) => {

		let lon = 14.415, lat = 50.081;
		for ( let k = 0; k < 8; k ++ ) {

			const [ x0, y0 ] = project( lon, lat ), [ x1, y1 ] = project( lon + 1e-5, lat ), [ x2, y2 ] = project( lon, lat + 1e-5 );
			const a = ( x1 - x0 ) / 1e-5, b = ( x2 - x0 ) / 1e-5, c = ( y1 - y0 ) / 1e-5, d = ( y2 - y0 ) / 1e-5;
			const ex = X - x0, ey = Y - y0, det = a * d - b * c;
			lon += ( d * ex - b * ey ) / det;
			lat += ( - c * ex + a * ey ) / det;

		}

		return [ lon, lat ];

	};
	const bearing = ( [ lo1, la1 ], [ lo2, la2 ] ) => {

		const r = Math.PI / 180, y = Math.sin( ( lo2 - lo1 ) * r ) * Math.cos( la2 * r ), x = Math.cos( la1 * r ) * Math.sin( la2 * r ) - Math.sin( la1 * r ) * Math.cos( la2 * r ) * Math.cos( ( lo2 - lo1 ) * r );
		return ( Math.atan2( y, x ) / r + 360 ) % 360;

	};

	for ( const f of list ) {

		const spots = f.len > 18 ? [ 0.27, 0.73 ] : [ 0.5 ];
		f.photos = [];
		for ( const t of spots ) {

			const file = `${f.front}${spots.length > 1 ? ( t < 0.5 ? 'a' : 'b' ) : ''}.jpg`;
			if ( existsSync( path.join( PHOTOS, file ) ) ) {

				f.photos.push( file );
				continue;

			}

			if ( ! KEY || images >= budget ) continue;
			const TX = f.a[ 0 ] + ( f.b[ 0 ] - f.a[ 0 ] ) * t, TY = f.a[ 1 ] + ( f.b[ 1 ] - f.a[ 1 ] ) * t;
			const ux = ( f.b[ 0 ] - f.a[ 0 ] ) / f.len, uy = ( f.b[ 1 ] - f.a[ 1 ] ) / f.len;
			let meta = null;
			for ( const [ out, along ] of [ [ 7, 0 ], [ 7, 8 ], [ 7, - 8 ], [ 11, 14 ], [ 11, - 14 ] ] ) {

				const [ lon, lat ] = toLL( TX + f.n[ 0 ] * out + ux * along, TY + f.n[ 1 ] * out + uy * along );
				const q = await ( await fetch( `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&radius=10&source=outdoor&key=${KEY}` ) ).json();
				if ( q.status === 'OK' && /^© ?\d{0,4} ?Google$/.test( q.copyright || '' ) ) {

					meta = q;
					break;

				}

			}

			if ( ! meta ) continue;
			const target = toLL( TX, TY ), cam = [ meta.location.lng, meta.location.lat ];
			const dist = Math.max( 3, Math.hypot( ( cam[ 0 ] - target[ 0 ] ) * 71500, ( cam[ 1 ] - target[ 1 ] ) * 111200 ) );
			const span = spots.length > 1 ? f.len / 2 : f.len;
			const fov = Math.max( 60, Math.min( 110, 2 * Math.atan( span / 2 / dist ) * 180 / Math.PI + 20 ) ).toFixed( 0 );
			const pitch = Math.min( 30, Math.atan2( 5, dist ) * 180 / Math.PI ).toFixed( 1 );
			const res = await fetch( `https://maps.googleapis.com/maps/api/streetview?size=640x640&pano=${meta.pano_id}&heading=${bearing( cam, target ).toFixed( 1 )}&pitch=${pitch}&fov=${fov}&key=${KEY}` );
			images ++;
			if ( ! res.ok ) continue;
			await writeFile( path.join( PHOTOS, file ), Buffer.from( await res.arrayBuffer() ) );
			f.photos.push( file );

		}

		delete f.a;
		delete f.b;
		delete f.n;

	}

	// The owner's own photos for this square, if any are in the photos folder under the square's name.
	const own = existsSync( path.join( PHOTOS, name ) ) ? readdirSync( path.join( PHOTOS, name ) ).map( f => path.join( name, f ) ) : [];
	await writeFile( path.join( WORK, 'inventory.json' ), JSON.stringify( { square: name, box, photosDir: PHOTOS, ownPhotos: own, fronts: list }, null, 1 ) );
	console.log( `${images} Street View images fetched (≈ $${( images * 0.007 ).toFixed( 2 )} at list price), ${list.filter( f => f.photos.length ).length}/${list.length} fronts with photos, ${own.length} own photos` );
	console.log( `next: read the photos as docs/review-brief.md says, write ${path.join( WORK, 'review.json' )}, then: npm run square -- merge ${name}` );

}

// ---------------------------------------------------------------------------------------------------------------

async function merge() {

	const HP = path.join( ROOT, 'data/houses.json' ), SG = path.join( ROOT, 'data/signs.json' );
	const H = JSON.parse( await readFile( HP ) ), S = JSON.parse( await readFile( SG ) );
	const R = JSON.parse( await readFile( path.join( WORK, 'review.json' ) ) );
	const inv = existsSync( path.join( WORK, 'inventory.json' ) ) ? JSON.parse( await readFile( path.join( WORK, 'inventory.json' ) ) ) : null;
	const ours = new Set( inv ? inv.fronts.map( f => f.front ) : [] );
	const protect = new Set( ( opt( 'protect' ) || '' ).split( ',' ).filter( Boolean ) );
	const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test( v ) ? v.toLowerCase() : undefined;
	const GROUND = new Set( [ 'shops', 'restaurant', 'gate', 'windows', 'blank', 'default' ] ), RUSTIC = new Set( [ 'none', 'banded', 'ornate' ] );
	const KINDS = new Set( [ 'board', 'letters', 'hanging', 'plaque' ] );
	let houses = 0, signs = 0;
	const lowConfidence = [], rejected = [];

	for ( const [ code, h ] of Object.entries( R.houses || {} ) ) {

		if ( protect.has( code ) ) continue;
		if ( inv && ! inv.fronts.some( f => String( f.code ) === code ) ) {

			rejected.push( `house ${code}: not in this square` );
			continue;

		}

		const e = { ...( H[ code ] || {} ) };
		if ( h.note ) e.note = String( h.note ).slice( 0, 400 );
		if ( h.confidence !== 'low' ) {

			if ( hex( h.colour ) ) e.colour = hex( h.colour );
			if ( hex( h.trim ) ) e.trim = hex( h.trim );
			if ( Number.isInteger( h.floors ) && h.floors >= 1 && h.floors <= 9 ) e.floors = h.floors;
			if ( GROUND.has( h.ground ) ) e.ground = h.ground;
			if ( RUSTIC.has( h.rustic ) ) e.rustic = h.rustic;
			if ( typeof h.grilles === 'boolean' ) e.grilles = h.grilles;
			if ( typeof h.graffiti === 'boolean' ) e.graffiti = h.graffiti;

		} else lowConfidence.push( code );

		if ( h.edges && typeof h.edges === 'object' ) {

			e.edges = { ...( e.edges || {} ) };
			for ( const [ k, v ] of Object.entries( h.edges ) ) {

				const x = {};
				if ( hex( v?.awning ) ) x.awning = hex( v.awning );
				if ( v?.lanterns === true ) x.lanterns = true;
				if ( v?.banner?.text ) x.banner = { text: String( v.banner.text ).slice( 0, 30 ), board: hex( v.banner.board ) || '#7a2230', ink: hex( v.banner.ink ) || '#ffffff' };
				if ( Object.keys( x ).length ) e.edges[ k ] = { ...( e.edges[ k ] || {} ), ...x };

			}

			if ( ! Object.keys( e.edges ).length ) delete e.edges;

		}

		e.signs = false;
		H[ code ] = e;
		houses ++;

	}

	for ( const g of R.signs || [] ) {

		if ( ! KINDS.has( g.kind ) || ! g.text || ! /^\d+_\d+$/.test( g.front ) ) {

			rejected.push( `sign "${g.text}": bad kind or front` );
			continue;

		}

		if ( inv && ! ours.has( g.front ) ) {

			rejected.push( `sign "${g.text}": front ${g.front} not in this square` );
			continue;

		}

		if ( S.some( q => q.front === g.front && q.text === g.text ) ) continue;
		S.push( {
			front: g.front, fromLeft: Math.max( 0, Math.min( 1, + g.fromLeft || 0.5 ) ), height: Math.max( 1.2, Math.min( 8, + g.height || 3.2 ) ),
			kind: g.kind, text: String( g.text ).slice( 0, 48 ), ...( g.sub ? { sub: String( g.sub ).slice( 0, 48 ) } : {} ),
			width: Math.max( 0.3, Math.min( 12, + g.width || 2 ) ), ...( hex( g.bg ) ? { bg: hex( g.bg ) } : {} ), ink: hex( g.ink ) || '#f2ead6',
			font: [ 'serif', 'sans', 'script' ].includes( g.font ) ? g.font : 'sans', street: name, what: String( g.what || '' ).slice( 0, 200 )
		} );
		signs ++;

	}

	await writeFile( HP, JSON.stringify( H, null, '\t' ) + '\n' );
	await writeFile( SG, JSON.stringify( S, null, '\t' ) + '\n' );
	console.log( `square ${name}: merged ${houses} houses, ${signs} signs` );
	if ( lowConfidence.length ) console.log( `low confidence (note only): ${lowConfidence.join( ', ' )}` );
	if ( rejected.length ) console.log( `rejected:\n  ${rejected.join( '\n  ' )}` );
	await writeFile( path.join( WORK, 'merge.json' ), JSON.stringify( { houses, signs, lowConfidence, rejected, issues: R.issues || [] }, null, 1 ) );
	console.log( 'next: node tools/build-scene.mjs && npx vite build, then look at the square' );

}
