// Keyboard, mouse and touch input -> a simple input state plus a queue of one-shot actions.
import { prefs } from './prefs.js';

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.actions = [];
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.jumpHeld = false;
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.camTouch = null;
    this.dragging = false;
    this.enabled = false;
    this.lastCamInput = 0;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.bind();
  }

  bind() {
    const isTyping = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    };
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.enabled) return;
      const k = e.code;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'Space') { this.jumpHeld = true; this.actions.push('jump'); }
      else if (k === 'KeyE') this.actions.push('use');
      else if (k === 'KeyR') this.actions.push('rewind');
      else if (k === 'KeyT') this.actions.push('emote');
      else if (k === 'Tab') this.actions.push('board');
      else if (k === 'Escape') this.actions.push('esc');
      else if (/^Digit[1-4]$/.test(k) || /^Numpad[1-4]$/.test(k)) this.actions.push('num' + k.slice(-1));
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.jumpHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; });

    // Mouse is optional: drag with any button to look around, scroll to zoom.
    // Everything can be done from the keyboard (WASD to move, arrow keys for the camera).
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouchEvent) return;
      this.dragging = true;
      c.focus();
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.dragging) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
        this.lastCamInput = performance.now();
      }
    });
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY);
    }, { passive: false });

    // Touch: left half joystick, right half swipe camera.
    c.addEventListener('touchstart', (e) => this.touchStart(e), { passive: false });
    c.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    c.addEventListener('touchend', (e) => this.touchEnd(e), { passive: false });
    c.addEventListener('touchcancel', (e) => this.touchEnd(e), { passive: false });
    const joyEl = document.getElementById('joy');
    joyEl.addEventListener('touchstart', (e) => this.touchStart(e, true), { passive: false });
    joyEl.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    joyEl.addEventListener('touchend', (e) => this.touchEnd(e), { passive: false });

    const hold = (id, down, up) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); down(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('down'); up?.(); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); down(); });
      el.addEventListener('mouseup', () => up?.());
    };
    hold('t-jump', () => { this.jumpHeld = true; this.actions.push('jump'); }, () => { this.jumpHeld = false; });
    hold('t-item', () => this.actions.push('use'));
    hold('t-rewind', () => this.actions.push('rewind'));
    hold('t-emote', () => this.actions.push('emote'));
  }

  touchStart(e, onJoy = false) {
    if (!this.enabled) return;
    e.preventDefault();
    this.isTouchEvent = true;
    const w = window.innerWidth;
    for (const t of e.changedTouches) {
      const leftSide = prefs.lefty ? t.clientX > w / 2 : t.clientX < w / 2;
      if ((onJoy || leftSide) && this.joy.id == null) {
        const el = document.getElementById('joy');
        const r = el.getBoundingClientRect();
        this.joy.id = t.identifier;
        this.joy.ox = r.left + r.width / 2;
        this.joy.oy = r.top + r.height / 2;
        this.updateJoy(t);
      } else if (this.camTouch == null) {
        this.camTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }

  touchMove(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joy.id) this.updateJoy(t);
      else if (this.camTouch && t.identifier === this.camTouch.id) {
        this.look.x += (t.clientX - this.camTouch.x) * 1.6;
        this.look.y += (t.clientY - this.camTouch.y) * 1.6;
        this.camTouch.x = t.clientX;
        this.camTouch.y = t.clientY;
        this.lastCamInput = performance.now();
      }
    }
  }

  touchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joy.id) {
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        document.getElementById('joy-knob').style.transform = '';
      } else if (this.camTouch && t.identifier === this.camTouch.id) this.camTouch = null;
    }
  }

  updateJoy(t) {
    const max = 60;
    let dx = t.clientX - this.joy.ox;
    let dy = t.clientY - this.joy.oy;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    this.joy.x = dx / max;
    this.joy.y = -dy / max;
    document.getElementById('joy-knob').style.transform = `translate(${dx}px, ${dy}px)`;
  }

  move() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW')) y += 1;
    if (this.keys.has('KeyS')) y -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    x += this.joy.x;
    y += this.joy.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    if (l < 0.12) { x = 0; y = 0; }
    return { x, y };
  }

  // Arrow keys turn the camera (left/right) and tilt it (up/down); +/- or PageUp/PageDown zoom.
  keyLook() {
    let x = 0, y = 0, z = 0;
    if (this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd') || this.keys.has('PageUp')) z -= 1;
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract') || this.keys.has('PageDown')) z += 1;
    if (x || y) this.lastCamInput = performance.now();
    return { x, y, z };
  }

  take() {
    const a = this.actions;
    this.actions = [];
    const look = { ...this.look };
    this.look.x = this.look.y = 0;
    const zoom = this.zoom;
    this.zoom = 0;
    return { actions: a, look, zoom };
  }

  reset() {
    this.keys.clear();
    this.actions = [];
    this.jumpHeld = false;
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.camTouch = null;
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
}
