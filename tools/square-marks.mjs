// Mark which house front is which on a square's reference photos, so a review can't describe a facade under the
// wrong front. For every Street View photo in <work>/inventory.json it draws the start and end of each RÚIAN
// street front the camera sees (labelled <code>_<edge>), and metre ticks along the photographed front's ground
// line, counted from its left end as someone facing it reads it. The marked copies go to <work>/marked/ (outside
// git, like the photos: Street View images are reference only).
//
//   node tools/square-marks.mjs x-1_z3

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.dirname( path.dirname( fileURLToPath( import.meta.url ) ) );
const name = process.argv[ 2 ];
if ( ! /^x-?\d+_z-?\d+$/.test( name || '' ) ) {

	console.log( 'Usage: node tools/square-marks.mjs x<i>_z<j>' );
	process.exit( 1 );

}

const WORK = process.env.SQUARE_WORK || path.join( ROOT, '.square', name );
const inv = JSON.parse( await readFile( path.join( WORK, 'inventory.json' ) ) );
const PHOTOS = inv.photosDir;
const out = path.join( WORK, 'marked' );
await mkdir( out, { recursive: true } );

// The Street View camera rides about 2.5 m above the street.
const EYE = 2.5;

// Front ends in the scene frame. `mid` and `normal` are local (+x east, +z south); the front runs across the normal,
// and its left end for someone facing it is mid + (−n.z, n.x)·len/2.
const ends = f => {

	const [ nx, nz ] = f.normal, h = f.len / 2;
	const left = [ f.mid[ 0 ] - nz * h, f.mid[ 1 ] + nx * h ], right = [ f.mid[ 0 ] + nz * h, f.mid[ 1 ] - nx * h ];
	return { left, right };

};

const camera = view => {

	const p = view.pitch * Math.PI / 180, dx = - Math.sin( view.yaw ), dz = - Math.cos( view.yaw );
	const fwd = [ dx * Math.cos( p ), Math.sin( p ), dz * Math.cos( p ) ];
	const right = [ - fwd[ 2 ], 0, fwd[ 0 ] ];
	const rl = Math.hypot( ...right );
	right[ 0 ] /= rl; right[ 2 ] /= rl;
	const up = [ right[ 1 ] * fwd[ 2 ] - right[ 2 ] * fwd[ 1 ], right[ 2 ] * fwd[ 0 ] - right[ 0 ] * fwd[ 2 ], right[ 0 ] * fwd[ 1 ] - right[ 1 ] * fwd[ 0 ] ];
	const F = 320 / Math.tan( view.fov / 2 * Math.PI / 180 );
	return ( x, y, z ) => {

		const v = [ x - view.x, y - EYE, z - view.z ];
		const depth = v[ 0 ] * fwd[ 0 ] + v[ 1 ] * fwd[ 1 ] + v[ 2 ] * fwd[ 2 ];
		if ( depth < 0.3 ) return null;
		const sx = v[ 0 ] * right[ 0 ] + v[ 2 ] * right[ 2 ], sy = v[ 0 ] * up[ 0 ] + v[ 1 ] * up[ 1 ] + v[ 2 ] * up[ 2 ];
		return [ 320 + F * sx / depth, 320 - F * sy / depth ];

	};

};

const browser = await chromium.launch();
const page = await browser.newPage();
let count = 0;
for ( const f of inv.fronts ) {

	for ( const view of f.views || [] ) {

		const src = path.join( PHOTOS, view.file );
		if ( view.source !== 'Street View' || ! existsSync( src ) ) continue;
		const project = camera( view );
		const lines = [];
		for ( const g of inv.fronts ) {

			// Only fronts that face the camera.
			if ( ( view.x - g.mid[ 0 ] ) * g.normal[ 0 ] + ( view.z - g.mid[ 1 ] ) * g.normal[ 1 ] <= 0 ) continue;
			const { left, right } = ends( g );
			const target = g.front === f.front;
			for ( const [ end, label ] of [ [ left, `◂ ${g.front}` ], [ right, `${g.front} ▸` ] ] ) {

				const a = project( end[ 0 ], 0, end[ 1 ] ), b = project( end[ 0 ], 14, end[ 1 ] );
				if ( a && b ) lines.push( { a, b, label, target, side: label.startsWith( '◂' ) ? 'left' : 'right' } );

			}

		}

		// Metre ticks on the photographed front's ground line.
		const ticks = [];
		const { left, right } = ends( f );
		for ( let u = 0; u <= f.len + 1e-6; u ++ ) {

			const t = u / f.len, x = left[ 0 ] + ( right[ 0 ] - left[ 0 ] ) * t, z = left[ 1 ] + ( right[ 1 ] - left[ 1 ] ) * t;
			const a = project( x, 0, z ), b = project( x, 0.6, z );
			if ( a && b ) ticks.push( { a, b, u } );

		}

		const data = ( await readFile( src ) ).toString( 'base64' );
		const jpg = await page.evaluate( async ( { data, lines, ticks } ) => {

			const img = new Image();
			img.src = `data:image/jpeg;base64,${data}`;
			await img.decode();
			const c = document.createElement( 'canvas' );
			c.width = img.width; c.height = img.height;
			const g = c.getContext( '2d' );
			g.drawImage( img, 0, 0 );
			g.font = 'bold 13px sans-serif';
			g.lineWidth = 2;
			for ( const l of lines ) {

				g.strokeStyle = l.target ? '#ffde00' : '#00e0ff';
				g.beginPath(); g.moveTo( ...l.a ); g.lineTo( ...l.b ); g.stroke();
				const y = Math.max( 16, Math.min( c.height - 6, l.target ? l.a[ 1 ] - 40 : l.a[ 1 ] - 90 ) );
				const w = g.measureText( l.label ).width;
				const x = l.side === 'left' ? l.a[ 0 ] + 3 : l.a[ 0 ] - w - 3;
				g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect( x - 2, y - 13, w + 4, 17 );
				g.fillStyle = l.target ? '#ffde00' : '#00e0ff'; g.fillText( l.label, x, y );

			}

			g.strokeStyle = '#ffde00';
			for ( const t of ticks ) {

				g.beginPath(); g.moveTo( ...t.a ); g.lineTo( ...t.b ); g.stroke();
				if ( t.u % 2 === 0 ) { g.fillStyle = '#ffde00'; g.fillText( String( t.u ), t.b[ 0 ] + 2, t.b[ 1 ] ); }

			}

			return c.toDataURL( 'image/jpeg', 0.85 ).split( ',' )[ 1 ];

		}, { data, lines, ticks } );
		await writeFile( path.join( out, view.file ), Buffer.from( jpg, 'base64' ) );
		count ++;

	}

}

await browser.close();
console.log( `${count} photos marked in ${out}` );
