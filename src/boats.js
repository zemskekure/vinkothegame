// Boats on the Vltava: the swan pedal boats, pedal boats and rowing boats hired out at Slovanský ostrov (Žofín)
// paddling about in the river beside the island and in the narrow arm between the island and Masarykovo nábřeží, an
// old paddle steamer and a glass-roofed sightseeing boat moored at Smetanovo nábřeží north of Most Legií. Each is
// made from the owner's side and top pictures like the cars (src/cars.js): the side outline (traced by
// tools/textures/boats.py) pushed out to the boat's width along its length as seen from above, the hull full width
// up to its gunwale, cabins, seats and the swan's neck narrower above it; the side picture on the sides, the top
// picture on everything facing up. One atlas (public/models/vehicles/boat-atlas.png), one material, one instanced
// batch per kind. They bob on the water and drift slowly along small loops; a boat whose loop would take it onto
// land or under the bridge turns round.

import * as THREE from 'three/webgpu';
import { crispTexture, DIR } from './vehicles.js';
import { extrude, clip, rectUV } from './cars.js';

// How far each kind sits below the waterline (m).
const DRAUGHT = { swan: 0.12, rowboat: 0.12, pedalo: 0.12, steamer: 0.6, tourboat: 0.5 };

const interp = ( stops, f ) => {

	if ( f <= stops[ 0 ][ 0 ] ) return stops[ 0 ][ 1 ];
	for ( let i = 1; i < stops.length; i ++ ) if ( f <= stops[ i ][ 0 ] ) {

		const [ a, va ] = stops[ i - 1 ], [ b, vb ] = stops[ i ];
		return va + ( vb - va ) * ( f - a ) / ( b - a || 1 );

	}

	return stops[ stops.length - 1 ][ 1 ];

};

// One boat's geometry: bow towards +z, the waterline at y = 0, centred.
function boatGeometry( b ) {

	const L = b.length, B = b.width / 2, H = b.height, deck = b.deck * H;
	const frac = z => ( L / 2 - z ) / L; // 0 at the bow
	const prof = b.profile.map( ( [ f, u ] ) => [ L / 2 - f * L, u * H ] );
	const hull = z => B * Math.max( 0.04, interp( b.plan, frac( z ) ) );
	const side = ( x, y, z ) => rectUV( b.left, frac( z ), y / H );
	const maps = { left: side, right: side, front: side, rear: side, under: side, top: ( x, y, z ) => rectUV( b.top, frac( z ), ( B - x ) / ( 2 * B ) ) };
	return extrude( [
		{ poly: clip( prof, deck, - 1 ), half: z => hull( z ) },
		{ poly: b.deck < 1 ? clip( prof, deck, 1 ) : [], half: z => hull( z ) * interp( b.upper, frac( z ) ) }
	], maps, L / 24 );

}

// Where they are (scene frame, metres): x, z, heading (rad, 0 = facing +z, south), loop radius (0: moored).
// Slovanský ostrov runs from Most Legií (z ≈ 320) south to z ≈ 840 between x ≈ −480 and −410; the main river
// lies west of it, the narrow arm east of it.
const FLEET = [
	[ 'swan', - 515, 470, 0.4, 12 ], [ 'swan', - 530, 520, 2.6, 10 ], [ 'swan', - 505, 585, 1.2, 14 ],
	[ 'swan', - 545, 640, - 0.8, 12 ], [ 'swan', - 392, 560, 3.1, 6 ], [ 'swan', - 388, 655, 0.1, 6 ],
	[ 'rowboat', - 560, 560, 1.9, 16 ], [ 'rowboat', - 520, 700, - 2.2, 14 ], [ 'pedalo', - 395, 480, 0, 5 ],
	[ 'pedalo', - 570, 480, 2.8, 12 ], [ 'pedalo', - 535, 600, 1.4, 10 ],
	[ 'steamer', - 382, 130, 0, 0 ], [ 'tourboat', - 382, 62, 0, 0 ]
];

export async function addBoats( scene, { loadModel, groundHeight, waterLevel } ) {

	const wet = ( x, z ) => groundHeight( x, z ) < waterLevel - 0.2;
	const info = await ( await fetch( DIR + 'boat-atlas.json' ) ).json();
	const material = new THREE.MeshStandardNodeMaterial( { map: crispTexture( 'boat-atlas.png' ), roughness: 0.6 } );
	const types = Object.keys( info.boats );
	const models = types.map( n => ( { geometry: boatGeometry( info.boats[ n ] ), material } ) );

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

			if ( ! loop ) {

				const a = edge( z - 25 ), b = edge( z + 25 ), e = edge( z );
				heading = Math.atan2( b - a, 50 );
				x = e - info.boats[ name ].width / 2 - 0.3; // its side against the quay

			}

			if ( ! wet( x, z ) ) return;
			boats.push( { mesh, i, cx: x, cz: z, x, z, heading, loop, draught: DRAUGHT[ name ] ?? 0.1, phase: x * 0.37 + z * 0.11, dir: 1, t: Math.abs( x + z ) % 7 } );

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
			const k = b.draught > 0.4 ? 0.25 : 1, p = b.phase + time;
			const y = waterLevel - b.draught + Math.sin( p * 1.3 ) * 0.04 * k;
			e.set( Math.sin( p * 0.9 ) * 0.025 * k, b.heading, Math.sin( p * 1.1 + 0.5 ) * 0.04 * k, 'YXZ' );
			b.mesh.setMatrixAt( b.i, m4.compose( v.set( b.x, y, b.z ), q.setFromEuler( e ), one ) );

		}

		for ( const m of batches ) m.instanceMatrix.needsUpdate = true;

	}

	update( 0 );
	return { update, boats };

}
