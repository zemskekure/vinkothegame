// The pigeon game's look: a late-90s console picture. The city is drawn as usual, then shown at a low fixed
// resolution (240 lines, square pixels), its colours cut down to 15-bit (32 levels a channel) with the ordered 4 × 4
// dither the consoles used to hide the banding, and every texture sampled without smoothing.

import * as THREE from 'three/webgpu';
import { pass, screenUV, screenSize, vec2, vec3, vec4, floor, fract, float, Fn, uniform, time, dot, sin, mix } from 'three/tsl';

const LINES = 220;
const LEVELS = 20;

// Ordered dither threshold 0…1 for a pixel (a 4 × 4 Bayer matrix from two 2 × 2 ones).
const bayer2 = a => fract( floor( a.x ).div( 2 ).add( floor( a.y ).mul( floor( a.y ) ).mul( 0.75 ) ) );
const bayer4 = a => bayer2( a.mul( 0.5 ) ).mul( 0.25 ).add( bayer2( a ) );

export function ps1Look( { renderer, scene, camera } ) {

	const lines = uniform( LINES );
	const scenePass = pass( scene, camera );
	const colour = scenePass.getTextureNode();

	const output = Fn( () => {

		// The low-resolution grid: LINES rows, as many columns as keep the pixels square.
		const grid = vec2( lines.mul( screenSize.x.div( screenSize.y ) ).floor(), lines );
		const cell = floor( screenUV.mul( grid ) );
		const c = colour.sample( cell.add( 0.5 ).div( grid ) ).rgb;
		// A hard, contrasty grade (crushed shadows, punchy colour) like a cheap 90s render.
		const l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
		const graded = mix( vec3( l ), c, 1.08 ).sub( 0.5 ).mul( 1.1 ).add( 0.5 );
		// Coarse film grain over the picture, new every frame (from the full-resolution pixel, not the low grid).
		const px = floor( screenUV.mul( screenSize ) );
		const grain = fract( sin( dot( px.add( floor( time.mul( 24 ) ).mul( 17.3 ) ), vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) ).sub( 0.5 ).mul( 0.16 );
		const d = bayer4( cell ).sub( 0.5 ).div( LEVELS );
		const q = floor( graded.add( d ).add( grain ).mul( LEVELS ).add( 0.5 ) ).div( LEVELS );
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
				if ( ! t || crisp.has( t ) ) continue;
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

	return { render: () => pipeline.render(), lines };

}
