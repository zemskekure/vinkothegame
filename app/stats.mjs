// Tokens and API-equivalent cost per session, per cell and in total, and the share of the subscription's weekly
// limit, estimated from the owner's calibration (the percentage Claude shows them against what the app counted).

import { costOf, totalTokens, EMPTY } from './usage.mjs';
import { getSettings } from './db.mjs';

const WEEK = 7 * 24 * 3600e3;

export function pricing( db ) {

	const s = getSettings( db );
	return {
		prices: db.prepare( 'SELECT * FROM prices ORDER BY sort, match' ).all(),
		mult: { w5m: Number( s.cache_write_5m ), w1h: Number( s.cache_write_1h ) },
		plan: Number( s.plan_monthly )
	};

}

// Usage and cost of every session, keyed by session id.
export function sessionCosts( db ) {

	const { prices, mult } = pricing( db );
	const out = new Map();
	for ( const u of db.prepare( 'SELECT * FROM usage' ).all() ) {

		const s = out.get( u.session ) || { ...EMPTY(), tokens: 0, cost: 0, models: [] };
		for ( const k of [ 'input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'messages' ] ) s[ k ] += u[ k ];
		s.tokens += totalTokens( u );
		s.cost += costOf( u.model, u, prices, mult );
		s.models.push( u.model );
		out.set( u.session, s );

	}

	return out;

}

export function costSince( db, since, costs = sessionCosts( db ) ) {

	let cost = 0, tokens = 0;
	for ( const s of db.prepare( 'SELECT id FROM sessions WHERE COALESCE( started, created ) >= ?' ).all( since ) ) {

		const c = costs.get( s.id );
		if ( c ) {

			cost += c.cost;
			tokens += c.tokens;

		}

	}

	return { cost, tokens };

}

// The weekly limit in API-equivalent dollars, from the latest calibration (null until the owner calibrates).
export function weeklyBudget( db ) {

	const c = db.prepare( 'SELECT * FROM calibrations ORDER BY id DESC LIMIT 1' ).get();
	if ( ! c || ! c.pct || ! c.cost ) return null;
	return { budget: c.cost / ( c.pct / 100 ), calibration: c };

}

export function summary( db ) {

	const costs = sessionCosts( db );
	const { plan } = pricing( db );
	const week = costSince( db, new Date( Date.now() - WEEK ).toISOString(), costs );
	const wb = weeklyBudget( db );
	const monthBudget = wb ? wb.budget * 52 / 12 : null;
	const share = cost => wb ? {
		week: cost / wb.budget * 100,
		month: cost / monthBudget * 100,
		dollars: cost / monthBudget * plan
	} : null;

	const total = { ...EMPTY(), tokens: 0, cost: 0 };
	const byCell = {};
	const baseline = { tokens: 0, cost: 0 };
	for ( const s of db.prepare( 'SELECT id, cell, kind FROM sessions' ).all() ) {

		const c = costs.get( s.id );
		if ( ! c ) continue;
		for ( const k of Object.keys( total ) ) total[ k ] += c[ k ] || 0;
		if ( s.kind === 'baseline' ) {

			baseline.tokens += c.tokens;
			baseline.cost += c.cost;

		}

		if ( s.cell ) {

			const b = byCell[ s.cell ] ||= { tokens: 0, cost: 0, sessions: 0 };
			b.tokens += c.tokens;
			b.cost += c.cost;
			b.sessions ++;

		}

	}

	for ( const b of Object.values( byCell ) ) b.share = share( b.cost );

	// Extrapolation: the average cost of a finished cell times the cells left.
	const done = db.prepare( "SELECT id FROM cells WHERE status = 'done'" ).all().map( r => r.id ).filter( id => byCell[ id ] );
	const perDone = done.length ? {
		cells: done.length,
		tokens: done.reduce( ( a, id ) => a + byCell[ id ].tokens, 0 ) / done.length,
		cost: done.reduce( ( a, id ) => a + byCell[ id ].cost, 0 ) / done.length
	} : null;

	const inGrid = { tokens: total.tokens - baseline.tokens, cost: total.cost - baseline.cost };
	inGrid.share = share( inGrid.cost );
	return {
		total, baseline, grid: inGrid, week: { ...week, share: share( week.cost ) }, budget: wb, plan, byCell, perDone,
		costs
	};

}
