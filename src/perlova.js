// Perlová: the short street between Národní and Na Perštýně (Staré Město) known for the women who stand there for
// trade. A few women stand on the pavement by the house walls, idle, as other people stand about: no interaction
// beyond any other passer-by's. More of them in the evening and at night, one by day. The game settings switch them
// off (`world.perlova`, also on the admin page).
//
// The places are on the two pavement lines of Perlová (life.json walking lines), stepped out to just short of the
// house fronts (checked against the walk barriers), each facing across the street.

import { BODIES } from './people.js';
import { generatePerson, lookOf } from './persona.js';
import { figure, figures, nameSeed } from './friends.js';

// x, z (scene frame), the way she faces (yaw: (sin, cos)), her body and clothes (wardrobe textures; colours sRGB).
const WOMEN = [
	{ x: 221.3, z: 180.9, yaw: 2.18, body: 'animated-women/dress', top: 'leopard_print.jpg', colour: [ 0x1d1d20, 0x1a1a1c ] },
	{ x: 231.9, z: 177.2, yaw: - 0.96, body: 'animated-women/jacket', top: 'pink_anorak_nylon.jpg', colour: [ 0xd49aa4, 0x1a1a1c ] },
	{ x: 205.8, z: 159.0, yaw: 2.18, body: 'animated-women/tanktop', top: '', colour: [ 0xa33a32, 0x1a1a1c ] },
	{ x: 216.7, z: 155.3, yaw: - 0.96, body: 'animated-women/casual', top: 'leopard_print.jpg', colour: [ 0x1d1d20, 0x6b2230 ] }
];

// How many stand there at an hour of the day (on foot the clock stands at the game's evening).
export function perlovaCount( hour ) {

	if ( hour === null || hour === undefined ) return 3;
	const h = ( ( hour % 24 ) + 24 ) % 24;
	if ( h >= 21 || h < 5 ) return 4;
	if ( h >= 18 || h < 7 ) return 3;
	return 1;

}

export function addPerlova( scene, { wardrobe, bodies, rules, groundHeight, camera, hour } ) {

	const list = [];
	WOMEN.forEach( ( w, i ) => {

		const k = BODIES.findIndex( b => b.file === w.body );
		if ( k < 0 || ! bodies[ k ] ) return;
		const spec = generatePerson( rules, nameSeed( 'Perlová ' + i ), wardrobe, { sitting: true, sex: 'f' } );
		spec.body = w.body;
		const has = file => wardrobe.tiles.clothes.some( t => t.file === file );
		spec.top = w.top && has( w.top ) ? w.top : '';
		spec.bottom = '';
		spec.colour = w.colour;
		list.push( figure( bodies[ k ], spec, lookOf( spec, wardrobe ), { x: w.x, y: groundHeight( w.x, w.z ), z: w.z, yaw: w.yaw } ) );

	} );

	const drawn = figures( scene, list, camera );
	return {
		list,
		off: false, // the admin page's switch, live
		update( dt ) {

			const n = this.off ? 0 : perlovaCount( hour?.() );
			list.forEach( ( f, i ) => f.hidden = i >= n );
			drawn.update( dt );

		}
	};

}
