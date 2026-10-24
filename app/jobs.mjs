// Claude Code sessions on cells, run as server-side jobs so they survive the browser closing. One at a time:
// each works in its own branch (cell/<id>-<time>) of a separate work checkout, then the app rebuilds, takes
// screenshots, merges into the base branch and publishes the result to the checkout the game is served from.
//
// The autopilot keeps picking the next cell (cells with open bugs first, then outward from Betlémské náměstí)
// until it is switched off, runs into the daily cap or the share of the weekly limit set on the settings page.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageCounter } from './usage.mjs';
import { getSettings, setSetting } from './db.mjs';
import { describe, viewsOf } from './grid.mjs';
import { summary } from './stats.mjs';
import { runSquare, reviewPrompt } from './square.mjs';

const now = () => new Date().toISOString();
const DAY = 24 * 3600e3;

export function createJobs( { db, grid, data, live, work, base, env, gameURL, previewURL, password } ) {

	const logs = join( data, 'sessions' ), shotsDir = join( data, 'shots' );
	mkdirSync( logs, { recursive: true } );
	mkdirSync( shotsDir, { recursive: true } );

	let current = null; // { id, child, cancelled }
	let busy = false;

	// Sessions cut off by a server restart can't be resumed; a square run started by hand (its own process) goes on.
	const alive = pid => {

		try {

			return !! pid && pid !== process.pid && process.kill( pid, 0 );

		} catch {

			return false;

		}

	};

	for ( const s of db.prepare( "SELECT id, pid FROM sessions WHERE state IN ('running', 'building')" ).all() ) {

		if ( ! alive( s.pid ) ) db.prepare( "UPDATE sessions SET state = 'failed', error = 'Server se restartoval během sezení.', ended = ? WHERE id = ?" ).run( now(), s.id );

	}

	const session = id => db.prepare( 'SELECT * FROM sessions WHERE id = ?' ).get( id );
	const update = ( id, fields ) => {

		const keys = Object.keys( fields );
		db.prepare( `UPDATE sessions SET ${keys.map( k => `${k} = ?` ).join( ', ' )} WHERE id = ?` ).run( ...keys.map( k => fields[ k ] ?? null ), id );

	};

	const setStatus = ( cell, status ) => db.prepare( "INSERT INTO cells (id, status, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated = excluded.updated" ).run( cell, status, now() );

	function logLine( id, obj ) {

		const s = createWriteStream( join( logs, `${id}.log` ), { flags: 'a' } );
		s.end( JSON.stringify( { ...obj, at: now() } ) + '\n' );

	}

	const note = ( id, text ) => logLine( id, { type: 'app', text } );

	// Runs a command, logging its output into the session log; resolves with { code, out }.
	function run( id, cmd, args, opts = {} ) {

		return new Promise( resolve => {

			const child = spawn( cmd, args, { cwd: opts.cwd || work, env: { ...childEnv(), ...opts.env } } );
			let out = '';
			const take = d => {

				out += d;
				if ( opts.quiet ) return;
				for ( const line of String( d ).split( '\n' ) ) if ( line.trim() ) note( id, line.slice( 0, 400 ) );

			};

			child.stdout.on( 'data', take );
			child.stderr.on( 'data', take );
			child.on( 'error', e => resolve( { code: - 1, out: out + e.message } ) );
			child.on( 'close', code => resolve( { code, out } ) );

		} );

	}

	const git = ( id, args, cwd = work ) => run( id, 'git', args, { cwd, quiet: true } );

	function childEnv() {

		// A Claude Code session started from inside another one would otherwise think it is nested.
		const e = { ...process.env, ...env };
		for ( const k of Object.keys( e ) ) if ( k.startsWith( 'CLAUDECODE' ) || k === 'CLAUDE_CODE_ENTRYPOINT' ) delete e[ k ];
		return e;

	}

	// The prompt, assembled from the cell: bounds, contents, the owner's notes and open bugs, attached reference images.
	function defaultPrompt( cellId ) {

		const cell = grid.cells.get( cellId );
		const state = db.prepare( 'SELECT notes FROM cells WHERE id = ?' ).get( cellId );
		const bugs = db.prepare( 'SELECT id, text FROM bugs WHERE cell = ? AND open = 1 ORDER BY id' ).all( cellId );
		const refs = db.prepare( 'SELECT file, caption FROM refs WHERE cell = ? ORDER BY id' ).all( cellId );
		const views = viewsOf( cell );
		const parts = [
			`Make this cell of the map as true to reality as possible: houses, facades, signs, pavements, furniture. Follow CLAUDE.md (read it first).`,
			describe( cell )
		];
		if ( state?.notes?.trim() ) parts.push( `The owner's notes on this cell:\n${state.notes.trim()}` );
		if ( bugs.length ) parts.push( `Open bugs the owner found here (fix these first):\n${bugs.map( b => `- [${b.id}] ${b.text}` ).join( '\n' )}` );
		if ( refs.length ) {

			parts.push( `The owner's own Street View screenshots of this cell. Look at them with the Read tool and describe what you see in data/houses.json notes and in code; never copy, commit, trace or texture with them (Google's terms, CLAUDE.md):\n${refs.map( r => `- ${join( data, 'refs', r.file )}${r.caption ? ` (${r.caption})` : ''}` ).join( '\n' )}` );

		} else {

			parts.push( `There are no owner photos for this cell; that is fine. Work from the orthophoto (data/raw/ortho.jpg, data/raw/ortho-hi-*.jpg), OSM (data/raw/osm.json), RÚIAN and ZABAGED data${env.MAPILLARY_TOKEN ? ', and Mapillary street photos (tools/look-at.mjs; MAPILLARY_TOKEN is set)' : ''}.` );

		}

		parts.push( `How to work:
- Stay within this cell (x ${cell.x0} … ${cell.x1}, z ${cell.z0} … ${cell.z1}) unless a fix belongs in shared code. Never edit app/ (the control app running this session).
- Fix the most visible differences from reality first, in small steps. Don't invent shop names, signs or features that weren't seen; say the source in notes and comments.
- To look at your work: node tools/build-scene.mjs (if tools/ or data/ changed), npx vite build, start npx vite preview --port 4174 in the background, then node tools/screenshot.mjs "http://localhost:4174/?webgl&at=${views.at || '0,0,0'}" /tmp/cell-${cellId}.png (or ?webgl&overview&view=${views.overview}) and Read the PNG. Stop the preview server when done.
- Commit your work on the current branch with clear messages, no model identifiers. Don't push, don't switch or create branches.
- Keep the session under about 45 minutes.
- Finish with a short summary in Czech (3–6 lines: what you changed, what still differs from reality). If you fixed any of the listed bugs, end with a line "FIXED_BUGS: <ids separated by commas>".` );
		return parts.join( '\n\n' );

	}

	function enqueue( cellId, prompt ) {

		if ( ! grid.cells.has( cellId ) ) throw new Error( 'no such cell' );
		const active = db.prepare( "SELECT id FROM sessions WHERE cell = ? AND state IN ('queued', 'running', 'building')" ).get( cellId );
		if ( active ) return active.id;
		const { lastInsertRowid } = db.prepare( "INSERT INTO sessions (cell, kind, state, prompt, created) VALUES (?, 'cell', 'queued', ?, ?)" ).run( cellId, prompt || defaultPrompt( cellId ), now() );
		setStatus( cellId, 'in_progress' );
		setTimeout( tick, 100 );
		return Number( lastInsertRowid );

	}

	// A square through the street-photo pipeline (app/square.mjs), one at a time like the cell sessions.
	function enqueueSquare( cellId, budget = 40 ) {

		if ( ! grid.cells.has( cellId ) ) throw new Error( 'no such cell' );
		const active = db.prepare( "SELECT id FROM sessions WHERE cell = ? AND state IN ('queued', 'running', 'building')" ).get( cellId );
		if ( active ) return active.id;
		const { lastInsertRowid } = db.prepare( "INSERT INTO sessions (cell, kind, state, prompt, created, images) VALUES (?, 'square', 'queued', ?, ?, ?)" )
			.run( cellId, reviewPrompt( cellId, join( data, 'squares', cellId ) ), now(), budget );
		setStatus( cellId, 'in_progress' );
		setTimeout( tick, 100 );
		return Number( lastInsertRowid );

	}

	function cancel( id ) {

		const s = session( id );
		if ( ! s ) return;
		if ( s.state === 'queued' ) {

			update( id, { state: 'cancelled', ended: now() } );
			restoreStatus( s.cell );

		} else if ( current?.id === id ) {

			current.cancelled = true;
			current.child?.kill( 'SIGTERM' );

		}

	}

	function restoreStatus( cell ) {

		if ( ! cell ) return;
		const merged = db.prepare( "SELECT id FROM sessions WHERE cell = ? AND state = 'merged'" ).get( cell );
		setStatus( cell, merged ? 'done' : 'todo' );

	}

	// The next cell for the autopilot, or null.
	function nextCell() {

		const s = getSettings( db );
		const recent = db.prepare( "SELECT COUNT(*) AS n FROM sessions WHERE kind = 'cell' AND started >= ?" ).get( new Date( Date.now() - DAY ).toISOString() ).n;
		if ( recent >= Number( s.max_per_day ) ) return { stop: `denní strop ${s.max_per_day} sezení` };
		const sum = summary( db );
		if ( sum.week.share && sum.week.share.week >= Number( s.max_week_pct ) ) return { stop: `odhad týdenního limitu ${sum.week.share.week.toFixed( 0 )} % ≥ ${s.max_week_pct} %` };

		const startCell = [ ...grid.cells.values() ].find( c => c.streets.includes( 'Betlémské náměstí' ) ) || [ ...grid.cells.values() ][ 0 ];
		const dist = c => Math.hypot( c.col - startCell.col, c.row - startCell.row );
		const candidates = [];
		for ( const c of grid.cells.values() ) {

			if ( ! c.buildings.length ) continue;
			const row = db.prepare( 'SELECT status FROM cells WHERE id = ?' ).get( c.id );
			const status = row?.status || 'todo';
			if ( status === 'in_progress' ) continue;
			const last = db.prepare( "SELECT state, ended FROM sessions WHERE cell = ? AND kind = 'cell' ORDER BY id DESC LIMIT 1" ).get( c.id );
			const newestBug = db.prepare( 'SELECT MAX(created) AS t FROM bugs WHERE cell = ? AND open = 1' ).get( c.id ).t;
			// Bugs reported after the cell's last session send it back to work.
			if ( newestBug && ( ! last || newestBug > ( last.ended || '' ) ) ) {

				candidates.push( { c, rank: 0 } );
				continue;

			}

			if ( status === 'done' || last?.state === 'review' ) continue;
			// A cell whose last attempt failed waits half a day before the autopilot tries it again.
			if ( last && [ 'failed', 'conflict' ].includes( last.state ) && Date.now() - Date.parse( last.ended || 0 ) < DAY / 2 ) continue;
			candidates.push( { c, rank: 1 } );

		}

		candidates.sort( ( a, b ) => a.rank - b.rank || dist( a.c ) - dist( b.c ) );
		return candidates[ 0 ] ? { cell: candidates[ 0 ].c.id } : { stop: 'žádná další buňka' };

	}

	async function tick() {

		if ( busy ) return;
		busy = true;
		try {

			let next = db.prepare( "SELECT id FROM sessions WHERE state = 'queued' ORDER BY id LIMIT 1" ).get();
			const s = getSettings( db );
			if ( ! next && s.autopilot === '1' ) {

				if ( s.paused_until && s.paused_until > now() ) return;
				const pick = nextCell();
				if ( pick.stop ) {

					setSetting( db, 'autopilot', '0' );
					setSetting( db, 'paused_reason', `Autopilot zastaven: ${pick.stop}.` );
					return;

				}

				next = { id: enqueue( pick.cell ) };

			}

			if ( next ) await runSession( next.id );

		} catch ( e ) {

			console.error( e );

		} finally {

			busy = false;
			current = null;

		}

		if ( db.prepare( "SELECT id FROM sessions WHERE state = 'queued' LIMIT 1" ).get() || getSettings( db ).autopilot === '1' ) setTimeout( tick, 2000 );

	}

	async function runSession( id ) {

		const s = session( id );
		if ( s.kind === 'square' ) {

			// The queued row's images column holds the Street View budget until the run counts what it used.
			current = { id, child: null, cancelled: false };
			await runSquare( {
				db, grid, data, live, env, id, budget: s.images || 40, setStatus,
				onChild: c => current.child = c, cancelled: () => current.cancelled
			} );
			return;

		}

		if ( ! work ) return update( id, { state: 'failed', error: 'GRID_WORK is not set', ended: now() } );
		const cell = grid.cells.get( s.cell );
		const stamp = now().slice( 0, 16 ).replace( /[-:]/g, '' ).replace( 'T', '-' );
		const branch = `cell/${cell.id}-${stamp}`;
		current = { id, child: null, cancelled: false };
		update( id, { state: 'running', started: now(), branch, step: 'příprava' } );
		setStatus( cell.id, 'in_progress' );
		setSetting( db, 'paused_reason', '' );

		const fail = ( error, state = 'failed' ) => {

			update( id, { state, error, ended: now(), step: null } );
			note( id, `✗ ${error}` );
			restoreStatus( cell.id );

		};

		// A clean branch off the base, in the work checkout.
		note( id, `Větev ${branch} z ${base}` );
		await git( id, [ 'reset', '--hard' ] );
		await git( id, [ 'clean', '-fd' ] );
		await git( id, [ 'checkout', base ] );
		const co = await git( id, [ 'checkout', '-b', branch ] );
		if ( co.code ) return fail( `git checkout: ${co.out.trim()}` );

		// Before: the published game.
		update( id, { step: 'fotky před' } );
		const shots = { before: await shoot( id, gameURL, cell, 'before' ) };
		update( id, { shots: JSON.stringify( shots ) } );

		// The Claude Code session itself, headless, streaming JSON events into the log.
		update( id, { step: 'Claude pracuje' } );
		const settings = getSettings( db );
		const args = [ '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
			'--allowedTools', 'Bash Read Edit Write Glob Grep WebFetch WebSearch TodoWrite Task' ];
		if ( settings.model ) args.push( '--model', settings.model );
		const result = await claude( id, args, s.prompt, Number( settings.session_minutes ) * 60e3 );
		if ( current.cancelled ) return fail( 'Zastaveno ručně.', 'cancelled' );
		if ( ! result || result.is_error ) {

			const text = result?.result || result?.error || 'Claude skončil bez výsledku.';
			// Hitting the subscription's limit pauses the autopilot for an hour instead of burning through cells.
			if ( /limit|rate|overloaded|quota/i.test( text ) ) {

				setSetting( db, 'paused_until', new Date( Date.now() + 3600e3 ).toISOString() );
				setSetting( db, 'paused_reason', `Limit: ${text.slice( 0, 200 )} (další pokus za hodinu)` );

			}

			if ( ! result?.timedOut ) return fail( text );

		}

		let summaryText = ( result?.result || '' ).trim();
		const fixed = summaryText.match( /FIXED_BUGS:\s*([\d,\s]+)/ );
		if ( fixed ) {

			for ( const b of fixed[ 1 ].split( /[,\s]+/ ).filter( Boolean ) ) db.prepare( 'UPDATE bugs SET open = 0, fixed = ? WHERE id = ? AND cell = ?' ).run( now(), Number( b ), cell.id );
			summaryText = summaryText.replace( fixed[ 0 ], '' ).trim();

		}

		update( id, { summary: summaryText + ( result?.timedOut ? '\n\n(Sezení přerušeno po časovém limitu.)' : '' ), claude_session: result?.session_id || session( id ).claude_session } );

		// Build: commit whatever was left uncommitted, rebuild the scene when its sources changed, then the game.
		update( id, { state: 'building', step: 'sestavení' } );
		await git( id, [ 'add', '-A' ] );
		await git( id, [ 'commit', '-m', `Cell ${cell.id}: work in progress left uncommitted by the session` ] );
		const changed = ( await git( id, [ 'diff', '--name-only', `${base}...HEAD` ] ) ).out.split( '\n' ).filter( Boolean );
		if ( ! changed.length ) {

			update( id, { state: 'empty', ended: now(), step: null } );
			note( id, 'Beze změn.' );
			restoreStatus( cell.id );
			return;

		}

		if ( changed.some( f => /^(tools|data)\//.test( f ) ) ) {

			note( id, 'node tools/build-scene.mjs' );
			const b = await run( id, 'node', [ 'tools/build-scene.mjs' ] );
			if ( b.code ) return fail( 'Sestavení scény selhalo (tools/build-scene.mjs).' );
			await git( id, [ 'add', '-A', 'public/data' ] );
			await git( id, [ 'commit', '-m', `Cell ${cell.id}: rebuilt scene` ] );

		}

		const vb = await run( id, 'npx', [ 'vite', 'build' ], { quiet: true } );
		if ( vb.code ) return fail( `vite build selhal:\n${vb.out.slice( - 1500 )}` );

		update( id, {
			commits: ( await git( id, [ 'log', '--format=%h\t%s', `${base}..HEAD` ] ) ).out.trim(),
			diffstat: ( await git( id, [ 'diff', '--stat=100', `${base}...HEAD` ] ) ).out.trim().split( '\n' ).slice( - 25 ).join( '\n' )
		} );

		// After: the branch's build, served by the app at /preview/.
		update( id, { step: 'fotky po' } );
		shots.after = await shoot( id, previewURL, cell, 'after' );
		update( id, { shots: JSON.stringify( shots ) } );

		if ( getSettings( db ).auto_merge === '1' ) await merge( id );
		else {

			update( id, { state: 'review', ended: now(), step: null } );
			note( id, 'Čeká na kontrolu (sloučit / zahodit).' );

		}

	}

	// Runs claude, following its stream-json output; resolves with the result event (or null).
	function claude( id, args, prompt, timeout ) {

		return new Promise( resolve => {

			const child = spawn( env.CLAUDE_BIN || 'claude', args, { cwd: work, env: childEnv() } );
			current.child = child;
			const counter = new UsageCounter();
			const log = createWriteStream( join( logs, `${id}.log` ), { flags: 'a' } );
			let result = null, buf = '', dirty = false;

			const save = () => {

				if ( ! dirty ) return;
				dirty = false;
				db.prepare( 'DELETE FROM usage WHERE session = ?' ).run( id );
				for ( const [ model, u ] of Object.entries( counter.byModel() ) ) {

					db.prepare( 'INSERT INTO usage (session, model, input, output, cache_write_5m, cache_write_1h, cache_read, messages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)' )
						.run( id, model, u.input, u.output, u.cache_write_5m, u.cache_write_1h, u.cache_read, u.messages );

				}

			};

			const timer = setInterval( save, 5000 );
			const killer = setTimeout( () => {

				note( id, `Časový limit ${Math.round( timeout / 60e3 )} min, ukončuji.` );
				result = { ...( result || {} ), timedOut: true };
				child.kill( 'SIGTERM' );

			}, timeout );

			child.stdout.on( 'data', d => {

				buf += d;
				let nl;
				while ( ( nl = buf.indexOf( '\n' ) ) >= 0 ) {

					const raw = buf.slice( 0, nl );
					buf = buf.slice( nl + 1 );
					if ( ! raw.trim() ) continue;
					log.write( raw + '\n' );
					let line;
					try {

						line = JSON.parse( raw );

					} catch {

						continue;

					}

					if ( line.type === 'system' && line.session_id ) update( id, { claude_session: line.session_id } );
					if ( counter.add( line ) ) dirty = true;
					if ( line.type === 'result' ) result = { ...line, timedOut: result?.timedOut };

				}

			} );

			child.stderr.on( 'data', d => log.write( JSON.stringify( { type: 'app', text: String( d ).slice( 0, 1000 ), at: now() } ) + '\n' ) );
			child.stdin.end( prompt );
			const done = () => {

				clearInterval( timer );
				clearTimeout( killer );
				save();
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

	async function shoot( id, url, cell, label ) {

		const dir = join( shotsDir, String( id ) );
		mkdirSync( dir, { recursive: true } );
		const c = { x0: cell.x0, z0: cell.z0, x1: cell.x1, z1: cell.z1, views: viewsOf( cell ) };
		const list = [ 'overview', 'street', 'top' ].map( kind => ( { kind, cell: c, file: join( dir, `${label}-${kind}.jpg` ) } ) );
		try {

			const { takeShots } = await import( './shots.mjs' );
			await takeShots( url, list, { auth: password, log: t => note( id, t ) } );
			return list.filter( s => existsSync( s.file ) ).map( s => ( { kind: s.kind, url: `/files/shots/${id}/${label}-${s.kind}.jpg` } ) );

		} catch ( e ) {

			note( id, `Screenshoty se nepovedly: ${e.message.split( '\n' )[ 0 ]}` );
			return [];

		}

	}

	// Merges a finished branch into the base and publishes it to the served checkout.
	async function merge( id ) {

		const s = session( id );
		update( id, { step: 'slučování' } );
		await git( id, [ 'checkout', base ] );
		const m = await git( id, [ 'merge', '--no-ff', '-m', `Cell ${s.cell}: merge ${s.branch}`, s.branch ] );
		if ( m.code ) {

			// The built scene conflicts whenever two branches rebuilt it; rebuilding from the merged sources resolves that.
			const conflicts = ( await git( id, [ 'diff', '--name-only', '--diff-filter=U' ] ) ).out.split( '\n' ).filter( Boolean );
			if ( conflicts.length && conflicts.every( f => f.startsWith( 'public/data/' ) ) ) {

				note( id, 'Konflikt jen v public/data, sestavuji scénu znovu.' );
				await git( id, [ 'checkout', '--theirs', '--', 'public/data' ] );
				const b = await run( id, 'node', [ 'tools/build-scene.mjs' ] );
				if ( b.code ) {

					await git( id, [ 'merge', '--abort' ] );
					return finish( id, 'conflict', 'Sloučení: přestavba scény selhala.' );

				}

				await git( id, [ 'add', '-A' ] );
				await git( id, [ 'commit', '--no-edit' ] );

			} else {

				await git( id, [ 'merge', '--abort' ] );
				return finish( id, 'conflict', `Konflikt při slučování: ${conflicts.join( ', ' ) || m.out.trim()}` );

			}

		}

		await publish( id );
		update( id, { state: 'merged', ended: now(), step: null } );
		setStatus( s.cell, 'done' );
		note( id, `Sloučeno do ${base} a zveřejněno.` );

	}

	function finish( id, state, error ) {

		const s = session( id );
		update( id, { state, error, ended: now(), step: null } );
		note( id, error );
		restoreStatus( s.cell );

	}

	// The served checkout pulls the base branch from the work checkout and rebuilds the game.
	async function publish( id ) {

		update( id, { step: 'zveřejnění' } );
		const p = await git( id, [ 'pull', '--ff-only', work, base ], live );
		if ( p.code ) note( id, `git pull v živé kopii: ${p.out.trim()}` );
		const b = await run( id, 'npx', [ 'vite', 'build' ], { cwd: live, quiet: true } );
		if ( b.code ) note( id, `vite build v živé kopii selhal: ${b.out.slice( - 500 )}` );
		// The published game changed, so the map's model layer gets this cell's new view from above.
		const top = join( shotsDir, String( id ), 'after-top.jpg' );
		if ( existsSync( top ) ) setSetting( db, `top:${session( id ).cell}`, `/files/shots/${id}/after-top.jpg` );

	}

	async function reviewAction( id, action ) {

		const s = session( id );
		if ( s?.state !== 'review' && s?.state !== 'conflict' ) throw new Error( 'session is not waiting for review' );
		if ( busy ) throw new Error( 'jiné sezení právě běží, zkuste to po něm' );
		busy = true;
		try {

			if ( action === 'merge' ) await merge( id );
			else {

				await git( id, [ 'checkout', base ] );
				await git( id, [ 'branch', '-D', s.branch ] );
				update( id, { state: 'rejected', ended: s.ended || now() } );
				restoreStatus( s.cell );

			}

		} finally {

			busy = false;

		}

	}

	// One batch of views from above of the whole published model, for the map's model layer.
	async function shootModel() {

		if ( busy ) throw new Error( 'právě běží sezení' );
		busy = true;
		const dir = join( shotsDir, 'model' );
		mkdirSync( dir, { recursive: true } );
		setSetting( db, 'model_shots', 'running' );
		try {

			const list = [ ...grid.cells.values() ].map( c => ( { kind: 'top', cell: { x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, views: viewsOf( c ) }, file: join( dir, `${c.id}.jpg` ), id: c.id } ) );
			const { takeShots } = await import( './shots.mjs' );
			await takeShots( gameURL, list, { auth: password } );
			const stamp = Date.now();
			for ( const s of list ) if ( existsSync( s.file ) ) setSetting( db, `top:${s.id}`, `/files/shots/model/${s.id}.jpg?${stamp}` );
			setSetting( db, 'model_shots', now() );

		} catch ( e ) {

			setSetting( db, 'model_shots', `chyba: ${e.message.split( '\n' )[ 0 ]}` );

		} finally {

			busy = false;

		}

		tick();

	}

	// Readable events from a session log, for the live view.
	function events( id, after = 0 ) {

		const file = join( logs, `${id}.log` );
		if ( ! existsSync( file ) ) return { events: [], next: 0 };
		const lines = readFileSync( file, 'utf8' ).split( '\n' ).filter( Boolean );
		const out = [];
		for ( let i = after; i < lines.length; i ++ ) {

			let l;
			try {

				l = JSON.parse( lines[ i ] );

			} catch {

				continue;

			}

			if ( l.type === 'app' ) out.push( { kind: 'app', text: l.text } );
			else if ( l.type === 'assistant' ) {

				for ( const c of l.message?.content || [] ) {

					if ( c.type === 'text' && c.text.trim() ) out.push( { kind: 'text', text: c.text } );
					if ( c.type === 'tool_use' ) {

						const i = c.input || {};
						out.push( { kind: 'tool', text: `${c.name} ${i.command || i.file_path || i.pattern || i.description || i.url || ''}`.slice( 0, 300 ) } );

					}

				}

			} else if ( l.type === 'result' ) out.push( { kind: 'result', text: `Konec: ${l.subtype}${l.num_turns ? `, ${l.num_turns} kol` : ''}${l.duration_ms ? `, ${Math.round( l.duration_ms / 60000 )} min` : ''}` } );

		}

		return { events: out, next: lines.length };

	}

	return {
		enqueue, enqueueSquare, cancel, tick, defaultPrompt, reviewAction, shootModel, events,
		current: () => current && session( current.id ),
		busy: () => busy
	};

}

