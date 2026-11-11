// Deterministic tower generator, shared by the server (gate checks) and every client (rendering + physics).
// Same seed + same settings => the same tower for everyone in a room.

export const BLOCKS = 800;
export const ZONE_H = 80;
export const TOWER_R = 16;     // route platforms stay inside this radius
export const DECK_R = 18.5;    // checkpoint decks and gate ceilings cover the whole tower
export const OFF_R = 18.8;     // beyond this the player has jumped off the tower
export const GROUND_R = 32;    // ground meadow; players are kept inside the hedge at r = 29.5
export const SPIRE_R = 3;
export const PLAT_H = 1;
export const PAD_DROP = 5;     // gate pad top sits this far under the gate height
export const PAD_SIZE = 6;
export const CEIL_TOP = 0.8;   // gate ceiling top = G - 0.8
export const CEIL_H = 0.5;

export const PHYS = { g: 28, run: 6, jump1: 2.2, jump2: 1.8, height: 1.0, radius: 0.35 };

export const ZONES = [
  { id: 1, name: 'Blossom Meadow', min: 6, max: 8, step: 2, gap: 2, sky: '#8fd3ff', top: '#9be86b', side: '#b97a45', spire: '#b4835a', particle: 'petals', pcolor: '#ffb7d9' },
  { id: 2, name: 'Treetop Village', min: 6, max: 8, step: 2, gap: 2.5, sky: '#a4dbf7', top: '#93c94c', side: '#9a6a3a', spire: '#7a5230', particle: 'leaves', pcolor: '#8bc34a' },
  { id: 3, name: 'Waterfall Cliffs', min: 5, max: 6, step: 3, gap: 3, sky: '#c4e8f2', top: '#6fb56a', side: '#8a96a3', spire: '#76838f', particle: 'mist', pcolor: '#ffffff' },
  { id: 4, name: 'Frosty Peak', min: 5, max: 6, step: 3, gap: 3, sky: '#e4f1fa', top: '#ffffff', side: '#b9d4ea', spire: '#a9bfd6', particle: 'snow', pcolor: '#ffffff' },
  { id: 5, name: 'Cloud Kingdom', min: 4, max: 6, step: 3, gap: 3, sky: '#ffcf8a', top: '#ffffff', side: '#ffe3f1', spire: '#ffc4de', particle: 'sparkles', pcolor: '#fff59d' },
  { id: 6, name: 'Balloon Festival', min: 4, max: 5, step: 3.5, gap: 3.5, sky: '#ff9f6e', top: '#ffd166', side: '#c97c3d', spire: '#ef8f8f', particle: 'confetti', pcolor: '#ff6b9d' },
  { id: 7, name: 'Clockwork Fortress', min: 4, max: 5, step: 3.5, gap: 3.5, sky: '#7d6bb0', top: '#d4af37', side: '#8a6a35', spire: '#6e5530', particle: 'steam', pcolor: '#e6e6e6' },
  { id: 8, name: 'Thunderstorm Heights', min: 3, max: 5, step: 3.5, gap: 4, sky: '#4b5567', top: '#8a9bb0', side: '#5a6577', spire: '#3c4656', particle: 'rain', pcolor: '#a8c8ff' },
  { id: 9, name: 'Sky Pirate Armada', min: 3, max: 5, step: 3.5, gap: 4, sky: '#1c2747', top: '#b07a45', side: '#6b4523', spire: '#4a3426', particle: 'lanterns', pcolor: '#ffb84d' },
  { id: 10, name: 'Outer Space', min: 3, max: 4, step: 6, gap: 6, sky: '#070816', top: '#c9c9dc', side: '#8d8da8', spire: '#5e5e7e', particle: 'stars', pcolor: '#ffffff' },
];

// Platform kinds per zone with their chance of appearing on the main route.
const KIND_TABLE = {
  1: [['bounce', 0.15]],
  2: [['leaf', 0.22]],
  3: [['crumble', 0.28]],
  4: [['ice', 0.4], ['slide', 0.15]],
  5: [['bouncy', 0.2], ['fade', 0.2]],
  6: [['drift', 0.25], ['sink', 0.2]],
  7: [['gear', 0.2], ['conveyor', 0.15], ['piston', 0.15]],
  8: [],
  9: [['airship', 0.25], ['barrel', 0.15], ['boom', 0.12]],
  10: [['jelly', 0.12]],
};

