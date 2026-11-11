// All sounds are synthesised with Web Audio: no files, no licences.
import { prefs } from './prefs.js';

const SCALES = {
  major: [0, 2, 4, 7, 9, 12, 14, 16],
  minor: [0, 3, 5, 7, 10, 12, 15, 17],
  dorian: [0, 2, 3, 7, 9, 12, 14, 15],
  lydian: [0, 4, 6, 7, 11, 12, 16, 18],
};
// One loop per zone: root note (MIDI), scale, tempo, lead wave, percussion on/off
const ZONE_MUSIC = [
  { root: 60, scale: 'major', bpm: 112, wave: 'triangle', perc: true },
  { root: 62, scale: 'major', bpm: 104, wave: 'triangle', perc: true },
  { root: 57, scale: 'dorian', bpm: 100, wave: 'sine', perc: false },
  { root: 64, scale: 'major', bpm: 96, wave: 'sine', perc: false },
  { root: 65, scale: 'lydian', bpm: 108, wave: 'triangle', perc: true },
  { root: 67, scale: 'major', bpm: 120, wave: 'square', perc: true },
  { root: 55, scale: 'dorian', bpm: 116, wave: 'square', perc: true },
  { root: 52, scale: 'minor', bpm: 124, wave: 'sawtooth', perc: true },
  { root: 57, scale: 'minor', bpm: 110, wave: 'triangle', perc: true },
  { root: 60, scale: 'lydian', bpm: 84, wave: 'sine', perc: false },
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

class Audio {
  constructor() {
    this.ctx = null;
    this.zone = 0;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.patterns = ZONE_MUSIC.map((_, i) => this.makePattern(i));
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.applyVolumes();
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.musicGain.gain.value = prefs.music * 0.35;
    this.sfxGain.gain.value = prefs.sfx * 0.8;
  }

  makePattern(zi) {
    // Small deterministic melody generator so each zone has its own tune.
    let s = (zi + 1) * 9301;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const mel = [];
    let deg = 2;
    for (let i = 0; i < 32; i++) {
      if (rnd() < 0.3) { mel.push(null); continue; }
      deg = Math.max(0, Math.min(7, deg + Math.floor(rnd() * 5) - 2));
      mel.push(deg);
    }
    const chords = [0, 5, 3, 4].map((c) => (zi % 2 ? [0, 3, 4, 0][[0, 5, 3, 4].indexOf(c)] : c));
    return { mel, chords };
  }

  startMusic() {
    if (!this.ctx || this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stopMusic() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setZone(z) {
    this.zone = Math.max(0, Math.min(9, z - 1));
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const m = ZONE_MUSIC[this.zone];
    const pat = this.patterns[this.zone];
    const stepDur = 60 / m.bpm / 2; // eighth notes
    const sc = SCALES[m.scale];
    while (this.nextTime < ctx.currentTime + 0.2) {
      const i = this.step % 32;
      const bar = Math.floor(i / 8);
      const t = this.nextTime;
      const deg = pat.mel[i];
      if (deg != null) this.tone(mtof(m.root + sc[deg]), t, stepDur * 0.9, m.wave, 0.09, this.musicGain);
      if (i % 4 === 0) {
        const root = m.root - 24 + sc[pat.chords[bar] % sc.length];
        this.tone(mtof(root), t, stepDur * 3.5, 'triangle', 0.16, this.musicGain);
      }
      if (i % 2 === 1) {
        const c = m.root - 12 + sc[(pat.chords[bar] + 2) % sc.length];
        this.tone(mtof(c), t, stepDur * 0.6, 'sine', 0.04, this.musicGain);
      }
      if (m.perc && i % 2 === 0) this.hat(t, i % 8 === 0 ? 0.05 : 0.025);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  tone(freq, t, dur, type, vol, dest, slideTo) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hat(t, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    src.start(t);
    src.stop(t + 0.06);
  }

  whoosh(t, dur, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'jump': this.tone(260, t, 0.22, 'sine', 0.3, null, 620); break; // boing
      case 'double': this.tone(700, t, 0.12, 'triangle', 0.25, null, 1300); break; // pop
      case 'land': this.tone(140, t, 0.1, 'sine', 0.2, null, 70); break;
      case 'bounce': this.tone(200, t, 0.4, 'sine', 0.35, null, 900); break;
      case 'correct': [72, 76, 79].forEach((n, i) => this.tone(mtof(n + 12), t + i * 0.08, 0.3, 'triangle', 0.25)); break;
      case 'wrong': this.tone(160, t, 0.3, 'square', 0.08, null, 120); break;
      case 'token': [84, 88, 91, 96].forEach((n, i) => this.tone(mtof(n), t + i * 0.06, 0.18, 'triangle', 0.18)); break;
      case 'gate': [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(mtof(n + 12), t + i * 0.05, 0.35, 'triangle', 0.2)); break;
      case 'fanfare': [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [84, 0.6]].forEach(([n, d]) => this.tone(mtof(n), t + d, 0.4, 'square', 0.12)); break;
      case 'push': this.whoosh(t, 0.4, 0.3); break;
      case 'wind': this.whoosh(t, 1.2, 0.18); break;
      case 'zap': this.tone(1200, t, 0.25, 'sawtooth', 0.12, null, 80); this.whoosh(t, 0.3, 0.25); break;
      case 'jet': this.whoosh(t, 0.3, 0.12); break;
      case 'buy': this.tone(mtof(79), t, 0.1, 'triangle', 0.2); this.tone(mtof(86), t + 0.08, 0.2, 'triangle', 0.2); break;
      case 'error': this.tone(220, t, 0.15, 'square', 0.06); this.tone(180, t + 0.12, 0.2, 'square', 0.06); break;
      case 'beep': this.tone(880, t, 0.1, 'square', 0.08); break;
      case 'click': this.tone(600, t, 0.04, 'triangle', 0.12); break;
      case 'countdown': this.tone(660, t, 0.2, 'triangle', 0.25); break;
      case 'go': this.tone(990, t, 0.5, 'triangle', 0.3); break;
      case 'shield': this.tone(500, t, 0.3, 'sine', 0.25, null, 1500); break;
      case 'fall': this.tone(600, t, 0.8, 'sine', 0.15, null, 120); break;
      case 'bubble': this.tone(400, t, 0.15, 'sine', 0.2, null, 900); break;
      case 'squawk': this.tone(1400, t, 0.12, 'sawtooth', 0.08, null, 900); this.tone(1500, t + 0.15, 0.14, 'sawtooth', 0.08, null, 800); break;
      case 'gurgle': [0, 0.12, 0.24, 0.36].forEach((d, i) => this.tone(220 + i * 60, t + d, 0.1, 'sine', 0.15, null, 500 + i * 80)); break;
      case 'geyser': this.whoosh(t, 0.8, 0.4); this.tone(120, t, 0.5, 'sine', 0.2, null, 300); break;
      default: break;
    }
  }
}

export const audio = new Audio();

export function speak(text) {
  if (!('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
  return true;
}
