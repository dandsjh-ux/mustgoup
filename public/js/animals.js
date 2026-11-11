// Low-poly animals built from three.js primitives with toon shading. No model files.
import * as THREE from 'three';
import { TINT_COLORS } from './shared/items.js';

// Animation codes shared over the network
export const ANIM = { idle: 0, run: 1, jump: 2, flip: 3, fall: 4, land: 5, celebrate: 6, glide: 7, jet: 8, bubble: 9, stun: 10 };

let gradient = null;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 180, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}
const matCache = new Map();
export function toon(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra }));
  return matCache.get(key);
}

const G = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone8: new THREE.ConeGeometry(1, 1, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  capsule: new THREE.CapsuleGeometry(1, 1.6, 4, 10),
  torus: new THREE.TorusGeometry(1, 0.28, 8, 20),
  box: new THREE.BoxGeometry(1, 1, 1),
};

const DEFS = {
  bunny: { fur: '#f3eee9', belly: '#ffffff', ear: 'long', earIn: '#ffb3c7', snout: 'nose', tail: 'puff' },
  fox: { fur: '#f28a3a', belly: '#fff4e6', ear: 'pointy', earTip: '#3b2a20', snout: 'muzzle', tail: 'bushy', tailTip: '#ffffff', limbs: '#3b2a20' },
  panda: { fur: '#ffffff', belly: '#ffffff', ear: 'round', earColor: '#2b2b2b', limbs: '#2b2b2b', snout: 'muzzle', tail: 'nub', eyePatch: '#2b2b2b', dark: true },
  penguin: { fur: '#2f3640', belly: '#ffffff', ear: 'none', snout: 'beakSmall', beak: '#ffab2e', tail: 'none', flippers: true, feet: '#ffab2e', dark: true },
  kitten: { fur: '#f7b267', belly: '#fff3e0', ear: 'pointySmall', earIn: '#ffb3c7', snout: 'nose', tail: 'long', whiskers: true },
  frog: { fur: '#79c95a', belly: '#e7f7c7', ear: 'none', snout: 'smile', tail: 'none', frogEyes: true },
  duckling: { fur: '#ffe14d', belly: '#fff3a0', ear: 'none', snout: 'beak', beak: '#ff9f1c', tail: 'nub', feet: '#ff9f1c', flippers: true },
  redpanda: { fur: '#c8553d', belly: '#3b2a20', ear: 'pointy', earTip: '#ffffff', snout: 'muzzle', tail: 'striped', limbs: '#3b2a20', cheeks: '#ffffff' },
  hedgehog: { fur: '#8d6e63', belly: '#f5deb3', ear: 'tiny', snout: 'pointy', tail: 'none', spikes: '#5d4037' },
  koala: { fur: '#9ea3a8', belly: '#e8e8e8', ear: 'fluffy', earIn: '#ffffff', snout: 'bigNose', tail: 'none' },
  puppy: { fur: '#d9a066', belly: '#fff3e0', ear: 'floppy', earColor: '#8d5a2b', snout: 'muzzle', tail: 'wag' },
  tiger: { fur: '#ff9933', belly: '#fff4e6', ear: 'roundSmall', snout: 'muzzle', tail: 'longStriped', stripes: '#3b2a20' },
};

function tintFur(hex, tint, dark) {
  const c = new THREE.Color(hex);
  if (dark) return c; // black/white animals keep their colours, the scarf carries the tint
  const hsl = {};
  c.getHSL(hsl);
  switch (tint) {
    case 1: c.setHSL(hsl.h, hsl.s, Math.min(0.92, hsl.l + 0.12)); break;
    case 2: c.setHSL(hsl.h, hsl.s, Math.max(0.2, hsl.l - 0.15)); break;
    case 3: c.setHSL((hsl.h + 0.06) % 1, hsl.s, hsl.l); break;
    case 4: c.setHSL((hsl.h + 0.94) % 1, hsl.s, hsl.l); break;
    case 5: c.lerp(new THREE.Color('#ffffff'), 0.35); break;
    default: break;
  }
  return c;
}

function mesh(geo, color, sx, sy, sz, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? toon(color) : color);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

