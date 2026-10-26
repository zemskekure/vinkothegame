// Karlův most (Charles Bridge) and its towers, placed by tools/karluv.mjs:
//
//   - The stone bridge: segmental arches between the piers, each pier with a pointed cutwater upstream (south) and a
//     smaller one downstream, capped with sloping stone (the aerial photo shows the triangles under every pair of
//     statues); sandstone spandrels with a string course under the parapet; solid sandstone parapets with a coping;
//     the deck paved with setts; wooden ice-guards upstream of the river piers (OSM man_made=dolphin).
//   - The 30 statues and statuary groups over the piers, as dark weathered sandstone (and the two bronzes, St John of
//     Nepomuk with his halo of five gilded stars and the crucifix of the Calvary with its gilded inscription) on
//     their pedestals on the parapets; the Bruncvík column on the pier by Kampa; the small brass cross on the
//     parapet where St John was thrown into the river; the gas lamps on the parapets between the piers.
//   - Staroměstská mostecká věž: Parler's gothic tower over the deck, the pointed arch of the passage through it,
//     the sculpted east face (the frieze of coats of arms, the seated Charles IV and Wenceslas IV either side of
//     St Vitus, St Adalbert and St Sigismund above them, blind tracery), the plain west face (wrecked in 1648), the
//     gallery round the steep slate roof with its four corner turrets, the stair turret on the south side.
//   - The Lesser Town bridge towers: the tall late-gothic tower with the same gallery, turrets and steep roof, the
//     lower romanesque Judith Tower, and between them the gate: two crenellated walls with a round arch each.
//
// Low poly and flat coloured (one shared plain material per colour, merged by src/batch.js), stone in the shared
// ashlar pattern.

import * as THREE from 'three/webgpu';
import { color, positionLocal, mix, vec2, floor, fract, abs, max, smoothstep } from 'three/tsl';
import { hash2D } from './shading/common.js';
import { Kit, M, plain, glow, ashlar, box, cyl } from './kit.js';
import { deckFrame, strip, beam } from './bridges.js';

// Granite setts of the deck, in rows across the bridge.
function setts() {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.92 } );
	const p = positionLocal;
	const cz = p.z.div( 0.19 ), cx = p.x.div( 0.23 ).add( floor( cz ).mul( 0.5 ) );
	const cell = vec2( floor( cx ), floor( cz ) );
	const joint = max( smoothstep( 0.36, 0.5, abs( fract( cx ).sub( 0.5 ) ) ), smoothstep( 0.34, 0.5, abs( fract( cz ).sub( 0.5 ) ) ) );
	m.colorNode = mix( mix( color( 0x736d65 ), color( 0x878074 ), hash2D( cell ) ), color( 0x4f4a44 ), joint.mul( 0.45 ) );
	return m;

}

const K = {
	stone: ashlar( 0x6a6256, 0x7c7366 ),
	coping: plain( 0x7a7265, { roughness: 0.9 } ),
	sett: setts(),
	statue: plain( 0x3b3834, { roughness: 0.95, flatShading: true } ),
	statueLight: plain( 0x4d4842, { roughness: 0.95, flatShading: true } ),
	pedestal: plain( 0x5d564b, { roughness: 0.95, flatShading: true } ),
	bronze: plain( 0x2f2a23, { metalness: 0.5, roughness: 0.5, flatShading: true } ),
	gold: M.gold,
	iron: plain( 0x1e201f, { metalness: 0.5, roughness: 0.5 } ),
	lamp: glow( 0xffe2a6, 1.3 ),
	wood: plain( 0x4a3c2d, { roughness: 0.9 } ),
	tower: ashlar( 0x6a6256, 0x7a7164 ),
	lesser: ashlar( 0x837b6d, 0x958c7d ),
	judith: ashlar( 0x9a917f, 0xaaa18e ),
	slate: plain( 0x3a3f46, { roughness: 0.75, flatShading: true } ),
	dark: plain( 0x1b1a18, { roughness: 0.9 } ),
	relief: plain( 0x8a8070, { roughness: 0.95, flatShading: true } ),
	infill: plain( 0xb3a891, { roughness: 0.9 } )
};

// A closed solid from triangles, each turned to face away from `c` (its inside).
function solid( tris, c ) {

	const pos = [];
	const v = new THREE.Vector3(), w = new THREE.Vector3(), nrm = new THREE.Vector3();
	for ( const [ a, b, d ] of tris ) {

		v.set( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );
		w.set( d[ 0 ] - a[ 0 ], d[ 1 ] - a[ 1 ], d[ 2 ] - a[ 2 ] );
		nrm.crossVectors( v, w );
		const mx = ( a[ 0 ] + b[ 0 ] + d[ 0 ] ) / 3 - c[ 0 ], my = ( a[ 1 ] + b[ 1 ] + d[ 1 ] ) / 3 - c[ 1 ], mz = ( a[ 2 ] + b[ 2 ] + d[ 2 ] ) / 3 - c[ 2 ];
		if ( nrm.x * mx + nrm.y * my + nrm.z * mz < 0 ) pos.push( ...a, ...d, ...b );
		else pos.push( ...a, ...b, ...d );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( pos.length / 3 * 2 ), 2 ) );
	g.computeVertexNormals();
	return g;

}

// ---------------------------------------------------------------------------
// Statues: low-poly figures in a local frame (feet at y 0, facing +z), and the groups made of them.

const mat4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), eul = new THREE.Euler();
const place = ( g, x, y, z, ry = 0, rx = 0, rz = 0, s = 1 ) => g.applyMatrix4( mat4.compose( new THREE.Vector3( x, y, z ), quat.setFromEuler( eul.set( rx, ry, rz ) ), new THREE.Vector3( s, s, s ) ) );

