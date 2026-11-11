// Checkpoint shop run by the raccoon merchant.
import { ITEMS, ITEM_ORDER, MAX_SLOTS, maxUses } from './shared/items.js';
import { net } from './net.js';
import { audio } from './audio.js';
import { toast } from './hud.js';

const $ = (id) => document.getElementById(id);

export class ShopPanel {
  constructor() {
    this.el = $('shop-panel');
    this.me = null;
    this.settings = {};
    this.zone = 1;
    this.onClose = () => {};
    $('btn-shop-close').addEventListener('click', () => this.close());
    $('btn-undo').addEventListener('click', () => this.undo());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
  }

  get open() {
    return !this.el.hidden;
  }

  show(zone) {
    this.zone = zone;
    this.el.hidden = false;
    this.render();
  }

  close() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.onClose();
  }

  update(me, settings) {
    this.me = me;
    this.settings = settings;
    if (this.open) this.render();
  }

  render() {
    const me = this.me;
    if (!me) return;
    $('shop-tokens').textContent = me.tokens;
    const box = $('shop-items');
    box.innerHTML = '';
    const unlockedZone = Math.max(me.cpZone, me.respawnZone || 1);
    for (const id of ITEM_ORDER) {
      const it = ITEMS[id];
      if (it.offensive && !this.settings.offensive) continue;
      if (it.needs && !this.settings[it.needs]) continue;
      const locked = it.zone > unlockedZone;
      const slot = me.slots.find((s) => s.type === id);
      const owned = it.kept && me.kept[id];
      const card = document.createElement('div');
      card.className = 'shop-item' + (locked ? ' locked' : '') + (owned ? ' owned' : '');
      let btnText = `Buy · ${it.price} 🪙`;
      let disabled = false;
      if (locked) { btnText = `🔒 Zone ${it.zone}`; disabled = true; }
      else if (owned) { btnText = '✔ Owned'; disabled = true; }
      else if (it.requires && !me.kept[it.requires]) { btnText = 'Needs Jetpack'; disabled = true; }
      else if (slot && slot.uses + it.uses > maxUses(id)) { btnText = 'You have 2'; disabled = true; }
      else if (!it.kept && !it.instant && !slot && me.slots.length >= MAX_SLOTS) { btnText = 'Slots full'; disabled = true; }
      else if (it.instant && id === 'oxygen' && me.oxyBonus >= 180) { btnText = 'Tanks full'; disabled = true; }
      else if (me.tokens < it.price) { btnText = `Need ${it.price} 🪙`; disabled = true; }
      card.innerHTML = `<div class="top"><span class="ico"></span><div><h4></h4><span class="kind"></span></div></div><p></p><button class="btn small primary"></button>`;
      card.querySelector('.ico').textContent = it.icon;
      card.querySelector('h4').textContent = it.name;
      card.querySelector('.kind').textContent = `${it.kind}${it.kept ? ' · keep all game' : ''}${slot ? ` · you have ×${slot.uses}` : ''}`;
      card.querySelector('p').textContent = it.desc;
      const b = card.querySelector('button');
      b.textContent = btnText;
      b.disabled = disabled;
      b.addEventListener('click', () => this.buy(id));
      box.appendChild(card);
    }
  }

  async buy(id) {
    const r = await net.request('shop:buy', { item: id });
    if (r.error) {
      audio.play('error');
      return toast(r.error, 'bad');
    }
    audio.play('buy');
    this.onBought?.(id);
    const bar = $('shop-undo');
    bar.hidden = false;
    $('undo-text').textContent = `You bought ${ITEMS[id].name}.`;
    clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => { bar.hidden = true; }, 10000);
  }

  async undo() {
    const r = await net.request('shop:undo', {});
    $('shop-undo').hidden = true;
    if (r.error) return toast(r.error, 'bad');
    this.onUndo?.(r.id);
    toast('Purchase undone. Tokens returned.', 'good');
  }
}
