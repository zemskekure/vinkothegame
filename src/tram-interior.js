// The inside of a tram, built only for the one you ride (src/ride.js) and thrown away when you get off. Two kinds,
// after the owner's pictures (public/models/vehicles/tram-interior.png, tram-fabric.png; made by
// tools/textures/tram-interior.py):
//   - the Tatra T3 (and the KT8D5, the historic T3): a high floor (0.9 m over the rails, three steps up), cream walls,
//     single seats in rows facing forward on both sides of the aisle, brown-red;
//   - the low-floor Škodas (15T, 14T, 52T): the floor 0.35 m over the rails, light grey walls, grey seat shells with
//     the red fabric.
// Both: yellow grab poles and rails, light strips in the ceiling, a band of open windows (the outside picture of
// the tram is seen only from outside, so through the window band the city passes by), and the aisle picture on the
// end walls, so the saloon seems to go on. Built per section in the section's own frame (+z forward, rails at
// y = 0), merged per material: seven draws a section.

import * as THREE from 'three/webgpu';
import { Kit, plain, glow, box, cyl } from './kit.js';
import { crispTexture } from './vehicles.js';

// Floor height over the rails, cab lengths at the front and the back of a car, which picture, the colours.
export const INSIDE = {
	old: { floor: 0.9, cab: 1.9, rearCab: 0.5, picture: 0, wall: 0xe8dcc0, panel: 0xc9b994, seat: 0x9b4a3c, shell: 0x6b6156, floorColour: 0x55524c },
	low: { floor: 0.35, cab: 1.9, rearCab: 0.5, picture: 1, wall: 0xdadddc, panel: 0xb9bec0, seat: 0xffffff, shell: 0x7f878d, floorColour: 0x4b4f52 }
};
export const insideOf = type => /^t3|kt8/.test( type ) ? INSIDE.old : INSIDE.low;

let shared = null;
function materials() {

	if ( shared ) return shared;
	const fabric = crispTexture( 'tram-fabric.png' );
	fabric.wrapS = fabric.wrapT = THREE.RepeatWrapping;
	const pictures = crispTexture( 'tram-interior.png' );
	shared = {
		yellow: plain( 0xf2c230, { roughness: 0.45, metalness: 0.2 } ),
		light: glow( 0xfff4dc, 1.6 ),
		pictures,
		fabric
	};
	return shared;

}

// The aisle picture on an end wall: a plane facing +z (or −z with `back`), from picture k of the atlas.
function picturePlane( k, w, h, back ) {

	const g = new THREE.PlaneGeometry( w, h );
	const uv = g.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setX( i, ( k + uv.getX( i ) ) / 2 );
	if ( back ) g.rotateY( Math.PI );
	return g;

}

// One section's inside. `sec`: { L, k (its place in the car), n (sections in the car) }; `spec`: the tram's
// dimensions; `doors`: the door positions along this section (local z). Returns { group, seats: [ { z, x } ] }.
export function sectionInterior( type, spec, sec, doors ) {

	const m = materials(), look = insideOf( type );
	const own = {
		wall: plain( look.wall, { roughness: 0.7 } ),
		panel: plain( look.panel, { roughness: 0.6 } ),
		floor: plain( look.floorColour, { roughness: 0.9 } ),
		shell: plain( look.shell, { roughness: 0.5 } ),
		seat: new THREE.MeshStandardNodeMaterial( { map: m.fabric, color: look.seat, roughness: 0.9 } ),
		picture: new THREE.MeshStandardNodeMaterial( { map: m.pictures, roughness: 0.8, emissive: 0xffffff, emissiveMap: m.pictures, emissiveIntensity: 0.25 } )
	};
	const kit = new Kit();
	const W = spec.width / 2 - 0.07, H = spec.height - 0.34, F = look.floor, L = sec.L;
	const first = sec.k === 0, last = sec.k === sec.n - 1;
	// The saloon runs from behind the driver's cab to the back wall.
	const z1 = first ? L / 2 - look.cab : L / 2, z0 = last ? - L / 2 + look.rearCab : - L / 2;
	const len = z1 - z0, mid = ( z0 + z1 ) / 2;
	const sill = F + 0.95, lintel = F + 1.95;

	kit.add( own.floor, box( W * 2, 0.04, len, 0, F - 0.04, mid ) );
	kit.add( own.wall, box( W * 2, 0.04, len, 0, H, mid ) );
	for ( const s of [ - 1, 1 ] ) {

		// Below the windows and above them; between them, pillars every 1.5 m.
		kit.add( own.panel, box( 0.05, sill - F + 0.9, len, s * W, F - 0.9, mid ) );
		kit.add( own.wall, box( 0.05, H - lintel, len, s * W, lintel, mid ) );
		for ( let z = z0; z <= z1 + 0.01; z += len / Math.max( 1, Math.round( len / 1.5 ) ) ) kit.add( own.wall, box( 0.05, lintel - sill, 0.12, s * W, sill, z ) );
		// The grab rail under the ceiling, and a light strip.
		kit.add( m.yellow, cyl( 0.018, 0.018, len, s * 0.55, 0, 0, 6 ).rotateX( Math.PI / 2 ).translate( 0, lintel - 0.05, mid ) );
		kit.add( m.light, box( 0.14, 0.02, len * 0.85, s * 0.42, H - 0.02, mid ) );

	}

	// The end walls (the cab's back, the car's back) with the aisle picture; full height, the picture above the floor.
	const endWall = ( z, facing ) => {

		kit.add( own.wall, box( W * 2, H - F + 0.9, 0.05, 0, F - 0.9, z ) );
		kit.add( own.picture, picturePlane( look.picture, W * 2 - 0.1, H - F - 0.05, facing < 0 ).translate( 0, F + ( H - F ) / 2, z + facing * 0.03 ) );

	};

	if ( first ) endWall( z1, - 1 );
	if ( last ) endWall( z0, 1 );

	// Seats: single seats in rows on both sides facing forward, 0.8 m apart, kept clear of the doors.
	const seats = [];
	const free = z => doors.every( d => Math.abs( z - d ) > 1.0 );
	for ( let z = z1 - 0.6; z > z0 + 0.4; z -= 0.8 ) {

		if ( ! free( z ) ) continue;
		for ( const s of [ - 1, 1 ] ) {

			const x = s * ( W - 0.32 );
			kit.add( own.shell, box( 0.44, 0.36, 0.36, x, F, z ) );
			kit.add( own.seat, box( 0.46, 0.08, 0.44, x, F + 0.36, z ), box( 0.46, 0.5, 0.07, x, F + 0.44, z - 0.2 ) );
			seats.push( { z: z + 0.03, x } );

		}

		// A pole by every second row, at the aisle's edge.
		if ( Math.round( ( z1 - z ) / 0.8 ) % 2 === 1 ) for ( const s of [ - 1, 1 ] ) kit.add( m.yellow, cyl( 0.02, 0.02, lintel - F, s * ( W - 0.62 ), F, z - 0.3, 6 ) );

	}

	// Standing room by the doors: a pole in the middle of each.
	for ( const d of doors ) if ( d > z0 + 0.3 && d < z1 - 0.3 ) kit.add( m.yellow, cyl( 0.02, 0.02, lintel - F, 0, F, d, 6 ) );

	const group = new THREE.Group();
	kit.build( group, { shadows: false } );
	group.userData.dispose = () => {

		group.traverse( o => o.geometry?.dispose() );
		for ( const mat of Object.values( own ) ) mat.dispose();

	};
	return { group, seats, floor: F, z0, z1 };

}