// A standing robed figure `h` tall: a flared robe, torso, faceted head, arms in a pose; attributes in its hands.
function figure( out, mat, { h = 2.4, x = 0, y = 0, z = 0, ry = 0, pose = 'hold', attr = null, kneel = false } ) {

	const k = h / 2.4, parts = [], gold = [];
	const robeH = kneel ? 0.8 : 1.4;
	parts.push( new THREE.CylinderGeometry( 0.2, kneel ? 0.45 : 0.4, robeH, 7 ).translate( 0, robeH / 2, 0 ) );
	const ty = robeH;
	parts.push( new THREE.CylinderGeometry( 0.17, 0.22, 0.6, 6 ).translate( 0, ty + 0.3, 0 ) );
	parts.push( new THREE.IcosahedronGeometry( 0.15, 0 ).translate( 0, ty + 0.78, 0.02 ) );
	const sh = ty + 0.52;
	const arm = ( side, rx, rz ) => parts.push( new THREE.BoxGeometry( 0.12, 0.62, 0.12 ).translate( 0, - 0.31, 0 ).rotateX( rx ).rotateZ( rz ).translate( side * 0.22, sh, 0 ) );
	if ( pose === 'pray' ) {

		arm( - 1, - 1.0, - 0.35 );
		arm( 1, - 1.0, 0.35 );

	} else if ( pose === 'raise' ) {

		arm( - 1, - 0.5, 0.2 );
		arm( 1, - 2.7, 0 );

	} else if ( pose === 'open' ) {

		arm( - 1, - 0.3, - 0.9 );
		arm( 1, - 0.3, 0.9 );

	} else {

		arm( - 1, - 0.9, - 0.2 );
		arm( 1, - 0.2, 0.15 );

	}

	const hand = [ - 0.18, sh - 0.35, 0.42 ];
	if ( attr === 'cross' ) parts.push( new THREE.BoxGeometry( 0.06, 1.1, 0.06 ).translate( hand[ 0 ], hand[ 1 ] + 0.3, hand[ 2 ] ), new THREE.BoxGeometry( 0.42, 0.06, 0.06 ).translate( hand[ 0 ], hand[ 1 ] + 0.6, hand[ 2 ] ) );
	else if ( attr === 'child' ) parts.push( new THREE.CylinderGeometry( 0.08, 0.14, 0.42, 6 ).translate( hand[ 0 ] - 0.05, hand[ 1 ] + 0.1, hand[ 2 ] - 0.1 ), new THREE.IcosahedronGeometry( 0.09, 0 ).translate( hand[ 0 ] - 0.05, hand[ 1 ] + 0.4, hand[ 2 ] - 0.1 ) );
	else if ( attr === 'banner' ) {

		parts.push( new THREE.CylinderGeometry( 0.035, 0.035, 2.9, 5 ).translate( 0.45, 1.45, 0.15 ) );
		parts.push( new THREE.BoxGeometry( 0.55, 0.4, 0.03 ).translate( 0.74, 2.6, 0.15 ) );

	} else if ( attr === 'club' ) parts.push( new THREE.CylinderGeometry( 0.05, 0.11, 1.3, 6 ).translate( 0.4, 0.75, 0.2 ) );
	else if ( attr === 'basket' || attr === 'heart' || attr === 'book' ) parts.push( new THREE.BoxGeometry( 0.3, 0.2, 0.22 ).translate( hand[ 0 ], hand[ 1 ], hand[ 2 ] - 0.05 ) );
	else if ( attr === 'mitre' ) {

		parts.push( new THREE.ConeGeometry( 0.13, 0.32, 5 ).translate( 0, ty + 1.02, 0.02 ) );
		parts.push( new THREE.CylinderGeometry( 0.03, 0.03, 2.5, 5 ).translate( 0.42, 1.25, 0.15 ), new THREE.TorusGeometry( 0.12, 0.03, 4, 8, Math.PI * 1.4 ).translate( 0.42, 2.6, 0.15 ) );

	} else if ( attr === 'stars' ) {

		gold.push( new THREE.TorusGeometry( 0.32, 0.02, 3, 16 ).translate( 0, ty + 0.85, - 0.05 ) );
		for ( let i = 0; i < 5; i ++ ) {

			const a = Math.PI * ( 0.1 + 0.8 * i / 4 );
			gold.push( new THREE.OctahedronGeometry( 0.07, 0 ).translate( Math.cos( a ) * 0.32, ty + 0.85 + Math.sin( a ) * 0.32 - 0.12, - 0.05 ) );

		}

	}

	for ( const g of parts ) {

		if ( kneel ) g.translate( 0, 0, 0 );
		out.push( [ mat, place( g.scale( k, k, k ), x, y, z, ry ) ] );

	}

	for ( const g of gold ) out.push( [ K.gold, place( g.scale( k, k, k ), x, y, z, ry ) ] );

}

// A rough rock or cloud block (a squashed dodecahedron).
const rock = ( w, h, d, x = 0, y = 0, z = 0 ) => new THREE.DodecahedronGeometry( 0.5, 0 ).scale( w, h, d ).translate( x, y + h * 0.4, z );

