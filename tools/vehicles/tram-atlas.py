"""Tram texture atlas: the owner's drawn tram pictures (sides, ends, roofs, pantograph) cut out, shrunk to
console size and packed into one 1024 px image, with a JSON of where everything is, for src/trams.js.

Usage: python3 tools/vehicles/tram-atlas.py <folder of tram_*.png> public/models/vehicles

Each picture is cropped to the tram (rectangles measured on the pictures; they are not to scale, so only the
crops matter), the plain backdrop around it is made transparent (backdrop-coloured pixels connected to the
crop's edge: the sky above the roof's rounded edges, the gaps between the bogies), maker's badges are painted
over, and the result is resized. The long side pictures are later cut into the articulated sections at the
middle of each joint (`joints`, fractions of the side measured from the front end).
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])

# Crops [x0, y0, x1, y1] in the source pictures. Side pictures: the right side shows the front at the left, the left
# side the front at the right; roofs (seen from above and a little to one side) the front at the left. `joints`: middles of the joints from the front end, per side.
TYPES = {
	'15t': {
		'roof': [55, 211, 2147, 403],
		'side_right': [18, 269, 2140, 565], 'side_left': [26, 272, 2140, 530],
		'front': [370, 30, 880, 650], 'rear': [750, 690, 1126, 1150],
		'joints': { 'right': [ 0.375, 0.677 ], 'left': [ 0.3305, 0.6715 ] },
		'badges': { 'front': [ ( 624, 486, 22 ) ], 'rear': [ ( 940, 1044, 18 ) ] },
	},
	't3': {
		'roof': [87, 148, 2104, 508],
		'side_right': [36, 226, 2130, 662], 'side_left': [32, 197, 2137, 670],
		'front': [200, 170, 1044, 1190], 'rear': [156, 144, 1096, 1190],
		'joints': { 'right': [], 'left': [] },
	},
	'kt8': {
		'roof': [76, 231, 2104, 438],
		'side_right': [31, 297, 2135, 555], 'side_left': [50, 269, 2123, 553],
		'front': [182, 110, 1072, 1196], 'rear': [164, 96, 1090, 1176],
		'joints': { 'right': [ 0.353, 0.6505 ], 'left': [ 0.3485, 0.6575 ] },
	},
	'14t': {
		'roof': [33, 249, 2049, 445],
		'side_right': [23, 287, 2150, 545], 'side_left': [17, 274, 2152, 555],
		'front': [206, 110, 1036, 1146], 'rear': [152, 50, 1102, 1146],
		'joints': { 'right': [ 0.2565, 0.4205, 0.5825, 0.757 ], 'left': [ 0.2285, 0.3875, 0.5955, 0.7705 ] },
		'badges': { 'front': [ ( 626, 860, 26 ) ], 'rear': [ ( 626, 776, 26 ) ] },
	},
	'52t': {
		'roof': [48, 266, 2115, 473],
		'side_right': [25, 277, 2152, 520], 'side_left': [20, 280, 2107, 533],
		'front': [462, 18, 788, 486], 'rear': [130, 40, 1120, 1156],
		'joints': { 'right': [ 0.252, 0.4265, 0.6055, 0.78 ], 'left': [ 0.2235, 0.4005, 0.5815, 0.7805 ] },
		'badges': { 'front': [ ( 626, 340, 10 ) ], 'rear': [ ( 620, 836, 26 ) ] },
	},
	't3_historic': {
		'roof': [65, 153, 2104, 491],
		'side_right': [26, 205, 2150, 660], 'side_left': [14, 195, 2148, 665],
		'front': [200, 236, 1026, 1176], 'rear': [172, 126, 1082, 1186],
		'joints': { 'right': [], 'left': [] },
	},
}

SIDE = ( 512, 56 )
ROOF = ( 512, 40 )
END = ( 96, 128 )
BAND = 160
W = H = 1024


def load( name ):

	return Image.open( SRC / f'tram_{name}.png' ).convert( 'RGB' )


def backdrop( img ):

	a = np.asarray( img ).astype( int )
	return a[ 5:40, 5:40 ].reshape( -1, 3 ).mean( 0 )


def cut( img, box, bg, badges = () ):
	"""Crop, paint over badges, and make the backdrop that touches the crop's edge transparent."""

	img = img.copy()
	d = ImageDraw.Draw( img )
	a = np.asarray( img )
	for x, y, r in badges:
		# The surrounding paint: the median of a ring just outside the badge.
		ring = [ a[ int( y + ( r + 6 ) * np.sin( t ) ), int( x + ( r + 6 ) * np.cos( t ) ) ] for t in np.linspace( 0, 6.28, 48 ) ]
		c = tuple( int( v ) for v in np.median( np.array( ring ), 0 ) )
		d.ellipse( [ x - r - 3, y - r - 3, x + r + 3, y + r + 3 ], fill = c )
	crop = np.asarray( img.crop( box ) ).astype( int )
	near = np.abs( crop - bg ).sum( 2 ) < 42
	labels, _ = ndimage.label( near )
	edge = set( np.unique( np.concatenate( [ labels[ 0 ], labels[ -1 ], labels[ :, 0 ], labels[ :, -1 ] ] ) ) ) - { 0 }
	alpha = np.where( np.isin( labels, list( edge ) ), 0, 255 ).astype( np.uint8 )
	out = Image.fromarray( crop.astype( np.uint8 ) ).convert( 'RGBA' )
	out.putalpha( Image.fromarray( alpha ) )
	return out


