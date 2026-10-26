// The grid app: one Node server for the admin pages, their API, the uploaded reference images, the Claude Code
// session jobs and the built game. No dependencies beyond Node 22.5+ (node:sqlite) and, for screenshots,
// the repo's Playwright.
//
// Settings come from the environment, or from <GRID_DATA>/.env (the environment wins):
//   PORT                     default 8030
//   GRID_DATA                data directory outside git (SQLite file, uploads, logs, screenshots), default ~/vinko-grid-data
//   GRID_CELL                cell size in metres, default 100 (changing it renames the cells)
//   GRID_PASSWORD            when set, every request needs HTTP Basic auth with this password (any user name)
//   GAME_PASSWORD            a second password that opens only the game (/game/, reading its settings): for friends
//   GRID_WORK                the checkout Claude Code sessions work in (a separate clone); without it, no sessions
//   GRID_BRANCH              the branch sessions start from and merge into, default the work checkout's current one
//   CLAUDE_CODE_OAUTH_TOKEN  for headless Claude Code on the owner's subscription (claude setup-token)
//   MAPILLARY_TOKEN          passed on to sessions, optional
//   CLAUDE_BIN               path to claude, default from PATH
//   GMAPS_KEY                Street View for squares (app/square.mjs); never in git or logs
//   STREETVIEW_DIR           where the Street View photos go, default <GRID_DATA>/streetview
//   SQUARE_BASE              the branch square worktrees start from, default origin/look/x0_z2
//   SQUARE_WORKTREES         where they go, default ../work next to this checkout

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile, rm, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { loadGrid, viewsOf, describe } from './grid.mjs';
import { openDB, getSettings, setSetting } from './db.mjs';
import { summary, costSince, weeklyBudget } from './stats.mjs';
import { findTranscripts, readTranscript } from './usage.mjs';
import { createJobs } from './jobs.mjs';
import { apiSpent } from './square.mjs';
import { readEnv } from './env.mjs';

const GAME_SETTINGS_KEYS = [ 'people', 'look', 'day', 'pigeon' ];
const GAME_SETTINGS_OPTIONAL = [ 'art' ]; // the art direction, from the game's studio (/game/?studio)
const DATA = process.env.GRID_DATA || join( homedir(), 'vinko-grid-data' );
mkdirSync( DATA, { recursive: true } );
const ENV = { ...readEnv( join( DATA, '.env' ) ), ...process.env };

const PORT = Number( ENV.PORT || 8030 );
const PASSWORD = ENV.GRID_PASSWORD || '', GAME_PASSWORD = ENV.GAME_PASSWORD || '';
const REPO = fileURLToPath( new URL( '../', import.meta.url ) ).replace( /\/$/, '' );
const UI = join( REPO, 'app/ui' );
const GAME = join( REPO, 'dist' );
const WORK = ENV.GRID_WORK || '';
const REFS = join( DATA, 'refs' );
const SHOTS = join( DATA, 'shots' );

mkdirSync( REFS, { recursive: true } );
mkdirSync( SHOTS, { recursive: true } );
const db = openDB( join( DATA, 'grid.sqlite' ) );
const grid = loadGrid( Number( ENV.GRID_CELL || 100 ) );

const BASE = WORK ? ENV.GRID_BRANCH || execFileSync( 'git', [ 'rev-parse', '--abbrev-ref', 'HEAD' ], { cwd: WORK } ).toString().trim() : null;
const jobs = createJobs( {
	db, grid, data: DATA, live: REPO, work: WORK, base: BASE, password: PASSWORD,
	env: Object.fromEntries( [ 'CLAUDE_CODE_OAUTH_TOKEN', 'MAPILLARY_TOKEN', 'CLAUDE_BIN', 'PATH', 'GMAPS_KEY', 'GH_TOKEN', 'ANTHROPIC_API_KEY', 'SQUARE_USE_API', 'SQUARE_API_CAP', 'SQUARE_API_PER_RUN', 'STREETVIEW_DIR', 'OWNER_PHOTOS_DIR', 'SQUARE_BASE', 'SQUARE_WORKTREES', 'SQUARE_EFFORT', 'CODEX_BIN', 'CODEX_EFFORT', 'CODEX_MODEL' ].filter( k => ENV[ k ] ).map( k => [ k, ENV[ k ] ] ) ),
	gameURL: `http://127.0.0.1:${PORT}/game/`, previewURL: `http://127.0.0.1:${PORT}/preview/`
} );

const STATUSES = [ 'todo', 'in_progress', 'review', 'done', 'failed' ];
const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
	'.woff2': 'font/woff2', '.wasm': 'application/wasm'
};
const IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const now = () => new Date().toISOString();

