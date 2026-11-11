// HUD: altimeter, zone label, tokens, item slots, meters, toasts, banners.
import { ZONES, ZONE_H, zoneAt } from './shared/tower.js';
import { ITEMS, MAX_SLOTS, ANIMALS, TINT_COLORS } from './shared/items.js';

const $ = (id) => document.getElementById(id);
export const animalEmoji = (id) => ANIMALS.find((a) => a.id === id)?.emoji || '🐾';

export function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

export function banner(title, sub = '') {
  const b = $('banner');
  b.hidden = false;
  b.innerHTML = '';
  b.append(document.createTextNode(title));
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    b.append(s);
  }
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
  clearTimeout(banner.t);
  banner.t = setTimeout(() => { b.hidden = true; }, 3300);
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.el = $('hud');
    this.selected = 0;
    this.dots = new Map();
    this.onSlotClick = () => {};
    this.slotEls = [];
    const wrap = $('slots');
    wrap.innerHTML = '';
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = document.createElement('div');
      s.className = 'slot empty';
      s.innerHTML = `<span class="n">${i + 1}</span><span class="i"></span><span class="c"></span>`;
      s.addEventListener('click', (e) => { e.stopPropagation(); this.onSlotClick(i); });
      s.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.onSlotClick(i); }, { passive: false });
      wrap.appendChild(s);
      this.slotEls.push(s);
    }
    this.lastTokens = null;
  }

  setup(tower) {
    this.finishY = tower.finishY;
    const bar = $('alt-bar');
    bar.querySelectorAll('.alt-band,.alt-tick').forEach((e) => e.remove());
    const zones = Math.ceil(tower.finishY / ZONE_H);
    for (let z = zones; z >= 1; z--) {
      const b = document.createElement('div');
      b.className = 'alt-band';
      const y0 = ((z - 1) * ZONE_H) / tower.finishY;
      const y1 = Math.min(1, (z * ZONE_H) / tower.finishY);
      b.style.bottom = `${y0 * 100}%`;
      b.style.height = `${(y1 - y0) * 100}%`;
      b.style.background = `linear-gradient(0deg, ${ZONES[z - 1].top}, ${ZONES[z - 1].sky})`;
      b.title = ZONES[z - 1].name;
      bar.insertBefore(b, bar.firstChild);
    }
    for (const g of tower.gates) {
      const t = document.createElement('div');
      t.className = 'alt-tick' + (g.boundary || g.final ? ' cp' : '');
      t.style.bottom = `${(g.y / tower.finishY) * 100}%`;
      bar.appendChild(t);
    }
    document.querySelector('.alt-label').textContent = tower.finishY;
    $('alt-dots').innerHTML = '';
    this.dots.clear();
  }

  setVisible(v) {
    this.el.hidden = !v;
  }

  updateDots(list, meId) {
    const seen = new Set();
    const host = $('alt-dots');
    for (const p of list) {
      seen.add(p.id);
      let d = this.dots.get(p.id);
      if (!d) {
        d = document.createElement('div');
        d.className = 'alt-dot' + (p.id === meId ? ' me' : '');
        d.textContent = animalEmoji(p.animal);
        d.style.background = TINT_COLORS[p.tint] || '#888';
        d.title = p.name;
        host.appendChild(d);
        this.dots.set(p.id, d);
      }
      d.style.bottom = `${Math.min(100, Math.max(0, (p.y / this.finishY) * 100))}%`;
      d.style.opacity = p.connected === false ? 0.35 : 1;
    }
    for (const [id, d] of this.dots) if (!seen.has(id)) { d.remove(); this.dots.delete(id); }
  }

  update(s) {
    const y = Math.max(0, Math.floor(s.y));
    const z = ZONES[zoneAt(s.y) - 1];
    const label = `${z.name} · Block ${Math.min(y, this.finishY)} / ${this.finishY}`;
    if (label !== this.lastLabel) { $('zone-label').textContent = label; this.lastLabel = label; }
    if (s.tokens !== this.lastTokens) {
      $('token-count').textContent = s.tokens;
      if (this.lastTokens != null && s.tokens > this.lastTokens) {
        $('tokens').classList.remove('bump');
        void $('tokens').offsetWidth;
        $('tokens').classList.add('bump');
      }
      this.lastTokens = s.tokens;
    }
    // slots
    const key = JSON.stringify(s.slots) + this.selected;
    if (key !== this.slotKey) {
      this.slotKey = key;
      this.slotEls.forEach((el, i) => {
        const sl = s.slots[i];
        el.classList.toggle('empty', !sl);
        el.classList.toggle('sel', i === this.selected && !!sl);
        el.querySelector('.i').textContent = sl ? ITEMS[sl.type].icon : '';
        el.querySelector('.c').textContent = sl ? `×${sl.uses}` : '';
        el.title = sl ? ITEMS[sl.type].name : 'Empty slot';
      });
    }
    // meters
    $('fuel-meter').hidden = !s.jet.owned;
    if (s.jet.owned) $('fuel-meter').querySelector('i').style.width = `${(s.jet.fuel / 3) * 100}%`;
    $('oxy-meter').hidden = !s.oxy;
    if (s.oxy) {
      $('oxy-meter').querySelector('i').style.width = `${(s.oxy.value / s.oxy.cap) * 100}%`;
      $('oxy-meter').querySelector('b').textContent = `${Math.ceil(s.oxy.value)}s`;
      $('oxy-meter').classList.toggle('low', s.oxy.value < 15);
    }
    const fx = [];
    if (s.spring) fx.push('👟 Spring');
    if (s.snack > 0) fx.push(`🍪 ${Math.ceil(s.snack)}s`);
    if (s.glider) fx.push('🪂 Glider');
    if (s.shield) fx.push('🛡️ Shield');
    if (s.immune > 0) fx.push(`✨ Safe ${Math.ceil(s.immune)}s`);
    const fk = fx.join('|');
    if (fk !== this.fxKey) {
      this.fxKey = fk;
      $('effects').innerHTML = fx.map((f) => `<span class="effect">${f}</span>`).join('');
    }
    $('t-rewind').hidden = !s.canRewind;
    if (s.prompt !== this.lastPrompt) {
      this.lastPrompt = s.prompt;
      $('prompt').hidden = !s.prompt;
      $('prompt').textContent = s.prompt || '';
    }
  }

  setTimer(text) {
    const t = $('timer');
    t.hidden = !text;
    if (text) t.textContent = text;
  }

  setTeam(text) {
    const t = $('team-label');
    t.hidden = !text;
    if (text) t.textContent = text;
  }
}
