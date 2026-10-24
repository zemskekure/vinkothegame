// One grid square through the street-photo pipeline of tools/square.mjs, end to end, in its own git worktree:
// prepare (inventory + Street View photos), a headless Claude Code reviewer following docs/review-brief.md, the
// checked merge into data/houses.json and data/signs.json, a rebuild, screenshots, and a pull request with only
// the data files and the built scene in it. The session's row in the app's database follows it all (state,
// step, tokens, screenshots, the pull request), so the square shows on the map while it runs.
//
//   node app/square.mjs x0_z1 [--budget 40]      run one square by hand (the app's queue calls runSquare too)
//
// Settings as for the app (environment or <GRID_DATA>/.env): GMAPS_KEY, STREETVIEW_DIR (default
// <GRID_DATA>/streetview), SQUARE_BASE (the branch squares start from, default origin/main), SQUARE_WORKTREES
// (default ../work next to this checkout), CLAUDE_BIN. Street View images stay outside git, always.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageCounter } from './usage.mjs';
import { getSettings } from './db.mjs';
import { viewsOf, SQUARE } from './grid.mjs';
import { summary } from './stats.mjs';

const now = () => new Date().toISOString();

// Local time as YYYYMMDD-HHMM, for branch names.
function stamp() {

	const d = new Date(), p = n => String( n ).padStart( 2, '0' );
	return `${d.getFullYear()}${p( d.getMonth() + 1 )}${p( d.getDate() )}-${p( d.getHours() )}${p( d.getMinutes() )}`;

}

export const reviewPrompt = ( square, work ) => `Follow docs/review-brief.md for square ${square}. The inventory is at ${work}/inventory.json. Write ${work}/review.json. Do not edit the repository.`;

