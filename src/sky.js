// The sky as the owner's painted panoramas (public/textures/sky, tools/textures/sky.py) on a dome that travels with
// the camera: a pink hazy sunrise, blue noon with fair-weather clouds, the golden evening, a full moon at night, and
// for bad weather a grey drizzle or a storm. With the pigeon's clock (src/holub/sky.js) one sky fades into the next
// over an hour; on foot it is the afternoon. Towards the horizon the picture fades into the fog's colour, so the city
// ends in haze as before. The physical sky (three's SkyMesh) still lights the scene; it is only hidden.
//
// `?weather=overcast` or `?weather=storm` (or game settings `look.weather`) swaps the daytime skies.

import * as THREE from 'three/webgpu';
import { texture, uniform, mix, vec2, smoothstep, positionLocal, atan, asin, normalize, float, PI } from 'three/tsl';

const DIR = 'textures/sky/';
const NAMES = [ 'pink_sunrise_haze', 'blue_noon', 'golden_evening', 'night_full_moon', 'grey_overcast_drizzle', 'heavy_storm' ];

// Hour → sky, each held from its hour until the next stop's, fading over the hour before the next one.
const DAY = [ [ 0, 'night_full_moon' ], [ 5.2, 'pink_sunrise_haze' ], [ 8, 'blue_noon' ], [ 17.8, 'golden_evening' ], [ 21, 'night_full_moon' ] ];
const WEATHER = { overcast: 'grey_overcast_drizzle', storm: 'heavy_storm' };

export function addSky( scene, { weather = '' } = {} ) {

	const loader = new THREE.TextureLoader();
	const tex = {};
	for ( const n of NAMES ) {

		const t = loader.load( DIR + n + '.jpg' );
		t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = THREE.MirroredRepeatWrapping;
		t.magFilter = t.minFilter = THREE.NearestFilter;
		t.generateMipmaps = false;
		tex[ n ] = t;

	}

	// Two pictures and how far the fade from the first to the second has got.
	const a = texture( tex.blue_noon ), b = texture( tex.blue_noon ), blend = uniform( 0 ), fog = uniform( new THREE.Color() );
	const dir = normalize( positionLocal );
	// Round the horizon twice (the picture mirrored the second time, so there is no seam), up to 55° above it.
	const elevation = asin( dir.y.clamp( - 1, 1 ) ).div( PI.mul( 0.5 ) );
	const st = vec2( atan( dir.x, dir.z ).div( PI ).add( 1 ), elevation.div( 0.6 ).clamp( 0.01, 0.99 ) );
	a.uvNode = st;
	b.uvNode = st;
	const material = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide, depthWrite: false, fog: false } );
	material.colorNode = mix( mix( a, b, blend ).rgb, fog, smoothstep( float( 0.1 ), float( 0.0 ), elevation ) );
	material.toneMapped = false;
	material.name = 'sky panorama';

	const dome = new THREE.Mesh( new THREE.SphereGeometry( 3000, 24, 12 ), material );
	dome.renderOrder = - 1;
	dome.frustumCulled = false;
	dome.userData.dynamic = true;
	scene.add( dome );

	const pick = h => {

		const day = n => WEATHER[ weather ] && n !== 'night_full_moon' ? WEATHER[ weather ] : n;
		h = ( ( h % 24 ) + 24 ) % 24;
		let i = DAY.length - 1;
		while ( i > 0 && DAY[ i ][ 0 ] > h ) i --;
		const next = DAY[ ( i + 1 ) % DAY.length ], end = next[ 0 ] || 24;
		return [ day( DAY[ i ][ 1 ] ), day( next[ 1 ] ), Math.max( 0, Math.min( 1, h - ( end - 1 ) ) ) ];

	};

	function update( camera, hour ) {

		dome.position.copy( camera.position );
		const [ p, q, t ] = pick( hour );
		a.value = tex[ p ];
		b.value = tex[ q ];
		blend.value = t;
		if ( scene.fog ) fog.value.copy( scene.fog.color );

	}

	return { update, dome, set weather( w ) {

		weather = w;

	} };

}
