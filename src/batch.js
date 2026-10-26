// Fewer draw calls. The city is thousands of small hand-modelled pieces (signs, lanterns, portals, café tables…),
// and every one was a draw call of its own each frame: the browser spent most of a frame telling the GPU about them
// rather than drawing. Two remedies, run once the city is built:
//
// - batchStatic(): pieces that never move are merged, per material and per square of the city (so the squares out
//   of view are still skipped), into one mesh each.
// - splitByTile(): the few huge meshes (terrain, pavements, walls, roofs) are cut into squares sharing one vertex
//   buffer, so only the squares in view are drawn.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const signature = g => Object.keys( g.attributes ).sort().map( name => {

	const a = g.attributes[ name ];
	return `${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array?.constructor.name}`;

} ).join( ',' ) + ( g.index ? '|i' : '|n' ) + ( Object.keys( g.morphAttributes ).length ? '|m' : '' );

// A material is plain when it is only a colour with its sheen (no textures, no shader nodes): plain materials that
// differ in colour alone can share one material with the colour moved into the vertices.
const MAPS = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'lightMap', 'bumpMap', 'envMap', 'displacementMap', 'specularMap' ];
function plainKey( m ) {

	if ( ! m.isMeshStandardMaterial || m.isMeshPhysicalMaterial ) return null;
	if ( MAPS.some( k => m[ k ] ) ) return null;
	for ( const k in m ) if ( k.endsWith( 'Node' ) && m[ k ] ) return null;
	const r = v => Math.round( v * 20 ) / 20;
	return [ m.type, r( m.roughness ), r( m.metalness ), m.emissive.getHexString(), r( m.emissiveIntensity ), m.side, m.transparent, r( m.opacity ), m.flatShading, m.alphaTest, m.depthWrite, m.depthTest,
		m.fog, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.blending, m.toneMapped, m.wireframe, m.envMapIntensity ].join( ':' );

}

const sharedPlain = new Map();
function plainMaterial( key, m ) {

	if ( ! sharedPlain.has( key ) ) {

		const shared = new THREE.MeshStandardNodeMaterial();
		for ( const k of [ 'roughness', 'metalness', 'emissiveIntensity', 'side', 'transparent', 'opacity', 'flatShading', 'alphaTest', 'depthWrite', 'depthTest', 'fog', 'polygonOffset',
			'polygonOffsetFactor', 'polygonOffsetUnits', 'blending', 'toneMapped', 'wireframe', 'envMapIntensity' ] ) shared[ k ] = m[ k ];
		shared.emissive.copy( m.emissive );
		shared.vertexColors = true;
		shared.name = 'plain batch';
		sharedPlain.set( key, shared );

	}

	return sharedPlain.get( key );

}

// The geometry of a mesh with a plain material, ready to merge with others: unindexed, only positions, normals and
// the material's colour in every vertex.
function plainGeometry( mesh ) {

	const src = mesh.geometry, g = src.index ? src.toNonIndexed() : src.clone();
	for ( const name of Object.keys( g.attributes ) ) if ( ! [ 'position', 'normal', 'color' ].includes( name ) ) g.deleteAttribute( name );
	if ( ! g.attributes.normal ) g.computeVertexNormals();
	const n = g.attributes.position.count, colour = mesh.material.color, out = new Float32Array( n * 3 );
	const own = mesh.material.vertexColors ? g.attributes.color : null;
	for ( let i = 0; i < n; i ++ ) {

		out[ i * 3 ] = colour.r * ( own ? own.getX( i ) : 1 );
		out[ i * 3 + 1 ] = colour.g * ( own ? own.getY( i ) : 1 );
		out[ i * 3 + 2 ] = colour.b * ( own ? own.getZ( i ) : 1 );

	}

	g.setAttribute( 'color', new THREE.BufferAttribute( out, 3 ) );
	for ( const name of Object.keys( g.attributes ) ) if ( g.attributes[ name ].array.constructor !== Float32Array ) return null;
	return g;

}

