// Vehicles as solid things: every tram section and every car is an oriented box on the street (its centre, its
// heading, half its length and width, its floor and roof), and the walker, the scooter and the pigeon keep out of
// them. Each frame only the boxes near the player are gathered (`gather`), so a test is a handful of sums.
//   - The walker and the scooter treat a box like a house wall (`hit`): they slide along it, the scooter loses its
//     speed. A tram that moves into you shoves you aside, a few metres a second, never a jump (`push`).
//   - The pigeon sees a roof to land on (`top`) and rides along on it (`carry`), turning with the tram.
//
// A box: { x, z, yaw, c, s, hl, hw, y0, y1, px, pz, pyaw, speed, ref }; the vehicle's +z (its front) points along
// ( sin yaw, cos yaw ), as three's rotation.y does. px, pz, pyaw: where it was the frame before.

const SHOVE = 4; // m/s: how fast a moving vehicle pushes one aside

export class Solids {

	constructor() {

		this.sources = [];
		this.near = [];

	}

	// A source fills `out` with the boxes within r of ( x, z ).
	add( source ) {

		this.sources.push( source );

	}

	gather( x, z, r = 45 ) {

		this.near.length = 0;
		for ( const f of this.sources ) f( x, z, r, this.near );

	}

	// The box a circle of radius r at ( x, z ) overlaps, for someone standing at height y (their head ~1.7 m over).
	hit( x, z, y, r ) {

		for ( const b of this.near ) {

			if ( y > b.y1 - 0.25 || y + 1.7 < b.y0 ) continue;
			const dx = x - b.x, dz = z - b.z;
			const lz = dx * b.s + dz * b.c, lx = dx * b.c - dz * b.s;
			if ( Math.abs( lz ) < b.hl + r && Math.abs( lx ) < b.hw + r ) return b;

		}

		return null;

	}

	// How far to move a circle out of whatever it overlaps: a box standing still pushes it out the shortest way at
	// once, a moving one sideways, at most SHOVE m/s. Returns [ dx, dz ] (zero when clear).
	push( x, z, y, r, dt, out = [ 0, 0 ] ) {

		out[ 0 ] = out[ 1 ] = 0;
		for ( const b of this.near ) {

			if ( y > b.y1 - 0.25 || y + 1.7 < b.y0 ) continue;
			const dx = x - b.x, dz = z - b.z;
			const lz = dx * b.s + dz * b.c, lx = dx * b.c - dz * b.s;
			const penL = b.hl + r - Math.abs( lz ), penW = b.hw + r - Math.abs( lx );
			if ( penL <= 0 || penW <= 0 ) continue;
			let cx = 0, cz = 0;
			if ( b.speed > 0.2 ) cx = Math.sign( lx || 1 ) * Math.min( penW, SHOVE * dt + 0.01 );
			else if ( penL < penW ) cz = Math.sign( lz || 1 ) * penL;
			else cx = Math.sign( lx || 1 ) * penW;
			out[ 0 ] += cx * b.c + cz * b.s;
			out[ 1 ] += - cx * b.s + cz * b.c;

		}

		return out;

	}

	// The highest roof over ( x, z ), or −Infinity.
	top( x, z ) {

		let t = - Infinity;
		for ( const b of this.near ) {

			if ( b.y1 <= t ) continue;
			const dx = x - b.x, dz = z - b.z;
			if ( Math.abs( dx * b.s + dz * b.c ) < b.hl && Math.abs( dx * b.c - dz * b.s ) < b.hw ) t = b.y1;

		}

		return t;

	}

	// Something standing on a roof at ( x, z, y ) goes where the roof went since the last frame: [ x, z, turn ], or
	// null when it stands on no roof.
	carry( x, z, y ) {

		for ( const b of this.near ) {

			if ( Math.abs( y - b.y1 ) > 0.3 ) continue;
			const dx = x - b.x, dz = z - b.z;
			if ( Math.abs( dx * b.s + dz * b.c ) > b.hl || Math.abs( dx * b.c - dz * b.s ) > b.hw ) continue;
			// Where the point was on the box a frame ago, and where that place is now.
			const pc = Math.cos( b.pyaw ), ps = Math.sin( b.pyaw ), ox = x - b.px, oz = z - b.pz;
			const lz = ox * ps + oz * pc, lx = ox * pc - oz * ps;
			return [ b.x + lz * b.s + lx * b.c, b.z + lz * b.c - lx * b.s, b.yaw - b.pyaw ];

		}

		return null;

	}

}

// A box record for a vehicle at ( x, y, z ) turned yaw, `length` × `width` × `height`, going at `speed`, that was at
// ( px, pz, pyaw ) the frame before.
export function box( x, y, z, yaw, length, width, height, speed = 0, px = x, pz = z, pyaw = yaw, ref = null ) {

	return { x, z, yaw, c: Math.cos( yaw ), s: Math.sin( yaw ), hl: length / 2, hw: width / 2, y0: y, y1: y + height, px, pz, pyaw, speed, ref };

}