export function zoneAt(y) {
  return Math.min(10, Math.max(1, Math.floor(y / ZONE_H) + 1));
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless hash -> [0,1). Used for time-slot based hazard schedules so every client agrees.
export function hash01(...nums) {
  let h = 2166136261;
  for (const x of nums) {
    h ^= (x | 0);
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function edgeGap(a, b) {
  const gx = Math.abs(a.x - b.x) - (a.hx + b.hx);
  const gz = Math.abs(a.z - b.z) - (a.hz + b.hz);
  if (gx > 0 && gz > 0) return Math.hypot(gx, gz);
  return Math.max(gx, gz);
}

export function finishYFor(finishZone) {
  return Math.min(10, Math.max(1, finishZone | 0)) * ZONE_H;
}

/**
 * Build the tower.
 * @returns {{plats:any[], gates:any[], checkpoints:any[], feats:any[], finishY:number, gateSpacing:number}}
 */
export function buildTower(seed, { gateSpacing = 40, finishY = 800 } = {}) {
  const rand = mulberry32(seed >>> 0);
  const R = (a, b) => a + (b - a) * rand();
  const snap = (v) => Math.round(v * 2) / 2;
  const plats = [];
  const gates = [];
  const checkpoints = [];
  const feats = [];
  const add = (p) => { p.id = plats.length; plats.push(p); return p; };
  const box = (x, z, s, top, extra) => ({ shape: 'box', x, z, sx: s, sz: s, hx: s / 2, hz: s / 2, top, h: PLAT_H, ph: rand() * Math.PI * 2, dir: rand() < 0.5 ? -1 : 1, ...extra });

  // Ground deck (zone 1 checkpoint)
  const ground = add({ kind: 'deck', shape: 'cyl', x: 0, z: 0, r: GROUND_R, hx: GROUND_R, hz: GROUND_R, top: 0, h: 4, zone: 1, cp: 1, noSide: true });
  let ang = 0;
  const spawn0 = { x: Math.cos(ang) * 10, z: Math.sin(ang) * 10 };
  checkpoints.push({ zone: 1, y: 0, plat: ground.id, spawn: spawn0, merchant: polar(13, ang - 0.9) });
  feats.push(
    { type: 'sign', icon: 'move', ...polar(12.5, ang + 0.25), y: 0 },
    { type: 'sign', icon: 'camera', ...polar(12.5, ang - 0.25), y: 0 },
    { type: 'sign', icon: 'jump', ...polar(7.2, ang + 0.15), y: 0 },
  );

  let prev = { x: spawn0.x, z: spawn0.z, hx: 0.6, hz: 0.6 };
  let floorTop = 0;
  const gateYs = [];
  for (let g = gateSpacing; g <= finishY; g += gateSpacing) gateYs.push(g);

  for (let gi = 0; gi < gateYs.length; gi++) {
    const G = gateYs[gi];
    const zone = zoneAt(G - 1);
    const Z = ZONES[zone - 1];
    const padTop = G - PAD_DROP;
    const maxStep = Z.step * (zone === 1 ? 0.9 : 0.85);
    const route = [];
    let y = floorTop;
    const H = padTop - floorTop;
    const n = Math.max(1, Math.ceil(H / maxStep));

    for (let i = 0; i < n; i++) {
      const k = n - i;
      const rem = padTop - y;
      const last = i === n - 1;
      let dy;
      if (last) dy = rem;
      else {
        dy = rem / k + (rand() - 0.5) * 0.6;
        dy = Math.min(maxStep, Math.max(0.8, dy, rem - maxStep * (k - 1)));
      }
      y += dy;
      let kind = 'normal';
      if (last) kind = 'pad';
      else if (i > 0) kind = pickKind(KIND_TABLE[zone], rand());
      let size = last ? PAD_SIZE : snap(R(Z.min, Z.max));
      if (kind === 'barrel') size = Math.max(size, 5);
      if (kind === 'boom') size = Math.max(size, 4.5);
      const half = size / 2;
      const rmin = SPIRE_R + 0.8 + half * 1.42;
      const r = rmin + R(0, 1.2);
      const target = R(0.7, Z.gap * 0.85);
      let da = 0.08;
      let cand;
      for (let it = 0; it < 800; it++) {
        cand = { x: Math.cos(ang + da) * r, z: Math.sin(ang + da) * r, hx: half, hz: half };
        if (edgeGap(prev, cand) >= target) break;
        da += 0.01;
      }
      ang += da;
      const p = add(box(cand.x, cand.z, size, y, { kind, zone, seg: gi, ang, route: 'main' }));
      if (kind === 'gear') { p.shape = 'cyl'; p.r = half; }
      if (last) p.gate = gi;
      route.push(p);
      prev = p;
    }

    // Shortcut spur: steeper, smaller jumps around the outside that rejoin the route a loop higher.
    if (zone >= 3 && rand() < 0.85) trySpur(route, zone, padTop);

    const pad = route[route.length - 1];
    const gate = {
      i: gi, y: G, ceilTop: G - CEIL_TOP, ceilBot: G - CEIL_TOP - CEIL_H, pad: pad.id, zone,
      boundary: G % ZONE_H === 0 && G < finishY, final: G === finishY,
    };
    add({ kind: 'ceiling', shape: 'cyl', x: 0, z: 0, r: DECK_R, hx: DECK_R, hz: DECK_R, top: gate.ceilTop, h: CEIL_H, zone, gate: gi, noSide: true });

    // Landing above the gate
    if (gate.final) {
      const s = add({ kind: 'summit', shape: 'cyl', x: 0, z: 0, r: 7, hx: 7, hz: 7, top: G, h: 2, zone, noSide: true });
      const land = polar(4.2, ang + 0.2);
      gate.landing = { ...land, y: G, plat: s.id };
      prev = { ...land, hx: 0.6, hz: 0.6 };
    } else if (gate.boundary) {
      const nz = zone + 1;
      const d = add({ kind: 'deck', shape: 'cyl', x: 0, z: 0, r: DECK_R, hx: DECK_R, hz: DECK_R, top: G, h: PLAT_H, zone: nz, cp: nz, noSide: true });
      ang += 0.35;
      const land = polar(9, ang);
      gate.landing = { ...land, y: G, plat: d.id };
      checkpoints.push({ zone: nz, y: G, plat: d.id, spawn: land, merchant: polar(13, ang - 0.9) });
      prev = { ...land, hx: 0.6, hz: 0.6 };
    } else {
      const half = PAD_SIZE / 2;
      const r = SPIRE_R + 0.8 + half * 1.42 + R(0, 1);
      let da = 0.08;
      let cand;
      for (let it = 0; it < 800; it++) {
        cand = { x: Math.cos(ang + da) * r, z: Math.sin(ang + da) * r, hx: half, hz: half };
        if (edgeGap(pad, cand) >= 1.0) break;
        da += 0.01;
      }
      ang += da;
      const l = add(box(cand.x, cand.z, PAD_SIZE, G, { kind: 'landing', zone: zoneAt(G), seg: gi + 1, ang, route: 'main' }));
      gate.landing = { x: l.x, z: l.z, y: G, plat: l.id };
      prev = l;
    }
    gates.push(gate);
    floorTop = G;

    // Zone features for this segment
    const mid = route.slice(1, -1);
    if (zone === 1 && gi === 0) {
      feats.push({ type: 'sign', icon: 'double', x: route[2].x, z: route[2].z, y: route[2].top, onPlat: true });
      feats.push({ type: 'sign', icon: 'gate', x: pad.x, z: pad.z, y: pad.top, onPlat: true });
    }
    if (zone === 3) {
      for (let w = 0; w < 2; w++) feats.push({ type: 'waterfall', ang: R(0, Math.PI * 2), y0: floorTop - gateSpacing, y1: padTop + 2 });
    }
    if (zone === 8) {
      mid.forEach((p, i) => { if (i % 4 === 2) feats.push({ type: 'puff', plat: p.id, ang: Math.atan2(p.z, p.x), y: p.top + 0.7, ph: rand() * 10 }); });
    }
    if (zone === 9) {
      mid.forEach((p, i) => {
        if (i % 3 === 1) {
          const pa = Math.atan2(p.z, p.x) + 0.35;
          const perch = { x: Math.cos(pa) * (SPIRE_R + 0.6), z: Math.sin(pa) * (SPIRE_R + 0.6), y: p.top + 3 };
          const targets = plats.filter((q) => q.zone === 9 && q.shape === 'box' && Math.abs(q.top - perch.y) < 6 && Math.hypot(q.x - perch.x, q.z - perch.z) < 8).map((q) => q.id);
          if (targets.length) feats.push({ type: 'parrot', perch, targets, ph: rand() * 10 });
        }
      });
    }
    if (zone === 10) {
      for (let a = 0; a < 3; a++) feats.push({ type: 'asteroid', y: R(floorTop - gateSpacing + 3, padTop), r: R(12.5, 15.5), ang0: R(0, Math.PI * 2), speed: (rand() < 0.5 ? -1 : 1) * R(0.12, 0.25), size: R(0.7, 1.1) });
    }
  }

  // Oxygen domes in space roughly every 15 blocks
  for (let ty = ZONE_H * 9 + 15; ty < finishY - 3; ty += 15) {
    let best = null;
    for (const p of plats) {
      if (p.zone !== 10 || p.shape !== 'box' || p.kind === 'pad' || p.kind === 'landing' || p.route !== 'main') continue;
      if (!best || Math.abs(p.top - ty) < Math.abs(best.top - ty)) best = p;
    }
    if (best) best.kind = 'dome';
  }

  return { seed, gateSpacing, finishY, plats, gates, checkpoints, feats };

  // ---- helpers that need closure state ----
  function trySpur(route, zone, padTop) {
    const Z = ZONES[zone - 1];
    if (route.length < 8) return;
    const k = Math.floor(R(0, route.length - 8));
    const start = route[k];
    const dyS = Math.min(Z.step + 1.0, zone === 10 ? 8 : 3.6) * 0.9;
    const gapS = Math.min(Z.gap * 0.85 + 0.4, zone === 10 ? 6 : 3.4);
    const rS = TOWER_R - 0.6 - 1.5 * 1.42;
    let prevS = start;
    let a = Math.atan2(start.z, start.x);
    let y = start.top;
    const spur = [];
    for (let m = 0; m < 14; m++) {
      y += dyS;
      if (y > padTop - 1) return;
      const target = gapS * R(0.6, 0.95);
      let da = 0.05;
      let cand;
      for (let it = 0; it < 600; it++) {
        cand = { x: Math.cos(a + da) * rS, z: Math.sin(a + da) * rS, hx: 1.5, hz: 1.5, top: y };
        if (edgeGap(prevS, cand) >= target) break;
        da += 0.01;
      }
      a += da;
      // Rejoin?
      let join = null;
      for (let j = k + 3; j < route.length; j++) {
        const q = route[j];
        const dyq = q.top - y;
        const g = edgeGap(cand, q);
        if (dyq >= -1.5 && dyq <= dyS && g <= gapS && g >= 0.25) { join = q; break; }
      }
      for (const q of plats) {
        if (q === prevS || q === join || q.noSide) continue;
        if (Math.abs(q.top - y) < 2.8 && edgeGap(cand, q) < 0.4) return;
      }
      for (const q of spur) if (q !== prevS && Math.abs(q.top - y) < 2.8 && edgeGap(cand, q) < 0.4) return;
      spur.push(cand);
      prevS = cand;
      if (join && m >= 1) {
        for (const c of spur) add(box(c.x, c.z, 3, c.top, { kind: 'normal', zone, seg: start.seg, route: 'short', ang: Math.atan2(c.z, c.x) }));
        return;
      }
    }
  }
}

function pickKind(table, r) {
  for (const [k, p] of table) {
    if (r < p) return k;
    r -= p;
  }
  return 'normal';
}

function polar(r, a) {
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// --- Deterministic platform motion, shared by physics and rendering ---
// Returns current offset {dx, dy, dz, rot, solid} for a platform at game time t (seconds).
export function platformMotion(p, t) {
  switch (p.kind) {
    case 'leaf': return { dx: 0, dy: 0.9 * Math.sin((t / 6) * Math.PI * 2 + p.ph), dz: 0, rot: 0, solid: true };
    case 'slide': {
      const o = 1.5 * Math.sin((t / 5) * Math.PI * 2 + p.ph);
      const a = Math.atan2(p.z, p.x);
      return { dx: -Math.sin(a) * o, dy: 0, dz: Math.cos(a) * o, rot: 0, solid: true };
    }
    case 'drift': {
      const w = (t / 8) * Math.PI * 2 * p.dir + p.ph;
      return { dx: Math.cos(w) * 1.1, dy: 0, dz: Math.sin(w) * 1.1, rot: 0, solid: true };
    }
    case 'airship': {
      const o = 1.8 * Math.sin((t / 7) * Math.PI * 2 + p.ph);
      const a = Math.atan2(p.z, p.x);
      return { dx: -Math.sin(a) * o, dy: 0.25 * Math.sin(t * 1.3 + p.ph), dz: Math.cos(a) * o, rot: 0, solid: true };
    }
    case 'piston': {
      // 4 s cycle: up, drop, down, rise
      const c = ((t + p.ph) % 4 + 4) % 4;
      let o;
      if (c < 1.6) o = 0; else if (c < 2) o = -(c - 1.6) / 0.4; else if (c < 3.6) o = -1; else o = -1 + (c - 3.6) / 0.4;
      return { dx: 0, dy: o * 1.5, dz: 0, rot: 0, solid: true };
    }
    case 'gear': return { dx: 0, dy: 0, dz: 0, rot: t * 0.6 * p.dir, solid: true };
    case 'fade': {
      const c = ((t + p.ph) % 4 + 4) % 4; // gone between 2.6 and 3.6
      return { dx: 0, dy: 0, dz: 0, rot: 0, solid: !(c >= 2.6 && c < 3.6), phase: c };
    }
    default: return null;
  }
}