// Merges the static meshes under `root` (a scene) per material and per `tile` × `tile` metre square. Meshes under
// an object with userData.dynamic, instanced, skinned or morphing ones, interleaved ones and very big ones stay as
// they are. Returns how many meshes went into how many batches.
export function batchStatic( root, { tile = 150, maxVertices = 200000 } = {} ) {

	root.updateMatrixWorld( true );
	const groups = new Map(), centre = new THREE.Vector3();
	const visit = ( o ) => {

		if ( o.userData.dynamic || ! o.visible ) return;
		if ( o.isMesh && ! o.isInstancedMesh && ! o.isSkinnedMesh && ! o.isBatchedMesh && ! Array.isArray( o.material ) && ! o.morphTargetInfluences ) {

			const g = o.geometry;
			const simple = g.attributes.position && g.attributes.position.count <= maxVertices && ! Object.values( g.attributes ).some( a => a.isInterleavedBufferAttribute ) &&
				g.drawRange.start === 0 && g.drawRange.count === Infinity && ! Object.keys( g.morphAttributes ).length;
			if ( simple ) {

				if ( ! g.boundingSphere ) g.computeBoundingSphere();
				centre.copy( g.boundingSphere.center ).applyMatrix4( o.matrixWorld );
				const plain = plainKey( o.material );
				const key = [ plain ? 'plain:' + plain : o.material.id, plain ? 'pnc' : signature( g ), o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.renderOrder, Math.floor( centre.x / tile ), Math.floor( centre.z / tile ) ].join( '/' );
				if ( ! groups.has( key ) ) groups.set( key, [] );
				groups.get( key ).push( o );

			}

		}

		for ( const c of o.children ) visit( c );

	};

	visit( root );
	let meshes = 0, batches = 0;
	const made = [];
	for ( const list of groups.values() ) {

		const plain = plainKey( list[ 0 ].material );
		if ( list.length < 2 && ! plain ) continue;
		const geometries = list.map( o => {

			const g = plain ? plainGeometry( o ) : o.geometry.clone();
			if ( ! g ) return null;
			g.applyMatrix4( o.matrixWorld );
			// A mirrored piece (negative scale) has its triangles wound the other way round.
			if ( o.matrixWorld.determinant() < 0 ) {

				if ( g.index ) {

					const a = g.index.array;
					for ( let i = 0; i < a.length; i += 3 ) [ a[ i + 1 ], a[ i + 2 ] ] = [ a[ i + 2 ], a[ i + 1 ] ];

				} else {

					for ( const attr of Object.values( g.attributes ) ) {

						const s = attr.itemSize, a = attr.array;
						for ( let v = 0; v < attr.count; v += 3 ) for ( let k = 0; k < s; k ++ ) [ a[ ( v + 1 ) * s + k ], a[ ( v + 2 ) * s + k ] ] = [ a[ ( v + 2 ) * s + k ], a[ ( v + 1 ) * s + k ] ];

					}

				}

			}

			g.clearGroups();
			return g;

		} );
		if ( geometries.includes( null ) ) continue;
		const merged = mergeGeometries( geometries );
		if ( ! merged ) continue;
		merged.computeBoundingSphere();
		const first = list[ 0 ];
		const mesh = new THREE.Mesh( merged, plain ? plainMaterial( plain, first.material ) : first.material );
		mesh.name = 'batch';
		mesh.castShadow = first.castShadow;
		mesh.receiveShadow = first.receiveShadow;
		mesh.renderOrder = first.renderOrder;
		mesh.matrixAutoUpdate = false;
		root.add( mesh );
		made.push( mesh );
		for ( const o of list ) o.removeFromParent();
		for ( const g of geometries ) g.dispose();
		meshes += list.length;
		batches ++;

	}

	return { meshes, batches, list: made };

}

