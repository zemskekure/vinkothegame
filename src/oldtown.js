// The Old Town's landmarks east of the river (tools/oldtown.mjs):
//
//   - Týnský chrám: the two gothic west towers over the roofs of the Týn houses, dark stone shafts with a corbelled
//     gallery and the spiky slate helmets: a tall central spire with four little turrets half way up, four corner
//     spires and the pinnacles between them, gilt knobs on every point.
//   - Staroměstská radnice: the tower with its gallery, corner turrets and steep roof (as on the bridge towers), and
//     on its south face the orloj: the calendar dial below, the astronomical dial (the blue day sky, the black
//     night, the gilt ring of the hours, the eccentric zodiac, the sun and the moon on their hands), Vanity, the
//     Miser, Death and the Turk beside it, the chronicler, the angel, the astronomer and the philosopher by the
//     calendar, the two apostle windows under the gothic gable with the golden cock. On the hour (or at once with
//     `?orloj`, then every minute) Death rings his bell, the windows open and the twelve apostles pass by.
//   - Prašná brána: the gothic gate tower over the street, its pointed passage (walkable), statues in niches on
//     both faces, the gallery, corner turrets and steep roof.
//   - Obecní dům: the copper dome over the corner and the great mosaic lunette of the front under it, the balcony,
//     the doors, the sculpture groups either side.
//   - Staroměstské náměstí: the Jan Hus monument (the reformer standing over the bronze crowd of the defeated and
//     the exiles, on its granite base), the Marian column with its angels, the brass meridian in the paving.

import * as THREE from 'three/webgpu';
import { Kit, M, plain, glow, ashlar, box, cyl, ANIMATE } from './kit.js';
import { KARLUV_MATERIALS as KM, figure, towerCrown, towerBody, window2, inFrame } from './karluv.js';

const O = {
	tyn: ashlar( 0x58534c, 0x666057 ),
	hall: ashlar( 0x8d8578, 0x9d9588 ),
	powder: ashlar( 0x4f4a44, 0x5d5750 ),
	plaster: plain( 0xe6d6ae, { roughness: 0.9 } ),
	bronze: plain( 0x2e3a33, { roughness: 0.6, metalness: 0.4, flatShading: true } ),
	granite: plain( 0x7a7670, { roughness: 0.9, flatShading: true } ),
	sky: plain( 0x2f5797, { roughness: 0.5 } ),
	night: plain( 0x15161a, { roughness: 0.5 } ),
	dusk: plain( 0x8a4a2a, { roughness: 0.5 } ),
	cream: plain( 0xe9dfc6, { roughness: 0.6 } ),
	red: plain( 0x9c2a22, { roughness: 0.6 } ),
	bone: plain( 0xd9d3c3, { roughness: 0.8, flatShading: true } ),
	mosaic: plain( 0xc79a52, { roughness: 0.5 } ),
	mosaicBlue: plain( 0x3f6f9a, { roughness: 0.5 } ),
	glass: glow( 0xffe6b0, 0.6 )
};
const copper = new Map();
const metal = hex => {

	if ( ! copper.has( hex ) ) copper.set( hex, plain( new THREE.Color( hex || '#5f8a78' ).getHex(), { roughness: 0.6, metalness: 0.25, flatShading: true } ) );
	return copper.get( hex );

};

// A figure into a kit, through a transform.
const figureInto = ( add, place, opts ) => figure( { push: ( [ m, g ] ) => add( m, place( g ) ) }, KM.statue, opts );

// ---------------------------------------------------------------------------
// Týn

