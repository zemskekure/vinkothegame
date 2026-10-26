// Validate a photo review before it changes the model. A failed review changes no repository files.

const HEX = /^#[0-9a-f]{6}$/i;
const GROUND = new Set( [ 'shops', 'restaurant', 'gate', 'windows', 'blank', 'default' ] );
const RUSTIC = new Set( [ 'none', 'banded', 'ornate', 'clad', 'rubble' ] );
const STYLES = new Set( [ 'default', 'theatre', 'maj', 'chapel', 'glassBlock', 'curtain', 'bronze', 'gothic' ] );
const OPENINGS = new Set( [ 'door', 'gate', 'shop', 'window', 'garage', 'niche', 'blank' ] );
const FRAMES = new Set( [ 'wood', 'dark', 'white', 'green', 'grey', 'red' ] );
const SIZES = new Set( [ 'narrow', 'normal', 'wide' ] );
const SIGN_KINDS = new Set( [ 'board', 'letters', 'hanging', 'plaque' ] );

const object = v => v && typeof v === 'object' && ! Array.isArray( v );
const bounded = ( v, lo, hi ) => typeof v === 'number' && Number.isFinite( v ) && v >= lo && v <= hi;
const colour = v => typeof v === 'string' && HEX.test( v );
const keys = ( v, allowed, at, errors ) => {

	for ( const k of Object.keys( v ) ) if ( ! allowed.includes( k ) ) errors.push( `${at}.${k}: unknown field` );

};

