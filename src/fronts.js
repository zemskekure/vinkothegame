// Drawn street fronts from owner-owned photos or visual descriptions. The SVGs are checked during the square
// merge; they are rendered just ahead of the procedural ground floor, with real passage openings left clear.

import * as THREE from 'three/webgpu';

const urls = import.meta.glob( '../data/fronts-rendered/*.png', { query: '?url', import: 'default', eager: true } );
const ownerUrls = import.meta.glob( '../data/fronts/owner/*.{jpg,jpeg,png,webp}', { query: '?url', import: 'default', eager: true } );

export async function addShopfronts( scene, fronts ) {

	const loader = new THREE.TextureLoader();
	for ( const f of fronts || [] ) {

		const url = f.file.endsWith( '.svg' ) ? urls[ `../data/fronts-rendered/${f.file.replace( /\.svg$/, '.png' )}` ] : ownerUrls[ `../data/fronts/${f.file}` ];
		if ( ! url ) throw new Error( `Missing drawn front ${f.file}` );
		const texture = await loader.loadAsync( url );
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = 8;
		const material = new THREE.MeshStandardNodeMaterial( { map: texture, transparent: true, alphaTest: 0.08, roughness: 0.8, side: THREE.DoubleSide } );
		const group = new THREE.Group();
		group.position.set( ...f.at );
		group.rotation.y = f.rot;
		for ( const [ from, to ] of f.visible ) {

			if ( to - from < 0.02 ) continue;
			const geometry = new THREE.PlaneGeometry( to - from, f.height );
			const uv = geometry.attributes.uv;
			const [ u0, u1 ] = f.uvBox || [ 0, f.width ];
			for ( let i = 0; i < uv.count; i ++ ) uv.setX( i, ( from + uv.getX( i ) * ( to - from ) - u0 ) / ( u1 - u0 ) );
			const mesh = new THREE.Mesh( geometry, material );
			mesh.position.set( ( from + to - f.width ) / 2, 0, f.depth || 0.075 );
			mesh.receiveShadow = true;
			group.add( mesh );

		}
		scene.add( group );

	}

}
