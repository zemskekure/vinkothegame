// One grid square through the street-photo pipeline of tools/square.mjs, end to end, in its own git worktree:
// prepare (inventory + Street View photos), a headless Claude Code reviewer following docs/review-brief.md, the
// checked merge into data/houses.json and data/signs.json, a rebuild, screenshots, and a pull request with only
// the data files and the built scene in it. The session's row in the app's database follows it all (state,
// step, tokens, screenshots, the pull request), so the square shows on the map while it runs.
//
//   node app/square.mjs x0_z1 [--budget 40]      run one square by hand (the app's queue calls runSquare too)
//
// Settings as for the app (environment or <GRID_DATA>/.env): GMAPS_KEY, STREETVIEW_DIR (default
// <GRID_DATA>/streetview), SQUARE_BASE (the branch squares start from, default origin/look/x0_z2), SQUARE_WORKTREES
// (default ../work next to this checkout), CLAUDE_BIN. Street View images stay outside git, always.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

export const reviewPrompt = ( square, work ) => `Follow docs/review-brief.md for square ${square}. The inventory is at ${work}/inventory.json. Street View is the primary reference; owner photos are supplements. Read the photos through ${work}/marked/ (front boundaries labelled <code>_<edge> and metre ticks): describe each facade under the front the marks put it on. Describe visible ground-floor openings, balconies, style, roof and signs, and draw original SVG fronts for every distinctive ground floor that the evidence supports. Match each sign's actual size, placement, colour and lettering style; a generic name board is not an acceptable substitute. Use owner photos to guide drawn details, never as raw photo overlays. Report layout problems with photo evidence; do not change geometry. Include visualIssues as an array, empty only if no mismatch is known. Write ${work}/review.json and SVGs in ${work}/fronts/. Do not edit the repository.`;

const correctionPrompt = ( square, work, proof ) => `Second pass for ${square}. Read ${work}/review-pass1.json, the model/photo pairs in ${proof}/index.html, and ${proof}/proof.json. Compare the model with Street View from the same camera positions, using owner photos as supplements. For each prominent frontage, inspect the photographed ground-floor rhythm, material, entrance and real signs beside the model. If it still looks generic, revise its SVG; do not count a text label alone as a correction. Match the game's drawn style without raw photo overlays. Correct the visual description and drawings once. Write a complete corrected ${work}/review.json, including unchanged houses and signs, and list every remaining prominent visual mismatch in visualIssues with its front and photo evidence. If none remain, write visualIssues: []. Report layout problems separately. Follow docs/review-brief.md. Do not edit the repository or try to guess geometry.`;

