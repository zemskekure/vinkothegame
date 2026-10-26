// Cars as late-90s console models made from the owner's pictures: every car is its side outline (traced from the
// side picture by tools/textures/cars.py) pushed out across the car's width, the glasshouse above the window sills
// leaning in a little, and the pictures projected onto it like the trams' (src/trams.js): the side pictures on the
// sides, the top picture on everything facing up (bonnet, windscreen, roof, boot), the front and rear pictures on
// the ends. A hundred-odd triangles a car, wheels and all drawn in the pictures. One atlas
// (public/models/vehicles/car-atlas.png) and one material for every type.

import * as THREE from 'three/webgpu';
import { crispTexture, DIR } from './vehicles.js';

const lerp = ( a, b, t ) => a + ( b - a ) * t;

// Where the polygon (points [ z, y ]) crosses the height h, points inserted there.
function cutAt( pts, h ) {

	const out = [];
	for ( let i = 0; i < pts.length; i ++ ) {

		const a = pts[ i ], b = pts[ ( i + 1 ) % pts.length ];
		out.push( a );
		if ( ( a[ 1 ] - h ) * ( b[ 1 ] - h ) < 0 ) {

			const t = ( h - a[ 1 ] ) / ( b[ 1 ] - a[ 1 ] );
			out.push( [ lerp( a[ 0 ], b[ 0 ], t ), h ] );

		}

	}

	return out;

}

// The part of the polygon below (keep = −1) or above (+1) the height h.
export function clip( pts, h, keep ) {

	const inside = p => ( p[ 1 ] - h ) * keep >= - 1e-6;
	const out = [];
	for ( let i = 0; i < pts.length; i ++ ) {

		const a = pts[ i ], b = pts[ ( i + 1 ) % pts.length ];
		if ( inside( a ) ) out.push( a );
		if ( inside( a ) !== inside( b ) ) {

			const t = ( h - a[ 1 ] ) / ( b[ 1 ] - a[ 1 ] );
			out.push( [ lerp( a[ 0 ], b[ 0 ], t ), h ] );

		}

	}

	return out;

}

// A shape made of `parts`, each a side outline ( [ z, y ] points, +z forward ) pushed out to ± half( z, y ) across,
// wearing pictures: `maps.left` / `maps.right` on its sides, and round its outline `maps.top` on what faces up,
// `maps.under` on what faces down, `maps.front` and `maps.rear` on the ends. Each map takes a corner ( x, y, z ) and
// gives its texture coordinates. Edges longer than `step` are cut, so a width that changes along the shape is
// followed. Shared by the cars and the boats (src/boats.js).
export function extrude( parts, maps, step = Infinity ) {

	const pos = [], uv = [];
	const va = new THREE.Vector3(), vb = new THREE.Vector3(), n = new THREE.Vector3();
	// A triangle facing `out` (its corners swapped if they wind the other way), each corner with its own mapping.
	const tri = ( p, q, r, map, out ) => {

		va.set( q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ], q[ 2 ] - p[ 2 ] );
		vb.set( r[ 0 ] - p[ 0 ], r[ 1 ] - p[ 1 ], r[ 2 ] - p[ 2 ] );
		n.crossVectors( va, vb );
		if ( n.dot( out ) < 0 ) [ q, r ] = [ r, q ];
		for ( const v of [ p, q, r ] ) {

			pos.push( ...v );
			uv.push( ...map( ...v ) );

		}

	};

	for ( const { poly, half } of parts ) {

		if ( poly.length < 3 ) continue;
		const prof = [];
		for ( let i = 0; i < poly.length; i ++ ) {

			const a = poly[ i ], b = poly[ ( i + 1 ) % poly.length ];
			const k = Math.max( 1, Math.ceil( Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) / step ) );
			for ( let j = 0; j < k; j ++ ) prof.push( [ lerp( a[ 0 ], b[ 0 ], j / k ), lerp( a[ 1 ], b[ 1 ], j / k ) ] );

		}

		// The sides.
		const faces = THREE.ShapeUtils.triangulateShape( prof.map( ( [ z, y ] ) => new THREE.Vector2( z, y ) ), [] );
		for ( const [ a, b, d ] of faces ) for ( const s of [ 1, - 1 ] ) {

			const v = i => [ s * half( prof[ i ][ 0 ], prof[ i ][ 1 ] ), prof[ i ][ 1 ], prof[ i ][ 0 ] ];
			tri( v( a ), v( b ), v( d ), s > 0 ? maps.left : maps.right, new THREE.Vector3( s, 0, 0 ) );

		}

		// Round the outline: each edge a strip across, wearing the picture it faces.
		let area = 0;
		for ( let i = 0; i < prof.length; i ++ ) {

			const a = prof[ i ], b = prof[ ( i + 1 ) % prof.length ];
			area += a[ 0 ] * b[ 1 ] - b[ 0 ] * a[ 1 ];

		}

		const turn = area > 0 ? 1 : - 1;
		for ( let i = 0; i < prof.length; i ++ ) {

			const [ za, ya ] = prof[ i ], [ zb, yb ] = prof[ ( i + 1 ) % prof.length ];
			const dz = zb - za, dy = yb - ya, len = Math.hypot( dz, dy );
			if ( len < 1e-4 ) continue;
			// The outward normal in the profile's plane.
			const nz = turn * dy / len, ny = - turn * dz / len;
			const map = ny > 0.45 ? maps.top : ny < - 0.45 ? maps.under : nz > 0 ? maps.front : maps.rear;
			const out = new THREE.Vector3( 0, ny, nz );
			const ha = half( za, ya ), hb = half( zb, yb );
			const A = [ ha, ya, za ], B = [ - ha, ya, za ], C = [ hb, yb, zb ], D = [ - hb, yb, zb ];
			tri( A, B, D, map, out );
			tri( A, D, C, map, out );

		}

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.computeVertexNormals();
	g.computeBoundingBox();
	return g;

}