// Cuts a big static mesh into `tile` × `tile` metre squares (by each triangle's centre). The squares share the
// mesh's vertex buffer: the triangles are reordered square by square and each square draws its own range of them.
// The mesh is replaced in its parent by a group of the squares, which is returned.
export function splitByTile( mesh, tile = 200 ) {

	const g = mesh.geometry, pos = g.attributes.position;
	const index = g.index ? g.index.array : null;
	const triCount = ( index ? index.length : pos.count ) / 3;
	const vertexOf = index ? ( t, k ) => index[ t * 3 + k ] : ( t, k ) => t * 3 + k;
	const ti = new Int32Array( triCount ), tj = new Int32Array( triCount );
	let minI = Infinity, minJ = Infinity, maxI = - Infinity, maxJ = - Infinity;
	for ( let t = 0; t < triCount; t ++ ) {

		const a = vertexOf( t, 0 ), b = vertexOf( t, 1 ), c = vertexOf( t, 2 );
		const i = ti[ t ] = Math.floor( ( pos.getX( a ) + pos.getX( b ) + pos.getX( c ) ) / 3 / tile );
		const j = tj[ t ] = Math.floor( ( pos.getZ( a ) + pos.getZ( b ) + pos.getZ( c ) ) / 3 / tile );
		minI = Math.min( minI, i ); maxI = Math.max( maxI, i ); minJ = Math.min( minJ, j ); maxJ = Math.max( maxJ, j );

	}

	// Triangles in order of their square (a counting sort over the squares).
	const W = maxI - minI + 1, H = maxJ - minJ + 1, counts = new Uint32Array( W * H + 1 ), cells = new Uint32Array( triCount );
	for ( let t = 0; t < triCount; t ++ ) {

		cells[ t ] = ( ti[ t ] - minI ) * H + ( tj[ t ] - minJ );
		counts[ cells[ t ] + 1 ] ++;

	}

	for ( let k = 1; k <= W * H; k ++ ) counts[ k ] += counts[ k - 1 ];
	const starts = counts.slice();
	const order = new Uint32Array( triCount );
	for ( let t = 0; t < triCount; t ++ ) order[ starts[ cells[ t ] ] ++ ] = t;

	let shared;
	if ( index ) {

		const sorted = new ( index.constructor )( index.length );
		for ( let n = 0; n < triCount; n ++ ) sorted.set( index.subarray( order[ n ] * 3, order[ n ] * 3 + 3 ), n * 3 );
		shared = new THREE.BufferGeometry();
		for ( const [ name, attr ] of Object.entries( g.attributes ) ) shared.setAttribute( name, attr );
		shared.setIndex( new THREE.BufferAttribute( sorted, 1 ) );

	} else {

		shared = new THREE.BufferGeometry();
		for ( const [ name, attr ] of Object.entries( g.attributes ) ) {

			const s = attr.itemSize, src = attr.array, out = new ( src.constructor )( src.length );
			for ( let n = 0; n < triCount; n ++ ) out.set( src.subarray( order[ n ] * 3 * s, order[ n ] * 3 * s + 3 * s ), n * 3 * s );
			shared.setAttribute( name, new THREE.BufferAttribute( out, s, attr.normalized ) );

		}

	}

	const group = new THREE.Group();
	group.name = mesh.name;
	const sp = shared.attributes.position, box = new THREE.Box3(), v = new THREE.Vector3();
	for ( let k = 0; k < W * H; k ++ ) {

		const from = counts[ k ], to = counts[ k + 1 ];
		if ( to === from ) continue;
		const part = new THREE.BufferGeometry();
		for ( const [ name, attr ] of Object.entries( shared.attributes ) ) part.setAttribute( name, attr );
		if ( shared.index ) part.setIndex( shared.index );
		part.setDrawRange( from * 3, ( to - from ) * 3 );
		box.makeEmpty();
		for ( let n = from * 3; n < to * 3; n ++ ) box.expandByPoint( v.fromBufferAttribute( sp, shared.index ? shared.index.array[ n ] : n ) );
		part.boundingBox = box.clone();
		part.boundingSphere = box.getBoundingSphere( new THREE.Sphere() );
		const m = new THREE.Mesh( part, mesh.material );
		Object.assign( m, { castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, renderOrder: mesh.renderOrder } );
		m.matrixAutoUpdate = false;
		group.add( m );

	}

	group.userData.geometry = shared;
	if ( mesh.parent ) mesh.parent.add( group );
	mesh.removeFromParent();
	return group;

}
