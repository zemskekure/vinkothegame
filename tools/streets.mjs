// Street detail from OpenStreetMap (© OpenStreetMap contributors, ODbL), data/raw/osm.json:
//   - carriageways at their tagged width (or from the lane count), with their surface (asphalt / setts)
//   - raised pavements with granite kerbs along roads that have sidewalks, as real geometry
//   - surfaces of pedestrian streets and squares
//   - street furniture where it is mapped: lamps, benches, bins, bollards, bike stands, fountains, statues,
//     tram-stop shelters, trees, zebra crossings
//
// All positions are S-JTSK metres (EPSG:5514) until written out in the scene frame by the caller's toLocal().

import { readFile } from 'node:fs/promises';
import { lonLatToSJTSK, lonLatToSJTSKBeyond } from './geo.mjs';
import { buildKerbs } from './kerbs.mjs';
import { EAST_AREA, WEST_AREA } from './area.mjs';
import { rtin, rtinSize } from './rtin.mjs';

// Artworks mapped as statues that are none: "Za pravdu" on Betlémská kaple is a shadow inscription, eight stone
// ledges on the chapel front (src/landmarks.js).
const NOT_STATUES = new Set( [ 4923909754, 2517769530, 6840520600, 4758035848 ] ); // and Viselec, which hangs from a roof; the two St Johns of Nepomuk modelled in tools/dress.mjs

const KERB_HEIGHT = 0.12;
const RAMP_END = 8.5; // the pavement mesh covers the kerb field up to here
const CAR_ROADS = new Set( [ 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
	'primary_link', 'secondary_link', 'tertiary_link' ] );
const OPEN_WAYS = new Set( [ 'pedestrian', 'footway', 'living_street', 'path', 'steps', 'service', 'residential' ] );
const CARRIAGEWAY = new Set( [ 'service', 'residential' ] );

const SETT = /sett|cobblestone/;
const surfaceValue = s => s === 'asphalt' || s === 'concrete' ? 1 : SETT.test( s || 'sett' ) ? 0 : 0.5; // 0.5 = paving stones

