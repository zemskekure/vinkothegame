// Street life:
//   - People: architectural scale figures (src/figures.js), one instanced batch per body part. They walk the
//     pavement lines and pedestrian lanes from tools/places.mjs (to the end and back) and sit on benches, at the
//     café / pub / bar tables and on the bar stools.
//   - Cars: Kenney's Car Kit (CC0, kenney.nl; public/models/cars).
//   - Cars stand at the kerbs where there is room to park (instanced, one batch per model), and a few drive the
//     streets in their lanes (right-hand traffic), slowing behind the car ahead, re-entering at the start of a lane
//     when they reach its end.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARTS, PART_TONE, TONES, pose, newPose, figureMaterial } from './figures.js';

const CARS = { sedan: 5, 'hatchback-sports': 3, suv: 3, van: 2, taxi: 1, delivery: 1, 'sedan-sports': 2, 'suv-luxury': 2 }; // model: weight
const CAR_LENGTH = 4.1;

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

	const carModels = await Promise.all( Object.keys( CARS ).map( n => loadModel( `models/cars/${n}.glb`, 'models/cars/' ) ) );

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

		agents.push( { walk: true, path, s: r, dir: rnd() < 0.5 ? 1 : - 1, speed: 1.0 + rnd() * 0.5, side: ( rnd() - 0.5 ) * 0.5, x: 0, y: 0, z: 0, yaw: 0, phase: rnd() * 6, scale: 0.94 + rnd() * 0.1 } );

	}

	// Seated figures sit 0.15 m back from the seat's centre (their thighs reach forward over it).
	const sitter = ( x, y, z, yaw ) => agents.push( { walk: false, x: x - Math.sin( yaw ) * 0.15, y, z: z - Math.cos( yaw ) * 0.15, yaw, scale: 0.94 + rnd() * 0.1 } );
	for ( const [ x, y, z, rot ] of seats ) if ( rnd() < 0.75 ) sitter( x, y - 0.03, z, rot );
	for ( let i = 0; i < benches.length; i += 5 ) {

		const [ x, y, z, rot ] = benches.slice( i, i + 5 );
		for ( const ox of [ - 0.45, 0.45 ] ) {

			// Bench model: seat along local x, sitters face its −z.
			if ( rnd() < 0.35 ) sitter( x + Math.cos( rot ) * ox, y, z - Math.sin( rot ) * ox, rot + Math.PI );

		}

	}

	// --- the crowd: one instanced mesh per body part, coloured top / bottom / head per person
	const crowd = PARTS.map( part => {

		const mesh = new THREE.InstancedMesh( part.geometry, figureMaterial(), agents.length );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		scene.add( mesh );
		return mesh;

	} );

	const col = new THREE.Color();
	agents.forEach( ( a, i ) => {

		const top = TONES[ Math.floor( rnd() * TONES.length ) ], bottom = TONES[ Math.floor( rnd() * TONES.length ) ];
		const tones = [ top, bottom, rnd() < 0.5 ? top : 0xeee9df ];
		PARTS.forEach( ( p, k ) => crowd[ k ].setColorAt( i, col.setHex( tones[ PART_TONE[ p.name ] ] ) ) );

	} );

	const parts = newPose(), base = new THREE.Matrix4(), scaleM = new THREE.Matrix4(), tmp = new THREE.Matrix4();
	const place = ( i, a, state ) => {

		pose( parts, state );
		base.makeRotationY( a.yaw ).setPosition( a.x, a.y, a.z ).multiply( scaleM.makeScale( a.scale, a.scale, a.scale ) );
		for ( let k = 0; k < PARTS.length; k ++ ) crowd[ k ].setMatrixAt( i, tmp.multiplyMatrices( base, parts[ k ] ) );

	};

	agents.forEach( ( a, i ) => {

		if ( ! a.walk ) place( i, a, { sit: true } );

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
	let time = 0;

	function update( dt ) {

		time += dt;
		agents.forEach( ( a, i ) => {

			if ( ! a.walk ) return;
			a.s += a.dir * a.speed * dt;
			if ( a.s > a.path.length - 0.5 ) a.dir = - 1;
			if ( a.s < 0.5 ) a.dir = 1;
			sample( a.path, a.s, at );
			a.x = at.x - at.dz * a.side * a.dir;
			a.z = at.z + at.dx * a.side * a.dir;
			a.y = groundHeight( a.x, a.z );
			a.yaw = Math.atan2( at.dx * a.dir, at.dz * a.dir );
			place( i, a, { phase: time * a.speed * 4.6 + a.phase, stride: Math.min( 1, a.speed / 1.3 ) } );

		} );

		for ( const m of crowd ) m.instanceMatrix.needsUpdate = true;

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
	return { update, agents, people: agents.length, cars: parked.length + movers.length };

}
