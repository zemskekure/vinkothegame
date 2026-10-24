// Street life: stylised people and cars (simple solids in a muted palette, not realistic models).
//   - People walk the pavement lines and pedestrian lanes from tools/places.mjs (to the end and back), swinging
//     arms and legs; others sit on benches, at the café / pub / bar tables and on the bar stools.
//   - Cars stand at the kerbs where there is room to park, and a few drive the streets in their lanes
//     (right-hand traffic), slowing behind the car ahead, re-entering at the start of a lane when they reach its end.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COATS = [ 0x2c3e5c, 0xb8862e, 0x9b4a32, 0x2f6f6a, 0x3a3d40, 0xe6dccb, 0x6b7340, 0x6e2a35, 0x4f6d8f, 0xc9b79c, 0x8a5a7a, 0x1e2a33 ];
const TROUSERS = [ 0x2b2d31, 0x3c4f6e, 0x1b1c1e, 0xb7a68a, 0x4a4036, 0x5b6470 ];
const SKIN = [ 0xf1c9a5, 0xe0ac84, 0xc68a62, 0x9b6a48, 0x6e4a33, 0xf5d6bd ];
const HAIR = [ 0x2a1f19, 0x4a3324, 0x8a6a3e, 0xd9c08a, 0xa8a49c, 0x1a1a1a, 0x7a3a1e ];
const CARS = [ 0xf0efea, 0xf0efea, 0x3a3d40, 0x1d1f21, 0x9ba1a6, 0xa8443a, 0x2f6f6a, 0x2c3e5c, 0xc9a13b, 0x8fa38a, 0x4b6b3c, 0xe8e0c8 ];

const rnd = ( () => {

	let s = 987654;
	return () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;

} )();
const pick = list => list[ Math.floor( rnd() * list.length ) ];

const mat = ( opts ) => new THREE.MeshStandardNodeMaterial( { roughness: 0.75, ...opts } );

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
// People: legs and arms pivot at hip and shoulder; one instanced mesh per body part.

const BODY = {
	leg: new THREE.CylinderGeometry( 0.075, 0.06, 0.84, 7 ).translate( 0, - 0.42, 0 ),
	torso: new THREE.CylinderGeometry( 0.17, 0.215, 0.64, 9 ).translate( 0, 0.32, 0 ),
	arm: new THREE.CylinderGeometry( 0.05, 0.042, 0.6, 6 ).translate( 0, - 0.3, 0 ),
	head: new THREE.SphereGeometry( 0.115, 12, 8 ),
	hair: new THREE.SphereGeometry( 0.125, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55 ).translate( 0, 0.012, - 0.01 )
};

class People {

	constructor( scene, count ) {

		this.count = count;
		const make = ( geo, n ) => {

			const m = new THREE.InstancedMesh( geo, mat( {} ), n );
			m.castShadow = true;
			m.frustumCulled = false;
			scene.add( m );
			return m;

		};

		this.legs = make( BODY.leg, count * 2 );
		this.arms = make( BODY.arm, count * 2 );
		this.torso = make( BODY.torso, count );
		this.head = make( BODY.head, count );
		this.hair = make( BODY.hair, count );
		const c = new THREE.Color();
		for ( let i = 0; i < count; i ++ ) {

			const coat = pick( COATS ), trousers = pick( TROUSERS );
			for ( const k of [ 0, 1 ] ) {

				this.legs.setColorAt( i * 2 + k, c.setHex( trousers ) );
				this.arms.setColorAt( i * 2 + k, c.setHex( coat ) );

			}

			this.torso.setColorAt( i, c.setHex( coat ) );
			this.head.setColorAt( i, c.setHex( pick( SKIN ) ) );
			this.hair.setColorAt( i, c.setHex( pick( HAIR ) ) );

		}

		this.m = new THREE.Matrix4();
		this.part = new THREE.Matrix4();
		this.rot = new THREE.Matrix4();

	}

