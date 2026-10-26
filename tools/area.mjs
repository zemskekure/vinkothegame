// Play area: Prague Old Town around Betlémské náměstí, east to náměstí Republiky and Revoluční, north through
// Josefov, Haštalská and Anežský klášter to the Vltava bend at Na Františku, south over Národní to Žofín
// (Slovanský ostrov) and Spálená, and west across the Vltava to Kampa, Malá Strana and Petřín (the lookout tower
// near the west edge, Malostranské náměstí and Nerudova near the north edge). The first area ended at the river
// (x −743720, y −1043060); everything beyond it is modelled from the data alone.
// S-JTSK / Krovak East North (EPSG:5514), metres: x grows east, y grows north.

export const AREA = {
	xmin: - 744950,
	xmax: - 742200,
	ymin: - 1044180,
	ymax: - 1042360
};

// The west extension's original photo cuts and street measurements stay fixed when the area grows again.
export const WEST_AREA = { xmin: - 744950, xmax: - 742800, ymin: - 1044180, ymax: - 1042640 };
export const WEST_HI_TILES = [ 5, 4 ];

// The first play area (Betlémské náměstí to the river), modelled in detail: the ground keeps its 25 cm aerial-photo
// detail here, the rest of the area gets it at 50 cm.
export const FIRST_AREA = {
	xmin: - 743720,
	xmax: - 742800,
	ymin: - 1044180,
	ymax: - 1043060
};

// Scene origin: centre of Betlémské náměstí.
export const ORIGIN = { x: - 743087, y: - 1043282 };

// The 12.5 cm orthophoto comes in nx × ny tiles (data/raw/ortho-hi-<i>-<j>.jpg; the service caps images at 4096 px).
// 8 × 4 tiles of 2750 × 3640 px, with whole pixels at every tile boundary.
export const HI_TILES = [ 8, 4 ];
// The 25 cm overview orthophoto, stitched from 5 × 2 tiles of 2200 × 3640 px.
export const ORTHO_TILES = [ 5, 2 ];