function tynTower( kit, t, ground ) {

	const add = inFrame( kit, t ), hu = t.hu, hv = t.hv, base = ground - 0.5;
	const spireTop = t.top + 8; // the surface model only sees the needle's lower part
	const body = ground + ( spireTop - ground ) * 0.6;
	add( O.tyn, box( hu * 2, body - base, hv * 2, 0, base ) );
	for ( const y of [ body - 14, body - 6 ] ) add( O.tyn, box( hu * 2 + 0.3, 0.35, hv * 2 + 0.3, 0, y ) );
	for ( const y of [ body - 12, body - 4.5 ] ) for ( const s of [ - 1, 1 ] ) {

		window2( add, KM.dark, s * ( hu + 0.02 ) + 0.04, 0, y, 0.8, 2.6 );
		window2( add, KM.dark, s * ( hv + 0.02 ) + 0.04, 0, y, 0.8, 2.6, true );

	}

	// The corbelled gallery, then the helmet.
	add( O.tyn, box( hu * 2 + 0.9, 0.6, hv * 2 + 0.9, 0, body ) );
	const r = Math.min( hu, hv ) * 0.85, H = spireTop - body - 0.6;
	add( KM.slate, new THREE.ConeGeometry( r, H, 8 ).rotateY( Math.PI / 8 ).translate( 0, body + 0.6 + H / 2, 0 ) );
	// Four little turrets half way up the central spire.
	for ( let k = 0; k < 4; k ++ ) {

		const a = Math.PI / 4 + k * Math.PI / 2, rr = r * 0.62, y = body + 0.6 + H * 0.32;
		const x = Math.cos( a ) * rr, z = Math.sin( a ) * rr;
		add( KM.slate, cyl( 0.4, 0.4, 1.2, x, y, z, 6 ), new THREE.ConeGeometry( 0.48, 3.2, 6 ).translate( x, y + 2.8, z ) );
		add( KM.gold, new THREE.OctahedronGeometry( 0.15, 0 ).translate( x, y + 4.5, z ) );

	}

	// Corner spires on their turrets, and the pinnacles between them.
	for ( const [ su, sv ] of [ [ - 1, - 1 ], [ - 1, 1 ], [ 1, - 1 ], [ 1, 1 ] ] ) {

		const x = su * ( hu - 0.2 ), z = sv * ( hv - 0.2 );
		add( O.tyn, cyl( 0.75, 0.75, 2.6, x, body + 0.6, z, 8 ) );
		add( KM.slate, new THREE.ConeGeometry( 0.9, 7.5, 8 ).translate( x, body + 3.2 + 3.75, z ) );
		add( KM.gold, new THREE.SphereGeometry( 0.22, 6, 4 ).translate( x, body + 11.0, z ) );

	}

	for ( const [ x, z ] of [ [ hu, 0 ], [ - hu, 0 ], [ 0, hv ], [ 0, - hv ] ] ) {

		add( KM.slate, new THREE.ConeGeometry( 0.45, 3.6, 6 ).translate( x * 0.95, body + 0.6 + 1.8, z * 0.95 ) );
		add( KM.gold, new THREE.OctahedronGeometry( 0.12, 0 ).translate( x * 0.95, body + 4.5, z * 0.95 ) );

	}

	add( KM.gold, cyl( 0.05, 0.08, 2.0, 0, spireTop - 0.4, 0, 6 ), new THREE.SphereGeometry( 0.35, 8, 5 ).translate( 0, spireTop - 0.2, 0 ) );

}

// ---------------------------------------------------------------------------
// The Old Town Hall's tower and the orloj

