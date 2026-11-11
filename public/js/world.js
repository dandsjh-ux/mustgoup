// Builds the tower from the shared generator: meshes (instanced where static), colliders,
// moving platforms, gates, checkpoints, sky, particles and decorations.
import * as THREE from 'three';
import { ZONES, ZONE_H, SPIRE_R, DECK_R, GROUND_R, platformMotion, zoneAt, mulberry32 } from './shared/tower.js';
import { toon, AnimalModel, emojiSprite, emojiTexture } from './animals.js';

const STATIC_KINDS = new Set(['normal', 'rope', 'pad', 'landing', 'bounce', 'ice', 'bouncy', 'barrel', 'boom', 'jelly', 'dome']);
const BUCKET = 4;

const KIND_COLORS = {
  pad: ['#ffd166', '#fff1b8'],
  bounce: [null, '#ff8fc8'],
  ice: ['#8fc9ef', '#d4f1ff'],
  slide: ['#8fc9ef', '#d4f1ff'],
  bouncy: ['#ffe3f1', '#ffd6ec'],
  fade: ['#d9c8ff', '#efe6ff'],
  leaf: ['#3e8a2a', '#6fcf3f'],
  drift: ['#b9773c', '#e8b06a'],
  sink: ['#b9773c', '#e8b06a'],
  gear: ['#b8932c', '#e3c15a'],
  conveyor: ['#5a5a66', '#7a7a88'],
  piston: ['#8a6a35', '#c9a25a'],
  crumble: ['#8a8270', '#b3b58f'],
  airship: ['#6b4523', '#b07a45'],
  dome: [null, '#cfe8ff'],
  rope: ['#6b4a2b', '#e8c98a'],
};

// Zone boost pads: a glowing disc with a bobbing icon. Walking onto it launches you upward.
const BOOST_THEME = {
  1: { icon: '🌼', color: '#ffd23d' }, 2: { icon: '🍄', color: '#ff5c5c' }, 3: { icon: '🐸', color: '#4ecdc4' },
  4: { icon: '❄️', color: '#8fd0ff' }, 5: { icon: '🌈', color: '#ff8fc8' }, 6: { icon: '🎈', color: '#ffa94d' },
  7: { icon: '⚙️', color: '#e3c15a' }, 8: { icon: '⚡', color: '#ffe14d' }, 9: { icon: '⚓', color: '#ff7a45' },
  10: { icon: '🚀', color: '#a78bfa' },
};