// Claude Code transcripts of this repo already on this machine (sessions not started from the app) are counted too.
function importTranscripts() {

	const ours = new Set( db.prepare( "SELECT claude_session FROM sessions WHERE kind = 'cell' AND claude_session IS NOT NULL" ).all().map( r => r.claude_session ) );
	for ( const t of findTranscripts() ) {

		if ( ours.has( t.id ) ) continue;
		const known = db.prepare( 'SELECT * FROM imports WHERE claude_session = ?' ).get( t.id );
		if ( known && known.mtime >= t.mtime ) continue;
		const { counter, prompt } = readTranscript( t );
		const byModel = counter.byModel();
		if ( ! Object.keys( byModel ).length ) continue;
		const [ start, end ] = counter.span();
		let id = known?.session;
		if ( id ) db.prepare( 'UPDATE sessions SET started = ?, ended = ? WHERE id = ?' ).run( start, end, id );
		else id = Number( db.prepare( "INSERT INTO sessions (kind, state, prompt, claude_session, created, started, ended, summary) VALUES ('import', 'imported', ?, ?, ?, ?, ?, ?)" )
			.run( prompt || '', t.id, start || now(), start, end, `Přepis ${t.project}` ).lastInsertRowid );
		db.prepare( 'DELETE FROM usage WHERE session = ?' ).run( id );
		for ( const [ model, u ] of Object.entries( byModel ) ) {

			db.prepare( 'INSERT INTO usage (session, model, input, output, cache_write_5m, cache_write_1h, cache_read, messages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)' )
				.run( id, model, u.input, u.output, u.cache_write_5m, u.cache_write_1h, u.cache_read, u.messages );

		}

		db.prepare( 'INSERT INTO imports (claude_session, session, mtime) VALUES (?, ?, ?) ON CONFLICT(claude_session) DO UPDATE SET mtime = excluded.mtime' ).run( t.id, id, t.mtime );

	}

}

function cellState( id ) {

	const row = db.prepare( 'SELECT status, notes, updated FROM cells WHERE id = ?' ).get( id ) || { status: 'todo', notes: '', updated: null };
	const openBugs = db.prepare( 'SELECT COUNT(*) AS n FROM bugs WHERE cell = ? AND open = 1' ).get( id ).n;
	// A cell with open bugs needs fixing, unless a session is working on it right now.
	const shown = row.status !== 'in_progress' && openBugs > 0 ? 'needs_fix' : row.status;
	return { ...row, shown, openBugs };

}

function sessionView( s, costs ) {

	const c = costs.get( s.id );
	const wb = weeklyBudget( db );
	return {
		...s, weekShare: wb && c ? c.cost / wb.budget * 100 : null,
		shots: s.shots ? JSON.parse( s.shots ) : null,
		tokens: c?.tokens || 0, cost: c?.cost || 0, usage: c || null,
		minutes: s.started ? Math.round( ( Date.parse( s.ended || now() ) - Date.parse( s.started ) ) / 60e3 ) : null
	};

}

// Street View photos fetched by square runs (metadata look-ups are free), at Google's list price.
function google() {

	const count = since => db.prepare( 'SELECT COALESCE( SUM( images_fetched ), 0 ) AS n FROM sessions WHERE COALESCE( started, created ) >= ?' ).get( since ).n;
	const today = new Date();
	today.setHours( 0, 0, 0, 0 );
	const all = count( '' ), day = count( today.toISOString() );
	return { images: all, cost: all * 0.007, today: day, todayCost: day * 0.007 };

}

function control() {

	const s = getSettings( db );
	// A run started by hand (node app/square.mjs) shows too: it writes to the same database.
	const current = jobs.current() || db.prepare( "SELECT * FROM sessions WHERE state IN ('running', 'building') AND IFNULL( reviewer, 'claude' ) <> 'codex' ORDER BY id DESC LIMIT 1" ).get();
	// The Codex lane (app/lane.mjs) is its own process; its run shows from the database.
	const codex = db.prepare( "SELECT * FROM sessions WHERE state IN ('queued', 'running', 'building') AND reviewer = 'codex' ORDER BY id DESC LIMIT 1" ).get();
	return {
		sessions: !! WORK, base: BASE, squareBase: ENV.SQUARE_BASE || 'origin/look/x0_z2',
		api: ENV.SQUARE_USE_API === '1' && ENV.ANTHROPIC_API_KEY ? { spent: apiSpent( db ), cap: Number( ENV.SQUARE_API_CAP || 70 ) } : null,
		stopped: jobs.stopped(), google: google(),
		autopilot: s.autopilot === '1', autoMerge: s.auto_merge === '1',
		pausedUntil: s.paused_until > now() ? s.paused_until : null, pausedReason: s.paused_reason || null,
		queued: db.prepare( "SELECT id, cell FROM sessions WHERE state = 'queued' ORDER BY id" ).all(),
		current: current ? { id: current.id, cell: current.cell, step: current.step, started: current.started } : null,
		modelShots: s.model_shots || null,
		codexLane: s.codex_lane === '1', codexPausedUntil: s.codex_paused_until > now() ? s.codex_paused_until : null,
		codexCurrent: codex ? { id: codex.id, cell: codex.cell, step: codex.step, started: codex.started } : null
	};

}

