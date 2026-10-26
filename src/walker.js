import * as THREE from 'three/webgpu';
import { makeFigure } from './figures.js';
import { makeScooter, SCOOTER } from './scooter.js';

const RADIUS = 0.35;
const WALK = 1.7, RUN = 5.2;
// On the scooter (a 110 cc automatic): top speed 40 km/h (11.1 m/s), the automatic gearbox pulling hardest from
// a standstill and fading towards the top (about 0–30 km/h in 2.5 s), firm brakes, a little engine braking and air
// drag when coasting. The bars turn the front wheel; the scooter turns by its wheelbase, tighter when slow, and
// leans into the turn by how fast it turns at that speed (tan lean = v × yaw rate / g).
// A jump: a short hop, as in a late-90s game: 0.7 m up, quick (half a second in the air), the same on stairs and
// terraces (the hop rides on the ground's height as it is under the feet), never through a ceiling over the head.
const JUMP = { height: 0.7, gravity: 22, head: 1.85 };
const RIDE = { max: 11.1, reverse: 1.6, accel: 3.8, brake: 7.5, coast: 0.6, air: 0.006, steer: 0.62, wheelbase: 1.3, steerRate: 3, grip: 6, maxLean: 0.45 };

// Third-person walking (GTA-style): your figure in the street with the camera behind it. Mouse look (pointer
// lock) and WASD, Shift to run, the wheel to zoom, V for first person; on touch screens a joystick (bottom left)
// to walk and a drag anywhere else to look. The figure turns towards where it walks; the camera pulls in when a
// house stands between it and the figure. Terrain following, sliding collisions against building footprints.
// B gets on or off the scooter: W/S throttle and brake (S reverses slowly from a stop), A/D steer, and the camera
// swings in behind. Space jumps (on foot; a touch screen has a button for it).
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
		this.scene = scene;
		this.scooter = new THREE.Group();
		this.scooter.visible = false;
		scene.add( this.scooter );
		this.riding = false;
		this.speed = 0;
		this.steer = 0; // front wheel angle (rad)
		this.lean = 0; // roll into the turn (rad)
		this.pitchRide = 0; // nose up / down over bumps and when braking
		this.bump = 0; // vertical jolt from the cobbles (m)
		this.bumpV = 0;
		this.roughAt = () => 0; // 0 smooth asphalt … 1 granite setts, set by the game
		this.camTarget = new THREE.Vector3();
		this.hop = 0; // height of the jump over the ground (m)
		this.hopV = 0;
		this.jumpWanted = false;
		this.lookTime = 0;
		// The trams and cars near by (src/solids.js), set by the game: solid like the houses.
		this.solids = null;
		this.shove = [ 0, 0 ];
		// Riding a tram (src/ride.js): { step( walker, dt ), off() }; the eyes' height over the floor.
		this.aboard = null;
		this.eye = 1.65;

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
		this.jumpButton = this.createJumpButton();

		window.addEventListener( 'keydown', e => {

			this.keys.add( e.code );
			if ( e.code === 'KeyV' && this.enabled && ! this.aboard ) this.setFirstPerson( ! this.firstPerson );
			if ( e.code === 'KeyB' && this.enabled && ! this.aboard ) this.setRiding( ! this.riding );
			if ( e.code === 'Space' && this.enabled ) {

				e.preventDefault(); // not a click on whatever button has the focus
				if ( ! e.repeat ) this.jump();

			}

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
		base.style.cssText = 'position:fixed;left:28px;bottom:28px;width:120px;height:120px;border-radius:50%;background:rgba(16,20,30,0.45);border:4px solid #000;box-shadow:0 0 0 2px #f4ecd2;box-sizing:border-box;touch-action:none;display:none;z-index:2';
		const knob = document.createElement( 'div' );
		knob.style.cssText = 'position:absolute;left:31px;top:31px;width:50px;height:50px;border-radius:50%;background:#ffd34a;border:3px solid #000;box-sizing:border-box;pointer-events:none';
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

	// A button for the jump, bottom right, on touch screens.
	createJumpButton() {

		const b = document.createElement( 'div' );
		b.textContent = 'SKOK';
		b.style.cssText = `position:fixed;right:28px;bottom:40px;width:76px;height:76px;box-sizing:border-box;display:none;place-items:center;z-index:2;touch-action:none;user-select:none;-webkit-user-select:none;
			background:rgba(16,20,30,0.7);border:3px solid #000;box-shadow:inset -3px -3px 0 rgba(0,0,0,0.4),inset 3px 3px 0 rgba(255,255,255,0.12);color:#ffd34a;font:16px 'Pixelify Sans',system-ui,sans-serif;text-shadow:2px 2px 0 #000`;
		b.addEventListener( 'pointerdown', e => {

			e.preventDefault();
			this.jump();

		} );
		document.body.appendChild( b );
		return b;

	}

	jump() {

		if ( this.enabled && ! this.riding && ! this.aboard && this.hop === 0 ) this.jumpWanted = true;

	}

	// The scooter's model is loaded by the game (it needs the model loader).
	setScooter( loadModel ) {

		this.scene.remove( this.scooter );
		this.scooter = makeScooter( loadModel );
		this.scooter.visible = this.enabled && this.riding;
		this.scene.add( this.scooter );

	}

	setRiding( on ) {

		this.riding = on;
		this.hop = this.hopV = 0;
		this.jumpWanted = false;
		this.jumpButton.style.display = this.enabled && this.touch && ! on ? 'grid' : 'none';
		this.speed = this.steer = this.lean = this.pitchRide = this.bump = this.bumpV = 0;
		this.scooter.visible = this.enabled && on;
		// The rider sits on the scooter and tilts with it; off it, the figure stands in the street again.
		( on ? this.scooter.userData.lean ?? this.scene : this.scene ).add( this.avatar );
		if ( on ) this.heading = Math.atan2( Math.sin( this.heading ), Math.cos( this.heading ) );

	}

	setEnabled( enabled, touch ) {

		this.enabled = enabled;
		this.touch = touch;
		this.joystick.style.display = enabled && touch ? 'block' : 'none';
		this.jumpButton.style.display = enabled && touch && ! this.riding ? 'grid' : 'none';
		this.avatar.visible = enabled && ! this.firstPerson;
		this.scooter.visible = enabled && this.riding;
		if ( ! enabled ) this.stick.x = this.stick.y = 0;

	}

	teleport( x, z, yaw ) {

		this.aboard?.off(); // off the tram first

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

		return !! this.solids?.hit( x, z, this.y, RADIUS );

	}

	// A tram or car that has moved into one shoves one aside (src/solids.js), never into a house; on the scooter a
	// knock costs the speed.
	shoved( dt ) {

		if ( ! this.solids || ! dt ) return;
		const [ dx, dz ] = this.solids.push( this.pos.x, this.pos.z, this.y, RADIUS, dt, this.shove );
		if ( ! dx && ! dz ) return;
		const p = this.pos;
		for ( let k = 0; k < 5; k ++ ) if ( ! this.isBlocked( p.x + dx * ( 1 - k / 5 ), p.z + dz * ( 1 - k / 5 ) ) ) {

			p.x += dx * ( 1 - k / 5 );
			p.z += dz * ( 1 - k / 5 );
			break;

		}

		if ( this.riding ) this.speed *= 0.5;

	}

	update( dt ) {

		if ( this.aboard ) return this.aboard.step( this, dt );
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

		// The jump: up at the speed that reaches JUMP.height, down under gravity, onto whatever the ground is by then.
		// A ceiling (an arcade, the deck over a street) stops the head.
		if ( this.jumpWanted ) {

			this.jumpWanted = false;
			this.hopV = Math.sqrt( 2 * JUMP.gravity * JUMP.height );

		}

		if ( this.hop > 0 || this.hopV > 0 ) {

			this.hopV -= JUMP.gravity * dt;
			this.hop += this.hopV * dt;
			const room = this.ceilingAt( this.pos.x, this.pos.z ) - this.y - JUMP.head;
			if ( this.hop > room ) {

				this.hop = Math.max( 0, room );
				this.hopV = Math.min( 0, this.hopV );

			}

			if ( this.hop <= 0 ) this.hop = this.hopV = 0;

		}

		// Walk / run cycle: stride eases in and out; running takes longer, quicker steps. In the air the legs stop.
		if ( this.hop > 0 ) moving = 0;
		this.stride += ( ( moving ? Math.min( 1.25, 0.75 + moving / RUN * 0.5 ) : 0 ) - this.stride ) * Math.min( 1, dt * 8 );
		this.phase += dt * ( moving > WALK + 0.5 ? 9.5 : 6.2 ) * Math.min( 1, this.stride + 0.2 );
		this.time += dt;

		this.shoved( dt );
		this.settle( dt, safe );

	}

	// Scooter: the throttle and brake set the speed, the bars turn the heading, and the move is taken in short steps
	// so a fast scooter cannot skip through a thin wall. Hitting something slides along it and loses most speed.
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
		const forward = Math.max( 0, v ) / RIDE.max;
		if ( throttle > 0 && v >= - 0.05 ) v += RIDE.accel * throttle * ( 1 - forward ** 4 ) * dt;
		else if ( throttle > 0 ) v = Math.min( 0, v + RIDE.brake * dt );
		else if ( throttle < 0 && v > 0.05 ) v = Math.max( 0, v - RIDE.brake * - throttle * dt );
		else if ( throttle < 0 ) v = Math.max( - RIDE.reverse, v - 1.5 * - throttle * dt );
		// Coasting: engine braking and rolling, plus air drag growing with the square of the speed.
		if ( ! throttle || throttle > 0 && v > 0 ) v -= Math.sign( v ) * Math.min( Math.abs( v ), ( throttle ? 0 : RIDE.coast ) + RIDE.air * v * v ) * dt;
		v = THREE.MathUtils.clamp( v, - RIDE.reverse, RIDE.max );

		// The bars: eased towards the input, and turned less the faster it goes, as a rider does: never more than
		// keeps the sideways pull under RIDE.grip (v² tan steer / wheelbase).
		const reach = Math.min( RIDE.steer, Math.atan( RIDE.grip * RIDE.wheelbase / Math.max( 1e-3, v * v ) ) );
		this.steer += THREE.MathUtils.clamp( steer * reach - this.steer, - RIDE.steerRate * dt, RIDE.steerRate * dt );
		// At a crawl the rider paddles it round with the feet: it still turns while the throttle is held.
		const crawl = throttle && Math.abs( v ) < 1.2 ? Math.sign( throttle ) * 1.2 : v;
		const yawRate = crawl * Math.tan( this.steer ) / RIDE.wheelbase;
		this.heading -= yawRate * dt;

		// Lean into the turn (balance: tan lean = v × yaw rate / g), eased; pitch: the nose dips under the brakes and
		// rises a touch under power.
		const leanTarget = THREE.MathUtils.clamp( Math.atan( v * yawRate / 9.81 ), - RIDE.maxLean, RIDE.maxLean );
		this.lean += ( leanTarget - this.lean ) * Math.min( 1, dt * 6 );
		const accel = ( v - this.speed ) / Math.max( dt, 1e-3 );
		this.pitchRide += ( THREE.MathUtils.clamp( - accel * 0.006, - 0.05, 0.03 ) - this.pitchRide ) * Math.min( 1, dt * 5 );

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

		// Cobbles: small wheels on granite setts patter, a sprung bounce kicked by the stones at speed.
		const rough = this.roughAt( p.x, p.z );
		const kick = ( Math.random() - 0.5 ) * Math.abs( v ) * ( 0.04 + 0.5 * rough );
		this.bumpV += ( kick - this.bump * 900 * dt - this.bumpV * 24 * dt );
		this.bump = THREE.MathUtils.clamp( this.bump + this.bumpV * dt, - 0.03, 0.03 );

		// The camera settles behind the rider unless the mouse looked around in the last moment; quicker the faster.
		this.lookTime = Math.max( 0, this.lookTime - dt );
		if ( ! this.lookTime && Math.abs( v ) > 0.5 ) {

			let d = ( v > 0 ? this.heading + Math.PI : this.yaw ) - this.yaw;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			this.yaw += d * Math.min( 1, dt * ( 1.2 + 2 * Math.abs( v ) / RIDE.max ) );

		}

		this.stride += ( 0 - this.stride ) * Math.min( 1, dt * 8 );
		this.time += dt;
		this.shoved( dt );
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
		if ( this.riding ) {

			// The rider sits astride the seat, in the scooter's leaning frame.
			// The wheels roll the way the scooter went (backwards too).
			const moved = Math.hypot( p.x - this.scooter.position.x, p.z - this.scooter.position.z );
			if ( moved < 2 ) this.scooter.userData.roll?.( moved * Math.sign( this.speed || 1 ) );
			this.scooter.position.copy( p );
			this.scooter.rotation.y = this.heading;
			const lean = this.scooter.userData.lean;
			if ( lean ) {

				lean.position.y = this.bump;
				lean.rotation.set( this.pitchRide, 0, this.lean, 'XZY' );

			}

			const seat = this.scooter.userData.seat ?? new THREE.Vector3( 0, SCOOTER.seatY, SCOOTER.seatZ );
			this.avatar.position.set( 0, seat.y - 0.47, seat.z );
			this.avatar.rotation.set( 0, 0, 0 );

		} else {

			this.avatar.position.copy( p );
			this.avatar.position.y += this.hop;
			this.avatar.rotation.y = this.heading;

		}

		// In the air: the legs tucked up, more the higher.
		const air = this.riding ? 0 : Math.min( 1, this.hop / 0.25 );
		this.avatar.userData.setPose( { phase: this.phase, stride: this.stride, t: this.time, ride: this.riding, air } );

		const cam = this.camera;
		if ( this.firstPerson || this.aboard ) {

			cam.position.set( p.x, p.y + this.eye + this.hop, p.z );
			cam.rotation.set( - this.pitch, this.yaw, 0, 'YXZ' );
			return;

		}

		// Behind and above the figure; nearer when a house is in the way. On the scooter the camera's aim trails the
		// rider softly (and a little ahead at speed), and ignores the cobbles' jolts, so the picture stays calm.
		let tx = p.x, ty = p.y + 1.55, tz = p.z;
		const ct = this.camTarget;
		if ( this.riding && dt ) {

			const ahead = this.speed * 0.12;
			ct.x += ( p.x + Math.sin( this.heading ) * ahead - ct.x ) * Math.min( 1, dt * 9 );
			ct.z += ( p.z + Math.cos( this.heading ) * ahead - ct.z ) * Math.min( 1, dt * 9 );
			ct.y += ( p.y + 1.45 - ct.y ) * Math.min( 1, dt * 5 );
			tx = ct.x; ty = ct.y; tz = ct.z;

		} else ct.set( tx, ty += this.hop * 0.5, tz ); // the camera follows half the jump
		const cp = Math.cos( this.pitch ), dx = Math.sin( this.yaw ) * cp, dy = Math.sin( this.pitch ), dz = Math.cos( this.yaw ) * cp;
		// Riding, the camera stands a little further back, more at speed.
		const want = this.distance + ( this.riding ? 0.6 + 1.4 * Math.abs( this.speed ) / RIDE.max : 0 );
		let allowed = want;
		for ( let s = 0.4; s <= want; s += 0.2 ) {

			const x = tx + dx * s, y = ty + dy * s, z = tz + dz * s;
			if ( this.cameraBlocked( x, z ) || y < this.groundHeight( x, z ) + 0.25 || y > this.ceilingAt( x, z ) - 0.15 || this.solids?.inside( x, y, z ) ) {

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
