import * as THREE from 'three/webgpu';

const EYE = 1.7;
const RADIUS = 0.35;

// First-person walking: pointer-lock mouse look and WASD, or on touch screens a joystick
// (bottom left) to walk and a drag anywhere else to look; terrain following,
// sliding collisions against building footprints.
export class Walker {

	constructor( camera, dom, groundHeight, isBlocked ) {

		this.camera = camera;
		this.groundHeight = groundHeight;
		this.isBlocked = isBlocked;
		this.enabled = false;
		this.yaw = 0;
		this.pitch = 0;
		this.keys = new Set();
		this.y = 0;

		dom.addEventListener( 'click', () => {

			if ( this.enabled && document.pointerLockElement !== dom ) dom.requestPointerLock();

		} );

		document.addEventListener( 'mousemove', e => {

			if ( ! this.enabled || document.pointerLockElement !== dom ) return;
			this.yaw -= e.movementX * 0.0022;
			this.pitch = THREE.MathUtils.clamp( this.pitch - e.movementY * 0.0022, - 1.4, 1.4 );

		} );

		// Touch: drag on the canvas to look around.
		this.stick = { x: 0, y: 0 };
		let look = null;
		dom.addEventListener( 'pointerdown', e => {

			if ( ! this.enabled || e.pointerType === 'mouse' || look ) return;
			look = { id: e.pointerId, x: e.clientX, y: e.clientY };

		} );
		window.addEventListener( 'pointermove', e => {

			if ( ! look || e.pointerId !== look.id ) return;
			this.yaw += ( e.clientX - look.x ) * 0.005;
			this.pitch = THREE.MathUtils.clamp( this.pitch + ( e.clientY - look.y ) * 0.005, - 1.4, 1.4 );
			look.x = e.clientX;
			look.y = e.clientY;

		} );
		const endLook = e => {

			if ( look && e.pointerId === look.id ) look = null;

		};
		window.addEventListener( 'pointerup', endLook );
		window.addEventListener( 'pointercancel', endLook );

		this.joystick = this.createJoystick();

		window.addEventListener( 'keydown', e => this.keys.add( e.code ) );
		window.addEventListener( 'keyup', e => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

	}

	// On-screen joystick for touch screens: pushing the knob to the rim walks, past it runs.
	createJoystick() {

		const base = document.createElement( 'div' );
		base.style.cssText = 'position:fixed;left:28px;bottom:28px;width:120px;height:120px;border-radius:50%;background:rgba(20,24,30,0.35);border:2px solid rgba(255,255,255,0.5);touch-action:none;display:none;z-index:2';
		const knob = document.createElement( 'div' );
		knob.style.cssText = 'position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(232,217,181,0.9);pointer-events:none';
		base.appendChild( knob );
		document.body.appendChild( base );

		let id = null;
		const move = e => {

			const r = base.getBoundingClientRect();
			let dx = ( e.clientX - r.left - 60 ) / 45, dy = ( e.clientY - r.top - 60 ) / 45;
			const len = Math.hypot( dx, dy );
			this.stick.x = dx;
			this.stick.y = dy;
			if ( len > 1 ) dx /= len, dy /= len;
			knob.style.transform = `translate(${ dx * 45 }px, ${ dy * 45 }px)`;

		};
		const end = e => {

			if ( e.pointerId !== id ) return;
			id = null;
			this.stick.x = this.stick.y = 0;
			knob.style.transform = '';

		};
		base.addEventListener( 'pointerdown', e => {

			e.preventDefault();
			id = e.pointerId;
			base.setPointerCapture( id );
			move( e );

		} );
		base.addEventListener( 'pointermove', e => e.pointerId === id && move( e ) );
		base.addEventListener( 'pointerup', end );
		base.addEventListener( 'pointercancel', end );
		return base;

	}

	setEnabled( enabled, touch ) {

		this.enabled = enabled;
		this.joystick.style.display = enabled && touch ? 'block' : 'none';
		if ( ! enabled ) this.stick.x = this.stick.y = 0;

	}

	teleport( x, z, yaw ) {

		// Nearest open spot to the requested one (spiral search on a 1 m grid).
		search: for ( let r = 0; r < 60; r ++ ) {

			for ( let a = 0; a < Math.max( 1, r * 8 ); a ++ ) {

				const t = a / Math.max( 1, r * 8 ) * Math.PI * 2;
				const px = x + Math.cos( t ) * r, pz = z + Math.sin( t ) * r;
				const clear = [ 0, 1, 2, 3, 4, 5, 6, 7 ].every( k => ! this.blocked( px + Math.cos( k * Math.PI / 4 ) * 2.5, pz + Math.sin( k * Math.PI / 4 ) * 2.5 ) );
				if ( clear && ! this.blocked( px, pz ) ) {

					x = px; z = pz;
					break search;

				}

			}

		}

		this.camera.position.set( x, 0, z );
		this.yaw = yaw;
		this.pitch = 0.05;
		this.y = this.groundHeight( x, z ) + EYE;
		this.apply();

	}

	blocked( x, z ) {

		for ( const [ dx, dz ] of [ [ 0, 0 ], [ RADIUS, 0 ], [ - RADIUS, 0 ], [ 0, RADIUS ], [ 0, - RADIUS ] ] ) {

			if ( this.isBlocked( x + dx, z + dz ) ) return true;

		}

		return false;

	}

	update( dt ) {

		const k = this.keys;
		let forward = ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 ) - ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 );
		let strafe = ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 );
		let speed = k.has( 'ShiftLeft' ) || k.has( 'ShiftRight' ) ? 7 : 2.4;

		const push = Math.hypot( this.stick.x, this.stick.y );
		if ( push > 0.15 ) {

			forward = - this.stick.y;
			strafe = this.stick.x;
			speed = push > 1.25 ? 7 : 2.4 * Math.min( 1, push );

		}

		if ( forward || strafe ) {

			const len = Math.hypot( forward, strafe );
			const sin = Math.sin( this.yaw ), cos = Math.cos( this.yaw );
			const dx = ( - sin * forward + cos * strafe ) / len * speed * dt;
			const dz = ( - cos * forward - sin * strafe ) / len * speed * dt;
			const p = this.camera.position;

			// Slide along walls: try the full move, then each axis alone. Stuck inside a footprint: walk out freely.
			if ( this.blocked( p.x, p.z ) || ! this.blocked( p.x + dx, p.z + dz ) ) p.x += dx, p.z += dz;
			else if ( ! this.blocked( p.x + dx, p.z ) ) p.x += dx;
			else if ( ! this.blocked( p.x, p.z + dz ) ) p.z += dz;

		}

		const target = this.groundHeight( this.camera.position.x, this.camera.position.z ) + EYE;
		this.y += ( target - this.y ) * Math.min( 1, dt * 10 );
		this.apply();

	}

	apply() {

		this.camera.position.y = this.y;
		this.camera.rotation.set( this.pitch, this.yaw, 0, 'YXZ' );

	}

}