function gridSummary() {

	const sum = summary( db );
	const settings = getSettings( db );
	const cells = [ ...grid.cells.values() ].map( c => {

		const s = cellState( c.id );
		const refs = db.prepare( 'SELECT COUNT(*) AS n FROM refs WHERE cell = ?' ).get( c.id ).n;
		return {
			id: c.id, col: c.col, row: c.row, x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1,
			status: s.shown, openBugs: s.openBugs, buildings: c.buildings.length, described: c.buildings.filter( b => b.note ).length, refs, streets: c.streets.slice( 0, 3 ),
			usage: sum.byCell[ c.id ] || null, top: settings[ `top:${c.id}` ] || null
		};

	} );
	const count = k => cells.filter( c => c.status === k ).length;
	const workable = cells.filter( c => c.buildings ).length;
	const sessions = db.prepare( 'SELECT * FROM sessions ORDER BY id DESC LIMIT 40' ).all().map( s => sessionView( s, sum.costs ) );
	delete sum.costs;
	return {
		size: grid.size, cols: grid.cols, rows: grid.rows, bounds: grid.bounds, ortho: existsSync( join( REPO, 'data/raw/ortho.jpg' ) ),
		cells, sessions, usage: sum, control: control(),
		totals: { cells: cells.length, workable, done: count( 'done' ), inProgress: count( 'in_progress' ), needsFix: count( 'needs_fix' ), openBugs: cells.reduce( ( a, c ) => a + c.openBugs, 0 ) }
	};

}

function cellDetail( cell ) {

	const sum = summary( db );
	return {
		id: cell.id, x0: cell.x0, z0: cell.z0, x1: cell.x1, z1: cell.z1,
		bounds: grid.bounds, size: grid.size,
		buildings: cell.buildings, streets: cell.streets, venues: cell.venues,
		views: viewsOf( cell ), description: describe( cell ),
		game: existsSync( join( GAME, 'index.html' ) ),
		...cellState( cell.id ),
		bugs: db.prepare( 'SELECT * FROM bugs WHERE cell = ? ORDER BY open DESC, id DESC' ).all( cell.id ),
		refs: db.prepare( 'SELECT * FROM refs WHERE cell = ? ORDER BY id' ).all( cell.id ).map( r => ( { ...r, url: `/files/refs/${r.file}` } ) ),
		sessions: db.prepare( "SELECT * FROM sessions WHERE cell = ? ORDER BY id DESC" ).all( cell.id ).map( s => sessionView( s, sum.costs ) ),
		usage: sum.byCell[ cell.id ] || null, plan: sum.plan,
		control: control(),
		neighbours: neighbours( cell )
	};

}

function neighbours( cell ) {

	const at = ( i, j ) => [ ...grid.cells.values() ].find( c => c.col === i && c.row === j )?.id || null;
	return { n: at( cell.col, cell.row - 1 ), s: at( cell.col, cell.row + 1 ), w: at( cell.col - 1, cell.row ), e: at( cell.col + 1, cell.row ) };

}

function setCell( id, { status, notes } ) {

	const cur = db.prepare( 'SELECT status, notes FROM cells WHERE id = ?' ).get( id ) || { status: 'todo', notes: '' };
	if ( status !== undefined && ! STATUSES.includes( status ) ) throw new HttpError( 400, 'bad status' );
	db.prepare( 'INSERT INTO cells (id, status, notes, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated = excluded.updated' )
		.run( id, status ?? cur.status, notes ?? cur.notes, now() );

}

function settingsView() {

	const s = getSettings( db );
	const sum = summary( db );
	delete sum.costs;
	return {
		settings: Object.fromEntries( Object.entries( s ).filter( ( [ k ] ) => ! k.startsWith( 'top:' ) ) ),
		prices: db.prepare( 'SELECT * FROM prices ORDER BY sort, match' ).all(),
		calibrations: db.prepare( 'SELECT * FROM calibrations ORDER BY id DESC LIMIT 10' ).all(),
		usage: sum, control: control(),
		oauth: !! ENV.CLAUDE_CODE_OAUTH_TOKEN, mapillary: !! ENV.MAPILLARY_TOKEN
	};

}