// Runs one square for an existing session row; resolves when the session has ended (state set on the row).
export async function runSquare( { db, grid, data, live, env, id, budget = 40, setStatus, onChild = () => {}, cancelled = () => false } ) {

	const s = db.prepare( 'SELECT * FROM sessions WHERE id = ?' ).get( id );
	const square = s.cell, cell = grid.cells.get( square );
	if ( ! SQUARE.test( square ) || ! cell ) throw new Error( `no such square ${square}` );

	const logs = join( data, 'sessions' ), shotsDir = join( data, 'shots', String( id ) );
	mkdirSync( logs, { recursive: true } );
	mkdirSync( shotsDir, { recursive: true } );
	const base = env.SQUARE_BASE || 'origin/main';
	const tree = join( env.SQUARE_WORKTREES || join( dirname( live ), 'work' ), square );
	const work = join( data, 'squares', square ), photos = env.STREETVIEW_DIR || join( data, 'streetview' );
	const branch = `cell/${square}-${stamp()}`;
	const started = Date.now();

	const update = fields => {

		const keys = Object.keys( fields );
		db.prepare( `UPDATE sessions SET ${keys.map( k => `${k} = ?` ).join( ', ' )} WHERE id = ?` ).run( ...keys.map( k => fields[ k ] ?? null ), id );

	};

	const logLine = obj => {

		const out = createWriteStream( join( logs, `${id}.log` ), { flags: 'a' } );
		out.end( JSON.stringify( { ...obj, at: now() } ) + '\n' );

	};

	// The key is never written to a log, even when a command echoes it back.
	const secret = env.GMAPS_KEY || '';
	const clean = t => secret ? String( t ).split( secret ).join( '<GMAPS_KEY>' ) : String( t );
	const note = text => {

		logLine( { type: 'app', text: clean( text ) } );
		if ( env.SQUARE_ECHO ) console.log( clean( text ) );

	};

	const childEnv = extra => {

		// A Claude Code session started from inside another one would otherwise think it is nested.
		const e = { ...process.env, ...env, SQUARE_WORK: work, STREETVIEW_DIR: photos, ...extra };
		for ( const k of Object.keys( e ) ) if ( k.startsWith( 'CLAUDECODE' ) || k === 'CLAUDE_CODE_ENTRYPOINT' ) delete e[ k ];
		return e;

	};

	const run = ( cmd, args, { cwd = tree, quiet = false, extra } = {} ) => new Promise( resolve => {

		const child = spawn( cmd, args, { cwd, env: childEnv( extra ) } );
		onChild( child );
		let out = '';
		const take = d => {

			out += d;
			if ( ! quiet ) for ( const line of String( d ).split( '\n' ) ) if ( line.trim() ) note( line.slice( 0, 400 ) );

		};

		child.stdout.on( 'data', take );
		child.stderr.on( 'data', take );
		child.on( 'error', e => resolve( { code: - 1, out: out + e.message } ) );
		child.on( 'close', code => resolve( { code, out } ) );

	} );

	const git = ( args, cwd = tree ) => run( 'git', args, { cwd, quiet: true } );
	const step = name => {

		update( { step: name } );
		note( `— ${name}` );

	};

	const fail = error => {

		update( { state: cancelled() ? 'cancelled' : 'failed', error: clean( error ), ended: now(), step: null } );
		note( `✗ ${error}` );
		setStatus( square, 'failed' );
		return false;

	};

	update( { state: 'running', started: now(), branch, step: 'příprava', pid: process.pid } );
	setStatus( square, 'in_progress' );

	// A fresh worktree off the base branch. A leftover worktree of an earlier run is removed only when it is clean
	// (its branch is pushed); anything else stops here for the owner to look at.
	step( 'worktree' );
	await git( [ 'fetch', '--quiet', 'origin' ], live );
	if ( existsSync( tree ) ) {

		const dirty = ( await git( [ 'status', '--porcelain' ] ) ).out.trim();
		if ( dirty ) return fail( `${tree} exists with uncommitted changes; look at it first` );
		const rm = await git( [ 'worktree', 'remove', tree ], live );
		if ( rm.code ) return fail( `git worktree remove: ${rm.out.trim()}` );

	}

	const add = await git( [ 'worktree', 'add', '-b', branch, tree, base ], live );
	if ( add.code ) return fail( `git worktree add: ${add.out.trim()}` );
	// The installed packages and the raw data (both gitignored) are shared with the live checkout.
	for ( const p of [ 'node_modules', 'data/raw' ] ) if ( ! existsSync( join( tree, p ) ) ) symlinkSync( join( live, p ), join( tree, p ) );
	const head = ( await git( [ 'rev-parse', 'HEAD' ] ) ).out.trim();

	// Prepare: the inventory and the photos. A review left by an earlier run is kept aside, not reused.
	step( 'prepare' );
	mkdirSync( work, { recursive: true } );
	for ( const f of [ 'review.json', 'merge.json' ] ) {

		const p = join( work, f );
		if ( existsSync( p ) ) renameSync( p, join( work, f.replace( '.json', `-${Math.round( statSync( p ).mtimeMs )}.json` ) ) );

	}

	const prep = await run( 'npm', [ 'run', 'square', '--', 'prepare', square, '--budget', String( budget ) ] );
	if ( prep.code ) return fail( 'npm run square -- prepare failed' );
	const fetched = Number( ( prep.out.match( /(\d+) Street View images fetched/ ) || [] )[ 1 ] || 0 );
	const inventory = JSON.parse( readFileSync( join( work, 'inventory.json' ), 'utf8' ) );
	const used = inventory.fronts.reduce( ( a, f ) => a + ( f.photos?.length || 0 ), 0 ) + inventory.ownPhotos.length;
	update( { images: used, images_fetched: fetched } );
	if ( ! used ) return fail( 'no photos for this square (GMAPS_KEY missing or no Street View coverage)' );

	// The reviewer: headless Claude Code, reading only, writing one file outside the repository.
	step( 'review' );
	const settings = getSettings( db );
	const args = [ '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
		'--add-dir', work, '--add-dir', photos, '--allowedTools', 'Read Write Glob Grep Task', '--disallowedTools', 'Edit Bash NotebookEdit WebFetch WebSearch' ];
	if ( settings.model ) args.push( '--model', settings.model );
	const result = await claude( args, reviewPrompt( square, work ), Number( settings.session_minutes || 60 ) * 60e3 );
	if ( cancelled() ) return fail( 'Zastaveno ručně.' );
	const transcript = countTranscript( result?.session_id );
	if ( transcript ) saveUsage( db, id, transcript );
	update( { claude_session: result?.session_id || null, summary: ( result?.result || '' ).trim() } );
	if ( ! result || result.is_error ) return fail( result?.result || 'Claude skončil bez výsledku.' );

	// "Do not edit the repository" is checked, not trusted.
	const touched = ( await git( [ 'status', '--porcelain' ] ) ).out.trim();
	if ( touched ) return fail( `the reviewer changed the repository:\n${touched}` );
	if ( ! existsSync( join( work, 'review.json' ) ) ) return fail( 'no review.json written' );

	step( 'merge' );
	const mg = await run( 'npm', [ 'run', 'square', '--', 'merge', square ] );
	if ( mg.code ) return fail( 'npm run square -- merge failed (review.json invalid?)' );
	const merged = JSON.parse( readFileSync( join( work, 'merge.json' ), 'utf8' ) );
	const review = JSON.parse( readFileSync( join( work, 'review.json' ), 'utf8' ) );

	step( 'build' );
	if ( ( await run( 'node', [ 'tools/build-scene.mjs' ] ) ).code ) return fail( 'tools/build-scene.mjs failed' );
	const vb = await run( 'npx', [ 'vite', 'build' ], { quiet: true } );
	if ( vb.code ) return fail( `vite build failed:\n${vb.out.slice( - 1500 )}` );

	step( 'screenshots' );
	const shots = await screenshots( { tree, cell, inventory, dir: shotsDir, id, run, note } );
	update( { shots: JSON.stringify( { after: shots } ) } );

	// Only the data and the built scene go into the commit.
	step( 'commit' );
	await git( [ 'add', '--', 'data/houses.json', 'data/signs.json', 'public/data' ] );
	const staged = ( await git( [ 'diff', '--cached', '--name-only' ] ) ).out.trim();
	if ( ! staged ) {

		update( { state: 'empty', ended: now(), step: null } );
		note( 'Beze změn.' );
		setStatus( square, 'todo' );
		return true;

	}

	const title = `Square ${square}: ${merged.houses} houses and ${merged.signs} signs from street photos`;
	const cm = await run( 'git', [ 'commit', '-m', title ], { quiet: true } );
	if ( cm.code ) return fail( `git commit: ${cm.out.trim()}` );
	update( {
		commits: ( await git( [ 'log', '--format=%h\t%s', `${head}..HEAD` ] ) ).out.trim(),
		diffstat: ( await git( [ 'diff', '--stat=100', `${head}..HEAD` ] ) ).out.trim().split( '\n' ).slice( - 25 ).join( '\n' )
	} );

	step( 'pull request' );
	const push = await git( [ 'push', '-u', 'origin', branch ] );
	if ( push.code ) return fail( `git push: ${push.out.trim()}` );
	const usage = summaryOf( db, id );
	const body = prBody( { square, cell, merged, review, inventory, fetched, used, usage, minutes: ( Date.now() - started ) / 60e3, shots, id } );
	const pr = await run( 'gh', [ 'pr', 'create', '--base', base.replace( /^origin\//, '' ), '--head', branch, '--title', title, '--body', body ], { quiet: true } );
	const link = ( pr.out.match( /https:\/\/github\.com\/\S+\/pull\/\d+/ ) || [] )[ 0 ];
	if ( ! link ) return fail( `gh pr create: ${pr.out.trim()}` );
	update( { pr: link, state: 'review', ended: now(), step: null } );
	note( `PR ${link}` );
	setStatus( square, 'review' );
	return true;

	// Runs claude, following its stream-json output into the session log; resolves with the result event.
	function claude( args, prompt, timeout ) {

		return new Promise( resolve => {

			const child = spawn( env.CLAUDE_BIN || 'claude', args, { cwd: tree, env: childEnv() } );
			onChild( child );
			const counter = new UsageCounter();
			const log = createWriteStream( join( logs, `${id}.log` ), { flags: 'a' } );
			let result = null, buf = '';
			const timer = setInterval( () => saveUsage( db, id, counter ), 5000 );
			const killer = setTimeout( () => {

				note( `Časový limit ${Math.round( timeout / 60e3 )} min, ukončuji.` );
				child.kill( 'SIGTERM' );

			}, timeout );

			child.stdout.on( 'data', d => {

				buf += d;
				let nl;
				while ( ( nl = buf.indexOf( '\n' ) ) >= 0 ) {

					const raw = buf.slice( 0, nl );
					buf = buf.slice( nl + 1 );
					if ( ! raw.trim() ) continue;
					log.write( clean( raw ) + '\n' );
					try {

						const line = JSON.parse( raw );
						if ( line.type === 'system' && line.session_id ) update( { claude_session: line.session_id } );
						counter.add( line );
						if ( line.type === 'result' ) result = line;

					} catch {}

				}

			} );

			child.stderr.on( 'data', d => log.write( JSON.stringify( { type: 'app', text: clean( d ).slice( 0, 1000 ), at: now() } ) + '\n' ) );
			child.stdin.end( prompt );
			const done = () => {

				clearInterval( timer );
				clearTimeout( killer );
				saveUsage( db, id, counter );
				log.end();
				resolve( result );

			};

			child.on( 'error', e => {

				result = { is_error: true, result: `claude se nespustil: ${e.message}` };
				done();

			} );
			child.on( 'close', done );

		} );

	}

}

// The session's own transcript and its subagents' (~/.claude/projects/<dir>/<session>.jsonl and
// <session>/subagents/*.jsonl): the full count, including what the stream doesn't show.
function countTranscript( session ) {

	if ( ! session ) return null;
	const root = join( homedir(), '.claude/projects' );
	if ( ! existsSync( root ) ) return null;
	for ( const dir of readdirSync( root ) ) {

		const main = join( root, dir, `${session}.jsonl` );
		if ( ! existsSync( main ) ) continue;
		const files = [ main ];
		const sub = join( root, dir, session, 'subagents' );
		if ( existsSync( sub ) ) for ( const f of readdirSync( sub ) ) if ( f.endsWith( '.jsonl' ) ) files.push( join( sub, f ) );
		const counter = new UsageCounter();
		for ( const f of files ) for ( const raw of readFileSync( f, 'utf8' ).split( '\n' ) ) {

			try {

				if ( raw ) counter.add( JSON.parse( raw ) );

			} catch {}

		}

		counter.files = files.length;
		return counter;

	}

	return null;

}

function saveUsage( db, id, counter ) {

	db.prepare( 'DELETE FROM usage WHERE session = ?' ).run( id );
	for ( const [ model, u ] of Object.entries( counter.byModel() ) ) {

		db.prepare( 'INSERT INTO usage (session, model, input, output, cache_write_5m, cache_write_1h, cache_read, messages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)' )
			.run( id, model, u.input, u.output, u.cache_write_5m, u.cache_write_1h, u.cache_read, u.messages );

	}

}

// Tokens, API-equivalent cost and its share of the plan and of the weekly limit (when calibrated).
export function summaryOf( db, id ) {

	const sum = summary( db );
	const c = sum.costs.get( id ) || { tokens: 0, cost: 0, input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, messages: 0 };
	const week = sum.budget ? c.cost / sum.budget.budget * 100 : null;
	return { ...c, plan: sum.plan, week };

}

// Two views on foot from the square's centre along its main street (both ways) and one from above, each a fresh
// page load of the worktree's build in Playwright's Chromium (WebGL 2).
async function screenshots( { tree, cell, inventory, dir, id, run, note } ) {

	const count = {};
	for ( const f of inventory.fronts ) if ( f.street ) count[ f.street ] = ( count[ f.street ] || 0 ) + f.len;
	const main = Object.keys( count ).sort( ( a, b ) => count[ b ] - count[ a ] )[ 0 ];
	const at = cell.streetAt[ main ] || cell.street;
	const views = viewsOf( cell );
	const r = n => Math.round( n * 100 ) / 100;
	const list = [];
	if ( at ) {

		list.push( { kind: 'street', label: `${at.name || 'ulice'} →`, query: `?webgl&at=${r( at.x )},${r( at.z )},${r( at.yaw )}` } );
		list.push( { kind: 'street', label: `${at.name || 'ulice'} ←`, query: `?webgl&at=${r( at.x )},${r( at.z )},${r( at.yaw + Math.PI )}` } );

	}

	list.push( { kind: 'overview', label: 'shora', query: `?webgl&overview&view=${views.overview}` } );
	list.forEach( ( s, k ) => s.file = join( dir, `${k + 1}-${s.kind}.jpg` ) );

	const port = 4300 + ( id % 500 );
	const preview = spawn( 'npx', [ 'vite', 'preview', '--port', String( port ), '--strictPort', '--host', '127.0.0.1' ], { cwd: tree, stdio: 'ignore' } );
	try {

		const { chromium } = await import( join( tree, 'node_modules/playwright/index.mjs' ) );
		const browser = await chromium.launch( { args: [ '--ignore-gpu-blocklist' ] } );
		try {

			for ( let tries = 0; tries < 30; tries ++ ) {

				if ( await fetch( `http://127.0.0.1:${port}/` ).then( r => r.ok, () => false ) ) break;
				await new Promise( r => setTimeout( r, 1000 ) );

			}

			for ( const s of list ) {

				const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
				await page.goto( `http://127.0.0.1:${port}/${s.query}`, { timeout: 120000 } );
				await page.waitForFunction( () => window.__ready, null, { timeout: 240000 } );
				await page.addStyleTag( { content: 'body > *:not(canvas) { display: none !important; }' } );
				await page.waitForTimeout( 8000 );
				await page.screenshot( { path: s.file, type: 'jpeg', quality: 82, timeout: 180000 } );
				await page.close();
				note( `screenshot ${s.label}: ${s.query}` );

			}

		} finally {

			await browser.close();

		}

	} catch ( e ) {

		note( `Screenshoty se nepovedly: ${String( e.message ).split( '\n' )[ 0 ]}` );

	} finally {

		preview.kill();

	}

	return list.filter( s => existsSync( s.file ) ).map( s => ( { kind: s.kind, label: s.label, query: s.query, url: `/files/shots/${id}/${s.file.split( '/' ).pop()}` } ) );

}

function prBody( { square, cell, merged, review, inventory, fetched, used, usage, minutes, shots, id } ) {

	const n = v => Math.round( v ).toLocaleString( 'en' );
	const houses = Object.entries( review.houses || {} ).map( ( [ code, h ] ) => `- ${code}: ${h.note || ''}${h.confidence ? ` (${h.confidence})` : ''}` );
	const signs = ( review.signs || [] ).map( g => `- "${g.text}"${g.sub ? ` / ${g.sub}` : ''} (${g.kind}, ${g.front})` );
	return [
		`Street-photo review of grid square **${square}** (x ${cell.x0}…${cell.x1}, z ${cell.z0}…${cell.z1}; ${cell.streets.join( ', ' )}), run by the grid app (session ${id}) following docs/review-brief.md.`,
		'Only `data/houses.json`, `data/signs.json` and the rebuilt `public/data/` are in this PR.',
		`## Merged\n${merged.houses} houses, ${merged.signs} signs (${inventory.fronts.length} fronts in the inventory).`,
		merged.lowConfidence.length ? `Low confidence (note only, colours and floors left as they were): ${merged.lowConfidence.join( ', ' )}` : '',
		merged.rejected.length ? `Rejected by the merge:\n${merged.rejected.map( r => `- ${r}` ).join( '\n' )}` : 'Nothing rejected by the merge.',
		`<details><summary>Houses</summary>\n\n${houses.join( '\n' ) || '-'}\n</details>`,
		`<details><summary>Signs</summary>\n\n${signs.join( '\n' ) || '-'}\n</details>`,
		`## Reviewer's issues\n${( merged.issues || [] ).map( i => `- ${i}` ).join( '\n' ) || '-'}`,
		`## Cost\n- Tokens: ${n( usage.tokens )} (input ${n( usage.input )}, output ${n( usage.output )}, cache read ${n( usage.cache_read )}, cache write ${n( usage.cache_write_5m + usage.cache_write_1h )}; ${usage.messages} messages, main session and subagents)`
			+ `\n- API-equivalent cost: $${usage.cost.toFixed( 2 )} (${( usage.cost / usage.plan * 100 ).toFixed( 1 )} % of the $${usage.plan} monthly plan's price${usage.week != null ? `, ≈ ${usage.week.toFixed( 1 )} % of the weekly limit` : '; weekly limit not calibrated yet'})`
			+ `\n- Street View images: ${used} used, ${fetched} fetched in this run (≈ $${( fetched * 0.007 ).toFixed( 2 )} at list price); kept outside git`
			+ `\n- Time: ${Math.round( minutes )} min`,
		`## Screenshots\nIn the grid app (session ${id}): ${shots.map( s => `${s.label} \`${s.query}\`` ).join( ', ' ) || 'none'}. Not committed.`
	].filter( Boolean ).join( '\n\n' );

}

// By hand: node app/square.mjs <square> [--budget N]
if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const { openDB } = await import( './db.mjs' );
	const { loadGrid } = await import( './grid.mjs' );
	const { readEnv } = await import( './env.mjs' );
	const [ square ] = process.argv.slice( 2 );
	const b = process.argv.indexOf( '--budget' );
	const data = process.env.GRID_DATA || join( homedir(), 'vinko-grid-data' );
	const env = { ...readEnv( join( data, '.env' ) ), ...process.env, SQUARE_ECHO: '1' };
	const live = fileURLToPath( new URL( '../', import.meta.url ) ).replace( /\/$/, '' );
	const db = openDB( join( data, 'grid.sqlite' ) );
	const grid = loadGrid( 100 );
	if ( ! grid.cells.has( square ) ) {

		console.log( 'Usage: node app/square.mjs x<i>_z<j> [--budget N]' );
		process.exit( 1 );

	}

	const setStatus = ( cell, status ) => db.prepare( 'INSERT INTO cells (id, status, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated = excluded.updated' ).run( cell, status, now() );
	const { lastInsertRowid } = db.prepare( "INSERT INTO sessions (cell, kind, state, prompt, created) VALUES (?, 'square', 'queued', ?, ?)" ).run( square, reviewPrompt( square, join( data, 'squares', square ) ), now() );
	const id = Number( lastInsertRowid );
	const ok = await runSquare( { db, grid, data, live, env, id, budget: b > 0 ? Number( process.argv[ b + 1 ] ) : 40, setStatus } );
	const row = db.prepare( 'SELECT state, error, pr, images, images_fetched, started, ended FROM sessions WHERE id = ?' ).get( id );
	console.log( JSON.stringify( { session: id, ...row, usage: summaryOf( db, id ) }, ( k, v ) => k === 'models' ? undefined : v, 1 ) );
	process.exit( ok ? 0 : 1 );

}
