// Minimap (GTA-style): a round map around the player that turns with the camera, drawn from the scene's own data
// (houses, carriageways, pavements, parks, the river) into a 1 px = 1 m image once; the player arrow in the middle,
// the signature places as markers (pinned to the rim when out of range) and N on the rim.

const COLOURS = {
	river: [ 104, 149, 178 ],
	park: [ 151, 176, 120 ],
	house: [ 214, 200, 180 ],
	road: [ 92, 96, 102 ],
	pavement: [ 186, 182, 172 ],
	ground: [ 160, 156, 148 ]
};

export function createMinimap( { bounds, surface, surface2, S, isHouse, terrainHeight, waterLevel, markers, touch } ) {

	const W = S.width, H = S.height;
	const map = document.createElement( 'canvas' );
	map.width = W;
	map.height = H;
	const ctx = map.getContext( '2d' );
	const img = ctx.createImageData( W, H );
	for ( let r = 0; r < H; r ++ ) for ( let c = 0; c < W; c ++ ) {

		const i = r * W + c;
		const x = bounds.minX + ( c + 0.5 ) * S.cell, z = bounds.minZ + ( r + 0.5 ) * S.cell;
		const F = ( 128 - surface[ i * 4 + 2 ] ) / 25, Fk = ( 128 - surface2[ i * 4 + 2 ] ) / 25;
		let col = COLOURS.ground;
		if ( isHouse( x, z ) ) col = COLOURS.house;
		else if ( terrainHeight( x, z ) < waterLevel ) col = COLOURS.river;
		else if ( surface[ i * 4 + 1 ] > 128 ) col = COLOURS.park;
		else if ( F < 0 ) col = COLOURS.road;
		else if ( Fk > 0 && Fk < 8.5 ) col = COLOURS.pavement;
		img.data.set( [ ...col, 255 ], i * 4 );

	}

	ctx.putImageData( img, 0, 0 );

	// House outlines: darken house pixels next to open ground.
	const d = ctx.getImageData( 0, 0, W, H );
	const house = ( c, r ) => d.data[ ( r * W + c ) * 4 ] === COLOURS.house[ 0 ] && d.data[ ( r * W + c ) * 4 + 1 ] === COLOURS.house[ 1 ];
	const edge = new Uint8Array( W * H );
	for ( let r = 1; r < H - 1; r ++ ) for ( let c = 1; c < W - 1; c ++ ) if ( house( c, r ) && ( ! house( c - 1, r ) || ! house( c + 1, r ) || ! house( c, r - 1 ) || ! house( c, r + 1 ) ) ) edge[ r * W + c ] = 1;
	for ( let i = 0; i < W * H; i ++ ) if ( edge[ i ] ) d.data.set( [ 150, 138, 122 ], i * 4 );
	ctx.putImageData( d, 0, 0 );

	// The on-screen dial.
	const size = touch ? 128 : 190;
	const view = document.createElement( 'canvas' );
	const dpr = Math.min( 2, window.devicePixelRatio || 1 );
	view.width = view.height = size * dpr;
	view.style.cssText = `position:fixed;${ touch ? 'right:12px;top:12px' : 'left:16px;bottom:16px' };width:${size}px;height:${size}px;border-radius:50%;box-shadow:0 2px 10px rgba(0,0,0,0.45);border:3px solid rgba(20,24,30,0.75);z-index:2;pointer-events:none;display:none`;
	document.body.appendChild( view );
	const v = view.getContext( '2d' );
	const RANGE = touch ? 70 : 85; // metres from the centre to the rim

	function update( x, z, yaw, heading ) {

		const R = size * dpr / 2, k = R / RANGE;
		v.setTransform( 1, 0, 0, 1, 0, 0 );
		v.clearRect( 0, 0, R * 2, R * 2 );
		v.save();
		v.beginPath();
		v.arc( R, R, R, 0, Math.PI * 2 );
		v.clip();
		v.fillStyle = 'rgb(160,156,148)';
		v.fillRect( 0, 0, R * 2, R * 2 );

		// Camera forward ( −sin yaw, −cos yaw ) points up on the dial.
		v.translate( R, R );
		v.rotate( yaw );
		v.scale( k / S.cell, k / S.cell );
		v.imageSmoothingEnabled = true;
		v.drawImage( map, - ( x - bounds.minX ) / S.cell, - ( z - bounds.minZ ) / S.cell );
		v.restore();

		// Markers: rotate their offsets the same way; clamp to the rim.
		const cos = Math.cos( yaw ), sin = Math.sin( yaw );
		const toDial = ( px, pz ) => {

			const dx = ( px - x ) * k, dz = ( pz - z ) * k;
			return [ dx * cos - dz * sin, dx * sin + dz * cos ];

		};

		v.font = `600 ${ 10 * dpr }px system-ui, sans-serif`;
		v.textAlign = 'center';
		v.textBaseline = 'middle';
		for ( const m of markers ) {

			let [ mx, my ] = toDial( m.x, m.z );
			const dist = Math.hypot( mx, my ), max = R - 9 * dpr;
			const inside = dist <= max;
			if ( ! inside ) {

				mx *= max / dist;
				my *= max / dist;

			}

			v.beginPath();
			v.arc( R + mx, R + my, ( inside ? 7 : 5 ) * dpr, 0, Math.PI * 2 );
			v.fillStyle = m.colour;
			v.fill();
			v.lineWidth = 1.5 * dpr;
			v.strokeStyle = '#fff';
			v.stroke();
			v.fillStyle = '#fff';
			if ( inside ) v.fillText( m.icon, R + mx, R + my + 0.5 * dpr );

		}

		// North on the rim.
		const [ nx, ny ] = toDial( x, z - 1e6 );
		const nl = Math.hypot( nx, ny );
		v.fillStyle = 'rgba(20,24,30,0.8)';
		v.beginPath();
		v.arc( R + nx / nl * ( R - 9 * dpr ), R + ny / nl * ( R - 9 * dpr ), 8 * dpr, 0, Math.PI * 2 );
		v.fill();
		v.fillStyle = '#fff';
		v.fillText( 'N', R + nx / nl * ( R - 9 * dpr ), R + ny / nl * ( R - 9 * dpr ) + 0.5 * dpr );

		// The player: an arrow in the figure's heading.
		const [ hx, hy ] = toDial( x + Math.sin( heading ), z + Math.cos( heading ) );
		const a = Math.atan2( hy, hx );
		v.save();
		v.translate( R, R );
		v.rotate( a + Math.PI / 2 );
		v.beginPath();
		v.moveTo( 0, - 9 * dpr );
		v.lineTo( 6.5 * dpr, 7 * dpr );
		v.lineTo( 0, 3.5 * dpr );
		v.lineTo( - 6.5 * dpr, 7 * dpr );
		v.closePath();
		v.fillStyle = '#c4533a';
		v.fill();
		v.lineWidth = 2 * dpr;
		v.strokeStyle = '#fff';
		v.stroke();
		v.restore();

	}

	return {
		update,
		setVisible: on => {

			view.style.display = on ? 'block' : 'none';

		}
	};

}