// One statue or statuary group on its pedestal's top, by kind (tools/karluv.mjs).
function statue( out, st ) {

	const S = K.statue, kind = st.kind, attr = st.attr;
	const add = ( m, ...g ) => g.forEach( q => out.push( [ m, q ] ) );
	if ( kind === 'single' ) figure( out, S, { h: 2.5, attr, pose: attr === 'child' ? 'hold' : attr === 'banner' ? 'open' : 'hold' } );
	else if ( kind === 'bishop' ) figure( out, S, { h: 2.5, attr: 'mitre', pose: attr === 'heart' ? 'raise' : 'hold' } );
	else if ( kind === 'nepomuk' ) figure( out, K.bronze, { h: 2.6, attr: 'stars', pose: 'pray' } ), add( K.bronze, new THREE.BoxGeometry( 0.05, 0.7, 0.05 ).rotateZ( 0.6 ).translate( 0, 1.75, 0.38 ), new THREE.BoxGeometry( 0.26, 0.05, 0.05 ).rotateZ( 0.6 ).translate( - 0.05, 1.85, 0.38 ) );
	else if ( kind === 'group2' ) {

		add( S, rock( 1.7, 0.6, 1.3 ) );
		figure( out, S, { h: 2.3, x: - 0.35, y: 0.45, z: - 0.1, attr: 'cross' } );
		figure( out, S, { h: 2.1, x: 0.42, y: 0.45, z: 0.05, ry: - 0.3, pose: 'raise' } );
		if ( attr === 'rock' ) add( K.statueLight, rock( 0.7, 0.5, 0.6, 0.2, 0.05, 0.5 ) );

	} else if ( kind === 'group3' ) {

		add( S, box( 1.6, 0.35, 1.2 ) );
		if ( attr === 'christ' ) {

			add( S, rock( 0.9, 0.7, 0.7, 0, 0.35, - 0.25 ) );
			figure( out, S, { h: 2.2, y: 0.9, z: - 0.25, pose: 'open' } );
			figure( out, S, { h: 2.0, x: - 0.55, y: 0.35, z: 0.2, ry: 0.4, attr: 'book' } );
			figure( out, S, { h: 2.0, x: 0.55, y: 0.35, z: 0.2, ry: - 0.4, attr: 'book' } );

		} else if ( attr === 'angels' ) {

			figure( out, S, { h: 2.5, y: 0.35, z: - 0.15, attr: 'cross' } );
			figure( out, K.statueLight, { h: 1.2, x: - 0.6, y: 0.35, z: 0.25, ry: 0.5, pose: 'pray' } );
			figure( out, K.statueLight, { h: 1.2, x: 0.6, y: 0.35, z: 0.25, ry: - 0.5, pose: 'pray' } );

		} else {

			figure( out, S, { h: 2.4, y: 0.35, z: - 0.2, attr: 'book' } );
			figure( out, S, { h: 2.1, x: - 0.6, y: 0.35, z: 0.15, ry: 0.35, attr: 'banner' } );
			figure( out, S, { h: 2.1, x: 0.6, y: 0.35, z: 0.15, ry: - 0.35, pose: 'pray' } );

		}

	} else if ( kind === 'group4' ) {

		// Cyril and Methodius with the cross between them, the figures of the nation crouching below.
		add( S, rock( 1.9, 0.9, 1.4 ) );
		figure( out, S, { h: 2.3, x: - 0.4, y: 0.7, z: - 0.15, attr: 'book' } );
		figure( out, S, { h: 2.3, x: 0.4, y: 0.7, z: - 0.15, pose: 'raise' } );
		add( S, new THREE.BoxGeometry( 0.08, 1.6, 0.08 ).translate( 0, 2.6, - 0.35 ), new THREE.BoxGeometry( 0.6, 0.08, 0.08 ).translate( 0, 3.0, - 0.35 ) );
		figure( out, K.statueLight, { h: 1.1, x: - 0.6, y: 0, z: 0.45, ry: 0.6, kneel: true, pose: 'pray' } );
		figure( out, K.statueLight, { h: 1.1, x: 0.6, y: 0, z: 0.45, ry: - 0.6, kneel: true, pose: 'open' } );

	} else if ( kind === 'madona' ) {

		// The Madonna with the child, raised on a cloud, the saints at her feet.
		add( S, rock( 1.5, 0.9, 1.1, 0, 0.2, - 0.2 ) );
		figure( out, S, { h: 2.1, y: 1.0, z: - 0.25, attr: 'child' } );
		figure( out, K.statueLight, { h: 1.4, x: attr === 'two' ? - 0.6 : 0.45, y: 0, z: 0.4, ry: 0.4, kneel: true, pose: 'pray' } );
		if ( attr === 'two' ) figure( out, K.statueLight, { h: 1.6, x: 0.6, y: 0, z: 0.35, ry: - 0.4, attr: 'book' } );

	} else if ( kind === 'calvary' ) {

		// The bronze crucifix with the gilded Hebrew inscription on its arch, the Virgin and St John either side.
		add( K.bronze, new THREE.BoxGeometry( 0.16, 5.2, 0.14 ).translate( 0, 2.6, - 0.2 ), new THREE.BoxGeometry( 2.0, 0.16, 0.14 ).translate( 0, 4.0, - 0.2 ) );
		add( K.bronze, new THREE.CylinderGeometry( 0.12, 0.09, 1.3, 6 ).translate( 0, 3.3, - 0.08 ), new THREE.IcosahedronGeometry( 0.12, 0 ).translate( 0, 4.1, - 0.05 ), new THREE.BoxGeometry( 1.6, 0.1, 0.1 ).translate( 0, 3.95, - 0.08 ) );
		add( K.gold, new THREE.TorusGeometry( 1.25, 0.07, 3, 18, Math.PI ).scale( 1, 0.55, 1 ).translate( 0, 4.3, - 0.2 ) );
		figure( out, S, { h: 2.2, x: - 0.75, z: 0.1, ry: 0.5, pose: 'pray' } );
		figure( out, S, { h: 2.2, x: 0.75, z: 0.1, ry: - 0.5, pose: 'open' } );

	} else if ( kind === 'pieta' ) {

		add( S, box( 1.7, 0.4, 1.2 ) );
		figure( out, S, { h: 1.9, y: 0.4, z: - 0.2, pose: 'open' } );
		add( S, new THREE.CylinderGeometry( 0.15, 0.15, 1.5, 6 ).rotateZ( Math.PI / 2 - 0.25 ).translate( 0, 1.35, 0.15 ) );
		figure( out, S, { h: 1.9, x: - 0.68, y: 0.4, z: 0.1, ry: 0.5, pose: 'pray' } );
		figure( out, S, { h: 1.9, x: 0.68, y: 0.4, z: 0.1, ry: - 0.5, attr: 'book' } );

	} else if ( kind === 'luitgarda' ) {

		// St Luitgarda kneeling, Christ bending down to her from the cross.
		add( S, rock( 1.6, 0.6, 1.2 ) );
		add( S, new THREE.BoxGeometry( 0.14, 3.4, 0.12 ).translate( 0.25, 2.0, - 0.4 ), new THREE.BoxGeometry( 1.5, 0.12, 0.12 ).translate( 0.25, 3.1, - 0.4 ) );
		add( S, new THREE.CylinderGeometry( 0.12, 0.1, 1.2, 6 ).rotateX( 0.45 ).translate( 0.2, 2.5, - 0.15 ), new THREE.IcosahedronGeometry( 0.12, 0 ).translate( 0.15, 3.0, 0.05 ) );
		figure( out, S, { h: 1.6, x: - 0.25, y: 0.4, z: 0.25, ry: 0.3, kneel: true, pose: 'pray' } );

	} else if ( kind === 'kajetan' ) {

		// St Cajetan before a tall obelisk of clouds with angels.
		add( S, new THREE.CylinderGeometry( 0.15, 0.7, 3.6, 4 ).rotateY( Math.PI / 4 ).translate( 0, 1.8, - 0.35 ) );
		for ( const [ x, y ] of [ [ - 0.35, 1.6 ], [ 0.3, 2.3 ], [ - 0.15, 3.0 ] ] ) add( K.statueLight, new THREE.IcosahedronGeometry( 0.2, 0 ).translate( x, y, - 0.05 ) );
		figure( out, S, { h: 2.3, z: 0.25, pose: 'open' } );

	} else if ( kind === 'kristof' ) {

		figure( out, S, { h: 3.0, pose: 'hold' } );
		add( S, new THREE.CylinderGeometry( 0.05, 0.06, 3.2, 5 ).translate( 0.5, 1.6, 0.2 ) );
		add( S, new THREE.CylinderGeometry( 0.07, 0.12, 0.45, 6 ).translate( - 0.15, 2.95, - 0.05 ), new THREE.IcosahedronGeometry( 0.1, 0 ).translate( - 0.15, 3.3, - 0.05 ) );

	} else if ( kind === 'vitus' ) {

		// St Vitus on a rock with a cave, the lions at his feet.
		add( S, rock( 1.8, 1.4, 1.4 ) );
		add( K.dark, new THREE.BoxGeometry( 0.6, 0.5, 0.1 ).translate( 0, 0.35, 0.62 ) );
		for ( const x of [ - 0.55, 0.55 ] ) add( K.statueLight, new THREE.BoxGeometry( 0.3, 0.3, 0.7 ).translate( x, 1.2, 0.2 ), new THREE.IcosahedronGeometry( 0.17, 0 ).translate( x, 1.42, 0.55 ) );
		figure( out, S, { h: 2.1, y: 1.1, z: - 0.15, pose: 'open' } );

	} else if ( kind === 'turks' ) {

		// St John of Matha, St Felix and St Ivan over the rock with the Turk guarding the Christians in the cave, the
		// stag with the cross between its antlers on top.
		add( S, rock( 2.2, 1.6, 1.6 ) );
		add( K.dark, new THREE.BoxGeometry( 0.9, 0.7, 0.1 ).translate( 0, 0.45, 0.72 ) );
		for ( let i = 0; i < 5; i ++ ) add( K.iron, new THREE.BoxGeometry( 0.03, 0.7, 0.03 ).translate( - 0.36 + i * 0.18, 0.45, 0.78 ) );
		figure( out, K.statueLight, { h: 1.7, x: 0.75, y: 0, z: 0.55, ry: - 0.5, attr: 'club' } );
		figure( out, S, { h: 2.1, x: - 0.4, y: 1.25, z: - 0.2, attr: 'cross' } );
		figure( out, S, { h: 1.9, x: 0.35, y: 1.25, z: - 0.1, ry: - 0.3, pose: 'open' } );
		add( S, new THREE.BoxGeometry( 0.25, 0.3, 0.7 ).translate( 0.55, 1.5, - 0.5 ), new THREE.BoxGeometry( 0.05, 0.4, 0.05 ).translate( 0.55, 1.95, - 0.2 ) );

	} else if ( kind === 'xaver' ) {

		// St Francis Xavier raising the cross, carried on a platform by four converts.
		for ( const [ x, z ] of [ [ - 0.55, - 0.35 ], [ 0.55, - 0.35 ], [ - 0.55, 0.4 ], [ 0.55, 0.4 ] ] ) figure( out, K.statueLight, { h: 1.45, x, z, ry: Math.atan2( - x, - z ) + Math.PI, pose: 'raise' } );
		add( S, box( 1.7, 0.22, 1.3, 0, 1.45 ) );
		figure( out, S, { h: 2.2, y: 1.67, attr: 'cross', pose: 'raise' } );

	} else figure( out, S, { h: 2.5 } );

}

