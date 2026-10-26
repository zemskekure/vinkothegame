"""Graffiti atlas: everything the owner has drawn for the walls, cut out, shrunk to console size and packed into one
image with a JSON of where each piece is and what kind it is, for src/graffiti.js.

Usage: python3 tools/textures/graffiti.py ~/Documents/ChatGPT/PRAGA/textures public/textures

Picked up from the owner's folder:
- graffiti/<kind>_NN.png, kinds tag, throwup, sticker, pasteup, piece, shutter: whatever is there (transparent
  pictures keep their alpha; ones on a plain backdrop are cut off it);
- props/graffiti_plaster.png: a torn-edged patch of its sprayed plaster;
- props/torn_poster_wall.png: a patch of torn posters with a ragged edge.
Run it again when new pictures land; the game reads the JSON, so new kinds and counts need no code change.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

sys.path.insert( 0, str( Path( __file__ ).parent ) )
from common import mask, bbox, cutout, shrink, save_atlas

SRC, OUT = Path( sys.argv[ 1 ] ), Path( sys.argv[ 2 ] )
KINDS = [ 'tag', 'throwup', 'sticker', 'pasteup', 'piece', 'shutter', 'poster', 'patch' ]
# The longest side of each kind in the atlas (px): small things small.
SIZE = { 'tag': 128, 'throwup': 128, 'sticker': 32, 'pasteup': 80, 'piece': 192, 'shutter': 128, 'poster': 96, 'patch': 128 }
W = 512


def cut( img ):
	"""The picture as RGBA, cropped to what is drawn."""

	img = img.convert( 'RGBA' )
	a = np.asarray( img.getchannel( 'A' ) )
	if a.min() < 128:
		m = a >= 128
	else:
		m = mask( img, tol = 30, opening = 1 )
		img = cutout( img, m )
	return img.crop( bbox( m ) )


def ragged( img, seed ):
	"""A rough patch: the picture inside a blob with a torn edge."""

	w, h = img.size
	rng = np.random.default_rng( seed )
	noise = Image.fromarray( ( rng.random( ( h // 24, w // 24 ) ) * 255 ).astype( np.uint8 ) ).resize( ( w, h ), Image.BICUBIC )
	yy, xx = np.mgrid[ 0:h, 0:w ]
	edge = np.minimum( np.minimum( xx, w - 1 - xx ) / w, np.minimum( yy, h - 1 - yy ) / h )
	m = edge * 4 + np.asarray( noise ) / 255 * 0.35 > 0.4
	out = img.convert( 'RGBA' )
	out.putalpha( Image.fromarray( ( m * 255 ).astype( np.uint8 ) ) )
	return out


items = []
for f in sorted( ( SRC / 'graffiti' ).glob( '*.png' ) ):
	kind = f.stem.split( '_' )[ 0 ]
	if kind in KINDS:
		items.append( ( kind, f.stem, cut( Image.open( f ) ) ) )

# The owner's sprayed plaster: a patch of it (old tags on flaking plaster), torn at the edge.
plaster = Image.open( SRC / 'props' / 'graffiti_plaster.png' )
pw, ph = plaster.size
items.append( ( 'patch', 'graffiti_plaster', ragged( plaster.crop( ( 0, 0, pw, ph * 2 // 3 ) ), 3 ) ) )

poster = Image.open( SRC / 'props' / 'torn_poster_wall.png' )
qw, qh = poster.size
items.append( ( 'poster', 'torn_poster_0', ragged( poster.crop( ( 0, 0, qw // 2, qh // 2 * 2 ) ), 1 ) ) )
items.append( ( 'poster', 'torn_poster_1', ragged( poster.crop( ( qw // 2, 0, qw, qh ) ), 2 ) ) )

# Shrink, then pack in shelves (tallest first), the atlas as tall as needed in powers of two.
shrunk = []
for kind, name, img in items:
	s = SIZE[ kind ] / max( img.size )
	size = ( max( 4, round( img.width * s ) ), max( 4, round( img.height * s ) ) )
	shrunk.append( ( kind, name, shrink( img, size ), img.width / img.height ) )
shrunk.sort( key = lambda t: - t[ 2 ].height )

places, x, y, shelf = [], 0, 0, 0
for kind, name, img, aspect in shrunk:
	if x + img.width > W:
		x, y, shelf = 0, y + shelf + 1, 0
	places.append( ( kind, name, img, aspect, x, y ) )
	x += img.width + 1
	shelf = max( shelf, img.height )
H = 64
while H < y + shelf:
	H *= 2

atlas = Image.new( 'RGBA', ( W, H ), ( 0, 0, 0, 0 ) )
info = { 'size': [ W, H ], 'items': [] }
for kind, name, img, aspect, x, y in places:
	atlas.paste( img, ( x, y ) )
	w, h = img.size
	info[ 'items' ].append( { 'kind': kind, 'name': name, 'aspect': round( aspect, 3 ), 'rect': [ x / W, 1 - ( y + h ) / H, ( x + w ) / W, 1 - y / H ] } )

OUT.mkdir( parents = True, exist_ok = True )
size = save_atlas( atlas, OUT / 'graffiti-atlas.png' )
( OUT / 'graffiti-atlas.json' ).write_text( json.dumps( info, indent = '\t' ) )
counts = {}
for it in info[ 'items' ]:
	counts[ it[ 'kind' ] ] = counts.get( it[ 'kind' ], 0 ) + 1
print( 'atlas', OUT / 'graffiti-atlas.png', W, 'x', H, size, 'bytes', counts )
