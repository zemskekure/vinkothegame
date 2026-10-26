// Hiring a swan pedal boat (šlapadlo) at Slovanka, the boat rental on the west side of Slovanský ostrov, and pedalling
// it about the river between Most Legií and Šítkovský jez.
//
// The rental's floating pier and its gangway are OpenStreetMap's (ways 745626076 and 745626075, man_made=pier, traced
// from IPR Praha's aerial photo; the rental itself is node 7164413314, amenity=boat_rental "Slovanka"): a 40 m pontoon
// lying in the water some 15 m off the island's bank, a gangway out to it. Both are walkable zones (`jettyZones`, added
// to the city's zones before they are indexed); a few swans lie moored along the pontoon's river side.
//
// On the pontoon next to a moored swan, "[E] půjčit labuť". W/S pedal forward and back (a swan does about 6 km/h,
// gathering way slowly and losing it slowly), A/D the tiller (a slow turn that keeps turning a moment after the key is
// let go), the swan heaves and rolls a little, more at speed. The camera sits behind and above; V puts one in the seat
// behind the swan's neck. Land, the jetty, the bridges, the weirs and the other boats stop it with a soft bump. Back
// alongside the pontoon, "[E] vrátit" ties the swan up again and puts one ashore; the bill is on the board.
//
// The weirs (OSM waterway=weir: Šítkovský jez across the main river south of the island, ways 23113070 and 88827040,
// and the small one across the arm by Mánes, way 416152307) are drawn as a low concrete sill with a white line of
// water pouring over it, and are a boundary for the boats. OSM's lines stop a few metres short of the terrain's banks
// (the island's south tip, Masarykovo nábřeží), so they are carried on to them.
//
// Every boat on the river is also solid (`boxes`, src/solids.js), so the pigeon lands on swans as on tram roofs.

import * as THREE from 'three/webgpu';
import { Kit, M, plain, planks, textTexture } from './kit.js';

// Scene frame (x east, z south), from OSM via tools/geo.mjs.
const PIER = [ [ - 499.8, 536.7 ], [ - 502.5, 558.4 ], [ - 504.9, 577 ] ];
const GANGWAY = [ [ - 502.5, 558.4 ], [ - 493.6, 559.1 ] ];
const WEIRS = [
	[ [ - 723.4, 836.8 ], [ - 718.2, 837.1 ], [ - 658.2, 887.1 ], [ - 617.6, 889.9 ] ],
	[ [ - 602.6, 891 ], [ - 561.5, 893.7 ], [ - 486.2, 845.4 ], [ - 479.4, 845.3 ], [ - 452, 846 ] ],
	[ [ - 443.3, 764.6 ], [ - 424, 759.2 ], [ - 385.3, 759.6 ], [ - 372, 759.6 ] ]
];
const PIER_HALF = 1.2; // half the pontoon's width (m)
const DECK = 0.35; // the pontoon's deck over the water (m)
const BERTH = PIER_HALF + 1.05; // a moored swan's centre off the pontoon's middle line, on the river side
const BERTHS = [ 5, 10.5, 16, 27.5, 33 ]; // along the pontoon from its north end (m)

// How a swan pedal boat moves: the pedals push it up to ~1.65 m/s against the water's drag (which grows with the square
// of the speed), backwards slower; the tiller turns it slowly, faster when it is moving, and the turn carries on.
const PEDAL = { push: 0.55, back: 0.4, drag: 0.17, skin: 0.05, reverse: 0.9, turn: 0.32, turnMoving: 0.38, turnEase: 1.3 };
// The hull's outline for the bumps (local: x to the right, z to the bow), a little inside the boat's own.
const HULL = [ [ 0, 1.35 ], [ 0, - 1.3 ], [ 0.68, 0.45 ], [ - 0.68, 0.45 ], [ 0.68, - 0.85 ], [ - 0.68, - 0.85 ] ];
const SEAT = { y: 0.12, z: - 0.3 }; // the figure's feet in the swan (model frame: y from the keel)
const EYE = { y: 1.55, z: - 0.55 };

const len = ( a, b ) => Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

// The pontoon's segments as { a, b, d (unit along), n (unit towards the river, west), l, s0 (distance from its north end) }.
function pierSegments() {

	const out = [];
	let s0 = 0;
	for ( let i = 1; i < PIER.length; i ++ ) {

		const a = PIER[ i - 1 ], b = PIER[ i ], l = len( a, b ), d = [ ( b[ 0 ] - a[ 0 ] ) / l, ( b[ 1 ] - a[ 1 ] ) / l ];
		let n = [ d[ 1 ], - d[ 0 ] ];
		if ( n[ 0 ] > 0 ) n = [ - n[ 0 ], - n[ 1 ] ];
		out.push( { a, b, d, n, l, s0 } );
		s0 += l;

	}

	return out;

}