export class AnimalModel {
  constructor(profile, opts = {}) {
    this.profile = profile;
    const def = DEFS[profile.animal] || DEFS.bunny;
    const furC = '#' + tintFur(def.fur, profile.tint, def.dark).getHexString();
    const scarfC = TINT_COLORS[profile.tint] || TINT_COLORS[0];
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.45;
    this.root.add(this.pivot);
    const inner = (this.inner = new THREE.Group());
    inner.position.y = -0.45;
    this.pivot.add(inner);

    // body
    this.torso = mesh(G.sphere, furC, 0.3, 0.31, 0.28, 0, 0.36, 0, inner);
    mesh(G.sphere, def.belly, 0.21, 0.22, 0.12, 0, 0.34, 0.19, inner);
    // legs
    const limb = def.feet || def.limbs || furC;
    this.legL = new THREE.Group(); this.legL.position.set(-0.12, 0.19, 0); inner.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.12, 0.19, 0); inner.add(this.legR);
    mesh(G.capsule, limb, 0.075, 0.06, 0.075, 0, -0.1, 0, this.legL);
    mesh(G.capsule, limb, 0.075, 0.06, 0.075, 0, -0.1, 0, this.legR);
    // arms
    this.armL = new THREE.Group(); this.armL.position.set(-0.27, 0.44, 0); inner.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.27, 0.44, 0); inner.add(this.armR);
    if (def.flippers) {
      mesh(G.sphere, def.dark ? furC : furC, 0.05, 0.16, 0.1, 0, -0.12, 0, this.armL);
      mesh(G.sphere, def.dark ? furC : furC, 0.05, 0.16, 0.1, 0, -0.12, 0, this.armR);
    } else {
      mesh(G.capsule, def.limbs || furC, 0.06, 0.06, 0.06, 0, -0.1, 0, this.armL);
      mesh(G.capsule, def.limbs || furC, 0.06, 0.06, 0.06, 0, -0.1, 0, this.armR);
    }
    // scarf (tint colour)
    const scarf = mesh(G.torus, scarfC, 0.2, 0.2, 0.2, 0, 0.57, 0, inner);
    scarf.rotation.x = Math.PI / 2;
    const tail = mesh(G.sphere, scarfC, 0.05, 0.12, 0.04, 0.12, 0.48, 0.17, inner);
    tail.rotation.z = 0.4;

    // head
    const head = (this.head = new THREE.Group());
    head.position.set(0, 0.8, 0.02);
    inner.add(head);
    this.headMesh = mesh(G.sphere, furC, 0.29, 0.27, 0.27, 0, 0, 0, head);
    this.eyes = [];
    if (def.frogEyes) {
      for (const s of [-1, 1]) {
        mesh(G.sphere, furC, 0.1, 0.1, 0.1, s * 0.13, 0.2, 0.08, head);
        mesh(G.sphere, '#ffffff', 0.075, 0.075, 0.05, s * 0.13, 0.22, 0.15, head);
        this.eyes.push(mesh(G.sphere, '#1b1b1b', 0.04, 0.045, 0.03, s * 0.13, 0.22, 0.19, head));
      }
    } else {
      for (const s of [-1, 1]) {
        if (def.eyePatch) {
          const p = mesh(G.sphere, def.eyePatch, 0.075, 0.09, 0.04, s * 0.1, 0.03, 0.23, head);
          p.rotation.z = s * -0.5;
        }
        this.eyes.push(mesh(G.sphere, def.eyePatch ? '#ffffff' : '#1b1b1b', 0.042, 0.05, 0.03, s * 0.1, 0.04, 0.25, head));
        if (def.eyePatch) mesh(G.sphere, '#1b1b1b', 0.025, 0.03, 0.02, s * 0.1, 0.04, 0.27, head);
        mesh(G.sphere, '#ffffff', 0.014, 0.014, 0.01, s * 0.1 + 0.015, 0.06, 0.275, head);
      }
    }
    // cheeks
    for (const s of [-1, 1]) mesh(G.sphere, def.cheeks || '#ff9fb5', 0.05, 0.03, 0.02, s * 0.17, -0.06, 0.22, head);
    // snout
    switch (def.snout) {
      case 'nose': mesh(G.sphere, '#ff8fab', 0.035, 0.028, 0.03, 0, -0.03, 0.27, head); break;
      case 'muzzle':
        mesh(G.sphere, '#ffffff', 0.11, 0.08, 0.07, 0, -0.08, 0.22, head);
        mesh(G.sphere, '#2b2b2b', 0.04, 0.03, 0.03, 0, -0.04, 0.29, head);
        break;
      case 'beak': mesh(G.sphere, def.beak, 0.11, 0.035, 0.09, 0, -0.06, 0.26, head); break;
      case 'beakSmall': { const b = mesh(G.cone8, def.beak, 0.05, 0.1, 0.05, 0, -0.04, 0.29, head); b.rotation.x = Math.PI / 2; break; }
      case 'smile': { const m = mesh(G.torus, '#2b5a1e', 0.08, 0.08, 0.06, 0, -0.07, 0.24, head); m.rotation.z = Math.PI; m.scale.z = 0.02; break; }
      case 'pointy': { const n = mesh(G.cone8, def.belly, 0.08, 0.16, 0.08, 0, -0.05, 0.28, head); n.rotation.x = Math.PI / 2; mesh(G.sphere, '#2b2b2b', 0.03, 0.03, 0.03, 0, -0.05, 0.36, head); break; }
      case 'bigNose': mesh(G.sphere, '#3a3a3a', 0.07, 0.09, 0.05, 0, -0.04, 0.26, head); break;
      default: break;
    }
    if (def.whiskers) {
      for (const s of [-1, 1]) for (const k of [0, 1]) {
        const w = mesh(G.box, '#5a4a3a', 0.12, 0.006, 0.006, s * 0.2, -0.05 - k * 0.03, 0.22, head);
        w.rotation.z = s * (k ? -0.15 : 0.15);
      }
    }
    // ears
    this.ears = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      head.add(e);
      this.ears.push(e);
      switch (def.ear) {
        case 'long':
          e.position.set(s * 0.1, 0.22, 0);
          e.rotation.z = s * -0.15;
          mesh(G.capsule, furC, 0.055, 0.12, 0.04, 0, 0.17, 0, e);
          mesh(G.capsule, def.earIn, 0.03, 0.09, 0.02, 0, 0.17, 0.025, e);
          break;
        case 'pointy':
        case 'pointySmall': {
          const sc = def.ear === 'pointy' ? 1 : 0.75;
          e.position.set(s * 0.15, 0.2, 0);
          e.rotation.z = s * -0.35;
          mesh(G.cone4, furC, 0.09 * sc, 0.2 * sc, 0.05 * sc, 0, 0.08 * sc, 0, e).rotation.y = Math.PI / 4;
          if (def.earTip) mesh(G.cone4, def.earTip, 0.045 * sc, 0.08 * sc, 0.03 * sc, 0, 0.15 * sc, 0.005, e).rotation.y = Math.PI / 4;
          if (def.earIn) mesh(G.cone4, def.earIn, 0.05 * sc, 0.12 * sc, 0.02 * sc, 0, 0.06 * sc, 0.02, e).rotation.y = Math.PI / 4;
          break;
        }
        case 'round': e.position.set(s * 0.19, 0.19, -0.02); mesh(G.sphere, def.earColor, 0.09, 0.09, 0.05, 0, 0, 0, e); break;
        case 'roundSmall': e.position.set(s * 0.18, 0.2, -0.02); mesh(G.sphere, furC, 0.07, 0.07, 0.04, 0, 0, 0, e); mesh(G.sphere, '#3b2a20', 0.04, 0.04, 0.02, 0, 0, 0.025, e); break;
        case 'tiny': e.position.set(s * 0.17, 0.17, 0.05); mesh(G.sphere, furC, 0.05, 0.05, 0.03, 0, 0, 0, e); break;
        case 'fluffy': e.position.set(s * 0.24, 0.13, -0.02); mesh(G.sphere, furC, 0.13, 0.12, 0.05, 0, 0, 0, e); mesh(G.sphere, def.earIn, 0.08, 0.08, 0.03, 0, 0, 0.03, e); break;
        case 'floppy': e.position.set(s * 0.24, 0.08, 0); e.rotation.z = s * 0.25; mesh(G.sphere, def.earColor, 0.07, 0.17, 0.05, 0, -0.08, 0, e); break;
        default: break;
      }
    }
    if (def.stripes) {
      for (const k of [-1, 0, 1]) mesh(G.box, def.stripes, 0.03, 0.09, 0.02, k * 0.07, 0.2, 0.18, head).rotation.x = -0.6;
      for (const k of [0, 1]) { const st = mesh(G.torus, def.stripes, 0.29, 0.29, 0.29, 0, 0.3 + k * 0.12, -0.02, inner); st.rotation.x = Math.PI / 2; st.scale.z = 0.08; }
    }
    if (def.spikes) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI - Math.PI / 2;
        const sp = mesh(G.cone8, def.spikes, 0.05, 0.16, 0.05, Math.sin(a) * 0.2, 0.42 + Math.cos(a) * 0.12, -0.2, inner);
        sp.rotation.x = -1.1;
        sp.rotation.z = -Math.sin(a) * 0.6;
        const sp2 = mesh(G.cone8, def.spikes, 0.045, 0.14, 0.045, Math.sin(a) * 0.18, 0.12 + Math.cos(a) * 0.08, -0.18, head);
        sp2.rotation.x = -1.2;
        sp2.rotation.z = -Math.sin(a) * 0.6;
      }
    }
    // tail
    const tg = (this.tail = new THREE.Group());
    tg.position.set(0, 0.3, -0.26);
    inner.add(tg);
    switch (def.tail) {
      case 'puff': mesh(G.sphere, '#ffffff', 0.09, 0.09, 0.09, 0, 0, -0.03, tg); break;
      case 'bushy': { tg.rotation.x = -0.9; mesh(G.sphere, furC, 0.09, 0.2, 0.09, 0, 0.15, 0, tg); mesh(G.sphere, def.tailTip, 0.06, 0.08, 0.06, 0, 0.32, 0, tg); break; }
      case 'striped': { tg.rotation.x = -0.9; mesh(G.sphere, furC, 0.1, 0.22, 0.1, 0, 0.17, 0, tg); for (const k of [0.1, 0.22]) { const r = mesh(G.torus, '#5a2a1a', 0.085, 0.085, 0.085, 0, k, 0, tg); r.rotation.x = Math.PI / 2; } break; }
      case 'long': case 'longStriped': { tg.rotation.x = -0.6; mesh(G.capsule, furC, 0.035, 0.12, 0.035, 0, 0.18, 0, tg); if (def.stripes) mesh(G.sphere, def.stripes, 0.045, 0.05, 0.045, 0, 0.36, 0, tg); break; }
      case 'nub': mesh(G.sphere, furC, 0.06, 0.06, 0.05, 0, 0, 0, tg); break;
      case 'wag': tg.rotation.x = -0.5; mesh(G.capsule, furC, 0.035, 0.07, 0.035, 0, 0.1, 0, tg); break;
      default: break;
    }

    // hat
    this.addHat(profile.hat, scarfC);

    // jetpack (shown when owned), cape (glider), bubble
    this.jetpack = new THREE.Group();
    mesh(G.capsule, '#b0b8c8', 0.07, 0.07, 0.07, -0.08, 0.42, -0.3, this.jetpack);
    mesh(G.capsule, '#b0b8c8', 0.07, 0.07, 0.07, 0.08, 0.42, -0.3, this.jetpack);
    this.flames = new THREE.Group();
    for (const s of [-1, 1]) { const f = mesh(G.cone8, toon('#ffb703', { emissive: '#ff6a00' }), 0.06, 0.25, 0.06, s * 0.08, 0.15, -0.3, this.flames); f.rotation.x = Math.PI; }
    this.jetpack.add(this.flames);
    this.jetpack.visible = false;
    inner.add(this.jetpack);
    this.cape = mesh(G.box, scarfC, 0.5, 0.45, 0.02, 0, 0.35, -0.3, null);
    this.cape.visible = false;
    inner.add(this.cape);

    if (opts.outline) this.addOutline(opts.outline);

    this.anim = ANIM.idle;
    this.t = Math.random() * 10;
    this.flipT = -1;
    this.squashT = 0;
    this.emote = 0;
    this.emoteT = 0;
    this.blinkT = 2 + Math.random() * 3;
  }

  addHat(hat, color) {
    const h = new THREE.Group();
    h.position.set(0, 0.22, 0);
    this.head.add(h);
    switch (hat) {
      case 'party': mesh(G.cone8, color, 0.11, 0.28, 0.11, 0, 0.12, 0, h); mesh(G.sphere, '#ffffff', 0.04, 0.04, 0.04, 0, 0.27, 0, h); break;
      case 'crown': {
        mesh(G.cyl, '#ffc23d', 0.13, 0.08, 0.13, 0, 0.03, 0, h);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; mesh(G.cone4, '#ffc23d', 0.035, 0.08, 0.035, Math.cos(a) * 0.11, 0.1, Math.sin(a) * 0.11, h); }
        mesh(G.sphere, '#ff4d6d', 0.025, 0.025, 0.025, 0, 0.04, 0.13, h);
        break;
      }
      case 'flower': {
        const f = new THREE.Group(); f.position.set(0.14, 0.0, 0.08); h.add(f);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; mesh(G.sphere, '#ff8fc8', 0.045, 0.045, 0.02, Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0, f); }
        mesh(G.sphere, '#ffd23d', 0.03, 0.03, 0.025, 0, 0, 0.01, f);
        f.rotation.y = 0.5;
        break;
      }
      case 'beanie': mesh(G.sphere, color, 0.26, 0.16, 0.26, 0, -0.06, 0, h); mesh(G.sphere, '#ffffff', 0.06, 0.06, 0.06, 0, 0.1, 0, h); break;
      case 'tophat': mesh(G.cyl, '#2b2b2b', 0.2, 0.025, 0.2, 0, 0, 0, h); mesh(G.cyl, '#2b2b2b', 0.12, 0.2, 0.12, 0, 0.1, 0, h); mesh(G.cyl, color, 0.125, 0.04, 0.125, 0, 0.03, 0, h); break;
      default: break;
    }
  }

  addOutline(color) {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    this.outlines = [];
    for (const m of [this.torso, this.headMesh]) {
      const o = new THREE.Mesh(m.geometry, mat);
      o.scale.setScalar(1.12);
      m.add(o);
      this.outlines.push(o);
    }
  }

  setOutlineVisible(v) {
    if (this.outlines) for (const o of this.outlines) o.visible = v;
  }

  setAnim(a) {
    if (a === this.anim) return;
    if (a === ANIM.flip) this.flipT = 0;
    if (a === ANIM.land) this.squashT = 0.18;
    this.anim = a;
  }

  playEmote(n) {
    this.emote = n;
    this.emoteT = 2.2;
  }

  update(dt, speed = 0, opts = {}) {
    this.t += dt;
    const t = this.t;
    const a = this.anim;
    const legL = this.legL.rotation;
    const legR = this.legR.rotation;
    const armL = this.armL.rotation;
    const armR = this.armR.rotation;
    let bob = 0;
    legL.set(0, 0, 0); legR.set(0, 0, 0); armL.set(0, 0, 0.15); armR.set(0, 0, -0.15);
    this.pivot.rotation.set(0, 0, 0);

    if (a === ANIM.run) {
      const f = t * (8 + 6 * speed);
      const sw = 0.9 * Math.min(1, speed + 0.3);
      legL.x = Math.sin(f) * sw; legR.x = -Math.sin(f) * sw;
      armL.x = -Math.sin(f) * sw * 0.8; armR.x = Math.sin(f) * sw * 0.8;
      bob = Math.abs(Math.sin(f)) * 0.06;
    } else if (a === ANIM.jump || a === ANIM.flip) {
      legL.x = 0.5; legR.x = -0.3; armL.z = 1.2; armR.z = -1.2;
    } else if (a === ANIM.fall) {
      const f = t * 22;
      armL.z = 1.6 + Math.sin(f) * 0.6; armR.z = -1.6 - Math.sin(f + 1) * 0.6;
      legL.x = Math.sin(f) * 0.6; legR.x = -Math.sin(f) * 0.6;
    } else if (a === ANIM.glide) {
      armL.z = 1.5; armR.z = -1.5; legL.x = 0.3; legR.x = 0.3;
      this.pivot.rotation.x = 0.35;
    } else if (a === ANIM.jet) {
      armL.z = 0.6; armR.z = -0.6; legL.x = 0.2; legR.x = -0.2;
    } else if (a === ANIM.celebrate) {
      armL.z = 2.6 + Math.sin(t * 10) * 0.3; armR.z = -2.6 - Math.sin(t * 10) * 0.3;
      bob = Math.abs(Math.sin(t * 6)) * 0.25;
      this.pivot.rotation.y = Math.sin(t * 3) * 0.4;
    } else if (a === ANIM.stun) {
      this.pivot.rotation.z = Math.sin(t * 12) * 0.2;
    } else {
      bob = Math.sin(t * 2) * 0.012;
    }

    if (this.emoteT > 0 && (a === ANIM.idle || a === ANIM.bubble || a === ANIM.land)) {
      this.emoteT -= dt;
      switch (this.emote) {
        case 1: armR.z = -2.6 + Math.sin(t * 14) * 0.4; break;
        case 2: armL.z = 2.7; armR.z = -2.7; bob = Math.abs(Math.sin(t * 9)) * 0.2; break;
        case 3: this.pivot.rotation.z = Math.sin(t * 8) * 0.25; armL.z = 1.4 + Math.sin(t * 8) * 0.6; armR.z = -1.4 + Math.sin(t * 8) * 0.6; bob = Math.abs(Math.sin(t * 8)) * 0.08; break;
        case 4: armR.x = -1.5; armR.z = -0.3; break;
        default: break;
      }
    } else if (this.emoteT > 0) this.emoteT -= dt;

    if (this.flipT >= 0) {
      this.flipT += dt;
      const k = Math.min(1, this.flipT / 0.42);
      this.pivot.rotation.x = -k * Math.PI * 2;
      if (k >= 1) this.flipT = -1;
    }
    let sy = 1;
    if (this.squashT > 0) {
      this.squashT -= dt;
      sy = 1 - Math.sin((this.squashT / 0.18) * Math.PI) * 0.22;
    }
    this.inner.position.y = -0.45 + bob;
    this.pivot.scale.set(2 - sy, sy, 2 - sy);

    // blink
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blink ? 0.008 : 0.05;
    this.ears.forEach((e, i) => { e.rotation.x = Math.sin(t * 3 + i) * 0.06; });
    this.tail.rotation.y = Math.sin(t * (a === ANIM.run ? 12 : 3)) * 0.3;

    this.jetpack.visible = !!opts.jetpack;
    this.flames.visible = a === ANIM.jet;
    if (this.flames.visible) this.flames.scale.y = 0.8 + Math.random() * 0.5;
    this.cape.visible = !!opts.cape;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// ---------- name tags ----------
export function makeNameTag(text, color = '#ffffff', bg = 'rgba(29,27,58,0.7)') {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '800 44px Nunito, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w;
  c.height = 64;
  ctx.font = '800 44px Nunito, sans-serif';
  ctx.fillStyle = bg;
  const r = 30;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(0, 4, w, 56, r) : ctx.rect(0, 4, w, 56);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((w / 64) * 0.32, 0.32, 1);
  s.renderOrder = 10;
  return s;
}

const emojiTex = new Map();
export function emojiTexture(ch) {
  if (!emojiTex.has(ch)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '52px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 32, 36);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    emojiTex.set(ch, t);
  }
  return emojiTex.get(ch);
}

export function emojiSprite(ch, size = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(ch), transparent: true, depthTest: false }));
  s.scale.set(size, size, 1);
  s.renderOrder = 11;
  return s;
}

