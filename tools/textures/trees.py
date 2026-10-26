"""Tree atlas: leaves and bark from the owner's pictures, for the trees in src/furniture.js.

Usage: python3 tools/textures/trees.py ~/Documents/ChatGPT/PRAGA/textures public/textures

Top row: the inside of the linden, horse chestnut and plane crowns (the middle of each crown picture, all leaves, no
edge) and linden bark; bottom row: plane bark. Each tile 128 px, a 512 × 256 image.
"""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert( 0, str( Path( __file__ ).parent ) )
from common import save_atlas

SRC, OUT = Path( sys.argv[ 1 ] ) / 'vehicles', Path( sys.argv[ 2 ] )
T = 128
TILES = [
	( 'tree_linden_crown.png', 0.22 ), ( 'tree_chestnut_crown.png', 0.22 ), ( 'tree_plane_crown.png', 0.22 ), ( 'tree_bark_linden.png', 0 ),
	( 'tree_bark_plane.png', 0 ),
]

atlas = Image.new( 'RGB', ( 4 * T, 2 * T ), ( 60, 80, 40 ) )
for i, ( file, inset ) in enumerate( TILES ):
	img = Image.open( SRC / file ).convert( 'RGB' )
	w, h = img.size
	box = ( int( w * inset ), int( h * inset ), int( w * ( 1 - inset ) ), int( h * ( 1 - inset ) ) )
	atlas.paste( img.crop( box ).resize( ( T, T ), Image.LANCZOS ), ( ( i % 4 ) * T, ( i // 4 ) * T ) )

OUT.mkdir( parents = True, exist_ok = True )
print( 'atlas', OUT / 'tree-atlas.png', save_atlas( atlas, OUT / 'tree-atlas.png' ), 'bytes' )
