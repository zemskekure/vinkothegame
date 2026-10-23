// Shop and café name boards from OpenStreetMap (see tools/build-scene.mjs, `signs`): every name is drawn once into
// a canvas atlas and shown on an instanced board mounted over the shop window, coloured by the kind of place.

import * as THREE from 'three/webgpu';
import { texture, uv, attribute } from 'three/tsl';

const ATLAS_W = 2048, ATLAS_H = 4096, SLOT_W = 256, SLOT_H = 40;
const COLS = ATLAS_W / SLOT_W, ROWS = ATLAS_H / SLOT_H;
const BOARD_H = 0.5;

// [ board, lettering, font ]
const SERIF = 'Georgia, "Times New Roman", serif', SANS = 'system-ui, "Helvetica Neue", Arial, sans-serif';
const KINDS = {
	cafe: [ '#3b2416', '#f0dcb0', SERIF ],
	restaurant: [ '#1f3a2c', '#e6c46a', SERIF ],
	pub: [ '#151413', '#d9b25a', SERIF ],
	bar: [ '#151413', '#d9b25a', SANS ],
	nightclub: [ '#151413', '#e86ad0', SANS ],
	fast_food: [ '#8f1e1e', '#ffffff', SANS ],
	ice_cream: [ '#f3d7e0', '#7a2340', SANS ],
	pharmacy: [ '#1f7a3a', '#ffffff', SANS ],
	bank: [ '#0d2a52', '#ffffff', SANS ],
	bureau_de_change: [ '#e2b822', '#1a1a1a', SANS ],
	hotel: [ '#2a2440', '#e3c98a', SERIF ],
	theatre: [ '#5a1420', '#f2d79a', SERIF ],
	cinema: [ '#5a1420', '#f2d79a', SANS ]
};
const SHOP_STYLES = [
	[ '#111111', '#ffffff', SANS ], [ '#f3efe6', '#222222', SERIF ], [ '#6b1d2a', '#f0d9a0', SERIF ],
	[ '#24364a', '#ffffff', SANS ], [ '#2d4a3a', '#f3e7c8', SERIF ], [ '#e9e4d8', '#7a1f1f', SANS ]
];

const hash = s => [ ...s ].reduce( ( h, ch ) => Math.imul( h ^ ch.charCodeAt( 0 ), 16777619 ) >>> 0, 2166136261 );

export function addSigns( scene, signs, renderer ) {

	const list = signs.slice( 0, COLS * ROWS );
	if ( ! list.length ) return;

	const canvas = document.createElement( 'canvas' );
	canvas.width = ATLAS_W;
	canvas.height = ATLAS_H;
	const ctx = canvas.getContext( '2d' );
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	const plane = new THREE.PlaneGeometry( 1, 1 );
	const rects = new Float32Array( list.length * 4 );

	list.forEach( ( sign, i ) => {

		const [ board, ink, font ] = KINDS[ sign.kind ] || SHOP_STYLES[ hash( sign.name ) % SHOP_STYLES.length ];
		const x = ( i % COLS ) * SLOT_W, y = Math.floor( i / COLS ) * SLOT_H;
		const w = Math.min( SLOT_W, Math.round( SLOT_H * sign.w / BOARD_H ) ); // keep the board's proportions
		ctx.fillStyle = board;
		ctx.fillRect( x, y, w, SLOT_H );
		ctx.strokeStyle = ink;
		ctx.globalAlpha = 0.5;
		ctx.lineWidth = 1.5;
		ctx.strokeRect( x + 3, y + 3, w - 6, SLOT_H - 6 );
		ctx.globalAlpha = 1;
		ctx.fillStyle = ink;
		let size = 24;
		do {

			ctx.font = `600 ${size}px ${font}`;
			size --;

		} while ( ctx.measureText( sign.name ).width > w - 14 && size > 9 );
		ctx.fillText( sign.name, x + w / 2, y + SLOT_H / 2 + 1 );

		// UV rectangle of this slot (canvas textures are flipped: v runs bottom-up).
		rects.set( [ x / ATLAS_W, 1 - ( y + SLOT_H ) / ATLAS_H, w / ATLAS_W, SLOT_H / ATLAS_H ], i * 4 );

	} );

	const atlas = new THREE.CanvasTexture( canvas );
	atlas.colorSpace = THREE.SRGBColorSpace;
	atlas.anisotropy = renderer.getMaxAnisotropy();

	plane.setAttribute( 'signRect', new THREE.InstancedBufferAttribute( rects, 4 ) );
	const rect = attribute( 'signRect', 'vec4' );
	const lettering = new THREE.MeshStandardNodeMaterial( { roughness: 0.6 } );
	lettering.colorNode = texture( atlas, uv().mul( rect.zw ).add( rect.xy ) );
	lettering.emissiveNode = lettering.colorNode.mul( 0.08 );

	const boards = new THREE.InstancedMesh( plane, lettering, list.length );
	const backs = new THREE.InstancedMesh( new THREE.BoxGeometry( 1, 1, 1 ).translate( 0, 0, - 0.5 ),
		new THREE.MeshStandardNodeMaterial( { color: 0x1d1b19, roughness: 0.7, metalness: 0.3 } ), list.length );

	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
	const up = new THREE.Vector3( 0, 1, 0 );
	list.forEach( ( sign, i ) => {

		q.setFromAxisAngle( up, sign.rot );
		boards.setMatrixAt( i, m.compose( p.set( sign.x, sign.y, sign.z ).add( new THREE.Vector3( Math.sin( sign.rot ), 0, Math.cos( sign.rot ) ).multiplyScalar( 0.065 ) ), q, s.set( sign.w, BOARD_H, 1 ) ) );
		backs.setMatrixAt( i, m.compose( p.set( sign.x, sign.y, sign.z ).add( new THREE.Vector3( Math.sin( sign.rot ), 0, Math.cos( sign.rot ) ).multiplyScalar( 0.06 ) ), q, s.set( sign.w + 0.08, BOARD_H + 0.08, 0.06 ) ) );

	} );

	boards.castShadow = backs.castShadow = true;
	boards.receiveShadow = true;
	scene.add( boards, backs );

}