function orloj( scene, kit, h, add ) {

	// On the house wall where OSM has the clock (tools/oldtown.mjs), facing out of it (OSM: direction 155°, SSE).
	const bearing = 155 * Math.PI / 180, [ nx, nz ] = h.orlojN || [ Math.sin( bearing ), - Math.cos( bearing ) ];
	const ry = Math.atan2( nx, nz ), off = 0, xs = 0;
	// Face space: x along the wall, y up, z out of it.
	const F = g => g.rotateY( ry ).translate( h.orloj[ 0 ] + nx * 0.1, 0, h.orloj[ 1 ] + nz * 0.1 );
	add = ( m, g ) => kit.add( m, g );
	const y0 = h.ground;
	const put = ( m, ...g ) => g.forEach( q => add( m, F( q ) ) );
	put( KM.relief, box( 6.8, 13.6, 0.35, 0, y0 + 1.4, 0.17 ) );
	// The gothic gable over the apostle windows, the cock in its niche.
	put( KM.relief, new THREE.ConeGeometry( 3.2, 3.4, 4, 1 ).rotateY( Math.PI / 4 ).scale( 1, 1, 0.18 ).translate( 0, y0 + 16.7, 0.4 ) );
	put( KM.gold, box( 0.3, 0.45, 0.2, 0, y0 + 15.5, 0.6 ) );
	// The calendar dial.
	const disc = ( r, y, z, m ) => put( m, new THREE.CylinderGeometry( r, r, 0.08, 28 ).rotateX( Math.PI / 2 ).translate( 0, y, z ) );
	disc( 1.5, y0 + 4.2, 0.4, KM.gold );
	disc( 1.3, y0 + 4.2, 0.45, O.cream );
	for ( let k = 0; k < 12; k ++ ) {

		const a = k * Math.PI / 6;
		put( k % 2 ? O.mosaicBlue : O.dusk, new THREE.CylinderGeometry( 0.22, 0.22, 0.04, 8 ).rotateX( Math.PI / 2 ).translate( Math.cos( a ) * 0.95, y0 + 4.2 + Math.sin( a ) * 0.95, 0.5 ) );

	}

	disc( 0.5, y0 + 4.2, 0.5, KM.gold );
	disc( 0.32, y0 + 4.2, 0.54, O.red );
	// The astronomical dial: day sky above, night below, dusk and dawn between, the hours' gilt ring, the zodiac.
	const ay = y0 + 9.4;
	disc( 2.05, ay, 0.4, KM.relief );
	disc( 1.9, ay, 0.45, O.sky );
	put( O.night, new THREE.CircleGeometry( 1.9, 20, Math.PI * 1.15, Math.PI * 0.7 ).translate( 0, ay, 0.5 ) );
	put( O.dusk, new THREE.RingGeometry( 1.25, 1.9, 12, 1, Math.PI * 1.0, Math.PI * 0.15 ).translate( 0, ay, 0.495 ), new THREE.RingGeometry( 1.25, 1.9, 12, 1, Math.PI * 1.85, Math.PI * 0.15 ).translate( 0, ay, 0.495 ) );
	put( KM.gold, new THREE.TorusGeometry( 1.9, 0.07, 4, 28 ).translate( 0, ay, 0.5 ), new THREE.TorusGeometry( 0.95, 0.05, 4, 24 ).translate( 0, ay + 0.45, 0.55 ) );
	put( KM.gold, box( 0.06, 1.75, 0.04, 0, 0, 0 ).rotateZ( - 0.6 ).translate( 0, ay, 0.62 ) );
	put( KM.gold, new THREE.SphereGeometry( 0.2, 8, 5 ).translate( Math.sin( 0.6 ) * 1.2, ay + Math.cos( 0.6 ) * 1.2, 0.64 ) );
	put( O.night, new THREE.SphereGeometry( 0.14, 8, 5 ).translate( - 0.8, ay + 0.9, 0.64 ) );
	// The figures beside the dials, on their consoles.
	for ( const [ x, y, hgt ] of [ [ - 2.35, ay - 1.2, 1.15 ], [ - 2.95, ay - 1.2, 1.15 ], [ 2.95, ay - 1.2, 1.15 ], [ - 2.2, y0 + 3.0, 1.2 ], [ - 2.85, y0 + 3.0, 1.2 ], [ 2.2, y0 + 3.0, 1.2 ], [ 2.85, y0 + 3.0, 1.2 ] ] ) {

		put( KM.relief, box( 0.55, 0.15, 0.5, x, y - 0.15, 0.5 ) );
		figureInto( put, g => g.translate( x, y, 0.55 ), { h: hgt, pose: x > 0 ? 'open' : 'hold' } );

	}

	// Death, the skeleton, with his bell: his arm swings when the hour strikes.
	const deathX = 2.35;
	put( KM.relief, box( 0.55, 0.15, 0.5, deathX, ay - 1.35, 0.5 ) );
	figureInto( ( m, g ) => put( O.bone, g ), g => g.translate( deathX, ay - 1.2, 0.55 ), { h: 1.15, pose: 'hold' } );
	// The apostle windows: dark openings, shutters, and behind each a turntable of six apostles.
	const wy = y0 + 13.0, wins = [ - 0.75, 0.75 ];
	for ( const x of wins ) put( KM.dark, box( 0.62, 0.95, 0.06, x, wy, 0.37 ) );
	put( KM.relief, box( 2.6, 0.2, 0.5, 0, wy - 0.2, 0.45 ), box( 2.6, 0.2, 0.5, 0, wy + 0.95, 0.45 ) );

	const moving = new THREE.Group();
	moving.userData.dynamic = true; // turns on the hour (ANIMATE): kept out of the static batches (src/batch.js)
	moving.rotation.y = ry;
	moving.position.set( h.orloj[ 0 ] + nx * 0.1, 0, h.orloj[ 1 ] + nz * 0.1 );
	scene.add( moving );
	const mats = [ plain( 0x7a5a3a, { flatShading: true } ), plain( 0x5a6a7a, { flatShading: true } ), plain( 0x7a3a3a, { flatShading: true } ) ];
	const tables = wins.map( ( x, w ) => {

		const t = new THREE.Group();
		t.position.set( x, wy, off + 0.55 );
		for ( let k = 0; k < 6; k ++ ) {

			const g = new THREE.Group(), a = k * Math.PI / 3;
			const k2 = new Kit();
			figure( { push: ( [ , q ] ) => k2.add( mats[ ( k + w ) % 3 ], q ) }, null, { h: 0.85, pose: k % 2 ? 'pray' : 'hold', attr: k % 3 === 0 ? 'book' : null } );
			k2.build( g, { shadows: false } );
			g.position.set( Math.sin( a ) * 0.2, - 0.02, Math.cos( a ) * 0.2 - 0.15 );
			g.rotation.y = a;
			t.add( g );

		}

		t.visible = false;
		moving.add( t );
		return t;

	} );
	const shutters = wins.flatMap( x => [ - 1, 1 ].map( s => {

		const p = new THREE.Group();
		p.position.set( x + s * 0.31, wy, off + 0.42 );
		const m = new THREE.Mesh( new THREE.BoxGeometry( 0.31, 0.95, 0.04 ).translate( - s * 0.155, 0.475, 0 ), KM.wood );
		p.add( m );
		p.userData.s = s;
		moving.add( p );
		return p;

	} ) );
	const arm = new THREE.Group();
	arm.position.set( deathX + 0.22, ay - 1.2 + 1.0, off + 0.6 );
	arm.add( new THREE.Mesh( new THREE.BoxGeometry( 0.07, 0.5, 0.07 ).translate( 0, - 0.25, 0 ), O.bone ), new THREE.Mesh( new THREE.ConeGeometry( 0.09, 0.14, 6 ).translate( 0, - 0.55, 0 ), KM.gold ) );
	moving.add( arm );

	// The show: 45 s from the full hour (or every minute with ?orloj). Death rings, the windows open, each table
	// turns a sixth every 3.5 s, then the windows close.
	const always = new URLSearchParams( location.search ).has( 'orloj' );
	let t0 = null, shown = - 1;
	ANIMATE.push( () => {

		const now = new Date(), key = always ? now.getMinutes() : now.getHours();
		const due = always ? now.getSeconds() < 45 : now.getMinutes() === 0 && now.getSeconds() < 45;
		if ( due && shown !== key ) {

			shown = key;
			t0 = performance.now();

		}

		const t = t0 === null ? - 1 : ( performance.now() - t0 ) / 1000;
		const on = t >= 0 && t < 45;
		arm.rotation.z = on && t < 8 ? Math.sin( t * 9 ) * 0.6 : 0;
		const open = on ? Math.min( 1, t / 2, ( 45 - t ) / 2 ) : 0;
		for ( const p of shutters ) p.rotation.y = p.userData.s * open * 1.6;
		for ( const tb of tables ) {

			tb.visible = open > 0;
			if ( on ) tb.rotation.y = - Math.floor( Math.max( 0, t - 3 ) / 3.5 ) * Math.PI / 3;

		}

		if ( ! on ) t0 = null;

	} );

}