const EDITABLE = [ 'cache_write_5m', 'cache_write_1h', 'plan_monthly', 'auto_merge', 'model', 'max_week_pct', 'max_per_day', 'session_minutes' ];

class HttpError extends Error {

	constructor( status, message ) {

		super( message );
		this.status = status;

	}

}

async function body( req, limit = 1e6 ) {

	const chunks = [];
	let size = 0;
	for await ( const c of req ) {

		size += c.length;
		if ( size > limit ) throw new HttpError( 413, 'too large' );
		chunks.push( c );

	}

	return Buffer.concat( chunks );

}

const json = async req => JSON.parse( ( await body( req ) ).toString( 'utf8' ) || '{}' );

function send( res, status, data ) {

	res.writeHead( status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } );
	res.end( JSON.stringify( data ) );

}

function serveFile( req, res, root, rel ) {

	const path = normalize( join( root, decodeURIComponent( rel ) ) );
	if ( path !== root && ! path.startsWith( root + sep ) ) return send( res, 403, { error: 'forbidden' } );
	let file = path;
	if ( existsSync( file ) && statSync( file ).isDirectory() ) file = join( file, 'index.html' );
	if ( ! existsSync( file ) ) return send( res, 404, { error: 'not found' } );
	const type = TYPES[ extname( file ).toLowerCase() ] || 'application/octet-stream';
	const stat = statSync( file );
	if ( type.startsWith( 'text/html' ) ) {

		res.writeHead( 200, { 'content-type': type, 'content-length': stat.size, 'cache-control': 'no-store' } );
		return createReadStream( file ).pipe( res );

	}

	// The game's data (~90 MB of geometry) shrinks to about a fifth gzipped. An ETag lets the browser keep its copy
	// until the file changes, instead of fetching everything on every visit.
	const etag = `"${stat.size.toString( 36 )}-${Math.floor( stat.mtimeMs ).toString( 36 )}"`;
	const headers = { 'content-type': type, 'cache-control': 'no-cache', etag, vary: 'accept-encoding' };
	if ( req.headers[ 'if-none-match' ] === etag ) {

		res.writeHead( 304, headers );
		return res.end();

	}

	if ( COMPRESSED.test( type ) || /\.bin$/.test( file ) ) {

		if ( /\bgzip\b/.test( req.headers[ 'accept-encoding' ] || '' ) ) {

			gzipped( file, etag ).then( body => {

				res.writeHead( 200, { ...headers, 'content-encoding': 'gzip', 'content-length': body.length } );
				res.end( body );

			}, error => send( res, 500, { error: error.message } ) );
			return;

		}

	}

	res.writeHead( 200, { ...headers, 'content-length': stat.size } );
	createReadStream( file ).pipe( res );

}

// Gzipped copies of served files, kept in memory per version (ETag) of the file.
const COMPRESSED = /^(text\/|application\/(json|javascript|octet-stream)|model\/gltf-binary|image\/svg)/;
const gzipCache = new Map();
const gzipAsync = promisify( gzip );
function gzipped( file, etag ) {

	const hit = gzipCache.get( file );
	if ( hit?.etag === etag ) return hit.body;
	const body = gzipAsync( readFileSync( file ), { level: 6 } );
	gzipCache.set( file, { etag, body } );
	body.catch( () => gzipCache.delete( file ) );
	return body;

}

// Who is asking: the owner (GRID_PASSWORD: everything), a player (GAME_PASSWORD: only the game), or nobody.
function authorised( req ) {

	if ( ! PASSWORD ) return 'full';
	const [ scheme, token ] = ( req.headers.authorization || '' ).split( ' ' );
	if ( scheme !== 'Basic' || ! token ) return false;
	const given = Buffer.from( Buffer.from( token, 'base64' ).toString( 'utf8' ).split( ':' ).slice( 1 ).join( ':' ) );
	const is = pw => {

		const want = Buffer.from( pw );
		return !! pw && given.length === want.length && timingSafeEqual( given, want );

	};

	return is( PASSWORD ) ? 'full' : is( GAME_PASSWORD ) ? 'game' : false;

}

// What the game password opens: the game itself and its settings, read-only.
const forPlayers = req => {

	const p = new URL( req.url, 'http://local' ).pathname;
	return req.method === 'GET' && ( p === '/game' || p.startsWith( '/game/' ) || p === '/api/game-settings' );

};

