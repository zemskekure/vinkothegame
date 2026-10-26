// The city by square (tools/tiles.mjs writes them: public/data/tiles/<i>_<j>.bin). The squares round where one is
// come in first, nearest first; the game is ready once those within READY metres of the start are in (src/main.js),
// and the rest stream in by distance as one walks, rides or flies, a few downloads at a time and at low priority
// past the first ring, unpacked off the main thread (src/tile-worker.js) and put in the scene one a frame. Squares
// further than UNLOAD from where one is go again: their meshes and textures are freed and their walking data
// dropped. Walking, the ground's height and the house mask are answered from the squares that are in; where one
// isn't (yet), the answer says so (null) and the caller holds still, or takes the coarse 8 m height grid of the
// whole city (heightCoarse) for things far off.

let READY = 600; // m round the start that are in before play (the haze is thick from 1 km: the rest comes in the first seconds of play)
let LOAD = 1500; // m round where one is that are fetched
let UNLOAD = 1750; // m beyond which a square is let go (a little over LOAD, so the edge doesn't flicker)
const AHEAD = 4; // seconds of travel the queue looks ahead
const IN_FLIGHT = 4; // downloads at a time
const WORKERS = 2;

export function createStream( { index, apply, release, frameBudget = 6, radii = {} } ) {

	// ?ready=…&load=… (metres) for trying other rings.
	if ( radii.ready ) READY = radii.ready;
	if ( radii.load ) {

		LOAD = radii.load;
		UNLOAD = LOAD + 250;

	}

	const B = index.bounds, TS = index.tiles.size, NX = index.tiles.nx, NZ = index.tiles.nz;
	const T = index.terrain, G = TS + 1;
	const C = { minX: B.minX, minZ: B.minZ, tile: TS, terrainMin: T.min, terrainScale: T.scale, wallStride: index.wallStride, roofStride: index.roofStride };
	const all = new Map(); // key → square: { i, j, key, state: 'idle' | 'fetch' | 'wait' | 'live', data }
	for ( const [ i, j ] of index.tiles.list ) all.set( j * NX + i, { i, j, key: j * NX + i, state: 'idle', d: Infinity } );
	const live = new Map();
	const results = []; // unpacked, waiting for their frame
	let inFlight = 0, jobId = 0;
	const jobs = new Map();
	const base = new URL( 'data/tiles/', document.baseURI ).href;

	const workers = Array.from( { length: WORKERS }, () => {

		const w = new Worker( new URL( './tile-worker.js', import.meta.url ), { type: 'module' } );
		w.onmessage = e => {

			const job = jobs.get( e.data.id );
			jobs.delete( e.data.id );
			if ( job.roof ) {

				job.square.roofPending = false;
				if ( job.square.state === 'live' && job.square.data?.roofPos ) job.square.roofGrid = e.data.grid;
				return;

			}

			inFlight --;
			if ( e.data.error ) {

				console.warn( 'tile', e.data.error );
				job.square.state = 'idle';
				job.square.failed = ( job.square.failed || 0 ) + 1;
				return;

			}

			job.square.state = 'wait';
			job.square.data = e.data.tile;
			results.push( job.square );

		};
		return w;

	} );
	let nextWorker = 0;

	// Where the squares are wanted from: one or more points (where one is, where one is heading, a teleport's target).
	let points = [], start = null, readyResolve, settledAt = 0;
	const waiters = [];
	const rectDistance = ( s, x, z ) => {

		const x0 = B.minX + s.i * TS, z0 = B.minZ + s.j * TS;
		const dx = Math.max( x0 - x, 0, x - ( x0 + TS ) ), dz = Math.max( z0 - z, 0, z - ( z0 + TS ) );
		return Math.hypot( dx, dz );

	};

	function fetchSquare( s ) {

		s.state = 'fetch';
		inFlight ++;
		const id = ++ jobId;
		jobs.set( id, { square: s } );
		workers[ nextWorker ++ % WORKERS ].postMessage( { id, url: `${base}${s.i}_${s.j}.bin`, priority: s.d < 400 ? 'high' : 'low', C } );

	}

	function schedule() {

		for ( const s of all.values() ) s.d = Math.min( ...points.map( ( [ x, z, r = 0 ] ) => Math.max( 0, rectDistance( s, x, z ) - r ) ) );
		// Before play only the ring round the start (the download is the wait); after, everything within LOAD.
		const reach = readyResolve ? READY : LOAD;
		const wanted = [ ...all.values() ].filter( s => s.state === 'idle' && s.d < reach && ( s.failed || 0 ) < 3 ).sort( ( a, b ) => a.d - b.d );
		for ( const s of wanted ) {

			if ( inFlight >= IN_FLIGHT ) break;
			fetchSquare( s );

		}

	}

	function put( s ) {

		if ( s.d > UNLOAD ) {

			s.state = 'idle';
			s.data = null;
			return;

		}

		apply( s );
		s.state = 'live';
		live.set( s.key, s );

	}

	function drop( s ) {

		release( s );
		s.state = 'idle';
		s.data = null;
		s.roofGrid = null;
		live.delete( s.key );

	}

	// Within r of (x, z), every square there is that is wanted is in.
	const done = s => s.state === 'live' || ( s.failed || 0 ) >= 3;
	const inAround = ( x, z, r ) => [ ...all.values() ].every( s => rectDistance( s, x, z ) > r || done( s ) );
	// Of the squares round the start, the share that is in.
	function readyProgress() {

		if ( ! start ) return 0;
		const near = [ ...all.values() ].filter( s => rectDistance( s, start[ 0 ], start[ 1 ] ) <= READY );
		return near.length ? near.filter( done ).length / near.length : 1;

	}

	function check() {

		if ( start && readyResolve && inAround( start[ 0 ], start[ 1 ], READY ) ) {

			readyResolve();
			readyResolve = null;

		}

		for ( let k = waiters.length - 1; k >= 0; k -- ) {

			const w = waiters[ k ];
			if ( inAround( w.x, w.z, w.r ) ) {

				waiters.splice( k, 1 );
				points = points.filter( p => p !== w.point );
				w.resolve();

			}

		}

	}

	// Each frame (or as often as one likes before play): where one is, and how fast one goes.
	function update( x, z, vx = 0, vz = 0, { budget = frameBudget, everything = false } = {} ) {

		points = [ [ x, z ], [ x + vx * AHEAD, z + vz * AHEAD ], ...waiters.map( w => w.point ) ];
		schedule();
		// Nearest first, as many as the frame's budget allows (at least one).
		results.sort( ( a, b ) => a.d - b.d );
		const t0 = performance.now();
		while ( results.length && ( everything || performance.now() - t0 < budget ) ) {

			put( results.shift() );
			if ( ! everything ) break;

		}

		for ( const s of live.values() ) {

			if ( s.d > UNLOAD ) drop( s );
			else if ( s.roofGrid && rectDistance( s, x, z ) > 600 ) s.roofGrid = null;
			else if ( ! s.roofGrid && ! s.roofPending && s.data.roofPos && rectDistance( s, x, z ) < 350 ) {

				s.roofPending = true;
				const id = ++ jobId;
				jobs.set( id, { square: s, roof: true } );
				workers[ nextWorker ++ % WORKERS ].postMessage( { id, roof: s.data.roofPos, x0: s.data.x0, z0: s.data.z0, size: TS } );

			}

		}

		check();
		if ( ! results.length && ! inFlight ) settledAt ||= performance.now();
		else settledAt = 0;

	}

	// The squares round the start, before play: resolves when those within READY are in.
	function prime( x, z ) {

		start = [ x, z ];
		points = [ [ x, z ] ];
		const ready = new Promise( r => readyResolve = r );
		schedule();
		check();
		return ready;

	}

	// Resolves once the squares within r of (x, z) are in (a teleport's target): they go first.
	function whenLoaded( x, z, r = 120 ) {

		return new Promise( resolve => {

			const w = { x, z, r, resolve, point: [ x, z, 0 ] };
			waiters.push( w );
			points.push( w.point );
			schedule();
			check();

		} );

	}

	// --- what is where, from the squares that are in -----------------------------------------------------------

	const squareAt = ( x, z ) => {

		const i = Math.floor( ( x - B.minX ) / TS ), j = Math.floor( ( z - B.minZ ) / TS );
		if ( i < 0 || j < 0 || i >= NX || j >= NZ ) return null;
		return live.get( j * NX + i ) || null;

	};

	// The ground's height (the 1 m grid, filled from the ground's own triangles), or null where it isn't in.
	function height( x, z ) {

		const s = squareAt( x, z );
		const h = s?.data.heights;
		if ( ! h ) return null;
		const fx = Math.min( Math.max( x - s.data.x0, 0 ), TS - 0.001 ), fz = Math.min( Math.max( z - s.data.z0, 0 ), TS - 0.001 );
		const x0 = Math.floor( fx ), z0 = Math.floor( fz ), tx = fx - x0, tz = fz - z0, i = z0 * G + x0;
		return ( h[ i ] * ( 1 - tx ) + h[ i + 1 ] * tx ) * ( 1 - tz ) + ( h[ i + G ] * ( 1 - tx ) + h[ i + G + 1 ] * tx ) * tz;

	}

	// The ground every 8 m over the whole city (public/data/heights.bin), for what is far off.
	let coarse = null;
	const CO = index.coarse;
	function heightCoarse( x, z ) {

		if ( ! coarse ) return T.min;
		const fx = Math.min( Math.max( ( x - B.minX ) / CO.cell, 0 ), CO.width - 1.001 ), fz = Math.min( Math.max( ( z - B.minZ ) / CO.cell, 0 ), CO.height - 1.001 );
		const x0 = Math.floor( fx ), z0 = Math.floor( fz ), tx = fx - x0, tz = fz - z0, i = z0 * CO.width + x0, W = CO.width;
		const v = ( coarse[ i ] * ( 1 - tx ) + coarse[ i + 1 ] * tx ) * ( 1 - tz ) + ( coarse[ i + W ] * ( 1 - tx ) + coarse[ i + W + 1 ] * tx ) * tz;
		return CO.min + v * CO.scale;

	}

	// A byte of one of the street maps at 1 m (the kerb field, the roughness), or null.
	function surfaceByte( x, z, name ) {

		const s = squareAt( x, z ), m = s?.data.surface;
		if ( ! m ) return null;
		const c = Math.min( m.w - 1, Math.max( 0, Math.floor( x - s.data.x0 ) ) ), r = Math.min( m.h - 1, Math.max( 0, Math.floor( z - s.data.z0 ) ) );
		return m[ name ][ r * m.w + c ];

	}

	// Inside a house (the 0.5 m mask): 1 or 0, or null where the square isn't in.
	function house( x, z ) {

		const s = squareAt( x, z ), f = s?.data.footprints;
		if ( ! f ) return null;
		const c = Math.floor( ( x - s.data.x0 ) / 0.5 ), r = Math.floor( ( z - s.data.z0 ) / 0.5 );
		if ( c < 0 || r < 0 || c >= f.w || r >= f.h ) return 1;
		const i = r * f.w + c;
		return ( f.bits[ i >> 3 ] >> ( i & 7 ) ) & 1;

	}

	// The highest roof on a 0.5 m grid, for the pigeon: worked out off the main thread for the squares within 350 m
	// of where one is (update below), forgotten once one is 600 m off; -Infinity where it isn't ready (yet).
	function roof( x, z ) {

		const s = squareAt( x, z );
		if ( ! s?.roofGrid ) return - Infinity;
		const c = Math.floor( ( x - s.data.x0 ) / 0.5 ), r = Math.floor( ( z - s.data.z0 ) / 0.5 ), N = TS * 2;
		if ( c < 0 || r < 0 || c >= N || r >= N ) return - Infinity;
		return s.roofGrid[ r * N + c ];

	}

	return {
		update, prime, whenLoaded, readyProgress, height, heightCoarse, surfaceByte, house, roof, squareAt, live,
		setCoarse: c => coarse = c,
		get pending() { return results.length + inFlight; },
		get settled() { return !! settledAt; },
		isIn: ( x, z ) => !! squareAt( x, z ),
		stats: () => ( { live: live.size, waiting: results.length, inFlight, total: all.size } ),
		READY, LOAD, UNLOAD
	};

}
