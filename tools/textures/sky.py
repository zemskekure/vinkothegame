"""Sky panoramas for the game's sky dome (src/sky.js): the owner's six skies shrunk to 512 px wide, console size.

Usage: python3 tools/textures/sky.py ~/Documents/ChatGPT/PRAGA/textures public/textures/sky
"""

import sys
from pathlib import Path

from PIL import Image

SRC, OUT = Path( sys.argv[ 1 ] ) / 'sky', Path( sys.argv[ 2 ] )
OUT.mkdir( parents = True, exist_ok = True )
for f in sorted( SRC.glob( '*.png' ) ):
	img = Image.open( f ).convert( 'RGB' )
	img = img.resize( ( 512, round( 512 * img.height / img.width ) ), Image.LANCZOS )
	img.save( OUT / f'{f.stem}.jpg', quality = 82 )
	print( f.stem, img.size, ( OUT / f'{f.stem}.jpg' ).stat().st_size, 'bytes' )
