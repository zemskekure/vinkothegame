// Measures facade parameters from the rectified crops made by tools/facades.mjs:
//   colour     median plaster colour of the upper wall (windows, sky and deep shadow left out)
//   bay        window spacing (m), from the periodicity of dark window columns
//   window     window width as a fraction of the bay
//   shop       ground floor mostly glass / dark openings
// Writes data/raw/facade-params.json, keyed "<building code>_<edge>".

import { readFile, writeFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';

const RAW = new URL( '../data/raw/', import.meta.url );
const PX_PER_M = 16;

const crops = JSON.parse( await readFile( new URL( 'facade-crops.json', RAW ) ) ).filter( c => c.photo );
const params = {};

const lum = ( r, g, b ) => 0.299 * r + 0.587 * g + 0.114 * b;

for ( const c of crops ) {

	const img = jpeg.decode( await readFile( new URL( `facades/${c.name}.jpg`, RAW ) ), { useTArray: true } );
	const { width: W, height: H, data } = img;
	if ( W < 3 * PX_PER_M || H < 4 * PX_PER_M ) continue;

	const px = ( x, y ) => {

		const k = ( y * W + x ) * 4;
		return [ data[ k ], data[ k + 1 ], data[ k + 2 ] ];

	};

	const isBlank = ( [ r, g, b ] ) => r + g + b < 6; // outside the photo
	const isSky = ( [ r, g, b ] ) => b > r + 12 && b > g + 4 && lum( r, g, b ) > 140;

	// Upper wall: from 3.6 m above the ground up to 0.8 m below the eave.
	const yTop = Math.round( 0.8 * PX_PER_M ), yBottom = H - Math.round( 3.6 * PX_PER_M );
	const upper = yBottom - yTop > PX_PER_M * 2;

	// --- colour: the lighter half of the remaining wall pixels is plaster, the darker one windows / shade.
	const wall = [];
	let blank = 0, total = 0;
	for ( let y = upper ? yTop : 0; y < ( upper ? yBottom : H ); y += 2 ) {

		for ( let x = 0; x < W; x += 2 ) {

			const p = px( x, y );
			total ++;
			if ( isBlank( p ) ) {

				blank ++;
				continue;

			}

			if ( isSky( p ) ) continue;
			const l = lum( ...p );
			if ( l > 40 && l < 250 ) wall.push( p );

		}

	}

	if ( wall.length < 50 || blank / total > 0.5 ) continue;
	wall.sort( ( a, b ) => lum( ...a ) - lum( ...b ) );
	const bright = wall.slice( Math.floor( wall.length * 0.45 ), Math.floor( wall.length * 0.9 ) );
	const median = ch => bright.map( p => p[ ch ] ).sort( ( a, b ) => a - b )[ bright.length >> 1 ];
	const colour = [ median( 0 ), median( 1 ), median( 2 ) ];

	// --- window rhythm: darkness profile across the upper wall, autocorrelated over 2–5 m lags.
	let bay = null, window = null, confidence = 0;
	if ( upper ) {

		const profile = new Float64Array( W );
		for ( let x = 0; x < W; x ++ ) {

			let s = 0, n = 0;
			for ( let y = yTop; y < yBottom; y += 2 ) {

				const p = px( x, y );
				if ( isBlank( p ) ) continue;
				s += 255 - lum( ...p );
				n ++;

			}

			profile[ x ] = n ? s / n : NaN;

		}

		const valid = [ ...profile ].filter( v => ! Number.isNaN( v ) );
		const mean = valid.reduce( ( a, v ) => a + v, 0 ) / valid.length;
		const dev = Array.from( profile, v => Number.isNaN( v ) ? 0 : v - mean );
		const energy = dev.reduce( ( a, v ) => a + v * v, 0 ) || 1;

		let best = 0, bestLag = 0;
		for ( let lag = Math.round( 2.0 * PX_PER_M ); lag <= Math.round( 5.0 * PX_PER_M ) && lag < W / 1.6; lag ++ ) {

			let s = 0;
			for ( let x = 0; x + lag < W; x ++ ) s += dev[ x ] * dev[ x + lag ];
			const r = s / energy * W / ( W - lag );
			if ( r > best ) {

				best = r;
				bestLag = lag;

			}

		}

		if ( bestLag && best > 0.25 ) {

			bay = bestLag / PX_PER_M;
			confidence = best;
			// Window width: share of the profile darker than its mean.
			window = Math.min( 0.7, Math.max( 0.25, dev.filter( v => v > energy ** 0.5 / Math.sqrt( W ) * 0.3 ).length / W ) );

		}

	}

	// --- shop windows: the ground floor (0.3–3 m) is mostly dark glass.
	let dark = 0, n = 0;
	for ( let y = H - Math.round( 3.0 * PX_PER_M ); y < H - Math.round( 0.3 * PX_PER_M ); y += 2 ) {

		for ( let x = 0; x < W; x += 2 ) {

			const p = px( x, y );
			if ( isBlank( p ) ) continue;
			n ++;
			if ( lum( ...p ) < lum( ...colour ) * 0.5 ) dark ++;

		}

	}

	params[ c.name ] = {
		colour,
		bay: bay && + bay.toFixed( 2 ),
		window: window && + window.toFixed( 2 ),
		confidence: + confidence.toFixed( 2 ),
		shop: n > 0 && dark / n > 0.38,
		photo: c.photo
	};

}

await writeFile( new URL( 'facade-params.json', RAW ), JSON.stringify( params, null, 1 ) );
const vals = Object.values( params );
console.log( `facade params: ${vals.length} facades, ${vals.filter( v => v.bay ).length} with a window rhythm, ${vals.filter( v => v.shop ).length} with shops` );
