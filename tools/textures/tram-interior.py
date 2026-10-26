"""The trams' insides: the owner's pictures of a Tatra T3's and a Škoda 15T's saloon (looking down the aisle) side by
side in one small image, and a tile of the seat fabric, for src/tram-interior.js. The aisle pictures hang on the end
walls inside, so the saloon seems to go on; the fabric covers the seats.

Usage: python3 tools/textures/tram-interior.py ~/Documents/ChatGPT/PRAGA/textures public/models/vehicles
"""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert( 0, str( Path( __file__ ).parent ) )
from common import shrink, save_atlas

SRC, OUT = Path( sys.argv[ 1 ] ) / 'vehicles', Path( sys.argv[ 2 ] )
S = 256

atlas = Image.new( 'RGB', ( S * 2, S ) )
for k, name in enumerate( [ 'tram_t3_interior.png', 'tram_15t_interior.png' ] ):

	atlas.paste( shrink( Image.open( SRC / name ).convert( 'RGB' ), ( S, S ) ), ( k * S, 0 ) )

save_atlas( atlas, OUT / 'tram-interior.png' )

# The fabric: a quarter of the picture (a few repeats of its pattern) as a 64-pixel tile that repeats on the seats.
fabric = Image.open( SRC / 'tram_seat_fabric.png' ).convert( 'RGB' )
w, h = fabric.size
save_atlas( shrink( fabric.crop( ( 0, 0, w // 4, h // 4 ) ), ( 64, 64 ) ), OUT / 'tram-fabric.png', 64 )
print( 'tram interior: tram-interior.png, tram-fabric.png' )
