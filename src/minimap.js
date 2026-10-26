// Minimap (GTA-style): a round map around the player that turns with the camera, drawn from the scene's own data
// (houses, carriageways, pavements, parks, the river) into a 1 px = 1 m image once; the player arrow in the middle,
// the signature places as markers (pinned to the rim when out of range) and N on the rim. Framed in the HUD's
// console style (src/hud.js): a thick black rim with a cream ring.

const PIXEL = `'Pixelify Sans', system-ui, sans-serif`;

const COLOURS = {
	river: [ 104, 149, 178 ],
	park: [ 151, 176, 120 ],
	house: [ 214, 200, 180 ],
	road: [ 92, 96, 102 ],
	pavement: [ 186, 182, 172 ],
	ground: [ 160, 156, 148 ]
};

export function createMinimap( { bounds, image, cell = 1, markers, touch } ) {

	// The whole city's map (tools/tiles.mjs draws it once, in COLOURS, bridges and house outlines included).
	const S = { cell }, W = image.width, H = image.height;
	const map = document.createElement( 'canvas' );
	map.width = image.width;
	map.height = image.height;
	map.getContext( '2d' ).drawImage( image, 0, 0 );
	image.close?.();

	// The on-screen dial.
	const size = touch ? 128 : 190;
	const view = document.createElement( 'canvas' );
	const dpr = Math.min( 2, window.devicePixelRatio || 1 );
	view.width = view.height = size * dpr;
	view.style.cssText = `position:fixed;${ touch ? 'right:16px;top:16px' : 'left:24px;bottom:24px' };width:${size}px;height:${size}px;border-radius:50%;box-sizing:border-box;border:4px solid #000;box-shadow:0 0 0 3px #f4ecd2,0 0 0 6px #000,7px 7px 0 6px rgba(0,0,0,0.45);z-index:2;cursor:pointer;display:none`;
	view.title = 'Mapa (Tab): klikni a přenes se';
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

		// North on the rim: an orange tab with a hard edge.
		const [ nx, ny ] = toDial( x, z - 1e6 );
		const nl = Math.hypot( nx, ny ), nr = R - 11 * dpr;
		v.fillStyle = '#c4562f';
		v.beginPath();
		v.arc( R + nx / nl * nr, R + ny / nl * nr, 10 * dpr, 0, Math.PI * 2 );
		v.fill();
		v.lineWidth = 2 * dpr;
		v.strokeStyle = '#000';
		v.stroke();
		v.font = `${ 16 * dpr }px ${PIXEL}`;
		v.fillStyle = '#ffd34a';
		v.fillText( 'N', R + nx / nl * nr, R + ny / nl * nr + 1 * dpr );

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
		v.fillStyle = '#ffd34a';
		v.fill();
		v.lineWidth = 2 * dpr;
		v.strokeStyle = '#000';
		v.stroke();
		v.restore();

		// A dark inner edge, as if the map sat in a bezel.
		v.beginPath();
		v.arc( R, R, R - 1.5 * dpr, 0, Math.PI * 2 );
		v.lineWidth = 3 * dpr;
		v.strokeStyle = 'rgba(0,0,0,0.35)';
		v.stroke();

	}

	// The big map: the whole area north up, filling the screen; a click on it picks a place to go to (onPick), the
	// street under the pointer is named (labelAt). Esc, Tab or a click beside the map closes it.
	let open = null;
	function openMap( { x, z, onPick, onClose, labelAt } ) {

		if ( open ) return;
		const layer = document.createElement( 'div' );
		layer.style.cssText = `position:fixed;inset:0;z-index:20;background:rgba(10,12,18,0.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:crosshair;font:16px ${PIXEL};color:#f4ecd2`;
		const head = document.createElement( 'div' );
		head.style.cssText = 'font-size:32px;line-height:1;color:#ffd34a;text-shadow:3px 3px 0 #000;pointer-events:none';
		head.textContent = 'MAPA';
		const big = document.createElement( 'canvas' );
		const fit = Math.min( ( innerWidth - 48 ) / W, ( innerHeight - 140 ) / H );
		big.style.cssText = `width:${Math.floor( W * fit )}px;height:${Math.floor( H * fit )}px;box-sizing:border-box;border:4px solid #000;box-shadow:0 0 0 3px #f4ecd2,0 0 0 6px #000,8px 8px 0 6px rgba(0,0,0,0.5);image-rendering:pixelated`;
		big.width = Math.floor( W * fit * dpr );
		big.height = Math.floor( H * fit * dpr );
		const tip = document.createElement( 'div' );
		tip.style.cssText = 'min-height:22px;padding:4px 12px;background:rgba(16,20,30,0.92);border:3px solid #000;text-shadow:2px 2px 0 #000;pointer-events:none;white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis';
		const idle = 'Klikni, kam se přenést · Esc zavřít';
		tip.textContent = idle;
		layer.append( head, big, tip );
		document.body.appendChild( layer );

		const b = big.getContext( '2d' ), kx = big.width / W, ky = big.height / H;
		b.imageSmoothingEnabled = false;
		b.drawImage( map, 0, 0, big.width, big.height );
		const toBig = ( px, pz ) => [ ( px - bounds.minX ) / S.cell * kx, ( pz - bounds.minZ ) / S.cell * ky ];
		b.font = `600 ${ 10 * dpr }px system-ui, sans-serif`;
		b.textAlign = 'center';
		b.textBaseline = 'middle';
		for ( const m of markers ) {

			const [ mx, my ] = toBig( m.x, m.z );
			b.beginPath();
			b.arc( mx, my, 7 * dpr, 0, Math.PI * 2 );
			b.fillStyle = m.colour;
			b.fill();
			b.lineWidth = 1.5 * dpr;
			b.strokeStyle = '#fff';
			b.stroke();
			b.fillStyle = '#fff';
			b.fillText( m.icon, mx, my + 0.5 * dpr );

		}

		const [ px, py ] = toBig( x, z );
		b.beginPath();
		b.arc( px, py, 7 * dpr, 0, Math.PI * 2 );
		b.fillStyle = '#ffd34a';
		b.fill();
		b.lineWidth = 3 * dpr;
		b.strokeStyle = '#000';
		b.stroke();

		const at = e => {

			const r = big.getBoundingClientRect();
			const u = ( e.clientX - r.left ) / r.width, w = ( e.clientY - r.top ) / r.height;
			return u < 0 || u > 1 || w < 0 || w > 1 ? null : [ bounds.minX + u * W * S.cell, bounds.minZ + w * H * S.cell ];

		};

		const close = () => {

			layer.remove();
			removeEventListener( 'keydown', key, true );
			open = null;
			onClose?.();

		};

		const key = e => {

			if ( e.code === 'Escape' || e.code === 'Tab' ) {

				e.preventDefault();
				e.stopPropagation();
				close();

			}

		};

		addEventListener( 'keydown', key, true );
		layer.addEventListener( 'pointermove', e => {

			const p = at( e );
			tip.textContent = p && labelAt ? `${labelAt( p[ 0 ], p[ 1 ] ) || 'Sem'} · klikni pro přenesení` : idle;

		} );
		layer.addEventListener( 'click', e => {

			const p = at( e );
			close();
			if ( p ) onPick( p[ 0 ], p[ 1 ] );

		} );
		open = { close };

	}

	return {
		update,
		map, // the whole area at S.cell metres a pixel, north up (the admin page draws on it)
		view, // the dial (main.js opens the big map from a click on it)
		openMap,
		get isOpen() {

			return !! open;

		},
		setVisible: on => {

			view.style.display = on ? 'block' : 'none';

		}
	};

}