// A place on the pontoon `s` m from its north end, `o` m off its middle line towards the river.
function pierAt( s, o = 0 ) {

	const segs = pierSegments();
	let g = segs[ 0 ];
	for ( const q of segs ) if ( s >= q.s0 ) g = q;
	const t = s - g.s0;
	return { x: g.a[ 0 ] + g.d[ 0 ] * t + g.n[ 0 ] * o, z: g.a[ 1 ] + g.d[ 1 ] * t + g.n[ 1 ] * o, d: g.d, n: g.n };

}

// The gangway runs from the pontoon to the first ground a metre over the water, a metre on.
function gangwayEnds( terrainHeight, waterLevel ) {

	const [ a, b ] = GANGWAY, l = len( a, b ), d = [ ( b[ 0 ] - a[ 0 ] ) / l, ( b[ 1 ] - a[ 1 ] ) / l ];
	let t = PIER_HALF;
	while ( t < 40 && terrainHeight( a[ 0 ] + d[ 0 ] * t, a[ 1 ] + d[ 1 ] * t ) < waterLevel + 1.2 ) t += 0.5;
	t += 1;
	const end = [ a[ 0 ] + d[ 0 ] * t, a[ 1 ] + d[ 1 ] * t ];
	return { a, d, t, end, y1: terrainHeight( ...end ) };

}

// The walkable zones of the pontoon and the gangway (the zone format of tools/places.mjs), first the pontoon's.
export function jettyZones( terrainHeight, waterLevel ) {

	const y = waterLevel + DECK, zones = [];
	for ( const { a, b, d, l } of pierSegments() ) zones.push( { x: ( a[ 0 ] + b[ 0 ] ) / 2, z: ( a[ 1 ] + b[ 1 ] ) / 2, ux: d[ 0 ], uz: d[ 1 ], hu: l / 2 + 0.6, hn: PIER_HALF, y } );
	const g = gangwayEnds( terrainHeight, waterLevel );
	zones.push( { x: g.a[ 0 ] + g.d[ 0 ] * g.t / 2, z: g.a[ 1 ] + g.d[ 1 ] * g.t / 2, ux: - g.d[ 1 ], uz: g.d[ 0 ], hu: 1, hn: g.t / 2, y0: y, y1: g.y1, along: g.d } );
	return zones;

}

// The gangway goes down through the island's embankment railing: the railing's panels and posts where it passes are
// taken out of the embankment's data, and the walk barriers along the river edge cut there (both before the city
// builds them); its handrails become barriers.
export function cutJettyGap( data, terrainHeight ) {

	const g = gangwayEnds( terrainHeight, data.waterLevel ), [ ax, az ] = g.a, bx = g.end[ 0 ], bz = g.end[ 1 ];
	const off = ( x, z ) => {

		const dx = bx - ax, dz = bz - az, t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( dx * dx + dz * dz ) ) );
		return Math.hypot( x - ax - t * dx, z - az - t * dz );

	};
	const GAP = 1.15;
	const rails = data.embankment?.rails, posts = data.embankment?.posts;
	if ( rails ) {

		const kept = [];
		for ( let i = 0; i < rails.length; i += 6 ) if ( off( ( rails[ i ] + rails[ i + 3 ] ) / 2, ( rails[ i + 2 ] + rails[ i + 5 ] ) / 2 ) > GAP + 0.4 ) kept.push( ...rails.slice( i, i + 6 ) );
		data.embankment.rails = kept;

	}

	if ( posts ) {

		const kept = [];
		for ( let i = 0; i < posts.length; i += 3 ) if ( off( posts[ i ], posts[ i + 2 ] ) > GAP ) kept.push( posts[ i ], posts[ i + 1 ], posts[ i + 2 ] );
		data.embankment.posts = kept;

	}

	// A barrier crossing the gangway loses the stretch within GAP of its middle line (sampled every 5 cm).
	const barriers = data.places?.barriers;
	if ( ! barriers ) return;
	const out = [];
	for ( const seg of barriers ) {

		const [ x0, z0, x1, z1, ...rest ] = seg, l = Math.hypot( x1 - x0, z1 - z0 ), n = Math.max( 1, Math.ceil( l / 0.05 ) );
		let start = null;
		for ( let k = 0; k <= n; k ++ ) {

			const t = k / n, x = x0 + ( x1 - x0 ) * t, z = z0 + ( z1 - z0 ) * t, open = off( x, z ) > GAP;
			if ( open && start === null ) start = t;
			if ( ( ! open || k === n ) && start !== null ) {

				const e = open ? t : ( k - 1 ) / n;
				if ( start === 0 && e === 1 ) out.push( seg );
				else if ( e > start ) out.push( [ x0 + ( x1 - x0 ) * start, z0 + ( z1 - z0 ) * start, x0 + ( x1 - x0 ) * e, z0 + ( z1 - z0 ) * e, ...rest ] );
				start = null;

			}

		}

	}

	// The gangway's handrails keep one on it, from the pontoon's edge to the railing's gap.
	for ( const o of [ - 0.95, 0.95 ] ) {

		const p = t => [ + ( ax + g.d[ 0 ] * t - g.d[ 1 ] * o ).toFixed( 2 ), + ( az + g.d[ 1 ] * t + g.d[ 0 ] * o ).toFixed( 2 ) ];
		out.push( [ ...p( PIER_HALF + 0.25 ), ...p( g.t - 0.6 ), - 99 ] );

	}

	barriers.length = 0;
	barriers.push( ...out );

}

