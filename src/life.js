// Street life:
//   - People: Quaternius' low-poly characters (CC0; src/people.js, public/models/people). They walk the pavement
//     lines and pedestrian lanes from tools/places.mjs (to the end and back), sit at the café / pub / bar tables,
//     on the bar stools and on benches, and a few stand about in pairs. Walkers near the camera are skinned and
//     animated; further away, and everyone seated or standing, they are instanced static poses.
//   - Cars: a late-90s Prague street mix (src/vehicles.js, public/models/vehicles): Škoda Octavias and Favorits, a
//     Trabant now and then, and low-poly sedans, hatchbacks, SUVs, vans, taxis and a police car (Kenney, CC0).
//   - Cars stand at the kerbs where there is room to park (instanced, one batch per model), and a few drive the
//     streets in their lanes (right-hand traffic), slowing behind the car ahead, re-entering at the start of a lane
//     when they reach its end.

import * as THREE from 'three/webgpu';
import { BODIES, dress, loadWardrobe, useWardrobe, prepareBody, preparePosed, makeSkinned, makeBatch } from './people.js';
import { SETTINGS } from './settings.js';
import { vehicleModel } from './vehicles.js';

// model: [ weight, real length in metres ]
const CARS = {
	'car-octavia': [ 4, 4.51 ], 'car-favorit': [ 4, 3.82 ], 'car-trabant': [ 1, 3.56 ], 'kenney-sedan': [ 2, 4.5 ],
	'kenney-hatchback-sports': [ 1, 4.1 ], 'kenney-suv': [ 2, 4.6 ], 'kenney-van': [ 1, 4.9 ], 'kenney-delivery': [ 1, 5.4 ],
	'kenney-taxi': [ 2, 4.6 ], 'kenney-police': [ 0.5, 4.6 ]
};

const rnd = ( () => {

	let s = 987654;
	return () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;

} )();

// Polylines (flat x, z arrays) with cumulative lengths, sampled by distance.
function makePath( flat ) {

	const pts = [];
	for ( let i = 0; i < flat.length; i += 2 ) pts.push( [ flat[ i ], flat[ i + 1 ] ] );
	const cum = [ 0 ];
	for ( let i = 1; i < pts.length; i ++ ) cum.push( cum[ i - 1 ] + Math.hypot( pts[ i ][ 0 ] - pts[ i - 1 ][ 0 ], pts[ i ][ 1 ] - pts[ i - 1 ][ 1 ] ) );
	return { pts, cum, length: cum[ cum.length - 1 ] };

}

function sample( path, s, out ) {

	const { pts, cum } = path;
	s = Math.max( 0, Math.min( path.length - 1e-6, s ) );
	let lo = 0, hi = cum.length - 1;
	while ( hi - lo > 1 ) {

		const mid = ( lo + hi ) >> 1;
		if ( cum[ mid ] <= s ) lo = mid; else hi = mid;

	}

	const t = ( s - cum[ lo ] ) / ( cum[ hi ] - cum[ lo ] || 1 );
	const a = pts[ lo ], b = pts[ hi ];
	out.x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t;
	out.z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t;
	out.dx = b[ 0 ] - a[ 0 ];
	out.dz = b[ 1 ] - a[ 1 ];
	const l = Math.hypot( out.dx, out.dz ) || 1;
	out.dx /= l;
	out.dz /= l;
	return out;

}

// ---------------------------------------------------------------------------

