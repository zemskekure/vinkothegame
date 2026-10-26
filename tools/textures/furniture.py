"""Street furniture atlas: the owner's pictures of a Prague historic lamp post, a cast-iron bin, a bollard and a
park bench, cut off their backdrops and shrunk into one small image, with the round things' outlines, for
src/furniture.js.

Usage: python3 tools/textures/furniture.py ~/Documents/ChatGPT/PRAGA/textures public/textures src/furniture-atlas.json

The lamp post, the bin and the bollard are turned on a lathe: their outline in the picture, row by row, gives the
radius at each height (`lathe`: [ height, radius ] as shares of the thing's height), and the picture is wrapped round
them. The modelled bench's planks wear one slat of the bench picture. The backdrop around each picture is
filled with the nearest colour of the thing, so nothing grey shows at the edges.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert( 0, str( Path( __file__ ).parent ) )
from common import mask, bbox, bleed, shrink, simplify, save_atlas

SRC, OUT, JSON_OUT = Path( sys.argv[ 1 ] ) / 'vehicles', Path( sys.argv[ 2 ] ), Path( sys.argv[ 3 ] )

# file, place in the atlas ( x, y, w, h ), real height (m), lathe or not
THINGS = {
	'lamp': ( 'street_lamp_historic.png', ( 0, 0, 40, 256 ), 4.6, True ),
	'bin': ( 'street_bin.png', ( 40, 0, 88, 112 ), 0.95, True ),
	'bollard': ( 'street_bollard.png', ( 128, 0, 32, 128 ), 0.9, True ),
	'bench': ( 'street_bench_prague.png', ( 40, 128, 216, 128 ), 0.9, False ),
}
W, H = 256, 256
ROWS = 40

atlas = Image.new( 'RGB', ( W, H ), ( 38, 43, 40 ) )
info = { 'size': [ W, H ], 'things': {} }
for name, ( file, ( x, y, w, h ), height, lathe ) in THINGS.items():

	img = Image.open( SRC / file ).convert( 'RGB' )
	m = mask( img, tol = 28, opening = 1 )
	box = bbox( m )
	atlas.paste( shrink( bleed( img, m ).crop( box ), ( w, h ) ), ( x, y ) )
	entry = { 'rect': [ x / W, 1 - ( y + h ) / H, ( x + w ) / W, 1 - y / H ], 'height': height,
		'width': round( height * ( box[ 2 ] - box[ 0 ] ) / ( box[ 3 ] - box[ 1 ] ), 3 ) }
	if lathe:
		cm = m[ box[ 1 ]:box[ 3 ], box[ 0 ]:box[ 2 ] ]
		bh = cm.shape[ 0 ]
		pts = []
		for i in range( ROWS + 1 ):
			r = min( bh - 1, round( ( 1 - i / ROWS ) * ( bh - 1 ) ) )
			cols = np.where( cm[ max( 0, r - 2 ): r + 3 ].mean( 0 ) > 0.5 )[ 0 ]
			half = ( cols.max() - cols.min() + 1 ) / 2 if len( cols ) else 0
			pts.append( ( i / ROWS, half / bh ) )
		pts = simplify( pts, 0.004 )
		entry[ 'lathe' ] = [ [ round( a, 4 ), round( b, 4 ) ] for a, b in pts ]
	if name == 'bench':
		# One slat of the backrest, for the modelled bench's planks (measured in the atlas).
		entry[ 'slat' ] = [ 60 / W, 1 - 142 / H, 236 / W, 1 - 134 / H ]
	info[ 'things' ][ name ] = entry
	print( name, entry[ 'width' ], 'm wide', len( entry.get( 'lathe', [] ) ), 'lathe points' )

OUT.mkdir( parents = True, exist_ok = True )
size = save_atlas( atlas, OUT / 'furniture-atlas.png' )
JSON_OUT.write_text( json.dumps( info, indent = '\t' ) )
print( 'atlas', OUT / 'furniture-atlas.png', size, 'bytes' )