export const rectUV = ( r, s, t ) => [ lerp( r[ 0 ], r[ 2 ], s ), lerp( r[ 1 ], r[ 3 ], t ) ];

// One car's geometry: +z forward, wheels on y = 0, centred.
function carGeometry( c ) {

	const L = c.length, W = c.width / 2, H = c.height, belt = c.belt * H;
	// The profile in metres: z from the front (+L/2) back, y up, cut at the sills.
	const prof = cutAt( c.profile.map( ( [ f, u ] ) => [ L / 2 - f * L, u * H ] ), belt );
	const half = ( z, y ) => y <= belt ? W : W - c.tumble * ( y - belt ) / Math.max( 0.01, H - belt );
	const frac = z => ( L / 2 - z ) / L; // 0 at the front, 1 at the rear
	const rect = rectUV;
	// The pictures show the front at the left; the top picture the car's right (−x) side at the top; seen from the
	// front its left (+x) is on the right, seen from behind on the left.
	const maps = {
		left: ( x, y, z ) => rect( c.left, frac( z ), y / H ),
		right: ( x, y, z ) => rect( c.right, 1 - frac( z ), y / H ),
		top: ( x, y, z ) => rect( c.top, frac( z ), ( W - x ) / ( 2 * W ) ),
		front: ( x, y ) => rect( c.front, ( x + W ) / ( 2 * W ), y / H ),
		rear: ( x, y ) => rect( c.rear, ( W - x ) / ( 2 * W ), y / H ),
		under: () => rect( c.under, 0.5, 0.5 )
	};
	// Below the sills flat, the glasshouse above leaning in.
	return extrude( [ { poly: clip( prof, belt, - 1 ), half }, { poly: clip( prof, belt, 1 ), half } ], maps );

}

let fleet = null;

// Every car type as { geometry, material, size }, by name (fabia, favorit, octavia, oldtimer, police, taxi, trabant,
// van), sharing one material.
export function carFleet() {

	return fleet ||= ( async () => {

		const info = await ( await fetch( DIR + 'car-atlas.json' ) ).json();
		const material = new THREE.MeshStandardNodeMaterial( { map: crispTexture( 'car-atlas.png' ), roughness: 0.55, metalness: 0.05 } );
		const out = {};
		for ( const [ name, c ] of Object.entries( info.cars ) ) {

			const geometry = carGeometry( c );
			out[ name ] = { geometry, material, size: geometry.boundingBox.getSize( new THREE.Vector3() ) };

		}

		return out;

	} )();

}
