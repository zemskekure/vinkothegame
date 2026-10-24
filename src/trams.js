// Prague trams: a stylised Tatra T3 in the red-and-cream livery (tapered ends, a cream band under the windows,
// a cream roof edge, a pantograph, an orange destination display) running the tram routes from tools/places.mjs.
// Each car sits on its two bogies over the track, so it follows curves; it eases into the stops, waits, pulls away,
// and starts again from the beginning of its route when it has run off the end.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LENGTH = 14, HALF_W = 1.25, BOGIE = 3.7;
const CRUISE = 9, ACCEL = 1.0, BRAKE = 1.3, DWELL = 12;

// Plan view of the car (x across, s along, front at +s): straight sides, ends drawn in to a rounded nose.
function plan( inset = 0 ) {

	const w = HALF_W - inset, L = LENGTH / 2 - inset, n = 0.85 - inset * 0.5;
	return new THREE.Shape()
		.moveTo( - w, - L + 0.9 ).lineTo( - w, L - 0.9 )
		.quadraticCurveTo( - w, L, - n, L ).lineTo( n, L )
		.quadraticCurveTo( w, L, w, L - 0.9 ).lineTo( w, - L + 0.9 )
		.quadraticCurveTo( w, - L, n, - L ).lineTo( - n, - L )
		.quadraticCurveTo( - w, - L, - w, - L + 0.9 );

}

// A horizontal slab of the car body between two heights (the plan extruded upwards; +z forward).
const band = ( y0, y1, inset = 0 ) => new THREE.ExtrudeGeometry( plan( inset ), { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 } ).rotateX( - Math.PI / 2 ).rotateY( Math.PI ).translate( 0, y0, 0 );

function destinationTexture( text ) {

	const c = document.createElement( 'canvas' );
	c.width = 512;
	c.height = 96;
	const g = c.getContext( '2d' );
	g.fillStyle = '#111';
	g.fillRect( 0, 0, 512, 96 );
	g.fillStyle = '#ffae2b';
	g.font = '700 58px "Helvetica Neue", Arial, sans-serif';
	g.textBaseline = 'middle';
	g.fillText( text, 18, 50 );
	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	return t;

}

const mat = ( hex, opts = {} ) => new THREE.MeshStandardNodeMaterial( { color: hex, roughness: 0.5, ...opts } );
const MATS = {
	red: mat( 0xc1272d, { roughness: 0.35 } ),
	cream: mat( 0xefe5c8, { roughness: 0.4 } ),
	glass: mat( 0x1f2a33, { roughness: 0.08, metalness: 0.4 } ),
	dark: mat( 0x1b1c1e, { roughness: 0.8 } ),
	roof: mat( 0x8d9094, { roughness: 0.6 } ),
	light: new THREE.MeshStandardNodeMaterial( { color: 0xfff6dc, emissive: 0xfff0c8, emissiveIntensity: 1.2 } )
};

function tramModel() {

	const parts = {
		dark: [ band( 0.18, 0.62, 0.15 ) ],
		red: [ band( 0.62, 1.42 ), band( 2.5, 2.78 ) ],
		cream: [ band( 1.42, 1.58 ), band( 2.78, 2.98, 0.05 ) ],
		glass: [ band( 1.58, 2.5, 0.02 ) ],
		roof: [ band( 2.98, 3.08, 0.25 ), new THREE.BoxGeometry( 1.4, 0.25, 2.4 ).translate( 0, 3.2, 1.6 ) ],
		light: [ ...[ - 0.6, 0.6 ].map( x => new THREE.CylinderGeometry( 0.11, 0.11, 0.06, 12 ).rotateX( Math.PI / 2 ).translate( x, 1.05, LENGTH / 2 + 0.01 ) ) ]
	};

	// Doors: dark panels down the right side (Prague trams open on the right).
	for ( const s of [ 4.6, 0.2, - 4.2 ] ) parts.dark.push( new THREE.BoxGeometry( 0.04, 1.85, 1.25 ).translate( - HALF_W - 0.005, 0.62 + 0.92, s ) );
	// Bogies with wheels.
	for ( const s of [ BOGIE, - BOGIE ] ) for ( const x of [ - 0.75, 0.75 ] ) for ( const ds of [ - 0.9, 0.9 ] ) parts.dark.push( new THREE.CylinderGeometry( 0.33, 0.33, 0.12, 12 ).rotateZ( Math.PI / 2 ).translate( x, 0.33, s + ds ) );
	// Pantograph: a diamond of thin bars on the roof.
	const bar = ( x0, y0, z0, x1, y1, z1 ) => {

		const a = new THREE.Vector3( x0, y0, z0 ), b = new THREE.Vector3( x1, y1, z1 );
		const g = new THREE.CylinderGeometry( 0.025, 0.025, a.distanceTo( b ), 5 );
		g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), b.clone().sub( a ).normalize() ) );
		return g.translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );

	};

	for ( const x of [ - 0.45, 0.45 ] ) parts.dark.push( bar( x, 3.33, 0.8, x, 3.95, 1.6 ), bar( x, 3.95, 1.6, x, 4.45, 0.9 ) );
	parts.dark.push( new THREE.BoxGeometry( 1.5, 0.04, 0.12 ).translate( 0, 4.47, 0.9 ) );

	const group = new THREE.Group();
	for ( const [ name, list ] of Object.entries( parts ) ) {

		const g = mergeGeometries( list.map( g => {

			const n = g.index ? g.toNonIndexed() : g;
			for ( const a of Object.keys( n.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( a ) ) n.deleteAttribute( a );
			if ( ! n.attributes.uv ) n.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( n.attributes.position.count * 2 ), 2 ) );
			return n;

		} ) );
		g.computeVertexNormals();
		const m = new THREE.Mesh( g, MATS[ name ] );
		m.castShadow = m.receiveShadow = true;
		group.add( m );

	}

	// Destination displays front and back.
	for ( const [ z, rot ] of [ [ LENGTH / 2 - 0.12, 0 ], [ - LENGTH / 2 + 0.12, Math.PI ] ] ) {

		const d = new THREE.Mesh( new THREE.PlaneGeometry( 1.4, 0.26 ), new THREE.MeshStandardNodeMaterial( { map: destinationTexture( [ '22 Bílá Hora', '9 Sídliště Řepy', '18 Vozovna Pankrác', '17 Libuš', '2 Petřiny', '23 Kubánské nám.' ][ Math.floor( Math.random() * 6 ) ] ), emissive: 0xffffff, emissiveIntensity: 0.15 } ) );
		d.position.set( 0, 2.35, z + ( rot ? - 0.02 : 0.02 ) );
		d.rotation.y = rot;
		group.add( d );

	}

	return group;

}