// A pedestal on the parapet (local frame: y 0 on the deck, the statue's top at 2.85).
function pedestal( out, kind ) {

	out.push( [ K.pedestal, box( 2.0, 0.6, 1.8 ) ], [ K.pedestal, box( 1.6, 1.95, 1.45, 0, 0.6 ) ], [ K.pedestal, box( 1.95, 0.3, 1.75, 0, 2.55 ) ] );
	// St John of Nepomuk's bronze reliefs, rubbed bright by the hands of passers-by.
	if ( kind === 'nepomuk' ) out.push( [ K.bronze, box( 0.6, 0.45, 0.04, - 0.38, 1.05, 0.73 ) ], [ K.bronze, box( 0.6, 0.45, 0.04, 0.38, 1.05, 0.73 ) ], [ K.gold, box( 0.12, 0.1, 0.05, - 0.3, 1.2, 0.73 ) ], [ K.gold, box( 0.12, 0.1, 0.05, 0.45, 1.15, 0.73 ) ] );

}

// ---------------------------------------------------------------------------
// Towers

// A tower in its own frame (u along `ux, uz`, v across, centre x, z): geometries in local coordinates, placed with
// rotateY( atan2( −uz, ux ) ) and the centre.
function inFrame( kit, f ) {

	const ry = Math.atan2( - f.uz, f.ux );
	return ( m, ...geos ) => kit.add( m, ...geos.map( g => g.rotateY( ry ).translate( f.x, 0, f.z ) ) );

}

// The smallest rectangle round an outline (scene frame).
function obb( ring, dir ) {

	let best = null;
	const dirs = dir ? [ dir ] : ring.map( ( a, i ) => {

		const b = ring[ ( i + 1 ) % ring.length ], l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		return l > 1 ? [ ( b[ 0 ] - a[ 0 ] ) / l, ( b[ 1 ] - a[ 1 ] ) / l ] : null;

	} ).filter( Boolean );
	for ( const [ ux, uz ] of dirs ) {

		const us = ring.map( ( [ x, z ] ) => x * ux + z * uz ), vs = ring.map( ( [ x, z ] ) => - x * uz + z * ux );
		const u0 = Math.min( ...us ), u1 = Math.max( ...us ), v0 = Math.min( ...vs ), v1 = Math.max( ...vs ), area = ( u1 - u0 ) * ( v1 - v0 );
		if ( ! best || area < best.area ) best = { area, ux, uz, u0, u1, v0, v1 };

	}

	const { ux, uz, u0, u1, v0, v1 } = best, cu = ( u0 + u1 ) / 2, cv = ( v0 + v1 ) / 2;
	return { x: cu * ux - cv * uz, z: cu * uz + cv * ux, ux, uz, hu: ( u1 - u0 ) / 2, hv: ( v1 - v0 ) / 2, u0, v0 };

}

// A pointed (gothic) arch outline in the v–y plane from v0 to v1, springing at y0: two arcs, each centred on the
// opposite springing point (an equilateral arch), drawn up or down to the apex at y1.
function pointedPath( path, v0, v1, floorY, y0, y1, steps = 6 ) {

	const S = v1 - v0, k = ( y1 - y0 ) / ( S * Math.sin( Math.PI / 3 ) );
	path.moveTo( v0, floorY ).lineTo( v0, y0 );
	for ( let i = 1; i <= steps; i ++ ) {

		const t = Math.PI - Math.PI / 3 * i / steps;
		path.lineTo( v1 + S * Math.cos( t ), y0 + S * Math.sin( t ) * k );

	}

	for ( let i = steps - 1; i >= 0; i -- ) {

		const t = Math.PI / 3 * i / steps;
		path.lineTo( v0 + S * Math.cos( t ), y0 + S * Math.sin( t ) * k );

	}

	path.lineTo( v1, floorY ).closePath();
	return path;

}

// A tower body: a box from `base` to `top`, hv across and hu along, with an optional pointed passage along u.
function towerBody( hu, hv, base, top, passage ) {

	const s = new THREE.Shape().moveTo( - hv, base ).lineTo( hv, base ).lineTo( hv, top ).lineTo( - hv, top ).closePath();
	if ( passage ) s.holes.push( pointedPath( new THREE.Path(), passage.v - passage.half, passage.v + passage.half, passage.floor, passage.spring, passage.apex ) );
	// Shape x is v, extruded along z: turned so the extrusion runs along u (symmetric, so its sign doesn't matter).
	return new THREE.ExtrudeGeometry( s, { depth: hu * 2, bevelEnabled: false, curveSegments: 4 } ).translate( 0, 0, - hu ).rotateY( - Math.PI / 2 );

}

