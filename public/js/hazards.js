// Hazards and enemies. Every schedule is a pure function of game time + tower seed,
// so all clients see the same warnings and strikes. Each client only applies pushes to its own player.
import * as THREE from 'three';
import { hash01, zoneAt, SPIRE_R, BIRD_COLORS } from './shared/tower.js';
import { HAZARD_LEVELS } from './shared/settings.js';
import { toon, emojiSprite } from './animals.js';
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
    this.spouts = [];
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
      if (f.type === 'parrot' || f.type === 'bird') this.parrots.push(this.makeSwooper(f));
      if (f.type === 'spout') this.spouts.push(this.makeSpout(f));
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

  makeSwooper(f) {
    const [cb, ch, cw] = BIRD_COLORS[f.zone] || BIRD_COLORS[1];
    const parrot = f.type === 'parrot';
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.sphere, toon(cb));
    body.scale.set(0.3, 0.34, 0.38);
    const head = new THREE.Mesh(this.sphere, toon(ch));
    head.scale.setScalar(0.22);
    head.position.set(0, 0.3, 0.22);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), toon('#ffb703'));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.27, 0.46);
    const wings = [];
    for (const sd of [-1, 1]) {
      const w = new THREE.Mesh(this.sphere, toon(cw));
      w.scale.set(0.45, 0.06, 0.22);
      w.position.set(sd * 0.36, 0.06, 0);
      g.add(w);
      wings.push(w);
      const e = new THREE.Mesh(this.sphere, toon('#ffffff'));
      e.scale.setScalar(0.07);
      e.position.set(sd * 0.1, 0.36, 0.38);
      const pu = new THREE.Mesh(this.sphere, toon('#1b1b1b'));
      pu.scale.setScalar(0.035);
      pu.position.set(sd * 0.1, 0.36, 0.44);
      g.add(e, pu);
    }
    const outline = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: '#ff2d55', side: THREE.BackSide, transparent: true, opacity: 0.85 }));
    outline.scale.set(0.46, 0.6, 0.55);
    outline.visible = false;
    g.add(body, head, beak, outline);
    g.position.set(f.perch.x, f.perch.y, f.perch.z);
    const zg = this.world.zoneGroups[f.zone];
    zg.add(g);
    // telegraph: "!" over the bird and a red ring where it will land its dive
    const alert = emojiSprite('❗', 0.8);
    alert.visible = false;
    zg.add(alert);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.35, 32), new THREE.MeshBasicMaterial({ color: '#ff2d55', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    zg.add(ring);
    return { f, g, wings, outline, alert, ring, parrot, hitSlot: -1, warned: -1 };
  }

  makeSpout(f) {
    const p = this.tower.plats[f.plat];
    const pos = new THREE.Vector3(p.x + p.spout.ox, p.top, p.z + p.spout.oz);
    const g = new THREE.Group();
    g.position.copy(pos);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.25, 12), toon('#5d7a8c'));
    nozzle.position.y = 0.12;
    const water = new THREE.MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.75, depthWrite: false });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 1, 14, 1, true), water);
    column.position.y = 0.5;
    column.scale.y = 0.2;
    const cap = new THREE.Mesh(this.sphere, water);
    cap.scale.set(0.7, 0.35, 0.7);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 28), new THREE.MeshBasicMaterial({ color: '#3a86ff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    const drops = [];
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(this.sphere, water);
      d.scale.setScalar(0.09);
      d.visible = false;
      g.add(d);
      drops.push(d);
    }
    g.add(nozzle, column, cap, ring);
    this.world.zoneGroups[f.zone].add(g);
    return { f, p, pos, g, column, cap, ring, drops, hitSlot: -1, warned: -1 };
  }

  updateSwoopers(t, dt, player, fz, safe) {
    const P = player ? player.pos : null;
    for (const pr of this.parrots) {
      if (Math.abs(pr.f.zone - fz) > 1) continue;
      const W = this.period(pr.parrot ? 7 : 8);
      const tt = t + pr.f.ph;
      const slot = Math.floor(tt / W);
      const ph = ((tt - slot * W) / W) * 8; // 0-3.3 perched, 3.3-4.6 warning, 4.6-5.4 dive, 5.4-7 return
      const perch = pr.f.perch;
      const tp = this.tower.plats[pr.f.targets[Math.floor(hash01(this.seed, slot, pr.f.targets.length, pr.f.zone) * pr.f.targets.length)]];
      const target = new THREE.Vector3(tp.cx ?? tp.x, (tp.ctop ?? tp.top) + 0.6, tp.cz ?? tp.z);
      const hover = new THREE.Vector3(perch.x, perch.y + 1.2, perch.z);
      const beyond = target.clone().add(target.clone().sub(hover).setY(0).normalize().multiplyScalar(2.5));
      let pos;
      const warning = ph >= 3.3 && ph < 4.6;
      const diving = ph >= 4.6 && ph < 5.4;
      pr.outline.visible = warning || diving;
      pr.alert.visible = warning;
      pr.ring.visible = warning || diving;
      if (pr.ring.visible) {
        pr.ring.position.set(target.x, target.y - 0.55, target.z);
        const k = warning ? (ph - 3.3) / 1.3 : 1;
        pr.ring.scale.setScalar(0.6 + k * 0.6);
        pr.ring.material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(ph * 10));
      }
      if (ph < 3.3) pos = new THREE.Vector3(perch.x, perch.y + Math.abs(Math.sin(t * 2 + pr.f.ph)) * 0.05, perch.z);
      else if (warning) {
        pos = hover.clone();
        pos.y += Math.sin(ph * 20) * 0.12;
        if (pr.warned !== slot && P && P.distanceTo(target) < 14) { pr.warned = slot; audio.play('squawk'); }
      } else if (diving) {
        const k = (ph - 4.6) / 0.8;
        pos = k < 0.75 ? hover.clone().lerp(target, k / 0.75) : target.clone().lerp(beyond, (k - 0.75) / 0.25);
      } else pos = beyond.clone().lerp(new THREE.Vector3(perch.x, perch.y, perch.z), Math.min(1, (ph - 5.4) / 1.6));
      pr.g.position.copy(pos);
      pr.alert.position.set(pos.x, pos.y + 0.9, pos.z);
      if (diving) pr.g.lookAt(beyond);
      else if (warning) pr.g.lookAt(target.x, pos.y, target.z);
      else pr.g.lookAt(pos.x * 3, pos.y, pos.z * 3);
      const flap = Math.sin(t * (ph >= 3.3 ? 30 : 4)) * 0.6;
      pr.wings[0].rotation.z = flap;
      pr.wings[1].rotation.z = -flap;
      if (P && !safe && diving && pr.hitSlot !== slot && P.distanceTo(new THREE.Vector3(pos.x, pos.y - 0.3, pos.z)) < 1.3) {
        pr.hitSlot = slot;
        audio.play('push');
        const d = beyond.clone().sub(hover);
        player.hazardPush(d.x, d.z, (pr.parrot ? 4 : 3.5) * this.level.push, 4, 0);
      }
    }
  }

  updateSpouts(t, dt, player, fz, safe) {
    const P = player ? player.pos : null;
    for (const sp of this.spouts) {
      if (Math.abs(sp.f.zone - fz) > 1) continue;
      const W = this.period(6);
      const tt = t + sp.f.ph;
      const slot = Math.floor(tt / W);
      const ph = ((tt - slot * W) / W) * 6; // 0-2.3 idle, 2.3-3.8 warning, 3.8-4.8 eruption
      const warning = ph >= 2.3 && ph < 3.8;
      const erupting = ph >= 3.8 && ph < 4.8;
      let h = 0.2 + Math.sin(t * 6 + sp.f.ph) * 0.05;
      if (warning) h = 0.35 + Math.abs(Math.sin(ph * 14)) * 0.25;
      if (erupting) h = Math.min(6, (ph - 3.8) * 40) * (ph > 4.5 ? (4.8 - ph) / 0.3 : 1);
      sp.column.scale.y = Math.max(0.05, h);
      sp.column.position.y = sp.column.scale.y / 2;
      sp.cap.position.y = sp.column.scale.y;
      sp.cap.visible = erupting || warning;
      sp.ring.visible = warning;
      if (warning) {
        sp.ring.scale.setScalar(0.8 + ((ph - 2.3) / 1.5) * 0.5);
        sp.ring.material.color.set(Math.sin(ph * 16) > 0 ? '#3a86ff' : '#ffffff');
      }
      sp.drops.forEach((d, i) => {
        d.visible = warning || erupting;
        if (!d.visible) return;
        const a = (i / sp.drops.length) * TAU + t * 2;
        const up = erupting ? 1 : 0.3;
        const k = ((t * (erupting ? 2.5 : 1.5) + i / sp.drops.length) % 1);
        d.position.set(Math.cos(a) * (0.4 + k * (erupting ? 1.4 : 0.4)), sp.column.scale.y * (erupting ? 0.6 : 1) + Math.sin(k * Math.PI) * up, Math.sin(a) * (0.4 + k * (erupting ? 1.4 : 0.4)));
      });
      if (!P) continue;
      const dist = Math.hypot(P.x - sp.pos.x, P.z - sp.pos.z);
      if (warning && sp.warned !== slot && dist < 8 && Math.abs(P.y - sp.pos.y) < 4) { sp.warned = slot; audio.play('gurgle'); }
      if (erupting && !safe && sp.hitSlot !== slot && dist < 1.1 && P.y > sp.pos.y - 0.3 && P.y < sp.pos.y + h) {
        sp.hitSlot = slot;
        audio.play('geyser');
        let dx = P.x - sp.pos.x, dz = P.z - sp.pos.z;
        if (Math.hypot(dx, dz) < 0.2) { dx = sp.pos.x; dz = sp.pos.z; } // dead centre: push outward from the tower
        player.hazardPush(dx, dz, 3.5 * this.level.push, 11, 0);
      }
    }
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

    // ---- swooping birds (every zone; parrots in zone 9) and water spouts
    this.updateSwoopers(t, dt, player, fz, safe);
    this.updateSpouts(t, dt, player, fz, safe);

    // ---- zone 9: barrels, booms
    if (fz >= 8 && fz <= 10) {
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
