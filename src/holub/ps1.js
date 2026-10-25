// The pigeon game's look: a late-90s console picture. The city is drawn as usual, then shown at a low fixed
// resolution (240 lines, square pixels), its colours cut down to 15-bit (32 levels a channel) with the ordered 4 × 4
// dither the consoles used to hide the banding, and every texture sampled without smoothing. The numbers (lines,
// colour levels, dither strength, grain) come from the game settings (public/game-settings.json, `look`) and stay
// live uniforms, so the admin page can change them while the game runs.
//
// The consoles also had no sub-pixel precision for vertices: every corner landed on a whole pixel of a coarse screen,
// so slow-moving models shivered and their edges wobbled. `snapVertex()` does the same for a material: the projected
// position is rounded to a SNAP-line grid (4 : 3) before rasterising.

import * as THREE from 'three/webgpu';
import { pass, screenUV, screenSize, vec2, vec3, vec4, floor, fract, float, Fn, uniform, time, dot, sin, mix, select, modelViewProjection } from 'three/tsl';
import { SETTINGS } from '../settings.js';

const LOOK = SETTINGS.look;
// The art direction (game settings, `art`, tuned in the studio, ?studio): how the people and the pigeon are drawn.
export const ART = SETTINGS.art;

// The vertex grid's lines (0 turns the snapping off), shared by every snapped material.
export const SNAP = uniform( LOOK.snap );

// Colour levels a channel the bodies of people are cut to (0: not cut), shared by every person's material.
export const BODY_LEVELS = uniform( ART.bodyLevels ?? 12 );

export const snapVertex = Fn( () => {

	const clip = modelViewProjection.toVar();
	const half = vec2( SNAP.mul( 4 / 3 ), SNAP ).mul( 0.5 );
	const snapped = clip.xy.div( clip.w ).mul( half ).round().div( half ).mul( clip.w );
	return select( SNAP.greaterThan( 0 ).and( clip.w.greaterThan( 0 ) ), vec4( snapped, clip.z, clip.w ), clip );

} );

// Ordered dither threshold 0…1 for a pixel (a 4 × 4 Bayer matrix from two 2 × 2 ones).
const bayer2 = a => fract( floor( a.x ).div( 2 ).add( floor( a.y ).mul( floor( a.y ) ).mul( 0.75 ) ) );
const bayer4 = a => bayer2( a.mul( 0.5 ) ).mul( 0.25 ).add( bayer2( a ) );

export function ps1Look( { renderer, scene, camera } ) {

	const lines = uniform( LOOK.lines ), levels = uniform( LOOK.levels ), dither = uniform( LOOK.dither ), grainAmount = uniform( LOOK.grain );
	const contrast = uniform( LOOK.contrast ), saturation = uniform( LOOK.saturation );
	const scenePass = pass( scene, camera );
	// The scene is drawn only at about the resolution the picture is shown at (a little above, for clean edges),
	// not at the screen's: most of the GPU's work saved.
	let shown = LOOK.lines;
	const fitScale = () => scenePass.setResolutionScale( shown ? Math.min( 1, ( shown * 1.5 ) / Math.max( 1, window.innerHeight * renderer.getPixelRatio() ) ) : 1 );
	fitScale();
	window.addEventListener( 'resize', fitScale );
	const colour = scenePass.getTextureNode();

	const output = Fn( () => {

		// The low-resolution grid: `lines` rows, as many columns as keep the pixels square (0: the screen's own pixels).
		const grid = select( lines.greaterThan( 0 ), vec2( lines.mul( screenSize.x.div( screenSize.y ) ).floor(), lines ), screenSize );
		const cell = floor( screenUV.mul( grid ) );
		const c = colour.sample( cell.add( 0.5 ).div( grid ) ).rgb;
		// A hard, contrasty grade (crushed shadows, punchy colour) like a cheap 90s render.
		const l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
		const graded = mix( vec3( l ), c, saturation ).sub( 0.5 ).mul( contrast ).add( 0.5 );
		// Coarse film grain over the picture, new every frame (from the full-resolution pixel, not the low grid).
		const px = floor( screenUV.mul( screenSize ) );
		const grain = fract( sin( dot( px.add( floor( time.mul( 24 ) ).mul( 17.3 ) ), vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) ).sub( 0.5 ).mul( grainAmount );
		// Colour levels a channel with the ordered dither between them (0: no cut, no dither).
		const n = levels.max( 1 );
		const d = bayer4( cell ).sub( 0.5 ).div( n ).mul( dither );
		const q = select( levels.greaterThan( 0 ), floor( graded.add( d ).add( grain ).mul( n ).add( 0.5 ) ).div( n ), graded.add( grain ) );
		return vec4( q.clamp( vec3( 0 ), vec3( 1 ) ), float( 1 ) );

	} )();

	const pipeline = new THREE.RenderPipeline( renderer, output );

	// Textures: no smoothing, no mipmaps (the pixels of a face or a sign stay pixels).
	const crisp = new Set();
	const sharpen = () => scene.traverse( o => {

		for ( const m of [ o.material ].flat() ) {

			if ( ! m ) continue;
			for ( const key of [ 'map', 'emissiveMap' ] ) {

				const t = m[ key ];
				if ( ! t || crisp.has( t ) || ! t.image ) continue; // not loaded yet (it comes nearest-filtered anyway)
				t.magFilter = THREE.NearestFilter;
				t.minFilter = THREE.NearestFilter;
				t.generateMipmaps = false;
				t.needsUpdate = true;
				crisp.add( t );

			}

		}

	} );
	sharpen();
	setTimeout( sharpen, 4000 ); // textures that arrive later (drawn fronts, people)

	// Live settings: { lines, levels, dither, grain, snap }.
	const set = look => {

		if ( look.lines !== undefined ) {

			lines.value = look.lines;
			shown = look.lines;
			fitScale();

		}
		if ( look.levels !== undefined ) levels.value = look.levels;
		if ( look.dither !== undefined ) dither.value = look.dither;
		if ( look.grain !== undefined ) grainAmount.value = look.grain;
		if ( look.snap !== undefined ) SNAP.value = look.snap;
		if ( look.contrast !== undefined ) contrast.value = look.contrast;
		if ( look.saturation !== undefined ) saturation.value = look.saturation;

	};

	return { render: () => pipeline.render(), lines, set };

}
