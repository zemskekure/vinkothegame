// People at the tram stops, only round the player (within ~80 m) so they cost nothing elsewhere:
//   - a few wait on each platform, standing about facing the tracks;
//   - when a tram stops, one to three get off on the platform side and walk away along the platform and off its end,
//     and the ones waiting walk to the nearest door and get on (gone into the tram, or, in the one the player rides,
//     standing inside);
//   - new people turn up at a platform after the tram has gone, walking in from its end;
//   - in the tram the player rides, a handful sit on the seats and one or two stand by the doors.
// Everyone is a skinned, animated person from the crowd's generator (src/persona.js via src/life.js `newPerson`),
// made when needed and thrown away when out of range (src/people.js makeSkinned: one draw each).

import * as THREE from 'three/webgpu';
import { makeSkinned } from './people.js';

const RANGE = 80, DROP = 110, WALK = 1.25;

export function addPassengers( { scene, life, trams, platforms, groundHeight, player } ) {

	const { newPerson, bodies } = life;
	if ( ! newPerson || ! trams?.trams ) return { update() {}, board() {}, alight() {} };
	let seed = 4711;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;

	const people = new Set();
	const crowd = new THREE.Group();
	scene.add( crowd );

	// A person, skinned, with their walk, idle and (if the body has it) sitting clips ready.
	function make( options = {} ) {

		const p = newPerson( options ), body = bodies[ p.body ];
		const sk = makeSkinned( body, p.look, p.spec.height, p.spec.shape, p.spec.width );
		const act = {};
		for ( const name of [ 'Walk', 'Idle', 'Sitting' ] ) if ( body.clips[ name ] ) act[ name ] = sk.mixer.clipAction( body.clips[ name ] );
		if ( act.Walk ) act.Walk.timeScale = WALK / ( body.pace * sk.scale );
		const person = { object: sk.object, mixer: sk.mixer, act, body, scale: sk.scale, clip: null, x: 0, y: 0, z: 0, yaw: 0, route: [], state: 'wait' };
		person.object.traverse( o => {

			if ( o.isSkinnedMesh ) o.castShadow = false;

		} );
		people.add( person );
		return person;

	}

	function play( p, name ) {

		if ( p.clip === name || ! p.act[ name ] ) return;
		const next = p.act[ name ].reset().play();
		next.time = rnd() * next.getClip().duration;
		if ( p.clip ) p.act[ p.clip ].crossFadeTo( next, 0.25, false );
		p.clip = name;

	}

	function drop( p ) {

		p.object.parent?.remove( p.object );
		p.object.traverse( o => o.isSkinnedMesh && o.geometry.dispose() );
		p.mixer.stopAllAction();
		people.delete( p );
		if ( p.platform ) p.platform.waiting.delete( p );

	}

	// --- the platforms: an axis along the platform and the side its tracks are on
	const plats = platforms.map( p => ( { ...p, ax: - p.nz, az: p.nx, waiting: new Set(), want: 2 + Math.floor( rnd() * 3 ), refill: 0, live: false } ) );
	// Where on a platform the trams stop (their middles; OpenStreetMap's stop is often at one end of a long
	// platform): people wait round there.
	for ( const t of trams.trams ) for ( const st of t.stopInfo ) {

		const pl = st.platform && plats.find( q => q.x === st.platform.x && q.z === st.platform.z );
		if ( pl ) ( pl.halts ||= [] ).push( ( st.x - pl.x ) * pl.ax + ( st.z - pl.z ) * pl.az );

	}

	const spot = ( pl, f = null, g = rnd() - 0.5 ) => {

		// Along the platform: by where a tram stops (±12 m), or a share of its length.
		const halt = pl.halts?.[ Math.floor( rnd() * pl.halts.length ) ];
		const a = f !== null ? f * pl.len * 0.7 : halt !== undefined ? Math.max( - pl.len / 2 + 1, Math.min( pl.len / 2 - 1, halt + ( rnd() - 0.5 ) * 24 ) ) : ( rnd() - 0.5 ) * pl.len * 0.7;
		return [ pl.x + pl.ax * a + pl.nx * g * pl.width * 0.5, pl.z + pl.az * a + pl.nz * g * pl.width * 0.5 ];

	};

	function waitAt( pl, x, z ) {

		const p = make();
		p.platform = pl;
		pl.waiting.add( p );
		p.x = x;
		p.z = z;
		// Facing the tracks (an island has them on both sides).
		const s = pl.island && rnd() < 0.5 ? - 1 : 1;
		p.yaw = Math.atan2( pl.nx * s, pl.nz * s ) + ( rnd() - 0.5 ) * 0.8;
		p.state = 'wait';
		play( p, 'Idle' );
		crowd.add( p.object );
		return p;

	}

	// Someone walking a list of points; at the end `then` ( p ).
	function walk( p, route, then, speed = WALK ) {

		p.route = route;
		p.then = then;
		p.state = 'walk';
		p.speed = speed;
		if ( p.act.Walk ) p.act.Walk.timeScale = speed / ( p.body.pace * p.scale );
		play( p, 'Walk' );

	}

	// --- a tram stops: people get off, the waiting get on
	trams.onArrive( ( t, stop ) => {

		const me = player();
		if ( ! me || ! stop || Math.hypot( stop.x - me.x, stop.z - me.z ) > RANGE ) return;
		const W = t.spec.width / 2, side = stop.side;
		// Off: at a door on the platform side, a step away from the tram, then along it and off the platform's end.
		const off = 1 + Math.floor( rnd() * 3 );
		for ( let k = 0; k < off; k ++ ) {

			const u = 2 + rnd() * ( t.length - 4 ), a = trams.place( t, u, side * ( W + 0.3 ) ), b = trams.place( t, u, side * ( W + 1.6 ) );
			const p = make();
			[ p.x, p.z, p.yaw ] = [ a.x, a.z, Math.atan2( b.x - a.x, b.z - a.z ) ];
			crowd.add( p.object );
			const dir = rnd() < 0.5 ? 1 : - 1, ahead = trams.place( t, dir > 0 ? - 14 : t.length + 14, side * ( W + 1.6 ) );
			p.delay = 0.4 + k * 0.9;
			p.state = 'hold';
			p.next = () => walk( p, [ [ b.x, b.z ], [ ahead.x, ahead.z ], [ ahead.x + ( ahead.x - b.x ) * 0.6, ahead.z + ( ahead.z - b.z ) * 0.6 ] ], drop );
			play( p, 'Idle' );

		}

		// On: the people waiting on this platform, one after another, each to the door nearest them.
		const pl = plats.find( q => q.x === stop.platform?.x && q.z === stop.platform?.z );
		if ( ! pl ) return;
		let k = 0;
		for ( const p of pl.waiting ) {

			if ( p.state !== 'wait' ) continue;
			p.delay = 1.6 + k ++ * 0.7 + rnd();
			p.state = 'hold';
			p.next = () => {

				if ( t.atStop !== stop ) return play( p, 'Idle' ), p.state = 'wait';
				const door = doorNear( t, p.x, p.z, side );
				p.boarding = { t, stop };
				// Up the steps into a high-floor tram on the last stretch.
				walk( p, [ [ door.out.x, door.out.z ], [ door.in.x, door.in.z, insideFloor( t ) ] ], q => {

					pl.waiting.delete( q );
					q.platform = null;
					if ( t.ridden && ride.inside?.( q, t, door.u ) ) return;
					drop( q );

				}, 1.7 );

			};

		}

		pl.refill = 14 + rnd() * 10;

	} );

	// How high the floor inside is over the street (src/tram-interior.js).
	const insideFloor = t => /^t3|kt8/.test( t.type ) ? 0.9 : 0.35;

	// The door nearest a point, on a side: a point just outside it and one just inside.
	function doorNear( t, x, z, side ) {

		const W = t.spec.width / 2;
		let best = 2, bd = Infinity;
		for ( let u = 1.5; u < t.length - 1; u += 1 ) {

			const q = trams.place( t, u, side * ( W + 0.4 ) ), d = Math.hypot( q.x - x, q.z - z );
			if ( d < bd ) [ best, bd ] = [ u, d ];

		}

		return { u: best, out: trams.place( t, best, side * ( W + 0.4 ) ), in: trams.place( t, best, side * ( W - 0.4 ) ) };

	}

	// What the ride (src/ride.js) does with someone who got on the tram the player rides.
	const ride = { inside: null };

	let tick = 0;
	function update( dt ) {

		const me = player();
		tick -= dt;
		if ( tick <= 0 && me ) {

			// Once a second: platforms coming into range get their waiting people, those going out of it lose them.
			tick = 1;
			for ( const pl of plats ) {

				const d = Math.hypot( pl.x - me.x, pl.z - me.z );
				if ( ! pl.live && d < RANGE ) {

					pl.live = true;
					for ( let k = 0; k < pl.want; k ++ ) waitAt( pl, ...spot( pl ) );

				} else if ( pl.live && d > DROP ) {

					pl.live = false;
					for ( const p of [ ...pl.waiting ] ) drop( p );

				}

				// After a tram has gone, someone new now and then, walking in from the platform's end.
				if ( pl.live && pl.waiting.size < pl.want && ( pl.refill -= 1 ) <= 0 ) {

					pl.refill = 6 + rnd() * 8;
					const end = rnd() < 0.5 ? 1 : - 1, [ fx, fz ] = spot( pl, end * 0.75, 0 ), [ tx, tz ] = spot( pl );
					const p = waitAt( pl, fx + pl.ax * end * 4, fz + pl.az * end * 4 );
					walk( p, [ [ fx, fz ], [ tx, tz ] ], q => {

						q.state = 'wait';
						play( q, 'Idle' );

					} );

				}

			}

			// Those who walked off out of range are dropped.
			for ( const p of [ ...people ] ) if ( ! p.inTram && Math.hypot( p.x - me.x, p.z - me.z ) > DROP ) drop( p );

		}

		for ( const p of people ) {

			if ( p.inTram ) {

				p.mixer.update( dt );
				continue;

			}

			if ( p.state === 'hold' ) {

				p.delay -= dt;
				if ( p.delay <= 0 ) p.next();

			} else if ( p.state === 'walk' && p.boarding && p.boarding.t.atStop !== p.boarding.stop ) {

				// Missed it: back to waiting where they are.
				p.boarding = null;
				p.lift = 0;
				p.state = 'wait';
				play( p, 'Idle' );

			} else if ( p.state === 'walk' ) {

				const [ tx, tz, lift ] = p.route[ 0 ], dx = tx - p.x, dz = tz - p.z, d = Math.hypot( dx, dz );
				if ( lift ) p.lift = Math.min( lift, ( p.lift || 0 ) + dt * 1.5 );
				if ( d < 0.25 ) {

					p.route.shift();
					if ( ! p.route.length ) {

						p.state = 'done';
						p.then?.( p );

					}

				} else {

					const step = Math.min( d, ( p.speed || WALK ) * dt );
					p.x += dx / d * step;
					p.z += dz / d * step;
					let turn = Math.atan2( dx, dz ) - p.yaw;
					turn = Math.atan2( Math.sin( turn ), Math.cos( turn ) );
					p.yaw += turn * Math.min( 1, dt * 8 );

				}

			}

			if ( ! people.has( p ) ) continue;
			p.y = groundHeight( p.x, p.z ) + ( p.lift || 0 );
			p.object.position.set( p.x, p.y, p.z );
			p.object.rotation.y = p.yaw;
			p.mixer.update( dt );

		}

	}

	// Riders in the tram the player rides: seated on some of the seats, one or two standing; inside the sections'
	// interior groups (so they ride along). `seats`: [ { group, x, z, floor } ]. Returns a function that removes them.
	function riders( seats, standing ) {

		// A handful: up to seven seated, on seats dealt out at random.
		const list = [], dealt = seats.map( s => [ rnd(), s ] ).sort( ( a, b ) => a[ 0 ] - b[ 0 ] ).slice( 0, Math.min( 7, Math.ceil( seats.length * 0.3 ) ) ).map( ( [ , s ] ) => s );
		for ( const s of dealt ) {

			const p = make( { sitting: true } );
			const sit = p.body.sitting;
			if ( ! sit || ! p.act.Sitting ) {

				drop( p );
				continue;

			}

			s.taken = true;
			p.inTram = true;
			p.object.position.set( s.x, s.floor + 0.45 - sit.bottom * p.scale, s.z - 0.06 - sit.hipsZ * p.scale );
			play( p, 'Sitting' );
			s.group.add( p.object );
			list.push( p );

		}

		for ( const s of standing ) {

			const p = make();
			p.inTram = true;
			p.object.position.set( s.x, s.floor, s.z );
			p.object.rotation.y = s.yaw;
			play( p, 'Idle' );
			s.group.add( p.object );
			list.push( p );

		}

		return () => list.forEach( drop );

	}

	return { update, riders, ride, people, drop, play, platforms: plats };

}
