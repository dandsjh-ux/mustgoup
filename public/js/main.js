// Must Go Up — client entry point and game loop.
import * as THREE from 'three';
import { net } from './net.js';
import { buildTower, zoneAt, ZONES, OFF_R, PHYS, ZONE_H } from './shared/tower.js';
import { ITEMS, EMOTES, TINT_COLORS, ITEM_RULES, ANIMALS } from './shared/items.js';
import { World } from './world.js';
import { Hazards } from './hazards.js';
import { LocalPlayer } from './player.js';
import { AnimalModel, ANIM, makeNameTag, emojiSprite, Trail } from './animals.js';
import { Controls } from './controls.js';
import { Hud, toast, banner, fmtTime, animalEmoji } from './hud.js';
import { GatePanel } from './gate.js';
import { ShopPanel } from './shop.js';
import { audio } from './audio.js';
import { prefs, savePrefs, applyBodyPrefs } from './prefs.js';
import { UI } from './ui.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;
const FLAG = { jet: 1, glide: 2, shield: 4, bubble: 8, safe: 16, respawn: 32, immune: 64, finished: 256 };
const TEAM_COLORS = ['#888', '#ff5a5f', '#3a86ff', '#2ec27e', '#ffc23d', '#9b5de5'];

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !matchMedia('(pointer: coarse)').matches, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 700);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#7a6a8a', 1.5);
    this.sun = new THREE.DirectionalLight('#ffffff', 1.6);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.controls = new Controls(this.canvas);
    this.hud = new Hud();
    this.gate = new GatePanel();
    this.shop = new ShopPanel();
    this.running = false;
    this.remotes = new Map();
    this.cam = { yaw: 0, pitch: 0.22, dist: 7 };
    this.fps = { frames: 0, t: 0, low: 0 };
    this.quality = prefs.quality === 'low' ? 'low' : 'high';

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindNet();
    this.bindUI();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- lifecycle
  start(p, opts) {
    this.stop();
    $('loading').hidden = false;
    this.canvas.style.visibility = 'visible';
    this.opts = opts;
    this.settings = { ...p.settings };
    this.clock = { startAt: p.startAt, pausedMs: p.pausedMs, paused: p.paused, pausedAt: p.pausedAt };
    this.pid = opts.pid;
    this.spectator = !!opts.spectator;
    this.isHost = !!opts.isHost;
    this.tower = buildTower(p.seed, { gateSpacing: this.settings.gateSpacing, finishY: p.finishY });
    this.cpY = {};
    for (const c of this.tower.checkpoints) this.cpY[c.zone] = c.y;
    this.world = new World(this.scene);
    this.world.quality = this.quality;
    this.world.build(this.tower);
    this.world.isPassable = (gi) => this.passable(gi);
    this.hazards = new Hazards(this.scene, this.world, this.tower, this.settings);
    this.hud.setup(this.tower);
    this.teams = p.teams || [];
    this.me = { tokens: 0, slots: [], kept: {}, cleared: [], cpZone: 1, respawnZone: 1, visited: [1], shield: false, oxyBonus: 0, team: 0 };
    this.cleared = new Set();
    this.standings = [];
    this.acc = 0;
    this.respawnT = 0;
    this.finishedSent = false;
    this.cpPending = false;
    this.shopLatch = false;
    this.oxygen = 90;
    this.lastSend = 0;
    this.lastBeep = 0;
    this.countdownShown = null;
    this.follow = null;
    this.fx = [];
    net.clearBuffers();

    for (const pl of p.players) if (pl.id !== this.pid) this.addRemote(pl);
    const meInfo = p.players.find((x) => x.id === this.pid);
    if (!this.spectator && meInfo) {
      this.player = new LocalPlayer(this.scene, this.world, meInfo.profile);
      this.player.onShieldUsed = () => { net.emit('shield:used'); toast('🛡️ Your Bubble Shield blocked a push!', 'good'); };
      this.player.onPushed = () => this.shake(0.25);
      this.player.onBoost = () => this.shake(0.12);
      this.myName = meInfo.name;
      this.myProfile = meInfo.profile;
      this.respawn(true);
    } else this.player = null;

    const sp = this.tower.checkpoints[0].spawn;
    this.cam.yaw = Math.atan2(sp.x, sp.z);
    this.hud.setVisible(!this.spectator);
    $('touch').hidden = !(this.controls.isTouch && !this.spectator);
    document.body.classList.toggle('touch', this.controls.isTouch);
    $('spectator').hidden = !this.spectator;
    $('btn-teacher').hidden = !this.isHost;
    $('pause-overlay').hidden = !this.clock.paused;
    if (this.spectator) this.setupSpectator(opts.code);
    this.controls.reset();
    this.controls.enabled = true;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    this.canvas.focus({ preventScroll: true });
    this.running = true;
    this.hud.setTeam(this.teamText());
    audio.unlock();
    audio.setZone(1);
    audio.startMusic();
    setTimeout(() => { $('loading').hidden = true; }, 150);
    this.buildEmoteWheel();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.controls.enabled = false;
    this.controls.releaseLock();
    this.gate.leave();
    this.shop.close();
    for (const id of ['board-panel', 'teacher-panel', 'settings-panel', 'gate-panel', 'shop-panel', 'emote-wheel', 'countdown', 'pause-overlay', 'spectator']) $(id).hidden = true;
    this.hud.setVisible(false);
    this.player?.dispose();
    this.player = null;
    for (const r of this.remotes.values()) this.removeRemoteObj(r);
    this.remotes.clear();
    this.hazards?.dispose();
    this.world?.dispose();
    for (const f of this.fx) f.obj.removeFromParent();
    this.fx = [];
    this.world = null;
    $('fade').style.opacity = 0;
    this.shadow?.removeFromParent();
    this.ring?.removeFromParent();
    this.bubble?.removeFromParent();
    this.myEmoteSprite?.removeFromParent();
    this.myEmoteSprite = null;
    this.canvas.style.visibility = 'hidden';
    audio.stopMusic();
  }

  gameTime() {
    const now = net.now();
    const c = this.clock;
    return (now - c.startAt - c.pausedMs - (c.paused ? now - c.pausedAt : 0)) / 1000;
  }

  passable(gi) {
    const g = this.tower.gates[gi];
    if (!g) return false;
    return this.cleared.has(gi) || g.y <= (this.cpY[this.me.respawnZone] ?? 0);
  }

  teamText() {
    if (!this.teams.length || !this.me.team) return '';
    const t = this.teams.find((x) => x.id === this.me.team);
    return t ? `Team ${t.name}` : '';
  }

  // ---------------------------------------------------------------- remotes
  addRemote(pl) {
    if (this.remotes.has(pl.id)) return;
    const model = new AnimalModel(pl.profile);
    this.scene.add(model.root);
    const tagColor = pl.team ? TEAM_COLORS[pl.team % TEAM_COLORS.length] : '#ffffff';
    const tag = makeNameTag(pl.name, tagColor);
    this.scene.add(tag);
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), new THREE.MeshBasicMaterial({ color: '#9be7ff', transparent: true, opacity: 0.25, depthWrite: false }));
    bubble.visible = false;
    this.scene.add(bubble);
    const r = { ...pl, model, tag, bubble, trail: new Trail(this.scene, pl.profile.trail), lastEmote: 0, emoteSprite: null, pos: new THREE.Vector3(), seen: 0 };
    model.root.visible = false;
    tag.visible = false;
    this.remotes.set(pl.id, r);
  }

  removeRemoteObj(r) {
    r.model.dispose();
    r.tag.removeFromParent();
    r.bubble.removeFromParent();
    r.trail.dispose();
    r.emoteSprite?.removeFromParent();
  }

  updateRemotes(dt) {
    const now = net.now();
    for (const r of this.remotes.values()) {
      const s = net.sample(r.id);
      const visible = !!s && now - (net.latest(r.id)?.t || 0) < 4000;
      r.model.root.visible = r.tag.visible = visible;
      if (!visible) { r.bubble.visible = false; continue; }
      r.pos.set(s.x, s.y, s.z);
      r.flags = s.flags;
      r.model.root.position.copy(r.pos);
      r.model.root.rotation.y = s.ry;
      r.model.setAnim(s.anim);
      r.model.update(dt, s.anim === ANIM.run ? 1 : 0, { jetpack: s.anim === ANIM.jet, cape: s.anim === ANIM.glide });
      r.tag.position.set(s.x, s.y + 1.55, s.z);
      r.bubble.visible = !!(s.flags & FLAG.bubble) || !!(s.flags & FLAG.shield);
      r.bubble.material.color.set(s.flags & FLAG.bubble ? '#9be7ff' : '#c4a7ff');
      r.bubble.position.set(s.x, s.y + 0.5, s.z);
      r.model.root.visible = !(s.flags & FLAG.immune) || Math.sin(performance.now() / 50) > -0.5;
      if (s.emote && s.emote !== r.lastEmote) {
        r.model.playEmote(s.emote);
        this.showEmoteSprite(r, s.emote);
      }
      r.lastEmote = s.emote;
      if (r.emoteSprite) {
        r.emoteSprite.position.set(s.x, s.y + 2.1, s.z);
        r.emoteT -= dt;
        if (r.emoteT <= 0) { r.emoteSprite.removeFromParent(); r.emoteSprite = null; }
      }
      r.trail.update(dt, r.pos, s.anim !== ANIM.idle && s.anim !== ANIM.bubble);
    }
  }

  showEmoteSprite(r, n) {
    r.emoteSprite?.removeFromParent();
    r.emoteSprite = emojiSprite(EMOTES[n - 1]?.icon || '👋', 0.8);
    r.emoteT = 2.2;
    this.scene.add(r.emoteSprite);
  }

  // ---------------------------------------------------------------- net
  bindNet() {
    net.on('me', (m) => this.onMe(m));
    net.on('standings', (s) => this.onStandings(s));
    net.on('clock', (c) => {
      if (!this.running) return;
      this.clock = c;
      $('pause-overlay').hidden = !c.paused;
      $('btn-pause').textContent = c.paused ? '▶ Resume' : '⏸ Pause everyone';
      if (c.paused) this.controls.releaseLock();
    });
    net.on('push', (d) => {
      if (!this.player) return;
      if (d.blocked) { audio.play('shield'); toast(`🛡️ Your Bubble Shield blocked ${d.by}'s ${d.kind === 'glove' ? 'Boing Glove' : 'Gust Bomb'}!`, 'good'); return; }
      this.player.applyPush(d.dir[0], d.dir[1], d.dist, d.up);
      this.player.immuneUntil = this.player.time + ITEM_RULES.immunityMs / 1000;
      audio.play('push');
      toast(`${d.by} hit you with a ${d.kind === 'glove' ? 'Boing Glove 🥊' : 'Gust Bomb 💨'}! You are safe from pushes for 8 s.`);
    });
    net.on('fx', (f) => this.onFx(f));
    net.on('correction', (p) => { if (this.player) this.player.teleport(p); });
    net.on('respawn', () => { if (this.player) this.respawn(true); });
    net.on('toast', (t) => {
      if (!this.running) return;
      toast(t.text, 'good');
      if (t.kind === 'finish' && t.place === 1 && this.world?.flag) {
        const who = t.id === this.pid ? { profile: this.myProfile } : this.remotes.get(t.id);
        this.world.flag.visible = true;
        this.world.flagCloth.material.color.set(TINT_COLORS[who?.profile?.tint ?? 0]);
      }
    });
    net.on('player:join', (pl) => { if (this.running && pl.id !== this.pid) { this.addRemote(pl); toast(`${pl.name} joined the climb!`); } });
    net.on('player:leave', ({ id, temporary }) => {
      const r = this.remotes.get(id);
      if (!r || temporary) return;
      this.removeRemoteObj(r);
      this.remotes.delete(id);
    });
    net.on('player:profile', ({ id, profile }) => {
      const r = this.remotes.get(id);
      if (!r) return;
      this.removeRemoteObj(r);
      this.remotes.delete(id);
      this.addRemote({ ...r, profile });
    });
    net.on('settings', (s) => {
      if (!this.running) return;
      Object.assign(this.settings, s);
      $('offense-state').textContent = this.settings.offensive ? 'On' : 'Off';
      toast(this.settings.offensive ? 'Offensive items are back on.' : 'The teacher switched offensive items off.');
      this.shop.update(this.me, this.settings);
    });
  }

  onMe(m) {
    if (!this.running) return;
    const prevTokens = this.me.tokens;
    this.me = m;
    this.cleared = new Set(m.cleared);
    if (this.player) {
      if (m.kept.jetpack && !this.player.jet.owned) this.player.jet.fuel = 3;
      this.player.jet.owned = !!m.kept.jetpack;
      this.player.cleats = !!m.kept.cleats;
      this.player.shield = !!m.shield;
    }
    for (let i = 0; i < this.tower.gates.length; i++) this.world.setGateOpen(i, this.passable(i));
    this.gate.hintUses = () => this.me.slots.find((s) => s.type === 'hint')?.uses || 0;
    this.gate.hintEnabled = this.settings.hintLens;
    this.shop.update(m, this.settings);
    if (m.tokens > prevTokens && prevTokens !== 0) audio.play('token');
    this.hud.setTeam(this.teamText());
  }

  onStandings(s) {
    if (!this.running) return;
    this.standings = s.list;
    this.gameMs = s.gameMs;
    if (this.settings.timer > 0) {
      const left = this.settings.timer * 60000 - s.gameMs;
      this.hud.setTimer(`⏱ ${fmtTime(left)}`);
      if (this.spectator) $('spec-timer').textContent = `⏱ ${fmtTime(left)}`;
    } else {
      this.hud.setTimer(this.spectator ? '' : `⏱ ${fmtTime(s.gameMs)}`);
      if (this.spectator) $('spec-timer').textContent = `⏱ ${fmtTime(s.gameMs)}`;
    }
    if (!$('board-panel').hidden) this.renderBoard();
    if (!$('teacher-panel').hidden) this.renderTeacher();
    if (this.spectator) this.renderSpectator();
  }

  onFx(f) {
    if (!this.running) return;
    const from = f.from === this.pid ? this.player?.pos : this.remotes.get(f.from)?.pos;
    if (f.kind === 'glove') {
      const to = f.to === this.pid ? this.player?.pos : this.remotes.get(f.to)?.pos;
      if (!from || !to) return;
      const s = emojiSprite('🥊', 0.7);
      this.scene.add(s);
      this.fx.push({ obj: s, t: 0, dur: 0.35, a: from.clone().add(new THREE.Vector3(0, 0.6, 0)), b: to.clone().add(new THREE.Vector3(0, 0.6, 0)) });
      audio.play('bounce');
    } else if (f.kind === 'gust') {
      const p = new THREE.Vector3(...f.point);
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
      s.position.copy(p);
      this.scene.add(s);
      this.fx.push({ obj: s, t: 0, dur: 0.6, burst: true });
      audio.play('push');
    } else if (f.kind === 'cloud' && f.from !== this.pid) {
      this.world.addCloud(f.point[0], f.point[1] - 0.05, f.point[2], 5, false);
    }
  }

  updateFx(dt) {
    for (const f of this.fx) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      if (f.burst) { f.obj.scale.setScalar(0.5 + k * 3.2); f.obj.material.opacity = 0.7 * (1 - k); }
      else if (f.a) f.obj.position.lerpVectors(f.a, f.b, k);
      if (k >= 1) { f.obj.removeFromParent(); f.done = true; }
    }
    this.fx = this.fx.filter((f) => !f.done);
  }

  // ---------------------------------------------------------------- UI bindings
  bindUI() {
    this.hud.onSlotClick = (i) => {
      if (this.hud.selected === i && this.controls.isTouch) this.useItem(i);
      this.hud.selected = i;
    };
    $('btn-board').addEventListener('click', () => this.toggle('board-panel'));
    $('btn-settings').addEventListener('click', () => { this.controls.releaseLock(); this.toggle('settings-panel'); });
    $('btn-teacher').addEventListener('click', () => { this.controls.releaseLock(); this.toggle('teacher-panel'); this.renderTeacher(); });
    $('btn-spec-teacher').addEventListener('click', () => { this.toggle('teacher-panel'); this.renderTeacher(); });
    $('btn-spec-board').addEventListener('click', () => this.toggle('board-panel'));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { $(b.dataset.close).hidden = true; }));
    document.querySelectorAll('.overlay-panel').forEach((p) => {
      if (p.id === 'gate-panel' || p.id === 'shop-panel') return;
      p.addEventListener('click', (e) => { if (e.target === p) p.hidden = true; });
    });
    $('btn-pause').addEventListener('click', () => net.emit('host:pause', { paused: !this.clock?.paused }));
    $('btn-end').addEventListener('click', () => { if (confirm('End the game now and show the results?')) net.emit('host:end'); });
    $('btn-offense').addEventListener('click', () => net.emit('host:offensive', { on: !this.settings?.offensive }));
    this.shop.onClose = () => {};
    this.shop.onBought = (id) => { if (id === 'jetpack' && this.player) this.player.jet.fuel = 3; };
    this.gate.onCleared = (gi, perfect, wasOpen) => this.onGateCleared(gi, perfect, wasOpen);

    // settings panel
    const bindRange = (id, key, after) => {
      const el = $(id);
      el.value = prefs[key];
      el.addEventListener('input', () => { prefs[key] = Number(el.value); savePrefs(); after?.(); });
    };
    const bindCheck = (id, key) => {
      const el = $(id);
      el.checked = !!prefs[key];
      el.addEventListener('change', () => { prefs[key] = el.checked; savePrefs(); });
    };
    bindRange('set-music', 'music', () => audio.applyVolumes());
    bindRange('set-sfx', 'sfx', () => audio.applyVolumes());
    bindRange('set-sens', 'sens');
    bindCheck('set-invert', 'invert');
    bindCheck('set-large', 'large');
    bindCheck('set-motion', 'motion');
    bindCheck('set-lefty', 'lefty');
    $('set-quality').value = prefs.quality;
    $('set-quality').addEventListener('change', (e) => {
      prefs.quality = e.target.value;
      savePrefs();
      this.setQuality(prefs.quality === 'low' ? 'low' : 'high');
    });
  }

  toggle(id) {
    $(id).hidden = !$(id).hidden;
    if (id === 'board-panel' && !$(id).hidden) this.renderBoard();
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(1.5, window.devicePixelRatio || 1));
    this.resize();
    if (this.world) this.world.quality = q;
  }

  buildEmoteWheel() {
    const w = $('emote-wheel');
    w.innerHTML = '';
    for (const e of EMOTES) {
      const b = document.createElement('button');
      b.innerHTML = `${e.icon}<small>${e.id}</small>`;
      b.title = e.name;
      b.addEventListener('click', () => this.emote(e.id));
      w.appendChild(b);
    }
  }

  emote(n) {
    $('emote-wheel').hidden = true;
    this.emoteArmed = 0;
    if (!this.player) return;
    net.emit('emote', n);
    this.player.model.playEmote(n);
    const me = { emoteSprite: this.myEmoteSprite };
    this.showEmoteSprite(me, n);
    this.myEmoteSprite = me.emoteSprite;
    this.myEmoteT = 2.2;
  }

  renderBoard() {
    const list = $('board-list');
    list.innerHTML = '';
    const teamName = (id) => this.teams.find((t) => t.id === id)?.name;
    if (this.teams.length) {
      const totals = this.teams.map((t) => ({ ...t, sum: this.standings.filter((s) => s.team === t.id).reduce((a, s) => a + s.maxY, 0) })).sort((a, b) => b.sum - a.sum);
      const div = document.createElement('div');
      div.className = 'row gap wrap';
      div.innerHTML = totals.map((t) => `<span class="team-card">${t.name}: ${t.sum}</span>`).join('');
      list.appendChild(div);
    }
    for (const s of this.standings) {
      const row = document.createElement('div');
      row.className = 'board-row' + (s.id === this.pid ? ' me' : '');
      row.innerHTML = `<span class="rk"></span><span class="em"></span><span class="nm"></span><span class="ht"></span>`;
      row.querySelector('.rk').textContent = s.finished ? '🏁' : s.rank;
      row.querySelector('.em').textContent = animalEmoji(s.animal);
      row.querySelector('.nm').textContent = `${s.name}${s.team ? ` · ${teamName(s.team) || ''}` : ''}${s.connected ? '' : ' (away)'}`;
      row.querySelector('.ht').textContent = `${s.maxY} ⬆ · ${s.gates} 🦉`;
      list.appendChild(row);
    }
  }

  renderTeacher() {
    $('offense-state').textContent = this.settings?.offensive ? 'On' : 'Off';
    $('btn-pause').textContent = this.clock?.paused ? '▶ Resume' : '⏸ Pause everyone';
    const box = $('teacher-players');
    box.innerHTML = '';
    for (const s of this.standings) {
      const row = document.createElement('div');
      row.className = 'teacher-row';
      row.innerHTML = `<span></span><button class="btn small">Kick</button>`;
      row.querySelector('span').textContent = `${animalEmoji(s.animal)} ${s.name} — block ${s.y}${s.connected ? '' : ' (away)'}`;
      const b = row.querySelector('button');
      if (s.id === this.pid) b.remove();
      else b.addEventListener('click', () => { if (confirm(`Remove ${s.name}?`)) net.emit('host:kick', { id: s.id }); });
      box.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- spectator
  setupSpectator(code) {
    $('spec-code').textContent = `Code: ${code}`;
    const bar = $('spec-bar');
    bar.innerHTML = '';
    const fy = this.tower.finishY;
    const stops = [];
    for (let z = 1; z <= Math.ceil(fy / ZONE_H); z++) stops.push(`${ZONES[z - 1].top} ${((z - 1) * ZONE_H / fy) * 100}%`, `${ZONES[z - 1].sky} ${Math.min(100, (z * ZONE_H / fy) * 100)}%`);
    bar.style.background = `linear-gradient(0deg, ${stops.join(',')})`;
    this.specDots = new Map();
    this.cam.dist = 13;
    this.cam.pitch = 0.3;
  }

  renderSpectator() {
    const bar = $('spec-bar');
    const fy = this.tower.finishY;
    const seen = new Set();
    for (const s of this.standings) {
      seen.add(s.id);
      let d = this.specDots.get(s.id);
      if (!d) {
        d = document.createElement('div');
        d.className = 'spec-dot';
        d.innerHTML = `<span class="em"></span><span class="nm"></span>`;
        d.querySelector('.em').textContent = animalEmoji(s.animal);
        d.querySelector('.em').style.background = TINT_COLORS[s.tint];
        bar.appendChild(d);
        this.specDots.set(s.id, d);
      }
      d.style.bottom = `${Math.min(100, (s.y / fy) * 100)}%`;
      d.querySelector('.nm').textContent = s.name;
      d.style.opacity = s.connected ? 1 : 0.4;
    }
    for (const [id, d] of this.specDots) if (!seen.has(id)) { d.remove(); this.specDots.delete(id); }
    const ol = $('spec-list');
    ol.innerHTML = '';
    for (const s of this.standings.slice(0, 5)) {
      const li = document.createElement('li');
      if (s.id === (this.follow || this.standings[0]?.id)) li.className = 'follow';
      const gate = s.atGate ? ` · at gate: ${'●'.repeat(s.atGate.progress)}${'○'.repeat(Math.max(0, this.settings.perGate - s.atGate.progress))}` : '';
      li.innerHTML = `<span></span><span class="sub"></span>`;
      li.firstChild.textContent = `${animalEmoji(s.animal)} ${s.name}${s.finished ? ' 🏁' : ''}`;
      li.lastChild.textContent = `Block ${s.maxY} · ${s.gates} gates${gate}`;
      li.addEventListener('click', () => { this.follow = s.id; this.renderSpectator(); });
      ol.appendChild(li);
    }
  }

  // ---------------------------------------------------------------- gameplay helpers
  respawn(immediate = false) {
    const p = this.player;
    if (!p) return;
    const z = Math.max(this.me.respawnZone || 1, 1);
    const cp = this.tower.checkpoints.find((c) => c.zone === z) || this.tower.checkpoints[0];
    // scatter a little so classmates do not all appear on the same spot
    const ja = Math.random() * Math.PI * 2, jr = Math.random() * 1.8;
    let target = { x: cp.spawn.x + Math.cos(ja) * jr, y: cp.y + 0.05, z: cp.spawn.z + Math.sin(ja) * jr };
    if (this.settings.respawn === 'gate') {
      for (const gi of this.cleared) {
        const g = this.tower.gates[gi];
        if (g && g.landing.y > target.y) target = { x: g.landing.x, y: g.landing.y + 0.05, z: g.landing.z };
      }
    }
    p.teleport(target, Math.atan2(-target.x, -target.z) + Math.PI / 2);
    p.respawning = false;
    this.respawnT = 0;
    this.oxygen = this.oxyCap();
    $('fade').style.opacity = 0;
    if (!immediate) audio.play('bubble');
  }

  oxyCap() {
    return 90 + (this.me.oxyBonus || 0);
  }

  onGateCleared(gi, perfect, wasOpen) {
    this.cleared.add(gi);
    this.world.setGateOpen(gi, true);
    const p = this.player;
    if (!p) return;
    p.inBubble = false;
    const g = this.tower.gates[gi];
    if (!wasOpen) {
      banner('Gate open! 🎉', perfect ? 'Perfect gate: +1 Jump Token' : `Gate ${gi + 1} of ${this.tower.gates.length}`);
      this.confetti(p.pos);
      if (perfect) audio.play('token');
    }
    p.startLaunch(new THREE.Vector3(g.landing.x, g.landing.y + 0.05, g.landing.z), 1.2, 3);
    net.emit('pos', this.posPacket());
  }

  confetti(at) {
    const n = 40;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set([at.x, at.y + 1, at.z], i * 3);
      c.setHSL(Math.random(), 0.9, 0.6);
      col.set([c.r, c.g, c.b], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 8 + 2, (Math.random() - 0.5) * 8));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.25, vertexColors: true }));
    this.scene.add(pts);
    const self = { obj: pts, t: 0, dur: 1.6 };
    self.update = (dt) => {
      for (let i = 0; i < n; i++) {
        vel[i].y -= 15 * dt;
        pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
    };
    this.fx.push(self);
  }

  shake(amount) {
    if (prefs.motion) return;
    this.shakeT = Math.max(this.shakeT || 0, amount);
  }

  forward() {
    return new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
  }

  async useItem(i) {
    const p = this.player;
    if (!p || this.paused()) return;
    const sl = this.me.slots[i];
    if (!sl) return toast('This slot is empty. Buy items at checkpoint shops!');
    const type = sl.type;
    const req = (extra = {}) => net.request('item:use', { type, ...extra });
    switch (type) {
      case 'hint':
        if (this.gate.open) this.gate.hint();
        else toast('Use the Hint Lens when you are answering a gate question.');
        return;
      case 'rewind': return this.doRewind();
      case 'cloud': {
        if (p.grounded) return toast('Use Cloud Step in mid-air!');
        this.world.addCloud(p.pos.x, p.pos.y - 0.05, p.pos.z, 5, true);
        p.vel.y = Math.max(p.vel.y, 0);
        audio.play('bubble');
        const r = await req();
        if (r.error) toast(r.error, 'bad');
        return;
      }
      case 'glove': {
        if (!this.settings.offensive) return toast('Offensive items are switched off.');
        let best = null;
        let bd = Infinity;
        for (const r of this.remotes.values()) {
          if (!r.model.root.visible) continue;
          if (r.flags & (FLAG.safe | FLAG.bubble | FLAG.respawn)) continue;
          if (this.me.team && r.team === this.me.team) continue;
          const d = r.pos.distanceTo(p.pos);
          if (d < bd) { bd = d; best = r; }
        }
        if (!best || bd > ITEM_RULES.gloveRange + 0.5) return toast('Nobody is close enough to punch (3 blocks).');
        const r = await req({ target: best.id });
        if (r.error) return toast(r.error, 'bad');
        toast(r.result === 'blocked' ? `${r.name}'s Bubble Shield blocked it!` : `Boing! You pushed ${r.name}.`);
        return;
      }
      case 'gust': {
        if (!this.settings.offensive) return toast('Offensive items are switched off.');
        const f = this.forward();
        const tx = p.pos.x + f.x * 6, tz = p.pos.z + f.z * 6;
        const gnd = this.world.groundBelow(tx, p.pos.y + 3, tz);
        const ty = gnd ? gnd.ctop : p.pos.y;
        const r = await req({ point: [tx, ty, tz] });
        if (r.error) return toast(r.error, 'bad');
        toast(r.hits ? `Whoosh! Your Gust Bomb pushed ${r.hits} player${r.hits > 1 ? 's' : ''}.` : 'Whoosh! Nobody was close to the Gust Bomb.');
        return;
      }
      case 'fuel':
        if (!p.jet.owned) return toast('You need a Jetpack first.');
        if (p.jet.fuel > 2.9) return toast('Your jetpack tank is already full.');
        break;
      case 'spring':
        if (p.spring) return toast('Spring Shoes are already on!');
        break;
      case 'glider':
        if (p.glider) return toast('Your Glider Cape is already on!');
        break;
      case 'shield':
        if (this.me.shield) return toast('Your Bubble Shield is already on!');
        break;
      default: break;
    }
    const r = await req();
    if (r.error) return toast(r.error, 'bad');
    audio.play('buy');
    if (type === 'spring') { p.spring = true; toast('👟 Spring Shoes on: jump 30% higher until the next checkpoint.', 'good'); }
    if (type === 'snack') { p.snackUntil = p.time + 15; toast('🍪 Yum! Super speed for 15 seconds.', 'good'); }
    if (type === 'glider') { p.glider = true; toast('🪂 Glider Cape on: hold Jump while falling.', 'good'); }
    if (type === 'shield') toast('🛡️ Bubble Shield on: wind can’t move you and it blocks the next push.', 'good');
    if (type === 'fuel') { p.jet.fuel = 3; toast('🔋 Jetpack tank full!', 'good'); }
  }

  async doRewind() {
    const p = this.player;
    if (!p) return;
    const sl = this.me.slots.find((s) => s.type === 'rewind');
    if (!sl) return toast('You need a Rewind Module (sold at every checkpoint).');
    if (!p.canRewind()) return toast('Rewind works while you are falling.');
    p.rewind();
    p.respawning = false;
    this.respawnT = 0;
    $('fade').style.opacity = 0;
    audio.play('bubble');
    const r = await net.request('item:use', { type: 'rewind' });
    if (r.error) toast(r.error, 'bad');
  }

  paused() {
    return this.clock?.paused;
  }

  posPacket() {
    const p = this.player;
    let flags = 0;
    if (p.jet.active) flags |= FLAG.jet;
    if (p.gliding) flags |= FLAG.glide;
    if (this.me.shield) flags |= FLAG.shield;
    if (p.inBubble) flags |= FLAG.bubble;
    if (p.isSafe()) flags |= FLAG.safe;
    if (p.respawning) flags |= FLAG.respawn;
    if (p.time < p.immuneUntil) flags |= FLAG.immune;
    if (this.me.finished) flags |= FLAG.finished;
    const r = (v) => Math.round(v * 100) / 100;
    return [r(p.pos.x), r(p.pos.y), r(p.pos.z), r(p.yaw), p.anim, flags];
  }

  // ---------------------------------------------------------------- per-frame game rules
  gameRules(dt) {
    const p = this.player;
    const g = p.ground;

    // gate pads
    if (!p.launch && p.grounded && g && g.kind === 'pad' && g.gate != null) {
      if (this.passable(g.gate)) {
        if (!this.gate.open) this.onGateCleared(g.gate, false, true);
      } else if (this.gate.gate !== g.gate) {
        this.gate.enter(g.gate, this.posPacket());
        p.inBubble = true;
        this.controls.releaseLock();
        audio.play('bubble');
      }
    }
    if (this.gate.gate != null) {
      const pad = this.tower.plats[this.tower.gates[this.gate.gate].pad];
      const off = Math.abs(p.pos.x - pad.x) > pad.hx + 0.4 || Math.abs(p.pos.z - pad.z) > pad.hz + 0.4 || p.pos.y < pad.top - 1 || p.pos.y > pad.top + 4.5;
      if (off) { this.gate.leave(); p.inBubble = false; }
    }

    // checkpoints
    if (p.grounded && g && g.kind === 'deck' && g.cp && !this.me.visited.includes(g.cp) && !this.cpPending) {
      this.cpPending = true;
      const zone = g.cp;
      net.request('checkpoint', { zone }).then((r) => {
        this.cpPending = false;
        if (!r.ok) return;
        this.me.visited = [...this.me.visited, zone];
        audio.play('fanfare');
        banner(`Zone ${zone}: ${ZONES[zone - 1].name}`, `Checkpoint saved · +${r.gift} Jump Tokens${r.catchUp ? ` · +${r.catchUp} catch-up bonus` : ''}`);
        p.spring = false;
        p.glider = false;
        this.shop.show(zone);
        this.shopLatch = true;
        this.controls.releaseLock();
      });
    }

    // merchant
    const cpHere = this.tower.checkpoints.find((c) => Math.abs(p.pos.y - c.y) < 2);
    if (cpHere) {
      const m = this.world.merchants.find((x) => x.zone === cpHere.zone);
      const d = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
      if (d < 3 && !this.shopLatch && !this.shop.open) {
        this.shopLatch = true;
        this.shop.show(Math.max(cpHere.zone, this.me.cpZone));
        this.controls.releaseLock();
      }
      if (d > 4.5 && !this.shop.open) this.shopLatch = false;
    }

    // finish
    if (p.grounded && g && g.kind === 'summit' && !this.finishedSent) {
      this.finishedSent = true;
      net.request('finish', {}).then((r) => {
        if (!r.ok) { this.finishedSent = false; return; }
        banner(r.place === 1 ? '🏆 You reached the top first!' : '🏁 You made it to the top!', `Place: ${r.place}`);
        audio.play('fanfare');
        this.confetti(p.pos);
        p.celebrating = true;
        if (r.place === 1 && this.world.flag) {
          this.world.flag.visible = true;
          this.world.flagCloth.material.color.set(TINT_COLORS[this.myProfile.tint]);
          this.world.flag.position.set(p.pos.x, 0, p.pos.z);
        }
      });
    }

    // off the tower / falling too far
    const r = Math.hypot(p.pos.x, p.pos.z);
    const off = (p.pos.y > 2 && r > OFF_R && !p.grounded) || p.pos.y < -15;
    if (off && !p.launch) {
      if (!p.respawning) { p.respawning = true; this.respawnT = 0; audio.play('fall'); }
    } else if (p.respawning && (r < OFF_R - 0.5 || p.grounded)) {
      p.respawning = false;
      this.respawnT = 0;
    }
    if (p.respawning) {
      this.respawnT += dt;
      $('fade').style.opacity = Math.min(1, this.respawnT / 2);
      if (this.respawnT >= 2) this.respawn();
    } else if (this.respawnT === 0) $('fade').style.opacity = 0;

    // low gravity and oxygen in space
    const inSpace = p.pos.y > ZONE_H * 9 + 0.5 && this.tower.finishY > ZONE_H * 9;
    p.gravMult = p.pos.y > ZONE_H * 9 - 0.5 && this.tower.finishY > ZONE_H * 9 ? 0.4 : 1;
    if (inSpace && !this.me.finished) {
      const cap = this.oxyCap();
      const inDome = (p.grounded && g && (g.kind === 'dome' || g.kind === 'deck' || g.kind === 'pad' || g.kind === 'summit')) || p.inBubble || this.nearDome(p.pos);
      if (inDome) this.oxygen = Math.min(cap, this.oxygen + (cap / 2) * dt);
      else this.oxygen -= dt;
      if (this.oxygen < 15 && !inDome && performance.now() - this.lastBeep > 1000) { this.lastBeep = performance.now(); audio.play('beep'); }
      if (this.oxygen <= 0 && !p.launch) {
        const back = this.lastDome(p.pos.y);
        toast('Out of air! A bubble floats you back to the last dome.');
        p.startLaunch(back, 2.2, 1.5);
        this.oxygen = cap;
      }
    } else this.oxygen = this.oxyCap();

    // light bumping between players
    if (!p.launch) {
      for (const o of this.remotes.values()) {
        if (!o.model.root.visible || (o.flags & FLAG.respawn)) continue;
        const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.65 && Math.abs(p.pos.y - o.pos.y) < 0.9) {
          const k = (0.65 - d) * Math.min(1, dt * 10);
          const ux = d > 0.001 ? dx / d : (this.pid < o.id ? 1 : -1);
          const uz = d > 0.001 ? dz / d : 0;
          p.pos.x += ux * k;
          p.pos.z += uz * k;
        }
      }
    }
  }

  nearDome(pos) {
    for (const q of this.world.query(pos.y)) {
      if (q.kind === 'dome' && Math.hypot(pos.x - q.x, pos.z - q.z) < 2.6 && pos.y - q.top < 2.6 && pos.y >= q.top - 0.5) return true;
    }
    return false;
  }

  lastDome(y) {
    let best = null;
    for (const q of this.tower.plats) {
      if ((q.kind === 'dome' || (q.kind === 'deck' && q.cp === 10)) && q.top <= y + 0.5 && (!best || q.top > best.top)) best = q;
    }
    if (!best) return new THREE.Vector3(this.tower.checkpoints.at(-1).spawn.x, this.tower.checkpoints.at(-1).y + 0.05, this.tower.checkpoints.at(-1).spawn.z);
    if (best.kind === 'deck') { const c = this.tower.checkpoints.find((x) => x.zone === 10); return new THREE.Vector3(c.spawn.x, c.y + 0.05, c.spawn.z); }
    return new THREE.Vector3(best.x, best.top + 0.05, best.z);
  }

  handleActions(actions) {
    let jump = false;
    for (const a of actions) {
      if (a === 'jump') { if (!this.shop.open) jump = true; }
      else if (a === 'use') { if (!this.gate.open && !this.shop.open) this.useItem(this.hud.selected); }
      else if (a === 'rewind') this.doRewind();
      else if (a === 'board') this.toggle('board-panel');
      else if (a === 'esc') {
        for (const id of ['board-panel', 'settings-panel', 'teacher-panel']) $(id).hidden = true;
        this.shop.close();
        $('emote-wheel').hidden = true;
      } else if (a === 'emote') {
        $('emote-wheel').hidden = !$('emote-wheel').hidden;
        this.emoteArmed = $('emote-wheel').hidden ? 0 : performance.now() + 3000;
      } else if (a.startsWith('num')) {
        const i = Number(a.slice(3)) - 1;
        if (this.gate.open) this.gate.answerIndex(i);
        else if (this.emoteArmed && performance.now() < this.emoteArmed) this.emote(i + 1);
        else this.hud.selected = i;
      }
    }
    if (this.emoteArmed && performance.now() > this.emoteArmed) { this.emoteArmed = 0; $('emote-wheel').hidden = true; }
    return jump;
  }

  // ---------------------------------------------------------------- main frame
  frame() {
    const now = performance.now();
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.last = now;
    if (!this.running) return;

    // auto quality
    // (frames longer than 0.2 s mean the tab was throttled or hidden, not that the device is slow)
    if (prefs.quality === 'auto' && !document.hidden && rawDt < 0.2) {
      this.fps.frames++;
      this.fps.t += dt;
      if (this.fps.t > 3) {
        const f = this.fps.frames / this.fps.t;
        if (f < 30 && this.quality !== 'low') this.setQuality('low');
        this.fps.frames = 0;
        this.fps.t = 0;
      }
    }

    const t = this.gameTime();
    this.countdown(t);
    const { actions, look, zoom } = this.controls.take();
    const jumpPressed = this.handleActions(actions);
    const sens = 0.0032 * prefs.sens;
    const kl = this.controls.keyLook();
    // Up arrow looks up (camera drops lower); Invert flips it, same as mouse
    const inv = prefs.invert ? -1 : 1;
    this.cam.yaw -= look.x * sens + kl.x * 2.2 * prefs.sens * dt;
    this.cam.pitch = Math.max(-0.5, Math.min(1.25, this.cam.pitch + look.y * sens * inv - kl.y * 1.4 * prefs.sens * dt * inv));
    this.cam.dist = Math.max(3, Math.min(this.spectator ? 40 : 14, this.cam.dist + zoom * 0.8 + kl.z * 10 * dt));

    const p = this.player;
    const live = t >= 0 && !this.paused();
    // Physics runs at a fixed 60 steps/s, so on fast displays (120/144 Hz) many frames run no step at all.
    // Keep a press waiting until a physics step actually uses it, instead of dropping it with the frame.
    if (jumpPressed) this.pendingJumpAt = now;
    if (!live || (this.pendingJumpAt && now - this.pendingJumpAt > 250)) this.pendingJumpAt = 0;
    if (p && live) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        const stepT = t - this.acc + STEP;
        this.world.step(stepT, STEP);
        p.step(STEP, {
          move: this.controls.move(),
          jumpPressed: !!this.pendingJumpAt,
          jumpHeld: this.controls.jumpHeld,
          locked: this.shop.open || p.respawning,
        }, this.cam.yaw);
        this.pendingJumpAt = 0;
        this.acc -= STEP;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      this.gameRules(dt);
      // follow camera: while running forwards and not steering the camera, swing it gently behind the player
      if (now - this.controls.lastCamInput > 1200) {
        const sp = Math.hypot(p.vel.x, p.vel.z);
        if (sp > 1 && this.controls.move().y > 0.5) {
          let d = p.yaw + Math.PI - this.cam.yaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          this.cam.yaw += d * Math.min(1, dt * 1.5);
        }
      }
    } else if (live) {
      this.world.step(t, dt);
    }

    // focus target
    let focus;
    if (p) focus = p.pos;
    else {
      const id = this.follow || this.standings[0]?.id;
      const r = id ? this.remotes.get(id) : null;
      focus = r && r.model.root.visible ? r.pos : new THREE.Vector3(0, 2, 0);
      if (!this.controls.dragging && now - this.controls.lastCamInput > 3000) this.cam.yaw += dt * 0.15;
    }

    this.hazards.update(Math.max(0, t), dt, p && live ? p : null, focus);
    this.world.update(Math.max(0, t), dt, this.camera.position, focus.y);
    this.updateRemotes(dt);
    this.updateFx(dt);
    for (const f of this.fx) f.update?.(dt);
    if (p) {
      p.updateVisual(dt);
      if (this.myEmoteSprite) {
        this.myEmoteSprite.position.set(p.pos.x, p.pos.y + 2.1, p.pos.z);
        this.myEmoteT -= dt;
        if (this.myEmoteT <= 0) { this.myEmoteSprite.removeFromParent(); this.myEmoteSprite = null; }
      }
      this.updateShadow(p);
    }

    this.updateCamera(dt, focus);
    audio.setZone(zoneAt(Math.max(0, focus.y)));
    this.hemi.intensity = focus.y > 8 * ZONE_H ? 1.2 : 1.5;

    if (p) {
      const cpZone = zoneAt(p.pos.y);
      this.hud.update({
        y: p.pos.y, tokens: this.me.tokens, slots: this.me.slots, jet: p.jet,
        oxy: p.pos.y > ZONE_H * 9 + 0.5 && this.tower.finishY > ZONE_H * 9 ? { value: Math.max(0, this.oxygen), cap: this.oxyCap() } : null,
        spring: p.spring, snack: p.snackUntil - p.time, glider: p.glider, shield: this.me.shield,
        immune: p.immuneUntil - p.time, canRewind: p.canRewind() && this.me.slots.some((s) => s.type === 'rewind'),
        prompt: this.prompt(p, cpZone),
      });
      const live2 = this.standings.map((s) => {
        if (s.id === this.pid) return { ...s, y: p.pos.y };
        const r = this.remotes.get(s.id);
        return r && r.model.root.visible ? { ...s, y: r.pos.y } : s;
      });
      this.hud.updateDots(live2, this.pid);
      this.arrows(p);
      if (now - this.lastSend > 1000 / 15 && t >= 0) {
        this.lastSend = now;
        net.emit('pos', this.posPacket());
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  prompt(p, zone) {
    if (this.paused()) return '';
    if (p.respawning) return this.me.slots.some((s) => s.type === 'rewind') ? 'Falling! Press R / ⏪ to Rewind' : 'Oops! Going back to your checkpoint…';
    if (this.gate.open) return '';
    if (this.me.finished) return '🏁 You finished! Cheer on your classmates (T for emotes).';
    return '';
  }

  arrows(p) {
    const [a1, a2] = this.world.arrows;
    a1.visible = a2.visible = false;
    const t = performance.now() / 1000;
    const cp = this.tower.checkpoints.find((c) => Math.abs(p.pos.y - c.y) < 3);
    if (cp) {
      const m = this.world.merchants.find((x) => x.zone === cp.zone);
      if (m && m.pos.distanceTo(p.pos) < 25 && !this.shop.open) {
        a1.visible = true;
        a1.position.set(m.pos.x, m.pos.y + 4 + Math.sin(t * 3) * 0.3, m.pos.z);
        a1.rotation.y = t;
      }
    }
    const next = this.tower.gates.find((g) => !this.passable(g.i));
    if (next) {
      const pad = this.tower.plats[next.pad];
      const d = Math.hypot(p.pos.x - pad.x, p.pos.y - pad.top, p.pos.z - pad.z);
      if (d < 22 && !this.gate.open) {
        a2.visible = true;
        a2.position.set(pad.x, pad.top + 5 + Math.sin(t * 3) * 0.3, pad.z);
        a2.rotation.y = t;
      }
    }
  }

  updateShadow(p) {
    if (!this.shadow) {
      const tex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d');
        const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(0,0,0,0.55)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      this.shadow.rotation.x = -Math.PI / 2;
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 28), new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      this.ring.rotation.x = -Math.PI / 2;
    }
    if (!this.bubble) {
      this.bubble = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 14), new THREE.MeshBasicMaterial({ color: '#9be7ff', transparent: true, opacity: 0.28, depthWrite: false }));
    }
    if (this.shadow.parent !== this.scene) this.scene.add(this.shadow, this.ring, this.bubble);
    this.bubble.visible = p.inBubble || !!this.me.shield;
    this.bubble.material.color.set(p.inBubble ? '#9be7ff' : '#c4a7ff');
    this.bubble.position.set(p.pos.x, p.pos.y + 0.5, p.pos.z);
    this.bubble.scale.setScalar(1 + Math.sin(performance.now() / 300) * 0.03);
    const gnd = this.world.groundBelow(p.pos.x, p.pos.y + 0.05, p.pos.z);
    this.shadow.visible = !!gnd;
    if (gnd) {
      this.shadow.position.set(p.pos.x, gnd.ctop + 0.04, p.pos.z);
      const h = p.pos.y - gnd.ctop;
      this.shadow.scale.setScalar(Math.max(0.4, 1 - h * 0.05));
    }
    this.ring.visible = false;
    if (!p.grounded && !p.launch) {
      const land = this.world.predictLanding(p.pos, new THREE.Vector3(p.vel.x + p.push.x, p.vel.y, p.vel.z + p.push.z), PHYS.g * p.gravMult);
      if (land) {
        this.ring.visible = true;
        this.ring.position.set(land.x, land.y + 0.06, land.z);
      }
    }
  }

  updateCamera(dt, focus) {
    const c = this.cam;
    const f = new THREE.Vector3(focus.x, focus.y + 1.2, focus.z);
    const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist);
    const desired = f.clone().add(off);
    const frac = this.world.rayFraction(f, desired);
    const target = f.clone().add(off.multiplyScalar(frac));
    this.camera.position.copy(target);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.camera.position.x += (Math.random() - 0.5) * this.shakeT;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeT;
    }
    this.camera.lookAt(f.x, f.y + 0.9, f.z);
  }

  countdown(t) {
    const el = $('countdown');
    if (t < 0 && t > -4.5) {
      const n = Math.ceil(-t);
      const label = n > 3 ? '' : String(n);
      if (label !== this.countdownShown) {
        this.countdownShown = label;
        el.hidden = !label;
        el.innerHTML = `<span>${label}</span>`;
        if (label) audio.play('countdown');
      }
    } else if (t >= 0 && t < 1) {
      if (this.countdownShown !== 'GO') {
        this.countdownShown = 'GO';
        el.hidden = false;
        el.innerHTML = '<span>GO!</span>';
        audio.play('go');
      }
    } else if (!el.hidden) el.hidden = true;
  }
}

// ---------------------------------------------------------------- boot
applyBodyPrefs();
const game = new Game();
const ui = new UI(game);
ui.boot();
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.mgu = { game, ui, net };
