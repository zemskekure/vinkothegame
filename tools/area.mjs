// Play area: Prague Old Town around Betlémské náměstí, from the Vltava
// embankment (Smetanovo nábřeží) east to Jilská / Na Perštýně, south over Národní to Žofín (Slovanský ostrov)
// and Spálená.
// S-JTSK / Krovak East North (EPSG:5514), metres: x grows east, y grows north.

export const AREA = {
	xmin: - 743720,
	xmax: - 742800,
	ymin: - 1044180,
	ymax: - 1043060
};

// Scene origin: centre of Betlémské náměstí.
export const ORIGIN = { x: - 743087, y: - 1043282 };

// The 12.5 cm orthophoto comes in nx × ny tiles (data/raw/ortho-hi-<i>-<j>.jpg; the service caps images at 4096 px).
export const HI_TILES = [ 2, 3 ];