// A pointed window or blind arch: a dark recess on a face (normal along +u, or +v with `across`).
function window2( add, mat, u, v, y, w, h, across = false ) {

	const shape = new THREE.Shape().moveTo( - w / 2, 0 ).lineTo( w / 2, 0 ).lineTo( w / 2, h - w * 0.6 ).lineTo( 0, h ).lineTo( - w / 2, h - w * 0.6 ).closePath();
	const g = new THREE.ExtrudeGeometry( shape, { depth: 0.08, bevelEnabled: false } );
	if ( across ) g.translate( v, y, u - 0.04 ); // facing ±v: shape in the u–y plane
	else g.rotateY( Math.PI / 2 ).translate( u - 0.04, y, v );
	add( mat, g );

}

// The gallery, the corner turrets and the steep roof of a gothic bridge tower (Old Town and Lesser Town alike).
function towerCrown( add, mat, hu, hv, eave, apex, { slender = false } = {} ) {

	// The corbelled cornice the gallery stands on, and its pierced parapet.
	add( mat, box( hu * 2 + 0.9, 0.55, hv * 2 + 0.9, 0, eave - 0.6 ) );
	const P = 0.28, ph = 1.0, oy = eave - 0.05;
	add( mat, box( hu * 2 + 0.9, ph, P, 0, oy, hv + 0.45 - P / 2 ), box( hu * 2 + 0.9, ph, P, 0, oy, - hv - 0.45 + P / 2 ) );
	add( mat, box( P, ph, hv * 2 + 0.9, hu + 0.45 - P / 2, oy, 0 ), box( P, ph, hv * 2 + 0.9, - hu - 0.45 + P / 2, oy, 0 ) );
	for ( let k = - 2; k <= 2; k ++ ) {

		add( K.dark, box( 0.45, 0.45, 0.04, k * hu * 0.36, oy + 0.3, hv + 0.46 ), box( 0.45, 0.45, 0.04, k * hu * 0.36, oy + 0.3, - hv - 0.46 ) );
		add( K.dark, box( 0.04, 0.45, 0.45, hu + 0.46, oy + 0.3, k * hv * 0.36 ), box( 0.04, 0.45, 0.45, - hu - 0.46, oy + 0.3, k * hv * 0.36 ) );

	}

	// Corner turrets on corbels, octagonal, with their own pointed roofs.
	const tr = slender ? 0.75 : 0.9;
	for ( const [ su, sv ] of [ [ - 1, - 1 ], [ - 1, 1 ], [ 1, - 1 ], [ 1, 1 ] ] ) {

		const x = su * ( hu + 0.15 ), z = sv * ( hv + 0.15 );
		add( mat, new THREE.CylinderGeometry( tr, 0.15, 1.6, 8 ).translate( x, eave - 2.6, z ) );
		add( mat, cyl( tr, tr, 4.2, x, eave - 1.8, z, 8 ) );
		add( K.dark, box( 0.22, 0.7, 0.04, x, eave + 0.8, z + sv * ( tr - 0.02 ) ), box( 0.04, 0.7, 0.22, x + su * ( tr - 0.02 ), eave + 0.8, z ) );
		add( K.slate, new THREE.ConeGeometry( tr + 0.15, slender ? 4.2 : 3.6, 8 ).translate( x, eave + 2.4 + ( slender ? 2.1 : 1.8 ), z ) );
		add( K.gold, new THREE.OctahedronGeometry( 0.12, 0 ).translate( x, eave + 2.4 + ( slender ? 4.3 : 3.7 ), z ) );

	}

	// The steep slate roof inside the gallery, a dormer on each long face, the gilt finial.
	const a = hu - 0.9, b = hv - 0.9, H = apex - eave - 0.2;
	add( K.slate, new THREE.ConeGeometry( Math.SQRT2, 1, 4, 1 ).rotateY( Math.PI / 4 ).translate( 0, 0.5, 0 ).scale( a, H, b ).translate( 0, eave + 0.2, 0 ) );
	for ( const s of [ - 1, 1 ] ) {

		const t = 0.3, y = eave + 0.2 + H * t;
		add( K.slate, box( 0.8, 1.0, 0.9, s * a * ( 1 - t ), y, 0 ), new THREE.ConeGeometry( 0.7, 0.8, 4 ).rotateY( Math.PI / 4 ).translate( s * a * ( 1 - t ), y + 1.4, 0 ) );
		add( K.dark, box( 0.04, 0.6, 0.4, s * ( a * ( 1 - t ) + 0.41 ), y + 0.2, 0 ) );

	}

	add( K.gold, cyl( 0.04, 0.06, 2.2, 0, apex - 0.2, 0, 6 ), new THREE.SphereGeometry( 0.22, 8, 5 ).translate( 0, apex + 1.2, 0 ) );

}

