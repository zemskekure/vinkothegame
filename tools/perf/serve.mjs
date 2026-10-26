// A stand-in for the grid app's game server (app/server.mjs on the look branches): serves a built game directory
// with on-the-fly gzip and ETags the way the deployed server does, so load measurements see the same bytes.
// Files under assets/ or data/ whose name carries a content hash are sent with a long max-age, as the server
// should (docs/performance.md).
//
//   node tools/perf/serve.mjs <dir> [port]

import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const [ root = 'dist', port = 4180 ] = process.argv.slice( 2 );
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.css': 'text/css', '.ktx2': 'image/ktx2' };
const COMPRESSED = /^(text\/|application\/(json|javascript|octet-stream)|model\/gltf-binary|image\/svg)/;
const cache = new Map();

createServer( ( req, res ) => {

	const rel = decodeURIComponent( new URL( req.url, 'http://x' ).pathname );
	let file = normalize( join( root, rel ) );
	if ( existsSync( file ) && statSync( file ).isDirectory() ) file = join( file, 'index.html' );
	if ( ! existsSync( file ) ) {

		res.writeHead( 404 );
		return res.end();

	}

	const type = TYPES[ extname( file ) ] || 'application/octet-stream';
	const stat = statSync( file );
	const etag = `"${stat.size.toString( 36 )}-${Math.floor( stat.mtimeMs ).toString( 36 )}"`;
	const hashed = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/.test( file );
	const headers = { 'content-type': type, 'cache-control': type.startsWith( 'text/html' ) ? 'no-store' : hashed ? 'public, max-age=31536000, immutable' : 'no-cache', etag, vary: 'accept-encoding' };
	if ( req.headers[ 'if-none-match' ] === etag ) {

		res.writeHead( 304, headers );
		return res.end();

	}

	let body = readFileSync( file );
	if ( COMPRESSED.test( type ) && /\bgzip\b/.test( req.headers[ 'accept-encoding' ] || '' ) ) {

		const hit = cache.get( file );
		if ( hit?.etag !== etag ) cache.set( file, { etag, body: gzipSync( body, { level: 6 } ) } );
		body = cache.get( file ).body;
		headers[ 'content-encoding' ] = 'gzip';

	}

	res.writeHead( 200, { ...headers, 'content-length': body.length } );
	res.end( body );

} ).listen( port, () => console.log( `serving ${root} on http://localhost:${port}/` ) );
