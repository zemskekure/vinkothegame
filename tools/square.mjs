// One grid square, made true to reality from street photos: the steps of docs/realism-workflow.md as commands.
//
//   npm run square -- prepare x-1_z0 [--budget 80]
//       List the square's house fronts with their addresses and the named places OSM puts in each house, and fetch
//       a Street View photo of every front (Google's own street imagery only; GMAPS_KEY in the environment; fronts
//       already photographed are skipped). Writes <work>/inventory.json; photos go to <photos>/<code>_<edge>.jpg.
//   (then a Claude session reads the photos as docs/review-brief.md says and writes <work>/review.json)
//   npm run square -- merge x-1_z0 [--protect 21644594,21644586]
//       Checks review.json and merges it into data/houses.json and data/signs.json. Then rebuild:
//       node tools/build-scene.mjs && npm run build.
//
// The grid: square x<i>_z<j> covers 100·i ≤ x < 100·(i+1), 100·j ≤ z < 100·(j+1) m in the scene's frame (+x east,
// +z south, from ORIGIN in tools/area.mjs), so it lines up with any square added to the world later.
//
// Where things go (both outside git): SQUARE_WORK (default .square/<name>/, gitignored) and STREETVIEW_DIR
// (default ../vinko-streetview/). Street View images are reference only: never commit them, never use them as
// textures or measure geometry off them (CLAUDE.md).

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { lonLatToSJTSK } from './geo.mjs';
import { validateReview, validateShopfrontSvg } from './square-schema.mjs';

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
const OWNER_PHOTOS = process.env.OWNER_PHOTOS_DIR || path.join( homedir(), 'Documents/HOLUB/photos-export' );
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
	// Google reports its panorama positions several metres off in these narrow streets (7 m on Mikulandská,
	// inside the houses on one side), while the car drove down the middle. A camera point more than 1.5 m from the
	// nearest street centreline (ČÚZK) is pulled across to within 1.5 m of it, keeping its place along the street.
	const onStreet = ( X, Y ) => {

		let best = { d: Infinity, X, Y };
		for ( const [ [ ax, ay ], [ bx, by ] ] of segs ) {

			const dx = bx - ax, dy = by - ay, t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
			const d = Math.hypot( X - ax - t * dx, Y - ay - t * dy );
			if ( d < best.d ) best = { d, X: ax + t * dx, Y: ay + t * dy };

		}

		if ( best.d <= 1.5 || best.d > 15 ) return { X, Y, moved: 0 };
		const k = 1.5 / best.d;
		return { X: best.X + ( X - best.X ) * k, Y: best.Y + ( Y - best.Y ) * k, moved: best.d - 1.5 };

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
	const budget = opt( 'budget' ) === undefined ? 80 : Number( opt( 'budget' ) );
	if ( ! Number.isInteger( budget ) || budget < 0 ) throw new Error( '--budget must be a non-negative integer' );
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
		f.views = [];
		for ( const t of spots ) {

			const file = `${f.front}${spots.length > 1 ? ( t < 0.5 ? 'a' : 'b' ) : ''}.jpg`;
			let cached = existsSync( path.join( PHOTOS, file ) );
			const viewPath = path.join( PHOTOS, `${file}.view.json` );
			if ( cached && existsSync( viewPath ) ) {

				const view = JSON.parse( await readFile( viewPath ) );
				// Views taken before camera points were put back on the street: with a key, fetch them again aimed
				// from the corrected point; without one, at least render the model from there.
				if ( view.source === 'Street View' && view.reported === undefined ) {

					const fix = onStreet( view.x + ORIGIN.x, ORIGIN.y - view.z );
					if ( fix.moved > 0.5 && KEY && images < budget ) {

						cached = false;

					} else {

						view.reported = [ view.x, view.z ];
						[ view.x, view.z ] = local( fix.X, fix.Y ).map( v => + v.toFixed( 2 ) );
						await writeFile( viewPath, JSON.stringify( view ) );

					}

				}

			}

			if ( cached && existsSync( viewPath ) ) {

				const view = JSON.parse( await readFile( viewPath ) );
				if ( ! Number.isFinite( view.pitch ) || ! Number.isFinite( view.fov ) ) {

					const tx = f.a[ 0 ] + ( f.b[ 0 ] - f.a[ 0 ] ) * t, ty = f.a[ 1 ] + ( f.b[ 1 ] - f.a[ 1 ] ) * t;
					const [ targetX, targetZ ] = local( tx, ty );
					const dist = Math.max( 3, Math.hypot( view.x - targetX, view.z - targetZ ) );
					const span = spots.length > 1 ? f.len / 2 : f.len;
					view.fov = Math.round( Math.max( 60, Math.min( 110, 2 * Math.atan( span / 2 / dist ) * 180 / Math.PI + 20 ) ) );
					view.pitch = + Math.min( 30, Math.atan2( 5, dist ) * 180 / Math.PI ).toFixed( 1 );
					await writeFile( viewPath, JSON.stringify( view ) );

				}
				f.photos.push( file );
				f.views.push( view );
				continue;

			}

			if ( cached && ! KEY ) { f.photos.push( file ); continue; }
			if ( ! KEY || ( ! cached && images >= budget ) ) continue;
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
			const reported = project( meta.location.lng, meta.location.lat );
			const fix = onStreet( ...reported );
			const target = toLL( TX, TY ), cam = toLL( fix.X, fix.Y );
			const dist = Math.max( 3, Math.hypot( ( cam[ 0 ] - target[ 0 ] ) * 71500, ( cam[ 1 ] - target[ 1 ] ) * 111200 ) );
			const span = spots.length > 1 ? f.len / 2 : f.len;
			const fov = Math.max( 60, Math.min( 110, 2 * Math.atan( span / 2 / dist ) * 180 / Math.PI + 20 ) ).toFixed( 0 );
			const pitch = Math.min( 30, Math.atan2( 5, dist ) * 180 / Math.PI ).toFixed( 1 );
			if ( ! cached ) {

				const res = await fetch( `https://maps.googleapis.com/maps/api/streetview?size=640x640&pano=${meta.pano_id}&heading=${bearing( cam, target ).toFixed( 1 )}&pitch=${pitch}&fov=${fov}&key=${KEY}` );
				images ++;
				if ( ! res.ok ) continue;
				await writeFile( path.join( PHOTOS, file ), Buffer.from( await res.arrayBuffer() ) );

			}
			f.photos.push( file );
			const [ x, z ] = local( fix.X, fix.Y );
			const view = { file, x: + x.toFixed( 2 ), z: + z.toFixed( 2 ), reported: local( ...reported ).map( v => + v.toFixed( 2 ) ), yaw: + ( - bearing( cam, target ) * Math.PI / 180 ).toFixed( 4 ), pitch: + pitch, fov: + fov, source: 'Street View', date: meta.date || null };
			f.views.push( view );
			await writeFile( viewPath, JSON.stringify( view ) );

		}

		delete f.a;
		delete f.b;
		delete f.n;

	}

	// The owner's own photos for this square, if any are in the photos folder under the square's name.
	const own = existsSync( path.join( PHOTOS, name ) ) ? readdirSync( path.join( PHOTOS, name ) ).filter( f => /\.(jpe?g|png|webp)$/i.test( f ) ).map( f => path.join( PHOTOS, name, f ) ) : [];
	const manifestPath = path.join( OWNER_PHOTOS, 'manifest.json' );
	const ownerEntries = existsSync( manifestPath ) ? JSON.parse( await readFile( manifestPath ) ).filter( p => p.square === name && p.keep && existsSync( path.join( OWNER_PHOTOS, p.file ) ) ) : [];
	const ownerPhotos = ownerEntries.map( p => path.join( OWNER_PHOTOS, p.file ) );
	const ownerPhotoMeta = ownerEntries.map( p => ( { file: path.join( OWNER_PHOTOS, p.file ), x: p.x, z: p.z, yaw: - p.heading * Math.PI / 180, taken: p.taken, what: p.what, textureCandidate: p.textureCandidate } ) );
	await writeFile( path.join( WORK, 'inventory.json' ), JSON.stringify( { square: name, box, photosDir: PHOTOS, ownPhotos: [ ...own, ...ownerPhotos ], ownerPhotoMeta, fronts: list }, null, 1 ) );
	console.log( `${images} Street View images fetched (≈ $${( images * 0.007 ).toFixed( 2 )} at list price), ${list.filter( f => f.photos.length ).length}/${list.length} fronts with photos, ${own.length + ownerPhotos.length} own photos` );
	console.log( `next: read the photos as docs/review-brief.md says, write ${path.join( WORK, 'review.json' )}, then: npm run square -- merge ${name}` );

}