	// pose: legs / arms angles (rad, forward positive), hip height above y, lean.
	set( i, x, y, z, yaw, legA, armA, hip, scale = 1 ) {

		const base = this.m.makeRotationY( yaw ).setPosition( x, y, z );
		if ( scale !== 1 ) base.multiply( this.part.makeScale( scale, scale, scale ) );
		const put = ( mesh, j, px, py, pz, angle ) => {

			this.part.makeTranslation( px, py, pz );
			if ( angle ) this.part.multiply( this.rot.makeRotationX( - angle ) );
			mesh.setMatrixAt( j, this.part.premultiply( base ) );

		};

		put( this.legs, i * 2, - 0.1, hip, 0, legA[ 0 ] );
		put( this.legs, i * 2 + 1, 0.1, hip, 0, legA[ 1 ] );
		put( this.torso, i, 0, hip - 0.04, 0, 0 );
		put( this.arms, i * 2, - 0.235, hip + 0.56, 0, armA[ 0 ] );
		put( this.arms, i * 2 + 1, 0.235, hip + 0.56, 0, armA[ 1 ] );
		put( this.head, i, 0, hip + 0.76, 0, 0 );
		put( this.hair, i, 0, hip + 0.76, 0, 0 );

	}

	flush() {

		for ( const m of [ this.legs, this.arms, this.torso, this.head, this.hair ] ) m.instanceMatrix.needsUpdate = true;

	}

}

// ---------------------------------------------------------------------------
// Cars: body and roof in the car's colour, glass cabin, wheels, head and tail lights. +z is forward.

function carGeometries() {

	const box = ( w, h, d, x, y, z ) => new THREE.BoxGeometry( w, h, d ).translate( x, y + h / 2, z );
	const body = mergeGeometries( [
		box( 1.76, 0.5, 4.0, 0, 0.3, 0 ),
		box( 1.7, 0.16, 3.1, 0, 0.8, - 0.15 ),
		box( 1.5, 0.07, 1.85, 0, 1.38, - 0.3 ),
		...[ [ - 0.72, 0.6 ], [ 0.72, 0.6 ], [ - 0.72, - 1.2 ], [ 0.72, - 1.2 ] ].map( ( [ x, z ] ) => box( 0.07, 0.45, 0.08, x, 0.95, z ) )
	] );
	const glass = box( 1.5, 0.43, 1.75, 0, 0.95, - 0.3 );
	const wheels = mergeGeometries( [ [ - 0.82, 1.28 ], [ 0.82, 1.28 ], [ - 0.82, - 1.28 ], [ 0.82, - 1.28 ] ].map( ( [ x, z ] ) => new THREE.CylinderGeometry( 0.31, 0.31, 0.22, 12 ).rotateZ( Math.PI / 2 ).translate( x, 0.31, z ) ) );
	const head = mergeGeometries( [ - 0.6, 0.6 ].map( x => box( 0.32, 0.12, 0.04, x, 0.62, 2.0 ) ) );
	const tail = mergeGeometries( [ - 0.65, 0.65 ].map( x => box( 0.26, 0.1, 0.04, x, 0.66, - 2.0 ) ) );
	return { body, glass, wheels, head, tail };

}

class Cars {

	constructor( scene, count ) {

		const g = carGeometries();
		const make = ( geo, material ) => {

			const m = new THREE.InstancedMesh( geo, material, count );
			m.castShadow = true;
			m.receiveShadow = true;
			m.frustumCulled = false;
			scene.add( m );
			return m;

		};

		this.meshes = [
			this.body = make( g.body, mat( { roughness: 0.35, metalness: 0.2 } ) ),
			make( g.glass, mat( { color: 0x23313b, roughness: 0.08, metalness: 0.4 } ) ),
			make( g.wheels, mat( { color: 0x1a1a1a, roughness: 0.9 } ) ),
			make( g.head, mat( { color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 0.6 } ) ),
			make( g.tail, mat( { color: 0x9a1f1f, emissive: 0x7a1010, emissiveIntensity: 0.5 } ) )
		];
		const c = new THREE.Color();
		for ( let i = 0; i < count; i ++ ) this.body.setColorAt( i, c.setHex( pick( CARS ) ) );
		this.m = new THREE.Matrix4();
		this.q = new THREE.Quaternion();
		this.e = new THREE.Euler();
		this.one = new THREE.Vector3( 1, 1, 1 );
		this.p = new THREE.Vector3();

	}

	set( i, x, y, z, yaw, pitch = 0 ) {

		this.q.setFromEuler( this.e.set( pitch, yaw, 0, 'YXZ' ) );
		this.m.compose( this.p.set( x, y, z ), this.q, this.one );
		for ( const mesh of this.meshes ) mesh.setMatrixAt( i, this.m );

	}

	flush() {

		for ( const mesh of this.meshes ) mesh.instanceMatrix.needsUpdate = true;

	}

}

// ---------------------------------------------------------------------------

