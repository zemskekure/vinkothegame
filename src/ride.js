// Riding the tram. At a stop, while a tram stands with its doors open (src/trams.js, ~12 s), "[E] nastoupit" shows
// near it; E puts one inside, in the aisle by the nearest door, seen through one's own eyes. The inside is built
// for that tram only (src/tram-interior.js) and its sections lose their faces at the joints, so one can walk
// through it; some people sit and stand in it (src/passengers.js). W A S D walk the aisle, C sits on the nearest free
// seat (any key stands up again). The tram goes on along its line with the city passing outside; a board shows the
// line and the next stop ("Příští zastávka: Národní divadlo"). At the next stop, with the doors open, "[E] vystoupit"
// puts one on the platform beside the door. At the end of the line (no stop left before the city's edge) it waits
// until one gets off. On the scooter one can't get on: first B to get off it.

import { sectionInterior, insideOf } from './tram-interior.js';

// Where the doors are, as shares of a car's length from its front.
const DOORS = { t3: 3, t3_historic: 3, kt8: 4, '15t': 6, '14t': 5, '52t': 5 };
const doorShares = type => {

	const n = DOORS[ type ] ?? 4;
	return Array.from( { length: n }, ( _, i ) => 0.1 + 0.8 * i / ( n - 1 ) );

};

