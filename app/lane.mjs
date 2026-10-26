// The Codex lane: tile runs reviewed by the Codex CLI on the ChatGPT plan, one after another, beside the autopilot's
// Claude lane (app/jobs.mjs). Both pick from the same map (app/pick.mjs), so they never take the same cell. Runs as its
// own process under launchd (com.kedlubna.vinko-codex-lane, KeepAlive), so a dashboard restart doesn't cut a run off.
//
//   node app/lane.mjs
//
// It works while the setting `codex_lane` is '1' (the dashboard's switch), waits while STOP is on or the plan's
// limit has paused it (`codex_paused_until`, set by app/square.mjs when Codex reports a usage limit), and counts
// toward the same daily cap as the autopilot.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDB, getSettings } from './db.mjs';
import { loadGrid } from './grid.mjs';
import { readEnv } from './env.mjs';
import { pickCell } from './pick.mjs';
import { runSquare, reviewPrompt } from './square.mjs';

const now = () => new Date().toISOString();
const sleep = ms => new Promise( r => setTimeout( r, ms ) );

const data = process.env.GRID_DATA || join( homedir(), 'vinko-grid-data' );
const env = { ...readEnv( join( data, '.env' ) ), ...process.env };
const live = fileURLToPath( new URL( '../', import.meta.url ) ).replace( /\/$/, '' );
const db = openDB( join( data, 'grid.sqlite' ) );
const setStatus = ( cell, status ) => db.prepare( 'INSERT INTO cells (id, status, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated = excluded.updated' ).run( cell, status, now() );

console.log( `codex lane up ${now()}` );
for ( ;; ) {

	const s = getSettings( db );
	if ( s.stopped === '1' || s.codex_lane !== '1' || ( s.codex_paused_until && s.codex_paused_until > now() ) ) {

		await sleep( 60e3 );
		continue;

	}

	// The grid is read fresh each time: a merged tile or a larger map changes what is left.
	const grid = loadGrid( 100 );
	const pick = pickCell( db, grid, { claudeWeek: false } );
	if ( pick.stop ) {

		console.log( `${now()} nothing to do: ${pick.stop}` );
		await sleep( 10 * 60e3 );
		continue;

	}

	const square = pick.cell;
	const { lastInsertRowid } = db.prepare( "INSERT INTO sessions (cell, kind, state, prompt, created, reviewer) VALUES (?, 'square', 'queued', ?, ?, 'codex')" ).run( square, reviewPrompt( square, join( data, 'squares', square ) ), now() );
	setStatus( square, 'in_progress' );
	console.log( `${now()} ${square} (session ${lastInsertRowid})` );
	try {

		await runSquare( { db, grid, data, live, env, id: Number( lastInsertRowid ), budget: 40, setStatus, reviewer: 'codex' } );

	} catch ( e ) {

		console.error( e );
		db.prepare( "UPDATE sessions SET state = 'failed', error = ?, ended = ? WHERE id = ?" ).run( String( e.message ).slice( 0, 500 ), now(), Number( lastInsertRowid ) );
		setStatus( square, 'todo' );

	}

	const row = db.prepare( 'SELECT state, error, pr FROM sessions WHERE id = ?' ).get( Number( lastInsertRowid ) );
	console.log( `${now()} ${square}: ${row.state}${row.pr ? ` ${row.pr}` : ''}${row.error ? ` (${row.error.slice( 0, 200 )})` : ''}` );
	await sleep( 30e3 );

}
