"""Boat atlas: the owner's pictures of the Vltava's boats (side and top each) shrunk to console size and packed into
one 512 px image, with each boat's side outline and its width along its length, for src/boats.js.

Usage: python3 tools/textures/boats.py ~/Documents/ChatGPT/PRAGA/textures public/models/vehicles

The boats float on textured water, which cannot be told from the boat by colour as the cars' plain wall can, so the
side outlines were traced by hand: `outline` points measured on the side picture shrunk to 1500 px wide (bow at the
left; the last points run along the waterline). The top pictures lie on dark water and are cut out by colour; their
outline gives the boat's width along its length (`plan`). `deck`: the height of the hull's gunwale or deck as a share
of the boat's height above the water; above it (cabins, seats, the swan's neck) the boat is narrower, `upper` of the
hull's width at that point along the boat ( [ along, share ] stops, bow 0, stern 1 ).
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert( 0, str( Path( __file__ ).parent ) )
from common import mask, bbox, bleed, shrink, save_atlas

SRC, OUT = Path( sys.argv[ 1 ] ) / 'vehicles', Path( sys.argv[ 2 ] )

BOATS = {
	# The paddle steamer moored on Smetanovo nábřeží (Prague's are 55–60 m over all, 12 m over the paddle boxes).
	'steamer': {
		'length': 56, 'width': 11, 'height': 10.5, 'deck': 0.27, 'upper': [ [ 0, 0.62 ], [ 1, 0.62 ] ],
		'outline': [ ( 40, 290 ), ( 230, 290 ), ( 232, 248 ), ( 615, 248 ), ( 620, 226 ), ( 718, 226 ), ( 720, 170 ), ( 826, 170 ), ( 828, 226 ),
			( 858, 226 ), ( 860, 80 ), ( 897, 80 ), ( 899, 226 ), ( 1038, 226 ), ( 1040, 200 ), ( 1360, 200 ), ( 1362, 226 ), ( 1410, 226 ),
			( 1412, 290 ), ( 1455, 290 ), ( 1455, 362 ), ( 40, 362 ) ],
		'top': 'boat_steamer_top.png', 'size': ( 512, 72 ),
	},
	# A glass-roofed sightseeing boat, about 45 m.
	'tourboat': {
		'length': 45, 'width': 6.6, 'height': 4.6, 'deck': 0.36, 'upper': [ [ 0, 0.5 ], [ 0.08, 0.92 ], [ 1, 0.92 ] ],
		'outline': [ ( 35, 270 ), ( 145, 270 ), ( 160, 235 ), ( 178, 205 ), ( 290, 195 ), ( 330, 188 ), ( 1290, 188 ), ( 1355, 212 ),
			( 1360, 240 ), ( 1450, 240 ), ( 1452, 290 ), ( 1468, 300 ), ( 1468, 320 ), ( 1450, 335 ), ( 70, 335 ), ( 50, 320 ) ],
		'size': ( 512, 64 ),
	},
	# The pedal boats hired out at Slovanský ostrov: a blue hull, white seats, the paddle wheel's hump.
	'pedalo': {
		'length': 4.0, 'width': 1.85, 'height': 1.05, 'deck': 0.55, 'upper': [ [ 0, 0.85 ], [ 1, 0.85 ] ],
		'outline': [ ( 32, 265 ), ( 48, 232 ), ( 355, 225 ), ( 400, 150 ), ( 470, 135 ), ( 545, 140 ), ( 600, 195 ), ( 630, 190 ), ( 775, 190 ),
			( 800, 103 ), ( 830, 130 ), ( 838, 225 ), ( 990, 190 ), ( 1135, 190 ), ( 1160, 98 ), ( 1190, 120 ), ( 1200, 215 ), ( 1445, 215 ),
			( 1465, 290 ), ( 1440, 385 ), ( 105, 385 ) ],
		'size': ( 256, 80 ),
	},
	# A wooden rowing boat, open: the top picture shows its benches and floor boards.
	'rowboat': {
		'length': 3.6, 'width': 1.3, 'height': 0.55, 'deck': 1, 'upper': [ [ 0, 1 ], [ 1, 1 ] ],
		'outline': [ ( 28, 145 ), ( 70, 158 ), ( 1440, 175 ), ( 1470, 182 ), ( 1475, 215 ), ( 1455, 345 ), ( 150, 345 ), ( 70, 250 ) ],
		'size': ( 256, 64 ),
	},
	# The swan pedal boat: the neck rises from the bow, narrow.
	'swan': {
		'length': 2.9, 'width': 1.6, 'height': 1.95, 'deck': 0.34, 'upper': [ [ 0, 0.3 ], [ 0.17, 0.3 ], [ 0.21, 0.85 ], [ 1, 0.85 ] ],
		'outline': [ ( 80, 415 ), ( 100, 380 ), ( 150, 300 ), ( 205, 205 ), ( 230, 150 ), ( 105, 130 ), ( 160, 95 ), ( 250, 25 ), ( 300, 25 ),
			( 335, 60 ), ( 345, 250 ), ( 400, 360 ), ( 420, 330 ), ( 640, 320 ), ( 700, 330 ), ( 760, 265 ), ( 800, 345 ), ( 950, 345 ),
			( 990, 260 ), ( 1050, 300 ), ( 1060, 345 ), ( 1300, 340 ), ( 1440, 285 ), ( 1455, 330 ), ( 1455, 420 ), ( 1415, 520 ), ( 100, 520 ) ],
		'size': ( 256, 96 ),
	},
}

W = 512
PLAN = 24

# Where each boat's two pictures go: side above top, boats side by side in shelves; the atlas as tall as that.
layout, x, y, row = {}, 0, 0, 0
for name, spec in BOATS.items():
	sw, sh = spec[ 'size' ]
	if x + sw > W:
		x, y, row = 0, y + row, 0
	layout[ name ] = ( x, y )
	x += sw
	row = max( row, 2 * sh )
H = y + row


def rect( x, y, w, h ):

	return [ x / W, 1 - ( y + h ) / H, ( x + w ) / W, 1 - y / H ]


atlas = Image.new( 'RGB', ( W, H ), ( 40, 52, 58 ) )
info = { 'size': [ W, H ], 'boats': {} }
for name, spec in BOATS.items():

	side = Image.open( SRC / f'boat_{name}_side.png' ).convert( 'RGB' )
	s = side.width / 1500
	pts = [ ( px * s, py * s ) for px, py in spec[ 'outline' ] ]
	xs, ys = [ p[ 0 ] for p in pts ], [ p[ 1 ] for p in pts ]
	box = [ int( min( xs ) ), int( min( ys ) ), int( max( xs ) ) + 1, int( max( ys ) ) + 1 ]
	m = Image.new( 'L', side.size, 0 )
	ImageDraw.Draw( m ).polygon( pts, fill = 255 )
	m = np.asarray( m ) > 0
	crop = bleed( side, m ).crop( box )
	bw, bh = box[ 2 ] - box[ 0 ], box[ 3 ] - box[ 1 ]
	profile = [ [ round( ( px - box[ 0 ] ) / bw, 4 ), round( 1 - ( py - box[ 1 ] ) / bh, 4 ) ] for px, py in pts ]

	top = Image.open( SRC / spec.get( 'top', f'boat_{name}_top.png' ) ).convert( 'RGB' )
	tm = mask( top, tol = 45, opening = 4 )
	tbox = bbox( tm, 0.02 )
	tm = tm[ tbox[ 1 ]:tbox[ 3 ], tbox[ 0 ]:tbox[ 2 ] ]
	plan = []
	for i in range( PLAN + 1 ):
		cx = min( tm.shape[ 1 ] - 1, round( i * ( tm.shape[ 1 ] - 1 ) / PLAN ) )
		rows = np.where( tm[ :, max( 0, cx - 3 ): cx + 4 ].mean( 1 ) > 0.5 )[ 0 ]
		plan.append( [ round( i / PLAN, 4 ), round( ( rows.max() - rows.min() + 1 ) / tm.shape[ 0 ] if len( rows ) else 0.05, 4 ) ] )

	sw, sh = spec[ 'size' ]
	x, y = layout[ name ]
	atlas.paste( shrink( crop, ( sw, sh ) ), ( x, y ) )
	atlas.paste( shrink( bleed( top, mask( top, tol = 45, opening = 4 ) ).crop( tbox ), ( sw, sh ) ), ( x, y + sh ) )
	info[ 'boats' ][ name ] = { k: spec[ k ] for k in ( 'length', 'width', 'height', 'deck', 'upper' ) } | {
		'profile': profile, 'plan': plan, 'left': rect( x, y, sw, sh ), 'top': rect( x, y + sh, sw, sh ) }
	print( name, 'profile', len( profile ), 'plan', [ p[ 1 ] for p in plan ][ ::4 ] )

OUT.mkdir( parents = True, exist_ok = True )
size = save_atlas( atlas, OUT / 'boat-atlas.png' )
( OUT / 'boat-atlas.json' ).write_text( json.dumps( info, indent = '\t' ) )
print( 'atlas', OUT / 'boat-atlas.png', size, 'bytes' )
