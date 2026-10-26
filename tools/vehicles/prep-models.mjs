// Downloaded vehicle models (see public/models/vehicles/CREDITS.md) → small GLBs in public/models/vehicles: one
// base-colour texture each, shrunk to console size, no normal / roughness maps, extra vertex attributes and skins
// dropped, meshes joined by material, the busy ones simplified, meshopt-compressed. Scale and orientation are
// set at run time (src/vehicles.js), so the files keep the authors' own frames.
// Usage (packages that are not project dependencies, see README.md here):
//   node tools/vehicles/prep-models.mjs <models folder> public/models/vehicles
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, join, flatten, metalRough, textureCompress, simplify, meshopt, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions( ALL_EXTENSIONS ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const [ SRC, OUT ] = process.argv.slice( 2 );

// name: source, texture size, kept fraction of vertices (1: as is), materials to drop.
const MODELS = {
	scooter: { src: 'sketchfab/scooter-vario/model.glb', size: 256 },
	'car-octavia': { src: 'sketchfab/car-octavia/model.glb', size: 256 },
	'car-favorit': { src: 'sketchfab/car-favorit/model.glb', size: 256, drop: [ 'edge' ] },
	'car-trabant': { src: 'sketchfab/car-trabant/model.glb', size: 128, drop: [ 'ddr_polizei' ] },
	'boat-swan': { src: 'sketchfab/boat-swan-a/model.glb', size: 128 },
	'boat-steamer': { src: 'sketchfab/boat-steamer-norrtelje/model.glb', size: 512, ratio: 0.4 },
	'boat-row': { src: 'kenney-water/Models/GLB format/boat-row-small.glb', size: 64 },
	'boat-row-large': { src: 'kenney-water/Models/GLB format/boat-row-large.glb', size: 64 }
};
for ( const n of [ 'sedan', 'taxi', 'police', 'van', 'delivery', 'suv', 'hatchback-sports' ] ) MODELS[ `kenney-${n}` ] = { src: `kenney-car/Models/GLB format/${n}.glb`, size: 64 };

const KEEP = [ 'POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0' ];
for ( const [ name, m ] of Object.entries( MODELS ) ) {

	const doc = await io.read( `${SRC}/${m.src}` );
	const root = doc.getRoot();
	for ( const skin of root.listSkins() ) skin.dispose();
	for ( const node of root.listNodes() ) {

		const mesh = node.getMesh();
		if ( mesh && mesh.listPrimitives().every( p => ( m.drop || [] ).includes( p.getMaterial()?.getName() ) ) ) node.setMesh( null );

	}

	for ( const mesh of root.listMeshes() ) for ( const p of mesh.listPrimitives() ) {

		if ( ( m.drop || [] ).includes( p.getMaterial()?.getName() ) ) { p.dispose(); continue; }
		for ( const sem of p.listSemantics() ) if ( ! KEEP.includes( sem ) ) p.setAttribute( sem, null );
		for ( const t of p.listTargets() ) t.dispose();

	}

	await doc.transform( metalRough() );
	for ( const mat of root.listMaterials() ) {

		mat.setNormalTexture( null ).setMetallicRoughnessTexture( null ).setOcclusionTexture( null ).setEmissiveTexture( null );
		mat.setMetallicFactor( 0 ).setRoughnessFactor( 0.8 );
		for ( const ext of mat.listExtensions() ) ext.dispose();

	}

	for ( const ext of root.listExtensionsUsed() ) if ( ! /meshopt|texture_transform/.test( ext.extensionName ) ) ext.dispose();
	await doc.transform(
		prune(), flatten(), join(), unpartition(), dedup(), weld(),
		...( m.ratio ? [ simplify( { simplifier: MeshoptSimplifier, ratio: m.ratio, error: 0.004 } ) ] : [] ),
		textureCompress( { encoder: sharp, targetFormat: 'png', resize: [ m.size, m.size ] } ),
		prune(),
		meshopt( { encoder: MeshoptEncoder, level: 'medium' } )
	);
	await io.write( `${OUT}/${name}.glb`, doc );
	const tris = root.listMeshes().reduce( ( n, me ) => n + me.listPrimitives().reduce( ( k, p ) => k + ( p.getIndices()?.getCount() ?? p.getAttribute( 'POSITION' ).getCount() ) / 3, 0 ), 0 );
	console.log( name, Math.round( tris ), 'triangles,', root.listMaterials().length, 'materials,', root.listTextures().map( t => t.getSize()?.join( '×' ) ).join( ' ' ) );

}