def shrink( img, size ):

	# Colour and coverage shrunk separately, so transparent backdrop does not bleed grey into the edges; the
	# coverage is then cut hard (the game tests alpha against ½).
	rgb = img.convert( 'RGB' ).resize( size, Image.LANCZOS )
	alpha = img.getchannel( 'A' ).resize( size, Image.BOX ).point( lambda v: 255 if v >= 128 else 0 )
	rgb.putalpha( alpha )
	return rgb


atlas = Image.new( 'RGBA', ( W, H ), ( 0, 0, 0, 0 ) )
info = { 'size': [ W, H ], 'types': {} }
rect = lambda x, y, w, h: [ x / W, 1 - ( y + h ) / H, ( x + w ) / W, 1 - y / H ] # u0, v0, u1, v1 (v up)

for i, ( name, t ) in enumerate( TYPES.items() ):

	y = i * BAND
	entry = { 'joints': t[ 'joints' ] }
	for k, side in enumerate( [ 'side_right', 'side_left' ] ):
		img = load( f'{name}_{side}' )
		atlas.paste( shrink( cut( img, t[ side ], backdrop( img ) ), SIDE ), ( 0, y + k * SIDE[ 1 ] ) )
		entry[ side ] = rect( 0, y + k * SIDE[ 1 ], *SIDE )
	img = load( f'{name}_roof' )
	atlas.paste( shrink( img.crop( t[ 'roof' ] ).convert( 'RGBA' ), ROOF ), ( 0, y + 2 * SIDE[ 1 ] ) )
	entry[ 'roof' ] = rect( 0, y + 2 * SIDE[ 1 ], *ROOF )
	for k, end in enumerate( [ 'front', 'rear' ] ):
		img = load( f'{name}_{end}' )
		atlas.paste( shrink( cut( img, t[ end ], backdrop( img ), t.get( 'badges', {} ).get( end, () ) ), END ), ( 512 + k * END[ 0 ], y ) )
		entry[ end ] = rect( 512 + k * END[ 0 ], y, *END )
	info[ 'types' ][ name ] = entry

# Shared pieces: the pantograph (side view, cut out), and a patch of the joints' dark rubber for the faces where
# two sections meet.
img = load( 'pantograph' )
a = np.asarray( img ).astype( int )
m = np.abs( a - backdrop( img ) ).sum( 2 ) > 42
rows, cols = np.where( m.any( 1 ) )[ 0 ], np.where( m.any( 0 ) )[ 0 ]
box = [ int( cols.min() ), int( rows.min() ), int( cols.max() ), int( rows.max() ) ]
panto = cut( img, box, backdrop( img ) )
size = ( 160, round( 160 * ( box[ 3 ] - box[ 1 ] ) / ( box[ 2 ] - box[ 0 ] ) ) )
atlas.paste( shrink( panto, size ), ( 704, 0 ) )
info[ 'pantograph' ] = rect( 704, 0, *size )
info[ 'pantographAspect' ] = size[ 1 ] / size[ 0 ]
atlas.paste( Image.new( 'RGBA', ( 16, 16 ), ( 38, 38, 40, 255 ) ), ( 704, 200 ) )
info[ 'joint' ] = rect( 706, 202, 12, 12 )

OUT.mkdir( parents = True, exist_ok = True )
# 256 colours (with the cut-outs kept), as a console's palettised texture would have; a third of the file.
atlas.quantize( 256, method = Image.Quantize.FASTOCTREE, dither = Image.Dither.NONE ).save( OUT / 'tram-atlas.png', optimize = True )
( OUT / 'tram-atlas.json' ).write_text( json.dumps( info, indent = '\t' ) )
print( 'atlas', OUT / 'tram-atlas.png', ( OUT / 'tram-atlas.png' ).stat().st_size, 'bytes' )