function hallTower( scene, kit, h ) {

	const add = inFrame( kit, h ), base = h.ground - 0.5, eave = h.eave, apex = h.top + 6;
	add( O.hall, box( h.hu * 2, eave - 0.6 - base, h.hv * 2, 0, base ) );
	for ( const y of [ base + 17.5, eave - 9 ] ) add( O.hall, box( h.hu * 2 + 0.3, 0.3, h.hv * 2 + 0.3, 0, y ) );
	for ( const y of [ eave - 7.5, eave - 15 ] ) for ( const s of [ - 1, 1 ] ) {

		window2( add, KM.dark, s * ( h.hu + 0.02 ) + 0.04, 0, y, 1.1, 2.8 );
		window2( add, KM.dark, s * ( h.hv + 0.02 ) + 0.04, 0, y, 1.1, 2.8, true );

	}

	towerCrown( add, O.hall, h.hu, h.hv, eave, apex, { slender: true } );
	if ( h.orloj ) orloj( scene, kit, h, add );

}

// ---------------------------------------------------------------------------
// Prašná brána

function powderTower( kit, p ) {

	const add = inFrame( kit, p ), base = p.ground - 1, eave = p.eave, apex = Math.max( p.top + 2, eave + 13 );
	const floor = p.floor;
	add( O.powder, towerBody( p.hu, p.hv, base, eave - 0.6, { v: 0, half: p.passage, floor: floor - 0.05, spring: floor + 4.0, apex: floor + 7.2 } ) );
	add( KM.sett, box( p.hu * 2, 0.04, p.passage * 2, 0, floor ) );
	for ( const y of [ floor + 8.6, floor + 16, floor + 24 ] ) add( O.powder, box( p.hu * 2 + 0.35, 0.35, p.hv * 2 + 0.35, 0, y ) );
	// Both street faces: statues in niches over the passage, blind tracery and windows up to the gallery.
	for ( const s of [ - 1, 1 ] ) {

		const E = s * ( p.hu + 0.02 );
		for ( const [ v, y ] of [ [ - 2.6, floor + 9.0 ], [ 2.6, floor + 9.0 ], [ - 1.3, floor + 16.4 ], [ 1.3, floor + 16.4 ], [ - 3.4, floor + 16.4 ], [ 3.4, floor + 16.4 ] ] ) {

			add( KM.relief, box( 0.3, 0.25, 0.9, E + s * 0.12, y, v ), new THREE.ConeGeometry( 0.55, 1.2, 4 ).rotateY( Math.PI / 4 ).translate( E + s * 0.2, y + 2.6, v ) );
			figureInto( add, g => g.rotateY( s * Math.PI / 2 ).translate( E + s * 0.2, y + 0.25, v ), { h: 1.9, pose: 'hold', attr: 'book' } );

		}

		for ( let i = 0; i <= 6; i ++ ) add( KM.relief, box( 0.14, eave - 0.6 - ( floor + 24.4 ), 0.14, E + s * 0.05, floor + 24.4, ( i - 3 ) * ( p.hv * 2 - 1 ) / 6 ) );
		for ( const v of [ - 1.5, 1.5 ] ) window2( add, KM.dark, E + ( s > 0 ? 0.1 : 0 ), v, floor + 19, 0.9, 2.8 );
		for ( const v of [ - 2.4, 0, 2.4 ] ) window2( add, KM.dark, E + ( s > 0 ? 0.1 : 0 ), v, floor + 26.5, 0.8, 3.6 );

	}

	for ( const s of [ - 1, 1 ] ) for ( const y of [ floor + 11, floor + 19, floor + 27 ] ) window2( add, KM.dark, s * ( p.hv + 0.02 ) + 0.04, 0, y, 0.9, 2.6, true );
	towerCrown( add, O.powder, p.hu, p.hv, eave, apex );

}