export function validateReview( review, inventory ) {

	const errors = [];
	if ( ! object( review ) ) return [ 'review must be an object' ];
	keys( review, [ 'houses', 'signs', 'issues', 'layoutIssues', 'visualIssues' ], 'review', errors );
	const fronts = new Map( inventory.fronts.map( f => [ f.front, f ] ) );
	if ( ! object( review.houses ) ) errors.push( 'houses must be an object' );
	if ( ! Array.isArray( review.signs ) ) errors.push( 'signs must be an array' );
	// Notes and mismatch texts only inform the next pass, so an over-long one is cut short rather than costing the tile.
	const cut = ( v, n ) => typeof v === 'string' && v.length > n ? v.slice( 0, n - 1 ) + '…' : v;
	if ( Array.isArray( review.issues ) ) review.issues = review.issues.map( v => cut( v, 500 ) );
	for ( const issue of Array.isArray( review.layoutIssues ) ? review.layoutIssues : [] ) if ( object( issue ) ) Object.assign( issue, { where: cut( issue.where, 120 ), evidence: cut( issue.evidence, 500 ) } );
	for ( const issue of Array.isArray( review.visualIssues ) ? review.visualIssues : [] ) if ( object( issue ) ) Object.assign( issue, { what: cut( issue.what, 300 ), evidence: cut( issue.evidence, 500 ) } );
	if ( ! Array.isArray( review.issues ) || review.issues.some( v => typeof v !== 'string' ) ) errors.push( 'issues must be short strings' );
	if ( ! Array.isArray( review.layoutIssues ) ) errors.push( 'layoutIssues must be an array' );
	if ( ! Array.isArray( review.visualIssues ) ) errors.push( 'visualIssues must be an array, even when no visible mismatch remains' );
	for ( const [ n, issue ] of ( Array.isArray( review.layoutIssues ) ? review.layoutIssues : [] ).entries() ) {

		if ( ! object( issue ) || ! [ 'street', 'passage', 'arcade', 'steps', 'building', 'surface', 'other' ].includes( issue.kind ) || typeof issue.where !== 'string' || ! issue.where.trim() || issue.where.length > 120 || typeof issue.evidence !== 'string' || ! issue.evidence.trim() || issue.evidence.length > 500 ) errors.push( `layoutIssues[${n}]: kind, where and photo evidence required` );

	}
	for ( const [ n, issue ] of ( Array.isArray( review.visualIssues ) ? review.visualIssues : [] ).entries() ) {

		if ( ! object( issue ) || ! fronts.has( issue.front ) || typeof issue.what !== 'string' || ! issue.what.trim() || issue.what.length > 300 || typeof issue.evidence !== 'string' || ! issue.evidence.trim() || issue.evidence.length > 500 ) errors.push( `visualIssues[${n}]: reviewed front, visible mismatch and photo evidence required` );

	}
	for ( const [ code, h ] of Object.entries( object( review.houses ) ? review.houses : {} ) ) {

		const at = `houses.${code}`;
		if ( ! object( h ) ) { errors.push( `${at}: expected object` ); continue; }
		keys( h, [ 'fronts', 'colour', 'trim', 'floors', 'ground', 'rustic', 'grilles', 'graffiti', 'style', 'roof', 'edges', 'note', 'confidence' ], at, errors );
		if ( ! Array.isArray( h.fronts ) || ! h.fronts.length || h.fronts.some( f => ! fronts.has( f ) || String( fronts.get( f ).code ) !== code ) ) errors.push( `${at}.fronts: use this square's fronts of this house` );
		if ( typeof h.note !== 'string' || ! h.note.trim() || h.note.length > 500 ) errors.push( `${at}.note: required factual source note (max 500 characters)` );
		if ( ! [ 'high', 'medium', 'low' ].includes( h.confidence ) ) errors.push( `${at}.confidence: high, medium or low required` );
		for ( const k of [ 'colour', 'trim' ] ) if ( h[ k ] !== undefined && ! colour( h[ k ] ) ) errors.push( `${at}.${k}: expected #rrggbb` );
		if ( h.floors !== undefined && ( ! Number.isInteger( h.floors ) || h.floors < 1 || h.floors > 9 ) ) errors.push( `${at}.floors: 1…9 required` );
		if ( h.ground !== undefined && ! GROUND.has( h.ground ) ) errors.push( `${at}.ground: unknown kind` );
		if ( h.rustic !== undefined && ! RUSTIC.has( h.rustic ) ) errors.push( `${at}.rustic: unknown kind` );
		if ( h.style !== undefined && ! STYLES.has( h.style ) ) errors.push( `${at}.style: unknown style` );
		if ( h.roof !== undefined && h.roof !== 'flat' ) errors.push( `${at}.roof: only flat is supported` );
		for ( const k of [ 'grilles', 'graffiti' ] ) if ( h[ k ] !== undefined && typeof h[ k ] !== 'boolean' ) errors.push( `${at}.${k}: expected boolean` );
		if ( h.edges !== undefined && ! object( h.edges ) ) { errors.push( `${at}.edges: expected object` ); continue; }
		for ( const [ edge, e ] of Object.entries( h.edges || {} ) ) {

			const front = `${code}_${edge}`, where = `${at}.edges.${edge}`;
			if ( ! fronts.has( front ) || ! h.fronts?.includes( front ) ) errors.push( `${where}: front must be in houses.${code}.fronts` );
			if ( ! object( e ) ) { errors.push( `${where}: expected object` ); continue; }
			keys( e, [ 'awning', 'lanterns', 'banner', 'ground', 'balconies', 'shopfront', 'shopfrontHeight', 'style', 'colour', 'trim', 'rustic' ], where, errors );
			for ( const k of [ 'colour', 'trim' ] ) if ( e[ k ] !== undefined && ! colour( e[ k ] ) ) errors.push( `${where}.${k}: expected #rrggbb` );
			if ( e.rustic !== undefined && ! RUSTIC.has( e.rustic ) ) errors.push( `${where}.rustic: unknown kind` );
			if ( e.style !== undefined && ! STYLES.has( e.style ) ) errors.push( `${where}.style: unknown style` );
			if ( e.awning !== undefined && ! colour( e.awning ) ) errors.push( `${where}.awning: expected #rrggbb` );
			if ( e.lanterns !== undefined && typeof e.lanterns !== 'boolean' ) errors.push( `${where}.lanterns: expected boolean` );
			if ( e.banner !== undefined && ( ! object( e.banner ) || typeof e.banner.text !== 'string' || e.banner.text.length > 30 || ! colour( e.banner.board ) || ! colour( e.banner.ink ) ) ) errors.push( `${where}.banner: text, board and ink required` );
			if ( e.ground !== undefined ) {

				if ( ! Array.isArray( e.ground ) || e.ground.length > 32 ) errors.push( `${where}.ground: expected up to 32 openings` );
				else for ( const [ n, item ] of e.ground.entries() ) {

					const g = typeof item === 'string' ? { kind: item } : item;
					if ( ! object( g ) || ! OPENINGS.has( g.kind ) ) { errors.push( `${where}.ground[${n}]: unknown opening` ); continue; }
					keys( g, [ 'kind', 'frame', 'size', 'arch', 'bars', 'glazed', 'door' ], `${where}.ground[${n}]`, errors );
					if ( g.frame !== undefined && ! FRAMES.has( g.frame ) ) errors.push( `${where}.ground[${n}].frame: unknown frame` );
					if ( g.size !== undefined && ! SIZES.has( g.size ) ) errors.push( `${where}.ground[${n}].size: unknown size` );
					for ( const k of [ 'arch', 'bars', 'glazed', 'door' ] ) if ( g[ k ] !== undefined && typeof g[ k ] !== 'boolean' ) errors.push( `${where}.ground[${n}].${k}: expected boolean` );

				}

			}
			if ( e.balconies !== undefined ) {

				if ( ! Array.isArray( e.balconies ) || e.balconies.length > 12 ) errors.push( `${where}.balconies: expected up to 12 balconies` );
				else for ( const b of e.balconies ) if ( ! object( b ) || ! Number.isInteger( b.floor ) || ! bounded( b.floor, 1, 8 ) || ! bounded( b.from, 0, 1 ) || ! bounded( b.to, 0, 1 ) || b.to <= b.from || ! bounded( b.depth, 0.2, 2.5 ) ) errors.push( `${where}.balconies: floor, from, to and depth required` );

			}
			if ( e.shopfront !== undefined && e.shopfront !== `${front}.svg` ) errors.push( `${where}.shopfront: expected ${front}.svg` );
			if ( e.shopfrontHeight !== undefined && ( ! e.shopfront || ! bounded( e.shopfrontHeight, 2, 6.5 ) ) ) errors.push( `${where}.shopfrontHeight: requires a drawn front and 2–6.5 m` );
		}

	}
	for ( const [ n, s ] of ( Array.isArray( review.signs ) ? review.signs : [] ).entries() ) {

		const at = `signs[${n}]`;
		if ( ! object( s ) ) { errors.push( `${at}: expected object` ); continue; }
		keys( s, [ 'front', 'fromLeft', 'height', 'kind', 'text', 'sub', 'width', 'bg', 'ink', 'font', 'what' ], at, errors );
		if ( ! fronts.has( s.front ) || ! review.houses?.[ String( fronts.get( s.front )?.code ) ]?.fronts?.includes( s.front ) ) errors.push( `${at}.front: must be reviewed in this square` );
		if ( ! bounded( s.fromLeft, 0, 1 ) || ! bounded( s.height, 0.5, 12 ) || ! bounded( s.width, 0.2, 20 ) ) errors.push( `${at}: fromLeft, height and width out of range` );
		if ( ! SIGN_KINDS.has( s.kind ) || typeof s.text !== 'string' || ! s.text.trim() || s.text.length > 60 ) errors.push( `${at}: kind or text invalid` );
		if ( s.sub !== undefined && ( typeof s.sub !== 'string' || s.sub.length > 60 ) ) errors.push( `${at}.sub: expected short text` );
		for ( const k of [ 'bg', 'ink' ] ) if ( s[ k ] !== undefined && ! colour( s[ k ] ) ) errors.push( `${at}.${k}: expected #rrggbb` );
		if ( s.font !== undefined && ! [ 'serif', 'sans', 'script' ].includes( s.font ) ) errors.push( `${at}.font: unsupported` );
		if ( typeof s.what !== 'string' || ! s.what.trim() || s.what.length > 200 ) errors.push( `${at}.what: describe the visible sign` );

	}
	return errors;

}

