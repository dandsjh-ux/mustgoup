// Local character controller: a capsule-ish cylinder against boxes and discs at a fixed 60 Hz.
import * as THREE from 'three';
import { PHYS, BOOST_R } from './shared/tower.js';
import { AnimalModel, ANIM, Trail } from './animals.js';
import { audio } from './audio.js';

const H = PHYS.height;
const RAD = PHYS.radius;
const V1 = Math.sqrt(2 * PHYS.g * PHYS.jump1);
const V2 = Math.sqrt(2 * PHYS.g * PHYS.jump2);
const SAFE_KINDS = new Set(['deck', 'pad', 'dome', 'summit']);
const STABLE = new Set(['normal', 'rope', 'pad', 'landing', 'deck', 'ice', 'conveyor', 'barrel', 'boom', 'jelly', 'dome', 'summit', 'bounce', 'bouncy', 'leaf', 'slide', 'drift', 'airship', 'gear', 'piston', 'sink']);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class LocalPlayer {
  constructor(scene, world, profile) {
    this.scene = scene;
    this.world = world;
    this.model = new AnimalModel(profile, { outline: '#ffe14d' });
    scene.add(this.model.root);
    this.trail = new Trail(scene, profile.trail);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.push = new THREE.Vector3();
    this.flow = new THREE.Vector2();
    this.yaw = 0;
    this.grounded = false;
    this.ground = null;
    this.coyote = 0;
    this.buffer = 0;
    this.jumps = 0;
    this.airTime = 0;
    this.time = 0;
    this.lastSafe = null;
    this.spring = false;
    this.snackUntil = 0;
    this.glider = false;
    this.jet = { owned: false, fuel: 3, active: false };
    this.cleats = false;
    this.shield = false;
    this.stunUntil = 0;
    this.immuneUntil = 0;
    this.launch = null;
    this.anim = ANIM.idle;
    this.landT = 0;
    this.gravMult = 1;
    this.inBubble = false;
    this.respawning = false;
    this.onShieldUsed = () => {};
    this.onPushed = () => {};
    this.onBoost = () => {};
  }

  dispose() {
    this.model.dispose();
    this.trail.dispose();
  }

  teleport(p, yaw) {
    this.pos.set(p.x, p.y, p.z);
    this.vel.set(0, 0, 0);
    this.push.set(0, 0, 0);
    this.grounded = false;
    this.ground = null;
    this.launch = null;
    this.jet.active = false;
    if (yaw != null) this.yaw = yaw;
  }

  startLaunch(to, dur = 1.1, height = 3) {
    this.launch = { from: this.pos.clone(), to: to.clone(), t: 0, dur, h: height };
    this.vel.set(0, 0, 0);
    this.push.set(0, 0, 0);
    this.grounded = false;
    this.ground = null;
    this.model.setAnim(ANIM.flip);
  }

  isSafe() {
    if (this.inBubble || this.launch || this.respawning) return true;
    if (this.grounded && this.ground && SAFE_KINDS.has(this.ground.kind)) return true;
    return false;
  }

  speedMult() {
    return this.time < this.snackUntil ? 1.4 : 1;
  }

  // ---------- forces from hazards and items
  hazardPush(dx, dz, dist, up, stun = 0, ignoreSafe = false) {
    if (!ignoreSafe && this.isSafe()) return;
    if (this.shield) {
      this.shield = false;
      audio.play('shield');
      this.onShieldUsed();
      return;
    }
    this.applyPush(dx, dz, dist, up);
    if (stun) this.stunUntil = this.time + stun;
  }

  applyPush(dx, dz, dist, up) {
    const l = Math.hypot(dx, dz) || 1;
    this.push.set((dx / l) * dist * 4, 0, (dz / l) * dist * 4);
    this.vel.y = Math.max(this.vel.y, up);
    this.vel.x *= 0.3;
    this.vel.z *= 0.3;
    this.grounded = false;
    this.ground = null;
    this.jet.active = false;
    this.onPushed();
  }

  springboard(vy) {
    this.vel.y = vy;
    this.grounded = false;
    this.ground = null;
    this.jumps = 1;
  }

  // Zone boost pads and geysers: launch straight up to roughly h blocks (scaled for low gravity).
  canBoost() {
    return !this.launch && !this.inBubble && !this.respawning;
  }

  boost(h) {
    this.vel.y = Math.sqrt(2 * PHYS.g * this.gravMult * h);
    this.grounded = false;
    this.ground = null;
    this.coyote = 0;
    this.jumps = 1; // the double jump is still available at the top
    this.jet.active = false;
    this.model.setAnim(ANIM.flip);
    this.onBoost();
  }

  // Steady weather currents (wind gusts, waterfalls). A Bubble Shield makes you immune to them entirely
  // for as long as it is up; unlike a one-off push this does not use the shield up.
  addFlow(vx, vz) {
    if (this.shield) return;
    this.flow.x += vx;
    this.flow.y += vz;
  }

  canRewind() {
    return !this.grounded && !this.launch && this.vel.y < -1 && this.airTime > 0.25 && !!this.lastSafe;
  }

  rewind() {
    const s = this.lastSafe;
    if (!s) return false;
    const p = s.plat;
    this.teleport({ x: p.cx + s.ox, y: p.ctop + 0.05, z: p.cz + s.oz });
    return true;
  }

  // ---------- fixed step
  step(dt, input, camYaw) {
    this.time += dt;
    const flow = this.flow.clone();
    this.flow.set(0, 0);

    if (this.launch) {
      const L = this.launch;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      const e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(L.from, L.to, e);
      this.pos.y += Math.sin(k * Math.PI) * L.h;
      const dx = L.to.x - L.from.x, dz = L.to.z - L.from.z;
      if (Math.hypot(dx, dz) > 0.1) this.yaw = Math.atan2(dx, dz);
      if (k >= 1) {
        this.launch = null;
        this.vel.set(0, -1, 0);
      }
      this.anim = ANIM.flip;
      return;
    }

    // ride moving platforms
    if (this.grounded && this.ground) {
      const g = this.ground;
      this.pos.x += g.dx;
      this.pos.z += g.dz;
      if (g.dy) this.pos.y += g.dy;
      if (g.drot) {
        const th = -g.drot;
        const ox = this.pos.x - g.cx, oz = this.pos.z - g.cz;
        this.pos.x = g.cx + ox * Math.cos(th) + oz * Math.sin(th);
        this.pos.z = g.cz - ox * Math.sin(th) + oz * Math.cos(th);
        this.yaw += th;
      }
    }

    const stunned = this.time < this.stunUntil;
    let mx = input.move.x, my = input.move.y;
    if (stunned || input.locked) { mx = 0; my = 0; }
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const wx = rx * mx + fx * my;
    const wz = rz * mx + fz * my;
    const speed = PHYS.run * this.speedMult();
    const onIce = this.grounded && this.ground && (this.ground.kind === 'ice' || this.ground.kind === 'slide') && !this.cleats;
    const accel = this.grounded ? (onIce ? 6 : 70) : 70 * 0.85;
    const dvx = wx * speed - this.vel.x;
    const dvz = wz * speed - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dl > maxDv) { this.vel.x += (dvx / dl) * maxDv; this.vel.z += (dvz / dl) * maxDv; }
    else { this.vel.x += dvx; this.vel.z += dvz; }
    if (Math.hypot(wx, wz) > 0.1) this.yaw = Math.atan2(this.vel.x || wx, this.vel.z || wz);

    // jumping
    const jm = this.spring ? Math.sqrt(1.3) : 1;
    if (input.jumpPressed && !stunned && !input.locked) this.buffer = 0.15;
    else this.buffer -= dt;
    if (!this.grounded) this.coyote -= dt;
    if (this.buffer > 0) {
      if (this.grounded || this.coyote > 0) {
        this.vel.y = V1 * jm;
        this.grounded = false;
        this.ground = null;
        this.coyote = 0;
        this.jumps = 1;
        this.buffer = 0;
        this.model.setAnim(ANIM.jump);
        audio.play('jump');
      } else if (input.jumpPressed) {
        if (this.jumps < 2) {
          this.vel.y = V2 * jm;
          this.jumps = 2;
          this.buffer = 0;
          this.model.setAnim(ANIM.flip);
          audio.play('double');
        } else if (this.jet.owned && this.jet.fuel > 0.05) {
          this.jet.active = true;
          this.buffer = 0;
          audio.play('jet');
        }
      }
    }

    const g = PHYS.g * this.gravMult;
    if (this.jet.active) {
      if (!input.jumpHeld || this.jet.fuel <= 0 || this.grounded) this.jet.active = false;
      else {
        this.vel.y += (3.4 - this.vel.y) * Math.min(1, 8 * dt);
        this.jet.fuel = Math.max(0, this.jet.fuel - dt);
      }
    }
    if (!this.jet.active) this.vel.y -= g * dt;
    this.gliding = this.glider && !this.grounded && this.vel.y < 0 && input.jumpHeld && !this.jet.active && this.jumps >= 1 && this.airTime > 0.2;
    if (this.gliding) this.vel.y = Math.max(this.vel.y, -1.6);
    this.vel.y = Math.max(this.vel.y, -30);

    // external push decays
    const decay = Math.exp(-4 * dt);
    this.push.multiplyScalar(decay);
    if (this.push.lengthSq() < 0.01) this.push.set(0, 0, 0);
    let ex = 0, ez = 0;
    if (this.grounded && this.ground && this.ground.kind === 'conveyor') {
      const a = Math.atan2(this.ground.z, this.ground.x);
      ex = -Math.sin(a) * 2 * this.ground.dir;
      ez = Math.cos(a) * 2 * this.ground.dir;
    }
    const mvx = (this.vel.x + this.push.x + flow.x + ex) * dt;
    const mvz = (this.vel.z + this.push.z + flow.y + ez) * dt;

    this.collide(dt, mvx, mvz);

    // keep players inside the hedge on the ground floor
    if (this.pos.y < 2) {
      const r = Math.hypot(this.pos.x, this.pos.z);
      if (r > 29.5) { this.pos.x *= 29.5 / r; this.pos.z *= 29.5 / r; }
    }

    // stepping onto a zone boost pad launches you
    const bg = this.grounded ? this.ground : null;
    if (bg && bg.boost && Math.hypot(this.pos.x - (bg.cx + bg.boost.ox), this.pos.z - (bg.cz + bg.boost.oz)) < BOOST_R && this.canBoost()) {
      this.boost(bg.boost.h);
      audio.play('boost');
    }

    if (this.grounded) {
      this.airTime = 0;
      this.world.standOn(this.ground);
      if (STABLE.has(this.ground.kind) && this.ground.kind !== 'ceiling') {
        this.lastSafe = { plat: this.ground, ox: clamp(this.pos.x - this.ground.cx, -2, 2), oz: clamp(this.pos.z - this.ground.cz, -2, 2) };
      }
    } else this.airTime += dt;

    this.pickAnim(stunned);
  }

  collide(dt, mvx, mvz) {
    const w = this.world;
    const cands = w.query(this.pos.y);
    const wasGrounded = this.grounded;
    const impact = this.vel.y;
    // --- vertical
    let ny = this.pos.y + this.vel.y * dt;
    let landed = null;
    for (const c of cands) {
      if (c.kind === 'spire' || !w.isSolid(c)) continue;
      if (!w.footprint(c, this.pos.x, this.pos.z, RAD * 0.75)) continue;
      const top = c.ctop;
      const bot = top - c.h;
      if (this.vel.y <= 0 && this.pos.y >= top - 0.3 - Math.max(0, c.dy) && ny <= top) {
        if (!landed || top > landed.ctop) landed = c;
      } else if (this.vel.y > 0 && this.pos.y + H <= bot + 0.15 && ny + H > bot) {
        ny = bot - H;
        this.vel.y = 0;
        this.jet.active = false;
      }
    }
    if (landed) {
      ny = landed.ctop;
      this.vel.y = 0;
      this.grounded = true;
      this.ground = landed;
      this.jumps = 0;
      this.coyote = 0.15;
      this.jet.active = false;
      if (!wasGrounded) this.onLand(landed, impact);
    } else {
      if (wasGrounded) this.coyote = 0.15;
      this.grounded = false;
      this.ground = null;
    }
    this.pos.y = ny;

    // --- horizontal
    let nx = this.pos.x + mvx;
    let nz = this.pos.z + mvz;
    for (const c of cands) {
      if (!w.isSolid(c)) continue;
      const top = c.ctop;
      const bot = top - c.h;
      if (this.pos.y >= top - 0.02 || this.pos.y + H <= bot + 0.02) continue;
      if (c.noSide) {
        // inside a deck/ceiling slab: move to the nearer face
        if (!w.footprint(c, nx, nz, 0)) continue;
        if (this.pos.y > (top + bot) / 2) { this.pos.y = top; this.vel.y = Math.max(0, this.vel.y); }
        else { this.pos.y = bot - H; this.vel.y = Math.min(0, this.vel.y); }
        continue;
      }
      if (c.shape === 'cyl') {
        const dx = nx - c.cx, dz = nz - c.cz;
        const d = Math.hypot(dx, dz);
        const min = c.r + RAD;
        if (d >= min) continue;
        if (c.kind !== 'spire' && top - this.pos.y <= 0.5 && this.vel.y < 6) { this.stepUp(c); continue; }
        if (d < 1e-5) { nx = c.cx + min; continue; }
        nx = c.cx + (dx / d) * min;
        nz = c.cz + (dz / d) * min;
      } else {
        const lx = clamp(nx, c.cx - c.hx, c.cx + c.hx);
        const lz = clamp(nz, c.cz - c.hz, c.cz + c.hz);
        const dx = nx - lx, dz = nz - lz;
        const d = Math.hypot(dx, dz);
        if (d >= RAD) continue;
        if (top - this.pos.y <= 0.5 && this.vel.y < 6) { this.stepUp(c); continue; }
        if (d > 1e-5) { nx = lx + (dx / d) * RAD; nz = lz + (dz / d) * RAD; }
        else {
          const pl = nx - (c.cx - c.hx), pr = c.cx + c.hx - nx, pb = nz - (c.cz - c.hz), pf = c.cz + c.hz - nz;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) nx = c.cx - c.hx - RAD; else if (m === pr) nx = c.cx + c.hx + RAD; else if (m === pb) nz = c.cz - c.hz - RAD; else nz = c.cz + c.hz + RAD;
        }
      }
    }
    this.pos.x = nx;
    this.pos.z = nz;
  }

  stepUp(c) {
    // Ledge assist: feet within 0.5 below the edge => climb on.
    this.pos.y = c.ctop;
    this.vel.y = 0;
    const was = this.grounded;
    this.grounded = true;
    this.ground = c;
    this.jumps = 0;
    if (!was) this.onLand(c, -2);
  }

  onLand(c, impact) {
    if (c.kind === 'bounce' || c.kind === 'bouncy') {
      const h = c.kind === 'bounce' ? 4.5 : 4;
      this.vel.y = Math.sqrt(2 * PHYS.g * this.gravMult * h);
      this.grounded = false;
      this.ground = null;
      this.jumps = 1;
      this.model.setAnim(ANIM.flip);
      audio.play('bounce');
      return;
    }
    if (impact < -6) {
      this.model.setAnim(ANIM.land);
      this.landT = 0.18;
      audio.play('land');
    }
  }

  pickAnim(stunned) {
    let a;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (stunned) a = ANIM.stun;
    else if (this.jet.active) a = ANIM.jet;
    else if (this.gliding) a = ANIM.glide;
    else if (this.grounded) {
      if (this.landT > 0) { this.landT -= 1 / 60; a = ANIM.land; }
      else if (sp > 0.6) a = ANIM.run;
      else a = this.celebrating ? ANIM.celebrate : this.inBubble ? ANIM.bubble : ANIM.idle;
    } else if (this.model.flipT >= 0) a = ANIM.flip;
    else if (this.vel.y < -7 && this.airTime > 0.6) a = ANIM.fall;
    else a = ANIM.jump;
    this.anim = a;
    this.model.setAnim(a);
  }

  updateVisual(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    let d = this.yaw - m.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    m.root.rotation.y += d * Math.min(1, dt * 14);
    const sp = Math.hypot(this.vel.x, this.vel.z) / PHYS.run;
    m.update(dt, sp, { jetpack: this.jet.owned, cape: this.glider });
    const immune = this.time < this.immuneUntil;
    m.setOutlineVisible(!immune || Math.sin(this.time * 20) > 0);
    this.trail.update(dt, this.pos, sp > 0.3 || !this.grounded);
  }
}
