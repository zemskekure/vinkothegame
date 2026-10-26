// Game settings, edited on the admin page (?admin, src/admin.js) and the art direction studio (?studio,
// src/studio.js: the `art` group). Four layers, each over the one before:
//   1. the defaults bundled with the code (public/game-settings.json, so a missing file never breaks the game);
//   2. the same file as served next to the game (./game-settings.json), so a server can change the defaults;
//   3. the copy the grid dashboard keeps (../api/game-settings: the game is served at /game/ under it; when the game
//      runs on its own this request just fails);
//   4. this browser's own overrides (localStorage), written by the admin page when there is no server to save to.
// Objects merge key by key; arrays (spawn zones, the pigeon's start) are replaced whole.

import BUNDLED from '../public/game-settings.json';

export const STORAGE_KEY = 'vinko.game-settings';
export const API_URL = '../api/game-settings';
export const TOP_KEYS = [ 'people', 'look', 'day', 'pigeon', 'art', 'world' ];

const isObject = v => !! v && typeof v === 'object' && ! Array.isArray( v );

export function merge( base, over ) {

	if ( ! isObject( over ) ) return structuredClone( base );
	const out = structuredClone( base );
	for ( const [ k, v ] of Object.entries( over ) ) out[ k ] = isObject( v ) && isObject( out[ k ] ) ? merge( out[ k ], v ) : structuredClone( v );
	return out;

}

async function fetchJSON( url ) {

	try {

		const r = await fetch( url, { cache: 'no-store', credentials: 'same-origin' } );
		if ( ! r.ok || ! ( r.headers.get( 'content-type' ) || '' ).includes( 'json' ) ) return null;
		const j = await r.json();
		return isObject( j ) ? j : null;

	} catch {

		return null;

	}

}

export function readLocal() {

	try {

		const j = JSON.parse( localStorage.getItem( STORAGE_KEY ) || 'null' );
		return isObject( j ) ? j : null;

	} catch {

		return null;

	}

}

export function writeLocal( settings ) {

	try {

		if ( settings ) localStorage.setItem( STORAGE_KEY, JSON.stringify( settings ) );
		else localStorage.removeItem( STORAGE_KEY );
		return true;

	} catch {

		return false;

	}

}

const served = window.PACKED_DATA ? null : await fetchJSON( './game-settings.json' );
const server = window.PACKED_DATA ? null : await fetchJSON( API_URL );
const local = readLocal();

export const DEFAULTS = merge( BUNDLED, served );
export const SERVER = server; // the dashboard's copy, or null
export const LOCAL = local; // this browser's overrides, or null
export const SETTINGS = merge( merge( DEFAULTS, server ), local );