function needJobs() {

	if ( ! WORK ) throw new HttpError( 409, 'Sezení nejsou nastavená (GRID_WORK).' );
	return jobs;

}

// Jobs handed to the Codex CLI on this machine (<GRID_DATA>/codex-<name>/: brief.md, run.log with start and exit
// lines, log.jsonl with its events, report.md at the end, shots/): what each is doing, for the /codex page.
function codexJobs() {

	const jobs = [];
	for ( const dir of readdirSync( DATA ).filter( d => d.startsWith( 'codex-' ) ) ) {

		const at = f => join( DATA, dir, f );
		const read = f => existsSync( at( f ) ) ? readFileSync( at( f ), 'utf8' ) : '';
		const run = read( 'run.log' );
		const started = ( run.match( /^start (.+)$/m ) || [] )[ 1 ] || null;
		const exit = run.match( /^exit (\d+) (.+)$/m );
		const events = [];
		let usage = null, current = null;
		for ( const raw of read( 'log.jsonl' ).split( '\n' ) ) {

			if ( ! raw.trim() ) continue;
			let e;
			try { e = JSON.parse( raw ); } catch { continue; }
			const it = e.item || {};
			if ( e.type === 'turn.completed' ) usage = e.usage || usage;
			if ( e.type === 'item.started' && it.type === 'command_execution' ) current = it.command;
			if ( e.type !== 'item.completed' ) continue;
			if ( it.type === 'command_execution' ) {

				current = null;
				events.push( { kind: 'run', text: String( it.command || '' ).replace( /^\/bin\/zsh -lc /, '' ).slice( 0, 300 ), ok: it.exit_code === 0 || it.exit_code === undefined } );

			} else if ( it.type === 'agent_message' ) events.push( { kind: 'say', text: String( it.text || '' ).slice( 0, 2000 ) } );
			else if ( it.type === 'reasoning' ) events.push( { kind: 'think', text: String( it.text || '' ).slice( 0, 400 ) } );
			else if ( it.type === 'file_change' ) events.push( { kind: 'edit', text: ( it.changes || [] ).map( c => `${c.kind || ''} ${c.path || ''}` ).join( ', ' ).slice( 0, 400 ) } );
			else if ( it.type === 'todo_list' ) events.push( { kind: 'todo', text: ( it.items || [] ).map( t => `${t.completed ? '✔' : '○'} ${t.text}` ).join( '\n' ).slice( 0, 1500 ) } );

		}

		const shots = existsSync( at( 'shots' ) ) ? readdirSync( at( 'shots' ) ).filter( f => /\.(png|jpe?g)$/i.test( f ) ).map( f => ( { f, t: statSync( join( at( 'shots' ), f ) ).mtimeMs } ) ).sort( ( a, b ) => b.t - a.t ).map( x => `/files/codex/${dir}/shots/${encodeURIComponent( x.f )}` ) : [];
		const log = existsSync( at( 'log.jsonl' ) ) ? statSync( at( 'log.jsonl' ) ).mtimeMs : null;
		jobs.push( {
			name: dir.slice( 6 ), title: ( read( 'brief.md' ).match( /^# (.+)$/m ) || [] )[ 1 ] || dir,
			started, ended: exit ? exit[ 2 ] : null, code: exit ? Number( exit[ 1 ] ) : null, running: !! started && ! exit,
			lastActivity: log, current, usage, steps: events.length, events: events.slice( - 60 ), report: read( 'report.md' ), shots
		} );

	}

	return jobs;

}

async function route( req, res ) {

	const url = new URL( req.url, 'http://local' );
	const p = url.pathname, m = req.method;
	let r;

	if ( m === 'GET' && p === '/' ) return serveFile( req, res, UI, 'index.html' );
	if ( m === 'GET' && p === '/nastaveni' ) return serveFile( req, res, UI, 'settings.html' );
	if ( m === 'GET' && /^\/cell\/x-?\d+_z-?\d+$/.test( p ) ) return serveFile( req, res, UI, 'cell.html' );
	if ( m === 'GET' && /^\/sezeni\/\d+$/.test( p ) ) return serveFile( req, res, UI, 'session.html' );
	if ( m === 'GET' && p.startsWith( '/ui/' ) ) return serveFile( req, res, UI, p.slice( 4 ) );
	if ( m === 'GET' && p === '/ortho.jpg' ) return serveFile( req, res, join( REPO, 'data/raw' ), 'ortho.jpg' );
	if ( m === 'GET' && ( p === '/game' || p === '/preview' ) ) { res.writeHead( 301, { location: p + '/' } ); return res.end(); }
	if ( m === 'GET' && p.startsWith( '/game/' ) ) return serveFile( req, res, GAME, p.slice( 6 ) );
	if ( m === 'GET' && p.startsWith( '/preview/' ) && WORK ) return serveFile( req, res, join( WORK, 'dist' ), p.slice( 9 ) );
	if ( m === 'GET' && p.startsWith( '/files/refs/' ) ) return serveFile( req, res, REFS, p.slice( 12 ) );
	if ( m === 'GET' && p.startsWith( '/files/shots/' ) ) return serveFile( req, res, SHOTS, p.slice( 13 ) );
	if ( m === 'GET' && p === '/codex' ) return serveFile( req, res, UI, 'codex.html' );
	if ( m === 'GET' && p === '/api/codex' ) return send( res, 200, codexJobs() );
	if ( m === 'GET' && /^\/files\/codex\/codex-[\w-]+\/shots\/[^/]+$/.test( p ) ) return serveFile( req, res, DATA, decodeURIComponent( p.slice( 13 ) ) );

	if ( m === 'GET' && p === '/api/grid' ) return send( res, 200, gridSummary() );

	// The game's settings (people, look, day, the pigeon's start), edited on the game's admin page (/game/?admin), and
	// the optional art direction (art) from its studio (/game/?studio); the game loads them from here over the defaults shipped with the game. One JSON file in the data directory.
	if ( p === '/api/game-settings' ) {

		const file = join( DATA, 'game-settings.json' );
		if ( m === 'GET' ) {

			if ( ! existsSync( file ) ) return send( res, 404, { error: 'no game settings saved yet' } );
			res.writeHead( 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } );
			return res.end( readFileSync( file ) );

		}

		if ( m === 'PUT' ) {

			const text = ( await body( req, 200e3 ) ).toString( 'utf8' );
			let settings;
			try {

				settings = JSON.parse( text );

			} catch {

				throw new HttpError( 400, 'not JSON' );

			}

			if ( ! settings || typeof settings !== 'object' || Array.isArray( settings ) ) throw new HttpError( 400, 'expected a JSON object' );
			const missing = GAME_SETTINGS_KEYS.filter( k => ! settings[ k ] || typeof settings[ k ] !== 'object' || Array.isArray( settings[ k ] ) );
			if ( missing.length ) throw new HttpError( 400, `missing or not objects: ${missing.join( ', ' )}` );
			const bad = GAME_SETTINGS_OPTIONAL.filter( k => k in settings && ( ! settings[ k ] || typeof settings[ k ] !== 'object' || Array.isArray( settings[ k ] ) ) );
			if ( bad.length ) throw new HttpError( 400, `not objects: ${bad.join( ', ' )}` );
			const unknown = Object.keys( settings ).filter( k => ! GAME_SETTINGS_KEYS.includes( k ) && ! GAME_SETTINGS_OPTIONAL.includes( k ) && k !== 'version' );
			if ( unknown.length ) throw new HttpError( 400, `unknown keys: ${unknown.join( ', ' )}` );
			// Written next to the file and renamed over it, so a reader never sees half a file.
			const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
			await writeFile( tmp, JSON.stringify( settings, null, '\t' ) + '\n' );
			await rename( tmp, file );
			return send( res, 200, { ok: true } );

		}

		throw new HttpError( 405, 'GET or PUT' );

	}

	// The live console: the running session's latest events and what it has used so far, and the money totals.
	if ( m === 'GET' && p === '/api/live' ) {

		const c = control();
		const costs = summary( db ).costs;
		const cur = c.current && db.prepare( 'SELECT * FROM sessions WHERE id = ?' ).get( c.current.id );
		const last = cur || db.prepare( "SELECT * FROM sessions WHERE kind IN ('cell', 'square') ORDER BY id DESC LIMIT 1" ).get();
		const ev = last ? jobs.events( last.id ) : { events: [] };
		return send( res, 200, {
			control: c, running: !! cur,
			session: last ? { id: last.id, cell: last.cell, state: last.state, step: last.step, started: last.started, images: last.images, api_cost: last.api_cost, ...( costs.get( last.id ) ? { tokens: costs.get( last.id ).tokens, estimate: costs.get( last.id ).cost } : {} ) } : null,
			events: ev.events.slice( - 60 ),
			queued: db.prepare( "SELECT id, cell FROM sessions WHERE state = 'queued' ORDER BY id" ).all()
		} );

	}

	if ( p === '/api/settings' ) {

		if ( m === 'PUT' ) {

			const { settings = {}, prices } = await json( req );
			for ( const [ k, v ] of Object.entries( settings ) ) if ( EDITABLE.includes( k ) ) setSetting( db, k, v );
			if ( Array.isArray( prices ) ) {

				db.exec( 'DELETE FROM prices' );
				prices.filter( x => x.match?.trim() ).forEach( ( x, i ) => db.prepare( 'INSERT INTO prices (match, label, input, output, cache_read, sort) VALUES (?, ?, ?, ?, ?, ?)' )
					.run( x.match.trim(), x.label || x.match, Number( x.input ) || 0, Number( x.output ) || 0, Number( x.cache_read ) || 0, i ) );

			}

		}

		return send( res, 200, settingsView() );

	}

	// The owner types in the share of the weekly limit Claude shows them and when that week began; the app
	// compares it with what it counted over the same span.
	if ( p === '/api/calibrate' && m === 'POST' ) {

		const { pct, since } = await json( req );
		if ( ! ( pct > 0 && pct <= 100 ) ) throw new HttpError( 400, 'Procento musí být 1–100.' );
		const from = since ? new Date( since ).toISOString() : new Date( Date.now() - 7 * 24 * 3600e3 ).toISOString();
		const { cost, tokens } = costSince( db, from );
		if ( ! cost ) throw new HttpError( 400, 'Od toho data aplikace nezaznamenala žádné tokeny.' );
		db.prepare( 'INSERT INTO calibrations (at, since, pct, cost, tokens) VALUES (?, ?, ?, ?, ?)' ).run( now(), from, Number( pct ), cost, tokens );
		return send( res, 200, settingsView() );

	}

	if ( p === '/api/stop' && m === 'POST' ) {

		jobs.stopAll();
		return send( res, 200, { control: control() } );

	}

	if ( p === '/api/resume' && m === 'POST' ) {

		jobs.resume();
		return send( res, 200, { control: control() } );

	}

	if ( p === '/api/autopilot' && m === 'POST' ) {

		const { on } = await json( req );
		// The autopilot runs tile pipelines (app/square.mjs), which need no session checkout (GRID_WORK).
		setSetting( db, 'autopilot', on ? '1' : '0' );
		if ( on ) {

			setSetting( db, 'paused_until', '' );
			setSetting( db, 'paused_reason', '' );
			jobs.tick();

		}

		return send( res, 200, control() );

	}

	if ( p === '/api/codex-lane' && m === 'POST' ) {

		const { on } = await json( req );
		setSetting( db, 'codex_lane', on ? '1' : '0' );
		if ( on ) setSetting( db, 'codex_paused_until', '' );
		return send( res, 200, control() );

	}

	if ( p === '/api/model-shots' && m === 'POST' ) {

		needJobs().shootModel().catch( e => console.error( e ) );
		return send( res, 202, control() );

	}

	if ( ( r = p.match( /^\/api\/cells\/(x-?\d+_z-?\d+)(\/\w+)?$/ ) ) ) {

		const cell = grid.cells.get( r[ 1 ] );
		if ( ! cell ) throw new HttpError( 404, 'no such cell' );
		const sub = r[ 2 ];

		if ( ! sub && m === 'GET' ) return send( res, 200, cellDetail( cell ) );
		if ( ! sub && m === 'PUT' ) {

			setCell( cell.id, await json( req ) );
			return send( res, 200, cellDetail( cell ) );

		}

		if ( sub === '/prompt' && m === 'GET' ) return send( res, 200, { prompt: needJobs().defaultPrompt( cell.id ) } );

		// The street-photo pipeline for this square (app/square.mjs), queued like any session.
		if ( sub === '/square' && m === 'POST' ) {

			const { budget } = await json( req );
			const id = jobs.enqueueSquare( cell.id, Number( budget ) || 40 );
			return send( res, 200, { id, cell: cellDetail( cell ) } );

		}

		if ( sub === '/sessions' && m === 'POST' ) {

			const { prompt } = await json( req );
			const id = needJobs().enqueue( cell.id, prompt );
			return send( res, 200, { id, cell: cellDetail( cell ) } );

		}

		if ( sub === '/bugs' && m === 'POST' ) {

			const { text } = await json( req );
			if ( ! text?.trim() ) throw new HttpError( 400, 'empty bug' );
			db.prepare( 'INSERT INTO bugs (cell, text, created) VALUES (?, ?, ?)' ).run( cell.id, text.trim(), now() );
			return send( res, 200, cellDetail( cell ) );

		}

		// Reference images arrive as the raw request body (the page sends each dropped file as is).
		if ( sub === '/refs' && m === 'POST' ) {

			const type = ( req.headers[ 'content-type' ] || '' ).split( ';' )[ 0 ];
			if ( ! IMAGE[ type ] ) throw new HttpError( 415, 'images only (jpg, png, webp, gif)' );
			const buf = await body( req, 40e6 );
			mkdirSync( join( REFS, cell.id ), { recursive: true } );
			const file = `${cell.id}/${randomUUID()}${IMAGE[ type ]}`;
			await writeFile( join( REFS, file ), buf );
			const kind = [ 'streetview', 'other' ].includes( url.searchParams.get( 'kind' ) ) ? url.searchParams.get( 'kind' ) : 'streetview';
			db.prepare( 'INSERT INTO refs (cell, kind, file, caption, created) VALUES (?, ?, ?, ?, ?)' ).run( cell.id, kind, file, url.searchParams.get( 'caption' ) || '', now() );
			return send( res, 200, cellDetail( cell ) );

		}

	}

	if ( ( r = p.match( /^\/api\/sessions\/(\d+)(\/\w+)?$/ ) ) ) {

		const id = Number( r[ 1 ] ), sub = r[ 2 ];
		const s = db.prepare( 'SELECT * FROM sessions WHERE id = ?' ).get( id );
		if ( ! s ) throw new HttpError( 404, 'not found' );
		if ( ! sub && m === 'GET' ) return send( res, 200, { ...sessionView( s, summary( db ).costs ), control: control() } );
		if ( sub === '/events' && m === 'GET' ) return send( res, 200, jobs.events( id, Number( url.searchParams.get( 'after' ) || 0 ) ) );
		if ( sub === '/cancel' && m === 'POST' ) {

			jobs.cancel( id );
			return send( res, 200, { ok: true } );

		}

		if ( ( sub === '/merge' || sub === '/reject' ) && m === 'POST' ) {

			try {

				await needJobs().reviewAction( id, sub.slice( 1 ) );

			} catch ( e ) {

				throw new HttpError( 409, e.message );

			}

			return send( res, 200, { ok: true } );

		}

	}

	if ( ( r = p.match( /^\/api\/(bugs|refs)\/(\d+)$/ ) ) ) {

		const table = r[ 1 ], id = Number( r[ 2 ] );
		const row = db.prepare( `SELECT * FROM ${table} WHERE id = ?` ).get( id );
		if ( ! row ) throw new HttpError( 404, 'not found' );
		const cell = grid.cells.get( row.cell );

		if ( m === 'PATCH' ) {

			const patch = await json( req );
			if ( table === 'bugs' && 'open' in patch ) db.prepare( 'UPDATE bugs SET open = ?, fixed = ? WHERE id = ?' ).run( patch.open ? 1 : 0, patch.open ? null : now(), id );
			if ( table === 'bugs' && typeof patch.text === 'string' && patch.text.trim() ) db.prepare( 'UPDATE bugs SET text = ? WHERE id = ?' ).run( patch.text.trim(), id );
			if ( table === 'refs' && typeof patch.caption === 'string' ) db.prepare( 'UPDATE refs SET caption = ? WHERE id = ?' ).run( patch.caption, id );
			return send( res, 200, cell ? cellDetail( cell ) : {} );

		}

		if ( m === 'DELETE' ) {

			db.prepare( `DELETE FROM ${table} WHERE id = ?` ).run( id );
			if ( table === 'refs' ) await rm( join( REFS, row.file ), { force: true } );
			return send( res, 200, cell ? cellDetail( cell ) : {} );

		}

	}

	send( res, 404, { error: 'not found' } );

}

createServer( async ( req, res ) => {

	const who = authorised( req );
	if ( ! who || ( who === 'game' && ! forPlayers( req ) ) ) {

		res.writeHead( 401, { 'www-authenticate': 'Basic realm="vinko grid"' } );
		return res.end( 'Přihlaste se.' );

	}

	try {

		await route( req, res );

	} catch ( e ) {

		const status = e.status || ( e instanceof SyntaxError ? 400 : 500 );
		if ( status === 500 ) console.error( e );
		if ( ! res.headersSent ) send( res, status, { error: e.message } );

	}

} ).listen( PORT, () => {

	console.log( `grid app on http://localhost:${PORT} (${grid.cols}×${grid.rows} cells of ${grid.size} m, data in ${DATA}${WORK ? `, sessions in ${WORK} on ${BASE}` : ', no sessions'})` );
	jobs?.tick();

} );

try {

	importTranscripts();

} catch ( e ) {

	console.error( 'transcripts:', e.message );

}

setInterval( () => {

	try {

		importTranscripts();

	} catch ( e ) {

		console.error( 'transcripts:', e.message );

	}

}, 10 * 60e3 );