// ---------------------------------------------------------------------------------------------------------------

async function merge() {

	const HP = path.join( ROOT, 'data/houses.json' ), SG = path.join( ROOT, 'data/signs.json' );
	const H = JSON.parse( await readFile( HP ) ), S = JSON.parse( await readFile( SG ) );
	const R = JSON.parse( await readFile( path.join( WORK, 'review.json' ) ) );
	const inv = JSON.parse( await readFile( path.join( WORK, 'inventory.json' ) ) );
	if ( inv.square !== name ) throw new Error( `inventory is for ${inv.square}, not ${name}` );
	let errors = validateReview( R, inv );
	// A bad sign is left out with a warning instead of failing the whole tile (one wrong sign kind cost a run).
	const badSigns = new Set( errors.map( e => /^signs\[(\d+)\]/.exec( e )?.[ 1 ] ).filter( Boolean ).map( Number ) );
	if ( badSigns.size ) {

		for ( const e of errors.filter( e => /^signs\[/.test( e ) ) ) console.log( `warning, sign left out: ${e}` );
		R.signs = ( R.signs || [] ).filter( ( _, i ) => ! badSigns.has( i ) );
		errors = validateReview( R, inv );

	}

	const protect = new Set( ( opt( 'protect' ) || '' ).split( ',' ).filter( Boolean ) );
	const frontMap = new Map( inv.fronts.map( f => [ f.front, f ] ) );
	const svgFiles = [];
	for ( const [ code, h ] of Object.entries( R.houses || {} ) ) {

		for ( const [ edge, e ] of Object.entries( h.edges || {} ) ) {

			if ( ! e.shopfront || protect.has( code ) ) continue;
			const front = frontMap.get( `${code}_${edge}` );
			if ( ! front ) continue;
			const src = path.join( WORK, 'fronts', e.shopfront );
			if ( ! existsSync( src ) ) { errors.push( `${e.shopfront}: missing from ${path.join( WORK, 'fronts' )}` ); continue; }
			const svg = await readFile( src, 'utf8' );
			errors.push( ...validateShopfrontSvg( svg, front ).map( issue => `${e.shopfront}: ${issue}` ) );
			svgFiles.push( { src, dst: path.join( ROOT, 'data/fronts', e.shopfront ) } );

		}

	}
	if ( errors.length ) throw new Error( `review rejected before merge:\n  ${errors.join( '\n  ' )}` );
	let houses = 0, signs = 0, groundFloors = 0, balconies = 0;
	const lowConfidence = [], protectedHouses = [];
	const reviewedFronts = new Set();

	for ( const [ code, h ] of Object.entries( R.houses || {} ) ) {

		if ( protect.has( code ) ) { protectedHouses.push( code ); continue; }
		for ( const front of h.fronts ) reviewedFronts.add( front );

		const e = { ...( H[ code ] || {} ) };
		e.note = h.note;
		if ( h.confidence !== 'low' ) {

			for ( const field of [ 'colour', 'trim', 'floors', 'ground', 'rustic', 'grilles', 'graffiti', 'style', 'roof' ] ) if ( h[ field ] !== undefined ) e[ field ] = h[ field ];

		} else lowConfidence.push( code );

		if ( h.edges ) {

			e.edges = { ...( e.edges || {} ) };
			for ( const [ k, v ] of Object.entries( h.edges ) ) {

				e.edges[ k ] = { ...( e.edges[ k ] || {} ), ...v };
				delete e.edges[ k ].photoPatches;
				if ( v.ground ) groundFloors ++;
				if ( v.balconies ) balconies += v.balconies.length;

			}

		}

		if ( Object.values( h.edges || {} ).some( edge => edge.shopfront ) || ( R.signs || [] ).some( sign => h.fronts.includes( sign.front ) ) ) e.signs = false;
		H[ code ] = e;
		houses ++;

	}

	// A reviewed front's signs are replaced as a set, so a stale sign cannot linger after a correction pass.
	const updatedSigns = S.filter( s => ! reviewedFronts.has( s.front ) );
	for ( const g of R.signs || [] ) {

		if ( protect.has( g.front.split( '_' )[ 0 ] ) ) continue;
		updatedSigns.push( {
			front: g.front, fromLeft: g.fromLeft, height: g.height, kind: g.kind, text: g.text,
			...( g.sub ? { sub: g.sub } : {} ), width: g.width, ...( g.bg ? { bg: g.bg } : {} ), ink: g.ink || '#f2ead6',
			font: g.font || 'sans', street: name, what: g.what
		} );
		signs ++;

	}

	if ( svgFiles.length ) await mkdir( path.join( ROOT, 'data/fronts' ), { recursive: true } );
	for ( const file of svgFiles ) await copyFile( file.src, file.dst );
	await writeFile( HP, JSON.stringify( H, null, '\t' ) + '\n' );
	await writeFile( SG, JSON.stringify( updatedSigns, null, '\t' ) + '\n' );
	console.log( `square ${name}: merged ${houses} houses, ${groundFloors} described ground floors, ${balconies} balconies, ${svgFiles.length} drawn fronts, ${signs} signs` );
	if ( lowConfidence.length ) console.log( `low confidence (note only): ${lowConfidence.join( ', ' )}` );
	await writeFile( path.join( WORK, 'merge.json' ), JSON.stringify( { houses, signs, groundFloors, balconies, shopfronts: svgFiles.length, lowConfidence, protectedHouses, issues: R.issues || [], layoutIssues: R.layoutIssues || [] }, null, 1 ) );
	console.log( 'next: node tools/build-scene.mjs && npm run build, then look at the square' );

}
