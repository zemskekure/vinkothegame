"""Car atlas: the owner's pictures of eight cars (side, top, front, rear each) cut off their backdrops, shrunk to
console size and packed into one 512 px image, with the cars' side outlines, for src/cars.js.

Usage: python3 tools/textures/cars.py <owner's textures folder> public/models/vehicles

The side picture gives the car its shape: its outline (top and bottom edge, column by column, simplified to a few
points) is the profile src/cars.js extrudes across the car's width. The pictures are then projected on: the side
on the sides, the top picture on everything facing up, the front and rear pictures on the ends. Every picture
shows the car with its front at the left; the top picture shows the car's right side at the top. Each car takes one
256 × 128 cell: left side and right side (the left mirrored, writing put back the right way round), top, front,
rear, and a patch of the dark underside.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert( 0, str( Path( __file__ ).parent ) )
from common import mask, bbox, bleed, shrink, simplify, paint_over, save_atlas

SRC, OUT = Path( sys.argv[ 1 ] ) / 'vehicles', Path( sys.argv[ 2 ] )

# Real dimensions (m): length, width and height (the pictures are not to scale: only their crops matter). `ground`: the
# row where the tyres meet the road in the side, front and rear pictures (measured on them). `belt`: the window sill's height
# as a share of the car's, above which the glasshouse leans in by `tumble` metres a side. `writing`: boxes [x0, y0,
# x1, y1] of lettering on the side picture, kept readable on the mirrored side. `badges`: maker's badges painted out
# ( x, y, radius ) per picture.
CARS = {
	# Škoda Fabia (1st generation, hatchback)
	'fabia': { 'ground': [ 777, 1179, 1209 ], 'height': 1.45, 'length': 3.97, 'width': 1.65, 'belt': 0.62, 'tumble': 0.14 },
	# Škoda Favorit
	'favorit': { 'ground': [ 763, 1165, 1168 ], 'height': 1.42, 'length': 3.82, 'width': 1.62, 'belt': 0.6, 'tumble': 0.12 },
	# Škoda Octavia (1st generation, liftback)
	'octavia': { 'ground': [ 691, 1165, 1190 ], 'height': 1.43, 'length': 4.51, 'width': 1.73, 'belt': 0.6, 'tumble': 0.15 },
	# A 1930s open tourer, hood folded down
	'oldtimer': { 'ground': [ 720, 1203, 1162 ], 'height': 1.62, 'length': 4.6, 'width': 1.72, 'belt': 0.7, 'tumble': 0 },
	# Octavia estate in the Czech police livery
	'police': { 'ground': [ 738, 1184, 1204 ], 'height': 1.62, 'length': 4.51, 'width': 1.73, 'belt': 0.6, 'tumble': 0.15, 'writing': [ [ 615, 415, 970, 510 ] ] },
	# Octavia estate as a Prague taxi
	'taxi': { 'ground': [ 748, 1196, 1200 ], 'height': 1.6, 'length': 4.51, 'width': 1.73, 'belt': 0.6, 'tumble': 0.15 },
	# Trabant 601
	'trabant': { 'ground': [ 756, 1150, 1176 ], 'height': 1.44, 'length': 3.56, 'width': 1.5, 'belt': 0.6, 'tumble': 0.1 },
	# A 1990s high-roof panel van
	'van': { 'ground': [ 818, 1210, 1203 ], 'height': 2.35, 'length': 4.83, 'width': 1.97, 'belt': 0.6, 'tumble': 0.08 },
}

CELL = ( 256, 128 )
SIDE = ( 128, 44 )
TOP = ( 128, 40 )
END = ( 64, 64 )
W, H = 512, 512
COLUMNS = 48


def load( name, view ):

	return Image.open( SRC / f'car_{name}_{view}.png' ).convert( 'RGB' )


def profile( m ):
	"""The outline from the side: top edge from the front (left) to the rear, then the bottom edge back, as
	[ along, up ] fractions of the car's length and height."""

	h, w = m.shape
	top, bottom = [], []
	for i in range( COLUMNS + 1 ):
		x = min( w - 1, round( i * ( w - 1 ) / COLUMNS ) )
		# A few columns' worth, so a stray pixel does not make a spike.
		col = m[ :, max( 0, x - 2 ): x + 3 ].mean( 1 ) > 0.5
		rows = np.where( col )[ 0 ]
		if not len( rows ):
			continue
		f = x / ( w - 1 )
		top.append( ( f, 1 - rows.min() / h ) )
		bottom.append( ( f, 1 - ( rows.max() + 1 ) / h ) )
	# The lowest points are the tyres on the road.
	tol = 0.006
	top = simplify( top, tol )
	bottom = simplify( bottom[ ::-1 ], tol )
	pts = top + bottom
	return [ [ round( x, 4 ), round( max( 0, y ), 4 ) ] for x, y in pts ]


