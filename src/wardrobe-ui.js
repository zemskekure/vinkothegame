// What the studio (?studio, src/studio.js) and the player's character creator (src/creator.js) share when a person
// is dressed by hand: the names of the shape knobs and wardrobe categories, and the bodies loaded once each.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BODIES, prepareBody } from './people.js';

// The shape knobs (src/people.js SHAPE) in Czech.
export const SHAPE_NAMES = { fat: 'Tloušťka', belly: 'Břicho', hips: 'Boky', head: 'Hlava', hunch: 'Shrbení', shoulders: 'Ramena', legs: 'Nohy (délka)', torso: 'Trup (délka)', arms: 'Ruce (délka)', neck: 'Krk', tilt: 'Nakřivo', lumps: 'Hrbolatost' };

// Wardrobe categories: [ key in the spec, label, kind of tile, garment part, label of "no texture" ].
export const CATS = [
	[ 'face', 'Tvář', 'faces', null, null ],
	[ 'hair', 'Vlasy (zadní a horní strany hlavy)', 'heads', null, 'z tváře' ],
	[ 'top', 'Nahoře', 'clothes', 'top', 'barva' ],
	[ 'bottom', 'Dole', 'clothes', 'bottom', 'barva' ],
	[ 'skin', 'Kůže', 'skin', null, 'z tváře' ]
];

// The bodies by folder (who) and by file (what they wear).
export const BODY_DIRS = { 'animated-men': 'muž', 'animated-women': 'žena', 'modular-men': 'muž (modular)', 'modular-women': 'žena (modular)' };
export const BODY_CLOTHES = {
	longsleeve: 'dlouhý rukáv', shirt: 'košile', casual: 'na běžno', suit: 'oblek', jacket: 'bunda', tanktop: 'tílko',
	dress: 'šaty', business: 'kancl', hoodie: 'mikina', worker: 'montérky', punk: 'pankáč', beach: 'k vodě',
	adventurer: 'na výlet', farmer: 'na zahradu', formal: 'do divadla'
};

// The wardrobe tiles a category offers (all of them: the art direction's exclusions are for the streets only).
export const tilesFor = ( wardrobe, kind, part ) => wardrobe.tiles[ kind ].filter( t => ! part || ! t.part || t.part === part );

// A thumbnail's address.
export const tileUrl = ( t, kind ) => `models/people/${t.dir || kind}/${t.file}`;

// Prepared bodies (src/people.js prepareBody), each file fetched once; `fresh` prepares it again (after the art
// direction changed the heads).
export function bodyLoader() {

	const gltfLoader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
	const buffers = new Map(), cache = new Map();
	const load = async file => {

		if ( ! cache.has( file ) ) cache.set( file, ( async () => {

			if ( ! buffers.has( file ) ) buffers.set( file, fetch( `models/people/${file}.glb` ).then( r => r.arrayBuffer() ) );
			const spec = BODIES.find( b => b.file === file );
			return prepareBody( await gltfLoader.parseAsync( ( await buffers.get( file ) ).slice( 0 ), 'models/people/' ), spec );

		} )() );
		return cache.get( file );

	};

	load.clear = () => cache.clear();
	return load;

}
