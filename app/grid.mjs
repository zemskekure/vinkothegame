// The play area sliced into square cells, named like a map: columns A… west to east, rows 1… north to south
// (scene frame: +x east, +z south). Each cell knows what is in it, read from the built scene and the raw RÚIAN data,
// so it can be described in words to a Claude Code session.

import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL( '../', import.meta.url );

function readJSON( path, fallback ) {

	const url = new URL( path, ROOT );
	return existsSync( url ) ? JSON.parse( readFileSync( url, 'utf8' ) ) : fallback;

}

export function loadGrid( size = 100 ) {

	const scene = readJSON( 'public/data/scene.json' );
	const houses = readJSON( 'data/houses.json', {} );
	const { minX, maxX, minZ, maxZ } = scene.bounds;

	// RÚIAN gives the house number (číslo popisné) per building code; the raw data is only there after fetch-data.
	const numbers = new Map();
	for ( const f of readJSON( 'data/raw/buildings.json', [] ) ) {

		const a = f.attributes || {};
		if ( a.kod && a.cisladomovni ) numbers.set( a.kod, a.cisladomovni );

	}

	const cols = Math.ceil( ( maxX - minX ) / size ), rows = Math.ceil( ( maxZ - minZ ) / size );
	const cells = new Map();

	for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < cols; i ++ ) {

		const id = columnName( i ) + ( j + 1 );
		const x0 = minX + i * size, z0 = minZ + j * size;
		cells.set( id, {
			id, col: i, row: j,
			x0, z0, x1: Math.min( maxX, x0 + size ), z1: Math.min( maxZ, z0 + size ),
			buildings: [], streets: new Set(), venues: [], street: null
		} );

	}

	const cellAt = ( x, z ) => {

		const i = Math.floor( ( x - minX ) / size ), j = Math.floor( ( z - minZ ) / size );
		if ( i < 0 || j < 0 || i >= cols || j >= rows ) return null;
		return cells.get( columnName( i ) + ( j + 1 ) );

	};

	// A building belongs to the cell its footprint centroid falls in.
	for ( const b of scene.buildings ) {

		const cell = cellAt( b.x, b.z );
		if ( ! cell ) continue;
		const house = houses[ b.code ];
		cell.buildings.push( {
			code: b.code, number: numbers.get( b.code ) || null, name: b.name || null,
			floors: b.floors, x: b.x, z: b.z, note: house?.note || null
		} );

	}

	// Streets are polylines [ x, y, z, … ]; a street is in every cell one of its points or segment midpoints falls in.
	// The point nearest each cell's centre also gives a street-level start for the preview.
	for ( const s of scene.streets ) {

		for ( const p of s.paths ) for ( let k = 0; k + 2 < p.length; k += 3 ) {

			const samples = [ [ p[ k ], p[ k + 2 ] ] ];
			if ( k + 5 < p.length ) samples.push( [ ( p[ k ] + p[ k + 3 ] ) / 2, ( p[ k + 2 ] + p[ k + 5 ] ) / 2 ] );
			for ( const [ x, z ] of samples ) {

				const cell = cellAt( x, z );
				if ( ! cell ) continue;
				if ( s.name ) cell.streets.add( s.name );
				const cx = ( cell.x0 + cell.x1 ) / 2, cz = ( cell.z0 + cell.z1 ) / 2;
				const d = Math.hypot( x - cx, z - cz );
				if ( cell.street && cell.street.d <= d ) continue;
				// Look along the street, from this point towards the next one (or back from the previous).
				const n = k + 5 < p.length ? [ p[ k + 3 ] - p[ k ], p[ k + 5 ] - p[ k + 2 ] ] : k >= 3 ? [ p[ k ] - p[ k - 3 ], p[ k + 2 ] - p[ k - 1 ] ] : [ 0, - 1 ];
				cell.street = { d, x, z, yaw: Math.atan2( - n[ 0 ], - n[ 1 ] ), name: s.name };

			}

		}

	}

	// Shops, cafés and restaurants as OpenStreetMap names them (the game hides these boards by default), and the
	// signs actually photographed and modelled (places.dress).
	for ( const s of scene.signs ) cellAt( s.x, s.z )?.venues.push( { name: s.name, kind: s.kind, source: 'OSM' } );
	for ( const d of scene.places?.dress || [] ) {

		if ( d.text && d.kind === 'board' ) cellAt( d.x, d.z )?.venues.push( { name: d.text.replace( /\s+/g, ' ' ).trim(), kind: 'sign', source: 'modelled' } );

	}

	for ( const cell of cells.values() ) {

		cell.streets = [ ...cell.streets ].sort( ( a, b ) => a.localeCompare( b, 'cs' ) );
		const seen = new Set();
		cell.venues = cell.venues.filter( v => ! seen.has( v.name ) && seen.add( v.name ) );
		cell.buildings.sort( ( a, b ) => ( a.number || '' ).localeCompare( b.number || '', 'cs', { numeric: true } ) );

	}

	return { size, cols, rows, bounds: scene.bounds, cells };

}

export function columnName( i ) {

	let s = '';
	for ( i ++; i > 0; i = Math.floor( ( i - 1 ) / 26 ) ) s = String.fromCharCode( 65 + ( i - 1 ) % 26 ) + s;
	return s;

}

// Where the game should look for a cell: from above (camera south of the centre, tilted down) and on foot.
export function viewsOf( cell ) {

	const cx = ( cell.x0 + cell.x1 ) / 2, cz = ( cell.z0 + cell.z1 ) / 2;
	const r = n => Math.round( n * 10 ) / 10;
	const views = { overview: [ cx, 150, cz + 110, cx, 0, cz ].map( r ).join( ',' ) };
	if ( cell.street ) views.at = [ cell.street.x, cell.street.z, cell.street.yaw ].map( v => Math.round( v * 100 ) / 100 ).join( ',' );
	return views;

}

// The cell in words, for the owner and for a Claude Code prompt.
export function describe( cell ) {

	const lines = [ `Cell ${cell.id}: scene frame x ${cell.x0} … ${cell.x1}, z ${cell.z0} … ${cell.z1} (+x east, +z south).` ];
	if ( cell.streets.length ) lines.push( `Streets: ${cell.streets.join( ', ' )}.` );
	if ( cell.buildings.length ) {

		lines.push( `Buildings (${cell.buildings.length}, RÚIAN code, house number čp.):` );
		for ( const b of cell.buildings ) {

			const bits = [ `- ${b.code}`, b.number ? `čp. ${b.number}` : null, b.name, `${b.floors} floors`, `at ${b.x}, ${b.z}` ].filter( Boolean );
			lines.push( bits.join( ', ' ) + ( b.note ? ` (houses.json: ${b.note})` : '' ) );

		}

	}

	if ( cell.venues.length ) lines.push( `Venues and signs: ${cell.venues.map( v => `${v.name} (${v.kind}, ${v.source})` ).join( '; ' )}.` );
	return lines.join( '\n' );

}
