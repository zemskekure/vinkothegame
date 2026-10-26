// Shared loading for the vehicle models in public/models/vehicles (prepared by tools/vehicles/prep-models.mjs;
// authors and licences in public/models/vehicles/CREDITS.md). Every file is one textured mesh in its author's own
// frame; here it becomes one geometry facing +z, centred, standing on y = 0 and scaled to the real vehicle's length,
// with its texture sampled without smoothing like the rest of the late-90s look. Textures are plain files next to
// the models, so a redrawn one can replace a model's own (see `skin`).

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DIR = 'models/vehicles/';

const textureLoader = new THREE.TextureLoader();
const cache = new Map();

// A texture file from public/models/vehicles, crisp (nearest texel, no mipmaps), shared between users.
export function crispTexture( file, { flipY = true } = {} ) {

	const key = file + flipY;
	if ( ! cache.has( key ) ) {

		const t = textureLoader.load( DIR + file );
		t.colorSpace = THREE.SRGBColorSpace;
		t.magFilter = THREE.NearestFilter;
		t.minFilter = THREE.NearestFilter;
		t.generateMipmaps = false;
		t.flipY = flipY;
		cache.set( key, t );

	}

	return cache.get( key );

}

function floats( attr ) {

	const n = attr.count, k = attr.itemSize, out = new Float32Array( n * k );
	for ( let i = 0; i < n; i ++ ) for ( let j = 0; j < k; j ++ ) out[ i * k + j ] = attr.getComponent( i, j );
	return new THREE.Float32BufferAttribute( out, k );

}

// One model as { geometry, material, size }. `length` is the real vehicle's length in metres (along z).
export async function vehicleModel( loadModel, name, length, { roughness = 0.75, metalness = 0 } = {} ) {

	const gltf = await loadModel( `${DIR}${name}.glb`, DIR );
	const geos = [];
	let map = null;
	gltf.scene.updateMatrixWorld( true );
	gltf.scene.traverse( o => {

		if ( ! o.isMesh ) return;
		// The files are quantised (whole-number positions scaled by their node): back to plain floats before the
		// node's transform is applied, or it would be clamped to the integer range.
		const g = new THREE.BufferGeometry();
		for ( const a of [ 'position', 'normal', 'uv' ] ) if ( o.geometry.attributes[ a ] ) g.setAttribute( a, floats( o.geometry.attributes[ a ] ) );
		if ( o.geometry.index ) g.setIndex( o.geometry.index.clone() );
		g.applyMatrix4( o.matrixWorld );
		if ( ! g.attributes.uv ) g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( g.attributes.position.count * 2 ), 2 ) );
		geos.push( g.index ? g.toNonIndexed() : g );
		map = map || o.material.map;

	} );

	const geometry = mergeGeometries( geos );
	geometry.computeBoundingBox();
	const b = geometry.boundingBox;
	const s = length / ( b.max.z - b.min.z );
	geometry.translate( - ( b.min.x + b.max.x ) / 2, - b.min.y, - ( b.min.z + b.max.z ) / 2 ).scale( s, s, s );
	geometry.computeBoundingBox();
	if ( map ) {

		map.magFilter = map.minFilter = THREE.NearestFilter;
		map.generateMipmaps = false;
		map.needsUpdate = true;

	}

	const material = new THREE.MeshStandardNodeMaterial( { map, roughness, metalness, side: THREE.DoubleSide } );
	return { geometry, material, size: geometry.boundingBox.getSize( new THREE.Vector3() ) };

}
