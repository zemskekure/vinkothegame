import * as THREE from 'three/webgpu';
import { makeFigure } from './figures.js';
import { makeMoped } from './moped.js';

const RADIUS = 0.35;
const WALK = 1.7, RUN = 5.2;
// On the moped: top speed about 40 km/h, brisk town acceleration, steering that tightens as it slows.
const MOPED = { max: 11, reverse: 2, accel: 4.5, brake: 9, drag: 1.6, turn: 2.2 };

// Third-person walking (GTA-style): your figure in the street with the camera behind it. Mouse look (pointer
// lock) and WASD, Shift to run, the wheel to zoom, V for first person; on touch screens a joystick (bottom left)
// to walk and a drag anywhere else to look. The figure turns towards where it walks; the camera pulls in when a
// house stands between it and the figure. Terrain following, sliding collisions against building footprints.
// B gets on or off a moped: W/S throttle and brake, A/D steer, and the camera swings in behind.
export class Walker {

	constructor( camera, dom, groundHeight, isBlocked, scene, cameraBlocked = isBlocked, ceilingAt = () => Infinity ) {

		this.camera = camera;
		this.groundHeight = groundHeight;
		this.isBlocked = isBlocked;
		this.cameraBlocked = cameraBlocked;
		this.ceilingAt = ceilingAt;
		this.enabled = false;
		this.pos = new THREE.Vector3();
		this.heading = 0; // the figure faces ( sin, cos )
		this.yaw = 0; // camera: looks along ( −sin yaw, −cos yaw )
		this.pitch = 0.32; // camera height angle above the figure (first person: looking down)
		this.distance = 4.2;
		this.camDist = 4.2;
		this.firstPerson = false;
		this.keys = new Set();
		this.phase = 0;
		this.stride = 0;
		this.time = 0;
		this.y = 0;

		this.avatar = makeFigure( 0xc4533a, 0x3b4350, 0xeee9df );
		this.avatar.visible = false;
		scene.add( this.avatar );
		this.moped = makeMoped();
		this.moped.visible = false;
		scene.add( this.moped );
		this.riding = false;
		this.speed = 0;
		this.lookTime = 0;

		dom.addEventListener( 'click', () => {

			if ( this.enabled && document.pointerLockElement !== dom ) dom.requestPointerLock();

		} );

		document.addEventListener( 'mousemove', e => {

			if ( ! this.enabled || document.pointerLockElement !== dom ) return;
			this.yaw -= e.movementX * 0.0022;
			this.lookTime = 1.5;
			this.pitch += e.movementY * 0.0022;
			this.clampPitch();

		} );

		dom.addEventListener( 'wheel', e => {

			if ( ! this.enabled ) return;
			this.distance = THREE.MathUtils.clamp( this.distance * ( e.deltaY > 0 ? 1.12 : 0.89 ), 1.8, 10 );

		}, { passive: true } );

		// Touch: drag on the canvas to look around.
		this.stick = { x: 0, y: 0 };
		let look = null;
		dom.addEventListener( 'pointerdown', e => {

			if ( ! this.enabled || e.pointerType === 'mouse' || look ) return;
			look = { id: e.pointerId, x: e.clientX, y: e.clientY };

		} );
		window.addEventListener( 'pointermove', e => {

			if ( ! look || e.pointerId !== look.id ) return;
			this.yaw += ( e.clientX - look.x ) * 0.006;
			this.pitch -= ( e.clientY - look.y ) * 0.005;
			this.clampPitch();
			look.x = e.clientX;
			look.y = e.clientY;

		} );
		const endLook = e => {

			if ( look && e.pointerId === look.id ) look = null;

		};
		window.addEventListener( 'pointerup', endLook );
		window.addEventListener( 'pointercancel', endLook );

		this.joystick = this.createJoystick();

		window.addEventListener( 'keydown', e => {

			this.keys.add( e.code );
			if ( e.code === 'KeyV' && this.enabled ) this.setFirstPerson( ! this.firstPerson );
			if ( e.code === 'KeyB' && this.enabled ) this.setRiding( ! this.riding );

		} );
		window.addEventListener( 'keyup', e => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

	}

	clampPitch() {

		this.pitch = this.firstPerson ? THREE.MathUtils.clamp( this.pitch, - 1.3, 1.3 ) : THREE.MathUtils.clamp( this.pitch, - 0.25, 1.25 );

	}

	setFirstPerson( on ) {

		this.firstPerson = on;
		this.pitch = on ? 0 : 0.32;
		this.avatar.visible = this.enabled && ! on;

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

	setRiding( on ) {

		this.riding = on;
		this.speed = 0;
		this.moped.visible = this.enabled && on;

	}

	setEnabled( enabled, touch ) {

		this.enabled = enabled;
		this.joystick.style.display = enabled && touch ? 'block' : 'none';
		this.avatar.visible = enabled && ! this.firstPerson;
		this.moped.visible = enabled && this.riding;
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

		this.placed = false;
		this.pos.set( x, this.groundHeight( x, z ), z );
		this.y = this.pos.y;
		this.placed = true;
		this.yaw = yaw;
		this.heading = yaw + Math.PI;
		this.camDist = this.distance;
		this.apply( 0 );

	}

	blocked( x, z ) {

		for ( const [ dx, dz ] of [ [ 0, 0 ], [ RADIUS, 0 ], [ - RADIUS, 0 ], [ 0, RADIUS ], [ 0, - RADIUS ] ] ) {

			if ( this.isBlocked( x + dx, z + dz ) ) return true;

		}

		return false;

	}

	update( dt ) {

		if ( this.riding ) return this.ride( dt );
		const safe = { x: this.pos.x, z: this.pos.z, y: this.y, heading: this.heading };
		const k = this.keys;
		let forward = ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 ) - ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 );
		let strafe = ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 );
		let speed = k.has( 'ShiftLeft' ) || k.has( 'ShiftRight' ) ? RUN : WALK;

