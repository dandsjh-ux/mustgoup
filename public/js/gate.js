// Question panel shown while standing on a gate pad.
import { net } from './net.js';
import { audio, speak } from './audio.js';
import { toast } from './hud.js';

const $ = (id) => document.getElementById(id);
const SHAPES = ['●', '▲', '■', '★'];
const LABELS = ['A', 'B', 'C', 'D'];

export class GatePanel {
  constructor() {
    this.el = $('gate-panel');
    this.q = null;
    this.busy = false;
    this.gate = null;
    this.onCleared = () => {};
    this.hintUses = () => 0;
    $('btn-speak').addEventListener('click', () => this.readAloud());
    $('btn-hint').addEventListener('click', () => this.hint());
    net.on('gate:q', (q) => this.show(q));
    net.on('gate:result', (r) => this.result(r));
    net.on('gate:open', ({ gate }) => this.onCleared(gate, false, true));
  }

  get open() {
    return !this.el.hidden;
  }

  enter(gate, posPacket) {
    this.gate = gate;
    this.q = null;
    if (posPacket) net.emit('pos', posPacket);
    net.emit('gate:enter', { gate });
    // The server only answers once it has seen us on the pad; retry until a question arrives.
    clearInterval(this.retry);
    this.retry = setInterval(() => {
      if (this.gate !== gate || this.q) return clearInterval(this.retry);
      net.emit('gate:enter', { gate });
    }, 700);
  }

  leave() {
    if (this.gate == null) return;
    this.gate = null;
    this.el.hidden = true;
    this.q = null;
    clearTimeout(this.timer);
    clearInterval(this.retry);
    window.speechSynthesis?.cancel();
    net.emit('gate:leave');
  }

  show(q) {
    if (this.gate == null || q.gate !== this.gate) return;
    this.el.hidden = false;
    this.q = q;
    this.busy = false;
    this.renderDots(q.progress, q.needed);
    $('hint-count').textContent = this.hintUses() ? `×${this.hintUses()}` : '';
    $('btn-hint').hidden = !this.hintEnabled;
    $('btn-hint').disabled = !this.hintUses();
    if (q.readyIn > 50) {
      this.cooldown(q.readyIn, () => this.render(q));
      $('gate-question').textContent = '';
      $('gate-options').innerHTML = '';
    } else this.render(q);
  }

  render(q) {
    $('gate-cool').hidden = true;
    $('gate-question').textContent = q.text;
    const box = $('gate-options');
    box.innerHTML = '';
    q.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = `opt o${i}`;
      b.dataset.id = o.id;
      b.innerHTML = `<span class="shape">${SHAPES[i]}</span><span class="lab">${LABELS[i]}</span><span class="txt"></span>`;
      b.querySelector('.txt').textContent = o.text;
      if (q.removed?.includes(o.id)) b.classList.add('gone');
      b.addEventListener('click', () => this.answer(o.id));
      box.appendChild(b);
    });
    this.shownAt = performance.now();
  }

  renderDots(progress, needed) {
    const d = $('gate-dots');
    d.innerHTML = '';
    for (let i = 0; i < needed; i++) {
      const s = document.createElement('span');
      s.className = 'dot' + (i < progress ? ' on' : '');
      d.appendChild(s);
    }
  }

  answerIndex(i) {
    if (!this.q || this.busy) return;
    const o = this.q.options[i];
    if (o && !this.q.removed?.includes(o.id)) this.answer(o.id);
  }

  answer(id) {
    if (!this.q || this.busy || !$('gate-cool').hidden) return;
    this.busy = true;
    audio.play('click');
    net.emit('gate:answer', { qid: this.q.qid, optionId: id });
  }

  result(r) {
    if (!this.q || r.qid !== this.q.qid) return;
    const btns = [...$('gate-options').children];
    for (const b of btns) b.disabled = true;
    const chosen = btns.find((b) => b.dataset.id === r.chosen);
    const right = btns.find((b) => b.dataset.id === r.correctId);
    this.renderDots(r.progress, r.needed);
    if (r.correct) {
      audio.play('correct');
      chosen?.classList.add('right');
      if (r.cleared) {
        audio.play('gate');
        const gate = this.gate;
        this.timer = setTimeout(() => {
          this.el.hidden = true;
          this.q = null;
          this.gate = null;
          this.onCleared(gate, r.perfect, false);
        }, 700);
        return;
      }
      this.timer = setTimeout(() => this.show(r.next), 700);
    } else {
      audio.play('wrong');
      chosen?.classList.add('wrong');
      right?.classList.add('right');
      this.timer = setTimeout(() => {
        if (this.gate == null) return;
        const left = Math.max(0, r.next.readyIn - 2000);
        if (left > 50) this.cooldown(left, () => this.show({ ...r.next, readyIn: 0 }));
        else this.show({ ...r.next, readyIn: 0 });
      }, 2000);
    }
  }

  cooldown(ms, done) {
    const c = $('gate-cool');
    c.hidden = false;
    $('gate-options').innerHTML = '';
    $('gate-question').textContent = '';
    const ring = $('cool-ring');
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    void ring.getBoundingClientRect();
    ring.style.transition = `stroke-dashoffset ${ms}ms linear`;
    ring.style.strokeDashoffset = '119.4';
    const gate = this.gate;
    clearTimeout(this.coolTimer);
    this.coolTimer = setTimeout(() => {
      if (this.gate !== gate) return;
      c.hidden = true;
      done();
    }, ms);
  }

  readAloud() {
    if (!this.q) return;
    const opts = this.q.options.filter((o) => !this.q.removed?.includes(o.id)).map((o) => `${LABELS[this.q.options.indexOf(o)]}: ${o.text}.`).join(' ');
    if (!speak(`${this.q.text}. ${opts}`)) toast('Read-aloud is not available on this device');
  }

  async hint() {
    if (!this.q) return;
    const r = await net.request('gate:hint', { qid: this.q.qid });
    if (r.error) return toast(r.error, 'bad');
    this.q.removed = [...(this.q.removed || []), r.remove];
    const b = [...$('gate-options').children].find((x) => x.dataset.id === r.remove);
    b?.classList.add('gone');
    audio.play('bubble');
    $('hint-count').textContent = this.hintUses() ? `×${this.hintUses()}` : '';
    $('btn-hint').disabled = !this.hintUses();
  }
}
