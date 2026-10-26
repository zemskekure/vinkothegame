// The app's state in one SQLite file (Node's built-in node:sqlite), kept in the data directory outside git
// together with the uploaded reference images, session logs and screenshots.

import { DatabaseSync } from 'node:sqlite';

// Prices in $ per million tokens at the time of writing (docs/grid-app.md); editable on the settings page.
const PRICES = [
	{ match: 'opus', label: 'Claude Opus 5.5', input: 4, output: 20, cache_read: 0.2 },
	{ match: 'haiku', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cache_read: 0.01 }
];

const SETTINGS = {
	cache_write_5m: '1.25', // cache write price as a multiple of the input price, 5-minute cache
	cache_write_1h: '2', // and 1-hour cache
	plan_monthly: '100', // the subscription, $ per month
	autopilot: '0',
	auto_merge: '1',
	model: '', // empty: Claude Code's default
	max_week_pct: '70', // autopilot stops when the estimated share of the weekly limit reaches this
	max_per_day: '8', // and after this many sessions in 24 hours
	session_minutes: '60', // a session is stopped after this long
	paused_until: '',
	paused_reason: ''
};

export function openDB( file ) {

	const db = new DatabaseSync( file );
	db.exec( `
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 15000;
		CREATE TABLE IF NOT EXISTS cells (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'todo',
			notes TEXT NOT NULL DEFAULT '',
			updated TEXT
		);
		CREATE TABLE IF NOT EXISTS bugs (
			id INTEGER PRIMARY KEY,
			cell TEXT NOT NULL,
			text TEXT NOT NULL,
			open INTEGER NOT NULL DEFAULT 1,
			created TEXT NOT NULL,
			fixed TEXT
		);
		CREATE TABLE IF NOT EXISTS refs (
			id INTEGER PRIMARY KEY,
			cell TEXT NOT NULL,
			kind TEXT NOT NULL,
			file TEXT NOT NULL,
			caption TEXT NOT NULL DEFAULT '',
			created TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions (
			id INTEGER PRIMARY KEY,
			cell TEXT,
			kind TEXT NOT NULL DEFAULT 'cell',
			state TEXT NOT NULL,
			prompt TEXT NOT NULL DEFAULT '',
			branch TEXT,
			claude_session TEXT,
			created TEXT NOT NULL,
			started TEXT,
			ended TEXT,
			summary TEXT,
			error TEXT,
			commits TEXT,
			diffstat TEXT,
			shots TEXT,
			step TEXT
		);
		CREATE TABLE IF NOT EXISTS usage (
			session INTEGER NOT NULL,
			model TEXT NOT NULL,
			input INTEGER NOT NULL DEFAULT 0,
			output INTEGER NOT NULL DEFAULT 0,
			cache_write_5m INTEGER NOT NULL DEFAULT 0,
			cache_write_1h INTEGER NOT NULL DEFAULT 0,
			cache_read INTEGER NOT NULL DEFAULT 0,
			messages INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY ( session, model )
		);
		CREATE TABLE IF NOT EXISTS prices (
			match TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			input REAL NOT NULL,
			output REAL NOT NULL,
			cache_read REAL NOT NULL,
			sort INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
		CREATE TABLE IF NOT EXISTS imports ( claude_session TEXT PRIMARY KEY, session INTEGER NOT NULL, mtime REAL NOT NULL );
		CREATE TABLE IF NOT EXISTS calibrations (
			id INTEGER PRIMARY KEY,
			at TEXT NOT NULL,
			since TEXT NOT NULL,
			pct REAL NOT NULL,
			cost REAL NOT NULL,
			tokens INTEGER NOT NULL
		);
	` );

	// Columns added with the square pipeline: the pull request and the Street View images used.
	const have = new Set( db.prepare( 'PRAGMA table_info(sessions)' ).all().map( c => c.name ) );
	for ( const [ c, type ] of [ [ 'pr', 'TEXT' ], [ 'images', 'INTEGER' ], [ 'images_fetched', 'INTEGER' ], [ 'pid', 'INTEGER' ], [ 'api_cost', 'REAL' ] ] ) if ( ! have.has( c ) ) db.exec( `ALTER TABLE sessions ADD COLUMN ${c} ${type}` );

	if ( ! db.prepare( 'SELECT COUNT(*) AS n FROM prices' ).get().n ) {

		PRICES.forEach( ( p, i ) => db.prepare( 'INSERT INTO prices (match, label, input, output, cache_read, sort) VALUES (?, ?, ?, ?, ?, ?)' ).run( p.match, p.label, p.input, p.output, p.cache_read, i ) );

	}

	// The square reviewer runs on Claude Code's default model on the API, which the first table didn't price.
	db.prepare( 'INSERT OR IGNORE INTO prices (match, label, input, output, cache_read, sort) VALUES (?, ?, ?, ?, ?, ?)' ).run( 'sonnet', 'Sonnet', 3, 15, 0.3, 1 );

	for ( const [ k, v ] of Object.entries( SETTINGS ) ) db.prepare( 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)' ).run( k, v );

	// The session that built most of the model before the app existed, measured from its transcript
	// (docs/grid-app.md): 2026-10-23 19:35 to 2026-10-24 17:49 UTC, almost all on Claude Opus 5.5, 1-hour cache.
	if ( ! db.prepare( "SELECT COUNT(*) AS n FROM sessions WHERE kind = 'baseline'" ).get().n ) {

		const { lastInsertRowid } = db.prepare( "INSERT INTO sessions (kind, state, prompt, created, started, ended, summary) VALUES ('baseline', 'imported', ?, ?, ?, ?, ?)" )
			.run( 'Stavba modelu před mřížkou', '2026-10-23T19:35:00Z', '2026-10-23T19:35:00Z', '2026-10-24T17:49:00Z', 'Výchozí bod: sezení, které postavilo většinu dnešního modelu (starší přepisy se nedochovaly, skutečný součet je vyšší).' );
		db.prepare( 'INSERT INTO usage (session, model, input, output, cache_write_5m, cache_write_1h, cache_read, messages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)' )
			.run( lastInsertRowid, 'claude-opus-5-5', 2000, 1320000, 0, 3390000, 390000000, 1020 );

	}

	return db;

}

export function getSettings( db ) {

	return Object.fromEntries( db.prepare( 'SELECT key, value FROM settings' ).all().map( r => [ r.key, r.value ] ) );

}

export function setSetting( db, key, value ) {

	db.prepare( 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value' ).run( key, String( value ) );

}
