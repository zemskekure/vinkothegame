// Drawn street fronts from owner-owned photos or visual descriptions. The SVGs are checked during the square
// merge; they are rendered just ahead of the procedural ground floor, with real passage openings left clear.

import * as THREE from 'three/webgpu';

const urls = import.meta.glob( '../data/fronts-rendered/*.webp', { query: '?url', import: 'default', eager: true } );

export async function addShopfronts( scene, fronts ) {

	const loader = new THREE.TextureLoader();
	// All the drawings at once, not one after another.
	const textures = await Promise.all( ( fronts || [] ).map( f => {

		const url = urls[ `../data/fronts-rendered/${f.file.replace( /\.svg$/, '.webp' )}` ];
		if ( ! url ) throw new Error( `Missing drawn front ${f.file}` );
		return loader.loadAsync( url );

	} ) );
	for ( const [ k, f ] of ( fronts || [] ).entries() ) {

		const texture = textures[ k ];
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = 8;
		const material = new THREE.MeshStandardNodeMaterial( { map: texture, transparent: true, alphaTest: 0.08, roughness: 0.8, side: THREE.DoubleSide } );
		const group = new THREE.Group();
		group.position.set( ...f.at );
		group.rotation.y = f.rot;
		for ( const [ from, to, depth = 0 ] of f.visible ) {

			if ( to - from < 0.02 ) continue;
			const geometry = new THREE.PlaneGeometry( to - from, f.height );
			const uv = geometry.attributes.uv;
			for ( let i = 0; i < uv.count; i ++ ) uv.setX( i, ( from + uv.getX( i ) * ( to - from ) ) / f.width );
			const mesh = new THREE.Mesh( geometry, material );
			mesh.position.set( ( from + to - f.width ) / 2, 0, 0.075 - depth );
			mesh.receiveShadow = true;
			group.add( mesh );

		}
		scene.add( group );

	}

}
