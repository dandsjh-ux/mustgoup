// Menus and lobby screens: home, host lobby, join, character select, waiting room, results.
/* global Papa */
import * as THREE from 'three';
import { net } from './net.js';
import { store } from './prefs.js';
import { audio } from './audio.js';
import { ANIMALS, HATS, TRAILS, TINT_COLORS, TINT_NAMES } from './shared/items.js';
import { SETTING_FIELDS, DEFAULT_SETTINGS } from './shared/settings.js';
import { validateRows } from './shared/csv.js';
import { ZONES } from './shared/tower.js';
import { AnimalModel, ANIM } from './animals.js';
import { toast, fmtTime, animalEmoji } from './hud.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

// Small three.js renderer for the character preview and the results podium
class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a7aa0', 1.6));
    const d = new THREE.DirectionalLight('#ffffff', 1.4);
    d.position.set(2, 4, 3);
    this.scene.add(d);
    this.camera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 50);
    this.models = [];
    this.running = false;
    this.last = 0;
  }

  set(models, camPos, look) {
    for (const m of this.models) m.root.removeFromParent();
    this.models = models;
    for (const m of models) this.scene.add(m.root);
    this.camera.position.copy(camPos);
    this.camera.lookAt(look);
  }

  start(spin = true) {
    this.spin = spin;
    if (this.running) return;
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016);
      this.last = t;
      for (const m of this.models) {
        if (this.spin) m.root.rotation.y += dt * 0.8;
        m.update(dt, 0, {});
      }
      this.extra?.(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }
}

export class UI {
  constructor(game) {
    this.game = game;
    this.role = null; // 'host' | 'player'
    this.code = null;
    this.lobby = null;
    this.profile = store.get('mgu.profile', { animal: 'bunny', tint: 0, hat: 'none', trail: 'none' });
    this.name = '';
    this.hostPid = null;
    this.pendingStart = null;
    this.bind();
    this.buildCharSelect();
    this.buildSettingsForm();
  }

