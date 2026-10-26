// Graffiti on the ground floors: tags, throw-ups, stickers and torn posters as small pictures stuck flat on the
// street fronts, up to about 2.5 m, the height a hand with a spray can reaches. Prague's Old Town is covered in them
// in the side streets and passages, much less on Národní and the big squares, and not at all on the churches,
// the theatre and the other landmarks (whose walls have a style of their own and are left out here). The pictures
// are the owner's (public/textures/graffiti-atlas.png, made by tools/textures/graffiti.py from whatever is in his
// textures/graffiti folder), all in one atlas; the pieces are merged into one mesh per 150 m square, so they cost a
// draw call a square and are skipped with the rest of the still city when out of view (src/batch.js).
//
// Where each piece goes is worked out from the walls themselves, from a seed per wall, so a house keeps its
// graffiti from one visit to the next. Described shop windows and windows (data/houses.json ground floors) are left
// clean; doors, gates and garage doors get their share.

import * as THREE from 'three/webgpu';

const DIR = 'textures/';
const TILE = 150;

// Pieces per metre of street front, by street: heavy in the lanes and passages, light on the showpiece streets.
const HEAVY = [ 'Na Perštýně', 'Betlémská', 'Konviktská', 'Krocínova', 'Divadelní', 'Karoliny Světlé', 'Náprstkova', 'Průchodní',
	'Bartolomějská', 'Liliová', 'Anenská', 'Stříbrná', 'Zlatá', 'Řetězová', 'Jilská', 'Vejvodova', 'Skořepka', 'Perlová', 'Na struze',
	'Ostrovní', 'Pštrossova', 'Opatovická', 'Křemencova', 'V jirchářích', 'Náplavní', 'Na Zderaze', 'Šítkova', 'Martinská', 'Michalská',
	'Seminářská', 'Kožná', 'Vodní', 'Říční', 'Všehrdova', 'Hroznová' ];
const LIGHT = [ 'Národní', 'Betlémské náměstí', 'Smetanovo nábřeží', 'Masarykovo nábřeží', 'Janáčkovo nábřeží', 'Staroměstské náměstí',
	'Malostranské náměstí', 'Karlův most', 'Mostecká', 'Karlova', 'Nerudova', 'Jungmannovo náměstí', 'Mariánské náměstí', 'Křižovnické náměstí',
	'Most legií', 'Maltézské náměstí', 'Velkopřevorské náměstí', 'Karlovo náměstí', 'Alšovo nábřeží', 'Pařížská' ];
const DENSITY = { heavy: 0.8, normal: 0.3, light: 0.05 };

// Each kind: how often it is picked, its width (m), and the height its bottom edge sits at (m above the pavement).
const KINDS = {
	tag: { weight: 10, width: [ 0.7, 1.5 ], bottom: [ 0.4, 1.5 ] },
	throwup: { weight: 4, width: [ 1.4, 2.4 ], bottom: [ 0.2, 0.7 ] },
	piece: { weight: 1, width: [ 2.5, 3.6 ], bottom: [ 0.1, 0.3 ], heavyOnly: true },
	sticker: { weight: 3, width: [ 0.12, 0.2 ], bottom: [ 1.1, 1.7 ] },
	pasteup: { weight: 2, width: [ 0.45, 0.8 ], bottom: [ 0.9, 1.4 ] },
	poster: { weight: 1.5, width: [ 0.7, 1.2 ], bottom: [ 0.5, 1.0 ] },
	patch: { weight: 0.8, width: [ 1.0, 1.6 ], bottom: [ 0.2, 0.6 ] },
	shutter: { weight: 1, width: [ 2.0, 2.6 ], bottom: [ 0.05, 0.1 ], heavyOnly: true }
};
const TOP = 2.6;

// A small deterministic random sequence from a seed.
function random( seed ) {

	let s = ( Math.floor( Math.abs( seed ) ) % 2147483646 ) + 1;
	return () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;

}

// The street fronts' ground floors: src/walls-data.js (also used off the main thread).
export { streetFronts } from './walls-data.js';