		const push = Math.hypot( this.stick.x, this.stick.y );
		if ( push > 0.15 ) {

			forward = - this.stick.y;
			strafe = this.stick.x;
			speed = push > 1.25 ? RUN : WALK * Math.min( 1, push ) + 0.3;

		}

		let moving = 0;
		if ( forward || strafe ) {

			const len = Math.hypot( forward, strafe );
			const sin = Math.sin( this.yaw ), cos = Math.cos( this.yaw );
			const mx = ( - sin * forward + cos * strafe ) / len, mz = ( - cos * forward - sin * strafe ) / len;
			const dx = mx * speed * dt, dz = mz * speed * dt;
			const p = this.pos;

			// Slide along walls: try the full move, then each axis alone. Stuck inside a footprint: walk out freely.
			const before = p.x + p.z;
			if ( this.blocked( p.x, p.z ) || ! this.blocked( p.x + dx, p.z + dz ) ) p.x += dx, p.z += dz;
			else if ( ! this.blocked( p.x + dx, p.z ) ) p.x += dx;
			else if ( ! this.blocked( p.x, p.z + dz ) ) p.z += dz;
			moving = p.x + p.z !== before ? speed : 0;

			// Turn the figure towards where it walks.
			const target = Math.atan2( mx, mz );
			let d = target - this.heading;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			this.heading += d * Math.min( 1, dt * 10 );

		}

		// Walk / run cycle: stride eases in and out; running takes longer, quicker steps.
		this.stride += ( ( moving ? Math.min( 1.25, 0.75 + moving / RUN * 0.5 ) : 0 ) - this.stride ) * Math.min( 1, dt * 8 );
		this.phase += dt * ( moving > WALK + 0.5 ? 9.5 : 6.2 ) * Math.min( 1, this.stride + 0.2 );
		this.time += dt;