// SVGs are authored drawings, not containers for scripts, remote images, stylesheets or embedded photos.
export function validateShopfrontSvg( svg, front ) {

	const errors = [];
	if ( typeof svg !== 'string' || svg.length > 200000 ) return [ 'SVG must be text under 200 KB' ];
	if ( /<!|<\?|\bon[a-z]+\s*=|\b(?:href|style|class|id)\s*=|url\s*\(|data:|javascript:|&(?!(?:amp|lt|gt|quot|apos);)/i.test( svg ) ) errors.push( 'SVG contains a forbidden reference, style, entity or executable feature' );
	const tags = [ ...svg.matchAll( /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g ) ].map( m => m[ 1 ] );
	if ( ! tags.length || tags[ 0 ] !== 'svg' || ! /<\/svg>\s*$/.test( svg ) ) errors.push( 'SVG root required' );
	const allowed = new Set( [ 'svg', 'g', 'rect', 'path', 'line', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan' ] );
	for ( const tag of tags ) if ( ! allowed.has( tag ) ) errors.push( `unsupported SVG element ${tag}` );
	const opening = svg.match( /<svg\b([^>]*)>/ );
	const vb = opening?.[ 1 ].match( /\bviewBox="0 0 ([\d.]+) ([\d.]+)"/ );
	if ( ! vb || ! bounded( Number( vb[ 2 ] ), 200, 650 ) || ! bounded( Number( vb[ 1 ] ), front.len * 80, front.len * 120 ) ) errors.push( `viewBox must start at 0 0, span about ${Math.round( front.len * 100 )} cm, and be 200–650 cm high` );
	const attrs = new Set( [ 'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'rx', 'ry', 'r', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'transform' ] );
	for ( const m of svg.matchAll( /<([a-zA-Z][\w:-]*)\b([^>]*)>/g ) ) {

		let remainder = m[ 2 ].replace( /\/\s*$/, '' );
		remainder = remainder.replace( /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g, ( all, key, value ) => {

			if ( ! attrs.has( key ) || value.length > 5000 || /[<>]/.test( value ) ) errors.push( `unsupported SVG attribute ${key}` );
			return '';

		} );
		if ( remainder.trim() ) errors.push( `invalid attributes on ${m[ 1 ]}` );

	}
	return [ ...new Set( errors ) ];

}