// What all the fronts share (the atlas, its material, the streets they face), once; then place( scene, fronts,
// groundHeight ) adds the graffiti of some fronts (a streamed square's: src/main.js) as one mesh.
export async function prepareGraffiti( { streets = [], groundFloors = [] } = {} ) {

	const info = await ( await fetch( DIR + 'graffiti-atlas.json' ) ).json();
	const byKind = {};
	for ( const it of info.items ) ( byKind[ it.kind ] ||= [] ).push( it );
	const kinds = Object.keys( KINDS ).filter( k => byKind[ k ] );
	if ( ! kinds.length ) return null;

	const texture = new THREE.TextureLoader().load( DIR + 'graffiti-atlas.png' );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	const material = new THREE.MeshStandardNodeMaterial( { map: texture, alphaTest: 0.5, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 4 } );
	material.name = 'graffiti';

	// The street a front faces: the nearest named street line within 30 m, on a 20 m grid of its points.
	const grid = new Map(), cell = 20;
	for ( const st of streets ) for ( const p of st.paths ) for ( let i = 0; i < p.length; i += 3 ) {

		const key = `${Math.floor( p[ i ] / cell )},${Math.floor( p[ i + 2 ] / cell )}`;
		if ( ! grid.has( key ) ) grid.set( key, [] );
		grid.get( key ).push( p[ i ], p[ i + 2 ], st.name );

	}

	const streetAt = ( x, z ) => {

		let best = null, bd = 30 * 30, bx = 0, bz = 0;
		const cx = Math.floor( x / cell ), cz = Math.floor( z / cell );
		for ( let i = - 2; i <= 2; i ++ ) for ( let j = - 2; j <= 2; j ++ ) {

			const list = grid.get( `${cx + i},${cz + j}` );
			if ( list ) for ( let k = 0; k < list.length; k += 3 ) {

				const d = ( list[ k ] - x ) ** 2 + ( list[ k + 1 ] - z ) ** 2;
				if ( d < bd ) {

					bd = d;
					best = list[ k + 2 ];
					bx = list[ k ];
					bz = list[ k + 1 ];

				}

			}

		}

		return best && { name: best, x: bx, z: bz };

	};

	const weights = kinds.map( k => KINDS[ k ].weight );
	const place = ( scene, fronts, groundHeight = null, single = false ) => {

	const tiles = new Map(), streetsSeen = { heavy: 0, normal: 0, light: 0 };
	let count = 0;
	for ( let [ x0, z0, x1, z1, y0, y1, top, u0, u1, nx, nz, row, flagged ] of fronts ) {

		const len = Math.hypot( x1 - x0, z1 - z0 );
		if ( len < 1 ) continue;
		const mx = ( x0 + x1 ) / 2, mz = ( z0 + z1 ) / 2;
		const near = streetAt( mx, mz ), name = near?.name;
		// The front faces its street: turn the normal that way if the wall's winding says otherwise.
		if ( near && ( near.x - mx ) * nx + ( near.z - mz ) * nz < 0 ) {

			nx = - nx;
			nz = - nz;

		}

		const street = HEAVY.includes( name ) ? 'heavy' : LIGHT.includes( name ) ? 'light' : 'normal';
		streetsSeen[ street ] += len;
		const rnd = random( Math.round( x0 * 97 ) * 7919 + Math.round( z0 * 89 ) * 104729 + 13 );
		let n = len * DENSITY[ street ] * ( flagged ? 2 : 1 );
		n = Math.floor( n ) + ( rnd() < n % 1 ? 1 : 0 );
		if ( ! n ) continue;

		// Described windows and shop windows stay clean (their u spans on this front).
		const glass = ( groundFloors[ row ] || [] ).filter( o => o[ 2 ] === 3 || o[ 2 ] === 4 ).map( o => [ o[ 0 ], o[ 1 ] ] );
		const placed = [];
		for ( let k = 0, tries = 0; k < n && tries < n * 4; tries ++ ) {

			// The kind, by weight (pieces and painted shutters only in the heavy streets).
			let r = rnd() * weights.reduce( ( a, b ) => a + b, 0 ), kind = kinds[ 0 ];
			for ( let i = 0; i < kinds.length; i ++ ) if ( ( r -= weights[ i ] ) < 0 ) {

				kind = kinds[ i ];
				break;

			}

			const K = KINDS[ kind ];
			if ( K.heavyOnly && street !== 'heavy' ) continue;
			const list = byKind[ kind ], item = list[ Math.floor( rnd() * list.length ) ];
			const w = Math.min( len - 0.2, K.width[ 0 ] + rnd() * ( K.width[ 1 ] - K.width[ 0 ] ) ), h = w / item.aspect;
			if ( w < K.width[ 0 ] * 0.7 ) continue;
			const ex = ( x1 - x0 ) / len, ez = ( z1 - z0 ) / len;
			const s = w / 2 + 0.1 + rnd() * Math.max( 0, len - w - 0.2 );
			const u = u0 + ( u1 - u0 ) * s / len;
			if ( glass.some( ( [ a, b ] ) => u + w / 2 > a && u - w / 2 < b ) ) continue;
			// The pavement in front (the wall itself may start lower, where the ground falls away).
			const ground = groundHeight ? Math.max( y0 + ( y1 - y0 ) * s / len, groundHeight( x0 + ex * s + nx * 0.6, z0 + ez * s + nz * 0.6 ) ) : y0 + ( y1 - y0 ) * s / len;
			let bottom = ground + K.bottom[ 0 ] + rnd() * ( K.bottom[ 1 ] - K.bottom[ 0 ] );
			bottom = Math.min( bottom, Math.min( top - 0.1, ground + TOP ) - h );
			if ( bottom < ground ) continue;
			// Big ones keep apart; tags and stickers may overlap a little, as they do.
			const box = [ s - w / 2, bottom, s + w / 2, bottom + h ];
			const pad = kind === 'tag' || kind === 'sticker' ? - 0.15 : 0.05;
			if ( placed.some( b => box[ 0 ] < b[ 2 ] + pad && box[ 2 ] > b[ 0 ] - pad && box[ 1 ] < b[ 3 ] + pad && box[ 3 ] > b[ 1 ] - pad ) ) continue;
			placed.push( box );
			k ++;

			// The quad, a couple of centimetres off the wall, each piece a little further than the last.
			const off = 0.025 + placed.length * 0.004;
			const cx = x0 + ex * s + nx * off, cz = z0 + ez * s + nz * off;
			// One mesh per 150 m square of the city; a streamed square's (src/main.js: `single`) all in one.
			const key = single ? 0 : `${Math.floor( cx / TILE )},${Math.floor( cz / TILE )}`;
			if ( ! tiles.has( key ) ) tiles.set( key, { pos: [], uv: [], normal: [] } );
			const t = tiles.get( key ), [ ua, va, ub, vb ] = item.rect;
			const A = [ cx - ex * w / 2, bottom, cz - ez * w / 2 ], B = [ cx + ex * w / 2, bottom, cz + ez * w / 2 ];
			const C = [ B[ 0 ], bottom + h, B[ 2 ] ], D = [ A[ 0 ], bottom + h, A[ 2 ] ];
			// Seen from outside the wall the picture reads left to right: along the wall from (x0, z0) when the
			// wall's outside is on the left of that direction.
			const lr = ex * nz - ez * nx > 0;
			const uvA = [ lr ? ua : ub, va ], uvB = [ lr ? ub : ua, va ], uvC = [ uvB[ 0 ], vb ], uvD = [ uvA[ 0 ], vb ];
			const corners = ex * nz - ez * nx > 0 ? [ A, B, C, A, C, D ] : [ A, C, B, A, D, C ];
			const uvs = ex * nz - ez * nx > 0 ? [ uvA, uvB, uvC, uvA, uvC, uvD ] : [ uvA, uvC, uvB, uvA, uvD, uvC ];
			for ( let i = 0; i < 6; i ++ ) {

				t.pos.push( ...corners[ i ] );
				t.uv.push( ...uvs[ i ] );
				t.normal.push( nx, 0, nz );

			}

			count ++;

		}

	}

	for ( const t of tiles.values() ) {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( t.pos, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( t.normal, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( t.uv, 2 ) );
		const mesh = new THREE.Mesh( g, material );
		mesh.receiveShadow = true;
		mesh.name = 'graffiti';
		scene.add( mesh );

	}

	return { pieces: count, fronts: fronts.length, metres: streetsSeen };

	};
	place.material = material;
	return place;

}

export async function addGraffiti( scene, fronts, { streets = [], groundFloors = [], groundHeight = null } = {} ) {

	if ( ! fronts.length ) return { pieces: 0 };
	const place = await prepareGraffiti( { streets, groundFloors } );
	return place ? place( scene, fronts, groundHeight ) : { pieces: 0 };

}
