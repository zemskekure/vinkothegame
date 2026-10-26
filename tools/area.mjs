// Play area: Prague Old Town around Betlémské náměstí, east to Jilská / Na Perštýně, south over Národní to Žofín
// (Slovanský ostrov) and Spálená, and west across the Vltava to Kampa, Malá Strana and Petřín (the lookout tower
// near the west edge, Malostranské náměstí and Nerudova near the north edge). The first area ended at the river
// (x −743720, y −1043060); everything west and north of that is modelled from the data alone.
// S-JTSK / Krovak East North (EPSG:5514), metres: x grows east, y grows north.

export const AREA = {
	xmin: - 744950,
	xmax: - 742800,
	ymin: - 1044180,
	ymax: - 1042640
};

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
// 5 × 4 tiles of 3440 × 3080 px.
export const HI_TILES = [ 5, 4 ];
// The 25 cm overview orthophoto, stitched from 4 × 2 tiles of 2150 × 3080 px.
export const ORTHO_TILES = [ 4, 2 ];