// ---------- cosmetic trails ----------
const TRAIL_CHARS = { sparkles: '✨', hearts: '💖', stars: '⭐' };
export class Trail {
  constructor(scene, type) {
    this.type = type;
    this.items = [];
    this.timer = 0;
    this.hue = 0;
    if (type === 'none') return;
    for (let i = 0; i < 18; i++) {
      let s;
      if (type === 'rainbow') s = new THREE.Mesh(G.sphere, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true }));
      else s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(TRAIL_CHARS[type] || '✨'), transparent: true, depthWrite: false }));
      s.visible = false;
      s.userData.life = 0;
      scene.add(s);
      this.items.push(s);
    }
  }

  update(dt, pos, moving) {
    if (!this.items.length) return;
    this.timer -= dt;
    if (moving && this.timer <= 0) {
      this.timer = 0.07;
      const s = this.items.find((x) => !x.visible);
      if (s) {
        s.visible = true;
        s.userData.life = 0.9;
        s.position.set(pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.3 + Math.random() * 0.3, pos.z + (Math.random() - 0.5) * 0.3);
        if (this.type === 'rainbow') {
          this.hue = (this.hue + 0.08) % 1;
          s.material.color.setHSL(this.hue, 0.9, 0.6);
        }
      }
    }
    for (const s of this.items) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { s.visible = false; continue; }
      const k = s.userData.life / 0.9;
      s.position.y += dt * 0.4;
      const sc = this.type === 'rainbow' ? 0.09 * k : 0.28 * k;
      s.scale.set(sc, sc, sc);
      s.material.opacity = k;
    }
  }

  dispose() {
    for (const s of this.items) s.removeFromParent();
    this.items = [];
  }
}