		this.settle( dt, safe );

	}

	// Moped: the throttle and brake set the speed, steering turns the heading, and the move is taken in short steps
	// so a fast moped cannot skip through a thin wall. Hitting something slides along it and loses most speed.
	ride( dt ) {

		const safe = { x: this.pos.x, z: this.pos.z, y: this.y, heading: this.heading };
		const k = this.keys;
		let throttle = ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 ) - ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 );
		let steer = ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 );
		if ( Math.hypot( this.stick.x, this.stick.y ) > 0.15 ) {

			throttle = THREE.MathUtils.clamp( - this.stick.y, - 1, 1 );
			steer = THREE.MathUtils.clamp( this.stick.x, - 1, 1 );

		}

		let v = this.speed;
		if ( throttle > 0 ) v += ( v < 0 ? MOPED.brake : MOPED.accel * throttle ) * dt;
		else if ( throttle < 0 ) v -= ( v > 0 ? MOPED.brake : MOPED.accel ) * - throttle * dt;
		else v -= Math.sign( v ) * Math.min( Math.abs( v ), MOPED.drag * dt );
		v = THREE.MathUtils.clamp( v, - MOPED.reverse, MOPED.max );

		// Turning the bars only turns a moving moped, and less at speed.
		const grip = Math.min( 1, Math.abs( v ) / 2.5 ) * ( 1 - 0.45 * Math.abs( v ) / MOPED.max );
		this.heading -= steer * MOPED.turn * grip * Math.sign( v ) * dt;

		const p = this.pos;
		const sx = Math.sin( this.heading ), sz = Math.cos( this.heading );
		const steps = Math.max( 1, Math.ceil( Math.abs( v * dt ) / 0.25 ) );
		for ( let i = 0; i < steps; i ++ ) {

			const dx = sx * v * dt / steps, dz = sz * v * dt / steps;
			if ( this.blocked( p.x, p.z ) || ! this.blocked( p.x + dx, p.z + dz ) ) { p.x += dx; p.z += dz; continue; }
			if ( ! this.blocked( p.x + dx, p.z ) ) p.x += dx;
			else if ( ! this.blocked( p.x, p.z + dz ) ) p.z += dz;
			v *= 0.4;
			break;

		}

		this.speed = v;

		// The camera settles behind the rider unless the mouse looked around in the last moment.
		this.lookTime = Math.max( 0, this.lookTime - dt );
		if ( ! this.lookTime && Math.abs( v ) > 0.5 ) {

			let d = this.heading + Math.PI - this.yaw;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			this.yaw += d * Math.min( 1, dt * 2.5 );

		}

		this.stride += ( 0 - this.stride ) * Math.min( 1, dt * 8 );
		this.time += dt;
		this.settle( dt, safe );

	}

	// Follow the ground, and never keep a broken position: if anything made the position or the height non-finite
	// (a bad ground or collision answer at some railing), step back to the last good spot.
	settle( dt, safe ) {

		const p = this.pos;
		const target = this.groundHeight( p.x, p.z );
		if ( Number.isFinite( target ) ) this.y += ( target - this.y ) * Math.min( 1, dt * 12 );
		if ( ! Number.isFinite( p.x + p.z + this.y + this.heading ) ) {

			p.x = safe.x; p.z = safe.z; this.y = safe.y; this.heading = safe.heading;
			this.speed = 0;

		}

		this.apply( dt );

	}

	apply( dt ) {

		const p = this.pos;
		p.y = this.y;
		this.avatar.position.copy( p );
		this.avatar.rotation.y = this.heading;
		if ( this.riding ) {

			// The rider stands on the floorboard, a little back, leaning into the bars.
			this.moped.position.copy( p );
			this.moped.rotation.y = this.heading;
			this.avatar.position.y += 0.32;
			this.avatar.position.x -= Math.sin( this.heading ) * 0.15;
			this.avatar.position.z -= Math.cos( this.heading ) * 0.15;

		}
		this.avatar.userData.setPose( { phase: this.phase, stride: this.stride, t: this.time } );

		const cam = this.camera;
		if ( this.firstPerson ) {

			cam.position.set( p.x, p.y + 1.65, p.z );
			cam.rotation.set( - this.pitch, this.yaw, 0, 'YXZ' );
			return;

		}

		// Behind and above the figure; nearer when a house is in the way.
		const tx = p.x, ty = p.y + 1.55, tz = p.z;
		const cp = Math.cos( this.pitch ), dx = Math.sin( this.yaw ) * cp, dy = Math.sin( this.pitch ), dz = Math.cos( this.yaw ) * cp;
		let allowed = this.distance;
		for ( let s = 0.4; s <= this.distance; s += 0.2 ) {

			const x = tx + dx * s, y = ty + dy * s, z = tz + dz * s;
			if ( this.cameraBlocked( x, z ) || y < this.groundHeight( x, z ) + 0.25 || y > this.ceilingAt( x, z ) - 0.15 ) {

				allowed = Math.max( 0.6, s - 0.35 );
				break;

			}

		}

		this.camDist = allowed < this.camDist || ! dt ? allowed : this.camDist + ( allowed - this.camDist ) * Math.min( 1, dt * 3 );
		cam.position.set( tx + dx * this.camDist, ty + dy * this.camDist, tz + dz * this.camDist );
		cam.lookAt( tx, ty, tz );
		this.avatar.visible = this.enabled && this.camDist > 0.9;

	}

}