// Runs one square for an existing session row; resolves when the session has ended (state set on the row).
export async function runSquare( { db, grid, data, live, env, id, budget = 40, setStatus, onChild = () => {}, cancelled = () => false } ) {

	const s = db.prepare( 'SELECT * FROM sessions WHERE id = ?' ).get( id );
	const square = s.cell, cell = grid.cells.get( square );
	if ( ! SQUARE.test( square ) || ! cell ) throw new Error( `no such square ${square}` );

	const logs = join( data, 'sessions' ), shotsDir = join( data, 'shots', String( id ) );
	mkdirSync( logs, { recursive: true } );
	mkdirSync( shotsDir, { recursive: true } );
	const base = env.SQUARE_BASE || 'origin/look/x0_z2';
	const tree = join( env.SQUARE_WORKTREES || join( dirname( live ), 'work' ), square );
	const work = join( data, 'squares', square ), photos = env.STREETVIEW_DIR || join( data, 'streetview' );
	const branch = `cell/${square}-${stamp()}`;
	const started = Date.now();
	const cumulativeUsage = new UsageCounter();

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

	// Who pays for the reviewer: the subscription (CLAUDE_CODE_OAUTH_TOKEN), or with SQUARE_USE_API=1 the API key's
	// prepaid credit, capped in total by SQUARE_API_CAP dollars (default 70) and per run by SQUARE_API_PER_RUN (10).
	const useAPI = env.SQUARE_USE_API === '1' && !! env.ANTHROPIC_API_KEY;
	const childEnv = extra => {

		// A Claude Code session started from inside another one would otherwise think it is nested.
		const e = { ...process.env, ...env, SQUARE_WORK: work, STREETVIEW_DIR: photos, ...extra };
		for ( const k of Object.keys( e ) ) if ( k.startsWith( 'CLAUDECODE' ) || k === 'CLAUDE_CODE_ENTRYPOINT' ) delete e[ k ];
		if ( useAPI ) delete e.CLAUDE_CODE_OAUTH_TOKEN;
		else delete e.ANTHROPIC_API_KEY;
		return e;

	};

	const run = ( cmd, args, { cwd = tree, quiet = false, extra } = {} ) => new Promise( resolve => {

		if ( cancelled() ) return resolve( { code: - 1, out: 'cancelled' } );
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
	const streetViews = inventory.fronts.reduce( ( a, f ) => a + ( f.photos?.length || 0 ), 0 );
	const ownPhotos = inventory.ownPhotos.length;
	const used = streetViews + ownPhotos;
	update( { images: used, images_fetched: fetched } );
	if ( ! used ) return fail( 'no photos for this square (GMAPS_KEY missing or no Street View coverage)' );
	// Copies of the photos with each RÚIAN front's ends and metre ticks drawn on, so the reviewer puts every facade
	// under the right front (tools/square-marks.mjs; <work>/marked/, outside git).
	const marks = await run( 'node', [ 'tools/square-marks.mjs', square ], { quiet: true } );
	if ( marks.code ) note( 'marking the photos failed; the reviewer reads the plain photos' );

	// The reviewer: headless Claude Code, reading only, writing one file outside the repository.
	step( 'review' );
	const settings = getSettings( db );
	const args = [ '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
		'--add-dir', work, '--add-dir', photos, '--allowedTools', 'Read Write Glob Grep Task', '--disallowedTools', 'Edit Bash NotebookEdit WebFetch WebSearch' ];
	if ( env.OWNER_PHOTOS_DIR && existsSync( env.OWNER_PHOTOS_DIR ) ) args.push( '--add-dir', env.OWNER_PHOTOS_DIR );
	if ( settings.model ) args.push( '--model', settings.model );
	if ( env.SQUARE_EFFORT ) args.push( '--effort', env.SQUARE_EFFORT );
	if ( useAPI ) {

		const left = Number( env.SQUARE_API_CAP || 70 ) - apiSpent( db );
		if ( left < 1 ) return fail( `API credit for squares used up ($${apiSpent( db ).toFixed( 2 )} of $${env.SQUARE_API_CAP || 70})` );
		args.push( '--max-budget-usd', Math.min( left, Number( env.SQUARE_API_PER_RUN || 10 ) ).toFixed( 2 ) );
		note( `Platí API kredit (zbývá $${left.toFixed( 2 )})` );

	}

	const result = await claude( args, reviewPrompt( square, work ), Number( settings.session_minutes || 60 ) * 60e3 );
	if ( useAPI ) update( { api_cost: result?.total_cost_usd || 0 } );
	if ( cancelled() ) return fail( 'Zastaveno ručně.' );
	const transcript = countTranscript( result?.session_id );
	if ( transcript ) for ( const [ key, value ] of transcript.messages ) cumulativeUsage.messages.set( key, value );
	saveUsage( db, id, cumulativeUsage );
	update( { claude_session: result?.session_id || null, summary: ( result?.result || '' ).trim() } );
	if ( ! result || result.is_error ) return fail( result?.result || 'Claude skončil bez výsledku.' );

	// "Do not edit the repository" is checked, not trusted.
	const touched = ( await git( [ 'status', '--porcelain' ] ) ).out.trim();
	if ( touched ) return fail( `the reviewer changed the repository:\n${touched}` );
	if ( ! existsSync( join( work, 'review.json' ) ) ) return fail( 'no review.json written' );

	step( 'merge' );
	const mg = await run( 'npm', [ 'run', 'square', '--', 'merge', square ] );
	if ( mg.code ) return fail( 'npm run square -- merge failed (review.json invalid?)' );
	let merged = JSON.parse( readFileSync( join( work, 'merge.json' ), 'utf8' ) );
	let review = JSON.parse( readFileSync( join( work, 'review.json' ), 'utf8' ) );

	step( 'build' );
	if ( ( await run( 'node', [ 'tools/build-scene.mjs' ] ) ).code ) return fail( 'tools/build-scene.mjs failed' );
	const vb = await run( 'npm', [ 'run', 'build' ], { quiet: true } );
	if ( vb.code ) return fail( `vite build failed:\n${vb.out.slice( - 1500 )}` );

	step( 'first comparison and walk test' );
	const firstDir = join( shotsDir, 'pass1' );
	mkdirSync( firstDir, { recursive: true } );
	let first;
	try { first = await screenshots( { tree, cell, inventory, dir: firstDir, id, run, note } ); }
	catch ( e ) { return fail( `first proof failed: ${e.message}` ); }
	if ( ! first.proof.pairs.length ) return fail( 'no model/photo pairs; Street View camera metadata or owner photos are needed' );
	update( { shots: JSON.stringify( { before: first.shots, proof: first.proof } ) } );

	step( 'correction review' );
	renameSync( join( work, 'review.json' ), join( work, 'review-pass1.json' ) );
	const beforeCorrection = ( await git( [ 'status', '--porcelain' ] ) ).out.trim();
	const corrected = await claude( [ ...args, '--add-dir', firstDir ], correctionPrompt( square, work, join( firstDir, 'proof' ) ), Number( settings.session_minutes || 60 ) * 60e3 );
	if ( useAPI ) update( { api_cost: ( result?.total_cost_usd || 0 ) + ( corrected?.total_cost_usd || 0 ) } );
	if ( cancelled() ) return fail( 'Zastaveno ručně.' );
	const correctionTranscript = countTranscript( corrected?.session_id );
	if ( correctionTranscript ) for ( const [ key, value ] of correctionTranscript.messages ) cumulativeUsage.messages.set( key, value );
	saveUsage( db, id, cumulativeUsage );
	if ( ! corrected || corrected.is_error ) return fail( corrected?.result || 'Correction review failed.' );
	if ( ( await git( [ 'status', '--porcelain' ] ) ).out.trim() !== beforeCorrection ) return fail( 'the correction reviewer changed the repository' );
	if ( ! existsSync( join( work, 'review.json' ) ) ) return fail( 'correction reviewer did not write review.json' );
	// The second review is complete, so apply it to the same base as pass one. Otherwise removed descriptions
	// or drawings from the first pass would linger in houses.json or data/fronts.
	const reset = await git( [ 'restore', '--', 'data/houses.json', 'data/signs.json', 'data/fronts', 'public/data' ] );
	if ( reset.code ) return fail( `restore first pass: ${reset.out.trim()}` );
	const cleanFronts = await git( [ 'clean', '-fd', '--', 'data/fronts' ] );
	if ( cleanFronts.code ) return fail( `clean first-pass drawings: ${cleanFronts.out.trim()}` );
	step( 'merge correction' );
	if ( ( await run( 'npm', [ 'run', 'square', '--', 'merge', square ] ) ).code ) return fail( 'second merge failed' );
	merged = JSON.parse( readFileSync( join( work, 'merge.json' ), 'utf8' ) );
	review = JSON.parse( readFileSync( join( work, 'review.json' ), 'utf8' ) );
	step( 'final build' );
	if ( ( await run( 'node', [ 'tools/build-scene.mjs' ] ) ).code ) return fail( 'final scene build failed' );
	if ( ( await run( 'npm', [ 'run', 'build' ], { quiet: true } ) ).code ) return fail( 'final Vite build failed' );
	step( 'final comparison and walk test' );
	const finalDir = join( shotsDir, 'pass2' );
	mkdirSync( finalDir, { recursive: true } );
	let final;
	try { final = await screenshots( { tree, cell, inventory, dir: finalDir, id, run, note } ); }
	catch ( e ) { return fail( `final proof failed: ${e.message}` ); }
	const shots = final.shots;
	update( { shots: JSON.stringify( { before: first.shots, after: shots, proof: final.proof, pairs: final.proof.pairs.map( p => ( { ...p, referenceUrl: `/files/shots/${id}/pass2/proof/${p.reference}`, modelUrl: `/files/shots/${id}/pass2/proof/${p.model}` } ) ), proofUrl: `/files/shots/${id}/pass2/proof/index.html` } ) } );
	// Remaining mismatches don't stop the tile: they go into the pull request, which the owner reviews and approves
	// with the photo pairs in front of him (every tile so far had a few after the correction pass).
	if ( review.visualIssues.length ) note( `${review.visualIssues.length} visual mismatch(es) left, listed in the PR` );

	// Only the data and the built scene go into the commit.
	step( 'commit' );
	await git( [ 'add', '--', 'data/houses.json', 'data/signs.json', 'data/fronts', 'public/data' ] );
	const staged = ( await git( [ 'diff', '--cached', '--name-only' ] ) ).out.trim();
	if ( ! staged ) {

		update( { state: 'empty', ended: now(), step: null } );
		note( 'Beze změn.' );
		setStatus( square, 'todo' );
		return true;

	}

	const title = `Square ${square}: described fronts and photo comparison`;
	const cm = await run( 'git', [ 'commit', '-m', title ], { quiet: true } );
	if ( cm.code ) return fail( `git commit: ${cm.out.trim()}` );
	update( {
		commits: ( await git( [ 'log', '--format=%h\t%s', `${head}..HEAD` ] ) ).out.trim(),
		diffstat: ( await git( [ 'diff', '--stat=100', `${head}..HEAD` ] ) ).out.trim().split( '\n' ).slice( - 25 ).join( '\n' )
	} );

	step( 'pull request' );
	const push = await git( [ 'push', '-u', 'origin', branch ] );
	if ( push.code ) return fail( `git push: ${push.out.trim()}` );
	const usage = { ...summaryOf( db, id ), api: useAPI ? db.prepare( 'SELECT api_cost FROM sessions WHERE id = ?' ).get( id ).api_cost : null };
	const body = prBody( { square, cell, merged, review, inventory, fetched, streetViews, ownPhotos, usage, minutes: ( Date.now() - started ) / 60e3, shots, proof: final.proof, id } );
	const bodyFile = join( work, 'pr-body.md' );
	writeFileSync( bodyFile, body );
	const pr = await run( 'gh', [ 'pr', 'create', '--base', base.replace( /^origin\//, '' ), '--head', branch, '--title', title, '--body-file', bodyFile ], { quiet: true } );
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
			const log = createWriteStream( join( logs, `${id}.log` ), { flags: 'a' } );
			let result = null, buf = '';
			const timer = setInterval( () => saveUsage( db, id, cumulativeUsage ), 5000 );
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
						cumulativeUsage.add( line );
						if ( line.type === 'result' ) result = line;

					} catch {}

				}

			} );

			child.stderr.on( 'data', d => log.write( JSON.stringify( { type: 'app', text: clean( d ).slice( 0, 1000 ), at: now() } ) + '\n' ) );
			child.stdin.end( prompt );
			const done = () => {

				clearInterval( timer );
				clearTimeout( killer );
				saveUsage( db, id, cumulativeUsage );
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

// What square runs have charged to the API credit so far (Claude Code's own figure per run).
export const apiSpent = db => db.prepare( 'SELECT COALESCE( SUM( api_cost ), 0 ) AS s FROM sessions' ).get().s;

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
			const proofDir = join( dir, 'proof' );
			const result = await run( 'node', [ 'tools/square-proof.mjs', inventory.square, '--url', `http://127.0.0.1:${port}/`, '--out', proofDir ], { quiet: true } );
			if ( result.code ) throw new Error( `model/photo proof: ${result.out.slice( - 1200 )}` );
			const proof = JSON.parse( readFileSync( join( proofDir, 'proof.json' ), 'utf8' ) );
			if ( proof.openings > proof.clear ) note( `${proof.openings - proof.clear} mapped passages or arcades need a walkability fix` );
			return { shots: list.filter( s => existsSync( s.file ) ).map( s => ( { kind: s.kind, label: s.label, query: s.query, url: `/files/shots/${id}/${dir.split( '/' ).pop()}/${s.file.split( '/' ).pop()}` } ) ), proof };

		} finally {

			await browser.close();

		}

	} finally {

		preview.kill();

	}

}