export async function loadStreets( { AREA, FIRST_AREA, buildingDist, westBuildingDist = buildingDist, eastBuildingDist = buildingDist, inBuilding, eastInBuilding = inBuilding, tramPaths } ) {

	// Beyond the first area, moved onto the cadastre (tools/geo.mjs). Each node keeps its plain projection too (raw),
	// for the first area's kerbs, measured as they always were (below).
	const grownProject = FIRST_AREA ? await lonLatToSJTSKBeyond( FIRST_AREA, AREA ) : await lonLatToSJTSK();
	const eastProject = FIRST_AREA ? await lonLatToSJTSKBeyond( FIRST_AREA, EAST_AREA ) : await lonLatToSJTSK();
	const inEast = ( X, Y, m = 0 ) => X > EAST_AREA.xmin - m && X < EAST_AREA.xmax + m && Y > EAST_AREA.ymin - m && Y < EAST_AREA.ymax + m;
	const project = ( lon, lat ) => {

		const old = eastProject( lon, lat );
		if ( inEast( ...old ) ) return old;
		return grownProject( lon, lat );

	};
	const westProject = FIRST_AREA ? await lonLatToSJTSKBeyond( FIRST_AREA, WEST_AREA ) : await lonLatToSJTSK();
	const plain = await lonLatToSJTSK();
	const osm = JSON.parse( await readFile( new URL( '../data/raw/osm.json', import.meta.url ) ) );

	// Manual position fixes (data/corrections.json), e.g. a pin placed on a leaning top in the aerial photo.
	const corrections = JSON.parse( await readFile( new URL( '../data/corrections.json', import.meta.url ) ) );
	const nodes = new Map();
	for ( const el of osm ) if ( el.type === 'node' ) {

		let [ X, Y ] = project( el.lon, el.lat ), [ X0, Y0 ] = plain( el.lon, el.lat );
		let [ Xw, Yw ] = westProject( el.lon, el.lat ), [ Xe, Ye ] = eastProject( el.lon, el.lat );
		const fix = corrections[ `node/${el.id}` ];
		if ( fix?.offset ) {

			X += fix.offset[ 0 ];
			Y += fix.offset[ 1 ];
			X0 += fix.offset[ 0 ];
			Y0 += fix.offset[ 1 ];
			Xe += fix.offset[ 0 ];
			Ye += fix.offset[ 1 ];
			Xw += fix.offset[ 0 ];
			Yw += fix.offset[ 1 ];

		}
		nodes.set( el.id, { id: el.id, X, Y, tags: el.tags || {}, raw: { id: el.id, X: X0, Y: Y0, tags: el.tags || {} }, east: { id: el.id, X: Xe, Y: Ye, tags: el.tags || {} }, west: { id: el.id, X: Xw, Y: Yw, tags: el.tags || {} } } );

	}

	const ways = osm.filter( el => el.type === 'way' && el.tags ).map( w => ( { ...w, pts: w.nodes.map( id => nodes.get( id ) ).filter( Boolean ) } ) );
	const inArea = ( X, Y, m = 0 ) => X > AREA.xmin - m && X < AREA.xmax + m && Y > AREA.ymin - m && Y < AREA.ymax + m;
	const inWest = ( X, Y, m = 0 ) => X > WEST_AREA.xmin - m && X < WEST_AREA.xmax + m && Y > WEST_AREA.ymin - m && Y < WEST_AREA.ymax + m;

	// --- carriageways
	const roads = [];
	for ( const w of ways ) {

		const t = w.tags;
		if ( ! CAR_ROADS.has( t.highway ) || t.area === 'yes' || t.tunnel || ( Number( t.layer ) || 0 ) < 0 ) continue;
		if ( t.bridge ) continue; // Most legií spans the river; the deck is not modelled
		if ( ! w.pts.some( p => inArea( p.X, p.Y, 30 ) ) ) continue;

		const lanes = Number( t.lanes ) || ( t.highway === 'service' ? 1 : t.oneway === 'yes' ? 1 : 2 );
		const tagged = parseFloat( t.width );
		let width = tagged > 0 ? tagged : t.highway === 'service' ? 3.2 : lanes * 3.0 + ( lanes === 1 ? 0.6 : 0 );
		// Pavement on each side of the way (OSM sidewalk / sidewalk:left / sidewalk:right / sidewalk:both).
		const has = v => v !== undefined && v !== 'no' && v !== 'none';
		const sideTag = which => t[ `sidewalk:${which}` ] ?? t[ 'sidewalk:both' ] ??
			( t.sidewalk === undefined ? undefined : /both|yes|separate/.test( t.sidewalk ) || t.sidewalk === which ? 'yes' : 'no' );
		const left = t.highway !== 'pedestrian' && has( sideTag( 'left' ) );
		const right = t.highway !== 'pedestrian' && has( sideTag( 'right' ) );
		const kerbed = left || right;

		// Keep at least a narrow pavement between the carriageway and the houses.
		const halfAt = ( p, distance = buildingDist ) => Math.max( 1.3, Math.min( width / 2, distance( p.X, p.Y ) - ( kerbed ? 1.0 : 0.3 ) ) );
		const half = w.pts.map( p => halfAt( p ) ), rawPts = w.pts.map( p => p.raw ), rawHalf = rawPts.map( p => halfAt( p, westBuildingDist ) );
		const eastPts = w.pts.map( p => p.east ), eastHalf = eastPts.map( p => halfAt( p, eastBuildingDist ) );
		const westPts = w.pts.map( p => p.west ), westHalf = westPts.map( p => halfAt( p, westBuildingDist ) );
		const sidewalkTagged = Object.keys( t ).some( k => k.startsWith( 'sidewalk' ) );
		const sidewalkWidthTag = parseFloat( t[ 'sidewalk:width' ] || t[ 'sidewalk:both:width' ] ) || 0;
		roads.push( { pts: w.pts, half, rawPts, rawHalf, eastPts, eastHalf, westPts, westHalf, kerbed, left, right, oneway: t.oneway === 'yes' ? 1 : t.oneway === '-1' ? - 1 : 0, sidewalkTagged, sidewalkWidthTag, asphalt: surfaceValue( t.surface ), name: t.name, highway: t.highway } );

	}

	// --- open (pedestrian) areas and their surface
	const openWays = ways.filter( w => OPEN_WAYS.has( w.tags.highway ) && w.tags.surface && w.pts.some( p => inArea( p.X, p.Y, 30 ) ) );

	// Squares are paved throughout their mapped outline, including the middle far from any boundary line.
	const openAreas = ways.filter( w => w.nodes[ 0 ] === w.nodes.at( - 1 ) && w.pts.length >= 4 && w.tags.surface &&
		( ( w.tags.area === 'yes' && /^(pedestrian|footway)$/.test( w.tags.highway ) ) || /^(pedestrian|footway)$/.test( w.tags[ 'area:highway' ] ) ) ).map( w => ( {
		pts: w.pts, value: surfaceValue( w.tags.surface ),
		minX: Math.min( ...w.pts.map( p => p.X ) ), maxX: Math.max( ...w.pts.map( p => p.X ) ),
		minY: Math.min( ...w.pts.map( p => p.Y ) ), maxY: Math.max( ...w.pts.map( p => p.Y ) )
	} ) );
	const openAreaAt = ( X, Y ) => {

		if ( inEast( X, Y ) ) return null;
		for ( const a of openAreas ) {

			if ( X < a.minX || X > a.maxX || Y < a.minY || Y > a.maxY ) continue;
			let inside = false;
			for ( let i = 0, j = a.pts.length - 1; i < a.pts.length; j = i ++ ) {

				const p = a.pts[ i ], q = a.pts[ j ];
				if ( ( p.Y > Y ) !== ( q.Y > Y ) && X < ( q.X - p.X ) * ( Y - p.Y ) / ( q.Y - p.Y ) + p.X ) inside = ! inside;

			}
			if ( inside ) return a.value;

		}
		return null;

	};

	// --- segment index for fast nearest queries
	const CELL = 16;
	function segmentIndex( list, halfOf ) {

		const grid = new Map();
		list.forEach( ( item, k ) => {

			for ( let i = 1; i < item.pts.length; i ++ ) {

				const a = item.pts[ i - 1 ], b = item.pts[ i ];
				const seg = { a, b, ha: halfOf( item, i - 1 ), hb: halfOf( item, i ), item: k };
				for ( let gx = Math.floor( Math.min( a.X, b.X ) / CELL ) - 1; gx <= Math.floor( Math.max( a.X, b.X ) / CELL ) + 1; gx ++ ) {

					for ( let gy = Math.floor( Math.min( a.Y, b.Y ) / CELL ) - 1; gy <= Math.floor( Math.max( a.Y, b.Y ) / CELL ) + 1; gy ++ ) {

						const key = gx * 100000 + gy;
						if ( ! grid.has( key ) ) grid.set( key, [] );
						grid.get( key ).push( seg );

					}

				}

			}

		} );

		// Nearest segment by (distance − half width): returns { f, seg, t }.
		// accept( item, isLeft ): optional filter by the side of the way the point lies on.
		return ( X, Y, accept ) => {

			let best = { f: Infinity, seg: null, t: 0, d: Infinity, left: false };
			const list2 = grid.get( Math.floor( X / CELL ) * 100000 + Math.floor( Y / CELL ) );
			if ( ! list2 ) return best;
			for ( const seg of list2 ) {

				const dx = seg.b.X - seg.a.X, dy = seg.b.Y - seg.a.Y;
				const t = Math.max( 0, Math.min( 1, ( ( X - seg.a.X ) * dx + ( Y - seg.a.Y ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
				const d = Math.hypot( X - seg.a.X - t * dx, Y - seg.a.Y - t * dy );
				const f = d - ( seg.ha + ( seg.hb - seg.ha ) * t );
				const isLeft = dx * ( Y - seg.a.Y ) - dy * ( X - seg.a.X ) > 0;
				if ( accept && ! accept( list[ seg.item ], isLeft ) ) continue;
				if ( f < best.f ) best = { f, seg, t, d, left: isLeft };

			}

			return best;

		};

	}

	const oldRoad = r => r.eastPts.some( p => inEast( p.X, p.Y, 30 ) );
	const oldOpen = w => w.pts.some( p => inEast( p.east.X, p.east.Y, 30 ) );
	const currentRoad = segmentIndex( roads, ( r, i ) => r.half[ i ] );
	const previousRoad = segmentIndex( roads.map( r => ( { ...r, pts: oldRoad( r ) ? r.westPts : [], half: r.westHalf } ) ), ( r, i ) => r.half[ i ] );
	const eastRoad = segmentIndex( roads.map( r => ( { ...r, pts: oldRoad( r ) ? r.eastPts : [], half: r.eastHalf } ) ), ( r, i ) => r.half[ i ] );
	const currentOpen = segmentIndex( openWays, () => 0 );
	const previousOpen = segmentIndex( openWays.map( w => ( { ...w, pts: oldOpen( w ) ? w.pts.map( p => p.west ) : [] } ) ), () => 0 );
	const eastOpen = segmentIndex( openWays.map( w => ( { ...w, pts: oldOpen( w ) ? w.pts.map( p => p.east ) : [] } ) ), () => 0 );
	const nearestRoad = ( X, Y, accept ) => ( inWest( X, Y ) ? previousRoad : inEast( X, Y ) ? eastRoad : currentRoad )( X, Y, accept );
	const nearestOpen = ( X, Y ) => ( inWest( X, Y ) ? previousOpen : inEast( X, Y ) ? eastOpen : currentOpen )( X, Y );

	// Kerbed carriageways (tools/kerbs.mjs): measured from the house fronts and the aerial photo.
	// --- tram stop platforms (street level; the metro's are underground)
	const platforms = [];
	for ( const w of ways ) {

		const t = w.tags;
		if ( ! ( t.railway === 'platform' || t.public_transport === 'platform' || t.highway === 'platform' ) ) continue;
		if ( ( Number( t.layer ) || 0 ) < 0 || ( Number( t.level ) || 0 ) < 0 || w.pts.length < 2 ) continue;
		if ( ! w.pts.some( p => inArea( p.X, p.Y ) ) ) continue;
		const closed = w.nodes[ 0 ] === w.nodes[ w.nodes.length - 1 ];
		platforms.push( {
			id: w.id, name: t.name || '', pts: w.pts.map( p => [ p.X, p.Y ] ), rawPts: w.pts.map( p => [ p.raw.X, p.raw.Y ] ), eastPts: w.pts.map( p => [ p.east.X, p.east.Y ] ), westPts: w.pts.map( p => [ p.west.X, p.west.Y ] ), closed, half: ( parseFloat( t.width ) || 2.6 ) / 2,
			// On the pavement (a stop at the kerb) or an island of its own in the street.
			island: t.footway !== 'sidewalk' && t.highway !== 'footway',
			shelter: t.shelter === 'yes', bench: t.bench === 'yes', bin: t.bin === 'yes', board: t.departures_board === 'yes' || t.passenger_information_display === 'yes'
		} );

	}

	// The kerbs are measured along whole streets (house fronts, the photo, the street's width as a whole), so a
	// street that now runs on out of the first area would measure a little differently inside it. The first area
	// keeps the kerbs measured from the streets that reach it, as before the area grew west. Malá Strana keeps its
	// measurements and photo cuts too; the new strips take all streets. Each set of chains stays in its own area.
	const inFirst = ( X, Y, m = 0 ) => !! FIRST_AREA && X > FIRST_AREA.xmin - m && X < FIRST_AREA.xmax + m && Y > FIRST_AREA.ymin - m && Y < FIRST_AREA.ymax + m;
	const westInBuilding = ( X, Y ) => X >= WEST_AREA.xmin && X < WEST_AREA.xmax && Y > WEST_AREA.ymin && Y <= WEST_AREA.ymax && eastInBuilding( X, Y );
	console.log( 'kerbs: measuring the expanded area…' );
	const allKerbs = await buildKerbs( { roads, AREA, inBuilding, tramPaths, islands: platforms.filter( p => p.island ) } );
	const westRoads = roads.filter( r => r.westPts.some( p => inWest( p.X, p.Y, 30 ) ) ).map( r => ( { ...r, pts: r.westPts, half: r.westHalf } ) );
	const westIslands = platforms.filter( p => p.island && p.westPts.some( ( [ X, Y ] ) => inWest( X, Y ) ) ).map( p => ( { ...p, pts: p.westPts } ) );
	const eastRoads = roads.filter( r => r.eastPts.some( p => inEast( p.X, p.Y, 30 ) ) ).map( r => ( { ...r, pts: r.eastPts, half: r.eastHalf } ) );
	const eastIslands = platforms.filter( p => p.island && p.eastPts.some( ( [ X, Y ] ) => inEast( X, Y ) ) ).map( p => ( { ...p, pts: p.eastPts } ) );
	console.log( 'kerbs: preserving the east and north area…' );
	const east = await buildKerbs( { roads: eastRoads, AREA: EAST_AREA, inBuilding: eastInBuilding, tramPaths, islands: eastIslands } );
	console.log( 'kerbs: preserving the west area…' );
	const west = await buildKerbs( { roads: westRoads, AREA: WEST_AREA, inBuilding: westInBuilding, tramPaths, islands: westIslands } );
	let kerbs = {
		sdf: ( X, Y ) => inWest( X, Y ) ? west.sdf( X, Y ) : inEast( X, Y ) ? east.sdf( X, Y ) : allKerbs.sdf( X, Y ),
		chains: [ ...west.chains.map( c => ( { ...c, keep: inWest } ) ), ...east.chains.map( c => ( { ...c, keep: ( X, Y ) => inEast( X, Y ) && ! inWest( X, Y ) } ) ), ...allKerbs.chains.map( c => ( { ...c, keep: ( X, Y ) => ! inEast( X, Y ) } ) ) ]
	};
	if ( FIRST_AREA ) {

		const firstRoads = roads.filter( r => r.rawPts.some( p => inFirst( p.X, p.Y, 30 ) ) ).map( r => ( { ...r, pts: r.rawPts, half: r.rawHalf } ) );
		const firstIslands = platforms.filter( p => p.island && p.rawPts.some( ( [ X, Y ] ) => inFirst( X, Y ) ) ).map( p => ( { ...p, pts: p.rawPts } ) );
		console.log( 'kerbs: preserving the first area…' );
		const first = await buildKerbs( { roads: firstRoads, AREA: FIRST_AREA, photoArea: WEST_AREA, inBuilding: westInBuilding, tramPaths, islands: firstIslands } );
		const outer = kerbs;
		kerbs = {
			sdf: ( X, Y ) => inFirst( X, Y ) ? first.sdf( X, Y ) : outer.sdf( X, Y ),
			chains: [ ...first.chains.map( c => ( { ...c, keep: inFirst } ) ), ...outer.chains.map( c => ( { ...c, keep: ( X, Y ) => ! inFirst( X, Y ) && c.keep( X, Y ) } ) ) ]
		};

	}
	const unkerbed = r => r.highway === 'service' || r.highway === 'pedestrian';

	// Field values at a point: Fk = signed distance to a kerb line (> 0 on the raised pavement, 100: none near),
	// F = signed distance to any carriageway edge (< 0 on the road).
	function at( X, Y ) {

		const k = kerbs.sdf( X, Y );
		const Fk = k > 100 ? 100 : k;
		const r = nearestRoad( X, Y );
		const u = nearestRoad( X, Y, unkerbed );
		const o = nearestOpen( X, Y ), area = openAreaAt( X, Y );
		// Where carriageways overlap (a crossing), setts win over asphalt: the cobbled crossing of Národní with
		// Spálená and Na Perštýně, rather than a patchwork of whichever centreline is nearest.
		let asphalt = r.seg ? roads[ r.seg.item ].asphalt : 0;
		if ( r.seg && r.f < 0 ) {

			const s = nearestRoad( X, Y, item => item.asphalt < asphalt );
			if ( s.seg && s.f < 0 ) asphalt = roads[ s.seg.item ].asphalt;

		}

		return {
			F: Math.min( Fk, u.f ),
			Fk,
			roadAsphalt: asphalt,
			// null: no open area mapped near. A carriageway (residential, service) is no reason to pave a raised
			// pavement in its setts: the wide pavement corners at crossings stay mosaic.
			pavedArea: area !== null,
			openSurface: area ?? ( o.seg && o.d < 15 && ! ( Fk > 0 && Fk < RAMP_END && CARRIAGEWAY.has( openWays[ o.seg.item ].tags.highway ) ) ? surfaceValue( openWays[ o.seg.item ].tags.surface ) : null )
		};

	}

	const raise = Fk => Fk > 0 && Fk < RAMP_END ? KERB_HEIGHT : 0;

	// On a tram stop island (paved in plain concrete slabs, not mosaic).
	const islands = platforms.filter( p => p.island ).map( p => {

		const bbox = pts => {

			const xs = pts.map( q => q[ 0 ] ), ys = pts.map( q => q[ 1 ] );
			return [ Math.min( ...xs ) - p.half, Math.min( ...ys ) - p.half, Math.max( ...xs ) + p.half, Math.max( ...ys ) + p.half ];

		};
		return { ...p, bbox: bbox( p.pts ), oldBox: bbox( p.eastPts ), oldEligible: p.eastPts.some( ( [ X, Y ] ) => inEast( X, Y ) ) };

	} );
	const onPlatform = ( X, Y ) => {

		const old = inEast( X, Y );
		return islands.some( p => {

			const box = old ? p.oldBox : p.bbox, pts = old ? p.eastPts : p.pts;
			if ( X < box[ 0 ] || Y < box[ 1 ] || X > box[ 2 ] || Y > box[ 3 ] ) return false;
			if ( old && ! p.oldEligible ) return false;
			if ( p.closed ) return true;
			for ( let i = 0; i + 1 < pts.length; i ++ ) {

				const [ ax, ay ] = pts[ i ], [ bx, by ] = pts[ i + 1 ];
				const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
				const t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / l2 ) );
				if ( Math.hypot( X - ax - t * dx, Y - ay - t * dy ) < p.half + 0.3 ) return true;

			}
			return false;

		} );

	};

	return { roads, nodes, ways, at, raise, nearestRoad, inArea, kerbs, platforms, onPlatform, KERB_HEIGHT, RAMP_END };

}

/**
 * Raised pavement mesh: a 0.5 m grid (STEP) over the ground near kerbed roads, cells where skip( X, Y ) left out, split exactly along the kerb line
 * (Fk = 0, found by interpolating the field along cell edges), with a vertical kerb face along that line.
 * heightAt( X, Y ) returns the street-level ground height in the scene frame.
 */
export function buildPavementMesh( streets, { AREA, toLocal, heightAt, inBuilding, hidden, cut, STEP = 0.5, skip, maxSize = Infinity } ) {

	const OFFSET = 0.03; // above the terrain mesh, so the two never fight
	const KERB_FOOT = - 0.2;
	const W = Math.round( ( AREA.xmax - AREA.xmin ) / STEP ), H = Math.round( ( AREA.ymax - AREA.ymin ) / STEP );
	const field = new Float32Array( ( W + 1 ) * ( H + 1 ) );
	for ( let j = 0; j <= H; j ++ ) for ( let i = 0; i <= W; i ++ ) {

		field[ j * ( W + 1 ) + i ] = streets.at( AREA.xmin + i * STEP, AREA.ymax - j * STEP ).Fk;

	}

	const positions = [];
	const index = [];
	const vertexIds = new Map();
	const vertex = ( X, Y, lift, key ) => {

		if ( key !== undefined && vertexIds.has( key ) ) return vertexIds.get( key );
		const [ x, , z ] = toLocal( X, Y, 0 );
		positions.push( + x.toFixed( 3 ), + ( heightAt( X, Y ) + OFFSET + lift ).toFixed( 3 ), + z.toFixed( 3 ) );
		const id = positions.length / 3 - 1;
		if ( key !== undefined ) vertexIds.set( key, id );
		return id;

	};

	// Polygons arrive with corners running east then south (clockwise in S-JTSK); reversed, they face up in the scene.
	const face = ( ids ) => {

		for ( let k = 1; k + 1 < ids.length; k ++ ) index.push( ids[ 0 ], ids[ k + 1 ], ids[ k ] );

	};

	// Which cells are drawn how: 0 not at all, 1 whole cells on the pavement side (meshed together below, big
	// triangles where the pavement is flat), 2 cells the kerb crosses (cut into their pavement and road parts here).
	const kinds = new Uint8Array( W * H );
	for ( let j = 0; j < H; j ++ ) {

		for ( let i = 0; i < W; i ++ ) {

			const corners = [ [ i, j ], [ i + 1, j ], [ i + 1, j + 1 ], [ i, j + 1 ] ];
			const f = corners.map( ( [ a, b ] ) => field[ b * ( W + 1 ) + a ] );
			// Inside a house (no arcade or passage there): out of sight, the pavement's big triangles may run under it.
			if ( hidden && corners.every( ( [ a, b ] ) => hidden( AREA.xmin + a * STEP, AREA.ymax - b * STEP ) ) ) {

				kinds[ j * W + i ] = 3;
				continue;

			}

			if ( Math.max( ...f ) <= 0 || Math.min( ...f ) >= streets.RAMP_END ) continue;
			if ( Math.max( ...f ) >= 100 && Math.min( ...f ) <= 0 ) continue; // the end of a pavement band: no kerb
			const cx = AREA.xmin + ( i + 0.5 ) * STEP, cy = AREA.ymax - ( j + 0.5 ) * STEP;
			if ( skip?.( cx, cy ) ) continue; // meshed by another call
			if ( inBuilding( cx, cy ) && corners.every( ( [ a, b ] ) => inBuilding( AREA.xmin + a * STEP, AREA.ymax - b * STEP ) ) ) continue;
			// Over the edge of a wall (Smetanovo nábřeží's railing): the cell is left to the terrain.
			if ( cut && corners.some( ( [ a, b ] ) => cut( AREA.xmin + a * STEP, AREA.ymax - b * STEP ) ) ) continue;
			kinds[ j * W + i ] = Math.min( ...f ) > 0 ? 1 : 2;

		}

	}

	const gridId = ( [ a, b ] ) => `g${a},${b}`;
	const gridVertex = ( a, b ) => vertex( AREA.xmin + a * STEP, AREA.ymax - b * STEP, streets.raise( field[ b * ( W + 1 ) + a ] ), gridId( [ a, b ] ) );

	// The whole cells: one irregular triangulation (tools/rtin.mjs), within 4 cm of the pavement's surface.
	const n = rtinSize( Math.max( W, H ) + 1 );
	const surface = rtin( {
		maxSize,
		n,
		// Out of sight, a point stands at the height of a pavement there, so the triangles over it stay level.
		heightAt: ( a, b, unseen ) => a <= W && b <= H ? heightAt( AREA.xmin + a * STEP, AREA.ymax - b * STEP ) + ( unseen ? streets.KERB_HEIGHT : streets.raise( field[ b * ( W + 1 ) + a ] ) ) : 0,
		tolerance: () => 0.04,
		cellKind: ( i, j ) => i < W && j < H ? kinds[ j * W + i ] : 0
	} );
	for ( let t = 0; t < surface.triangles.length; t += 3 ) {

		const ids = [ 0, 1, 2 ].map( k => gridVertex( surface.triangles[ t + k ] % n, Math.floor( surface.triangles[ t + k ] / n ) ) );
		// Facing up (+y) in the scene frame.
		const [ p, q, r ] = ids.map( id => [ positions[ id * 3 ], positions[ id * 3 + 2 ] ] );
		const up = ( q[ 1 ] - p[ 1 ] ) * ( r[ 0 ] - p[ 0 ] ) - ( q[ 0 ] - p[ 0 ] ) * ( r[ 1 ] - p[ 1 ] );
		if ( up > 0 ) index.push( ids[ 0 ], ids[ 1 ], ids[ 2 ] );
		else index.push( ids[ 0 ], ids[ 2 ], ids[ 1 ] );

	}

	let kerbLength = 0;
	const kerbSegments = [];
	for ( let j = 0; j < H; j ++ ) {

		for ( let i = 0; i < W; i ++ ) {

			if ( kinds[ j * W + i ] !== 2 ) continue;
			const corners = [ [ i, j ], [ i + 1, j ], [ i + 1, j + 1 ], [ i, j + 1 ] ];
			const f = corners.map( ( [ a, b ] ) => field[ b * ( W + 1 ) + a ] );
			const P = corners.map( ( [ a, b ] ) => [ AREA.xmin + a * STEP, AREA.ymax - b * STEP ] );

			// The kerb crosses this cell: clip the square to its pavement part (the road part is the terrain's).
			const top = [], kerb = [];
			for ( let k = 0; k < 4; k ++ ) {

				const k2 = ( k + 1 ) % 4;
				const [ x0, y0 ] = P[ k ], [ x1, y1 ] = P[ k2 ];
				if ( f[ k ] > 0 ) top.push( gridVertex( ...corners[ k ] ) );
				if ( ( f[ k ] > 0 ) !== ( f[ k2 ] > 0 ) ) {

					const t = f[ k ] / ( f[ k ] - f[ k2 ] );
					const X = x0 + ( x1 - x0 ) * t, Y = y0 + ( y1 - y0 ) * t;
					const edgeKey = [ corners[ k ], corners[ k2 ] ].map( String ).sort().join( '|' );
					top.push( vertex( X, Y, streets.KERB_HEIGHT, `kt${edgeKey}` ) );
					kerb.push( [ X, Y, edgeKey ] );

				}

			}

			if ( top.length >= 3 ) face( top );

			// The kerb line through this cell, between its crossing points (pairs, in order around the cell).
			for ( let k = 0; k + 1 < kerb.length; k += 2 ) kerbSegments.push( [ kerb[ k ], kerb[ k + 1 ] ] );

		}

	}

	// Vertical kerb faces along the kerb lines, the lines chained from cell to cell and straightened where they run
	// within 4 cm of straight (a face every metre made most of the mesh). The faces have vertices of their own (so
	// their normals don't bend the pavement's); their foot goes down into the road, so the terrain mesh (within a few
	// cm of the ground) meets them. The mesh is drawn double-sided.
	const ends = new Map();
	kerbSegments.forEach( ( seg, i ) => {

		for ( const end of seg ) {

			if ( ! ends.has( end[ 2 ] ) ) ends.set( end[ 2 ], [] );
			ends.get( end[ 2 ] ).push( i );

		}

	} );
	const done = new Uint8Array( kerbSegments.length );
	const chain = ( start, from ) => {

		const line = [ from ];
		let i = start, at = from;
		while ( i !== undefined && ! done[ i ] ) {

			done[ i ] = 1;
			const [ p, q ] = kerbSegments[ i ], next = p[ 2 ] === at[ 2 ] ? q : p;
			line.push( next );
			at = next;
			i = ( ends.get( at[ 2 ] ) || [] ).find( j => ! done[ j ] );

		}

		return line;

	};
	const lines = [];
	for ( const [ , list ] of ends ) if ( list.length === 1 && ! done[ list[ 0 ] ] ) {

		const [ p, q ] = kerbSegments[ list[ 0 ] ];
		lines.push( chain( list[ 0 ], ends.get( p[ 2 ] ).length === 1 ? p : q ) );

	}

	kerbSegments.forEach( ( seg, i ) => {

		if ( ! done[ i ] ) lines.push( chain( i, seg[ 0 ] ) );

	} );
	const top = ( [ X, Y ] ) => heightAt( X, Y ) + streets.KERB_HEIGHT;
	const simplify = ( pts, i0, i1, keep ) => {

		const [ ax, ay ] = pts[ i0 ], [ bx, by ] = pts[ i1 ], ah = top( pts[ i0 ] ), bh = top( pts[ i1 ] );
		const len = Math.hypot( bx - ax, by - ay ) || 1e-9;
		let worst = - 1, at = - 1;
		for ( let i = i0 + 1; i < i1; i ++ ) {

			const [ x, y ] = pts[ i ], t = Math.max( 0, Math.min( 1, ( ( x - ax ) * ( bx - ax ) + ( y - ay ) * ( by - ay ) ) / ( len * len ) ) );
			const d = Math.max( Math.hypot( x - ax - t * ( bx - ax ), y - ay - t * ( by - ay ) ), Math.abs( top( pts[ i ] ) - ( ah + t * ( bh - ah ) ) ) );
			if ( d > worst ) {

				worst = d;
				at = i;

			}

		}

		if ( worst > 0.04 || i1 - i0 > 24 ) {

			simplify( pts, i0, at > 0 ? at : ( i0 + i1 ) >> 1, keep );
			simplify( pts, at > 0 ? at : ( i0 + i1 ) >> 1, i1, keep );

		} else keep.push( i1 );

	};
	for ( const line of lines ) {

		const keep = [ 0 ];
		if ( line.length > 1 ) simplify( line, 0, line.length - 1, keep );
		for ( let k = 1; k < keep.length; k ++ ) {

			const [ xa, ya, ka ] = line[ keep[ k - 1 ] ], [ xb, yb, kb ] = line[ keep[ k ] ];
			const a0 = vertex( xa, ya, KERB_FOOT, `fb${ka}` ), a1 = vertex( xa, ya, streets.KERB_HEIGHT, `ft${ka}` );
			const b0 = vertex( xb, yb, KERB_FOOT, `fb${kb}` ), b1 = vertex( xb, yb, streets.KERB_HEIGHT, `ft${kb}` );
			index.push( a0, a1, b1, a0, b1, b0 );
			kerbLength += Math.hypot( xb - xa, yb - ya );

		}

	}

	return { positions: new Float32Array( positions ), index: new Uint32Array( index ), kerbLength };

}

/**
 * Street furniture and crossings, as { type: [ x, y, z, rotation, scale, … ] } arrays in the scene frame.
 * heightAt( X, Y ) is the walking surface height (street level plus any raised pavement).
 */
export function collectFurniture( streets, { toLocal, heightAt, dsmTrees, treeHeightAt, stableTree = () => 0, tramPaths = [] } ) {

	const tramSegs = tramPaths.flatMap( p => p.slice( 1 ).map( ( q, i ) => [ p[ i ], q ] ) );
	const onTramLine = ( X, Y ) => tramSegs.some( ( [ [ ax, ay ], [ bx, by ] ] ) => {

		const dx = bx - ax, dy = by - ay, t = Math.max( 0, Math.min( 1, ( ( X - ax ) * dx + ( Y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
		return Math.hypot( X - ax - t * dx, Y - ay - t * dy ) < 4;

	} );

	const out = { lamp: [], bench: [], bin: [], bollard: [], bikestand: [], fountain: [], statue: [], shelter: [], tree: [], zebra: [], chimney: [] };
	const along = ( X, Y ) => {

		const r = streets.nearestRoad( X, Y );
		if ( ! r.seg ) return 0;
		return Math.atan2( r.seg.b.Y - r.seg.a.Y, r.seg.b.X - r.seg.a.X );

	};

	// S-JTSK direction angle (from +X towards +Y) → rotation about the scene's +y axis (z points south).
	const rotation = a => a;
	// Benches, bins and bike stands mapped on a carriageway (OSM points on squares where the road runs) are moved
	// to the nearest point off it within 4 m, else left out: no one sits in the road.
	const OFF_ROAD = new Set( [ 'bench', 'bin', 'bikestand' ] );
	const offRoad = ( X, Y ) => {

		if ( streets.at( X, Y ).F > 0.6 ) return [ X, Y ];
		for ( let r = 0.5; r <= 4; r += 0.5 ) for ( let k = 0; k < 16; k ++ ) {

			const P = X + r * Math.cos( k * Math.PI / 8 ), Q = Y + r * Math.sin( k * Math.PI / 8 );
			if ( streets.at( P, Q ).F > 0.9 ) return [ P, Q ];

		}

		return null;

	};

	let moved = 0, dropped = 0;
	const put = ( type, X, Y, a = 0, s = 1 ) => {

		if ( OFF_ROAD.has( type ) ) {

			const p = offRoad( X, Y );
			if ( ! p ) {

				dropped ++;
				return;

			}

			if ( p[ 0 ] !== X || p[ 1 ] !== Y ) moved ++;
			[ X, Y ] = p;

		}

		const [ x, , z ] = toLocal( X, Y, 0 );
		out[ type ].push( + x.toFixed( 2 ), + heightAt( X, Y ).toFixed( 2 ), + z.toFixed( 2 ), + rotation( a ).toFixed( 3 ), + s.toFixed( 2 ) );

	};

	for ( const n of streets.nodes.values() ) {

		const t = n.tags;
		if ( ! streets.inArea( n.X, n.Y ) ) continue;
		if ( t.highway === 'street_lamp' ) put( 'lamp', n.X, n.Y, along( n.X, n.Y ) );
		else if ( t.amenity === 'bench' ) put( 'bench', n.X, n.Y, t.direction ? - Number( t.direction ) * Math.PI / 180 : along( n.X, n.Y ) );
		else if ( t.amenity === 'waste_basket' ) put( 'bin', n.X, n.Y );
		else if ( t.barrier === 'bollard' ) put( 'bollard', n.X, n.Y );
		else if ( t.amenity === 'bicycle_parking' ) put( 'bikestand', n.X, n.Y, along( n.X, n.Y ), Math.min( 6, Math.max( 1, Math.round( ( Number( t.capacity ) || 4 ) / 2 ) ) ) );
		else if ( t.amenity === 'fountain' ) put( 'fountain', n.X, n.Y );
		else if ( ! NOT_STATUES.has( n.id ) && ( t.tourism === 'artwork' && ! ( t[ 'addr:conscriptionnumber' ] && ! t.name ) && ( t.artwork_type === 'statue' || t.artwork_type === 'sculpture' ) || t.historic === 'memorial' && t.memorial === 'statue' || t.historic === 'monument' ) ) put( 'statue', n.X, n.Y, along( n.X, n.Y ) );
		else if ( t.public_transport === 'platform' && t.shelter === 'yes' ) put( 'shelter', n.X, n.Y, along( n.X, n.Y ) );
		// A mapped tree in the middle of a tram street (Národní) is a planned or wrongly placed point: none stand there.
		else if ( t.natural === 'tree' && ! onTramLine( n.X, n.Y ) ) put( 'tree', n.X, n.Y, 0, treeHeightAt( n.X, n.Y ) );
		else if ( t.man_made === 'chimney' ) put( 'chimney', n.X, n.Y, 0, parseFloat( t.height ) || 30 );

	}

	// Trees found in the surface model that aren't mapped yet (≥ 3 m from any mapped tree).
	const mapped = [];
	const mappedLength = out.tree.length;
	for ( let i = 0; i < out.tree.length; i += 5 ) mapped.push( [ out.tree[ i ], out.tree[ i + 2 ] ] );
	for ( let i = 0; i < dsmTrees.length; i += 5 ) {

		const [ x, y, z, h ] = dsmTrees.slice( i, i + 4 );
		if ( mapped.some( ( [ mx, mz ] ) => Math.hypot( mx - x, mz - z ) < 3 ) ) continue;
		out.tree.push( x, y, z, 0, h );

	}

	// The crown blobs use the tree's array index at runtime. Keep the previous mapped trees and canopy peaks
	// ahead of newly covered trees, so extending the map does not turn every existing crown.
	const treeGroups = [ [], [], [] ];
	for ( let i = 0; i < out.tree.length; i += 5 ) {

		const entry = out.tree.slice( i, i + 5 );
		treeGroups[ stableTree( entry[ 0 ], entry[ 2 ], i >= mappedLength ) ].push( ...entry );

	}
	out.tree = treeGroups.flat();

	// Zebra crossings: marked crossing nodes on a carriageway, stripes across its full width.
	for ( const n of streets.nodes.values() ) {

		const t = n.tags;
		if ( t.highway !== 'crossing' || ! streets.inArea( n.X, n.Y ) ) continue;
		if ( ! /marked|zebra|uncontrolled|traffic_signals/.test( `${t.crossing || ''} ${t.crossing_ref || ''} ${t[ 'crossing:markings' ] || ''}` ) ) continue;
		const r = streets.nearestRoad( n.X, n.Y );
		if ( ! r.seg || r.f > 0 ) continue;
		const roadWidth = 2 * ( r.seg.ha + ( r.seg.hb - r.seg.ha ) * r.t );
		put( 'zebra', n.X, n.Y, along( n.X, n.Y ), roadWidth );

	}

	console.log( `furniture: ${moved} benches, bins and bike stands moved off the carriageway, ${dropped} left out` );
	return out;

}