// Staroměstská mostecká věž.
function oldTownTower( kit, t, F, K0 ) {

	const s0 = K0.sTower, s1 = K0.sTowerEnd, P = F( ( s0 + s1 ) / 2 );
	// Its frame is the bridge's: u towards the Old Town; the stair turret on the south side is left out of the box.
	const vs = t.ring.map( ( [ x, z ] ) => - ( x - P.x ) * P.uz + ( z - P.z ) * P.ux );
	const main = vs.filter( v => Math.abs( v ) < 7 ), out = t.ring.filter( ( _, i ) => Math.abs( vs[ i ] ) >= 7 );
	const v0 = Math.min( ...main ), v1 = Math.max( ...main ), hv = ( v1 - v0 ) / 2, hu = ( s1 - s0 ) / 2, cv = ( v0 + v1 ) / 2;
	const f = { x: P.x - P.uz * cv, z: P.z + P.ux * cv, ux: P.ux, uz: P.uz };
	const add = inFrame( kit, f );
	const deck = P.y, base = t.ground - 1, eave = t.eave, apex = Math.max( t.top + 1, eave + 13 );
	const half = K0.passage;
	// The passage (its axis on the bridge's, cv off the box's middle).
	add( K.tower, towerBody( hu, hv, base, eave - 0.6, { v: - cv, half, floor: deck - 0.05, spring: deck + 4.4, apex: deck + 7.0 } ) );
	add( K.sett, box( hu * 2, 0.04, half * 2, 0, deck, - cv ) );
	// String courses.
	for ( const y of [ deck + 8.1, deck + 16.2 ] ) add( K.tower, box( hu * 2 + 0.3, 0.3, hv * 2 + 0.3, 0, y, 0 ) );
	// East face (+u): the frieze of coats of arms, the seated kings either side of St Vitus under their canopies,
	// the two standing saints above, blind tracery up to the gallery; the pointed hood over the passage.
	const E = hu + 0.02;
	for ( let i = 0; i < 9; i ++ ) add( K.relief, box( 0.22, 0.75, 0.6, E + 0.08, deck + 8.6, - cv + ( i - 4 ) * ( hv * 2 - 1.2 ) / 9 ) );
	for ( const [ v, h, seat ] of [ [ - 2.6, 1.7, true ], [ 0, 2.1, false ], [ 2.6, 1.7, true ] ] ) {

		add( K.relief, box( 0.4, 0.35, 1.3, E + 0.15, deck + 10.0, - cv + v ) );
		figure( { push: ( [ m, g ] ) => add( m === K.statue ? K.statue : m, g.rotateY( Math.PI / 2 ).translate( E + 0.25, deck + 10.35, - cv + v ) ) }, K.statue, { h, pose: seat ? 'hold' : 'open', kneel: seat } );
		add( K.relief, new THREE.ConeGeometry( 0.7, 1.4, 4 ).rotateY( Math.PI / 4 ).translate( E + 0.25, deck + 10.35 + h + 0.9, - cv + v ) );

	}

	for ( const v of [ - 1.6, 1.6 ] ) {

		add( K.relief, box( 0.35, 0.3, 1.0, E + 0.12, deck + 16.5, - cv + v ) );
		figure( { push: ( [ m, g ] ) => add( m, g.rotateY( Math.PI / 2 ).translate( E + 0.22, deck + 16.8, - cv + v ) ) }, K.statue, { h: 2.0, attr: 'book' } );
		add( K.relief, new THREE.ConeGeometry( 0.55, 1.2, 4 ).rotateY( Math.PI / 4 ).translate( E + 0.22, deck + 19.5, - cv + v ) );

	}

	for ( let i = 0; i <= 6; i ++ ) add( K.relief, box( 0.12, eave - 0.6 - ( deck + 20.5 ), 0.14, E + 0.05, deck + 20.5, - cv + ( i - 3 ) * ( hv * 2 - 1 ) / 6 ) );
	for ( let i = 0; i < 3; i ++ ) window2( add, K.dark, E + 0.1, - cv + ( i - 1 ) * 2.6, deck + 21.5, 1.0, 3.2 );
	// The hood moulding over the passage on both faces.
	for ( const su of [ - 1, 1 ] ) {

		const hood = pointedPath( new THREE.Shape(), - half - 0.45, half + 0.45, deck + 4.2, deck + 4.4, deck + 7.6 );
		hood.holes.push( pointedPath( new THREE.Path(), - half, half, deck + 4.2, deck + 4.4, deck + 7.0 ) );
		add( K.relief, new THREE.ExtrudeGeometry( hood, { depth: 0.2, bevelEnabled: false } ).rotateY( - Math.PI / 2 ).translate( su * ( hu + 0.1 ), 0, - cv ) );

	}

	// West face (to the bridge), plain since the Swedes' guns in 1648: a few small windows; small windows on the sides.
	for ( const y of [ deck + 11, deck + 18 ] ) window2( add, K.dark, - E, - cv, y, 0.9, 2.2 );
	for ( const sv of [ - 1, 1 ] ) for ( const y of [ deck + 10, deck + 17.5 ] ) window2( add, K.dark, sv * ( hv + 0.02 ) + ( sv > 0 ? 0.04 : 0.04 ), 0, y, 0.9, 2.2, true );
	towerCrown( add, K.tower, hu, hv, eave, apex );
	// The stair turret on the south side, octagonal, to below the gallery.
	if ( out.length ) {

		const cx = out.reduce( ( a, p ) => a + p[ 0 ], 0 ) / out.length, cz = out.reduce( ( a, p ) => a + p[ 1 ], 0 ) / out.length;
		const u = ( cx - f.x ) * f.ux + ( cz - f.z ) * f.uz, v = - ( cx - f.x ) * f.uz + ( cz - f.z ) * f.ux;
		add( K.tower, cyl( 1.4, 1.4, eave - 4 - base, u, base, Math.sign( v ) * ( hv + 0.6 ), 8 ) );
		add( K.slate, new THREE.ConeGeometry( 1.6, 2.6, 8 ).translate( u, eave - 4 + 1.3, Math.sign( v ) * ( hv + 0.6 ) ) );

	}

}

// The Lesser Town bridge tower, the Judith Tower and the gate between them.
function lesserTowers( kit, towers ) {

	for ( const t of towers ) {

		if ( t.kind === 'lesserTown' ) {

			const f = obb( t.ring ), add = inFrame( kit, f ), base = t.ground - 0.5, eave = t.eave, apex = Math.max( t.top + 2, eave + 13 );
			add( K.lesser, box( f.hu * 2, eave - 0.6 - base, f.hv * 2, 0, base ) );
			for ( const y of [ base + 7, base + 15 ] ) add( K.lesser, box( f.hu * 2 + 0.3, 0.3, f.hv * 2 + 0.3, 0, y, 0 ) );
			for ( const y of [ base + 9, base + 17, base + 23 ] ) {

				for ( const s of [ - 1, 1 ] ) {

					window2( add, K.dark, s * ( f.hu + 0.02 ) + 0.04, 0, y, 1.0, 2.4 );
					window2( add, K.dark, s * ( f.hv + 0.02 ) + 0.04, 0, y, 1.0, 2.4, true );

				}

			}

			towerCrown( add, K.lesser, f.hu, f.hv, eave, apex, { slender: true } );

		} else if ( t.kind === 'judith' ) {

			// Romanesque: plain light stone, small round-headed windows, a hipped slate roof.
			const f = obb( t.ring ), add = inFrame( kit, f ), base = t.ground - 0.5, eave = t.eave, top = Math.max( t.top, eave + 4 );
			add( K.judith, box( f.hu * 2, eave - base, f.hv * 2, 0, base ) );
			for ( const y of [ base + 8, base + 13 ] ) for ( const s of [ - 1, 1 ] ) {

				add( K.dark, box( 0.04, 1.2, 0.6, s * ( f.hu + 0.01 ), y, 0 ), box( 0.6, 1.2, 0.04, 0, y, s * ( f.hv + 0.01 ) ) );

			}

			const r = Math.min( f.hu, f.hv );
			add( K.slate, new THREE.ConeGeometry( Math.SQRT2, 1, 4, 1 ).rotateY( Math.PI / 4 ).translate( 0, 0.5, 0 ).scale( f.hu + 0.3, top - eave, f.hv + 0.3 ).translate( 0, eave, 0 ) );
			add( K.gold, new THREE.OctahedronGeometry( 0.15 + 0 * r, 0 ).translate( 0, top + 0.2, 0 ) );

		} else if ( t.kind === 'gate' && t.hu ) {

			// Two walls across the street, a round arch in each, battlements on top.
			const add = inFrame( kit, t ), base = t.ground - 0.5, top = Math.min( t.upper ?? t.top, t.ground + 12 ) - 0.8;
			for ( const s of [ - 1, 1 ] ) {

				const sh = new THREE.Shape().moveTo( - t.hv, base ).lineTo( t.hv, base ).lineTo( t.hv, top ).lineTo( - t.hv, top ).closePath();
				const hole = new THREE.Path().moveTo( - 2.4, base + 0.3 ).lineTo( - 2.4, t.ground + 4.2 );
				for ( let i = 1; i < 10; i ++ ) hole.lineTo( - 2.4 * Math.cos( Math.PI * i / 10 ), t.ground + 4.2 + 2.4 * Math.sin( Math.PI * i / 10 ) );
				hole.lineTo( 2.4, t.ground + 4.2 ).lineTo( 2.4, base + 0.3 ).closePath();
				sh.holes.push( hole );
				const u = s * ( t.hu - 0.9 );
				add( K.lesser, new THREE.ExtrudeGeometry( sh, { depth: 1.8, bevelEnabled: false, curveSegments: 4 } ).translate( 0, 0, - 0.9 ).rotateY( - Math.PI / 2 ).translate( u, 0, 0 ) );
				for ( let v = - t.hv + 0.35; v < t.hv; v += 1.4 ) add( K.lesser, box( 1.8, 0.8, 0.7, u, top, v ) );

			}

		}

	}

}

