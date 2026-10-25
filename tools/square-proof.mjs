// Model/photo pairs from Street View and the owner's camera positions, and a collision check along openings.
// Usage: node tools/square-proof.mjs x-1_z3 --url http://127.0.0.1:4173/ [--out .square/x-1_z3/proof]
// Photos and proof output stay outside git. Never copy Street View imagery into the repository.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.dirname( path.dirname( fileURLToPath( import.meta.url ) ) );
const [ square, ...args ] = process.argv.slice( 2 );
const option = key => { const i = args.indexOf( `--${key}` ); return i >= 0 ? args[ i + 1 ] : undefined; };
if ( ! /^x-?\d+_z-?\d+$/.test( square || '' ) || ! option( 'url' ) ) {

	console.error( 'Usage: node tools/square-proof.mjs x<i>_z<j> --url http://127.0.0.1:4173/ [--out directory]' );
	process.exit( 1 );

}

const work = process.env.SQUARE_WORK || path.join( ROOT, '.square', square );
const out = option( 'out' ) || path.join( work, 'proof' );
const inventory = JSON.parse( await readFile( path.join( work, 'inventory.json' ) ) );
const scene = JSON.parse( await readFile( path.join( ROOT, 'public/data/scene.json' ) ) );
const baseURL = new URL( option( 'url' ) );
const [ gx, gz ] = square.match( /^x(-?\d+)_z(-?\d+)$/ ).slice( 1 ).map( Number );
const box = { x0: gx * 100, x1: gx * 100 + 100, z0: gz * 100, z1: gz * 100 + 100 };
const openings = ( scene.places?.openings || [] ).filter( o => o.x >= box.x0 && o.x < box.x1 && o.z >= box.z0 && o.z < box.z1 && [ 'passage', 'arcade' ].includes( o.kind ) );
const photos = [
	...inventory.fronts.flatMap( f => ( f.views || [] ).map( v => ( { ...v, file: path.join( inventory.photosDir, v.file ), what: `${f.street || f.front} (${f.front})`, taken: v.date, source: 'Street View' } ) ) ),
	...( args.includes( '--include-owner' ) ? ( inventory.ownerPhotoMeta || [] ).map( p => ( { ...p, source: 'Owner photo' } ) ) : [] )
].filter( p => Number.isFinite( p.x ) && Number.isFinite( p.z ) && Number.isFinite( p.yaw ) );
const only = option( 'only' )?.split( ',' ).map( Number );
const selected = only ? photos.filter( ( _, i ) => only.includes( i + 1 ) ) : photos;
const escape = s => String( s ).replace( /[&<>"']/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
await mkdir( out, { recursive: true } );

const browser = await chromium.launch( { args: [ '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader' ] } );
const pairs = [];
let walks = [];
try {

	const page = await browser.newPage( { viewport: { width: 800, height: 800 } } );
	const first = selected[ 0 ] || { x: ( box.x0 + box.x1 ) / 2, z: ( box.z0 + box.z1 ) / 2, yaw: 0 };
	baseURL.search = new URLSearchParams( { webgl: '', at: `${first.x},${first.z},${first.yaw}` } ).toString();
	await page.goto( baseURL.toString(), { timeout: 120000 } );
	await page.waitForFunction( () => window.__ready && window.__debug?.isBlocked, null, { timeout: 240000 } );
	await page.addStyleTag( { content: 'body > *:not(canvas) { display: none !important; }' } );
	await page.evaluate( () => window.__debug.walker.setFirstPerson( true ) );
	walks = await page.evaluate( list => {

		const { isBlocked, walker, groundHeight } = window.__debug;
		return list.map( o => {

			const samples = [];
			// Stay inside the mapped opening; its end walls may rightly block just beyond it.
			for ( let d = - o.len / 2 + 0.5; d <= o.len / 2 - 0.5 + 0.001; d += 0.25 ) {

				let clear = false;
				for ( const side of [ 0, - Math.min( o.w / 4, 0.5 ), Math.min( o.w / 4, 0.5 ) ] ) {

					const x = o.x + o.lx * d - o.lz * side, z = o.z + o.lz * d + o.lx * side;
					walker.y = Number.isFinite( o.y0 ) ? o.y0 + ( ( d + o.len / 2 ) / o.len ) * ( ( o.y1 ?? o.y0 ) - o.y0 ) : groundHeight( x, z );
					if ( ! isBlocked( x, z ) ) { clear = true; break; }

				}
				if ( ! clear ) samples.push( + d.toFixed( 2 ) );

			}
			const walk = dir => {

				const from = dir > 0 ? - o.len / 2 + 0.8 : o.len / 2 - 0.8;
				const goal = - from;
				const x = o.x + o.lx * from, z = o.z + o.lz * from;
				walker.pos.set( x, groundHeight( x, z ), z );
				walker.y = walker.pos.y;
				walker.yaw = Math.atan2( - o.lx * dir, - o.lz * dir );
				walker.keys.add( 'KeyW' );
				let progress = from;
				for ( let i = 0; i < Math.ceil( ( o.len / 1.7 + 4 ) * 30 ); i ++ ) {

					walker.update( 1 / 30 );
					progress = ( walker.pos.x - o.x ) * o.lx + ( walker.pos.z - o.z ) * o.lz;
					if ( ( progress - goal ) * dir >= - 0.35 ) break;

				}
				walker.keys.delete( 'KeyW' );
				return { reached: ( progress - goal ) * dir >= - 0.35, stoppedAt: + progress.toFixed( 2 ) };

			};
			const forward = walk( 1 ), reverse = walk( - 1 );
			return { kind: o.kind, x: o.x, z: o.z, len: o.len, width: o.w, clear: samples.length === 0 && forward.reached && reverse.reached, blockedAt: samples.slice( 0, 12 ), forward, reverse };

		} );

	}, openings );
	for ( const [ i, p ] of selected.entries() ) {

		const pose = await page.evaluate( q => {

			const { walker, camera, groundHeight, isBlocked } = window.__debug;
			walker.pos.set( q.x, groundHeight( q.x, q.z ), q.z );
			walker.y = walker.pos.y;
			walker.yaw = q.yaw;
			walker.pitch = - ( q.pitch || 0 ) * Math.PI / 180;
			camera.fov = q.fov || 60;
			camera.updateProjectionMatrix();
			walker.apply( 0 );
			return { blocked: isBlocked( q.x, q.z ), cameraX: camera.position.x, cameraZ: camera.position.z };

		}, p );
		await page.waitForTimeout( 1800 );
		const model = `${String( i + 1 ).padStart( 2, '0' )}-model.jpg`;
		const reference = `${String( i + 1 ).padStart( 2, '0' )}-reference${path.extname( p.file ).toLowerCase()}`;
		await page.screenshot( { path: path.join( out, model ), type: 'jpeg', quality: 86, timeout: 180000 } );
		await copyFile( p.file, path.join( out, reference ) );
		pairs.push( { reference, model, source: p.source, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch || 0, fov: p.fov || 60, pose, taken: p.taken, what: p.what } );
		console.log( `pair ${i + 1}/${selected.length}: ${p.what || path.basename( p.file )}` );

	}

} finally {

	await browser.close();

}

const report = { square, generated: new Date().toISOString(), photos: pairs.length, ownerReferences: ( inventory.ownerPhotoMeta || [] ).length, blockedCameraPoints: pairs.filter( p => p.pose.blocked ).length, openings: walks.length, clear: walks.filter( w => w.clear ).length, walks, pairs };
await writeFile( path.join( out, 'proof.json' ), JSON.stringify( report, null, '\t' ) + '\n' );
const rows = pairs.map( p => `<article><h2>${escape( p.what || p.reference )}</h2><p>${escape( p.source )} · ${escape( p.taken || '' )} · (${p.x.toFixed( 1 )}, ${p.z.toFixed( 1 )}) · yaw ${p.yaw.toFixed( 2)}, pitch ${p.pitch.toFixed( 1)}°, FOV ${p.fov}°${p.pose.blocked ? ' · camera point marked blocked' : ''}</p><div class="pair"><figure><img src="${escape( p.reference )}"><figcaption>${escape( p.source )}</figcaption></figure><figure><img src="${escape( p.model )}"><figcaption>Model from the same position, heading, pitch and field of view</figcaption></figure></div></article>` ).join( '\n' );
const walkRows = walks.map( w => `<tr><td>${escape( w.kind )}</td><td>${w.x.toFixed( 1 )}, ${w.z.toFixed( 1 )}</td><td>${w.len.toFixed( 1 )} m</td><td class="${w.clear ? 'ok' : 'bad'}">${w.clear ? 'clear both ways' : `blocked samples: ${escape( w.blockedAt.join( ', ' ) || 'none' )}; forward ${w.forward.reached ? 'ok' : w.forward.stoppedAt}; reverse ${w.reverse.reached ? 'ok' : w.reverse.stoppedAt}`}</td></tr>` ).join( '\n' );
await writeFile( path.join( out, 'index.html' ), `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape( square )} model/photo proof</title><style>body{font:16px/1.45 system-ui;background:#15191d;color:#f2f0e9;max-width:1500px;margin:auto;padding:24px}h1,h2{line-height:1.15}article{border-top:1px solid #576067;padding:20px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{width:100%;max-height:650px;object-fit:contain;background:#30363c}figcaption,p{color:#bec7c9}table{border-collapse:collapse;width:100%}td,th{padding:7px;border-bottom:1px solid #576067;text-align:left}.ok{color:#94dea5}.bad{color:#ff9b8a}</style><h1>${escape( square )}: model/photo proof</h1><p>${pairs.length} Street View pairs; ${report.blockedCameraPoints} camera points collide with model geometry and need inspection. ${report.ownerReferences} owner photos are supplementary references; their GPS positions are not used for same-camera proof unless --include-owner is requested. ${walks.filter( w => w.clear ).length}/${walks.length} mapped passages and arcades clear in the collision test. A clear collision path still needs visual review.</p><h2>Walk checks</h2><table><tr><th>Kind</th><th>Centre</th><th>Length</th><th>Result</th></tr>${walkRows}</table>${rows}</html>` );
console.log( `${square}: ${pairs.length} photo pairs, ${report.clear}/${walks.length} openings clear; ${path.join( out, 'index.html' )}` );