// The pontoon, the gangway, the moored swans' cleats, the rental's board and the weirs.
function buildJetty( scene, terrainHeight, waterLevel ) {

	const kit = new Kit(), y = waterLevel + DECK;
	const deck = planks( 0x8d6c49, 0x6e5238 ), float = plain( 0x3a4046, { roughness: 0.7 } ), concrete = plain( 0xa7a49b, { roughness: 0.95 } ), foam = plain( 0xe8eef0, { roughness: 1 } );
	// A box `w` wide, `h` high, `l` long, its middle at ( x, y, z ), its length along ( dx, dz ), its nose rising by `slope`.
	const beam = ( w, h, l, x, cy, z, dx, dz, slope = 0 ) => new THREE.BoxGeometry( w, h, l ).rotateX( - slope ).rotateY( Math.atan2( dx, dz ) ).translate( x, cy, z );

	for ( const { a, b, d, n, l } of pierSegments() ) {

		const mx = ( a[ 0 ] + b[ 0 ] ) / 2, mz = ( a[ 1 ] + b[ 1 ] ) / 2;
		kit.add( deck, beam( PIER_HALF * 2, 0.12, l + 0.3, mx, y - 0.06, mz, d[ 0 ], d[ 1 ] ) );
		kit.add( float, beam( PIER_HALF * 2 - 0.3, 0.5, l, mx, waterLevel - 0.05, mz, d[ 0 ], d[ 1 ] ) );
		// Wooden kerbs along both edges, and a cleat every few metres on the river side.
		for ( const o of [ - 1, 1 ] ) kit.add( M.woodDark, beam( 0.12, 0.1, l + 0.3, mx + n[ 0 ] * o * ( PIER_HALF - 0.06 ), y + 0.05, mz + n[ 1 ] * o * ( PIER_HALF - 0.06 ), d[ 0 ], d[ 1 ] ) );
		for ( let t = 2; t < l; t += 5.5 ) kit.add( M.iron, beam( 0.12, 0.16, 0.36, a[ 0 ] + d[ 0 ] * t + n[ 0 ] * ( PIER_HALF - 0.3 ), y + 0.08, a[ 1 ] + d[ 1 ] * t + n[ 1 ] * ( PIER_HALF - 0.3 ), d[ 0 ], d[ 1 ] ) );

	}

	// The gangway: planks sloping up to the bank between two iron handrails on posts.
	const g = gangwayEnds( terrainHeight, waterLevel ), run = g.t - PIER_HALF, rise = g.y1 - y, slope = Math.atan2( rise, run );
	const along = Math.hypot( run, rise ), x0 = g.a[ 0 ] + g.d[ 0 ] * PIER_HALF, z0 = g.a[ 1 ] + g.d[ 1 ] * PIER_HALF;
	const at = ( t, o, h ) => [ x0 + g.d[ 0 ] * t - g.d[ 1 ] * o, y + rise * t / run + h, z0 + g.d[ 1 ] * t + g.d[ 0 ] * o ];
	const mid = at( run / 2, 0, - 0.05 );
	kit.add( deck, beam( 1.8, 0.1, along, ...mid, ...g.d, slope ) );
	for ( const o of [ - 0.86, 0.86 ] ) {

		kit.add( M.iron, beam( 0.04, 0.04, along, ...at( run / 2, o, 0.95 ), ...g.d, slope ) );
		for ( let t = 0; t <= run + 0.01; t += run / Math.max( 1, Math.round( run / 1.6 ) ) ) kit.add( M.iron, beam( 0.04, 0.95, 0.04, ...at( t, o, 0.47 ), ...g.d ) );

	}

	// The rental's boards: one where the gangway meets the pontoon, facing the river, one on the island's promenade
	// beside the gap in the railing, facing the path; each on two posts.
	const pier = pierAt( pierSegments()[ 0 ].l + 0.5, - PIER_HALF + 0.25 ), side = [ - g.d[ 1 ], g.d[ 0 ] ];
	const top = [ g.end[ 0 ] + g.d[ 0 ] * 0.6 + side[ 0 ] * 2.4, g.end[ 1 ] + g.d[ 1 ] * 0.6 + side[ 1 ] * 2.4 ];
	const boards = [
		{ x: pier.x, z: pier.z, y, along: pier.d, face: pier.n },
		{ x: top[ 0 ], z: top[ 1 ], y: terrainHeight( ...top ), along: side, face: g.d }
	];
	for ( const s of boards ) for ( const o of [ - 1.1, 1.1 ] ) kit.add( M.woodDark, beam( 0.1, 2.3, 0.1, s.x + s.along[ 0 ] * o, s.y + 1.15, s.z + s.along[ 1 ] * o, ...s.face ) );
	kit.build( scene, { shadows: false } );
	const tex = textTexture( [ [ 'PŮJČOVNA LODIČEK', 132, 104 ], [ 'LABUTĚ · ŠLAPADLA · LOĎKY', 60, 196 ] ], { w: 1024, h: 256, bg: '#f1e8cf', ink: '#1e3f6c', border: '#1e3f6c', weight: '700' } );
	const boardMaterial = new THREE.MeshStandardNodeMaterial( { map: tex, roughness: 0.7, side: THREE.DoubleSide } ), plane = new THREE.PlaneGeometry( 2.6, 0.65 );
	for ( const s of boards ) {

		const board = new THREE.Mesh( plane, boardMaterial );
		board.position.set( s.x, s.y + 1.85, s.z );
		board.rotation.y = Math.atan2( s.face[ 0 ], s.face[ 1 ] );
		scene.add( board );

	}

	// The weirs: a sill just over the water, the white tumble along its downstream (north) side.
	const weirs = new Kit();
	for ( const line of WEIRS ) for ( let i = 1; i < line.length; i ++ ) {

		const a = line[ i - 1 ], b = line[ i ], l = len( a, b ), dx = ( b[ 0 ] - a[ 0 ] ) / l, dz = ( b[ 1 ] - a[ 1 ] ) / l;
		const nx = dz, nz = - dx, k = nz < 0 ? 1 : - 1; // the downstream side is north (−z)
		weirs.add( concrete, beam( 1.6, 0.4, l + 0.8, ( a[ 0 ] + b[ 0 ] ) / 2, waterLevel - 0.1, ( a[ 1 ] + b[ 1 ] ) / 2, dx, dz ) );
		weirs.add( foam, beam( 1.4, 0.06, l + 0.8, ( a[ 0 ] + b[ 0 ] ) / 2 + nx * k * 1.3, waterLevel + 0.03, ( a[ 1 ] + b[ 1 ] ) / 2 + nz * k * 1.3, dx, dz ) );

	}

	weirs.build( scene, { shadows: false } );

}

