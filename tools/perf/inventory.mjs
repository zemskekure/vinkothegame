// What the scene is made of: meshes, triangles and shadow casters grouped by where they come from, in real Chrome.
//
//   node tools/perf/inventory.mjs <url>

import { launch } from './browser.mjs';

const [ url ] = process.argv.slice( 2 );
const browser = await launch();
const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
await page.goto( url, { timeout: 600000 } );
await page.waitForFunction( () => window.__ready, null, { timeout: 600000 } );
await page.waitForTimeout( 5000 );
const rows = await page.evaluate( () => {

	const { scene } = window.__debug;
	const groups = new Map();
	const key = o => {

		let p = o;
		while ( p.parent && p.parent !== scene ) p = p.parent;
		return ( p.name || p.type ) + ( p === o ? '' : '/' + ( o.type ) );

	};
	scene.traverse( o => {

		if ( ! o.isMesh && ! o.isLine && ! o.isPoints ) return;
		const g = o.geometry, idx = g.index ? g.index.count : g.attributes.position?.count || 0;
		const inst = o.isInstancedMesh ? o.count : 1;
		const big = idx / 3 * inst > 20000;
		const k = key( o ) + ( o.isInstancedMesh ? ' inst' : '' ) + ( o.isSkinnedMesh ? ' skinned' : '' ) + ( big ? ` #${o.id} ${o.material?.type} [${Object.keys( g.attributes ).join( ',' )}] ${inst > 1 ? inst + 'x' + ( idx / 3 | 0 ) : ''}` : '' );
		const r = groups.get( k ) || { meshes: 0, ktris: 0, shadowKtris: 0, visible: 0, verts: 0 };
		r.meshes ++;
		r.visible += o.visible ? 1 : 0;
		r.ktris += idx / 3 * inst / 1000;
		r.verts += ( g.attributes.position?.count || 0 ) / 1000;
		if ( o.castShadow ) r.shadowKtris += idx / 3 * inst / 1000;
		groups.set( k, r );

	} );
	return [ ...groups ].sort( ( a, b ) => b[ 1 ].ktris - a[ 1 ].ktris ).slice( 0, 60 ).map( ( [ k, r ] ) => `${k.padEnd( 40 )} meshes ${String( r.meshes ).padStart( 5 )} vis ${String( r.visible ).padStart( 5 )} ktris ${r.ktris.toFixed( 0 ).padStart( 6 )} shadow ${r.shadowKtris.toFixed( 0 ).padStart( 6 )} kverts ${r.verts.toFixed( 0 )}` );

} );
console.log( rows.join( '\n' ) );
await browser.close();