  bind() {
    $('btn-host').addEventListener('click', () => { audio.unlock(); this.createRoom(); });
    $('btn-join').addEventListener('click', () => { audio.unlock(); showScreen('s-join'); $('join-code').focus(); });
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.go)));
    $('join-form').addEventListener('submit', (e) => { e.preventDefault(); audio.unlock(); this.join(); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === t.dataset.tab));
    }));
    // CSV
    const drop = $('drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) this.loadCsv(f);
    });
    $('csv-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.loadCsv(f); e.target.value = ''; });
    $('btn-sample').addEventListener('click', () => this.useSample());
    $('btn-start').addEventListener('click', () => this.startGame());
    $('btn-host-char').addEventListener('click', () => this.openCharSelect('host'));
    $('btn-char-done').addEventListener('click', () => this.charDone());
    $('btn-change-char').addEventListener('click', () => this.openCharSelect('player'));
    $('btn-again').addEventListener('click', () => net.emit('host:lobby'));
    $('btn-results-csv').addEventListener('click', () => this.downloadResults());

    net.on('lobby', (l) => this.onLobby(l));
    net.on('profile:ok', (p) => { this.profile = p; this.refreshChar(); });
    net.on('start', (p) => this.onStart(p));
    net.on('results', (r) => this.onResults(r));
    net.on('results:host', (h) => { this.hostResults = h; this.renderHostResults(); });
    net.on('tolobby', () => this.onToLobby());
    net.on('kicked', () => {
      this.forgetSeat();
      this.game.stop();
      this.role = null;
      showScreen('s-home');
      toast('You were removed from the game by the teacher.', 'bad');
    });
    net.on('replaced', () => {
      this.game.stop();
      this.role = null;
      showScreen('s-home');
      toast('You opened this game somewhere else, so this tab was closed.', 'bad');
    });
    net.socket.on('connect', () => this.onReconnect());
  }

  // ------------------------------------------------------------- session restore
  async boot() {
    const params = new URLSearchParams(location.search);
    const room = (params.get('room') || '').toUpperCase();
    const hostSess = store.get('mgu.host');
    // This tab's own seat first (survives a refresh); the device-wide copy is only a fallback,
    // and the server refuses it if that seat is still live in another tab.
    let playerSess = null;
    try { playerSess = JSON.parse(sessionStorage.getItem('mgu.player') || 'null'); } catch { /* ignore */ }
    if (!playerSess) { playerSess = store.get('mgu.player'); if (playerSess) playerSess.fallback = true; }
    if (hostSess && Date.now() - hostSess.at < 3 * 3600e3 && !room) {
      if (await this.resumeHost(hostSess)) return;
    }
    if (playerSess && Date.now() - playerSess.at < 3 * 3600e3 && (!room || room === playerSess.code)) {
      if (await this.rejoin(playerSess)) return;
    }
    if (room) {
      $('join-code').value = room;
      showScreen('s-join');
      $('join-name').focus();
    }
  }

  async onReconnect() {
    if (!this.everConnected) { this.everConnected = true; return; }
    if (this.role === 'host') {
      const s = store.get('mgu.host');
      if (s) await this.resumeHost(s, true);
    } else if (this.role === 'player') {
      const s = this.seat;
      if (s) await this.rejoin(s, true);
    }
  }

  async resumeHost(s, quiet = false) {
    await this.connected();
    const r = await net.request('host:resume', { code: s.code, hostSecret: s.hostSecret });
    if (r.error) { store.del('mgu.host'); return false; }
    this.role = 'host';
    this.code = r.code;
    this.hostPid = r.hostPid;
    this.onLobby(r.lobby);
    if (quiet) return true;
    if (r.start) this.onStart(r.start);
    else if (r.results) { this.onResults(r.results); }
    else this.showHostLobby();
    return true;
  }

  async rejoin(s, quiet = false) {
    await this.connected();
    const r = await net.request('join', { code: s.code, pid: s.pid, secret: s.secret, fallback: !!s.fallback });
    if (r.error || !r.rejoined) { if (!quiet && !s.fallback) this.forgetSeat(); return false; }
    this.saveSeat({ code: s.code, pid: s.pid, secret: s.secret, at: Date.now() });
    this.role = 'player';
    this.code = s.code;
    this.pid = r.pid;
    this.name = r.name;
    this.profile = r.profile;
    this.onLobby(r.lobby);
    if (quiet) return true;
    if (r.start) this.onStart(r.start);
    else if (r.results) this.onResults(r.results);
    else this.showWait();
    return true;
  }

  saveSeat(seat) {
    this.seat = seat;
    try { sessionStorage.setItem('mgu.player', JSON.stringify(seat)); } catch { /* ignore */ }
    store.set('mgu.player', seat);
  }

  forgetSeat() {
    this.seat = null;
    try { sessionStorage.removeItem('mgu.player'); } catch { /* ignore */ }
    store.del('mgu.player');
  }

  connected() {
    return new Promise((res) => {
      if (net.socket.connected) return res();
      net.socket.once('connect', () => res());
    });
  }

  // ------------------------------------------------------------- host
  async createRoom() {
    await this.connected();
    const r = await net.request('host:create', {});
    if (r.error) return toast(r.error, 'bad');
    this.role = 'host';
    this.code = r.code;
    store.set('mgu.host', { code: r.code, hostSecret: r.hostSecret, at: Date.now() });
    this.onLobby(r.lobby);
    this.showHostLobby();
    const last = store.get('mgu.bank');
    if (last?.rows?.length) {
      const res = await net.request('host:bank', { rows: last.rows, name: last.name });
      if (res.ok) {
        this.renderReport(res.report, `Loaded your last question bank: ${last.name}`);
      }
    } else this.renderReport(null);
  }

  showHostLobby() {
    showScreen('s-host');
    const url = `${location.origin}/?room=${this.code}`;
    $('room-code').textContent = this.code;
    $('join-host').textContent = location.host;
    $('join-link').textContent = url;
    $('join-link').href = url;
    $('qr').src = `/qr.svg?text=${encodeURIComponent(url)}`;
  }

  buildSettingsForm() {
    const form = $('settings-form');
    form.innerHTML = '';
    for (const f of SETTING_FIELDS) {
      const l = document.createElement('label');
      l.textContent = f.label;
      const s = document.createElement('select');
      s.name = f.key;
      for (const [v, t] of f.options) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = t;
        s.appendChild(o);
      }
      s.addEventListener('change', () => this.sendSettings(f.key, s.value));
      l.appendChild(s);
      form.appendChild(l);
    }
  }

  sendSettings(key, value) {
    const cur = { ...(this.lobby?.settings || DEFAULT_SETTINGS) };
    cur[key] = value;
    if (key === 'mode') {
      if (value === 'timed' && Number(cur.timer) === 0) cur.timer = 20;
      if (value === 'race' && Number(cur.timer) === 20) cur.timer = 0;
    }
    net.emit('host:settings', cur);
  }

  renderSettings(s) {
    const form = $('settings-form');
    for (const f of SETTING_FIELDS) {
      const el = form.elements[f.key];
      if (el && document.activeElement !== el) el.value = String(s[f.key]);
    }
    $('host-profile-box').hidden = s.hostRole !== 'play';
  }

  loadCsv(file) {
    if (!window.Papa) return toast('The CSV reader is still loading — try again in a moment.', 'bad');
    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      encoding: 'UTF-8',
      complete: async (res) => {
        const rows = res.data.slice(0, 600);
        const local = validateRows(rows);
        this.renderReport(local, `Checking ${file.name}…`);
        if (!local.usable) return;
        const r = await net.request('host:bank', { rows, name: file.name });
        if (r.error) return this.renderReport(r.report, r.error);
        store.set('mgu.bank', { name: file.name, rows });
        this.renderReport(r.report, `Loaded ${file.name}`);
      },
      error: () => toast('Could not read that file.', 'bad'),
    });
  }

  async useSample() {
    const r = await net.request('host:bank', { sample: true });
    if (r.error) return toast(r.error, 'bad');
    store.del('mgu.bank');
    this.renderReport(r.report, 'Using the built-in sample bank (grammar and vocabulary)');
  }

  renderReport(rep, title) {
    const st = $('bank-status');
    const b = this.lobby?.bank;
    if (!rep) {
      st.innerHTML = b ? `<span class="ok">✔</span> ${esc(b.name)} — <b>${b.usable}</b> usable questions` : '';
      $('bank-report').innerHTML = '';
      $('bank-preview').innerHTML = '';
      return;
    }
    st.innerHTML = `${rep.usable ? '<span class="ok">✔</span>' : '⚠️'} ${esc(title || '')} — <b>${rep.usable}</b> usable questions`;
    let html = '';
    if (rep.skipped?.length) html += `<div class="report"><b>${rep.skipped.length} row(s) skipped</b><br>${rep.skipped.slice(0, 50).map((s) => esc(s.reason)).join('<br>')}</div>`;
    if (rep.warnings?.length) html += `<div class="report warn"><b>Warnings</b> (the game can still start)<br>${rep.warnings.slice(0, 30).map(esc).join('<br>')}</div>`;
    $('bank-report').innerHTML = html;
    if (rep.preview?.length) {
      let t = '<table class="preview-table"><tr><th>Question</th><th>Correct</th><th>Incorrect</th></tr>';
      for (const r of rep.preview) t += `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r.slice(2).join(' · '))}</td></tr>`;
      t += '</table><p class="tiny muted">Preview of the first 10 usable rows.</p>';
      $('bank-preview').innerHTML = t;
    } else $('bank-preview').innerHTML = '';
  }

  async startGame() {
    audio.unlock();
    const r = await net.request('host:start', {});
    if (r.error) toast(r.error, 'bad');
  }

  // ------------------------------------------------------------- lobby state
  onLobby(l) {
    this.lobby = l;
    if (this.role === 'host') {
      this.renderSettings(l.settings);
      const ps = l.players;
      $('player-count').textContent = ps.filter((p) => !p.isHost).length;
      $('host-players').innerHTML = '';
      for (const p of ps) $('host-players').appendChild(this.chip(p, !p.isHost));
      const n = ps.filter((p) => p.connected).length;
      $('btn-start').disabled = l.state !== 'lobby' || n === 0;
      $('start-hint').textContent = l.state !== 'lobby' ? 'Game in progress' : n === 0 ? 'Waiting for players to join…' : `${n} ready to climb!`;
      if (l.bank && !$('bank-status').textContent) this.renderReport(null);
      const hp = ps.find((p) => p.isHost);
      $('host-char-label').textContent = hp ? `${animalEmoji(hp.profile.animal)} ${hp.name}` : 'not chosen yet';
    }
    if (this.role === 'player') {
      $('wait-players').innerHTML = '';
      for (const p of l.players) $('wait-players').appendChild(this.chip(p, false));
    }
  }

  chip(p, kickable) {
    const c = document.createElement('span');
    c.className = 'player-chip' + (p.connected ? '' : ' off');
    c.innerHTML = `<span class="em"></span><span class="nm"></span>`;
    c.querySelector('.em').textContent = animalEmoji(p.profile.animal);
    c.querySelector('.em').style.background = TINT_COLORS[p.profile.tint];
    c.querySelector('.nm').textContent = p.name + (p.isHost ? ' (teacher)' : '');
    if (kickable && this.role === 'host') {
      const k = document.createElement('button');
      k.className = 'icon-btn';
      k.style.cssText = 'width:26px;height:26px;font-size:13px';
      k.textContent = '✖';
      k.title = `Remove ${p.name}`;
      k.addEventListener('click', () => { if (confirm(`Remove ${p.name} from the game?`)) net.emit('host:kick', { id: p.id }); });
      c.appendChild(k);
    }
    return c;
  }

  // ------------------------------------------------------------- join
  async join() {
    const code = $('join-code').value.trim().toUpperCase();
    const name = $('join-name').value.trim();
    $('join-error').textContent = '';
    if (code.length !== 4) { $('join-error').textContent = 'The code has 4 letters.'; return; }
    if (!name) { $('join-error').textContent = 'Please type your first name.'; return; }
    await this.connected();
    const r = await net.request('join', { code, name, profile: this.profile });
    if (r.error) { $('join-error').textContent = r.error; return; }
    this.role = 'player';
    this.code = code;
    this.pid = r.pid;
    this.name = r.name;
    this.profile = r.profile;
    this.saveSeat({ code, pid: r.pid, secret: r.secret, at: Date.now() });
    this.onLobby(r.lobby);
    this.pendingStart = r.start;
    this.openCharSelect('player');
  }

  showWait() {
    showScreen('s-wait');
    $('wait-name').textContent = this.name;
  }

  // ------------------------------------------------------------- character select
  buildCharSelect() {
    const grid = $('animal-grid');
    for (const a of ANIMALS) {
      const b = document.createElement('button');
      b.className = 'animal-card';
      b.dataset.id = a.id;
      b.innerHTML = `<span class="em">${a.emoji}</span>${a.name}`;
      b.addEventListener('click', () => { this.profile.animal = a.id; this.refreshChar(); audio.play('click'); });
      grid.appendChild(b);
    }
    TINT_COLORS.forEach((c, i) => {
      const s = document.createElement('button');
      s.className = 'swatch';
      s.style.background = c;
      s.title = TINT_NAMES[i];
      s.dataset.i = i;
      s.addEventListener('click', () => { this.profile.tint = i; this.refreshChar(); });
      $('tint-row').appendChild(s);
    });
    for (const [row, list, key] of [['hat-row', HATS, 'hat'], ['trail-row', TRAILS, 'trail']]) {
      for (const h of list) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.dataset.id = h.id;
        b.textContent = `${h.icon} ${h.name}`;
        b.addEventListener('click', () => { this.profile[key] = h.id; this.refreshChar(); });
        $(row).appendChild(b);
      }
    }
  }

  openCharSelect(mode) {
    this.charMode = mode;
    showScreen('s-char');
    if (!this.preview) this.preview = new Preview($('char-preview'));
    if (mode === 'host') {
      const hp = this.lobby?.players.find((p) => p.isHost);
      if (hp) this.profile = { ...hp.profile };
      if (!this.hostName) this.hostName = prompt('Your name for the game?', 'Teacher') || 'Teacher';
    }
    this.refreshChar();
    this.preview.start(true);
  }

  refreshChar() {
    document.querySelectorAll('.animal-card').forEach((b) => b.classList.toggle('sel', b.dataset.id === this.profile.animal));
    document.querySelectorAll('#tint-row .swatch').forEach((b) => b.classList.toggle('sel', Number(b.dataset.i) === this.profile.tint));
    document.querySelectorAll('#hat-row .chip').forEach((b) => b.classList.toggle('sel', b.dataset.id === this.profile.hat));
    document.querySelectorAll('#trail-row .chip').forEach((b) => b.classList.toggle('sel', b.dataset.id === this.profile.trail));
    const a = ANIMALS.find((x) => x.id === this.profile.animal);
    $('char-name').textContent = `${this.charMode === 'host' ? this.hostName || '' : this.name} the ${a?.name || ''}`;
    $('char-name').style.color = TINT_COLORS[this.profile.tint];
    if (this.preview) {
      const m = new AnimalModel(this.profile);
      m.root.scale.setScalar(1.5);
      m.root.position.y = -0.95;
      this.preview.set([m], new THREE.Vector3(0, 0.5, 4.8), new THREE.Vector3(0, -0.05, 0));
      if (this.charRot != null) m.root.rotation.y = this.charRot;
    }
  }

  async charDone() {
    audio.unlock();
    store.set('mgu.profile', this.profile);
    this.preview?.stop();
    if (this.charMode === 'host') {
      const r = await net.request('host:profile', { name: this.hostName, profile: this.profile });
      if (r.error) return toast(r.error, 'bad');
      this.hostPid = r.pid;
      this.profile = r.profile;
      if (this.pendingStart) { const s = this.pendingStart; this.pendingStart = null; return this.onStart(s, true); }
      return this.showHostLobby();
    }
    net.emit('profile', this.profile);
    if (this.pendingStart) {
      const s = this.pendingStart;
      this.pendingStart = null;
      return this.onStart(s, true);
    }
    this.showWait();
  }

  // ------------------------------------------------------------- game
  onStart(p, force = false) {
    if (!force && document.getElementById('s-char').classList.contains('active')) {
      // still choosing: start as soon as they press Ready
      this.pendingStart = p;
      return;
    }
    const isHost = this.role === 'host';
    const playing = isHost ? p.settings.hostRole === 'play' && !!this.hostPid : true;
    if (isHost && p.settings.hostRole === 'play' && !this.hostPid) {
      toast('Choose your animal to play — or switch Host role to Spectate.', 'bad');
      this.pendingStart = p;
      this.openCharSelect('host');
      return;
    }
    showScreen('none');
    this.preview?.stop();
    this.game.start(p, { pid: isHost ? this.hostPid : this.pid, spectator: !playing, isHost, code: this.code });
  }

  onToLobby() {
    this.game.stop();
    $('s-results').classList.remove('active');
    if (this.role === 'host') this.showHostLobby();
    else if (this.role === 'player') this.showWait();
  }

  // ------------------------------------------------------------- results
  onResults(res) {
    this.results = res;
    this.game.stop();
    showScreen('s-results');
    const me = this.role === 'host' ? this.hostPid : this.pid;
    const top = res.players[0];
    $('results-title').textContent = top ? `🏆 ${top.name} wins!` : 'Results';
    // teams
    $('team-results').innerHTML = res.teams.length
      ? res.teams.map((t, i) => `<span class="team-card ${i === 0 ? 'win' : ''}">${i === 0 ? '🏆 ' : ''}${esc(t.name)}: ${t.combined} blocks <small>(${t.members.map(esc).join(', ')})</small></span>`).join('')
      : '';
    const teamName = (id) => res.teams.find((t) => t.id === id)?.name || '';
    let html = '<tr><th>#</th><th>Player</th>' + (res.teams.length ? '<th>Team</th>' : '') + '<th>Highest block</th><th>Zone</th><th>Time</th><th>Answered</th><th>Accuracy</th><th>Perfect gates</th></tr>';
    for (const p of res.players) {
      html += `<tr class="${p.id === me ? 'me' : ''}"><td>${p.place}</td><td>${animalEmoji(p.profile.animal)} ${esc(p.name)}</td>${res.teams.length ? `<td>${esc(teamName(p.team))}</td>` : ''}<td>${p.maxY}${p.finished ? ' 🏁' : ''}</td><td>${p.zone} · ${esc(ZONES[p.zone - 1].name)}</td><td>${fmtTime(p.timeMs)}</td><td>${p.answered}</td><td>${p.accuracy}%</td><td>${p.perfect}</td></tr>`;
    }
    $('results-table').innerHTML = html;
    $('btn-again').hidden = this.role !== 'host';
    $('host-results').hidden = this.role !== 'host';
    this.renderHostResults();
    this.podium(res.players.slice(0, 3));
    audio.play('fanfare');
  }

  renderHostResults() {
    const h = this.hostResults;
    if (!h || this.role !== 'host') return;
    let html = `<h3>Class accuracy: ${h.classAccuracy}% <small class="muted">(${h.totalAnswered} answers)</small></h3>`;
    if (h.missed.length) {
      html += '<h3>Most-missed questions</h3><table class="preview-table"><tr><th>Question</th><th>Correct answer</th><th>Times missed</th><th>Most common wrong answer</th></tr>';
      for (const m of h.missed) html += `<tr><td>${esc(m.q)}</td><td>${esc(m.answer)}</td><td>${m.count}</td><td>${esc(m.commonWrong)}</td></tr>`;
      html += '</table>';
    }
    if (h.pushes.some((p) => p.given || p.received)) {
      html += '<h3>Pushes given and received</h3><table class="preview-table"><tr><th>Player</th><th>Given</th><th>Received</th></tr>';
      for (const p of h.pushes) html += `<tr><td>${esc(p.name)}</td><td>${p.given}</td><td>${p.received}</td></tr>`;
      html += '</table>';
    }
    $('host-results').innerHTML = html;
  }

  podium(top3) {
    if (!this.podiumView) this.podiumView = new Preview($('podium'));
    const models = [];
    const blocks = new THREE.Group();
    const heights = [1.2, 0.8, 0.5];
    const xs = [0, -1.6, 1.6];
    top3.forEach((p, i) => {
      const m = new AnimalModel(p.profile);
      m.root.position.set(xs[i], heights[i], 0);
      m.setAnim(ANIM.celebrate);
      models.push(m);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, heights[i], 1.2), new THREE.MeshToonMaterial({ color: ['#ffc23d', '#c9d1db', '#e0a26a'][i] }));
      b.position.set(xs[i], heights[i] / 2, 0);
      blocks.add(b);
    });
    this.podiumView.scene.children.filter((c) => c.userData.podium).forEach((c) => c.removeFromParent());
    blocks.userData.podium = true;
    this.podiumView.scene.add(blocks);
    this.podiumView.set(models, new THREE.Vector3(0, 2.2, 6), new THREE.Vector3(0, 1, 0));
    this.podiumView.start(false);
  }

  downloadResults() {
    const r = this.results;
    if (!r) return;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Place', 'Name', 'Animal', 'Team', 'Highest block', 'Zone reached', 'Finished', 'Time', 'Questions answered', 'Correct', 'Accuracy %', 'Perfect gates'].map(q).join(',')];
    const teamName = (id) => r.teams.find((t) => t.id === id)?.name || '';
    for (const p of r.players) lines.push([p.place, p.name, p.profile.animal, teamName(p.team), p.maxY, p.zone, p.finished ? 'yes' : 'no', fmtTime(p.timeMs), p.answered, p.correct, p.accuracy, p.perfect].map(q).join(','));
    const h = this.hostResults;
    if (h && this.role === 'host') {
      lines.push('', q('Class accuracy %') + ',' + q(h.classAccuracy));
      lines.push('', ['Most-missed question', 'Correct answer', 'Times missed', 'Most common wrong answer'].map(q).join(','));
      for (const m of h.missed) lines.push([m.q, m.answer, m.count, m.commonWrong].map(q).join(','));
      lines.push('', ['Player', 'Pushes given', 'Pushes received'].map(q).join(','));
      for (const p of h.pushes) lines.push([p.name, p.given, p.received].map(q).join(','));
    }
    if (r.teams.length) {
      lines.push('', ['Team', 'Combined height', 'Members'].map(q).join(','));
      for (const t of r.teams) lines.push([t.name, t.combined, t.members.join(' / ')].map(q).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `must-go-up-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