// ---------------------------------------------------------------------------

export function addKarluv( scene, K0, waterLevel = 0 ) {

	if ( ! K0 || K0.pts.length < 10 ) return;
	const kit = new Kit();
	const F = deckFrame( K0 ), L = ( K0.pts.length - 1 ) * K0.step;
	const half = K0.half, rail = K0.rail, walk = half - rail, sEnd = Math.min( L, K0.sTower );
	const lowAt = s => K0.low[ Math.max( 0, Math.min( K0.low.length - 1, Math.round( s / K0.step ) ) ) ];
	const c = v => () => v;

	// The deck: setts between the parapets, on through the tower's passage.
	kit.add( K.sett, strip( F, 0, sEnd, c( - walk ), c( walk ), 0.03, 0.03, 2 ) );

	// The body of each span: from below the river (or the ground) up to the deck, an arch through it.
	const PH = 4.25, supports = [ 0, ...K0.piers, sEnd ];
	for ( let k = 0; k + 1 < supports.length; k ++ ) {

		const sa = supports[ k ], sb = supports[ k + 1 ], len = sb - sa;
		if ( len < 4 ) continue;
		const A = F( sa ), B = F( sb );
		const cx = B.x - A.x, cz = B.z - A.z, cl = Math.hypot( cx, cz );
		let lowest = Infinity;
		for ( let s = sa; s <= sb; s += 2 ) lowest = Math.min( lowest, lowAt( s ) );
		const bottom = Math.min( waterLevel, lowest ) - 1.5;
		const body = new THREE.Shape().moveTo( 0, bottom ).lineTo( len, bottom );
		for ( let s = len; s >= 0; s -= Math.min( 2, Math.max( 0.01, s ) ) ) {

			body.lineTo( s, F( sa + s ).y - 0.01 );
			if ( s === 0 ) break;

		}

		body.closePath();
		const a0 = k === 0 ? 1.0 : PH, a1 = k + 2 === supports.length ? 1.0 : PH;
		const chord = ( len - a0 - a1 ) / 2, mid = a0 + chord;
		const spring = waterLevel + 2.0, crown = F( sa + mid ).y - 2.0;
		let ground = Infinity;
		for ( let s = sa + a0; s <= sb - a1; s += 1 ) ground = Math.min( ground, lowAt( s ) );
		if ( chord > 3 && crown > ground + 1.5 && crown > spring + 1 ) {

			const rise = crown - spring, R = ( chord * chord + rise * rise ) / ( 2 * rise ), cy = crown - R;
			const hole = new THREE.Path().moveTo( a0, bottom + 0.05 ).lineTo( a0, spring );
			for ( let i = 1; i < 16; i ++ ) {

				const x = - chord + 2 * chord * i / 16;
				hole.lineTo( mid + x, cy + Math.sqrt( R * R - x * x ) );

			}

			hole.lineTo( len - a1, spring ).lineTo( len - a1, bottom + 0.05 ).closePath();
			body.holes.push( hole );
			// Rooms built into the arch (RÚIAN houses on Kampa): the opening walled up a little behind each face, with a
			// door and windows.
			if ( ( K0.filled || [] ).some( ( [ f0, f1 ] ) => f1 > sa + a0 && f0 < sb - a1 ) ) {

				const wall = new THREE.Shape( hole.getPoints() );
				for ( const o of [ - half + 0.7, half - 1.0 ] ) {

					const g = new THREE.ExtrudeGeometry( wall, { depth: 0.3, bevelEnabled: false, curveSegments: 4 } ).translate( 0, 0, o );
					g.applyMatrix4( new THREE.Matrix4().set( cx / cl, 0, - cz / cl, 0, 0, 1, 0, 0, cz / cl, 0, cx / cl, 0, 0, 0, 0, 1 ) );
					kit.add( K.infill, g.translate( A.x, 0, A.z ) );
					const g0 = Math.max( ground, spring );
					for ( const [ t, w, h, y ] of [ [ 0.5, 1.2, 2.3, 0 ], [ 0.3, 0.9, 1.2, 3.2 ], [ 0.7, 0.9, 1.2, 3.2 ] ] ) {

						const P = F( sa + a0 + ( len - a0 - a1 ) * t ), oo = o < 0 ? o - 0.03 : o + 0.33;
						const [ x, , z ] = P.at( oo, 0 );
						kit.add( K.dark, box( w, h, 0.06, 0, 0, 0 ).rotateY( Math.atan2( - P.uz, P.ux ) ).translate( x, g0 + y, z ) );

					}

				}

			}


		}

		const g = new THREE.ExtrudeGeometry( body, { depth: half * 2, bevelEnabled: false, curveSegments: 4 } ).translate( 0, 0, - half );
		g.applyMatrix4( new THREE.Matrix4().set( cx / cl, 0, - cz / cl, 0, 0, 1, 0, 0, cz / cl, 0, cx / cl, 0, 0, 0, 0, 1 ) );
		g.translate( A.x, 0, A.z );
		kit.add( K.stone, g );

	}

	// The cutwaters: pointed upstream (south, +o) and smaller downstream, their tops sloping up to the spandrel.
	const W = ( P, u, o, y ) => [ P.x + P.ux * u - P.uz * o, y, P.z + P.uz * u + P.ux * o ];
	for ( const s of K0.piers ) {

		const P = F( s ), bottom = Math.min( waterLevel, lowAt( s ) ) - 1.5, capY = P.y - 3.2;
		for ( const [ sgn, tip ] of [ [ 1, 5.0 ], [ - 1, 3.2 ] ] ) {

			const a = - PH + 0.1, b = PH - 0.1, o0 = sgn * ( half - 0.1 ), o1 = sgn * ( half + tip );
			const A0 = W( P, a, o0, bottom ), B0 = W( P, b, o0, bottom ), C0 = W( P, 0, o1, bottom );
			const A1 = W( P, a, o0, capY ), B1 = W( P, b, o0, capY ), C1 = W( P, 0, o1, capY );
			const A2 = W( P, a, o0, capY + 1.8 ), B2 = W( P, b, o0, capY + 1.8 );
			const ctr = W( P, 0, sgn * ( half + tip * 0.3 ), ( bottom + capY ) / 2 );
			kit.add( K.stone, solid( [ [ A0, B0, C0 ], [ A0, A1, C1 ], [ A0, C1, C0 ], [ B0, C0, C1 ], [ B0, C1, B1 ], [ A0, B1, A1 ], [ A0, B0, B1 ] ], ctr ) );
			const cc = W( P, 0, sgn * ( half + tip * 0.25 ), capY + 0.5 );
			kit.add( K.coping, solid( [ [ A1, B1, C1 ], [ A2, C1, B2 ], [ A1, C1, A2 ], [ B1, B2, C1 ], [ A1, A2, B2 ], [ A1, B2, B1 ] ], cc ) );

		}

	}

	// String course along the outer faces under the parapets, parapets with their coping (to the tower).
	for ( const sgn of [ - 1, 1 ] ) {

		for ( let s = 0; s < sEnd - 0.01; s += 4 ) {

			const t = Math.min( sEnd, s + 4 ), a = F( s ), b = F( t );
			kit.add( K.coping, beam( a.at( sgn * ( half + 0.08 ), - 0.55 ), b.at( sgn * ( half + 0.08 ), - 0.55 ), 0.3, 0.3 ) );
			kit.add( K.stone, beam( a.at( sgn * ( half - rail / 2 ), 0 ), b.at( sgn * ( half - rail / 2 ), 0 ), rail, 1.02 ) );
			kit.add( K.coping, beam( a.at( sgn * ( half - rail / 2 ), 1.02 ), b.at( sgn * ( half - rail / 2 ), 1.02 ), rail + 0.14, 0.13 ) );

		}

	}

	// Statues on their pedestals, facing the deck.
	for ( const st of K0.statues ) {

		const P = F( st.s ), side = st.side || 1;
		const parts = [];
		let x, y, z;
		if ( st.kind === 'bruncvik' ) {

			// The knight Bruncvík on his column on the pier by Kampa, with the lion and the gilded sword.
			[ x, y, z ] = P.at( side * ( half + 2.2 ), - 3.0 );
			parts.push( [ K.pedestal, cyl( 0.5, 0.55, 0.6 ) ], [ K.pedestal, cyl( 0.35, 0.4, 3.0, 0, 0.6, 0, 8 ) ], [ K.pedestal, box( 1.0, 0.35, 1.0, 0, 3.6 ) ] );
			figure( parts, K.statue, { h: 2.4, y: 3.95, pose: 'raise' } );
			parts.push( [ K.gold, new THREE.BoxGeometry( 0.06, 1.0, 0.06 ).translate( 0.22, 3.95 + 2.3, 0.1 ) ] );
			parts.push( [ K.statueLight, new THREE.BoxGeometry( 0.3, 0.35, 0.8 ).translate( 0.5, 4.15, 0.15 ) ] );

		} else {

			[ x, y, z ] = P.at( side * ( half - 0.6 ), 0 );
			pedestal( parts, st.kind );
			const top = [];
			statue( top, st );
			for ( const [ m, g ] of top ) parts.push( [ m, g.translate( 0, 2.85, 0 ) ] );

		}

		const ry = Math.atan2( side * P.uz, - side * P.ux );
		for ( const [ m, g ] of parts ) kit.add( m, g.rotateY( ry ).translate( x, y, z ) );

	}

	// The brass cross on the parapet where St John of Nepomuk was thrown into the river.
	if ( K0.cross ) {

		const [ s, side ] = K0.cross, [ x, y, z ] = F( s ).at( side * ( half - rail / 2 ), 1.15 );
		kit.add( K.gold, box( 0.05, 0.75, 0.05, x, y, z ), box( 0.32, 0.05, 0.05, x, y + 0.45, z ), box( 0.22, 0.05, 0.05, x, y + 0.6, z ) );

	}

	// Gas lamps on the parapets: a slim iron post with the lantern on top.
	for ( const [ s, side ] of K0.lamps ) {

		const [ x, y, z ] = F( s ).at( ( side || 1 ) * ( half - rail / 2 ), 1.15 );
		kit.add( K.iron, cyl( 0.09, 0.13, 0.3, x, y, z, 6 ), cyl( 0.035, 0.05, 2.3, x, y + 0.3, z, 6 ) );
		kit.add( K.iron, cyl( 0.08, 0.12, 0.1, x, y + 2.6, z, 4 ), new THREE.ConeGeometry( 0.22, 0.28, 4 ).translate( x, y + 3.24, z ), cyl( 0.015, 0.025, 0.25, x, y + 3.38, z, 4 ) );
		kit.add( K.lamp, new THREE.CylinderGeometry( 0.18, 0.12, 0.4, 4 ).translate( x, y + 2.9, z ) );

	}

	// Wooden ice-guards upstream of the river piers: a wedge of piles pointing into the current.
	for ( const [ s, o ] of K0.guards ) {

		const P = F( s ), y0 = waterLevel - 0.8, h = 2.4;
		for ( const sgn of [ - 1, 1 ] ) for ( let k = 0; k < 4; k ++ ) {

			const [ x, , z ] = W( P, sgn * ( 0.3 + k * 0.45 ), o - 1.6 + k * 0.6, 0 );
			kit.add( K.wood, cyl( 0.14, 0.14, h - k * 0.15, x, y0, z, 5 ) );

		}

	}

	// The towers.
	for ( const t of K0.towers ) if ( t.kind === 'oldTown' ) oldTownTower( kit, t, F, K0 );
	lesserTowers( kit, K0.towers );

	kit.build( scene );

}
