// A day over Prague for the pigeon: the sun crosses the sky from the east, sets behind the Petřín side (west-north-
// west on a summer evening), and at night a cool moon lights the roofs. One game day takes DAY_MINUTES of real time;
// it starts in the golden hour the game was made in. T jumps the clock (keyboard) to see the next part of the day.

import * as THREE from 'three/webgpu';

const DAY_MINUTES = 16;

// Colour stops through the day (hour → sun colour, sun strength, sky light, ground bounce, fog, exposure).
const STOPS = [
	{ h: 0, sun: 0x8fa6d9, si: 0.35, sky: 0x4a5a80, ground: 0x1d1a22, hi: 0.35, fog: 0x1c2333, exp: 0.55 },
	{ h: 5, sun: 0x8fa6d9, si: 0.3, sky: 0x55648a, ground: 0x2a2228, hi: 0.4, fog: 0x2a3146, exp: 0.6 },
	{ h: 6.2, sun: 0xff9a5c, si: 1.6, sky: 0xd9b6a8, ground: 0x5b4636, hi: 0.55, fog: 0xe0a990, exp: 0.8 },
	{ h: 9, sun: 0xfff1dc, si: 3.2, sky: 0xdfe6ee, ground: 0xc49a6c, hi: 0.75, fog: 0xc9d6e2, exp: 0.95 },
	{ h: 16, sun: 0xfff1dc, si: 3.2, sky: 0xdfe6ee, ground: 0xc49a6c, hi: 0.75, fog: 0xc9d6e2, exp: 0.95 },
	{ h: 19, sun: 0xffae63, si: 3.6, sky: 0xf3c9a0, ground: 0x5b4636, hi: 0.7, fog: 0xe7ac78, exp: 0.92 },
	{ h: 20.6, sun: 0xff7448, si: 1.2, sky: 0xb58aa0, ground: 0x3b2c30, hi: 0.5, fog: 0x8a6a78, exp: 0.75 },
	{ h: 22, sun: 0x8fa6d9, si: 0.35, sky: 0x4a5a80, ground: 0x1d1a22, hi: 0.35, fog: 0x1c2333, exp: 0.55 },
	{ h: 24, sun: 0x8fa6d9, si: 0.35, sky: 0x4a5a80, ground: 0x1d1a22, hi: 0.35, fog: 0x1c2333, exp: 0.55 }
];

const ca = new THREE.Color(), cb = new THREE.Color();
const mixHex = ( a, b, t, out ) => out.copy( ca.setHex( a ) ).lerp( cb.setHex( b ), t );

export function startDay( { renderer, scene, sky, sun, hemi, centre, hour = 18.6 } ) {

	let time = hour;
	const dir = new THREE.Vector3();
	const label = document.createElement( 'div' );
	Object.assign( label.style, { position: 'fixed', right: '14px', top: '12px', font: '600 14px system-ui, sans-serif', color: '#fff3d6', textShadow: '0 1px 2px #000', pointerEvents: 'none' } );
	document.body.appendChild( label );
	window.addEventListener( 'keydown', e => {

		if ( e.code === 'KeyT' ) time = ( time + 3 ) % 24;

	} );

	function update( dt ) {

		time = ( time + dt * 24 / ( DAY_MINUTES * 60 ) ) % 24;

		// The sun: rises at 6, highest (58°) at 13, sets at 20.5; azimuth from east through south to west-north-west.
		const day = ( time - 6 ) / 14.5;
		const up = day > 0 && day < 1;
		const elevation = up ? Math.sin( day * Math.PI ) * 58 : 22; // at night the same light is the moon, fixed
		const azimuth = up ? 100 + day * 192 : 160;
		dir.setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 90 - Math.max( 2, elevation ) ), THREE.MathUtils.degToRad( azimuth ) );
		sun.position.copy( dir ).multiplyScalar( 700 ).add( centre );
		sky.sunPosition.value.copy( up ? dir : dir.clone().setY( - 0.3 ) );

		let i = 0;
		while ( i < STOPS.length - 2 && STOPS[ i + 1 ].h <= time ) i ++;
		const a = STOPS[ i ], b = STOPS[ i + 1 ], t = ( time - a.h ) / ( b.h - a.h );
		mixHex( a.sun, b.sun, t, sun.color );
		sun.intensity = a.si + ( b.si - a.si ) * t;
		mixHex( a.sky, b.sky, t, hemi.color );
		mixHex( a.ground, b.ground, t, hemi.groundColor );
		hemi.intensity = a.hi + ( b.hi - a.hi ) * t;
		if ( scene.fog ) mixHex( a.fog, b.fog, t, scene.fog.color );
		renderer.toneMappingExposure = a.exp + ( b.exp - a.exp ) * t;

		const hh = Math.floor( time ), mm = Math.floor( ( time - hh ) * 60 );
		label.textContent = `${up ? '☀️' : '🌙'} ${hh}:${String( mm ).padStart( 2, '0' )}`;

	}

	return { update, get hour() {

		return time;

	}, get night() {

		return time < 6 || time > 20.8;

	} };

}
