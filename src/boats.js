// Boats on the Vltava: the swan pedal boats and rowing boats hired out at Slovanský ostrov (Žofín) paddling about
// in the river beside the island and in the narrow arm between the island and Masarykovo nábřeží, and an old
// steamer moored at Smetanovo nábřeží north of Most Legií. Downloaded low-poly models (public/models/vehicles/
// CREDITS.md), one instanced batch per model. They bob on the water and drift slowly along small loops; a boat
// whose loop would take it onto land or under the bridge turns round.

import * as THREE from 'three/webgpu';
import { vehicleModel } from './vehicles.js';

// model: real length (m), draught (m below the waterline in the model's own frame, at that length)
const MODELS = {
	'boat-swan': { length: 2.4, draught: 0.29 },
	'boat-row': { length: 3.2, draught: 0.2 },
	'boat-row-large': { length: 3.6, draught: 0.2 },
	'boat-steamer': { length: 44, draught: 2.8 }
};

// Where they are (scene frame, metres): x, z, heading (rad, 0 = facing +z, south), loop radius (0: moored).
// Slovanský ostrov runs from Most Legií (z ≈ 320) south to z ≈ 840 between x ≈ −480 and −410; the main river
// lies west of it, the narrow arm east of it.
const FLEET = [
	[ 'boat-swan', - 515, 470, 0.4, 12 ], [ 'boat-swan', - 530, 520, 2.6, 10 ], [ 'boat-swan', - 505, 585, 1.2, 14 ],
	[ 'boat-swan', - 545, 640, - 0.8, 12 ], [ 'boat-swan', - 392, 560, 3.1, 6 ], [ 'boat-swan', - 388, 655, 0.1, 6 ],
	[ 'boat-row', - 560, 560, 1.9, 16 ], [ 'boat-row', - 520, 700, - 2.2, 14 ], [ 'boat-row-large', - 395, 480, 0, 5 ],
	[ 'boat-row-large', - 570, 480, 2.8, 12 ],
	[ 'boat-steamer', - 382, 130, 0, 0 ]
];

export async function addBoats( scene, { loadModel, groundHeight, waterLevel } ) {

	const wet = ( x, z ) => groundHeight( x, z ) < waterLevel - 0.2;
	const types = Object.keys( MODELS );
	const models = await Promise.all( types.map( n => vehicleModel( loadModel, n, MODELS[ n ].length ) ) );

	// The steamer lies along the embankment: turn it to the bank's line where it is moored (the water's edge a little
	// to the north and south of it).
	const edge = z => {

		let x = - 300;
		while ( x > - 640 && ! wet( x, z ) ) x -= 1;
		return x;

	};

	const boats = [];
	const batches = models.map( ( { geometry, material }, t ) => {

		const list = FLEET.filter( b => b[ 0 ] === types[ t ] );
		const mesh = new THREE.InstancedMesh( geometry, material, Math.max( 1, list.length ) );
		mesh.count = list.length;
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		scene.add( mesh );
		for ( let i = 0; i < list.length; i ++ ) mesh.setMatrixAt( i, new THREE.Matrix4().makeScale( 0, 0, 0 ) ); // until placed
		list.forEach( ( [ name, x, z, heading, loop ], i ) => {

			if ( name === 'boat-steamer' ) {

				const a = edge( z - 25 ), b = edge( z + 25 ), e = edge( z );
				heading = Math.atan2( b - a, 50 );
				x = e - 4.5; // its side against the quay

			}

			if ( ! wet( x, z ) ) return;
			boats.push( { mesh, i, cx: x, cz: z, x, z, heading, loop, draught: MODELS[ name ].draught, phase: x * 0.37 + z * 0.11, dir: 1, t: Math.abs( x + z ) % 7 } );

		} );
		return mesh;

	} );

	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3( 1, 1, 1 );
	let time = 0;

	function update( dt ) {

		time += dt;
		for ( const b of boats ) {

			if ( b.loop ) {

				// A slow, lazy loop round the boat's spot (about a minute round), heading the way it goes.
				b.t += dt * b.dir * 0.1;
				const nx = b.cx + Math.sin( b.t ) * b.loop, nz = b.cz + Math.sin( b.t * 0.7 + 1 ) * b.loop * 0.8;
				const ahead = [ nx + Math.sin( b.heading ) * 2, nz + Math.cos( b.heading ) * 2 ];
				if ( ! wet( ...ahead ) || ! wet( nx, nz ) ) b.dir = - b.dir;
				else {

					const dx = nx - b.x, dz = nz - b.z;
					if ( dx * dx + dz * dz > 1e-6 ) {

						let d = Math.atan2( dx, dz ) - b.heading;
						d = Math.atan2( Math.sin( d ), Math.cos( d ) );
						b.heading += d * Math.min( 1, dt * 1.5 );

					}

					b.x = nx;
					b.z = nz;

				}

			}

			// Bobbing: a slow heave, roll and pitch, smaller for the big steamer.
			const k = b.draught > 1 ? 0.25 : 1, p = b.phase + time;
			const y = waterLevel - b.draught + Math.sin( p * 1.3 ) * 0.04 * k;
			e.set( Math.sin( p * 0.9 ) * 0.025 * k, b.heading, Math.sin( p * 1.1 + 0.5 ) * 0.04 * k, 'YXZ' );
			b.mesh.setMatrixAt( b.i, m4.compose( v.set( b.x, y, b.z ), q.setFromEuler( e ), one ) );

		}

		for ( const m of batches ) m.instanceMatrix.needsUpdate = true;

	}

	update( 0 );
	return { update, boats };

}
