// Play area: central Prague through Hradčany, Strahov, Malá Strana, Josefov and Old Town to Florenc,
// Václavské náměstí, the National Museum and Hlavní nádraží. Beyond FIRST_AREA the city is modelled from data.
// S-JTSK / Krovak East North (EPSG:5514), metres: x grows east, y grows north.

// The south and north cuts clear Resslova and Milady Horákové; the west and north cuts also keep the earlier
// 50 cm ground texture aligned to its JPEG blocks.
export const AREA = {
	xmin: - 745206,
	xmax: - 741400,
	ymin: - 1044280,
	ymax: - 1041928
};

// The east and north extension keeps its photo cuts and terrain boundaries on later builds.
export const EAST_AREA = { xmin: - 744950, xmax: - 742200, ymin: - 1044180, ymax: - 1042360 };
export const EAST_HI_TILES = [ 8, 4 ];

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
// 8 × 6 tiles of 3806 × 3136 px, with whole pixels at every tile boundary.
export const HI_TILES = [ 8, 6 ];
// The 25 cm overview orthophoto, stitched from 4 × 4 tiles of 3806 × 2352 px.
export const ORTHO_TILES = [ 4, 4 ];
