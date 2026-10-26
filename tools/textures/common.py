"""Shared helpers for turning the owner's generated pictures (~/Documents/ChatGPT/PRAGA/textures) into small console
textures: finding the object on its plain backdrop, cropping, filling the backdrop with the object's own edge colours
(so nothing grey bleeds in when the picture is mapped onto a shape that follows the outline only roughly), shrinking.
"""

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def rgb( img ):

	return np.asarray( img.convert( 'RGB' ) ).astype( int )


def mask( img, tol = 36, edge = 0.03, ground = None, opening = 3 ):
	"""Where the object is: everything not connected to the picture's border through backdrop-coloured pixels. The
	backdrop's colour is taken per row from the picture's left and right strips (the wall's light changes from top to
	bottom). `ground`: the row where the thing stands on the ground (measured on the picture); the textured paving
	below it counts as backdrop."""

	a = rgb( img )
	h, w, _ = a.shape
	e = max( 4, int( w * edge ) )
	bg = np.median( np.concatenate( [ a[ :, :e ], a[ :, -e: ] ], 1 ), 1 )
	near = np.abs( a - bg[ :, None, : ] ).sum( 2 ) < tol
	if ground:
		near[ ground: ] = True
	lab, _ = ndimage.label( near )
	border = set( np.unique( np.concatenate( [ lab[ 0 ], lab[ -1 ], lab[ :, 0 ], lab[ :, -1 ] ] ) ) ) - { 0 }
	m = ~ np.isin( lab, list( border ) )
	if opening:
		m = ndimage.binary_opening( m, iterations = opening )
	m = ndimage.binary_fill_holes( m )
	lab, n = ndimage.label( m )
	if n > 1:
		sizes = ndimage.sum( m, lab, range( 1, n + 1 ) )
		m = lab == ( 1 + int( np.argmax( sizes ) ) )
	return m


def bbox( m, share = 0.0 ):
	"""The mask's bounding box [x0, y0, x1, y1]; with `share`, rows and columns with less than that share of their
	pixels covered are not counted (stray shadow fringes)."""

	rows = np.where( m.mean( 1 ) > share )[ 0 ] if share else np.where( m.any( 1 ) )[ 0 ]
	cols = np.where( m.mean( 0 ) > share )[ 0 ] if share else np.where( m.any( 0 ) )[ 0 ]
	return [ int( cols.min() ), int( rows.min() ), int( cols.max() ) + 1, int( rows.max() ) + 1 ]


def bleed( img, m ):
	"""The picture with every backdrop pixel replaced by the nearest object pixel's colour."""

	a = np.asarray( img.convert( 'RGB' ) )
	_, ( iy, ix ) = ndimage.distance_transform_edt( ~ m, return_indices = True )
	return Image.fromarray( a[ iy, ix ] )


def cutout( img, m ):
	"""RGBA: the object, its backdrop transparent (colours bled outwards, so shrinking does not darken the edge)."""

	out = bleed( img, m ).convert( 'RGBA' )
	out.putalpha( Image.fromarray( ( m * 255 ).astype( np.uint8 ) ) )
	return out


def shrink( img, size ):
	"""Colour and coverage shrunk separately; coverage cut hard at one half (the game tests alpha against ½)."""

	if img.mode != 'RGBA':
		return img.convert( 'RGB' ).resize( size, Image.LANCZOS )
	rgb_ = img.convert( 'RGB' ).resize( size, Image.LANCZOS )
	alpha = img.getchannel( 'A' ).resize( size, Image.BOX ).point( lambda v: 255 if v >= 128 else 0 )
	rgb_.putalpha( alpha )
	return rgb_


def paint_over( img, spots ):
	"""Maker's badges painted over: each ( x, y, r ) circle filled with the median of a ring just outside it."""

	img = img.copy()
	a = np.asarray( img.convert( 'RGB' ) )
	d = ImageDraw.Draw( img )
	for x, y, r in spots:
		ring = [ a[ int( y + ( r + 6 ) * np.sin( t ) ), int( x + ( r + 6 ) * np.cos( t ) ) ] for t in np.linspace( 0, 6.28, 48 ) ]
		c = tuple( int( v ) for v in np.median( np.array( ring ), 0 ) )
		d.ellipse( [ x - r, y - r, x + r, y + r ], fill = c )
	return img


def simplify( pts, tol ):
	"""Douglas–Peucker on an open polyline."""

	if len( pts ) < 3:
		return pts
	a, b = np.array( pts[ 0 ] ), np.array( pts[ -1 ] )
	ab = b - a
	n = np.hypot( *ab ) or 1
	d = [ abs( ab[ 0 ] * ( p[ 1 ] - a[ 1 ] ) - ab[ 1 ] * ( p[ 0 ] - a[ 0 ] ) ) / n for p in pts[ 1:-1 ] ]
	i = int( np.argmax( d ) ) + 1
	if d[ i - 1 ] <= tol:
		return [ pts[ 0 ], pts[ -1 ] ]
	return simplify( pts[ :i + 1 ], tol )[ :-1 ] + simplify( pts[ i: ], tol )


def save_atlas( atlas, path, colours = 256 ):
	"""As a console's palettised texture: 256 colours, no dithering (cut-outs kept when there is alpha)."""

	q = atlas.quantize( colours, method = Image.Quantize.FASTOCTREE if atlas.mode == 'RGBA' else Image.Quantize.MEDIANCUT, dither = Image.Dither.NONE )
	q.save( path, optimize = True )
	return path.stat().st_size
