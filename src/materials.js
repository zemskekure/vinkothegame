import * as THREE from 'three/webgpu';
import {
	attribute, positionWorld, normalWorld, texture, vec2, vec3, float, floor, fract, fwidth,
	smoothstep, mix, max, mx_noise_float
} from 'three/tsl';

// Aerial photo draped over the scene by world position (x east, z south).
export function orthoUV( bounds ) {

	const { minX, maxX, minZ, maxZ } = bounds;
	return vec2(
		positionWorld.x.sub( minX ).div( maxX - minX ),
		float( 1 ).sub( positionWorld.z.sub( minZ ).div( maxZ - minZ ) )
	);

}

export function createRoofMaterial( ortho, bounds ) {

	const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.8 } );
	// Steep DSM faces (roof edges falling to the street) would smear the photo; paint them as plaster.
	const steep = smoothstep( 0.6, 0.3, normalWorld.y );
	material.colorNode = mix( texture( ortho, orthoUV( bounds ) ), vec3( 0.62, 0.55, 0.45 ), steep );
	return material;

}

export function createGroundMaterial( ortho, bounds ) {

	const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.95 } );
	const photo = texture( ortho, orthoUV( bounds ) );

	// Cobblestone hint at walking distance: small cells modulating the photo.
	const p = positionWorld.xz.mul( 6.0 );
	const cell = fract( p ).sub( 0.5 ).abs();
	const w = fwidth( p.x ).mul( 1.5 );
	const joints = smoothstep( float( 0.5 ).sub( w ).sub( 0.06 ), float( 0.5 ).sub( w ), max( cell.x, cell.y ) );
	const stoneNoise = mx_noise_float( floor( p ).mul( 0.73 ) ).mul( 0.12 );
	const detail = float( 1 ).sub( joints.mul( 0.22 ) ).add( stoneNoise );
	const fade = smoothstep( 1.2, 0.4, w ); // only where the cells are resolvable
	material.colorNode = photo.mul( mix( float( 1 ), detail, fade ) );
	return material;

}

// Box mask with filter-width antialiasing.
const band = ( p, lo, hi ) => {

	const w = fwidth( p ).mul( 0.75 ).add( 1e-4 );
	return smoothstep( float( lo ).sub( w ), float( lo ).add( w ), p )
		.mul( float( 1 ).sub( smoothstep( float( hi ).sub( w ), float( hi ).add( w ), p ) ) );

};

// Procedural Prague facade: plaster in the building's colour, window bays per storey,
// cornice bands, shop openings on the ground floor. Party walls stay plain.
export function createWallMaterial() {

	const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } );

	const u = attribute( 'wallU', 'float' );
	const base = attribute( 'wallBase', 'float' );
	const floorH = attribute( 'floorH', 'float' );
	const seed = attribute( 'seed', 'float' );
	const party = attribute( 'party', 'float' );
	const plaster = attribute( 'plaster', 'vec3' );

	const h = positionWorld.y.sub( base );
	const storey = h.div( floorH );
	const level = floor( storey );
	const fy = fract( storey );

	const bayWidth = float( 2.9 ).add( seed.mul( 0.9 ) );
	const bx = fract( u.div( bayWidth ) );

	const upper = level.greaterThanEqual( 1 ).select( 1.0, 0.0 );
	const windowHole = band( bx, 0.33, 0.67 ).mul( band( fy, 0.24, 0.8 ) ).mul( upper );
	const shop = band( bx, 0.18, 0.82 ).mul( band( storey, 0.04, 0.78 ) ).mul( float( 1 ).sub( upper ) );
	const frame = band( bx, 0.3, 0.7 ).mul( band( fy, 0.2, 0.84 ) ).mul( upper ).sub( windowHole ).max( 0 );
	const sash = band( bx, 0.495, 0.505 ).add( band( fy, 0.5, 0.52 ) ).min( 1 ).mul( windowHole );

	const cornice = band( fy, 0.0, 0.05 ).mul( upper ).add( band( storey, 0.96, 1.08 ) );
	const notParty = float( 1 ).sub( party );

	const grime = mx_noise_float( positionWorld.mul( vec3( 0.35, 0.9, 0.35 ) ) ).mul( 0.06 )
		.add( smoothstep( 1.6, 0.0, h ).mul( - 0.12 ) );

	const wallColor = plaster.mul( 0.82 ).mul( float( 1 ).add( grime ) ).mul( party.mul( - 0.12 ).add( 1 ) );
	const corniceColor = plaster.mul( 1.12 ).min( 1 );
	const glass = vec3( 0.08, 0.1, 0.12 ).add( mx_noise_float( vec3( floor( u.div( bayWidth ) ), level, seed.mul( 50 ) ) ).mul( 0.04 ) );
	const frameColor = vec3( 0.9, 0.88, 0.82 );
	const shopColor = vec3( 0.07, 0.07, 0.08 );

	let color = mix( wallColor, corniceColor, cornice.mul( notParty ).mul( 0.8 ) );
	color = mix( color, frameColor, frame.mul( notParty ) );
	color = mix( color, glass, windowHole.mul( notParty ) );
	color = mix( color, frameColor.mul( 0.8 ), sash.mul( notParty ) );
	color = mix( color, shopColor, shop.mul( notParty ) );
	material.colorNode = color;

	const glassMask = windowHole.add( shop ).mul( notParty ).min( 1 ).sub( sash ).max( 0 );
	material.roughnessNode = mix( float( 0.92 ), float( 0.12 ), glassMask );
	material.metalnessNode = glassMask.mul( 0.3 );

	return material;

}

// Muted Prague facade palette: ochres, creams, pinks, greys, pale greens.
export const PLASTER = [
	0xe9d6a8, 0xf0e4c8, 0xe7c48b, 0xd9b38c, 0xeee9df, 0xe3c9b8, 0xd4a98a,
	0xcfd6c4, 0xf2dfb4, 0xd8cfc0, 0xe6d3c2, 0xc9b79a, 0xeedcc4, 0xb9c4c9
];

export function createWaterMaterial() {

	const material = new THREE.MeshStandardNodeMaterial( { roughness: 0.08, metalness: 0.2 } );
	const ripple = mx_noise_float( vec3( positionWorld.xz.mul( 0.15 ), 0 ) );
	material.colorNode = vec3( 0.12, 0.17, 0.17 ).add( ripple.mul( 0.02 ) );
	return material;

}