def rect( x, y, w, h ):

	return [ x / W, 1 - ( y + h ) / H, ( x + w ) / W, 1 - y / H ] # u0, v0, u1, v1 (v up)


atlas = Image.new( 'RGB', ( W, H ), ( 40, 40, 42 ) )
info = { 'size': [ W, H ], 'cars': {} }

for i, ( name, spec ) in enumerate( CARS.items() ):

	ox, oy = ( i % 2 ) * CELL[ 0 ], ( i // 2 ) * CELL[ 1 ]
	entry = { k: spec[ k ] for k in ( 'length', 'width', 'height', 'belt', 'tumble' ) }

	side = paint_over( load( name, 'side' ), spec.get( 'badges', {} ).get( 'side', () ) )
	m = mask( side, ground = spec[ 'ground' ][ 0 ] )
	box = bbox( m )
	crop, cm = side.crop( box ), m[ box[ 1 ]:box[ 3 ], box[ 0 ]:box[ 2 ] ]
	entry[ 'profile' ] = profile( cm )
	left = bleed( crop, cm )
	# The right side: the left one mirrored, with any lettering put back to read the right way.
	mirrored = side.transpose( Image.FLIP_LEFT_RIGHT )
	for x0, y0, x1, y1 in spec.get( 'writing', () ):
		mirrored.paste( side.crop( ( x0, y0, x1, y1 ) ), ( side.width - x1, y0 ) )
	mm = m[ :, ::-1 ]
	mbox = [ side.width - box[ 2 ], box[ 1 ], side.width - box[ 0 ], box[ 3 ] ]
	right = bleed( mirrored.crop( mbox ), mm[ mbox[ 1 ]:mbox[ 3 ], mbox[ 0 ]:mbox[ 2 ] ] )
	atlas.paste( shrink( left, SIDE ), ( ox, oy ) )
	atlas.paste( shrink( right, SIDE ), ( ox, oy + SIDE[ 1 ] ) )
	entry[ 'left' ] = rect( ox, oy, *SIDE )
	entry[ 'right' ] = rect( ox, oy + SIDE[ 1 ], *SIDE )

	top = load( name, 'top' )
	m = mask( top, opening = 6 )
	box = bbox( m, 0.08 )
	atlas.paste( shrink( bleed( top, m ).crop( box ), TOP ), ( ox, oy + 2 * SIDE[ 1 ] ) )
	entry[ 'top' ] = rect( ox, oy + 2 * SIDE[ 1 ], *TOP )

	for k, end in enumerate( [ 'front', 'rear' ] ):
		img = paint_over( load( name, end ), spec.get( 'badges', {} ).get( end, () ) )
		m = mask( img, ground = spec[ 'ground' ][ 1 + k ] )
		box = bbox( m )
		atlas.paste( shrink( bleed( img, m ).crop( box ), END ), ( ox + 128 + k * END[ 0 ], oy ) )
		entry[ end ] = rect( ox + 128 + k * END[ 0 ], oy, *END )

	# The underside: the darkest of the front picture's lower part (tyres, the shadow under the bumper).
	atlas.paste( Image.new( 'RGB', ( 16, 16 ), ( 28, 28, 30 ) ), ( ox + 128, oy + 64 ) )
	entry[ 'under' ] = rect( ox + 130, oy + 66, 12, 12 )
	info[ 'cars' ][ name ] = entry
	print( name, 'profile points', len( entry[ 'profile' ] ) )

OUT.mkdir( parents = True, exist_ok = True )
size = save_atlas( atlas, OUT / 'car-atlas.png' )
( OUT / 'car-atlas.json' ).write_text( json.dumps( info, indent = '\t' ) )
print( 'atlas', OUT / 'car-atlas.png', size, 'bytes' )
