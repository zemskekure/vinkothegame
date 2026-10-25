// Background Posed Humans (Quaternius, CC0): selected OBJ poses + hairstyles → one GLB per body.
import obj2gltf from 'obj2gltf';
import { WebIO, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition, prune, dedup, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions( ALL_EXTENSIONS ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const [ SRC, OUT ] = process.argv.slice( 2 );
const SETS = {
	male: { dir: 'Male', prefix: 'Male', poses: [ 'Standing', 'Walking', 'Sitting', 'Standing_Hips', 'Standing_Waving', 'LookingUp', 'Sitting_Cheering' ] },
	female: { dir: 'Female', prefix: 'Female', poses: [ 'Standing', 'Walking', 'Sitting', 'Standing_Hips', 'Standing_Waving', 'LookingUp', 'Sitting_Cheering' ] }
};
for ( const [ key, set ] of Object.entries( SETS ) ) {
	const files = set.poses.map( p => [ p, `${SRC}/${set.dir}/${set.dir} Poses/OBJ/${p === 'Standing_Waving' && key === 'female' ? 'Woman' : set.prefix}_${p}.obj` ] );
	for ( let i = 1; i <= 4; i ++ ) files.push( [ `Hair_${i}`, `${SRC}/${set.dir}/${set.dir} Hairstyles/OBJ/${set.prefix}_Hairstyle_${i}.obj` ] );
	let doc = null;
	for ( const [ name, file ] of files ) {
		const glb = await obj2gltf( file, { binary: true } );
		const d = await io.readBinary( new Uint8Array( glb ) );
		for ( const n of d.getRoot().listNodes() ) n.setName( name );
		for ( const m of d.getRoot().listMeshes() ) m.setName( name );
		if ( ! doc ) doc = d; else mergeDocuments( doc, d );
	}
	// One scene holding every pose and hairstyle as a root node.
	const scenes = doc.getRoot().listScenes();
	for ( const s of scenes.slice( 1 ) ) {
		for ( const n of s.listChildren() ) scenes[ 0 ].addChild( n );
		s.dispose();
	}
	await doc.transform( unpartition(), dedup(), weld(), prune(), meshopt( { encoder: MeshoptEncoder, level: 'medium' } ) );
	await io.write( `${OUT}/${key}.glb`, doc );
	console.log( key, doc.getRoot().listMeshes().map( m => m.getName() + ':' + m.listPrimitives().map( p => p.getMaterial()?.getName() ).join( '/' ) ).join( ' ' ) );
}
