// Street decorations from the house descriptions (data/houses.json via tools/build-scene.mjs, `decor`):
// fabric awnings over restaurants, wall lanterns on iron brackets and vertical hanging banners.
// Every entry is positioned on its facade with `rot` turning the model's +z to point out of the wall.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const iron = new THREE.MeshStandardNodeMaterial( { color: 0x232624, metalness: 0.6, roughness: 0.45 } );
const glass = new THREE.MeshStandardNodeMaterial( { color: 0xfff2d6, emissive: 0xffd9a0, emissiveIntensity: 0.4, roughness: 0.2 } );

export function addDecor( scene, decor ) {

	if ( ! decor ) return;
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
	const up = new THREE.Vector3( 0, 1, 0 );
	const c = new THREE.Color();

	// Awnings: a fabric slope 1.4 m deep falling 0.45 m, with a 25 cm valance, as wide as the shop front.
	if ( decor.awnings.length ) {

		const slope = new THREE.BoxGeometry( 1, 0.03, 1.4 ).translate( 0, 0, 0.7 ).rotateX( 0.33 );
		const valance = new THREE.BoxGeometry( 1, 0.25, 0.02 ).translate( 0, - 0.58, 1.33 );
		const geometry = mergeGeometries( [ slope, valance ] );
		const mesh = new THREE.InstancedMesh( geometry, new THREE.MeshStandardNodeMaterial( { roughness: 0.85 } ), decor.awnings.length );
		decor.awnings.forEach( ( [ x, y, z, rot, w, colour ], i ) => {

			mesh.setMatrixAt( i, m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( w, 1, 1 ) ) );
			mesh.setColorAt( i, c.set( colour ) );

		} );
		mesh.castShadow = mesh.receiveShadow = true;
		scene.add( mesh );

	}

	// Wall lanterns: an iron bracket 55 cm out from the wall with a four-sided lantern hanging from it.
	if ( decor.lanterns.length ) {

		const bracket = mergeGeometries( [
			new THREE.BoxGeometry( 0.03, 0.03, 0.55 ).translate( 0, 0, 0.275 ),
			new THREE.BoxGeometry( 0.02, 0.3, 0.02 ).rotateX( 0.8 ).translate( 0, - 0.12, 0.12 ),
			new THREE.CylinderGeometry( 0.0, 0.17, 0.18, 4 ).rotateY( Math.PI / 4 ).translate( 0, - 0.1, 0.55 )
		] );
		const lantern = new THREE.CylinderGeometry( 0.14, 0.1, 0.38, 4 ).rotateY( Math.PI / 4 ).translate( 0, - 0.38, 0.55 );
		for ( const [ geometry, material ] of [ [ bracket, iron ], [ lantern, glass ] ] ) {

			const mesh = new THREE.InstancedMesh( geometry, material, decor.lanterns.length );
			decor.lanterns.forEach( ( [ x, y, z, rot ], i ) => mesh.setMatrixAt( i, m.compose( p.set( x, y, z ), q.setFromAxisAngle( up, rot ), s.set( 1, 1, 1 ) ) ) );
			mesh.castShadow = true;
			scene.add( mesh );

		}

	}

	// Vertical banners hung at right angles to the wall, lettered top to bottom.
	for ( const [ x, y, z, rot, text, board, ink ] of decor.banners ) {

		const canvas = document.createElement( 'canvas' );
		canvas.width = 128;
		canvas.height = 128 * text.length;
		const ctx = canvas.getContext( '2d' );
		ctx.fillStyle = board;
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		ctx.fillStyle = ink;
		ctx.font = '600 92px system-ui, "Helvetica Neue", Arial, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		[ ...text ].forEach( ( ch, i ) => ctx.fillText( ch, 64, 64 + i * 128 ) );
		const texture = new THREE.CanvasTexture( canvas );
		texture.colorSpace = THREE.SRGBColorSpace;

		const width = 0.6, height = 0.6 * text.length;
		const banner = new THREE.Mesh( new THREE.PlaneGeometry( width, height ).rotateY( Math.PI / 2 ).translate( 0, - height / 2, width / 2 + 0.15 ),
			new THREE.MeshStandardNodeMaterial( { map: texture, side: THREE.DoubleSide, roughness: 0.7 } ) );
		banner.position.set( x, y, z );
		banner.rotation.y = rot;
		banner.castShadow = true;
		scene.add( banner );

	}

}
