// The next grid cell for a lane of tile runs: cells with open bugs first, then outward from Betlémské náměstí,
// skipping cells that are done, in review, running or recently failed. Shared by the autopilot (app/jobs.mjs, the
// Claude lane) and the Codex lane (app/lane.mjs). Returns { cell } or { stop: reason }.

import { getSettings } from './db.mjs';
import { summary } from './stats.mjs';

const DAY = 24 * 3600e3;

export function pickCell( db, grid, { claudeWeek = true } = {} ) {


	const s = getSettings( db );
	const recent = db.prepare( "SELECT COUNT(*) AS n FROM sessions WHERE kind IN ( 'cell', 'square' ) AND started >= ?" ).get( new Date( Date.now() - DAY ).toISOString() ).n;
	if ( recent >= Number( s.max_per_day ) ) return { stop: `denní strop ${s.max_per_day} sezení` };
	// The weekly share is the Claude plan's; a lane on another plan (Codex) passes claudeWeek: false.
	const sum = claudeWeek ? summary( db ) : null;
	if ( sum?.week.share && sum.week.share.week >= Number( s.max_week_pct ) ) return { stop: `odhad týdenního limitu ${sum.week.share.week.toFixed( 0 )} % ≥ ${s.max_week_pct} %` };

	const startCell = [ ...grid.cells.values() ].find( c => c.streets.includes( 'Betlémské náměstí' ) ) || [ ...grid.cells.values() ][ 0 ];
	const dist = c => Math.hypot( c.col - startCell.col, c.row - startCell.row );
	const candidates = [];
	for ( const c of grid.cells.values() ) {

		if ( ! c.buildings.length ) continue;
		const row = db.prepare( 'SELECT status FROM cells WHERE id = ?' ).get( c.id );
		const status = row?.status || 'todo';
		if ( status === 'in_progress' ) continue;
		// Two lanes pick from the same map: a cell another lane has queued or is running stays with it.
		if ( db.prepare( "SELECT id FROM sessions WHERE cell = ? AND state IN ('queued', 'running', 'building')" ).get( c.id ) ) continue;
		const last = db.prepare( "SELECT state, ended FROM sessions WHERE cell = ? AND kind IN ( 'cell', 'square' ) ORDER BY id DESC LIMIT 1" ).get( c.id );
		const newestBug = db.prepare( 'SELECT MAX(created) AS t FROM bugs WHERE cell = ? AND open = 1' ).get( c.id ).t;
		// Bugs reported after the cell's last session send it back to work.
		if ( newestBug && ( ! last || newestBug > ( last.ended || '' ) ) ) {

			candidates.push( { c, rank: 0 } );
			continue;

		}

		if ( status === 'done' || status === 'review' || last?.state === 'review' ) continue;
		// A cell whose last attempt failed waits half a day before the autopilot tries it again.
		if ( last && [ 'failed', 'conflict' ].includes( last.state ) && Date.now() - Date.parse( last.ended || 0 ) < DAY / 2 ) continue;
		candidates.push( { c, rank: 1 } );

	}

	candidates.sort( ( a, b ) => a.rank - b.rank || dist( a.c ) - dist( b.c ) );
	return candidates[ 0 ] ? { cell: candidates[ 0 ].c.id } : { stop: 'žádná další buňka' };

}
