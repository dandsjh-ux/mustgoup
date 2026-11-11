// Reachability check: every step on the main route must fit that zone's jump limits.
// Run: npm run check
import { buildTower, ZONES, edgeGap } from '../public/js/shared/tower.js';

let failures = 0;
for (const spacing of [15, 30, 60]) {
  for (let s = 1; s <= 30; s++) {
    const seed = s * 7919;
    const t = buildTower(seed, { gateSpacing: spacing, finishY: 600 });
    const main = t.plats.filter((p) => p.route === 'main');
    const bySeg = new Map();
    for (const p of main) {
      if (!bySeg.has(p.seg)) bySeg.set(p.seg, []);
      bySeg.get(p.seg).push(p);
    }
    for (const [seg, list] of bySeg) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const Z = ZONES[b.zone - 1];
        const dy = b.top - a.top;
        const gap = edgeGap(a, b);
        if (dy > Z.step + 1e-6 || gap > Z.gap + 1e-6 || gap < 0.2) {
          failures++;
          if (failures < 15) console.log(`seed ${seed} spacing ${spacing} seg ${seg} step ${i}: dy=${dy.toFixed(2)} gap=${gap.toFixed(2)} zone ${b.zone} (${a.kind}->${b.kind})`);
        }
      }
    }
    // overlaps between any two box platforms with too little headroom
    const boxes = t.plats.filter((p) => !p.noSide);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const travel = (q) => (q.kind === 'lift' ? 0 : q.amp || 0);
      if (Math.abs(a.top - b.top) < 2.2 && edgeGap(a, b) < 0.1 + travel(a) + travel(b)) {
        failures++;
        if (failures < 15) console.log(`seed ${seed} overlap ${a.id}(${a.kind},${a.route}) ${b.id}(${b.kind},${b.route}) dy=${(b.top - a.top).toFixed(2)}`);
      }
    }
    if (s === 1) console.log(`spacing ${spacing}: sizes ${JSON.stringify(t.plats.filter((p) => p.route === 'main' && p.kind !== 'pad').reduce((m, p) => ((m[p.sx] = (m[p.sx] || 0) + 1), m), {}))}, movers ${t.plats.filter((p) => ['mover', 'lift'].includes(p.kind)).length}, birds ${t.feats.filter((f) => f.type === 'bird').length}, spouts ${t.feats.filter((f) => f.type === 'spout').length}, ${t.plats.length} platforms, ${t.gates.length} gates, ${t.checkpoints.length} checkpoints, shortcuts ${t.plats.filter((p) => p.route === 'short').length}, feats ${t.feats.length}`);
  }
}
console.log(failures ? `FAILED: ${failures} problems` : 'All towers OK');
process.exit(failures ? 1 : 0);
