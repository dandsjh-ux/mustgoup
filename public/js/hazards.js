// Hazards and enemies. Every schedule is a pure function of game time + tower seed,
// so all clients see the same warnings and strikes. Each client only applies pushes to its own player.
import * as THREE from 'three';
import { hash01, zoneAt, SPIRE_R } from './shared/tower.js';
import { HAZARD_LEVELS } from './shared/settings.js';
import { toon } from './animals.js';
import { audio } from './audio.js';

const TAU = Math.PI * 2;

export class Hazards {
  constructor(scene, world, tower, settings) {
    this.scene = scene;
    this.world = world;
    this.tower = tower;
    this.seed = tower.seed;
    this.level = HAZARD_LEVELS[settings.hazard] || HAZARD_LEVELS.standard;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.sphere = new THREE.SphereGeometry(1, 14, 10);
    this.hitCooldown = new Map();
    this.z8 = tower.plats.filter((p) => p.zone === 8 && p.shape === 'box' && p.kind !== 'pad' && p.kind !== 'landing');
    this.z10 = tower.plats.filter((p) => p.zone === 10 && p.shape === 'box' && p.kind !== 'pad' && p.kind !== 'landing' && p.kind !== 'dome');
    this.build();
    this.lastWindSlot = -1;
  }

  dispose() {
    this.group.removeFromParent();
  }

  period(base) {
    return base / this.level.freq;
  }