function prBody( { square, cell, merged, review, inventory, fetched, streetViews, ownPhotos, usage, minutes, shots, proof, id } ) {

	const n = v => Math.round( v ).toLocaleString( 'en' );
	const houses = Object.entries( review.houses || {} ).map( ( [ code, h ] ) => `- ${code}: ${h.note || ''}${h.confidence ? ` (${h.confidence})` : ''}` );
	const signs = ( review.signs || [] ).map( g => `- "${g.text}"${g.sub ? ` / ${g.sub}` : ''} (${g.kind}, ${g.front})` );
	return [
		`Street-photo review of grid square **${square}** (x ${cell.x0}…${cell.x1}, z ${cell.z0}…${cell.z1}; ${cell.streets.join( ', ' )}), run by the grid app (session ${id}) following docs/review-brief.md.`,
		'Changes are in `data/houses.json`, `data/signs.json`, `data/fronts/` and the rebuilt `public/data/`.',
		`## Merged\n${merged.houses} houses, ${merged.groundFloors} described ground floors, ${merged.balconies} balconies, ${merged.shopfronts} drawn fronts, ${merged.signs} signs (${inventory.fronts.length} fronts in the inventory).`,
		merged.lowConfidence.length ? `Low confidence (note only, colours and floors left as they were): ${merged.lowConfidence.join( ', ' )}` : '',
		'Merge schema and SVG checks passed.',
		`<details><summary>Houses</summary>\n\n${houses.join( '\n' ) || '-'}\n</details>`,
		`<details><summary>Signs</summary>\n\n${signs.join( '\n' ) || '-'}\n</details>`,
		`## Reviewer's issues\n${( merged.issues || [] ).map( i => `- ${i}` ).join( '\n' ) || '-'}`,
		`## Still different from the photos\n${( review.visualIssues || [] ).map( v => `- ${v.front}: ${v.what}` ).join( '\n' ) || 'Nothing listed.'}`,
		`## Layout issues for owner approval\n${( merged.layoutIssues || [] ).map( i => `- ${i.kind}: ${i.where} — ${i.evidence}` ).join( '\n' ) || 'None reported.'}`,
		`## Photo and walk proof\n${proof.pairs.length} same-position pairs (${proof.pairs.filter( p => p.source === 'Street View' ).length} Street View, ${proof.pairs.filter( p => p.source === 'Owner photo' ).length} owner photos). ${proof.clear}/${proof.openings} mapped passages and arcades clear in the collision test. See the grid app session ${id} for side-by-side images and blocked positions.`,
		`## Cost\n- Tokens: ${n( usage.tokens )} (input ${n( usage.input )}, output ${n( usage.output )}, cache read ${n( usage.cache_read )}, cache write ${n( usage.cache_write_5m + usage.cache_write_1h )}; ${usage.messages} messages, main session and subagents)`
			+ `\n- API-equivalent cost: $${usage.cost.toFixed( 2 )} (${( usage.cost / usage.plan * 100 ).toFixed( 1 )} % of the $${usage.plan} monthly plan's price${usage.week != null ? `, ≈ ${usage.week.toFixed( 1 )} % of the weekly limit` : '; weekly limit not calibrated yet'})`
			+ ( usage.api != null ? `\n- Charged to the API credit: $${usage.api.toFixed( 2 )}` : '\n- Paid by the subscription' )
			+ `\n- Street View images: ${streetViews} used, ${fetched} fetched in this run (≈ $${( fetched * 0.007 ).toFixed( 2 )} at list price); ${ownPhotos} supplemental owner photos; kept outside git`
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
