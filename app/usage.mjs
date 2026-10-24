// Token accounting. Claude Code reports usage per assistant message, both in its stream-json output and in its
// transcripts (~/.claude/projects/<project>/<session>.jsonl). A message can appear on several lines (one per content
// block), so usage is de-duplicated by message id, keeping the last line seen.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

export const EMPTY = () => ( { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, messages: 0 } );

export class UsageCounter {

	constructor() {

		this.messages = new Map();

	}

	// Feed one parsed stream or transcript line.
	add( line ) {

		if ( line?.type !== 'assistant' || ! line.message?.usage ) return false;
		const m = line.message, u = m.usage;
		if ( m.model === '<synthetic>' ) return false;
		const split = u.cache_creation || {};
		const w1h = split.ephemeral_1h_input_tokens ?? 0;
		const w5m = split.ephemeral_5m_input_tokens ?? ( ( u.cache_creation_input_tokens || 0 ) - w1h );
		this.messages.set( m.id || line.uuid, {
			model: m.model || 'unknown',
			input: u.input_tokens || 0, output: u.output_tokens || 0,
			cache_write_5m: w5m, cache_write_1h: w1h, cache_read: u.cache_read_input_tokens || 0,
			at: line.timestamp || null
		} );
		return true;

	}

	// Totals per model.
	byModel() {

		const out = {};
		for ( const m of this.messages.values() ) {

			const t = out[ m.model ] ||= EMPTY();
			for ( const k of [ 'input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read' ] ) t[ k ] += m[ k ];
			t.messages ++;

		}

		return out;

	}

	span() {

		const times = [ ...this.messages.values() ].map( m => m.at ).filter( Boolean ).sort();
		return times.length ? [ times[ 0 ], times[ times.length - 1 ] ] : [ null, null ];

	}

}

// API-equivalent cost of one model's usage, from the editable price table ($ per million tokens).
export function priceFor( model, prices ) {

	const id = String( model ).toLowerCase();
	return prices.find( p => id.includes( p.match.toLowerCase() ) ) || prices[ 0 ];

}

export function costOf( model, u, prices, mult ) {

	const p = priceFor( model, prices );
	if ( ! p ) return 0;
	return ( u.input * p.input + u.output * p.output + u.cache_read * p.cache_read
		+ u.cache_write_5m * p.input * mult.w5m + u.cache_write_1h * p.input * mult.w1h ) / 1e6;

}

export const totalTokens = u => u.input + u.output + u.cache_write_5m + u.cache_write_1h + u.cache_read;

// Existing Claude Code transcripts of this repo on this machine (any checkout whose path mentions vinkothegame),
// including the subagent transcripts kept next to them.
export function findTranscripts() {

	const root = join( homedir(), '.claude/projects' );
	if ( ! existsSync( root ) ) return [];
	const out = [];
	for ( const dir of readdirSync( root ) ) {

		if ( ! /vinkothegame/i.test( dir ) ) continue;
		for ( const f of readdirSync( join( root, dir ) ) ) {

			if ( ! f.endsWith( '.jsonl' ) ) continue;
			const id = basename( f, '.jsonl' );
			const files = [ join( root, dir, f ) ];
			const sub = join( root, dir, id, 'subagents' );
			if ( existsSync( sub ) ) for ( const s of readdirSync( sub ) ) if ( s.endsWith( '.jsonl' ) ) files.push( join( sub, s ) );
			out.push( { id, project: dir, files, mtime: Math.max( ...files.map( p => statSync( p ).mtimeMs ) ) } );

		}

	}

	return out;

}

export function readTranscript( t ) {

	const counter = new UsageCounter();
	let prompt = null;
	for ( const file of t.files ) {

		for ( const raw of readFileSync( file, 'utf8' ).split( '\n' ) ) {

			if ( ! raw ) continue;
			let line;
			try {

				line = JSON.parse( raw );

			} catch {

				continue;

			}

			counter.add( line );
			if ( ! prompt && file === t.files[ 0 ] && line.type === 'user' && typeof line.message?.content === 'string' ) prompt = line.message.content.slice( 0, 2000 );

		}

	}

	return { counter, prompt };

}