  build() {
    const tw = this.tower;
    this.puffs = [];
    this.parrots = [];
    this.asteroids = [];
    for (const f of tw.feats) {
      if (f.type === 'puff') {
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.sphere, toon('#dfe8f5'));
        body.scale.setScalar(0.55);
        g.add(body);
        for (const s of [-1, 1]) {
          const e = new THREE.Mesh(this.sphere, toon('#1b1b1b'));
          e.scale.set(0.08, 0.1, 0.05);
          e.position.set(s * 0.18, 0.12, 0.5);
          g.add(e);
        }
        const cheeks = new THREE.Mesh(this.sphere, toon('#ffb3c7'));
        cheeks.scale.set(0.42, 0.3, 0.3);
        cheeks.position.set(0, -0.08, 0.35);
        g.add(cheeks);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#e6f4ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        cone.rotation.x = -Math.PI / 2;
        cone.position.z = 3;
        g.add(cone);
        const pos = new THREE.Vector3(Math.cos(f.ang) * (SPIRE_R + 0.45), f.y, Math.sin(f.ang) * (SPIRE_R + 0.45));
        g.position.copy(pos);
        g.lookAt(Math.cos(f.ang) * 20, f.y, Math.sin(f.ang) * 20);
        this.world.zoneGroups[8].add(g);
        this.puffs.push({ f, g, cheeks, cone, pos, dir: new THREE.Vector2(Math.cos(f.ang), Math.sin(f.ang)), hitSlot: -1 });
      }
      if (f.type === 'parrot') {
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.sphere, toon('#2ec27e'));
        body.scale.set(0.3, 0.38, 0.3);
        const head = new THREE.Mesh(this.sphere, toon('#ff4d6d'));
        head.scale.setScalar(0.22);
        head.position.set(0, 0.35, 0.1);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), toon('#ffd23d'));
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.32, 0.32);
        const wings = [];
        for (const s of [-1, 1]) {
          const w = new THREE.Mesh(this.sphere, toon('#3a86ff'));
          w.scale.set(0.42, 0.06, 0.2);
          w.position.set(s * 0.35, 0.05, 0);
          g.add(w);
          wings.push(w);
        }
        for (const s of [-1, 1]) {
          const e = new THREE.Mesh(this.sphere, toon('#ffffff'));
          e.scale.setScalar(0.07);
          e.position.set(s * 0.1, 0.4, 0.27);
          g.add(e);
        }
        const outline = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: '#ff2d55', side: THREE.BackSide, transparent: true, opacity: 0.8 }));
        outline.scale.set(0.42, 0.55, 0.42);
        outline.visible = false;
        g.add(body, head, beak, outline);
        g.position.set(f.perch.x, f.perch.y, f.perch.z);
        this.world.zoneGroups[9].add(g);
        this.parrots.push({ f, g, wings, outline, hitSlot: -1, warned: -1 });
      }
      if (f.type === 'asteroid') {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(f.size, 0), toon('#8d7f72'));
        this.world.zoneGroups[10].add(m);
        this.asteroids.push({ f, m });
      }
    }
    this.barrels = [];
    this.booms = [];
    this.jellies = [];
    for (const p of tw.plats) {
      if (p.kind === 'barrel') {
        const a = Math.atan2(p.z, p.x);
        const tan = new THREE.Vector2(-Math.sin(a), Math.cos(a));
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 12), toon('#8b5a2b'));
        b.rotation.z = Math.PI / 2;
        const holder = new THREE.Group();
        holder.add(b);
        holder.visible = false;
        const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.3), toon('#5a3a1a'));
        const hatchPos = new THREE.Vector3(p.x - tan.x * (p.hx + 0.2), p.top + 0.4, p.z - tan.y * (p.hz + 0.2));
        hatch.position.copy(hatchPos);
        hatch.lookAt(p.x, hatch.position.y, p.z);
        this.world.zoneGroups[9].add(holder, hatch);
        this.barrels.push({ p, tan, holder, roll: b, hatch, hitSlot: -1 });
      }
      if (p.kind === 'boom') {
        const pivot = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 8), toon('#6b4523'));
        post.position.y = 0.8;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(p.hx + 0.6, 0.22, 0.22), toon('#a0713f'));
        arm.position.set((p.hx + 0.6) / 2, 0.6, 0);
        const armG = new THREE.Group();
        armG.add(arm);
        pivot.add(post, armG);
        pivot.position.set(p.x, p.top, p.z);
        this.world.zoneGroups[9].add(pivot);
        this.booms.push({ p, pivot, armG, len: p.hx + 0.6 });
      }
      if (p.kind === 'jelly') {
        const j = new THREE.Mesh(this.sphere, new THREE.MeshToonMaterial({ color: '#ff8fe0', emissive: '#a03cff', emissiveIntensity: 0.35, transparent: true, opacity: 0.85, gradientMap: toon('#fff').gradientMap }));
        j.scale.set(0.8, 0.6, 0.8);
        const pos = new THREE.Vector3(p.x + (p.hx - 1) * 0.5, p.top + 0.6, p.z);
        j.position.copy(pos);
        this.world.zoneGroups[10].add(j);
        this.jellies.push({ p, m: j, pos });
      }
    }
    // pools for strikes (lightning / meteors)
    this.rings = [];
    for (let i = 0; i < 10; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), new THREE.MeshBasicMaterial({ color: '#ffd23d', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      this.group.add(r);
      this.rings.push(r);
    }
    this.bolts = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 16, 6), new THREE.MeshBasicMaterial({ color: '#fff7a8' }));
      b.visible = false;
      this.group.add(b);
      this.bolts.push(b);
    }
    this.rocks = [];
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: '#ff8a3d' }));
      r.visible = false;
      this.group.add(r);
      this.rocks.push(r);
    }
    // wind streaks
    this.streaks = [];
    const sm = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.03, 0.03), sm);
      s.visible = false;
      s.userData.o = new THREE.Vector3((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 24);
      this.group.add(s);
      this.streaks.push(s);
    }
    this.streakMat = sm;
  }

  canHit(key, cd = 1) {
    const now = performance.now() / 1000;
    if ((this.hitCooldown.get(key) || 0) > now) return false;
    this.hitCooldown.set(key, now + cd);
    return true;
  }

  // strikes for a time slot: [{x,z,y}] on random platforms
  strikes(list, slot, salt, n) {
    const out = [];
    if (!list.length) return out;
    for (let k = 0; k < n; k++) {
      const p = list[Math.floor(hash01(this.seed, slot, salt, k) * list.length)];
      const ox = (hash01(this.seed, slot, salt, k, 1) - 0.5) * Math.max(0, p.sx - 2);
      const oz = (hash01(this.seed, slot, salt, k, 2) - 0.5) * Math.max(0, p.sz - 2);
      out.push({ x: p.x + ox, y: p.top, z: p.z + oz, key: `${salt}${slot}_${k}` });
    }
    return out;
  }

  /**
   * @param t game time (s)
   * @param player local player (or null when spectating)
   * @param focus Vector3 (camera focus) for visibility
   */
  update(t, dt, player, focus) {
    const fz = zoneAt(Math.max(0, focus.y));
    const pz = player ? zoneAt(player.pos.y) : 0;
    const P = player ? player.pos : null;
    const push = this.level.push;
    let ringI = 0, boltI = 0, rockI = 0;
    const safe = player ? player.isSafe() : true;

    // ---- zone 3: waterfalls push gently outward
    if (player && pz === 3 && !safe) {
      for (const f of this.tower.feats) {
        if (f.type !== 'waterfall' || P.y < f.y0 || P.y > f.y1) continue;
        const a = Math.atan2(P.z, P.x);
        let d = a - f.ang;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const r = Math.hypot(P.x, P.z);
        if (Math.abs(d) < 0.28 && r < 11) player.addFlow(Math.cos(f.ang) * 1.2 * push, Math.sin(f.ang) * 1.2 * push);
      }
    }

    // ---- zone 8: wind gusts (warning 1.5s, on 3s, off)
    if (fz >= 7 && fz <= 9) {
      const W = this.period(7);
      const slot = Math.floor(t / W);
      const ph = t - slot * W;
      const ang = hash01(this.seed, slot, 99) * TAU;
      const warn = ph < 1.5;
      const on = ph >= 1.5 && ph < 4.5;
      if (player && pz === 8 && slot !== this.lastWindSlot) {
        this.lastWindSlot = slot;
        audio.play('wind');
      }
      const showStreaks = (warn || on) && fz === 8;
      const dirX = Math.cos(ang), dirZ = Math.sin(ang);
      this.streakMat.opacity = on ? 0.6 : 0.25;
      for (const s of this.streaks) {
        s.visible = showStreaks;
        if (!showStreaks) continue;
        const o = s.userData.o;
        const spd = on ? 18 : 6;
        o.x += dirX * spd * dt;
        o.z += dirZ * spd * dt;
        if (Math.abs(o.x) > 12) o.x = -Math.sign(o.x) * 12;
        if (Math.abs(o.z) > 12) o.z = -Math.sign(o.z) * 12;
        s.position.set(focus.x + o.x, focus.y + o.y, focus.z + o.z);
        s.rotation.y = -ang;
      }
      if (player && pz === 8 && on && !safe) player.addFlow(dirX * 2 * push, dirZ * 2 * push);
    } else for (const s of this.streaks) s.visible = false;

    // ---- zone 8: lightning strikes (circle warning 1.5s, then strike)
    if (fz >= 7 && fz <= 9) {
      const L = this.period(2);
      const cur = Math.floor(t / L);
      for (const slot of [cur - 1, cur]) {
        const ph = t - slot * L;
        for (const s of this.strikes(this.z8, slot, 7, 3)) {
          if (ph < 1.5 && ringI < this.rings.length) {
            const r = this.rings[ringI++];
            r.visible = true;
            r.position.set(s.x, s.y + 0.06, s.z);
            r.material.color.set(Math.sin(ph * 18) > 0 ? '#ffd23d' : '#ff4d6d');
            r.scale.setScalar(0.6 + ph / 3);
          } else if (ph >= 1.5 && ph < 1.75 && boltI < this.bolts.length) {
            const b = this.bolts[boltI++];
            b.visible = true;
            b.position.set(s.x, s.y + 8, s.z);
            if (player && pz === 8 && !safe && Math.hypot(P.x - s.x, P.z - s.z) < 1.7 && Math.abs(P.y - s.y) < 2 && this.canHit(s.key, 2)) {
              audio.play('zap');
              const dx = P.x - s.x || 0.01, dz = P.z - s.z;
              player.hazardPush(dx, dz, 3 * push, 4, 1);
            }
          }
        }
      }
    }

    // ---- zone 8: Gust Puffs
    if (fz >= 7 && fz <= 9) {
      for (const pf of this.puffs) {
        const W = this.period(6);
        const tt = t + pf.f.ph;
        const slot = Math.floor(tt / W);
        const ph = (tt - slot * W) / W * 6; // normalised to the 6 s pattern
        const puffing = ph >= 3 && ph < 4.5;
        const blowing = ph >= 4.5;
        const s = puffing ? 1 + (ph - 3) * 0.5 : blowing ? 1.6 - (ph - 4.5) * 0.4 : 1;
        pf.cheeks.scale.set(0.42 * s, 0.3 * s, 0.3);
        pf.cone.material.opacity = blowing ? 0.25 : 0;
        if (player && blowing && pz === 8 && !safe && pf.hitSlot !== slot) {
          const rx = P.x - pf.pos.x, rz = P.z - pf.pos.z;
          const along = rx * pf.dir.x + rz * pf.dir.y;
          const side = Math.abs(-rx * pf.dir.y + rz * pf.dir.x);
          if (along > 0 && along < 5.5 && side < 0.5 + along * 0.45 && Math.abs(P.y - pf.pos.y) < 1.6) {
            pf.hitSlot = slot;
            audio.play('push');
            player.hazardPush(pf.dir.x, pf.dir.y, 4 * push, 3, 0);
          }
        }
      }
    }

    // ---- zone 9: parrots, barrels, booms
    if (fz >= 8 && fz <= 10) {
      for (const pr of this.parrots) {
        const W = this.period(7);
        const tt = t + pr.f.ph;
        const slot = Math.floor(tt / W);
        const ph = (tt - slot * W) / W * 7;
        const perch = pr.f.perch;
        const tp = this.tower.plats[pr.f.targets[Math.floor(hash01(this.seed, slot, pr.f.targets.length) * pr.f.targets.length)]];
        const target = new THREE.Vector3(tp.cx ?? tp.x, (tp.ctop ?? tp.top) + 0.7, tp.cz ?? tp.z);
        const hover = new THREE.Vector3(perch.x, perch.y + 1, perch.z);
        let pos;
        pr.outline.visible = false;
        if (ph < 3) pos = new THREE.Vector3(perch.x, perch.y, perch.z);
        else if (ph < 4) {
          pos = hover.clone();
          pos.y += Math.sin(ph * 20) * 0.1;
          pr.outline.visible = true;
          if (pr.warned !== slot && player && pz === 9 && P.distanceTo(pos) < 12) { pr.warned = slot; audio.play('beep'); }
        } else if (ph < 5) pos = hover.clone().lerp(target, ph - 4);
        else pos = target.clone().lerp(new THREE.Vector3(perch.x, perch.y, perch.z), Math.min(1, (ph - 5) / 1.5));
        pr.g.position.copy(pos);
        if (ph >= 4 && ph < 5) pr.g.lookAt(target);
        else pr.g.lookAt(pos.x * 3, pos.y, pos.z * 3);
        const flap = Math.sin(t * (ph >= 3 ? 30 : 4)) * 0.6;
        pr.wings[0].rotation.z = flap;
        pr.wings[1].rotation.z = -flap;
        if (player && pz === 9 && !safe && ph >= 4 && ph < 5.2 && pr.hitSlot !== slot && P.distanceTo(new THREE.Vector3(pos.x, pos.y - 0.4, pos.z)) < 1.3) {
          pr.hitSlot = slot;
          audio.play('push');
          const d = target.clone().sub(hover);
          player.hazardPush(d.x, d.z, 4 * push, 3, 0);
        }
      }
      for (const br of this.barrels) {
        const W = this.period(5);
        const tt = t + br.p.ph;
        const slot = Math.floor(tt / W);
        const ph = (tt - slot * W) / W * 5;
        br.hatch.material = toon(ph < 1 && Math.sin(ph * 25) > 0 ? '#ff4d6d' : '#5a3a1a');
        if (ph >= 1 && ph < 3) {
          const k = (ph - 1) / 2;
          const len = br.p.hx + 0.2;
          const x = br.p.x + br.tan.x * (-len + 2 * len * k);
          const z = br.p.z + br.tan.y * (-len + 2 * len * k);
          br.holder.visible = true;
          br.holder.position.set(x, br.p.top + 0.45, z);
          br.holder.rotation.y = -Math.atan2(br.tan.y, br.tan.x) + Math.PI / 2;
          br.roll.rotation.x = -k * 12;
          if (player && pz === 9 && !safe && br.hitSlot !== slot && Math.hypot(P.x - x, P.z - z) < 0.85 && P.y < br.p.top + 0.9 && P.y > br.p.top - 0.3) {
            br.hitSlot = slot;
            audio.play('push');
            player.hazardPush(br.tan.x, br.tan.y, 4 * push, 3, 0);
          }
        } else br.holder.visible = false;
      }
      for (const bm of this.booms) {
        const ang = Math.sin((t / 4) * TAU + bm.p.ph) * 1.3 + bm.p.ph;
        const prevAng = bm.ang ?? ang;
        bm.ang = ang;
        bm.armG.rotation.y = ang;
        if (player && pz === 9 && !safe && P.y < bm.p.top + 1.05 && P.y > bm.p.top - 0.2) {
          // distance from player to the arm segment in XZ
          const ex = Math.cos(-ang), ez = Math.sin(-ang);
          const rx = P.x - bm.p.x, rz = P.z - bm.p.z;
          const along = Math.max(0, Math.min(bm.len, rx * ex + rz * ez));
          const d = Math.hypot(rx - ex * along, rz - ez * along);
          if (d < 0.5 && along > 0.3 && this.canHit('boom' + bm.p.id, 1.2)) {
            const sweep = Math.sign(ang - prevAng) || 1;
            audio.play('push');
            player.hazardPush(ez * sweep, -ex * sweep, 3 * push, 3, 0);
          }
        }
      }
    }

    // ---- zone 10: asteroids, meteors, jellies
    if (fz >= 9) {
      for (const as of this.asteroids) {
        const a = as.f.ang0 + as.f.speed * t;
        as.m.position.set(Math.cos(a) * as.f.r, as.f.y + Math.sin(t * 0.7 + as.f.ang0) * 0.6, Math.sin(a) * as.f.r);
        as.m.rotation.x = t * 0.5;
        as.m.rotation.y = t * 0.3;
        if (player && pz === 10 && !safe && P.distanceTo(as.m.position) < as.f.size + 0.6 && this.canHit('ast', 1.2)) {
          audio.play('push');
          player.hazardPush(P.x - as.m.position.x, P.z - as.m.position.z, 3 * push, 2, 0);
        }
      }
      const M = this.period(2.5);
      const cur = Math.floor(t / M);
      for (const slot of [cur - 1, cur]) {
        const ph = t - slot * M;
        for (const s of this.strikes(this.z10, slot, 13, 3)) {
          if (ph < 1.5) {
            if (ringI < this.rings.length) {
              const r = this.rings[ringI++];
              r.visible = true;
              r.position.set(s.x, s.y + 0.06, s.z);
              r.material.color.set('#2b2b44');
              r.material.opacity = 0.3 + ph * 0.35;
              r.scale.setScalar(0.4 + ph / 2.5);
            }
            if (ph > 0.9 && rockI < this.rocks.length) {
              const rk = this.rocks[rockI++];
              rk.visible = true;
              rk.position.set(s.x + (1.5 - ph) * 6, s.y + (1.5 - ph) * 20, s.z);
            }
          } else if (ph < 1.7 && player && pz === 10 && !safe && Math.hypot(P.x - s.x, P.z - s.z) < 1.7 && Math.abs(P.y - s.y) < 2 && this.canHit(s.key, 2)) {
            audio.play('zap');
            player.hazardPush(P.x - s.x || 0.01, P.z - s.z, 3 * push, 4, 0);
          }
        }
      }
      for (const j of this.jellies) {
        const pulse = 1 + Math.sin(t * 4 + j.p.id) * 0.12;
        j.m.scale.set(0.8 * pulse, 0.6 / pulse, 0.8 * pulse);
        j.m.position.y = j.pos.y + Math.abs(Math.sin(t * 2 + j.p.id)) * 0.4;
        if (player && pz === 10) {
          const dx = P.x - j.m.position.x, dz = P.z - j.m.position.z;
          const dh = Math.hypot(dx, dz);
          const dy = P.y - j.m.position.y;
          if (dh < 1.1 && dy > -0.9 && dy < 0.9 && this.canHit('jelly' + j.p.id, 0.6)) {
            audio.play('bounce');
            if (dy > 0.2) player.springboard(15);
            else player.hazardPush(dx || 0.1, dz, 2.5 * push, 6, 0, true);
          }
        }
      }
    }

    for (let i = ringI; i < this.rings.length; i++) this.rings[i].visible = false;
    for (let i = boltI; i < this.bolts.length; i++) this.bolts[i].visible = false;
    for (let i = rockI; i < this.rocks.length; i++) this.rocks[i].visible = false;
  }
}