// ---------------------------------------------------------------------------
// Obecní dům

function obecniDum( kit, d ) {

	const roof = metal( d.colour ), H = d.top - d.eave;
	// Drum, the ribbed copper dome, its lantern and finial.
	kit.add( O.plaster, cyl( d.r, d.r, 2.2, d.x, d.eave - 1.5, d.z, 16 ) );
	const prof = [ [ d.r + 0.2, 0 ], [ d.r * 0.92, H * 0.3 ], [ d.r * 0.7, H * 0.55 ], [ d.r * 0.35, H * 0.72 ], [ 0.3, H * 0.78 ] ];
	kit.add( roof, new THREE.LatheGeometry( prof.map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), 12 ).translate( d.x, d.eave + 0.7, d.z ) );
	kit.add( roof, cyl( 0.35, 0.35, H * 0.12, d.x, d.eave + 0.7 + H * 0.78, d.z, 8 ) );
	kit.add( KM.gold, new THREE.SphereGeometry( 0.3, 8, 5 ).translate( d.x, d.top, d.z ) );
	// The front: the mosaic lunette ("Homage to Prague") in its arch, the balcony, the doors, the sculpture groups.
	const ry = Math.atan2( d.nx, d.nz ), [ fx, fz ] = d.front;
	const F = g => g.rotateY( ry ).translate( fx + d.nx * 0.2, 0, fz + d.nz * 0.2 );
	const R = Math.min( 5.2, d.r * 1.3 ), cy = d.eave - R - 1.2;
	kit.add( O.plaster, F( new THREE.TorusGeometry( R + 0.35, 0.45, 4, 16, Math.PI ).translate( 0, cy, 0.25 ) ) );
	kit.add( O.mosaic, F( new THREE.CircleGeometry( R, 16, 0, Math.PI ).translate( 0, cy, 0.12 ) ) );
	kit.add( O.mosaicBlue, F( new THREE.CircleGeometry( R * 0.55, 12, 0, Math.PI ).translate( 0, cy, 0.14 ) ) );
	kit.add( O.plaster, F( box( R * 2 + 1.6, 0.35, 1.4, 0, cy - 0.6, 0.6 ) ) );
	for ( let k = - 2; k <= 2; k ++ ) kit.add( M.iron, F( box( 0.05, 1.0, 0.05, k * R * 0.4, cy - 0.25, 1.25 ) ) );
	kit.add( M.iron, F( box( R * 2 + 1.4, 0.06, 0.06, 0, cy + 0.75, 1.25 ) ) );
	for ( const x of [ - 2.2, 0, 2.2 ] ) kit.add( O.glass, F( box( 1.6, 3.2, 0.1, x, d.ground, 0.1 ) ) );
	for ( const s of [ - 1, 1 ] ) {

		kit.add( O.plaster, F( box( 1.6, 0.6, 1.3, s * ( R + 1.4 ), d.eave - 0.4, 0.4 ) ) );
		figureInto( ( m, g ) => kit.add( m, g ), g => F( g.translate( s * ( R + 1.2 ), d.eave + 0.2, 0.4 ) ), { h: 2.2, pose: 'open' } );
		figureInto( ( m, g ) => kit.add( m, g ), g => F( g.rotateY( - s * 0.5 ).translate( s * ( R + 1.9 ), d.eave + 0.2, 0.3 ) ), { h: 1.5, pose: 'pray', kneel: true } );

	}

}

