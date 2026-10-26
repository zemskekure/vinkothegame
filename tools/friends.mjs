// Puts the owner's friends into the game (src/friends.js) from a folder of their faces, without ever putting their
// photos into the repository (it is public).
//
//   node tools/friends.mjs [faces folder]        default: ../private/realfaces (next to the repository)
//
// The folder holds one face per friend, `<Name>.jpg`, already cropped as the game's faces are (square, 128 × 128,
// the face filling it; a `<Name>@256.jpg` beside it is ignored). Each is copied to public/models/people/friends/
// (gitignored) under a plain file name, and public/models/people/friends/friends.json lists them:
//
//   { "friends": [ { "name": "Pepa", "file": "pepa.jpg", "sex": "m", "lines": [ "…" ], "spots": [ "pub" ] } ] }
//
// Edit that file to change what they say (`lines`, one is picked each time one comes up to them), where they are
// (`spots`: "pub" for a place at their table in Hostinec U Rotundy, "kampa", "betlem", "divadlo" (src/friends.js
// SPOTS), or { "x": …, "z": …, "yaw": …, "pose": "stand" | "bench" } in the scene frame, `?at=x,z` shows it), `sex`
// ("m" / "f") or `seed` (another number deals them another body and clothes). Running this again adds new faces and
// keeps what is already in friends.json. The production build (`npm run build`) copies the folder into dist/ when it
// is there; without it the game simply has no friends.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const src = path.resolve( process.argv[ 2 ] || path.join( root, '..', 'private', 'realfaces' ) );
const out = path.join( root, 'public', 'models', 'people', 'friends' );

if ( ! fs.existsSync( src ) ) {

	console.error( `No faces folder at ${src}` );
	process.exit( 1 );

}

// A file name without accents or spaces ("Pan Novák" → pan-novak.jpg).
const slug = name => name.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

// Placeholder lines, dealt round, until the owner writes theirs.
const LINES = [
	[ 'Jedno malý. Teda velký.', 'Já tu jen čekám.' ],
	[ 'Tady to bejvalo lepší. Teda stejný.', 'Ahoj.' ],
	[ 'Já jsem jen na jedno.', 'Dneska ne. Možná.' ],
	[ 'Holub? Ten tu byl před tebou.', 'Zdravím.' ],
	[ 'Zítra začínám běhat.', 'Nevíš, kolik je hodin?' ],
	[ 'Platím příští kolo.', 'Hezky, co?' ],
	[ 'Vltava teče pořád stejným směrem. Všiml sis?', 'Čau.' ]
];

fs.mkdirSync( out, { recursive: true } );
const listFile = path.join( out, 'friends.json' );
const list = fs.existsSync( listFile ) ? JSON.parse( fs.readFileSync( listFile, 'utf8' ) ) : { friends: [] };

let added = 0;
for ( const file of fs.readdirSync( src ).sort() ) {

	if ( ! /\.jpe?g$/i.test( file ) || file.includes( '@' ) ) continue;
	const name = file.replace( /\.jpe?g$/i, '' ).normalize( 'NFC' ), target = slug( name ) + '.jpg';
	fs.copyFileSync( path.join( src, file ), path.join( out, target ) );
	if ( list.friends.some( f => f.name === name ) ) continue;
	list.friends.push( { name, file: target, sex: 'm', lines: LINES[ list.friends.length % LINES.length ], spots: [ 'pub' ] } );
	added ++;

}

fs.writeFileSync( listFile, JSON.stringify( list, null, '\t' ) + '\n' );
console.log( `${list.friends.length} friends in ${path.relative( root, listFile )} (${added} new)` );
