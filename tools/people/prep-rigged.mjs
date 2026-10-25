// Prunes the Quaternius GLBs to the clips the game uses and writes them into the worktree.
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions( ALL_EXTENSIONS ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
await MeshoptEncoder.ready;
const SRC = process.argv[ 2 ], OUT = process.argv[ 3 ];
const PICK = [
	[ 'animated-men', 'longsleeve', 'Animated-Men__DLptRuewTn' ],
	[ 'animated-men', 'shirt', 'Animated-Men__fjHyMd5Wxw' ],
	[ 'animated-men', 'casual', 'Animated-Men__HMnuH5geEG' ],
	[ 'animated-men', 'suit', 'Animated-Men__mQnGoME1ez' ],
	[ 'animated-women', 'jacket', 'Animated-Women__AQsd9ngvKU' ],
	[ 'animated-women', 'casual', 'Animated-Women__jpKRgGDxhk' ],
	[ 'animated-women', 'tanktop', 'Animated-Women__XqzeZGB7iU' ],
	[ 'animated-women', 'dress', 'Animated-Women__zMyPlQXBzq' ],
	[ 'modular-men', 'adventurer', 'Ultimate-Modular-Men__5EGWBMpuXq' ],
	[ 'modular-men', 'farmer', 'Ultimate-Modular-Men__7pn3R6hPvE' ],
	[ 'modular-men', 'punk', 'Ultimate-Modular-Men__BTALZymknF' ],
	[ 'modular-men', 'beach', 'Ultimate-Modular-Men__DojKLcO34E' ],
	[ 'modular-men', 'hoodie', 'Ultimate-Modular-Men__gKLBoRsyKe' ],
	[ 'modular-men', 'business', 'Ultimate-Modular-Men__JFrLIKqvCH' ],
	[ 'modular-men', 'casual', 'Ultimate-Modular-Men__kZ3DmIoGip' ],
	[ 'modular-men', 'worker', 'Ultimate-Modular-Men__Yg2bQZO6Hj' ],
	[ 'modular-women', 'punk', 'Ultimate-Modular-Women__djXoqejw6w' ],
	[ 'modular-women', 'formal', 'Ultimate-Modular-Women__nIItLV9nxS' ],
	[ 'modular-women', 'casual', 'Ultimate-Modular-Women__qJ2gsTUBHL' ],
	[ 'modular-women', 'adventurer', 'Ultimate-Modular-Women__ZwF0K7WBmu' ]
];
const KEEP = /\|(Man_|Female_)?(Walk|Idle|Sitting|Run|Wave)$/;
for ( const [ pack, name, file ] of PICK ) {
	const doc = await io.read( `${SRC}/${file}.glb` );
	for ( const a of doc.getRoot().listAnimations() ) {
		if ( ! KEEP.test( a.getName() ) ) a.dispose();
		else a.setName( a.getName().replace( /^.*\|(Man_|Female_)?/, '' ) );
	}
	await doc.transform( prune(), dedup(), resample(), meshopt( { encoder: MeshoptEncoder, level: 'medium' } ) );
	const out = `${OUT}/${pack}/${name}.glb`;
	await io.write( out, doc );
	console.log( out, doc.getRoot().listAnimations().map( a => a.getName() ).join( ' ' ) );
}
