// Must Go Up — game server.
// Express serves the static client; Socket.io runs rooms. The server is the authority for
// questions/answers, tokens, purchases, cleared gates and item hits.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { buildTower, finishYFor, zoneAt } from './public/js/shared/tower.js';
import { ITEMS, MAX_SLOTS, maxUses, TOKENS, ITEM_RULES, cleanProfile } from './public/js/shared/items.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from './public/js/shared/settings.js';
import { validateRows } from './public/js/shared/csv.js';
import { SAMPLE_ROWS } from './server/sample-bank.js';
import { cleanName, isBlocked } from './server/filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const REJOIN_MS = 2 * 60 * 1000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const TEAM_NAMES = ['Red Rockets', 'Blue Comets', 'Green Geckos', 'Gold Stars', 'Purple Owls'];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6, pingInterval: 10000, pingTimeout: 20000 });

app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  if (!text) return res.status(400).end();
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#1d1b3a', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch {
    res.status(400).end();
  }
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ------------------------------------------------------------------ helpers
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const rid = (n = 8) => crypto.randomBytes(n).toString('base64url');
const randInt = (a, b) => a + crypto.randomInt(b - a + 1);
const r2 = (v) => Math.round(v * 100) / 100;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c) && !isBlocked(c)) return c;
  }
}

function freshGameState() {
  return {
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 0, flags: 0, lastPosAt: 0, maxY: 0,
    tokens: 0, slots: [], kept: { jetpack: false, cleats: false }, oxyBonus: 0,
    cleared: new Set(), cpZone: 1, visited: new Set([1]), deck: [], deckPos: 0,
    cur: null, atGate: null, gateProg: {}, shield: false, immuneUntil: 0, lastPurchase: null,
    finishedAt: 0, place: 0, emote: 0, emoteAt: 0, launchUntil: 0, inGame: false,
    stats: { answered: 0, correct: 0, perfect: 0, given: 0, received: 0 },
  };
}

function makeRoom(socket) {
  const room = {
    code: newCode(), hostSecret: rid(12), hostSocketId: socket.id, hostConnected: true,
    settings: { ...DEFAULT_SETTINGS }, bank: null, bankInfo: null, state: 'lobby',
    players: new Map(), nextPid: 1, lastActive: Date.now(),
    seed: 0, tower: null, finishY: 800, cpY: {}, startAt: 0, pausedMs: 0, paused: false, pausedAt: 0,
    finishCount: 0, miss: new Map(), endTimer: null, results: null,
  };
  setBank(room, SAMPLE_ROWS, 'sample', 'Built-in sample bank');
  rooms.set(room.code, room);
  return room;
}

function setBank(room, rows, source, name) {
  const v = validateRows(rows);
  if (v.usable === 0) return v;
  room.bank = v.questions;
  room.bankInfo = { source, name: String(name || 'questions.csv').slice(0, 80), usable: v.usable, warnings: v.warnings.length, skipped: v.skipped.length };
  return v;
}

const activePlayers = (room) => [...room.players.values()].filter((p) => !p.kicked && !p.gone);
const gamePlayers = (room) => activePlayers(room).filter((p) => p.inGame);

function gameMs(room) {
  const now = Date.now();
  return now - room.startAt - room.pausedMs - (room.paused ? now - room.pausedAt : 0);
}

function lobbyPayload(room) {
  return {
    code: room.code, state: room.state, settings: room.settings, bank: room.bankInfo, hostConnected: room.hostConnected,
    players: activePlayers(room).map((p) => ({ id: p.id, name: p.name, profile: p.profile, connected: p.connected, isHost: p.isHost, team: p.team })),
  };
}
const emitLobby = (room) => io.to(room.code).emit('lobby', lobbyPayload(room));

function clockPayload(room) {
  return { startAt: room.startAt, pausedMs: room.pausedMs, paused: room.paused, pausedAt: room.pausedAt, serverNow: Date.now() };
}

function startPayload(room) {
  return {
    seed: room.seed, settings: room.settings, finishY: room.finishY, ...clockPayload(room),
    players: gamePlayers(room).map((p) => ({ id: p.id, name: p.name, profile: p.profile, team: p.team, isHost: p.isHost })),
    teams: room.teams,
  };
}

function respawnZone(room, p) {
  if (!p.team) return p.cpZone;
  let z = p.cpZone;
  for (const q of room.players.values()) if (q.team === p.team && !q.kicked) z = Math.max(z, q.cpZone);
  return z;
}

function passable(room, p, gate) {
  return p.cleared.has(gate.i) || gate.y <= (room.cpY[respawnZone(room, p)] ?? 0);
}

function firstBlockingGate(room, p) {
  for (const g of room.tower.gates) if (!passable(room, p, g)) return g;
  return null;
}