export function addPedalo( { scene, camera, walker, hud, boats, groundHeight, terrainHeight, waterLevel, bounds } ) {

	buildJetty( scene, terrainHeight, waterLevel );
	const swan = boats.kinds.swan, spec = boats.info.boats.swan;
	const draught = 0.12, gunwale = spec.deck * spec.height;

	// The moored swans: one batch; the hired one leaves it for a mesh of its own while out.
	const berths = BERTHS.map( s => {

		const p = pierAt( s, BERTH );
		return { x: p.x, z: p.z, heading: Math.atan2( - p.d[ 0 ], - p.d[ 1 ] ), s, out: false, phase: s * 1.7 };

	} );
	const moored = new THREE.InstancedMesh( swan.geometry, swan.material, berths.length );
	moored.frustumCulled = false;
	moored.receiveShadow = true;
	scene.add( moored );

	const rig = new THREE.Group();
	const hull = new THREE.Mesh( swan.geometry, swan.material );
	hull.receiveShadow = true;
	rig.add( hull );
	rig.visible = false;
	scene.add( rig );

	// Ripples: rings spreading from the stern while the swan moves, fading out (one batch, additive, its colour the fade).
	const RINGS = 14, rings = new THREE.InstancedMesh( new THREE.RingGeometry( 0.9, 1, 18 ).rotateX( - Math.PI / 2 ),
		new THREE.MeshBasicNodeMaterial( { color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } ), RINGS );
	const ringLife = new Float32Array( RINGS ), ringXZ = new Float32Array( RINGS * 2 ), ringDrift = new Float32Array( RINGS * 2 );
	const black = new THREE.Color( 0 ), tint = new THREE.Color();
	for ( let i = 0; i < RINGS; i ++ ) rings.setColorAt( i, black );
	rings.frustumCulled = false;
	rings.visible = false;
	scene.add( rings );
	let nextRing = 0, ringClock = 0;

	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), one = new THREE.Vector3( 1, 1, 1 ), zero = new THREE.Vector3();
	const place = ( mesh, i, x, y, z, rx, ry, rz, s = one ) => mesh.setMatrixAt( i, m4.compose( v3.set( x, y, z ), q.setFromEuler( e.set( rx, ry, rz, 'YXZ' ) ), s ) );
	let time = 0;

	function mooring( dt ) {

		berths.forEach( ( b, i ) => {

			const p = b.phase + time;
			if ( b.out ) moored.setMatrixAt( i, m4.makeScale( 0, 0, 0 ) );
			else place( moored, i, b.x, waterLevel - draught + Math.sin( p * 1.3 ) * 0.03, b.z, Math.sin( p * 0.9 ) * 0.02, b.heading, Math.sin( p * 1.1 ) * 0.03 );

		} );
		moored.instanceMatrix.needsUpdate = true;

	}

	mooring( 0 );

	// Open water for the hull: inside the city, low ground (not the jetty, not a bridge's deck) and off the weirs.
	const nearWeir = ( x, z ) => {

		for ( const line of WEIRS ) for ( let i = 1; i < line.length; i ++ ) {

			const [ x0, z0 ] = line[ i - 1 ], [ x1, z1 ] = line[ i ], dx = x1 - x0, dz = z1 - z0;
			const t = Math.max( 0, Math.min( 1, ( ( x - x0 ) * dx + ( z - z0 ) * dz ) / ( dx * dx + dz * dz ) ) );
			if ( Math.hypot( x - x0 - t * dx, z - z0 - t * dz ) < 1.2 ) return true;

		}

		return false;

	};
	const wet = ( x, z ) => x > bounds.minX + 2 && x < bounds.maxX - 2 && z > bounds.minZ + 2 && z < bounds.maxZ - 2 && groundHeight( x, z ) < waterLevel - 0.25 && ! nearWeir( x, z );

	// Whether the hull at ( x, z ) turned `h` touches anything: the bank, the jetty, a weir, another boat.
	function touches( x, z, h ) {

		const s = Math.sin( h ), c = Math.cos( h );
		for ( const [ lx, lz ] of HULL ) {

			const px = x + lz * s + lx * c, pz = z + lz * c - lx * s;
			if ( ! wet( px, pz ) ) return true;
			for ( const b of walker.solids?.near || [] ) {

				if ( b.ref === me ) continue;
				const dx = px - b.x, dz = pz - b.z;
				if ( Math.abs( dx * b.s + dz * b.c ) < b.hl + 0.1 && Math.abs( dx * b.c - dz * b.s ) < b.hw + 0.1 ) return true;

			}

		}

		return false;

	}

	// Out on the water: { berth, x, z, heading, v, turn, bump, started, fp } while hired.
	let me = null, wantE = false, shown = '', board = 0, thanks = 0;
	addEventListener( 'keydown', e => {

		if ( e.repeat || hud.paused || e.target.closest?.( 'input, textarea, select' ) ) return;
		if ( e.code === 'KeyE' ) wantE = true;
		if ( e.code === 'KeyV' && me && walker.enabled ) walker.setFirstPerson( ! walker.firstPerson );

	} );

	function hire( berth ) {

		berth.out = true;
		me = { berth, x: berth.x, z: berth.z, heading: berth.heading, v: 0, turn: 0, bump: 0, accel: 0, started: performance.now(), fp: walker.firstPerson, lastHeading: berth.heading };
		rig.visible = true;
		rig.add( walker.avatar );
		walker.avatar.position.set( 0, SEAT.y, SEAT.z );
		walker.avatar.rotation.set( 0, 0, 0 );
		walker.keys.clear();
		walker.setFirstPerson( false );
		walker.yaw = me.heading + Math.PI;
		walker.pitch = 0.3;
		walker.aboard = { boat: true, step: ( w, dt ) => step( dt ), off: () => leave( false ) };
		rings.visible = true;
		hud.hints( 'boat', 8 );
		step( 0 );

	}

	// Back to the pontoon (or, `ashore` false, taken off by the map or the view from above: then the teleport puts one
	// where it likes). The swan goes back to its berth either way.
	function leave( ashore ) {

		if ( ! me ) return;
		const minutes = Math.max( 1, Math.ceil( ( performance.now() - me.started ) / 60000 ) ), price = 50 * Math.ceil( minutes / 10 );
		me.berth.out = false;
		const fp = me.fp, { x, z } = me;
		me = null;
		rig.visible = false;
		rings.visible = false;
		walker.scene.add( walker.avatar );
		walker.aboard = null;
		walker.setFirstPerson( fp );
		hud.tram( 'LABUŤ', `Zaplaceno ${price} Kč`, 'Děkujeme, přijďte zas.' );
		thanks = 4;
		if ( ! ashore ) return;
		// On the pontoon's middle line beside where the swan came in, facing the island.
		let best = null, bd = Infinity;
		for ( let s = 1; s < BERTHS.at( - 1 ) + 4; s += 0.5 ) {

			const p = pierAt( s ), d = Math.hypot( p.x - x, p.z - z );
			if ( d < bd ) [ best, bd ] = [ p, d ];

		}

		walker.placed = false;
		walker.pos.set( best.x, groundHeight( best.x, best.z ), best.z );
		walker.y = walker.pos.y;
		walker.placed = true;
		walker.heading = Math.atan2( - best.n[ 0 ], - best.n[ 1 ] );
		walker.yaw = walker.heading + Math.PI;
		walker.apply( 0 );

	}

	// One frame out on the water.
	function step( dt ) {

		const k = walker.keys, b = me;
		let pedal = ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 ) - ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 );
		let tiller = ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 );
		if ( Math.hypot( walker.stick.x, walker.stick.y ) > 0.15 ) {

			pedal = THREE.MathUtils.clamp( - walker.stick.y, - 1, 1 );
			tiller = THREE.MathUtils.clamp( walker.stick.x, - 1, 1 );

		}

		// The pedals against the water's drag; the tiller turns it, the turn eased in and out (momentum).
		const v0 = b.v;
		b.v += ( pedal > 0 ? pedal * PEDAL.push : pedal * PEDAL.back ) * dt;
		b.v -= ( b.v * Math.abs( b.v ) * PEDAL.drag + b.v * PEDAL.skin ) * dt;
		b.v = Math.max( - PEDAL.reverse, b.v );
		const rate = tiller * ( PEDAL.turn + PEDAL.turnMoving * Math.min( 1, Math.abs( b.v ) / 1.6 ) ) * ( b.v < - 0.05 ? - 1 : 1 );
		b.turn += ( rate - b.turn ) * Math.min( 1, dt * PEDAL.turnEase );
		b.accel += ( ( b.v - v0 ) / Math.max( dt, 1e-3 ) - b.accel ) * Math.min( 1, dt * 4 );

		// Turning first (undone if the bow or stern would swing into something), then the move in short steps; a
		// bump stops it gently, sliding along the bank where it can, and gives it a little shake.
		// Against the bank the swan pivots off it: a turn that would swing the bow or stern into something is tried
		// with the boat eased a few centimetres aside.
		const h = b.heading - b.turn * dt;
		if ( ! touches( b.x, b.z, h ) || touches( b.x, b.z, b.heading ) ) b.heading = h;
		else {

			const ok = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ].find( ( [ i, j ] ) => ! touches( b.x + i * 0.06, b.z + j * 0.06, h ) );
			if ( ok ) {

				b.x += ok[ 0 ] * 0.06;
				b.z += ok[ 1 ] * 0.06;
				b.heading = h;

			} else b.turn *= 0.5;

		}
		const s = Math.sin( b.heading ), c = Math.cos( b.heading ), steps = Math.max( 1, Math.ceil( Math.abs( b.v * dt ) / 0.2 ) );
		for ( let i = 0; i < steps && dt; i ++ ) {

			const dx = s * b.v * dt / steps, dz = c * b.v * dt / steps;
			const stuck = touches( b.x, b.z, b.heading );
			if ( stuck || ! touches( b.x + dx, b.z + dz, b.heading ) ) {

				b.x += dx;
				b.z += dz;
				continue;

			}

			if ( Math.abs( b.v ) > 0.25 ) b.bump = Math.min( 1, Math.abs( b.v ) / 1.5 );
			if ( ! touches( b.x + dx, b.z, b.heading ) ) b.x += dx * 0.5, b.v *= 0.6;
			else if ( ! touches( b.x, b.z + dz, b.heading ) ) b.z += dz * 0.5, b.v *= 0.6;
			else b.v *= - 0.25;
			break;

		}

		// A drifting boat that runs into the swan nudges it aside.
		for ( const o of walker.solids?.near || [] ) {

			if ( o.ref === b || ! o.boat ) continue;
			const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot( dx, dz ), reach = 1.2 + Math.max( o.hl, o.hw ) * 0.8;
			if ( d > reach || d < 1e-3 || dt === 0 ) continue;
			const push = Math.min( reach - d, 0.6 * dt );
			if ( ! touches( b.x + dx / d * push, b.z + dz / d * push, b.heading ) ) b.x += dx / d * push, b.z += dz / d * push;

		}

		// Heave, pitch and roll: the slow swell of the river, the bow lifting as the pedals push, a lean out of the turn,
		// and the shake of a bump dying away.
		time += dt;
		b.bump = Math.max( 0, b.bump - dt * 1.6 );
		const t = time, shake = b.bump * Math.sin( t * 26 ) * 0.05;
		const y = waterLevel - draught + Math.sin( t * 1.3 ) * 0.035 + shake * 0.4;
		const pitch = Math.sin( t * 0.9 ) * 0.02 - b.accel * 0.08 + shake;
		const roll = Math.sin( t * 1.1 + 0.5 ) * 0.03 + b.turn * b.v * 0.08;
		rig.position.set( b.x, y, b.z );
		rig.rotation.set( pitch, b.heading, roll, 'YXZ' );
		walker.avatar.userData.setPose( { phase: 0, stride: 0, t, ride: true, air: 0 } );
		walker.pos.set( b.x, y + gunwale, b.z );
		walker.y = walker.pos.y;
		walker.heading = b.heading;
		ripples( dt );
		view( dt );

	}

	// The camera: behind and above the swan, swinging back behind it a moment after the mouse looked away, turning
	// with it; or (V) in the seat behind the neck.
	const eye = new THREE.Vector3(), aim = new THREE.Vector3();
	function view( dt ) {

		const b = me, turn = b.heading - b.lastHeading;
		b.lastHeading = b.heading;
		walker.yaw += turn;
		walker.lookTime = Math.max( 0, walker.lookTime - dt );
		if ( walker.firstPerson ) {

			rig.updateMatrixWorld();
			eye.set( 0, EYE.y, EYE.z ).applyMatrix4( rig.matrixWorld );
			camera.position.copy( eye );
			camera.rotation.set( - walker.pitch, walker.yaw, 0, 'YXZ' );
			walker.avatar.visible = false;
			return;

		}

		if ( ! walker.lookTime ) {

			let d = b.heading + Math.PI - walker.yaw;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			walker.yaw += d * Math.min( 1, dt * 0.9 );

		}

		walker.avatar.visible = true;
		if ( dt === 0 ) aim.set( b.x, rig.position.y + 1.3, b.z );
		else aim.lerp( v3.set( b.x, rig.position.y + 1.3, b.z ), Math.min( 1, dt * 5 ) );
		const dist = walker.distance + 1.6, cp = Math.cos( walker.pitch );
		camera.position.set( aim.x + Math.sin( walker.yaw ) * cp * dist, Math.max( waterLevel + 0.5, aim.y + Math.sin( walker.pitch ) * dist ), aim.z + Math.cos( walker.yaw ) * cp * dist );
		camera.lookAt( aim );

	}

	function ripples( dt ) {

		const b = me;
		ringClock -= dt;
		if ( Math.abs( b.v ) > 0.3 && ringClock <= 0 ) {

			ringClock = 0.45;
			const s = Math.sin( b.heading ), c = Math.cos( b.heading ), back = b.v > 0 ? - 1.3 : 1.4;
			for ( const side of [ - 1, 1 ] ) {

				const i = nextRing = ( nextRing + 1 ) % RINGS;
				ringLife[ i ] = 1;
				ringXZ[ i * 2 ] = b.x + s * back + c * side * 0.55;
				ringXZ[ i * 2 + 1 ] = b.z + c * back - s * side * 0.55;
				ringDrift[ i * 2 ] = c * side * 0.25;
				ringDrift[ i * 2 + 1 ] = - s * side * 0.25;

			}

		}

		for ( let i = 0; i < RINGS; i ++ ) {

			const l = ringLife[ i ] = Math.max( 0, ringLife[ i ] - dt / 2.6 );
			ringXZ[ i * 2 ] += ringDrift[ i * 2 ] * dt;
			ringXZ[ i * 2 + 1 ] += ringDrift[ i * 2 + 1 ] * dt;
			const r = l ? 0.3 + ( 1 - l ) * 1.2 : 0;
			place( rings, i, ringXZ[ i * 2 ], waterLevel + 0.03, ringXZ[ i * 2 + 1 ], 0, 0, 0, r ? sc.set( r, 1, r ) : zero );
			rings.setColorAt( i, tint.setScalar( 0.1 * l * l ) );

		}

		rings.instanceMatrix.needsUpdate = true;
		rings.instanceColor.needsUpdate = true;

	}

	// Every frame on foot, after the walker: the moored swans' bobbing, the prompts, E, and the board while out.
	let shownBoard = - 1;
	function update( dt, active ) {

		time += me ? 0 : dt;
		mooring( dt );
		let prompt = '';
		if ( me ) {

			// Alongside the pontoon (within a couple of metres of its river edge) and slow: "[E] vrátit".
			let near = false;
			for ( const g of pierSegments() ) {

				const dx = me.x - g.a[ 0 ], dz = me.z - g.a[ 1 ], u = dx * g.d[ 0 ] + dz * g.d[ 1 ], o = dx * g.n[ 0 ] + dz * g.n[ 1 ];
				if ( u > - 1 && u < g.l + 1 && o > 0 && o < BERTH + 2.2 ) near = true;

			}

			if ( near && Math.abs( me.v ) < 1.2 ) prompt = 'vrátit';
			if ( wantE && prompt ) leave( true );
			board -= dt;
			if ( me && board <= 0 ) {

				board = 0.5;
				const sec = Math.floor( ( performance.now() - me.started ) / 1000 ), minutes = Math.max( 1, Math.ceil( sec / 60 ) );
				const kmh = ( Math.abs( me.v ) * 3.6 ).toFixed( 1 ).replace( '.', ',' );
				const key = `${minutes}|${kmh}`;
				if ( key !== shownBoard ) {

					shownBoard = key;
					hud.tram( 'LABUŤ', `Půjčovné: ${minutes} min · ${50 * Math.ceil( minutes / 10 )} Kč`, `${kmh} km/h` );

				}

			}

		} else {

			if ( thanks > 0 && ( thanks -= dt ) <= 0 ) hud.tram( null );
			shownBoard = - 1;
			// On the pontoon, beside a moored swan: "[E] půjčit labuť".
			let berth = null, bd = 3.4;
			if ( active && walker.placed && ! walker.riding && ! walker.aboard && walker.y < waterLevel + DECK + 0.4 ) {

				for ( const b of berths ) {

					const d = Math.hypot( b.x - walker.pos.x, b.z - walker.pos.z );
					if ( ! b.out && d < bd ) [ berth, bd ] = [ b, d ];

				}

			}

			if ( berth ) prompt = 'půjčit labuť';
			if ( wantE && berth ) {

				hire( berth );
				prompt = '';

			}

		}

		wantE = false;
		if ( prompt !== shown ) {

			shown = prompt;
			hud.prompt( prompt ? [ [ [ 'E' ], prompt ] ] : null, hud.touch && prompt ? () => wantE = true : null );

		}

	}

	// Every boat on the river as a solid box, its top the gunwale (src/solids.js): where it was the last time it was
	// asked (a frame ago), for the pigeon riding on one.
	const last = new Map();
	function boxes( x, z, r, out ) {

		const add = ( ref, bx, bz, heading, name, y ) => {

			if ( Math.abs( bx - x ) > r || Math.abs( bz - z ) > r ) return;
			const s = boats.info.boats[ name ], prev = last.get( ref ) || [ bx, bz, heading ];
			const top = s.deck * s.height;
			const bxr = { boat: true, x: bx, z: bz, yaw: heading, c: Math.cos( heading ), s: Math.sin( heading ), hl: s.length / 2 * 0.92, hw: s.width / 2 * 0.9, y0: y, y1: y + top, px: prev[ 0 ], pz: prev[ 1 ], pyaw: prev[ 2 ], speed: 0, ref };
			out.push( bxr );
			last.set( ref, [ bx, bz, heading ] );

		};

		for ( const b of boats.boats ) add( b, b.x, b.z, b.heading, b.name, waterLevel - b.draught );
		for ( const b of berths ) if ( ! b.out ) add( b, b.x, b.z, b.heading, 'swan', waterLevel - draught );
		if ( me ) add( me, me.x, me.z, me.heading, 'swan', waterLevel - draught );

	}

	return { update, boxes, get out() {

		return me;

	}, berths, jetty: pierAt( 21, 0 ) };

}