export function startRide( { trams, walker, hud, passengers, groundHeight, isBlocked } ) {

	let aboard = null, wantE = false, wantC = false, shown = '';
	addEventListener( 'keydown', e => {

		if ( e.repeat || hud.paused || e.target.closest?.( 'input, textarea, select' ) ) return;
		if ( e.code === 'KeyE' ) wantE = true;
		if ( e.code === 'KeyC' ) wantC = true;

	} );

	// The tram standing with its doors open that one is next to (within 3 m of its side), if any.
	function tramBeside() {

		const p = walker.pos;
		let best = null, bd = 3;
		for ( const t of trams.trams ) {

			if ( ! t.atStop || t.dwell < 1.2 || ! trams.nextStop( t ) ) continue;
			const head = t.sections[ 0 ].model.position;
			if ( Math.hypot( head.x - p.x, head.z - p.z ) > t.length + 10 ) continue;
			for ( const sec of t.sections ) {

				const q = sec.model.position, yaw = sec.model.rotation.y, dx = p.x - q.x, dz = p.z - q.z;
				const lz = dx * Math.sin( yaw ) + dz * Math.cos( yaw ), lx = dx * Math.cos( yaw ) - dz * Math.sin( yaw );
				const d = Math.max( Math.abs( lz ) - sec.L / 2, 0 ) + Math.max( Math.abs( lx ) - t.spec.width / 2, 0 );
				if ( d < bd ) {

					bd = d;
					best = { t, sec, u: sec.front + sec.L / 2 - lz };

				}

			}

		}

		return best;

	}

	function board( { t, u } ) {

		const look = insideOf( t.type ), W = t.spec.width / 2;
		// The car one stands in: its aisle from behind the driver's cab to the back wall.
		let car = t.sections[ 0 ].car;
		for ( const sec of t.sections ) if ( u >= sec.front - 0.5 ) car = sec.car;
		const own = t.sections.filter( sec => sec.car === car );
		const front = own[ 0 ].front, back = own.at( - 1 ).front + own.at( - 1 ).L;
		const range = [ front + look.cab + 0.35, back - look.rearCab - 0.35 ];
		const doorsU = doorShares( t.type ).map( f => front + f * ( back - front ) );

		// The insides, and the shell open at the joints.
		const seats = [], standing = [], groups = [];
		for ( const sec of t.sections ) {

			const ofCar = t.sections.filter( s => s.car === sec.car );
			const cf = ofCar[ 0 ].front, cb = ofCar.at( - 1 ).front + ofCar.at( - 1 ).L;
			const doors = doorShares( t.type ).map( f => sec.L / 2 - ( cf + f * ( cb - cf ) - sec.front ) );
			const inside = sectionInterior( t.type, t.spec, { L: sec.L, k: sec.k, n: ofCar.length }, doors );
			sec.model.geometry = sec.shape.open;
			sec.model.add( inside.group );
			groups.push( { sec, group: inside.group } );
			for ( const s of inside.seats ) seats.push( { ...s, group: inside.group, floor: inside.floor, u: sec.front + sec.L / 2 - s.z, sec } );
			for ( const d of doors ) if ( d > inside.z0 + 0.5 && d < inside.z1 - 0.5 && Math.random() < 0.35 ) standing.push( { x: ( Math.random() < 0.5 ? - 1 : 1 ) * 0.35, z: d + 0.5, yaw: Math.random() * 6.28, floor: inside.floor, group: inside.group } );

		}

		const clearRiders = passengers?.riders( seats, standing.slice( 0, 2 ) ) ?? ( () => {} );
		t.ridden = true;
		const start = Math.min( range[ 1 ], Math.max( range[ 0 ], doorsU.reduce( ( a, d ) => Math.abs( d - u ) < Math.abs( a - u ) ? d : a, doorsU[ 0 ] ) ) );
		aboard = { t, u: start, w: 0, W, look, range, seats, groups, clearRiders, seat: null, lastYaw: null, firstPerson: walker.firstPerson };
		// Someone who got on the tram one rides stands inside by the door they took.
		if ( passengers ) passengers.ride.inside = ( p, tram, du ) => {

			if ( ! aboard || tram !== aboard.t ) return false;
			const at = trams.place( tram, du, 0 ), g = groups.find( q => q.sec === at.sec );
			if ( ! g ) return false;
			p.inTram = true;
			p.object.position.set( Math.random() < 0.5 ? - 0.3 : 0.3, look.floor, at.lz );
			p.object.rotation.y = Math.random() * 6.28;
			passengers.play( p, 'Idle' );
			g.group.add( p.object );
			aboard.extra ||= [];
			aboard.extra.push( p );
			return true;

		};

		walker.aboard = { step: ( w, dt ) => step( dt ), off: () => leave( null ) };
		walker.keys.clear();
		walker.setFirstPerson( true );
		walker.pitch = 0;
		step( 0 );
		hud.hints( 'tram', 8 );

	}

	// Off the tram. `stop`: where one gets off (the platform side), or null when taken off some other way (the big
	// map, the view from above): then just away from the tram.
	function leave( stop ) {

		if ( ! aboard ) return;
		const { t, W } = aboard;
		const sides = stop ? [ stop.side, - stop.side ] : [ - 1, 1 ];
		let spot = null;
		search: for ( const side of sides ) for ( const du of [ 0, 1, - 1, 2, - 2, 4, - 4, 7, - 7 ] ) {

			const q = trams.place( t, aboard.u + du, side * ( W + 0.8 ) );
			if ( ! isBlocked( q.x, q.z ) ) {

				spot = { x: q.x, z: q.z, yaw: q.yaw };
				break search;

			}

		}

		for ( const { sec, group } of aboard.groups ) {

			sec.model.remove( group );
			group.userData.dispose();
			sec.model.geometry = sec.shape.geometry;

		}

		aboard.clearRiders();
		for ( const p of aboard.extra || [] ) passengers.drop( p );
		if ( passengers ) passengers.ride.inside = null;
		t.ridden = false;
		const fp = aboard.firstPerson;
		aboard = null;
		walker.aboard = null;
		walker.eye = 1.65;
		walker.setFirstPerson( fp );
		hud.tram( null );
		if ( spot ) {

			// Facing the way the tram goes, beside it, the camera behind along the platform (heading: where the figure
			// faces), to watch it pull away.
			walker.placed = false;
			walker.pos.set( spot.x, groundHeight( spot.x, spot.z ), spot.z );
			walker.y = walker.pos.y;
			walker.placed = true;
			walker.heading = spot.yaw;
			walker.yaw = spot.yaw + Math.PI;
			walker.apply( 0 );

		}

	}

	// One frame aboard: walk the aisle (in the tram's own frame), sit, and the eyes where one is.
	const at = {};
	function step( dt ) {

		const a = aboard, k = walker.keys;
		const forward = ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 ) - ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 );
		const strafe = ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 );
		trams.place( a.t, a.u, a.w, a.look.floor, at );
		// The view turns with the tram.
		if ( a.lastYaw !== null ) {

			const turn = at.yaw - a.lastYaw;
			walker.yaw += turn;
			walker.heading += turn;

		}

		a.lastYaw = at.yaw;
		if ( ( forward || strafe ) && dt ) {

			if ( a.seat ) {

				// Up from the seat into the aisle.
				a.seat.taken = false;
				a.seat = null;
				a.w = 0;

			}

			const len = Math.hypot( forward, strafe ), sin = Math.sin( walker.yaw ), cos = Math.cos( walker.yaw );
			const mx = ( - sin * forward + cos * strafe ) / len, mz = ( - cos * forward - sin * strafe ) / len;
			const speed = k.has( 'ShiftLeft' ) || k.has( 'ShiftRight' ) ? 2.4 : 1.4;
			const s = Math.sin( at.yaw ), c = Math.cos( at.yaw );
			a.u -= ( mx * s + mz * c ) * speed * dt;
			a.w += ( mx * c - mz * s ) * speed * dt;
			a.u = Math.min( a.range[ 1 ], Math.max( a.range[ 0 ], a.u ) );
			a.w = Math.min( 0.45, Math.max( - 0.45, a.w ) );

		}

		trams.place( a.t, a.u, a.w, a.look.floor, at );
		walker.pos.set( at.x, at.y, at.z );
		walker.y = at.y;
		walker.eye = a.seat ? 1.2 : 1.62;
		walker.stride = 0;
		walker.apply( dt );

	}

	function sit() {

		const a = aboard;
		let best = null, bd = 1.6;
		for ( const s of a.seats ) {

			if ( s.taken || s.u < a.range[ 0 ] - 0.5 || s.u > a.range[ 1 ] + 0.5 ) continue;
			const d = Math.abs( s.u - a.u ) + Math.abs( s.x - a.w ) * 0.3;
			if ( d < bd ) [ best, bd ] = [ s, d ];

		}

		if ( ! best ) return;
		best.taken = true;
		a.seat = best;
		a.u = best.u + 0.05;
		a.w = best.x;
		// Facing forward, the way the seats face.
		walker.yaw = a.lastYaw + Math.PI;
		walker.heading = a.lastYaw;
		walker.pitch = 0;

	}

	// The board, the prompts and E / C: called every frame on foot (`active`), after the walker.
	function update( active ) {

		let prompt = '';
		if ( aboard ) {

			const t = aboard.t, next = trams.nextStop( t ), open = t.atStop && t.dwell > 0.4;
			const line = t.line ? String( t.line ) : '';
			if ( open && ! next ) hud.tram( line, 'Konečná zastávka', 'Prosíme, vystupte.' );
			else if ( open ) hud.tram( line, `Zastávka: ${t.atStop.name}`, next ? `Příští: ${next.name}` : '' );
			else hud.tram( line, `Příští zastávka: ${next ? next.name : 'konečná'}`, '' );
			if ( open ) prompt = 'vystoupit';
			if ( wantE && open ) leave( t.atStop );
			if ( wantC && aboard && ! aboard.seat ) sit();

		} else if ( active ) {

			const near = tramBeside();
			if ( near && walker.riding ) prompt = 'skutr';
			else if ( near ) prompt = 'nastoupit';
			if ( wantE && near && ! walker.riding ) board( near );

		}

		wantE = wantC = false;
		if ( prompt !== shown ) {

			shown = prompt;
			hud.prompt( prompt === 'skutr' ? [ [ [ 'B' ], 'slézt ze skútru' ], [ [ 'E' ], 'nastoupit' ] ] : prompt ? [ [ [ 'E' ], prompt ] ] : null, hud.touch && prompt && prompt !== 'skutr' ? () => wantE = true : null );

		}

	}

	return { update, get aboard() {

		return aboard;

	}, leave: () => leave( null ) };

}