// ---------------------------------------------------------------------------
// Staroměstské náměstí

function husMonument( kit, m ) {

	// The granite base from its OSM outline, 1.2 m high, steps round it.
	const shape = new THREE.Shape( m.ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
	kit.add( O.granite, new THREE.ExtrudeGeometry( shape, { depth: 1.2, bevelEnabled: false } ).rotateX( - Math.PI / 2 ).translate( 0, m.y, 0 ) );
	const y = m.y + 1.2, [ sx, sz ] = m.statue;
	// The bronze: a rocky mass rising to Hus, the crowds either side, the mother with her child at the front.
	const dirx = sx - m.x, dirz = sz - m.z, l = Math.hypot( dirx, dirz ) || 1;
	const ry = Math.atan2( dirx / l, dirz / l );
	const P = ( g, dx, dz ) => g.rotateY( ry ).translate( sx + Math.cos( ry ) * dx + Math.sin( ry ) * dz, 0, sz - Math.sin( ry ) * dx + Math.cos( ry ) * dz );
	kit.add( O.bronze, P( new THREE.DodecahedronGeometry( 1, 0 ).scale( 2.6, 1.7, 1.7 ).translate( 0, y + 1.5, - 0.6 ), 0, 0 ) );
	figureInto( ( mm, g ) => kit.add( O.bronze, g ), g => P( g.translate( 0, y + 3.0, - 0.5 ), 0, 0 ), { h: 3.6, pose: 'open' } );
	for ( const [ dx, dz, h, pose, kneel ] of [ [ - 3.0, 0.3, 2.0, 'raise', false ], [ - 4.3, - 0.4, 1.9, 'hold', false ], [ - 5.4, 0.2, 1.4, 'pray', true ], [ - 2.0, 1.2, 1.5, 'pray', true ],
		[ 3.0, 0.3, 2.0, 'hold', false ], [ 4.2, - 0.3, 1.9, 'open', false ], [ 5.3, 0.3, 1.5, 'pray', true ], [ 2.0, 1.3, 1.8, 'hold', false ] ] ) {

		kit.add( O.bronze, P( new THREE.DodecahedronGeometry( 0.7, 0 ).scale( 1.4, 0.8, 1.2 ).translate( 0, y + 0.4, 0 ), dx, dz ) );
		figureInto( ( mm, g ) => kit.add( O.bronze, g ), g => P( g.translate( 0, y + 0.6, 0 ), dx, dz ), { h, pose, kneel } );

	}

	figureInto( ( mm, g ) => kit.add( O.bronze, g ), g => P( g.translate( 0, y, 0 ), 0.6, 2.2 ), { h: 1.7, attr: 'child', kneel: true } );

}

function marianColumn( kit, c ) {

	const y = c.y;
	kit.add( O.granite, cyl( 1.6, 1.8, 0.5, c.x, y, c.z, 8 ), cyl( 1.0, 1.1, 2.6, c.x, y + 0.5, c.z, 8 ) );
	kit.add( O.granite, box( 1.2, 0.5, 1.2, c.x, y + 3.1, c.z ) );
	kit.add( O.cream, cyl( 0.42, 0.5, c.column - 4.6, c.x, y + 3.6, c.z, 10 ) );
	kit.add( O.cream, box( 1.0, 0.5, 1.0, c.x, y + c.column - 1.0, c.z ), box( 1.2, 0.3, 1.2, c.x, y + c.column - 0.5, c.z ) );
	// The Virgin with the gilt halo of stars.
	figure( { push: ( [ m, g ] ) => kit.add( m === KM.statue ? O.cream : m, g.translate( c.x, y + c.column - 0.2, c.z ) ) }, O.cream, { h: 2.0, pose: 'pray', attr: 'stars' } );
	// The angels on the corners of the base (OSM: three of the four mapped; the fourth opposite the third).
	const angels = [ ...c.angels ];
	if ( angels.length === 3 ) angels.push( [ 2 * c.x - angels[ 2 ][ 0 ], 2 * c.z - angels[ 2 ][ 1 ] ] );
	for ( const [ ax, az ] of angels ) {

		kit.add( O.granite, box( 0.8, 0.8, 0.8, ax, y, az ) );
		const ry = Math.atan2( ax - c.x, az - c.z );
		figure( { push: ( [ m, g ] ) => kit.add( O.cream, g.rotateY( ry ).translate( ax, y + 0.8, az ) ) }, O.cream, { h: 1.6, pose: 'raise' } );
		kit.add( O.cream, new THREE.BoxGeometry( 0.9, 0.6, 0.06 ).rotateY( ry ).translate( ax - Math.sin( ry ) * 0.3, y + 2.1, az - Math.cos( ry ) * 0.3 ) );

	}

}

function meridian( kit, pts ) {

	for ( let i = 1; i < pts.length; i ++ ) {

		const [ ax, az, ay ] = pts[ i - 1 ], [ bx, bz, by ] = pts[ i ], l = Math.hypot( bx - ax, bz - az );
		if ( l < 0.05 ) continue;
		kit.add( KM.gold, new THREE.BoxGeometry( 0.09, 0.05, l ).rotateY( Math.atan2( bx - ax, bz - az ) ).translate( ( ax + bx ) / 2, ( ay + by ) / 2 + 0.06, ( az + bz ) / 2 ) );

	}

}

export function addOldTown( scene, o ) {

	if ( ! o ) return;
	const kit = new Kit();
	if ( o.tyn ) for ( const t of o.tyn.towers ) tynTower( kit, t, o.tyn.ground );
	if ( o.hall ) hallTower( scene, kit, o.hall );
	if ( o.powder ) powderTower( kit, o.powder );
	if ( o.obecni ) obecniDum( kit, o.obecni );
	if ( o.hus ) husMonument( kit, o.hus );
	if ( o.marian ) marianColumn( kit, o.marian );
	if ( o.meridian ) meridian( kit, o.meridian );
	kit.build( scene );

}