function makePath( flat ) {

	const pts = [];
	for ( let i = 0; i < flat.length; i += 2 ) pts.push( [ flat[ i ], flat[ i + 1 ] ] );
	const cum = [ 0 ];
	for ( let i = 1; i < pts.length; i ++ ) cum.push( cum[ i - 1 ] + Math.hypot( pts[ i ][ 0 ] - pts[ i - 1 ][ 0 ], pts[ i ][ 1 ] - pts[ i - 1 ][ 1 ] ) );
	return { pts, cum, length: cum[ cum.length - 1 ] };

}

function at( path, s ) {

	const { pts, cum } = path;
	s = Math.max( 0, Math.min( path.length, s ) );
	let lo = 0, hi = cum.length - 1;
	while ( hi - lo > 1 ) {

		const mid = ( lo + hi ) >> 1;
		if ( cum[ mid ] <= s ) lo = mid; else hi = mid;

	}

	const t = ( s - cum[ lo ] ) / ( cum[ hi ] - cum[ lo ] || 1 );
	return [ pts[ lo ][ 0 ] + ( pts[ hi ][ 0 ] - pts[ lo ][ 0 ] ) * t, pts[ lo ][ 1 ] + ( pts[ hi ][ 1 ] - pts[ lo ][ 1 ] ) * t ];

}

export function addTrams( scene, routes, groundHeight ) {

	if ( ! routes?.length ) return { update() {} };
	const trams = routes.map( ( r, i ) => {

		const path = makePath( r.pts );
		const model = tramModel();
		scene.add( model );
		return { path, stops: r.stops, model, s: BOGIE + 2 + ( ( i * 137 ) % Math.max( 1, path.length - 30 ) ), v: CRUISE * 0.6, dwell: 0, served: new Set() };

	} );

	function update( dt ) {

		for ( const t of trams ) {

			if ( t.dwell > 0 ) {

				t.dwell -= dt;

			} else {

				// The next stop ahead (by the car's middle), braking to halt with the doors at it.
				const next = t.stops.find( s => s > t.s - 1 && ! t.served.has( s ) );
				let target = CRUISE;
				if ( next !== undefined ) {

					const gap = next - t.s;
					if ( gap < t.v * t.v / ( 2 * BRAKE ) + 0.5 ) target = 0;
					if ( gap < 0.6 && t.v < 0.8 ) {

						t.served.add( next );
						t.dwell = DWELL;
						t.v = 0;

					}

				}

				t.v += Math.max( - BRAKE * dt, Math.min( ACCEL * dt, target - t.v ) );
				if ( target === 0 ) t.v = Math.max( t.v, 0.5 );
				t.s += t.v * dt;
				if ( t.s > t.path.length - BOGIE - 1 ) {

					t.s = BOGIE + 1;
					t.v = CRUISE * 0.5;
					t.served.clear();

				}

			}

			const [ fx, fz ] = at( t.path, t.s + BOGIE ), [ bx, bz ] = at( t.path, t.s - BOGIE );
			const x = ( fx + bx ) / 2, z = ( fz + bz ) / 2;
			t.model.position.set( x, Math.max( groundHeight( fx, fz ), groundHeight( bx, bz ) ), z );
			t.model.rotation.y = Math.atan2( fx - bx, fz - bz );

		}

	}

	update( 0 );
	return { update, trams };

}
