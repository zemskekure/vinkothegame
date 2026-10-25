// Settings files: KEY=value lines, optionally quoted (the app's <GRID_DATA>/.env).

import { existsSync, readFileSync } from 'node:fs';

export function readEnv( file ) {

	if ( ! existsSync( file ) ) return {};
	const out = {};
	for ( const line of readFileSync( file, 'utf8' ).split( '\n' ) ) {

		const m = line.match( /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/ );
		if ( m ) out[ m[ 1 ] ] = m[ 2 ].replace( /^(['"])(.*)\1$/, '$2' );

	}

	return out;

}
