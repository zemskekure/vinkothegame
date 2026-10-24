// Street life with Kenney's low-poly models (CC0, kenney.nl: Mini Characters, Car Kit; public/models/).
//   - People walk the pavement lines and pedestrian lanes from tools/places.mjs (to the end and back) with the
//     characters' walk animation; others sit on benches, at the café / pub / bar tables and on the bar stools.
//     Animated characters are costly, so a pool of them follows the people nearest the camera; the rest of the
//     crowd keeps moving unseen and comes into view as the camera nears.
//   - Cars stand at the kerbs where there is room to park (instanced, one batch per model), and a few drive the
//     streets in their lanes (right-hand traffic), slowing behind the car ahead, re-entering at the start of a lane
//     when they reach its end.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const PEOPLE = [ 'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f' ];
const CARS = { sedan: 5, 'hatchback-sports': 3, suv: 3, van: 2, taxi: 1, delivery: 1, 'sedan-sports': 2, 'suv-luxury': 2 }; // model: weight
const PERSON_HEIGHT = 1.45; // chibi figures: big heads, short legs
const CAR_LENGTH = 4.1;
const POOL_PER_TYPE = 5; // animated characters per model (12 models)
const VIEW_RADIUS = 75;

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

// One model's meshes merged into a single geometry (node transforms applied), scaled and standing on y = 0.
function mergedModel( gltf, length ) {

	const geos = [];
	let material = null;
	gltf.scene.updateMatrixWorld( true );
	gltf.scene.traverse( o => {

		if ( ! o.isMesh ) return;
		const g = o.geometry.clone().applyMatrix4( o.matrixWorld );
		for ( const name of Object.keys( g.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( name ) ) g.deleteAttribute( name );
		geos.push( g.index ? g.toNonIndexed() : g );
		material = material || o.material;

	} );

	const geometry = mergeGeometries( geos );
	geometry.computeBoundingBox();
	const b = geometry.boundingBox;
	const s = length / ( b.max.z - b.min.z );
	geometry.translate( - ( b.min.x + b.max.x ) / 2, - b.min.y, - ( b.min.z + b.max.z ) / 2 ).scale( s, s, s );
	const m = new THREE.MeshStandardNodeMaterial( { map: material.map, roughness: 0.6, metalness: 0.1 } );
	return { geometry, material: m };

}

// ---------------------------------------------------------------------------

export async function addLife( scene, life, { seats = [], benches = [], groundHeight, loadModel, camera } ) {

	if ( ! life ) return { update() {} };

	const [ peopleModels, carModels ] = await Promise.all( [
		Promise.all( PEOPLE.map( n => loadModel( `models/people/character-${n}.glb`, 'models/people/' ) ) ),
		Promise.all( Object.keys( CARS ).map( n => loadModel( `models/cars/${n}.glb`, 'models/cars/' ) ) )
	] );

	// --- agents: walkers spread over the lines by length, sitters on most chairs and stools and some benches
	const walks = life.walks.map( makePath ).filter( p => p.length > 8 );
	const total = walks.reduce( ( s, p ) => s + p.length, 0 );
	const agents = [];
	const walkerCount = Math.min( 260, Math.round( total / 12 ) );
	for ( let i = 0; i < walkerCount; i ++ ) {

		let r = rnd() * total, path = walks[ 0 ];
		for ( const p of walks ) {

			if ( r < p.length ) {

				path = p;
				break;

			}

			r -= p.length;

		}

		agents.push( { walk: true, path, s: r, dir: rnd() < 0.5 ? 1 : - 1, speed: 1.0 + rnd() * 0.5, side: ( rnd() - 0.5 ) * 0.5, type: Math.floor( rnd() * PEOPLE.length ), x: 0, y: 0, z: 0, yaw: 0, slot: null } );

	}

	for ( const [ x, y, z, rot ] of seats ) if ( rnd() < 0.75 ) agents.push( { walk: false, x, y, z, yaw: rot, type: Math.floor( rnd() * PEOPLE.length ), slot: null } );
	for ( let i = 0; i < benches.length; i += 5 ) {

		const [ x, y, z, rot ] = benches.slice( i, i + 5 );
		for ( const ox of [ - 0.45, 0.45 ] ) {

			// Bench model: seat along local x, sitters face its −z.
			if ( rnd() < 0.35 ) agents.push( { walk: false, x: x + Math.cos( rot ) * ox, y: y + 0.04, z: z - Math.sin( rot ) * ox, yaw: rot + Math.PI, type: Math.floor( rnd() * PEOPLE.length ), slot: null } );

		}

	}

	// --- the pool of animated characters, POOL_PER_TYPE of each model
	const slots = [];
	peopleModels.forEach( ( gltf, type ) => {

		const box = new THREE.Box3().setFromObject( gltf.scene );
		const scale = PERSON_HEIGHT / ( box.max.y - box.min.y );
		const clip = name => gltf.animations.find( a => a.name === name );
		for ( let k = 0; k < POOL_PER_TYPE; k ++ ) {

			const root = cloneSkinned( gltf.scene );
			root.scale.setScalar( scale );
			root.traverse( o => {

				if ( o.isMesh ) {

					o.castShadow = true;
					o.frustumCulled = false;

				}

			} );
			root.visible = false;
			scene.add( root );
			const mixer = new THREE.AnimationMixer( root );
			// The 'sit' clip sits on the floor (hips 0.026 model units up): lift to a 0.47 m seat.
			slots.push( { type, root, mixer, walk: mixer.clipAction( clip( 'walk' ) ), sit: mixer.clipAction( clip( 'sit' ) ), sitLift: 0.47 - 0.026 * scale, agent: null } );

		}

	} );

	// --- cars: one instanced batch per model; parked ones placed once, the moving ones after them in each batch
	const drives = life.drives.map( makePath ).filter( p => p.length > 25 );
	const carTypes = Object.keys( CARS );
	const weights = carTypes.map( n => CARS[ n ] ), wsum = weights.reduce( ( a, b ) => a + b, 0 );
	const pickCar = () => {

		let r = rnd() * wsum;
		for ( let i = 0; i < weights.length; i ++ ) if ( ( r -= weights[ i ] ) < 0 ) return i;
		return 0;

	};

	const parked = [];
	for ( let i = 0; i < life.parked.length; i += 4 ) parked.push( { type: pickCar(), p: life.parked.slice( i, i + 4 ) } );
	const movers = [];
	for ( let k = 0; k < Math.min( 18, drives.length ); k ++ ) {

		const path = drives[ Math.floor( rnd() * drives.length ) ];
		movers.push( { type: pickCar(), path, s: rnd() * path.length * 0.8, speed: 0, cruise: 6 + rnd() * 3 } );

	}

	const batches = carModels.map( ( gltf, type ) => {

		const { geometry, material } = mergedModel( gltf, CAR_LENGTH );
		const count = parked.filter( c => c.type === type ).length + movers.filter( c => c.type === type ).length;
		const mesh = new THREE.InstancedMesh( geometry, material, Math.max( 1, count ) );
		mesh.count = count;
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		scene.add( mesh );
		return { mesh, next: 0 };

	} );

	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3( 1, 1, 1 ), v = new THREE.Vector3();
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
	let assignTimer = 0, lastX = Infinity, lastZ = Infinity;

	// Hand the pool to the people nearest the camera.
	function assign() {

		const cx = camera.position.x, cz = camera.position.z;
		for ( const a of agents ) a.d = Math.hypot( a.x - cx, a.z - cz );
		const wanted = agents.filter( a => a.d < VIEW_RADIUS ).sort( ( a, b ) => a.d - b.d );
		const keep = new Set();
		const free = new Map( PEOPLE.map( ( _, t ) => [ t, [] ] ) );
		const budget = new Map( PEOPLE.map( ( _, t ) => [ t, POOL_PER_TYPE ] ) );
		for ( const a of wanted ) {

			if ( budget.get( a.type ) <= 0 ) continue;
			budget.set( a.type, budget.get( a.type ) - 1 );
			keep.add( a );

		}

		for ( const s of slots ) {

			if ( s.agent && ! keep.has( s.agent ) ) {

				s.agent.slot = null;
				s.agent = null;
				s.root.visible = false;

			}

			if ( ! s.agent ) free.get( s.type ).push( s );

		}

		for ( const a of keep ) {

			if ( a.slot ) continue;
			const s = free.get( a.type ).pop();
			if ( ! s ) continue;
			s.agent = a;
			a.slot = s;
			s.root.visible = true;
			s.mixer.stopAllAction();
			const action = a.walk ? s.walk : s.sit;
			action.reset().play();
			action.time = rnd() * action.getClip().duration;
			if ( a.walk ) action.timeScale = a.speed / 1.2;

		}

	}

	function update( dt ) {

		// Walkers move whether seen or not.
		for ( const a of agents ) {

			if ( ! a.walk ) continue;
			a.s += a.dir * a.speed * dt;
			if ( a.s > a.path.length - 0.5 ) a.dir = - 1;
			if ( a.s < 0.5 ) a.dir = 1;
			sample( a.path, a.s, at );
			a.x = at.x - at.dz * a.side * a.dir;
			a.z = at.z + at.dx * a.side * a.dir;
			a.yaw = Math.atan2( at.dx * a.dir, at.dz * a.dir );

		}

		// Re-pick the nearest people twice a second, or at once after a jump (switching to walking, teleporting).
		assignTimer -= dt;
		if ( assignTimer <= 0 || Math.hypot( camera.position.x - lastX, camera.position.z - lastZ ) > 10 ) {

			assignTimer = 0.5;
			lastX = camera.position.x;
			lastZ = camera.position.z;
			assign();

		}

		for ( const s of slots ) {

			const a = s.agent;
			if ( ! a ) continue;
			s.root.position.set( a.x, a.walk ? groundHeight( a.x, a.z ) : a.y + s.sitLift, a.z );
			s.root.rotation.y = a.yaw;
			s.mixer.update( dt );

		}

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

	update( 0 );
	return { update, slots, agents, people: agents.length, cars: parked.length + movers.length };

}