function sendMe(room, p) {
  if (!p.socketId) return;
  io.to(p.socketId).emit('me', {
    id: p.id, tokens: p.tokens, slots: p.slots, kept: p.kept, oxyBonus: p.oxyBonus, cleared: [...p.cleared],
    cpZone: p.cpZone, respawnZone: respawnZone(room, p), visited: [...p.visited], shield: p.shield, team: p.team,
    finished: !!p.finishedAt, place: p.place,
  });
}

function sendTeam(room, p) {
  for (const q of room.players.values()) if (q === p || (p.team && q.team === p.team)) sendMe(room, q);
}

function ctx(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  room.lastActive = Date.now();
  const p = socket.data.pid ? room.players.get(socket.data.pid) : null;
  return { room, p: p && !p.kicked ? p : null, isHost: socket.data.host === room.code };
}

function uniqueName(room, name, except) {
  const taken = new Set(activePlayers(room).filter((p) => p !== except).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

function uniqueTint(room, profile, except) {
  const used = new Set(activePlayers(room).filter((p) => p !== except && p.profile.animal === profile.animal).map((p) => p.profile.tint));
  if (!used.has(profile.tint)) return profile;
  for (let i = 1; i < 6; i++) {
    const t = (profile.tint + i) % 6;
    if (!used.has(t)) return { ...profile, tint: t };
  }
  return profile;
}

function assignTeams(room) {
  room.teams = [];
  const ps = shuffle(gamePlayers(room));
  const size = room.settings.teamSize;
  for (const p of ps) p.team = 0;
  if (!size || ps.length < 2) return;
  const n = Math.max(2, Math.ceil(ps.length / size));
  for (let t = 1; t <= n; t++) room.teams.push({ id: t, name: TEAM_NAMES[(t - 1) % TEAM_NAMES.length] });
  ps.forEach((p, i) => { p.team = (i % n) + 1; });
}

function smallestTeam(room) {
  if (!room.teams.length) return 0;
  const counts = new Map(room.teams.map((t) => [t.id, 0]));
  for (const p of gamePlayers(room)) if (p.team) counts.set(p.team, (counts.get(p.team) || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

function prepPlayerForGame(room, p) {
  Object.assign(p, freshGameState());
  p.inGame = true;
  p.tokens = TOKENS.start;
  p.deck = shuffle([...room.bank.keys()]);
  const sp = room.tower.checkpoints[0].spawn;
  p.pos = { x: sp.x, y: 0, z: sp.z };
  p.lastPosAt = Date.now();
}

// ------------------------------------------------------------------ questions
function drawQuestion(room, p) {
  if (p.deckPos >= p.deck.length) {
    const last = p.deck[p.deck.length - 1];
    p.deck = shuffle([...room.bank.keys()]);
    if (p.deck.length > 1 && p.deck[0] === last) [p.deck[0], p.deck[1]] = [p.deck[1], p.deck[0]];
    p.deckPos = 0;
  }
  return p.deck[p.deckPos++];
}

function newQuestion(room, p, gate, readyIn) {
  const qi = drawQuestion(room, p);
  const q = room.bank[qi];
  const opts = shuffle([{ text: q.a, ok: true }, ...q.w.map((t) => ({ text: t, ok: false }))]).map((o) => ({ ...o, id: rid(5) }));
  p.cur = { qid: rid(6), gate, qi, opts, correctId: opts.find((o) => o.ok).id, readyAt: Date.now() + readyIn, removed: new Set() };
}

function qPayload(room, p) {
  const c = p.cur;
  const gp = p.gateProg[c.gate] || { correct: 0, wrong: 0 };
  return {
    qid: c.qid, gate: c.gate, text: room.bank[c.qi].q, options: c.opts.map((o) => ({ id: o.id, text: o.text })),
    removed: [...c.removed], progress: gp.correct, needed: room.settings.perGate, readyIn: Math.max(0, c.readyAt - Date.now()),
  };
}

function onPad(room, p, gi) {
  const g = room.tower.gates[gi];
  const pad = room.tower.plats[g.pad];
  return Math.abs(p.pos.y - pad.top) < 3.5 && Math.abs(p.pos.x - pad.x) < pad.hx + 2.5 && Math.abs(p.pos.z - pad.z) < pad.hz + 2.5;
}

// ------------------------------------------------------------------ results
function rankPlayers(room) {
  const list = gamePlayers(room).concat([...room.players.values()].filter((p) => p.gone && p.inGame));
  const race = room.settings.mode === 'race';
  list.sort((a, b) => {
    if (race) {
      if (a.finishedAt && b.finishedAt) return a.place - b.place;
      if (a.finishedAt) return -1;
      if (b.finishedAt) return 1;
    }
    if (b.maxY !== a.maxY) return b.maxY - a.maxY;
    return b.stats.correct - a.stats.correct;
  });
  return list;
}

function standings(room) {
  return rankPlayers(room).map((p, i) => {
    const gp = p.cur ? p.gateProg[p.cur.gate] : null;
    return {
      id: p.id, rank: i + 1, name: p.name, animal: p.profile.animal, tint: p.profile.tint, y: Math.floor(p.pos.y), maxY: Math.floor(p.maxY),
      gates: p.cleared.size, finished: !!p.finishedAt, place: p.place, team: p.team, connected: p.connected && !p.gone,
      atGate: p.atGate != null && p.cur ? { gate: p.atGate, progress: gp ? gp.correct : 0 } : null,
    };
  });
}

function computeResults(room) {
  const ms = Math.max(0, gameMs(room));
  const players = rankPlayers(room).map((p, i) => ({
    place: i + 1, id: p.id, name: p.name, profile: p.profile, team: p.team,
    maxY: Math.floor(p.maxY), zone: zoneAt(p.maxY), finished: !!p.finishedAt, timeMs: p.finishedAt || ms,
    answered: p.stats.answered, correct: p.stats.correct,
    accuracy: p.stats.answered ? Math.round((100 * p.stats.correct) / p.stats.answered) : 0, perfect: p.stats.perfect,
    given: p.stats.given, received: p.stats.received,
  }));
  const teams = room.teams.map((t) => {
    const mem = players.filter((p) => p.team === t.id);
    return { id: t.id, name: t.name, members: mem.map((m) => m.name), combined: mem.reduce((s, m) => s + m.maxY, 0) };
  }).sort((a, b) => b.combined - a.combined);
  const totalA = players.reduce((s, p) => s + p.answered, 0);
  const totalC = players.reduce((s, p) => s + p.correct, 0);
  const missed = [...room.miss.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([qi, m]) => {
      const common = [...m.wrong.entries()].sort((a, b) => b[1] - a[1])[0];
      return { q: room.bank[qi]?.q || '?', answer: room.bank[qi]?.a || '', count: m.count, commonWrong: common ? common[0] : '' };
    });
  return {
    mode: room.settings.mode, durationMs: ms, finishY: room.finishY, teams,
    players: players.map(({ given, received, ...rest }) => rest),
    host: { classAccuracy: totalA ? Math.round((100 * totalC) / totalA) : 0, totalAnswered: totalA, missed, pushes: players.map((p) => ({ name: p.name, given: p.given, received: p.received })) },
  };
}

function endGame(room) {
  if (room.state !== 'playing') return;
  clearTimeout(room.endTimer);
  room.state = 'ended';
  const res = computeResults(room);
  room.results = res;
  const { host, ...pub } = res;
  io.to(room.code).emit('results', pub);
  if (room.hostSocketId) io.to(room.hostSocketId).emit('results:host', host);
}

function maybeRaceOver(room) {
  if (room.settings.mode !== 'race') return;
  const ps = gamePlayers(room).filter((p) => p.connected);
  if (ps.length && ps.every((p) => p.finishedAt)) {
    clearTimeout(room.endTimer);
    room.endTimer = setTimeout(() => endGame(room), 6000);
  }
}

// ------------------------------------------------------------------ items
function canTarget(room, a, t) {
  if (!t || t === a || t.kicked || t.gone || !t.connected || !t.inGame) return 'is not here';
  if (a.team && t.team === a.team) return 'is on your team';
  if (t.finishedAt) return 'has already finished';
  if (t.flags & (8 | 16 | 32)) return 'is in a safe zone';
  if (Date.now() < t.immuneUntil) return 'is still protected';
  if (Math.abs(t.pos.y - a.pos.y) > ITEM_RULES.offenseVertical) return 'is too far away';
  return null;
}

function pushPlayer(room, a, t, dir, kind) {
  if (t.shield) {
    t.shield = false;
    io.to(t.socketId).emit('push', { blocked: true, by: a.name, kind });
    sendMe(room, t);
    return 'blocked';
  }
  const len = Math.hypot(dir[0], dir[1]) || 1;
  io.to(t.socketId).emit('push', { dir: [dir[0] / len, dir[1] / len], dist: 4, up: kind === 'glove' ? 6 : 5, by: a.name, kind });
  t.immuneUntil = Date.now() + ITEM_RULES.immunityMs;
  a.stats.given++;
  t.stats.received++;
  return 'hit';
}

function consume(p, type) {
  const s = p.slots.find((x) => x.type === type);
  if (!s || s.uses <= 0) return false;
  s.uses--;
  if (s.uses <= 0) p.slots = p.slots.filter((x) => x !== s);
  if (p.lastPurchase && p.lastPurchase.id === type) p.lastPurchase = null; // used => no undo
  return true;
}

// ------------------------------------------------------------------ sockets
io.on('connection', (socket) => {
  const ack = (fn) => (typeof fn === 'function' ? fn : () => {});

  socket.on('timesync', (t0, cb) => ack(cb)({ t0, server: Date.now() }));

  // ---------- host
  socket.on('host:create', (_d, cb) => {
    const room = makeRoom(socket);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.host = room.code;
    ack(cb)({ ok: true, code: room.code, hostSecret: room.hostSecret, lobby: lobbyPayload(room) });
  });

  socket.on('host:resume', (d, cb) => {
    const room = rooms.get(String(d?.code || '').toUpperCase());
    if (!room || room.hostSecret !== d?.hostSecret) return ack(cb)({ error: 'Room not found' });
    room.hostSocketId = socket.id;
    room.hostConnected = true;
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.host = room.code;
    const hp = [...room.players.values()].find((p) => p.isHost && !p.kicked);
    if (hp) { hp.socketId = socket.id; hp.connected = true; socket.data.pid = hp.id; }
    ack(cb)({ ok: true, code: room.code, lobby: lobbyPayload(room), start: room.state === 'playing' ? startPayload(room) : null, results: room.state === 'ended' ? room.results : null, hostPid: hp?.id || null });
    if (hp && room.state === 'playing') sendMe(room, hp);
    emitLobby(room);
  });

  socket.on('host:settings', (d) => {
    const { room, isHost } = ctx(socket);
    if (!isHost || room.state !== 'lobby') return;
    const before = room.settings.hostRole;
    room.settings = sanitizeSettings({ ...room.settings, ...(d || {}) });
    if (before === 'play' && room.settings.hostRole === 'spectate') {
      for (const p of room.players.values()) if (p.isHost) { room.players.delete(p.id); socket.data.pid = null; }
    }
    emitLobby(room);
  });

  socket.on('host:bank', (d, cb) => {
    const { room, isHost } = ctx(socket);
    if (!isHost) return ack(cb)({ error: 'Only the host can do that' });
    if (room.state === 'playing') return ack(cb)({ error: 'You cannot change questions during a game' });
    const rows = Array.isArray(d?.rows) ? d.rows.slice(0, 600).map((r) => (Array.isArray(r) ? r.slice(0, 5).map((c) => String(c ?? '').slice(0, 400)) : [])) : [];
    const v = d?.sample ? setBank(room, SAMPLE_ROWS, 'sample', 'Built-in sample bank') : setBank(room, rows, 'csv', d?.name);
    if (v.usable === 0) return ack(cb)({ error: 'No usable questions in that file.', report: { skipped: v.skipped, warnings: v.warnings, usable: 0, preview: [] } });
    ack(cb)({ ok: true, report: { skipped: v.skipped, warnings: v.warnings, usable: v.usable, preview: v.preview } });
    emitLobby(room);
  });

  socket.on('host:profile', (d, cb) => {
    const { room, isHost } = ctx(socket);
    if (!isHost) return ack(cb)({ error: 'Only the host can do that' });
    const name = cleanName(d?.name);
    if (!name) return ack(cb)({ error: 'Please choose a different name.' });
    let hp = [...room.players.values()].find((p) => p.isHost && !p.kicked);
    const profile = cleanProfile(d?.profile);
    if (!hp) {
      hp = { id: 'p' + room.nextPid++, secret: rid(12), isHost: true, connected: true, team: 0, ...freshGameState() };
      room.players.set(hp.id, hp);
    }
    hp.name = uniqueName(room, name, hp);
    hp.profile = uniqueTint(room, profile, hp);
    hp.socketId = socket.id;
    socket.data.pid = hp.id;
    room.settings.hostRole = 'play';
    if (room.state === 'playing' && !hp.inGame) {
      prepPlayerForGame(room, hp);
      hp.team = smallestTeam(room);
      socket.emit('start', startPayload(room));
      io.to(room.code).emit('player:join', { id: hp.id, name: hp.name, profile: hp.profile, team: hp.team });
      sendMe(room, hp);
    }
    ack(cb)({ ok: true, pid: hp.id, profile: hp.profile, name: hp.name });
    emitLobby(room);
  });

  socket.on('host:start', (_d, cb) => {
    const { room, isHost } = ctx(socket);
    if (!isHost) return ack(cb)({ error: 'Only the host can start' });
    if (room.state !== 'lobby') return ack(cb)({ error: 'The game has already started' });
    if (!room.bank?.length) return ack(cb)({ error: 'Load some questions first' });
    const ps = activePlayers(room).filter((p) => p.connected);
    if (!ps.length) return ack(cb)({ error: 'Nobody has joined yet' });
    room.seed = crypto.randomInt(1, 2 ** 31 - 1);
    room.finishY = finishYFor(room.settings.finishZone);
    room.tower = buildTower(room.seed, { gateSpacing: room.settings.gateSpacing, finishY: room.finishY });
    room.cpY = {};
    for (const cp of room.tower.checkpoints) room.cpY[cp.zone] = cp.y;
    room.state = 'playing';
    room.startAt = Date.now() + 4200;
    room.pausedMs = 0;
    room.paused = false;
    room.finishCount = 0;
    room.miss = new Map();
    room.results = null;
    for (const p of [...room.players.values()]) {
      if (p.kicked || p.gone || !p.connected) { room.players.delete(p.id); continue; }
      prepPlayerForGame(room, p);
    }
    assignTeams(room);
    io.to(room.code).emit('start', startPayload(room));
    for (const p of gamePlayers(room)) sendMe(room, p);
    emitLobby(room);
    ack(cb)({ ok: true });
  });

  socket.on('host:pause', (d) => {
    const { room, isHost } = ctx(socket);
    if (!isHost || room.state !== 'playing') return;
    const want = !!d?.paused;
    if (want === room.paused) return;
    if (want) { room.paused = true; room.pausedAt = Date.now(); }
    else { room.pausedMs += Date.now() - room.pausedAt; room.paused = false; }
    io.to(room.code).emit('clock', clockPayload(room));
  });

  socket.on('host:end', () => {
    const { room, isHost } = ctx(socket);
    if (isHost) endGame(room);
  });

  socket.on('host:kick', (d) => {
    const { room, isHost } = ctx(socket);
    if (!isHost) return;
    const p = room.players.get(d?.id);
    if (!p || p.isHost) return;
    p.kicked = true;
    if (p.socketId) {
      io.to(p.socketId).emit('kicked');
      io.sockets.sockets.get(p.socketId)?.leave(room.code);
    }
    io.to(room.code).emit('player:leave', { id: p.id });
    emitLobby(room);
  });

  socket.on('host:offensive', (d) => {
    const { room, isHost } = ctx(socket);
    if (!isHost) return;
    room.settings.offensive = !!d?.on;
    io.to(room.code).emit('settings', { offensive: room.settings.offensive });
  });

  socket.on('host:lobby', () => {
    const { room, isHost } = ctx(socket);
    if (!isHost || room.state === 'lobby') return;
    clearTimeout(room.endTimer);
    room.state = 'lobby';
    for (const p of [...room.players.values()]) {
      if (p.kicked || p.gone) room.players.delete(p.id);
      else { Object.assign(p, freshGameState()); p.team = 0; }
    }
    io.to(room.code).emit('tolobby');
    emitLobby(room);
  });

  // ---------- players
  socket.on('join', (d, cb) => {
    const room = rooms.get(String(d?.code || '').toUpperCase().trim());
    if (!room) return ack(cb)({ error: 'No game with that code. Check the code on the board.' });
    // Rejoin with saved identity
    if (d?.pid && d?.secret) {
      const p = room.players.get(d.pid);
      const live = p && p.connected && p.socketId && p.socketId !== socket.id && io.sockets.sockets.get(p.socketId)?.connected;
      if (p && d.fallback && live) return ack(cb)({ error: 'already playing' });
      if (p && p.secret === d.secret && !p.kicked && !p.gone) {
        if (live) io.sockets.sockets.get(p.socketId)?.emit('replaced');
        p.socketId = socket.id;
        p.connected = true;
        socket.join(room.code);
        socket.data.code = room.code;
        socket.data.pid = p.id;
        ack(cb)({ ok: true, pid: p.id, secret: p.secret, name: p.name, profile: p.profile, lobby: lobbyPayload(room), start: room.state === 'playing' && p.inGame ? startPayload(room) : null, results: room.state === 'ended' ? room.results : null, rejoined: true });
        if (room.state === 'playing' && p.inGame) {
          sendMe(room, p);
          socket.emit('respawn', { reason: 'rejoin' });
        }
        emitLobby(room);
        return;
      }
    }
    if (room.state === 'ended') return ack(cb)({ error: 'This game has finished. Wait for the next one.' });
    if (room.state === 'playing' && !room.settings.lateJoin) return ack(cb)({ error: 'This game has already started.' });
    const count = activePlayers(room).filter((p) => !p.isHost).length;
    if (count >= room.settings.maxPlayers) return ack(cb)({ error: `This game is full (${room.settings.maxPlayers} players).` });
    const name = cleanName(d?.name);
    if (!name) return ack(cb)({ error: 'Please type your first name.' });
    const profile = cleanProfile(d?.profile);
    const p = { id: 'p' + room.nextPid++, secret: rid(12), isHost: false, connected: true, socketId: socket.id, team: 0, ...freshGameState() };
    p.name = uniqueName(room, name);
    p.profile = uniqueTint(room, profile);
    room.players.set(p.id, p);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.pid = p.id;
    let start = null;
    if (room.state === 'playing') {
      prepPlayerForGame(room, p);
      p.team = smallestTeam(room);
      start = startPayload(room);
      socket.to(room.code).emit('player:join', { id: p.id, name: p.name, profile: p.profile, team: p.team });
    }
    ack(cb)({ ok: true, pid: p.id, secret: p.secret, name: p.name, profile: p.profile, lobby: lobbyPayload(room), start });
    if (start) sendMe(room, p);
    emitLobby(room);
  });

  socket.on('profile', (d) => {
    const { room, p } = ctx(socket);
    if (!p || room.state === 'ended') return;
    p.profile = uniqueTint(room, cleanProfile(d), p);
    socket.emit('profile:ok', p.profile);
    if (room.state === 'playing') socket.to(room.code).emit('player:profile', { id: p.id, profile: p.profile });
    emitLobby(room);
  });

  socket.on('pos', (a) => {
    const { room, p } = ctx(socket);
    if (!p || room.state !== 'playing' || !p.inGame || !Array.isArray(a)) return;
    const [x, y, z, ry, anim, flags] = a.map(Number);
    if (![x, y, z, ry].every(Number.isFinite)) return;
    const now = Date.now();
    const dt = Math.max(0.03, (now - p.lastPosAt) / 1000);
    const g = firstBlockingGate(room, p);
    const respawnY = room.cpY[respawnZone(room, p)] ?? 0;
    let bad = false;
    if (g && y > g.y - 0.5) bad = true;
    if (!bad && y > p.maxY + Math.max(6, 40 * dt) && Math.abs(y - respawnY) > 2.5 && !(p.launchUntil > now)) bad = true;
    if (bad) {
      socket.emit('correction', { x: p.pos.x, y: p.pos.y, z: p.pos.z });
      return;
    }
    p.pos = { x, y, z };
    p.ry = ry;
    p.anim = anim | 0;
    p.flags = flags | 0;
    p.lastPosAt = now;
    if (y > p.maxY) p.maxY = Math.min(room.finishY, y);
    if (p.atGate != null && !onPad(room, p, p.atGate)) p.atGate = null;
  });

  socket.on('emote', (n) => {
    const { p } = ctx(socket);
    if (!p) return;
    p.emote = Math.max(1, Math.min(4, n | 0));
    p.emoteAt = Date.now();
  });

  // ---------- gates
  socket.on('gate:enter', (d) => {
    const { room, p } = ctx(socket);
    if (!p || room.state !== 'playing') return;
    const gi = d?.gate | 0;
    const g = room.tower.gates[gi];
    if (!g) return;
    if (passable(room, p, g)) return socket.emit('gate:open', { gate: gi });
    if (!onPad(room, p, gi)) return;
    p.atGate = gi;
    if (!p.cur || !room.bank[p.cur.qi]) newQuestion(room, p, gi, 0);
    p.cur.gate = gi;
    socket.emit('gate:q', qPayload(room, p));
  });

  socket.on('gate:leave', () => {
    const { p } = ctx(socket);
    if (p) p.atGate = null;
  });

  socket.on('gate:answer', (d) => {
    const { room, p } = ctx(socket);
    if (!p || room.state !== 'playing' || room.paused || !p.cur) return;
    const c = p.cur;
    if (d?.qid !== c.qid || p.atGate !== c.gate) return;
    if (Date.now() < c.readyAt - 400) return; // still cooling down
    const opt = c.opts.find((o) => o.id === d.optionId);
    if (!opt || c.removed.has(opt.id)) return;
    const gate = c.gate;
    const gp = (p.gateProg[gate] ||= { correct: 0, wrong: 0 });
    const correct = opt.id === c.correctId;
    p.stats.answered++;
    const res = { qid: c.qid, chosen: opt.id, correctId: c.correctId, correct, needed: room.settings.perGate };
    if (correct) {
      p.stats.correct++;
      gp.correct++;
      res.progress = gp.correct;
      if (gp.correct >= room.settings.perGate) {
        p.cleared.add(gate);
        p.cur = null;
        p.atGate = null;
        p.launchUntil = Date.now() + 4000;
        const perfect = gp.wrong === 0;
        if (perfect) { p.tokens += TOKENS.perfect; p.stats.perfect++; }
        Object.assign(res, { cleared: true, perfect, tokens: p.tokens });
        socket.emit('gate:result', res);
        sendMe(room, p);
        return;
      }
      newQuestion(room, p, gate, 900);
    } else {
      gp.wrong++;
      res.progress = gp.correct;
      const m = room.miss.get(c.qi) || { count: 0, wrong: new Map() };
      m.count++;
      m.wrong.set(opt.text, (m.wrong.get(opt.text) || 0) + 1);
      room.miss.set(c.qi, m);
      p.deck.splice(Math.min(p.deck.length, p.deckPos + randInt(2, 4)), 0, c.qi);
      newQuestion(room, p, gate, 2000 + room.settings.cooldown * 1000);
    }
    res.next = qPayload(room, p);
    socket.emit('gate:result', res);
  });

  socket.on('gate:hint', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!p || !p.cur || d?.qid !== p.cur.qid) return ack(cb)({ error: 'No question' });
    if (!room.settings.hintLens) return ack(cb)({ error: 'Hint Lens is switched off' });
    const left = p.cur.opts.filter((o) => !o.ok && !p.cur.removed.has(o.id));
    if (left.length < 2) return ack(cb)({ error: 'Only two answers left — you can do it!' });
    if (!consume(p, 'hint')) return ack(cb)({ error: 'You have no Hint Lens' });
    const pick = left[crypto.randomInt(left.length)];
    p.cur.removed.add(pick.id);
    ack(cb)({ ok: true, remove: pick.id });
    sendMe(room, p);
  });

  // ---------- checkpoints and finish
  socket.on('checkpoint', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!p || room.state !== 'playing') return ack(cb)({ error: 'not playing' });
    const zone = d?.zone | 0;
    const cp = room.tower.checkpoints.find((c) => c.zone === zone);
    if (!cp || p.visited.has(zone)) return ack(cb)({ ok: false });
    if (p.pos.y < cp.y - 1.5 || p.pos.y > cp.y + 6) return ack(cb)({ ok: false });
    const g = firstBlockingGate(room, p);
    if (g && g.y <= cp.y) return ack(cb)({ ok: false });
    p.visited.add(zone);
    p.cpZone = Math.max(p.cpZone, zone);
    let gift = TOKENS.checkpoint;
    let catchUp = 0;
    const ps = gamePlayers(room).filter((q) => q.connected);
    if (ps.length >= 2) {
      const sorted = [...ps].sort((a, b) => b.maxY - a.maxY);
      if (sorted.indexOf(p) >= Math.ceil(ps.length / 2)) catchUp = TOKENS.catchUp;
    }
    p.tokens += gift + catchUp;
    ack(cb)({ ok: true, gift, catchUp, tokens: p.tokens });
    sendTeam(room, p);
  });

  socket.on('finish', (_d, cb) => {
    const { room, p } = ctx(socket);
    if (!p || room.state !== 'playing' || p.finishedAt) return ack(cb)({ ok: false });
    const last = room.tower.gates[room.tower.gates.length - 1];
    if (!passable(room, p, last) || p.pos.y < room.finishY - 1.5) return ack(cb)({ ok: false });
    p.finishedAt = Math.max(1, gameMs(room));
    p.place = ++room.finishCount;
    ack(cb)({ ok: true, place: p.place });
    io.to(room.code).emit('toast', { text: `${p.name} reached the top! (${ordinal(p.place)})`, kind: 'finish', id: p.id, place: p.place });
    sendMe(room, p);
    maybeRaceOver(room);
  });

  // ---------- shop
  socket.on('shop:buy', (d, cb) => {
    const { room, p } = ctx(socket);
    const fail = (error) => ack(cb)({ error });
    if (!p || room.state !== 'playing') return fail('Not in a game');
    const id = String(d?.item || '');
    const it = ITEMS[id];
    if (!it) return fail('Unknown item');
    if (it.zone > p.cpZone && it.zone > respawnZone(room, p)) return fail('Not sold here yet');
    if (it.offensive && !room.settings.offensive) return fail('Offensive items are switched off');
    if (it.needs && !room.settings[it.needs]) return fail('This item is switched off');
    if (it.requires && !p.kept[it.requires]) return fail('You need a Jetpack first');
    const atDeck = room.tower.checkpoints.some((cp) => Math.abs(p.pos.y - cp.y) < 3);
    if (!atDeck) return fail('The shop is at checkpoints');
    if (p.tokens < it.price) return fail('Not enough Jump Tokens');
    if (it.kept) {
      if (p.kept[id]) return fail('You already have this');
      p.kept[id] = true;
    } else if (it.instant) {
      if (p.oxyBonus >= 180) return fail('Your tanks are full');
      p.oxyBonus += 60;
    } else {
      const s = p.slots.find((x) => x.type === id);
      if (s) {
        if (s.uses + it.uses > maxUses(id)) return fail('You can only carry 2 of these');
        s.uses += it.uses;
      } else {
        if (p.slots.length >= MAX_SLOTS) return fail('Your 4 item slots are full');
        p.slots.push({ type: id, uses: it.uses });
      }
    }
    p.tokens -= it.price;
    p.lastPurchase = { id, at: Date.now() };
    ack(cb)({ ok: true, tokens: p.tokens });
    sendMe(room, p);
  });

  socket.on('shop:undo', (_d, cb) => {
    const { room, p } = ctx(socket);
    if (!p || !p.lastPurchase || Date.now() - p.lastPurchase.at > ITEM_RULES.undoMs) return ack(cb)({ error: 'Too late to undo' });
    const id = p.lastPurchase.id;
    const it = ITEMS[id];
    if (it.kept) p.kept[id] = false;
    else if (it.instant) p.oxyBonus = Math.max(0, p.oxyBonus - 60);
    else {
      const s = p.slots.find((x) => x.type === id);
      if (!s || s.uses < it.uses) return ack(cb)({ error: 'Already used' });
      s.uses -= it.uses;
      if (s.uses <= 0) p.slots = p.slots.filter((x) => x !== s);
    }
    p.tokens += it.price;
    p.lastPurchase = null;
    ack(cb)({ ok: true, tokens: p.tokens, id });
    sendMe(room, p);
  });

  // ---------- items
  socket.on('item:use', (d, cb) => {
    const { room, p } = ctx(socket);
    const fail = (error) => ack(cb)({ error });
    if (!p || room.state !== 'playing' || room.paused) return fail('Not now');
    const type = String(d?.type || '');
    const it = ITEMS[type];
    if (!it || it.kept || it.instant) return fail('Cannot use that');
    const slot = p.slots.find((s) => s.type === type);
    if (!slot) return fail('You do not have that item');
    if (type === 'hint') return fail('Use the Hint Lens at a gate');
    if (type === 'fuel' && !p.kept.jetpack) return fail('You need a Jetpack');

    if (type === 'glove') {
      if (!room.settings.offensive) return fail('Offensive items are switched off');
      const t = room.players.get(d?.target);
      const why = canTarget(room, p, t);
      if (why) return fail(`${t?.name || 'That player'} ${why}`);
      const dist = Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y, t.pos.z - p.pos.z);
      if (dist > ITEM_RULES.gloveRange + 1) return fail('Too far away — get closer');
      consume(p, type);
      const r = pushPlayer(room, p, t, [t.pos.x - p.pos.x, t.pos.z - p.pos.z], 'glove');
      io.to(room.code).emit('fx', { kind: 'glove', from: p.id, to: t.id });
      ack(cb)({ ok: true, result: r, name: t.name });
      return sendMe(room, p);
    }

    if (type === 'gust') {
      if (!room.settings.offensive) return fail('Offensive items are switched off');
      const pt = Array.isArray(d?.point) ? d.point.map(Number) : null;
      if (!pt || pt.length < 3 || !pt.every(Number.isFinite)) return fail('Bad throw');
      if (Math.hypot(pt[0] - p.pos.x, pt[1] - p.pos.y, pt[2] - p.pos.z) > ITEM_RULES.gustThrow + 3) return fail('Too far');
      consume(p, type);
      let hits = 0;
      for (const t of gamePlayers(room)) {
        if (t === p) continue;
        const dist = Math.hypot(t.pos.x - pt[0], t.pos.y - pt[1], t.pos.z - pt[2]);
        if (dist > ITEM_RULES.gustRadius + 0.6) continue;
        if (canTarget(room, p, t)) continue;
        let dx = t.pos.x - pt[0];
        let dz = t.pos.z - pt[2];
        if (Math.hypot(dx, dz) < 0.05) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
        if (pushPlayer(room, p, t, [dx, dz], 'gust') === 'hit') hits++;
      }
      io.to(room.code).emit('fx', { kind: 'gust', from: p.id, point: pt });
      ack(cb)({ ok: true, hits });
      return sendMe(room, p);
    }

    consume(p, type);
    if (type === 'shield') p.shield = true;
    if (type === 'cloud') socket.to(room.code).emit('fx', { kind: 'cloud', from: p.id, point: [p.pos.x, p.pos.y, p.pos.z] });
    ack(cb)({ ok: true, type });
    sendMe(room, p);
  });

  socket.on('shield:used', () => {
    const { room, p } = ctx(socket);
    if (!p) return;
    p.shield = false;
    sendMe(room, p);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    if (room.hostSocketId === socket.id) room.hostConnected = false;
    const p = socket.data.pid ? room.players.get(socket.data.pid) : null;
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.discAt = Date.now();
      p.atGate = null;
      if (room.state === 'lobby' && !p.isHost) {
        // In the lobby a quick refresh should not lose the seat; it is freed after the rejoin window.
      }
      io.to(room.code).emit('player:leave', { id: p.id, temporary: true });
    }
    emitLobby(room);
  });
});

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ------------------------------------------------------------------ ticks
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state !== 'playing' || room.paused) continue;
    const arr = [];
    for (const p of room.players.values()) {
      if (!p.inGame || p.kicked || p.gone || !p.connected) continue;
      arr.push([p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.ry), p.anim, p.flags, now - p.emoteAt < 2500 ? p.emote : 0]);
    }
    io.to(room.code).volatile.emit('snap', { t: now, p: arr });
  }
}, 1000 / 15);

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // Players who dropped and did not come back within 2 minutes lose their seat.
    for (const p of room.players.values()) {
      if (!p.connected && !p.gone && p.discAt && now - p.discAt > REJOIN_MS) {
        p.gone = true;
        if (room.state === 'lobby') room.players.delete(p.id);
        if (room.state === 'playing') maybeRaceOver(room);
        emitLobby(room);
      }
    }
    if (room.state === 'playing') {
      io.to(room.code).emit('standings', { list: standings(room), gameMs: gameMs(room) });
      if (!room.paused && room.settings.timer > 0 && gameMs(room) >= room.settings.timer * 60000) endGame(room);
    }
    const anyone = room.hostConnected || [...room.players.values()].some((p) => p.connected);
    if (!anyone && now - room.lastActive > ROOM_IDLE_MS) {
      clearTimeout(room.endTimer);
      rooms.delete(room.code);
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Must Go Up running on http://localhost:${PORT}`);
});