function boxGeoWithShade(sideX = 0.82, sideZ = 0.74) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.normal;
  const cols = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i);
    const v = ny > 0.5 ? 1 : ny < -0.5 ? 0.6 : (Math.abs(n.getX(i)) > 0.5 ? sideX : sideZ);
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function circleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.shadeGeo = boxGeoWithShade();
    // grass/snow caps get dark side faces so the lip of every platform reads as a clear band
    this.capGeo = boxGeoWithShade(0.5, 0.42);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 28);
    this.sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    this.isPassable = () => false;
    this.quality = 'high';
  }

  build(tower) {
    this.tower = tower;
    this.plats = tower.plats;
    this.dynamic = [];
    this.boostAnims = [];
    this.temp = [];
    this.buckets = new Map();
    this.zoneGroups = [];
    for (let z = 0; z <= 10; z++) {
      const g = new THREE.Group();
      this.root.add(g);
      this.zoneGroups.push(g);
    }
    const rand = mulberry32(tower.seed + 7);
    this.rand = rand;

    for (const p of this.plats) {
      Object.assign(p, { cx: p.x, cz: p.z, ctop: p.top, solid: true, rot: 0, dx: 0, dy: 0, dz: 0, drot: 0, local: {} });
      this.index(p);
    }
    this.spire = { id: -1, kind: 'spire', shape: 'cyl', x: 0, z: 0, cx: 0, cz: 0, r: SPIRE_R, hx: SPIRE_R, hz: SPIRE_R, top: tower.finishY - 1.9, ctop: tower.finishY - 1.9, h: tower.finishY + 10, solid: true, dx: 0, dy: 0, dz: 0, drot: 0, local: {} };

    this.buildPlatforms(rand);
    this.buildSpire();
    this.buildDecks();
    this.buildGates();
    this.buildFeatures(rand);
    this.buildDecor(rand);
    this.buildSky();
    this.buildParticles();
    this.arrows = [this.makeArrow(), this.makeArrow()];
  }

  dispose() {
    this.root.removeFromParent();
    this.scene.fog = null;
    for (const o of [this.stars, this.particles, this.planets]) o?.removeFromParent();
  }

  index(p) {
    const lo = Math.floor((p.top - p.h - 3) / BUCKET);
    const hi = Math.floor((p.top + 3) / BUCKET);
    for (let b = lo; b <= hi; b++) {
      if (!this.buckets.has(b)) this.buckets.set(b, []);
      this.buckets.get(b).push(p);
    }
  }

  unindex(p) {
    for (const list of this.buckets.values()) {
      const i = list.indexOf(p);
      if (i >= 0) list.splice(i, 1);
    }
  }

  query(y) {
    const b = Math.floor(y / BUCKET);
    const out = [this.spire];
    this.stamp = (this.stamp || 0) + 1;
    for (let k = b - 1; k <= b + 2; k++) {
      const list = this.buckets.get(k);
      if (!list) continue;
      for (const p of list) {
        if (p._q === this.stamp) continue;
        p._q = this.stamp;
        out.push(p);
      }
    }
    return out;
  }

  isSolid(p) {
    if (!p.solid) return false;
    if (p.kind === 'ceiling') return !this.isPassable(p.gate);
    return true;
  }

  // ---------------------------------------------------------------- building
  buildPlatforms(rand) {
    const perZone = new Map();
    for (const p of this.plats) {
      if (p.noSide) continue;
      if (STATIC_KINDS.has(p.kind) && p.shape === 'box') {
        if (!perZone.has(p.zone)) perZone.set(p.zone, []);
        perZone.get(p.zone).push(p);
      } else {
        this.buildDynamic(p);
      }
    }
    const bodyMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon('#fff').gradientMap });
    const capMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon('#fff').gradientMap });
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const [zone, list] of perZone) {
      const Z = ZONES[zone - 1];
      const body = new THREE.InstancedMesh(this.shadeGeo, bodyMat, list.length);
      const cap = new THREE.InstancedMesh(this.capGeo, capMat, list.length);
      const edge = new Float32Array(list.length * 24);
      list.forEach((p, i) => {
        const [side, top] = KIND_COLORS[p.kind] || [];
        const capC = p.route === 'short' ? '#ffd23d' : top || Z.top;
        m4.compose(new THREE.Vector3(p.x, p.top - p.h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(p.sx, p.h, p.sz));
        body.setMatrixAt(i, m4);
        body.setColorAt(i, col.set(side || Z.side));
        m4.compose(new THREE.Vector3(p.x, p.top - 0.15, p.z), new THREE.Quaternion(), new THREE.Vector3(p.sx + 0.2, 0.32, p.sz + 0.2));
        cap.setMatrixAt(i, m4);
        cap.setColorAt(i, col.set(capC));
        edge.set(this.rimPoints(p.x, p.top + 0.02, p.z, p.hx + 0.1, p.hz + 0.1), i * 24);
      });
      this.zoneGroups[zone].add(this.rimLines(edge, Z.side));
      body.instanceMatrix.needsUpdate = cap.instanceMatrix.needsUpdate = true;
      body.instanceColor.needsUpdate = cap.instanceColor.needsUpdate = true;
      body.computeBoundingSphere();
      cap.computeBoundingSphere();
      this.zoneGroups[zone].add(body, cap);
      // extras on static kinds
      for (const p of list) {
        if (p.kind === 'pad') this.padRing(p);
        if (p.kind === 'bounce') this.flowerPad(p);
        if (p.kind === 'rope') this.ropePosts(p);
        if (p.boost) this.boostPad(p);
        if (p.kind === 'dome') {
          const d = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
          d.scale.set(2.4, 2.4, 2.4);
          d.position.set(p.x, p.top, p.z);
          this.zoneGroups[zone].add(d);
        }
        if (p.kind === 'conveyor') { /* conveyor is dynamic */ }
      }
    }
  }

  padRing(p) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: '#ffe066' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, p.top + 0.08, p.z);
    this.zoneGroups[p.zone].add(ring);
    p.ringMesh = ring;
  }

  // Tightrope: little posts with knobs at both ends of the slim beam
  ropePosts(p) {
    const alongX = p.hx > p.hz;
    const knob = toon('#8a5a2b');
    const post = toon('#6b4a2b');
    for (const sd of [-1, 1]) {
      const x = p.x + (alongX ? sd * (p.hx - 0.12) : 0);
      const z = p.z + (alongX ? 0 : sd * (p.hz - 0.12));
      const c = new THREE.Mesh(this.cylGeo, post);
      c.scale.set(0.07, 0.55, 0.07);
      c.position.set(x, p.top + 0.27, z);
      const k = new THREE.Mesh(this.sphereGeo, knob);
      k.scale.setScalar(0.15);
      k.position.set(x, p.top + 0.58, z);
      this.zoneGroups[p.zone].add(c, k);
    }
  }

  boostPad(p) {
    const th = BOOST_THEME[p.zone] || BOOST_THEME[1];
    const b = p.boost;
    const g = new THREE.Group();
    g.position.set(p.x + b.ox, p.top, p.z + b.oz);
    const disc = new THREE.Mesh(this.cylGeo, new THREE.MeshToonMaterial({ color: th.color, emissive: th.color, emissiveIntensity: 0.55, gradientMap: toon('#fff').gradientMap }));
    disc.scale.set(0.95, 0.07, 0.95);
    disc.position.y = 0.04;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 28), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    g.add(disc, ring);
    // two stacked chevrons that rise and fade, showing the way up
    const chev = [];
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 4), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
      c.rotation.y = Math.PI / 4;
      g.add(c);
      chev.push(c);
    }
    const icon = emojiSprite(th.icon, 0.8);
    icon.material.depthTest = true;
    g.add(icon);
    this.zoneGroups[p.zone].add(g);
    (this.boostAnims = this.boostAnims || []).push({ p, g, chev, icon, ring });
  }

  flowerPad(p) {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pet = new THREE.Mesh(this.sphereGeo, toon('#ff6fb5'));
      pet.scale.set(0.9, 0.12, 0.5);
      pet.position.set(Math.cos(a) * 1.1, 0.06, Math.sin(a) * 1.1);
      pet.rotation.y = -a;
      g.add(pet);
    }
    const c = new THREE.Mesh(this.sphereGeo, toon('#ffd23d'));
    c.scale.set(0.7, 0.2, 0.7);
    c.position.y = 0.1;
    g.add(c);
    g.position.set(p.x, p.top, p.z);
    this.zoneGroups[p.zone].add(g);
  }

  buildDynamic(p) {
    const Z = ZONES[p.zone - 1];
    const [side, top] = KIND_COLORS[p.kind] || [Z.side, Z.top];
    const g = new THREE.Group();
    let bodyMat = toon(side || Z.side);
    let capMat = toon(top || Z.top);
    if (p.kind === 'fade' || p.kind === 'crumble') {
      bodyMat = bodyMat.clone();
      capMat = capMat.clone();
      bodyMat.transparent = capMat.transparent = true;
      p.mats = [bodyMat, capMat];
    }
    if (p.shape === 'cyl') {
      const b = new THREE.Mesh(this.cylGeo, bodyMat);
      b.scale.set(p.r, p.h, p.r);
      b.position.y = -p.h / 2;
      const c = new THREE.Mesh(this.cylGeo, capMat);
      c.scale.set(p.r + 0.04, 0.22, p.r + 0.04);
      c.position.y = -0.1;
      g.add(b, c);
      if (p.kind === 'gear') {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const tooth = new THREE.Mesh(this.shadeGeo, bodyMat);
          tooth.scale.set(0.6, p.h * 0.8, 0.5);
          tooth.position.set(Math.cos(a) * (p.r + 0.2), -p.h / 2, Math.sin(a) * (p.r + 0.2));
          tooth.rotation.y = -a;
          g.add(tooth);
        }
        const hub = new THREE.Mesh(this.cylGeo, toon('#8a6a35'));
        hub.scale.set(0.6, 0.3, 0.6);
        hub.position.y = 0.05;
        g.add(hub);
      }
    } else {
      const b = new THREE.Mesh(this.shadeGeo, bodyMat);
      b.scale.set(p.sx, p.h, p.sz);
      b.position.y = -p.h / 2;
      const c = new THREE.Mesh(this.capGeo, capMat);
      c.scale.set(p.sx + 0.2, 0.32, p.sz + 0.2);
      c.position.y = -0.15;
      const rim = this.rimLines(new Float32Array(this.rimPoints(0, 0.02, 0, p.hx + 0.1, p.hz + 0.1)), side || Z.side);
      if (p.mats) { rim.material = rim.material.clone(); rim.material.transparent = true; p.mats.push(rim.material); }
      g.add(b, c, rim);
      if (p.kind === 'conveyor') {
        const tex = this.chevronTexture();
        const m = new THREE.Mesh(new THREE.PlaneGeometry(p.sx * 0.9, p.sz * 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        m.rotation.x = -Math.PI / 2;
        const a = Math.atan2(p.z, p.x);
        // chevrons point along the conveyor direction (tangent)
        m.rotation.z = -a + (p.dir > 0 ? 0 : Math.PI);
        m.position.y = 0.03;
        g.add(m);
        p.tex = tex;
      }
      if (p.kind === 'drift' || p.kind === 'sink') {
        const balloon = new THREE.Mesh(this.sphereGeo, toon(['#ff6b6b', '#ffd166', '#4ecdc4', '#a78bfa', '#ff8fc8'][p.id % 5]));
        balloon.scale.set(1.5, 1.8, 1.5);
        balloon.position.set(p.sx / 2 - 0.3, 4.2, -p.sz / 2 + 0.3);
        const rope = new THREE.Mesh(this.cylGeo, toon('#7a5a3a'));
        rope.scale.set(0.03, 2.6, 0.03);
        rope.position.set(p.sx / 2 - 0.3, 1.3, -p.sz / 2 + 0.3);
        g.add(balloon, rope);
      }
      if (p.kind === 'airship') {
        const env = new THREE.Mesh(this.sphereGeo, toon('#e9e2d0'));
        env.scale.set(p.sx * 0.45, 1.1, p.sz * 0.45);
        env.position.y = 4.3;
        const mast = new THREE.Mesh(this.cylGeo, toon('#6b4523'));
        mast.scale.set(0.08, 3.2, 0.08);
        mast.position.set(p.sx / 2 - 0.25, 1.6, 0);
        g.add(env, mast);
      }
      if (p.kind === 'piston') {
        const rod = new THREE.Mesh(this.cylGeo, toon('#9aa0a8'));
        rod.scale.set(0.5, 6, 0.5);
        rod.position.y = -4;
        g.add(rod);
      }
      if (p.kind === 'leaf') {
        const vein = new THREE.Mesh(this.shadeGeo, toon('#4e9e2e'));
        vein.scale.set(0.15, 0.05, p.sz * 0.9);
        vein.position.y = 0.03;
        g.add(vein);
      }
    }
    g.position.set(p.x, p.top, p.z);
    p.mesh = g;
    this.zoneGroups[p.zone].add(g);
    this.dynamic.push(p);
  }

  // Outline around the top edge of a platform (4 line segments)
  rimPoints(x, y, z, hx, hz) {
    const a = [x - hx, y, z - hz], b = [x + hx, y, z - hz], c = [x + hx, y, z + hz], d = [x - hx, y, z + hz];
    return [...a, ...b, ...b, ...c, ...c, ...d, ...d, ...a];
  }

  rimLines(points, sideColor) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const color = new THREE.Color(sideColor).multiplyScalar(0.4);
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
  }

  chevronTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#ffd23d';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    for (const y of [16, 48]) {
      ctx.beginPath();
      ctx.moveTo(14, y - 10);
      ctx.lineTo(32, y + 4);
      ctx.lineTo(50, y - 10);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 2);
    return t;
  }

  buildSpire() {
    const top = this.tower.finishY;
    for (let z = 1; z <= 10; z++) {
      const y0 = (z - 1) * ZONE_H;
      if (y0 >= top) break;
      const y1 = Math.min(z * ZONE_H, top - 1.9);
      const m = new THREE.Mesh(this.cylGeo, toon(ZONES[z - 1].spire));
      m.scale.set(SPIRE_R, y1 - y0, SPIRE_R);
      m.position.y = (y0 + y1) / 2;
      this.zoneGroups[z].add(m);
      // bands for a bit of shape
      for (let y = y0 + 10; y < y1; y += 20) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(SPIRE_R + 0.05, 0.2, 6, 28), toon(ZONES[z - 1].side));
        band.rotation.x = Math.PI / 2;
        band.position.y = y;
        this.zoneGroups[z].add(band);
      }
    }
  }

  buildDecks() {
    this.merchants = [];
    for (const p of this.plats) {
      if (p.kind === 'deck') {
        const Z = ZONES[p.zone - 1];
        const g = new THREE.Group();
        if (p.id === 0) {
          const ground = new THREE.Mesh(this.cylGeo, toon('#5b9e46'));
          ground.scale.set(80, 4, 80);
          ground.position.y = -2;
          const dirt = new THREE.Mesh(this.cylGeo, toon('#c98b52'));
          dirt.scale.set(79.6, 30, 79.6);
          dirt.position.y = -19;
          g.add(ground, dirt);
          // a hedge ring shows where the play area ends
          const hedge = new THREE.Mesh(new THREE.TorusGeometry(30, 0.8, 8, 64), toon('#3f7f34'));
          hedge.rotation.x = Math.PI / 2;
          hedge.position.y = 0.5;
          g.add(hedge);
        } else {
          const d = new THREE.Mesh(this.cylGeo, toon(Z.side));
          d.scale.set(DECK_R, p.h, DECK_R);
          d.position.y = -p.h / 2;
          const cap = new THREE.Mesh(this.cylGeo, toon(Z.top));
          cap.scale.set(DECK_R + 0.05, 0.22, DECK_R + 0.05);
          cap.position.y = -0.1;
          const rim = new THREE.Mesh(new THREE.TorusGeometry(DECK_R, 0.25, 8, 64), toon('#ffd166'));
          rim.rotation.x = Math.PI / 2;
          rim.position.y = 0.1;
          g.add(d, cap, rim);
        }
        g.position.set(0, p.top, 0);
        this.zoneGroups[p.zone].add(g);
      }
      if (p.kind === 'summit') {
        const g = new THREE.Group();
        const moon = new THREE.Mesh(this.sphereGeo, toon('#e8e8f0'));
        moon.scale.set(p.r, 2.2, p.r);
        moon.position.y = -2.2;
        g.add(moon);
        for (let i = 0; i < 6; i++) {
          const cr = new THREE.Mesh(this.cylGeo, toon('#c4c4d4'));
          const a = i * 1.1;
          cr.scale.set(0.6 + (i % 3) * 0.3, 0.08, 0.6 + (i % 3) * 0.3);
          cr.position.set(Math.cos(a) * 4.2, 0.02, Math.sin(a) * 4.2);
          g.add(cr);
        }
        this.flag = new THREE.Group();
        const pole = new THREE.Mesh(this.cylGeo, toon('#cccccc'));
        pole.scale.set(0.08, 3, 0.08);
        pole.position.y = 1.5;
        this.flagCloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: '#ff7a59', side: THREE.DoubleSide }));
        this.flagCloth.position.set(0.72, 2.5, 0);
        this.flag.add(pole, this.flagCloth);
        this.flag.visible = false;
        g.add(this.flag);
        const sign = emojiSprite('🏁', 1.6);
        sign.position.set(0, 4.5, 0);
        g.add(sign);
        g.position.set(0, p.top, 0);
        this.zoneGroups[10].add(g);
        this.summit = p;
      }
    }
    for (const cp of this.tower.checkpoints) {
      const m = this.buildMerchant();
      m.position.set(cp.merchant.x, cp.y, cp.merchant.z);
      m.lookAt(0, cp.y, 0);
      m.rotateY(Math.PI);
      this.zoneGroups[cp.zone].add(m);
      this.merchants.push({ zone: cp.zone, pos: new THREE.Vector3(cp.merchant.x, cp.y, cp.merchant.z), group: m });
    }
  }

  buildMerchant() {
    const g = new THREE.Group();
    // stall
    const counter = new THREE.Mesh(this.shadeGeo, toon('#a0703c'));
    counter.scale.set(2.6, 1, 1);
    counter.position.set(0, 0.5, 0.9);
    g.add(counter);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(this.cylGeo, toon('#7a5230'));
      post.scale.set(0.08, 2.6, 0.08);
      post.position.set(s * 1.2, 1.3, 0.9);
      g.add(post);
    }
    for (let i = 0; i < 5; i++) {
      const stripe = new THREE.Mesh(this.shadeGeo, toon(i % 2 ? '#ffffff' : '#ff6b6b'));
      stripe.scale.set(0.56, 0.12, 1.6);
      stripe.position.set(-1.12 + i * 0.56, 2.65, 0.6);
      stripe.rotation.x = 0.3;
      g.add(stripe);
    }
    // raccoon
    const r = new AnimalModel({ animal: 'koala', tint: 0, hat: 'none', trail: 'none' });
    // repaint as a raccoon: grey body with a dark mask
    r.root.scale.setScalar(1.3);
    r.root.position.set(0, 0, 0);
    const mask = new THREE.Mesh(this.sphereGeo, toon('#2b2b2b'));
    mask.scale.set(0.24, 0.07, 0.05);
    mask.position.set(0, 0.04, 0.23);
    r.head.add(mask);
    g.add(r.root);
    g.userData.model = r;
    const sign = emojiSprite('🦝', 0.9);
    sign.position.set(0, 3.3, 0.6);
    g.add(sign);
    return g;
  }

  buildOwl(zone) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.sphereGeo, toon('#a0785a'));
    body.scale.set(0.5, 0.6, 0.45);
    body.position.y = 0.6;
    const bellyM = new THREE.Mesh(this.sphereGeo, toon('#f3e3c8'));
    bellyM.scale.set(0.36, 0.42, 0.2);
    bellyM.position.set(0, 0.55, 0.3);
    g.add(body, bellyM);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(this.sphereGeo, toon('#ffffff'));
      eye.scale.set(0.17, 0.17, 0.08);
      eye.position.set(s * 0.18, 0.9, 0.36);
      const pu = new THREE.Mesh(this.sphereGeo, toon('#1b1b1b'));
      pu.scale.set(0.08, 0.08, 0.05);
      pu.position.set(s * 0.18, 0.9, 0.43);
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 4), toon('#7a5a40'));
      tuft.position.set(s * 0.3, 1.22, 0);
      tuft.rotation.z = s * -0.4;
      g.add(eye, pu, tuft);
    }
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), toon('#ffb703'));
    beak.rotation.x = Math.PI / 2 + 0.3;
    beak.position.set(0, 0.78, 0.46);
    g.add(beak);
    // zone outfit
    if (zone === 4) { const sc = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.09, 6, 16), toon('#e63946')); sc.rotation.x = Math.PI / 2; sc.position.y = 0.48; g.add(sc); }
    if (zone === 10) { const helm = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.3 })); helm.scale.setScalar(0.75); helm.position.y = 0.8; g.add(helm); }
    if (zone === 9) { const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 3), toon('#2b2b2b')); hat.position.y = 1.35; g.add(hat); }
    if (zone === 7) { const mon = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 16), toon('#d4af37')); mon.position.set(0.18, 0.9, 0.45); g.add(mon); }
    if (zone === 1 || zone === 2) { const f = emojiSprite('🌼', 0.35); f.position.set(0.3, 1.25, 0.1); g.add(f); }
    if (zone === 8) { const u = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon('#3a86ff')); u.position.y = 1.7; g.add(u); }
    return g;
  }

  buildGates() {
    this.gateViz = [];
    const discGeo = new THREE.CylinderGeometry(DECK_R, DECK_R, 0.5, 48, 1, true);
    const topGeo = new THREE.CircleGeometry(DECK_R, 48);
    for (const g of this.tower.gates) {
      const grp = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#9be7ff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
      const side = new THREE.Mesh(discGeo, mat);
      side.position.y = g.ceilTop - 0.25;
      const top = new THREE.Mesh(topGeo, mat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = g.ceilTop - 0.5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(DECK_R, 0.18, 8, 64), new THREE.MeshBasicMaterial({ color: '#c9f4ff' }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = g.ceilTop - 0.25;
      grp.add(side, top, ring);
      const pad = this.plats[g.pad];
      const owl = this.buildOwl(g.zone);
      const a = Math.atan2(pad.z, pad.x);
      // sit on the side edge (along the spiral), so the owl never blocks the camera behind the player
      owl.position.set(pad.x - Math.sin(a) * (pad.hx - 0.7), pad.top, pad.z + Math.cos(a) * (pad.hz - 0.7));
      owl.lookAt(pad.x, pad.top, pad.z);
      grp.add(owl);
      const label = emojiSprite('❓', 0.8);
      label.position.set(pad.x, pad.top + 3.6, pad.z);
      grp.add(label);
      this.zoneGroups[g.zone].add(grp);
      this.gateViz.push({ grp, mat, owl, label, ring, open: false, pad });
    }
  }

  setGateOpen(i, open) {
    const v = this.gateViz[i];
    if (!v || v.open === open) return;
    v.open = open;
    v.mat.opacity = open ? 0.06 : 0.28;
    v.ring.material.color.set(open ? '#7dffb0' : '#c9f4ff');
    v.label.material.map = emojiTexture(open ? '✅' : '❓');
  }

  buildFeatures(rand) {
    this.feats = this.tower.feats;
    for (const f of this.feats) {
      if (f.type === 'sign') {
        const s = this.makeSign(f.icon);
        if (f.onPlat) {
          const a = Math.atan2(f.z, f.x);
          s.position.set(f.x - Math.cos(a) * 2.2, f.y, f.z - Math.sin(a) * 2.2);
        } else s.position.set(f.x, f.y, f.z);
        s.lookAt(0, s.position.y, 0);
        s.rotateY(Math.PI);
        this.zoneGroups[1].add(s);
      }
      if (f.type === 'waterfall') {
        const h = f.y1 - f.y0;
        const tex = this.waterTexture();
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(Math.cos(f.ang) * (SPIRE_R + 0.15), (f.y0 + f.y1) / 2, Math.sin(f.ang) * (SPIRE_R + 0.15));
        m.lookAt(Math.cos(f.ang) * 10, m.position.y, Math.sin(f.ang) * 10);
        tex.repeat.set(1, h / 6);
        f.tex = tex;
        this.zoneGroups[3].add(m);
      }
    }
  }

  waterTexture() {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7fd4ff';
    ctx.fillRect(0, 0, 32, 64);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 7) % 30, (i * 17) % 64, 2, 10);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  makeSign(icon) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff8e7';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = '#a0703c';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 150);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const emoji = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    const key = (x, y, w, label) => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1d1b3a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, 40, 8) : ctx.rect(x, y, w, 40);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1d1b3a';
      ctx.font = '900 22px Nunito, sans-serif';
      ctx.fillText(label, x + w / 2, y + 21);
    };
    switch (icon) {
      case 'move': key(98, 18, 44, 'W'); key(50, 62, 44, 'A'); key(98, 62, 44, 'S'); key(146, 62, 44, 'D'); ctx.font = `40px ${emoji}`; ctx.fillText('🕹️', 216, 62); ctx.font = `30px ${emoji}`; ctx.fillText('🏃💨', 128, 132); break;
      case 'camera': key(98, 18, 44, '↑'); key(50, 62, 44, '←'); key(98, 62, 44, '↓'); key(146, 62, 44, '→'); ctx.font = `40px ${emoji}`; ctx.fillText('👆', 216, 62); ctx.font = `30px ${emoji}`; ctx.fillText('🎥 👀', 128, 132); break;
      case 'jump': key(40, 50, 120, 'SPACE'); ctx.font = `56px ${emoji}`; ctx.fillText('⤴️', 200, 70); ctx.font = `30px ${emoji}`; ctx.fillText('🐰⬆️', 128, 128); break;
      case 'double': key(16, 50, 100, 'SPACE'); key(140, 50, 100, 'SPACE'); ctx.font = `34px ${emoji}`; ctx.fillText('⬆️ ⬆️  = 🌀', 128, 128); break;
      case 'gate': ctx.font = `56px ${emoji}`; ctx.fillText('🦉❓', 128, 62); ctx.font = `34px ${emoji}`; ctx.fillText('✅✅✅ ➡️ ⬆️', 128, 124); break;
      default: break;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    // two single-sided faces back to back, so the picture is readable (not mirrored) from either side
    const board = new THREE.Group();
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), faceMat);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), faceMat);
    back.rotation.y = Math.PI;
    board.add(front, back);
    board.position.y = 1.9;
    const post = new THREE.Mesh(this.cylGeo, toon('#7a5230'));
    post.scale.set(0.08, 1.2, 0.08);
    post.position.y = 0.6;
    g.add(board, post);
    return g;
  }

  buildDecor(rand) {
    const Rr = (a, b) => a + (b - a) * rand();
    const inst = (geo, mat, list, zone) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      list.forEach((d, i) => {
        m4.compose(d.p, d.q || new THREE.Quaternion(), d.s);
        m.setMatrixAt(i, m4);
        if (d.c) m.setColorAt(i, col.set(d.c));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.zoneGroups[zone].add(m);
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const byZone = (z) => this.plats.filter((p) => p.zone === z && p.shape === 'box' && (p.kind === 'normal' || p.kind === 'landing'));

    // Zone 1: flowers
    const heads = [];
    const stems = [];
    for (const p of byZone(1)) for (let i = 0; i < 3; i++) {
      const x = p.x + Rr(-p.hx + 0.4, p.hx - 0.4);
      const z = p.z + Rr(-p.hz + 0.4, p.hz - 0.4);
      stems.push({ p: V(x, p.top + 0.2, z), s: V(0.04, 0.4, 0.04) });
      heads.push({ p: V(x, p.top + 0.42, z), s: V(0.15, 0.1, 0.15), c: ['#ff8fc8', '#ffd23d', '#ffffff', '#b28dff'][i % 4] });
    }
    for (let i = 0; i < 80; i++) {
      const a = rand() * Math.PI * 2;
      const r = Rr(4, 28);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      stems.push({ p: V(x, 0.2, z), s: V(0.04, 0.4, 0.04) });
      heads.push({ p: V(x, 0.42, z), s: V(0.15, 0.1, 0.15), c: ['#ff8fc8', '#ffd23d', '#ffffff', '#b28dff'][i % 4] });
    }
    inst(this.cylGeo, toon('#4caf50'), stems, 1);
    inst(this.sphereGeo, new THREE.MeshToonMaterial({ gradientMap: toon('#fff').gradientMap }), heads, 1);

    // Zone 2: giant tree canopy around the spire
    const leaves = [];
    for (let y = ZONE_H + 6; y < ZONE_H * 2; y += 9) for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2;
      leaves.push({ p: V(Math.cos(a) * 3.2, y + Rr(-2, 2), Math.sin(a) * 3.2), s: V(Rr(1.8, 2.6), Rr(1.4, 2), Rr(1.8, 2.6)), c: ['#5fbf3a', '#4e9e2e', '#7ed957'][k % 3] });
    }
    inst(this.sphereGeo, new THREE.MeshToonMaterial({ gradientMap: toon('#fff').gradientMap }), leaves, 2);

    // Zone 4: pine trees
    const pines = [];
    for (const p of byZone(4)) if (rand() < 0.5) {
      const x = p.x + Rr(-p.hx + 0.6, p.hx - 0.6);
      const z = p.z + Rr(-p.hz + 0.6, p.hz - 0.6);
      pines.push({ p: V(x, p.top + 1, z), s: V(0.6, 2, 0.6) });
    }
    inst(new THREE.ConeGeometry(1, 1, 7), toon('#2e7d4f'), pines, 4);

    // Clouds around the tower (zones 1-5) and storm clouds (zone 8)
    for (const [zone, color, n] of [[1, '#ffffff', 10], [2, '#ffffff', 10], [3, '#f4fbff', 14], [4, '#ffffff', 10], [5, '#ffe7f3', 22], [6, '#ffd9c2', 10], [8, '#5d6878', 26]]) {
      const puffs = [];
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const r = Rr(24, 55);
        const y = (zone - 1) * ZONE_H + Rr(5, 75);
        for (let k = 0; k < 3; k++) puffs.push({ p: V(Math.cos(a) * r + k * 2.2, y + (k === 1 ? 0.8 : 0), Math.sin(a) * r), s: V(2.6, 1.8, 2.2) });
      }
      inst(this.sphereGeo, toon(color), puffs, zone);
    }
    // Zone 5: rainbows
    for (let i = 0; i < 2; i++) {
      const y = 4 * ZONE_H + 20 + i * 35;
      const a = rand() * Math.PI * 2;
      ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'].forEach((c, k) => {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(14 - k * 0.7, 0.35, 6, 40, Math.PI), new THREE.MeshBasicMaterial({ color: c }));
        arc.position.set(Math.cos(a) * 34, y, Math.sin(a) * 34);
        arc.lookAt(0, y, 0);
        this.zoneGroups[5].add(arc);
      });
    }
    // Zone 7: big background gears
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2;
      const gear = new THREE.Mesh(new THREE.TorusGeometry(6, 1.2, 6, 12), toon('#8a6a35'));
      gear.position.set(Math.cos(a) * 40, 6 * ZONE_H + 8 + i * 13, Math.sin(a) * 40);
      gear.lookAt(0, gear.position.y, 0);
      gear.userData.spin = (i % 2 ? 1 : -1) * 0.3;
      this.zoneGroups[7].add(gear);
      (this.spinners ||= []).push(gear);
    }
  }

  buildSky() {
    this.scene.fog = new THREE.Fog('#8fd3ff', 40, 180);
    this.scene.background = new THREE.Color('#8fd3ff');
    // stars
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 400;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    // planets for space
    this.planets = new THREE.Group();
    [['#ff9f6e', 30, 0.6, 140], ['#7ec8ff', 18, 2.4, 160], ['#c3a6ff', 12, 4.1, 120]].forEach(([c, r, a, d]) => {
      const pl = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: c, fog: false }));
      pl.scale.setScalar(r);
      pl.position.set(Math.cos(a) * d, 60 + r, Math.sin(a) * d);
      this.planets.add(pl);
    });
    const ringP = new THREE.Mesh(new THREE.TorusGeometry(44, 3, 4, 48), new THREE.MeshBasicMaterial({ color: '#ffd8a8', fog: false }));
    ringP.position.copy(this.planets.children[0].position);
    ringP.rotation.x = 1.2;
    this.planets.add(ringP);
    this.planets.visible = false;
    this.scene.add(this.planets);
    this.skyColor = new THREE.Color();
  }

  buildParticles() {
    const n = 320;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(n * 3);
    this.pCol = new Float32Array(n * 3);
    this.pVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pPos.set([(Math.random() - 0.5) * 40, Math.random() * 30 - 10, (Math.random() - 0.5) * 40], i * 3);
      this.pVel[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.28, map: circleTexture(), vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9 }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.pZone = 0;
  }

  makeArrow() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 4), toon('#ff7a59', { emissive: '#ff4d00', emissiveIntensity: 0.3 }));
    cone.rotation.x = Math.PI;
    g.add(cone);
    g.visible = false;
    this.root.add(g);
    return g;
  }

  // ---------------------------------------------------------------- temp clouds (Cloud Step item)
  addCloud(x, y, z, life, collide) {
    const p = { id: -100 - this.temp.length, kind: 'cloudstep', shape: 'box', x, z, cx: x, cz: z, sx: 2.4, sz: 2.4, hx: 1.2, hz: 1.2, top: y, ctop: y, h: 0.5, solid: collide, dx: 0, dy: 0, dz: 0, drot: 0, local: {}, life, zone: zoneAt(y) };
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Mesh(this.sphereGeo, toon('#ffffff'));
      s.scale.set(0.9, 0.45, 0.9);
      s.position.set(Math.cos(k * 1.3) * 0.7, -0.2, Math.sin(k * 1.3) * 0.7);
      g.add(s);
    }
    g.position.set(x, y, z);
    this.root.add(g);
    p.mesh = g;
    this.temp.push(p);
    if (collide) this.index(p);
    return p;
  }

  // ---------------------------------------------------------------- per physics step
  step(t, dt) {
    for (const p of this.dynamic) {
      const pcx = p.cx, pcz = p.cz, ptop = p.ctop, prot = p.rot;
      const m = platformMotion(p, t);
      if (m) {
        p.cx = p.x + m.dx;
        p.cz = p.z + m.dz;
        p.ctop = p.top + m.dy;
        p.rot = m.rot;
        p.solid = m.solid;
        p.fadePhase = m.phase;
      }
      if (p.kind === 'sink') {
        const st = p.local;
        st.off = st.off || 0;
        st.off = st.stood ? Math.min(3, st.off + 0.6 * dt) : Math.max(0, st.off - 1.0 * dt);
        st.stood = false;
        p.ctop = p.top - st.off;
      }
      if (p.kind === 'crumble') {
        const st = p.local;
        if (st.state === 'wobble') {
          st.timer -= dt;
          if (st.timer <= 0) { st.state = 'gone'; st.timer = 4; p.solid = false; }
        } else if (st.state === 'gone') {
          st.timer -= dt;
          if (st.timer <= 0) { st.state = null; p.solid = true; st.regrow = 0.4; }
        }
      }
      p.dx = p.cx - pcx;
      p.dz = p.cz - pcz;
      p.dy = p.ctop - ptop;
      p.drot = p.rot - prot;
    }
    for (const p of this.temp) {
      p.life -= dt;
      if (p.life <= 0 && !p.dead) {
        p.dead = true;
        p.solid = false;
        if (p.mesh) p.mesh.removeFromParent();
        this.unindex(p);
      }
    }
    if (this.temp.some((p) => p.dead)) this.temp = this.temp.filter((p) => !p.dead);
  }

  standOn(p) {
    if (p.kind === 'sink') p.local.stood = true;
    if (p.kind === 'crumble' && !p.local.state) { p.local.state = 'wobble'; p.local.timer = 1; }
  }

  // ---------------------------------------------------------------- per frame visuals
  update(t, dt, camPos, focusY) {
    const cz = zoneAt(Math.max(0, focusY));
    for (let z = 1; z <= 10; z++) this.zoneGroups[z].visible = Math.abs(z - cz) <= 1;

    for (const b of this.boostAnims || []) {
      if (!b.g.parent?.visible) continue;
      b.chev.forEach((c, i) => {
        const k = (t * 1.1 + i * 0.5) % 1;
        c.position.y = 0.25 + k * 0.9;
        c.material.opacity = 0.9 * (1 - k);
      });
      b.icon.position.y = 1.7 + Math.sin(t * 3 + b.p.id) * 0.12;
      b.ring.scale.setScalar(1 + Math.sin(t * 5 + b.p.id) * 0.05);
    }
    for (const p of this.dynamic) {
      const g = p.mesh;
      g.position.set(p.cx, p.ctop, p.cz);
      g.rotation.y = -p.rot;
      if (p.kind === 'fade') {
        const ph = p.fadePhase ?? 0;
        let o = 1;
        if (ph >= 2.0 && ph < 2.6) o = Math.sin(ph * 30) > 0 ? 1 : 0.35; // blinking warning
        else if (ph >= 2.6 && ph < 3.6) o = 0.08;
        else if (ph >= 3.6) o = (ph - 3.6) / 0.4;
        for (const m of p.mats) m.opacity = o;
      }
      if (p.kind === 'crumble') {
        const st = p.local;
        if (st.state === 'wobble') {
          g.position.x += (Math.random() - 0.5) * 0.12;
          g.position.z += (Math.random() - 0.5) * 0.12;
          for (const m of p.mats) m.opacity = 1;
        } else if (st.state === 'gone') {
          const k = 1 - st.timer / 4;
          g.position.y -= Math.min(6, k * 30);
          for (const m of p.mats) m.opacity = Math.max(0, 1 - k * 4);
        } else {
          if (st.regrow > 0) { st.regrow -= dt; g.scale.setScalar(1 - st.regrow); } else g.scale.setScalar(1);
          for (const m of p.mats) m.opacity = 1;
        }
      }
      if (p.tex) p.tex.offset.y = -t * 0.8;
    }
    for (const f of this.feats) if (f.tex) f.tex.offset.y = t * 1.2;
    for (const s of this.spinners || []) s.rotation.z += s.userData.spin * dt;
    for (const v of this.gateViz) {
      v.owl.position.y = v.pad.top + Math.abs(Math.sin(t * 2 + v.pad.id)) * 0.08;
      v.label.position.y = v.pad.top + 3.6 + Math.sin(t * 2.5) * 0.15;
    }
    for (const m of this.merchants) m.group.userData.model?.update(dt, 0, {});
    for (const p of this.temp) {
      if (p.mesh && p.life < 1.2) p.mesh.visible = Math.sin(p.life * 25) > -0.3;
    }
    if (this.flagCloth) this.flagCloth.rotation.y = Math.sin(t * 3) * 0.2;

    // sky colour by height
    const zf = Math.max(0, camPos.y) / ZONE_H - 0.5;
    const i0 = Math.max(0, Math.min(9, Math.floor(zf)));
    const i1 = Math.min(9, i0 + 1);
    const k = Math.max(0, Math.min(1, zf - i0));
    this.skyColor.set(ZONES[i0].sky).lerp(new THREE.Color(ZONES[i1].sky), k);
    this.scene.background.copy(this.skyColor);
    this.scene.fog.color.copy(this.skyColor);
    const far = this.quality === 'low' ? 90 : 170;
    this.scene.fog.far = far;
    this.scene.fog.near = far * 0.3;
    const night = Math.max(0, Math.min(1, (camPos.y - 7.5 * ZONE_H) / (1.5 * ZONE_H)));
    this.stars.material.opacity = night;
    this.stars.position.copy(camPos);
    this.planets.visible = camPos.y > 8 * ZONE_H;
    if (this.planets.visible) this.planets.position.set(camPos.x * 0.9, camPos.y - 40, camPos.z * 0.9);
    this.updateParticles(dt, camPos, cz);
  }

  updateParticles(dt, camPos, zone) {
    const Z = ZONES[zone - 1];
    const n = this.quality === 'low' ? 120 : 320;
    this.particles.geometry.setDrawRange(0, n);
    if (this.pZone !== zone) {
      this.pZone = zone;
      const base = new THREE.Color(Z.pcolor);
      const c = new THREE.Color();
      for (let i = 0; i < this.pVel.length; i++) {
        if (Z.particle === 'confetti' || Z.particle === 'sparkles') c.setHSL(Math.random(), 0.9, 0.65);
        else c.copy(base);
        this.pCol.set([c.r, c.g, c.b], i * 3);
      }
      this.particles.geometry.attributes.color.needsUpdate = true;
      this.particles.material.size = { rain: 0.12, mist: 0.9, stars: 0.18, snow: 0.3, lanterns: 0.45, steam: 0.7 }[Z.particle] || 0.28;
      this.particles.material.opacity = Z.particle === 'mist' || Z.particle === 'steam' ? 0.35 : 0.9;
    }
    const kind = Z.particle;
    const fall = { petals: 0.8, leaves: 1.2, mist: -0.2, snow: 1.4, sparkles: -0.4, confetti: 1.5, steam: -1.2, rain: 14, lanterns: -0.6, stars: 0 }[kind] ?? 1;
    const p = this.pPos;
    const tt = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      const v = this.pVel[i];
      let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      y -= fall * (0.6 + v) * dt;
      x += Math.sin(tt * (0.5 + v) + i) * dt * (kind === 'rain' ? 0 : 0.5);
      // wrap around the camera
      const rx = x - camPos.x, ry = y - camPos.y, rz = z - camPos.z;
      if (rx > 20) x -= 40; else if (rx < -20) x += 40;
      if (rz > 20) z -= 40; else if (rz < -20) z += 40;
      if (ry < -12) y += 30; else if (ry > 18) y -= 30;
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- queries
  footprint(p, x, z, rad) {
    if (p.shape === 'cyl') return Math.hypot(x - p.cx, z - p.cz) < p.r + rad;
    return Math.abs(x - p.cx) < p.hx + rad && Math.abs(z - p.cz) < p.hz + rad;
  }

  // Highest solid surface at or below y under point (x,z)
  groundBelow(x, y, z) {
    let best = null;
    for (let yy = y; yy > y - 60; yy -= 8) {
      for (const p of this.query(yy)) {
        if (!this.isSolid(p) || p.kind === 'spire') continue;
        if (p.ctop > y + 0.05) continue;
        if (!this.footprint(p, x, z, 0)) continue;
        if (!best || p.ctop > best.ctop) best = p;
      }
      if (best) return best;
    }
    return null;
  }

  // Ballistic prediction for the landing ring
  predictLanding(pos, vel, g, maxT = 3) {
    let x = pos.x, y = pos.y, z = pos.z, vx = vel.x, vy = vel.y, vz = vel.z;
    const dt = 1 / 30;
    for (let t = 0; t < maxT; t += dt) {
      const ny = y + vy * dt;
      vy -= g * dt;
      const nx = x + vx * dt;
      const nz = z + vz * dt;
      if (vy < 0) {
        for (const p of this.query(ny)) {
          if (!this.isSolid(p) || p.kind === 'spire') continue;
          if (y >= p.ctop - 0.05 && ny <= p.ctop && this.footprint(p, nx, nz, 0.1)) return { x: nx, y: p.ctop, z: nz };
        }
      }
      x = nx; y = ny; z = nz;
    }
    return null;
  }

  // Camera collision: march along the ray, return the safe fraction (0..1)
  rayFraction(from, to) {
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      const z = from.z + (to.z - from.z) * k;
      for (const p of this.query(y)) {
        if (!this.isSolid(p)) continue;
        if (p.kind === 'ceiling') continue;
        if (y > p.ctop + 0.2 || y < p.ctop - p.h - 0.2) continue;
        if (this.footprint(p, x, z, 0.2)) return Math.max(0.15, (i - 1.5) / steps);
      }
    }
    return 1;
  }
}
