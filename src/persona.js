// People as data. A person is a plain object (a "spec") that says everything about how they look:
//
//   { seed, sex: 'm' | 'f', body: 'animated-men/suit' (src/people.js BODIES, or 'posed-humans/male|female'),
//     face, hair, top, bottom, skin: texture file names from the wardrobe (public/models/people/manifest.json;
//       '' for hair and skin: the colours read from the face; for top and bottom: the plain colour),
//     colour: [ top, bottom ] (sRGB hex, used where there is no fabric), height (metres), width (1 = as modelled),
//     shape: { fat, belly, hips, head, hunch, shoulders, legs, torso, arms, neck, tilt, lumps } (src/people.js
//       SHAPE; about −1 … 1, 0 as modelled) }
//
// `generatePerson( rules, seed, wardrobe )` makes one at random from the art direction's rules (game settings,
// `art.crowd`, tuned in the studio): the same seed always gives the same person, and every game start deals new
// seeds unless the rules fix one. `lookOf( spec, wardrobe )` turns it into what the people's material draws, and
// `buildPerson( spec, body, wardrobe )` into a skinned, animatable person. Anything that wants to set a person by
// hand (the studio's pickers, a character creator for the player) edits a spec and builds it again.

import * as THREE from 'three/webgpu';
import { BODIES, SHAPE, TOPS, BOTTOMS, allowed, makeSkinned } from './people.js';

// The default rules.
//   ugliness: 0 mild (the odd belly, ordinary heights), 1 proper late-90s grotesque (big heads, hunched backs,
//     lumpy limbs, odd proportions).
//   textured: the share of tops and bottoms made of a photographed fabric rather than a plain colour.
//   seed: 0 deals new people every game start; any other number gives the same people every time (for testing).
//   spread: how far each main knob may go (1 as designed, 0 never, 2 twice as far); `height` for the heights.
export const RULES = {
	ugliness: 0.5,
	textured: 0.8,
	seed: 0,
	spread: { fat: 1, belly: 1, legs: 1, head: 1, hunch: 1, height: 1 }
};

export function rulesFrom( art = {} ) {

	const r = art.crowd || {};
	return { ...RULES, ...r, spread: { ...RULES.spread, ...( r.spread || {} ) } };

}