export function addLife( scene, life, { seats = [], benches = [], groundHeight } ) {

	if ( ! life ) return { update() {} };

	// Walkers, spread over the lines by length.
	const walks = life.walks.map( makePath ).filter( p => p.length > 8 );
	const total = walks.reduce( ( s, p ) => s + p.length, 0 );
	const walkerCount = Math.min( 220, Math.round( total / 14 ) );
	const walkers = [];
	for ( let i = 0; i < walkerCount; i ++ ) {

		let r = rnd() * total, path = walks[ 0 ];
		for ( const p of walks ) {

			if ( r < p.length ) {

				path = p;
				break;

			}

			r -= p.length;

		}

		walkers.push( { path, s: r, dir: rnd() < 0.5 ? 1 : - 1, speed: 1.0 + rnd() * 0.55, side: ( rnd() - 0.5 ) * 0.5, phase: rnd() * 6, scale: 0.92 + rnd() * 0.14 } );

	}

	// Sitters: most chairs and stools, some bench places (two to a bench).
	const sitters = [];
	for ( const [ x, y, z, rot ] of seats ) if ( rnd() < 0.7 ) sitters.push( { x, y, z, yaw: rot } );
	for ( let i = 0; i < benches.length; i += 5 ) {

		const [ x, y, z, rot ] = benches.slice( i, i + 5 );
		for ( const ox of [ - 0.45, 0.45 ] ) {

			if ( rnd() > 0.35 ) continue;
			// Bench model: seat along local x, sitters face its −z.
			sitters.push( { x: x + Math.cos( rot ) * ox, y, z: z - Math.sin( rot ) * ox, yaw: rot + Math.PI } );

		}

	}

	const people = new People( scene, walkers.length + sitters.length );
	sitters.forEach( ( p, k ) => {

		const i = walkers.length + k;
		const swing = ( rnd() - 0.5 ) * 0.2;
		people.set( i, p.x, p.y, p.z, p.yaw, [ 1.35 + swing, 1.35 - swing ], [ 0.5, 0.45 ], 0.47, 0.95 + rnd() * 0.1 );

	} );

	// Cars: parked ones are placed once; the moving ones after them.
	const drives = life.drives.map( makePath ).filter( p => p.length > 25 );
	const parked = life.parked;
	const movingCount = Math.min( 18, drives.length );
	const cars = new Cars( scene, parked.length / 4 + movingCount );
	for ( let i = 0; i < parked.length; i += 4 ) cars.set( i / 4, parked[ i ], parked[ i + 1 ], parked[ i + 2 ], parked[ i + 3 ] );
	const firstMoving = parked.length / 4;
	const movers = [];
	for ( let k = 0; k < movingCount; k ++ ) movers.push( { path: drives[ Math.floor( rnd() * drives.length ) ], s: 0, speed: 0, cruise: 6 + rnd() * 3 } );
	for ( const m of movers ) m.s = rnd() * m.path.length * 0.8;

	const at = { x: 0, z: 0, dx: 0, dz: 1 }, at2 = { x: 0, z: 0, dx: 0, dz: 1 };
	let time = 0;

	function update( dt ) {

		time += dt;

		walkers.forEach( ( w, i ) => {

			w.s += w.dir * w.speed * dt;
			if ( w.s > w.path.length - 0.5 ) w.dir = - 1;
			if ( w.s < 0.5 ) w.dir = 1;
			sample( w.path, w.s, at );
			const x = at.x - at.dz * w.side * w.dir, z = at.z + at.dx * w.side * w.dir;
			const yaw = Math.atan2( at.dx * w.dir, at.dz * w.dir );
			const ph = time * w.speed * 5.2 + w.phase;
			const leg = Math.sin( ph ) * 0.42;
			const bob = Math.abs( Math.cos( ph ) ) * 0.035;
			people.set( i, x, groundHeight( x, z ) + bob, z, yaw, [ leg, - leg ], [ - leg * 0.8, leg * 0.8 ], 0.86, w.scale );

		} );

		people.flush();

		movers.forEach( ( m, k ) => {

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
			cars.set( firstMoving + k, at.x, y, at.z, Math.atan2( at.dx, at.dz ), - Math.atan2( y2 - y, 3.5 ) );

		} );

		cars.flush();

	}

	cars.flush();
	update( 0 );
	return { update, walkers: walkers.length, sitters: sitters.length, cars: parked.length / 4 + movingCount };

}