export async function addLife( scene, life, { seats = [], benches = [], groundHeight, loadModel, camera, cars = true } ) {

	if ( ! life ) return { update() {} };

	const carModels = cars ? await Promise.all( Object.entries( CARS ).map( ( [ n, [ , length ] ] ) => vehicleModel( loadModel, n, length ) ) ) : [];

	// --- people (src/people.js): the wardrobe and the bodies, loaded once
	const wardrobe = await loadWardrobe();
	useWardrobe( wardrobe );
	const [ bodies, posed ] = await Promise.all( [
		Promise.all( BODIES.map( async b => prepareBody( await loadModel( `models/people/${b.file}.glb`, 'models/people/' ), b ) ) ),
		Promise.all( [ 'male', 'female' ].map( async n => preparePosed( await loadModel( `models/people/posed-humans/${n}.glb`, 'models/people/' ) ) ) )
	] );
	const sitters = bodies.filter( b => b.sitting );
	// The 2019 bodies a little more often than the modular ones: they are the everyday clothes.
	const pickBody = () => rnd() < 0.55 ? Math.floor( rnd() * 8 ) : 8 + Math.floor( rnd() * ( bodies.length - 8 ) );
	const heightOf = sex => sex === 'f' ? 1.6 + rnd() * 0.13 : 1.72 + rnd() * 0.14;

	// --- agents: walkers spread over the lines by length, sitters on most chairs and stools and some benches,
	// a few people standing about in pairs
	const walks = life.walks.map( makePath ).filter( p => p.length > 8 );
	const total = walks.reduce( ( s, p ) => s + p.length, 0 );
	// Where people walk (game settings, `people.spawnZones`): every piece of every line is weighted by its length and
	// by how close it is to the zones (each zone adds `weight` at its centre, falling off over `r` metres). By default
	// one zone on Betlémské náměstí: more people round the square and the streets off it than out at the edges.
	// `placeWalkers( zones )` deals the walkers out again, so the admin page can show a change at once.
	let pieces = [], weightSum = 0;
	const weigh = zones => {

		pieces = [];
		weightSum = 0;
		for ( const p of walks ) for ( let i = 1; i < p.pts.length; i ++ ) {

			const len = p.cum[ i ] - p.cum[ i - 1 ];
			if ( len <= 0 ) continue;
			const mx = ( p.pts[ i ][ 0 ] + p.pts[ i - 1 ][ 0 ] ) / 2, mz = ( p.pts[ i ][ 1 ] + p.pts[ i - 1 ][ 1 ] ) / 2;
			let w = 1;
			for ( const zn of zones ) w += Math.max( 0, zn.weight || 0 ) * Math.exp( - Math.hypot( mx - zn.x, mz - zn.z ) / Math.max( 1, zn.r || 1 ) );
			weightSum += len * w;
			pieces.push( { p, s0: p.cum[ i - 1 ], len, upto: weightSum } );

		}

	};

	weigh( SETTINGS.people.spawnZones || [] );
	const along = () => {

		const r = rnd() * weightSum;
		let lo = 0, hi = pieces.length - 1;
		while ( lo < hi ) {

			const mid = ( lo + hi ) >> 1;
			if ( pieces[ mid ].upto > r ) hi = mid; else lo = mid + 1;

		}

		const piece = pieces[ lo ];
		return piece ? [ piece.p, piece.s0 + rnd() * piece.len ] : [ walks[ 0 ], 0 ];

	};

	const agents = [];
	const walkerCount = Math.max( 0, Math.round( SETTINGS.people.walkers ?? Math.min( 220, total / 12 ) ) );
	for ( let i = 0; i < walkerCount; i ++ ) {

		const [ path, s ] = along(), body = pickBody(), sex = bodies[ body ].spec.sex;
		agents.push( { walk: true, path, s, dir: rnd() < 0.5 ? 1 : - 1, speed: 1.0 + rnd() * 0.45, side: ( rnd() - 0.5 ) * 0.5, x: 0, y: 0, z: 0, yaw: 0, phase: rnd(), body, height: heightOf( sex ), look: dress( rnd, sex, wardrobe ) } );

	}

	// Seated people: on chairs (seat 0.45 m) in the 2019 bodies' sitting pose, hips a little back from the seat's
	// centre towards the backrest; on benches (seat 0.46 m) in the posed humans' sitting pose.
	const seated = sitters.map( () => [] ), posedAt = new Map();
	const sitAt = ( x, y, z, yaw, seatH, back ) => {

		const k = Math.floor( rnd() * sitters.length ), b = sitters[ k ], h = heightOf( b.spec.sex ), sc = h / b.height;
		const fx = Math.sin( yaw ), fz = Math.cos( yaw ), o = back + b.sitting.hipsZ * sc;
		const a = { walk: false, x: x - fx * o, y, z: z - fz * o, yaw, oy: seatH - b.sitting.bottom * sc + 0.01, scale: sc, look: dress( rnd, b.spec.sex, wardrobe ) };
		agents.push( a );
		seated[ k ].push( a );

	};

	const posedPerson = ( x, y, z, yaw, pose, sex = rnd() < 0.5 ? 0 : 1 ) => {

		const P = posed[ sex ], h = heightOf( sex ? 'f' : 'm' );
		const a = { walk: false, posed: true, x, y, z, yaw, oy: 0, scale: h / P.height, look: dress( rnd, sex ? 'f' : 'm', wardrobe ) };
		const key = sex + pose;
		if ( ! posedAt.has( key ) ) posedAt.set( key, { geometry: P.geometry( pose ), list: [] } );
		posedAt.get( key ).list.push( a );
		agents.push( a );
		return a;

	};

	for ( const [ x, y, z, rot, h = 0.45 ] of seats ) if ( rnd() < SETTINGS.people.seatedShare ) sitAt( x, y, z, rot, h, 0.06 );
	for ( let i = 0; i < benches.length; i += 5 ) {

		const [ x, y, z, rot ] = benches.slice( i, i + 5 );
		for ( const ox of [ - 0.45, 0.45 ] ) {

			// Bench model: seat along local x, sitters face its −z; the hips over the back third of the seat.
			if ( rnd() >= SETTINGS.people.benchShare ) continue;
			const yaw = rot + Math.PI, fx = Math.sin( yaw ), fz = Math.cos( yaw );
			const sex = rnd() < 0.5 ? 0 : 1, seat = posed[ sex ].seat( 'Sitting' );
			const a = posedPerson( 0, y, 0, yaw, 'Sitting', sex );
			const o = 0.08 + seat.z * a.scale;
			a.x = x + Math.cos( rot ) * ox - fx * o;
			a.z = z - Math.sin( rot ) * ox - fz * o;
			a.oy = 0.47 - seat.bottom * a.scale;

		}

	}

	// People standing about: pairs talking at the edge of a pavement, someone looking up at the houses.
	const sample0 = { x: 0, z: 0, dx: 0, dz: 1 };
	for ( let i = 0; i < SETTINGS.people.standing; i ++ ) {

		const [ path, s ] = along();
		sample( path, s, sample0 );
		const { x, z, dx, dz } = sample0;
		if ( rnd() < 0.3 ) {

			posedPerson( x, groundHeight( x, z ), z, rnd() * Math.PI * 2, rnd() < 0.5 ? 'LookingUp' : 'Standing_Hips' );
			continue;

		}

		// Two people along the line, 0.8 m apart, facing each other.
		for ( const side of [ 1, - 1 ] ) {

			const px = x + dx * 0.4 * side, pz = z + dz * 0.4 * side;
			posedPerson( px, groundHeight( px, pz ), pz, Math.atan2( - dx * side, - dz * side ), rnd() < 0.7 ? 'Standing' : 'Standing_Hips' );

		}

	}

	// --- static people: instanced batches (seated per body, posed per pose and hairstyle)
	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3( 1, 1, 1 ), v = new THREE.Vector3(), sv = new THREE.Vector3();
	const setAt = ( mesh, i, a, y ) => {

		q.setFromAxisAngle( v.set( 0, 1, 0 ), a.yaw );
		mesh.setMatrixAt( i, m4.compose( v.set( a.x, y, a.z ), q, sv.setScalar( a.scale ) ) );
		mesh.setLook( i, a.look );

	};

	const statics = [ ...sitters.map( ( b, k ) => [ b.sitting.geometry, seated[ k ] ] ), ...[ ...posedAt.values() ].map( p => [ p.geometry, p.list ] ) ];
	for ( const [ geometry, list ] of statics ) {

		if ( ! list.length ) continue;
		const mesh = makeBatch( geometry, list.length );
		list.forEach( ( a, i ) => setAt( mesh, i, a, a.y + a.oy ) );
		scene.add( mesh );

	}

	// --- walkers: skinned and animated near the camera, instanced in a mid-stride pose further away
	const NEAR = 60, MAX_NEAR = 48;
	const far = bodies.map( ( b, k ) => {

		const list = agents.filter( a => a.walk && a.body === k );
		list.forEach( ( a, i ) => a.slot = i );
		const mesh = makeBatch( b.walking, list.length );
		list.forEach( ( a, i ) => mesh.setLook( i, a.look ) );
		scene.add( mesh );
		return mesh;

	} );

	const crowd = new THREE.Group();
	scene.add( crowd );
	const near = ( a ) => {

		if ( ! a.skinned ) {

			const b = bodies[ a.body ];
			a.skinned = makeSkinned( b, a.look, a.height );
			const act = a.skinned.mixer.clipAction( b.clips.Walk );
			act.play();
			act.time = a.phase * b.clips.Walk.duration;
			// Feet in step with the ground: the clip's own pace scaled to this person.
			act.timeScale = a.speed / ( b.pace * a.skinned.scale );

		}

		return a.skinned;

	};

	const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere( new THREE.Vector3(), 1.2 );
	const walkers = agents.filter( a => a.walk );

	// --- cars: one instanced batch per model; parked ones placed once, the moving ones after them in each batch
	const drives = life.drives.map( makePath ).filter( p => p.length > 25 );
	const carTypes = Object.keys( CARS );
	const weights = carTypes.map( n => CARS[ n ][ 0 ] ), wsum = weights.reduce( ( a, b ) => a + b, 0 );
	const pickCar = () => {

		let r = rnd() * wsum;
		for ( let i = 0; i < weights.length; i ++ ) if ( ( r -= weights[ i ] ) < 0 ) return i;
		return 0;

	};

	const parked = [];
	if ( cars ) for ( let i = 0; i < life.parked.length; i += 4 ) parked.push( { type: pickCar(), p: life.parked.slice( i, i + 4 ) } );
	const movers = [];
	for ( let k = 0; k < ( cars ? Math.min( 18, drives.length ) : 0 ); k ++ ) {

		const path = drives[ Math.floor( rnd() * drives.length ) ];
		movers.push( { type: pickCar(), path, s: rnd() * path.length * 0.8, speed: 0, cruise: 6 + rnd() * 3 } );

	}

	const batches = carModels.map( ( { geometry, material }, type ) => {

		const count = parked.filter( c => c.type === type ).length + movers.filter( c => c.type === type ).length;
		const mesh = new THREE.InstancedMesh( geometry, material, Math.max( 1, count ) );
		mesh.count = count;
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		scene.add( mesh );
		return { mesh, next: 0 };

	} );

	const placeCar = ( batch, i, x, y, z, yaw, pitch = 0 ) => {

		q.setFromEuler( e.set( pitch, yaw, 0, 'YXZ' ) );
		batch.mesh.setMatrixAt( i, m4.compose( v.set( x, y, z ), q, one ) );

	};

	for ( const c of parked ) {

		const b = batches[ c.type ];
		placeCar( b, b.next ++, c.p[ 0 ], c.p[ 1 ], c.p[ 2 ], c.p[ 3 ] );

	}

	for ( const m of movers ) {

		m.batch = batches[ m.type ];
		m.index = m.batch.next ++;

	}

	// ---------------------------------------------------------------------------

	const at = { x: 0, z: 0, dx: 0, dz: 1 }, at2 = { x: 0, z: 0, dx: 0, dz: 1 };
	let time = 0;

	function update( dt ) {

		time += dt;
		for ( const a of walkers ) {

			a.s += a.dir * a.speed * dt;
			if ( a.s > a.path.length - 0.5 ) a.dir = - 1;
			if ( a.s < 0.5 ) a.dir = 1;
			sample( a.path, a.s, at );
			a.x = at.x - at.dz * a.side * a.dir;
			a.z = at.z + at.dx * a.side * a.dir;
			a.y = groundHeight( a.x, a.z );
			a.yaw = Math.atan2( at.dx * a.dir, at.dz * a.dir );
			a.d = Math.hypot( a.x - camera.position.x, a.z - camera.position.z );

		}

		// The nearest walkers in view are skinned and animated (at most MAX_NEAR), the rest instanced.
		frustum.setFromProjectionMatrix( pv.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ) );
		const close = walkers.filter( a => a.d < NEAR && frustum.intersectsSphere( sphere.set( sphere.center.set( a.x, a.y + 0.9, a.z ), 1.2 ) ) ).sort( ( p, r ) => p.d - r.d ).slice( 0, MAX_NEAR );
		const live = new Set( close );
		for ( const a of walkers ) {

			const mesh = far[ a.body ];
			if ( live.has( a ) ) {

				const { object, mixer } = near( a );
				if ( ! object.parent ) crowd.add( object );
				object.position.set( a.x, a.y, a.z );
				object.rotation.y = a.yaw;
				mixer.update( dt );
				mesh.setMatrixAt( a.slot, m4.makeScale( 0, 0, 0 ) );

			} else {

				if ( a.skinned?.object.parent ) crowd.remove( a.skinned.object );
				q.setFromAxisAngle( v.set( 0, 1, 0 ), a.yaw );
				const sc = a.height / bodies[ a.body ].height;
				mesh.setMatrixAt( a.slot, m4.compose( v.set( a.x, a.y, a.z ), q, sv.setScalar( sc ) ) );

			}

		}

		for ( const m of far ) m.instanceMatrix.needsUpdate = true;

		for ( const m of movers ) {

			// Slow down behind a car ahead on the same lane.
			let gap = Infinity;
			for ( const o of movers ) if ( o !== m && o.path === m.path && o.s > m.s ) gap = Math.min( gap, o.s - m.s );
			const target = gap < 9 ? 0 : gap < 20 ? m.cruise * ( gap - 9 ) / 11 : m.cruise;
			m.speed += Math.max( - 6 * dt, Math.min( 2.5 * dt, target - m.speed ) );
			m.s += m.speed * dt;
			if ( m.s > m.path.length - 1 ) {

				// Re-enter at the start of some lane that is clear there.
				const path = drives[ Math.floor( rnd() * drives.length ) ];
				if ( movers.every( o => o.path !== path || o.s > 12 ) ) {

					m.path = path;
					m.s = 0;
					m.speed = m.cruise * 0.5;

				} else m.s = m.path.length - 1;

			}

			sample( m.path, m.s, at );
			sample( m.path, Math.min( m.path.length, m.s + 3.5 ), at2 );
			const y = groundHeight( at.x, at.z ), y2 = groundHeight( at2.x, at2.z );
			placeCar( m.batch, m.index, at.x, y, at.z, Math.atan2( at.dx, at.dz ), - Math.atan2( y2 - y, 3.5 ) );

		}

		for ( const b of batches ) b.mesh.instanceMatrix.needsUpdate = true;

	}

	function placeWalkers( zones ) {

		weigh( zones );
		for ( const a of walkers ) [ a.path, a.s ] = along();

	}

	update( 0 );
	return { update, placeWalkers, walks, agents, bodies, people: agents.length, cars: parked.length + movers.length };

}