// A small fast generator (mulberry32): the same seed, the same numbers.
export function random( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// This game's seed: ?seed=N in the address, the rules' own, or a new one.
export function gameSeed( rules ) {

	const url = Number( new URLSearchParams( location.search ).get( 'seed' ) ); // ?seed=N for testing
	if ( url ) return url >>> 0;
	return rules.seed ? rules.seed >>> 0 : ( Math.random() * 4294967296 ) >>> 0;

}

// The n-th person's seed in a game.
export function personSeed( base, n ) {

	let h = Math.imul( base ^ 0x9e3779b9, 0x85ebca6b ) ^ Math.imul( n + 1, 0xc2b2ae35 );
	h = Math.imul( h ^ ( h >>> 16 ), 0x7feb352d );
	h = Math.imul( h ^ ( h >>> 15 ), 0x846ca68b );
	return ( h ^ ( h >>> 16 ) ) >>> 0;

}

const lin = hex => new THREE.Color().setHex( hex ).toArray(); // sRGB hex to the linear working space

// The tile among `tiles` whose mean colour is nearest `colour`.
function nearest( tiles, colour ) {

	let best = null, bd = Infinity;
	for ( const t of tiles ) {

		if ( ! t.mean ) continue;
		const d = t.mean.reduce( ( a, v, i ) => a + ( v - colour[ i ] ) ** 2, 0 );
		if ( d < bd ) {

			bd = d;
			best = t;

		}

	}

	return best;

}

// One person from the rules and a seed. `sitting` asks for a body that can sit on a chair, `posed` for one of the
// posed humans (standing about, on benches), `sex` for a man or a woman.
export function generatePerson( rules, seed, wardrobe, { sitting = false, posed = false, sex = null } = {} ) {

	const rnd = random( seed ), u = Math.min( 1, Math.max( 0, rules.ugliness ?? 0.5 ) ), S = rules.spread || {};
	const pick = list => list[ Math.floor( rnd() * list.length ) ];
	const gauss = () => {

		// Close enough to a normal distribution, and bounded.
		return ( rnd() + rnd() + rnd() + rnd() - 2 ) * 1.73;

	};

	const clamp = ( v, a, b ) => Math.min( b, Math.max( a, v ) );

	// The body: the 2019 bodies a little more often than the modular ones (they are the everyday clothes).
	let body;
	if ( posed ) {

		sex ||= rnd() < 0.5 ? 'm' : 'f';
		body = sex === 'f' ? 'posed-humans/female' : 'posed-humans/male';

	} else {

		const list = BODIES.filter( b => ( ! sitting || b.animated ) && ( ! sex || b.sex === sex ) );
		let r = rnd() * list.reduce( ( a, b ) => a + ( b.animated ? 1.5 : 1 ), 0 );
		const b = list.find( b => ( r -= b.animated ? 1.5 : 1 ) < 0 ) || list[ 0 ];
		body = b.file;
		sex = b.sex;

	}

	// The face; hair and skin photos nearest its own colours, now and then (more often the uglier) any at all.
	const T = allowed( wardrobe.tiles );
	const faces = T.faces.filter( f => ! f.sex || f.sex === sex ), face = pick( faces.length ? faces : T.faces );
	const heads = T.heads.filter( t => t.own ), skins = T.skin.filter( t => t.own );
	const hair = ! heads.length ? '' : rnd() < 0.08 + 0.25 * u || ! face.hair ? pick( heads ).file : nearest( heads, face.hair ).file;
	const skin = ! skins.length ? '' : rnd() < 0.1 * u || ! face.skin ? pick( skins ).file : nearest( skins, face.skin ).file;

	// Clothes: a photographed fabric (or a garment front) or a plain colour.
	const fabrics = part => T.clothes.filter( x => ( ! x.part || x.part === part ) && ( ! x.sex || x.sex === sex ) );
	const textured = rules.textured ?? 0.8;
	const cloth = part => {

		const list = fabrics( part );
		return list.length && rnd() < textured ? pick( list ).file : '';

	};

	const top = cloth( 'top' ), bottom = cloth( 'bottom' );
	const colour = [ pick( TOPS ), pick( BOTTOMS ) ];

	// Height: Czech adults (women about 1.67 m, men 1.80 m), spread more the uglier.
	const h = ( sex === 'f' ? 1.665 : 1.795 ) + gauss() * 0.065 * ( S.height ?? 1 ) * ( 0.7 + 0.6 * u );
	const height = Math.round( clamp( h, 1.45, 2.05 ) * 1000 ) / 1000;

	// The shape: every knob a little off, how far by the ugliness; some build is shared (a fat person has a belly).
	const amp = 0.3 + 0.8 * u, k = name => S[ name ] ?? 1;
	const build = gauss() * 0.5 * amp + ( rnd() < 0.12 + 0.2 * u ? 0.5 * amp : 0 );
	const shape = {
		fat: clamp( build * k( 'fat' ), - 0.6, 1.3 ),
		belly: clamp( ( Math.max( 0, build ) * 0.8 + Math.max( 0, gauss() * 0.45 * amp ) + ( sex === 'm' ? 0.1 : 0 ) ) * k( 'belly' ), 0, 1.4 ),
		hips: clamp( gauss() * 0.4 * amp + ( sex === 'f' ? 0.25 : 0 ) + build * 0.3, - 0.6, 1.2 ),
		head: clamp( ( gauss() * 0.4 * amp + 0.35 * u ) * k( 'head' ), - 0.5, 1.4 ),
		hunch: clamp( Math.max( 0, gauss() * 0.5 * amp + 0.1 * u ) * k( 'hunch' ), 0, 1.3 ),
		shoulders: clamp( gauss() * 0.45 * amp + ( sex === 'm' ? 0.1 : - 0.15 ), - 0.8, 1 ),
		legs: clamp( gauss() * 0.5 * amp * k( 'legs' ), - 1, 1 ),
		torso: clamp( gauss() * 0.45 * amp, - 1, 1 ),
		arms: clamp( gauss() * 0.45 * amp, - 0.8, 1.2 ),
		neck: clamp( gauss() * 0.5 * amp, - 1, 1 ),
		tilt: clamp( gauss() * 0.5 * amp * u, - 1, 1 ),
		lumps: clamp( u * ( 0.4 + 0.8 * rnd() ), 0, 1.5 )
	};
	for ( const key of SHAPE ) shape[ key ] = Math.round( shape[ key ] * 1000 ) / 1000;
	const width = Math.round( clamp( 1 + gauss() * 0.035 * amp, 0.9, 1.12 ) * 1000 ) / 1000;

	return { seed, sex, body, face: face.file || '', hair, top, bottom, skin, colour, height, width, shape };

}

// What the people's material draws for a spec (src/people.js: per slot [ r, g, b, mode ]).
export function lookOf( spec, wardrobe ) {

	const tile = ( kind, file ) => file ? wardrobe.tiles[ kind ].find( t => t.file === file ) : null;
	const face = tile( 'faces', spec.face ) || wardrobe.tiles.faces[ 0 ];
	const photo = t => [ 1, 1, 1, 2 + t.t ];
	const cloth = ( file, hex ) => tile( 'clothes', file ) ? photo( tile( 'clothes', file ) ) : [ ...lin( hex ), 1 ];
	const hair = tile( 'heads', spec.hair ) ? photo( tile( 'heads', spec.hair ) ) : [ ...( face.hair || lin( 0x3b281b ) ).slice( 0, 3 ), 1 ];
	const skin = tile( 'skin', spec.skin ) ? photo( tile( 'skin', spec.skin ) ) : [ ...( face.skin || lin( 0xe3b38f ) ).slice( 0, 3 ), 1 ];
	// A photo face as it is; the drawn one in the skin colour.
	const look = face.skin ? photo( face ) : [ ...( skin[ 3 ] === 1 ? skin.slice( 0, 3 ) : lin( 0xe3b38f ) ), 2 + face.t ];
	return [ cloth( spec.top, spec.colour?.[ 0 ] ?? 0x3c3e44 ), cloth( spec.bottom, spec.colour?.[ 1 ] ?? 0x2a2b2f ), hair, skin, look ];

}

// A skinned, animatable person from a spec on its prepared body (src/people.js prepareBody): { object, mixer,
// scale }. The object stands on y = 0 facing +z.
export function buildPerson( spec, body, wardrobe ) {

	return makeSkinned( body, lookOf( spec, wardrobe ), spec.height, spec.shape, spec.width ?? 1 );

}
