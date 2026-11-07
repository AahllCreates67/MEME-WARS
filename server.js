'use strict';
/**
 * MEME WARS - authoritative local multiplayer server.
 * The server owns: rooms, players, match state, scores, the winner and
 * soundboard permission. Browsers only send input (taps / hits / survival time)
 * and the server validates all of it.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

/* ------------------------------------------------------------------ config */
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SOUND_DIR = path.join(PUBLIC_DIR, 'assets', 'sounds');
const SOUND_EXTS = ['.mp3', '.ogg', '.wav', '.m4a'];
const AVATARS = ['😎', '🤡', '👽', '💀', '🐸', '🦆', '🔥', '🤖', '🐱', '🍕', '👻', '🦄'];
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const MAX_ROOMS = 200;
const GRACE_MS = 45000; // time a disconnected player may rejoin
const SOUND_COOLDOWN_MS = 1200;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/* ------------------------------------------------------------ sound catalog */
// Server-side approved list. Clients can only request ids that exist here.
const intl = [
  ['bruh', 'Bruh'],
  ['vine-boom', 'Vine Boom'],
  ['metal-pipe', 'Metal Pipe'],
  ['windows-error', 'Windows Error'],
  ['cartoon-bonk', 'Cartoon Bonk'],
  ['sad-trombone', 'Sad Trombone'],
  ['dramatic-music', 'Dramatic Music'],
  ['troll-laugh', 'Troll Laugh'],
  ['airhorn', 'Airhorn'],
  ['fail-sound', 'Fail Sound'],
  ['victory-fanfare', 'Victory Fanfare'],
];
const custom = [
  ['aayein-baigan', 'Aayein Baigan Aayein? Baigan!'],
  ['elvish-system', 'Elvish Yadav System Phadd Denge!'],
  ['10-rupay-pepsi', '10 Rupay Ki Pepsi Mera Bhai Sexy!'],
  ['baburao-utha-le', 'Baburao Utha Le Re Baba!'],
  ['nana-maut', 'Nana Patekar Maut Ko Chuke Tak Se...'],
  ['nana-jhakaas', 'Nana Patekar Ekdum Jhakaas!'],
  ['o-bhai-maro', 'O Bhai Maro Mujhe O Bhai! Maaro Mujhe, Maaro!'],
  ['modi-meme', 'Narendra Modi Meme', 'Exact audio clip to be supplied by the project owner.'],
  ['aynenea-gatram', 'Aynenea Gatram Lavenena Bojhyam', 'Custom audio to be supplied by the project owner.'],
  [
    'rahul-machine',
    'Rahul Gandhi — Aisa Machine Launga, Yahan Se Aloo Daloonga Aur Yahan Se Sona Niklega',
    'Custom audio to be supplied by the project owner.',
  ],
];
const SOUNDS = [
  ...intl.map(([id, label]) => ({ id, label, tab: 'international', file: id, note: '' })),
  ...custom.map(([id, label, note]) => ({ id, label, tab: 'custom', file: id, note: note || '' })),
];
const SOUND_BY_ID = new Map(SOUNDS.map((s) => [s.id, s]));

function soundInfo(s) {
  let url = null;
  for (const ext of SOUND_EXTS) {
    const full = path.join(SOUND_DIR, s.tab, s.file + ext);
    try {
      if (fs.statSync(full).isFile()) {
        url = `/assets/sounds/${s.tab}/${s.file}${ext}`;
        break;
      }
    } catch (_) { /* not present */ }
  }
  return { id: s.id, label: s.label, tab: s.tab, note: s.note, available: !!url, url };
}

/* --------------------------------------------------------------- mini-games */
const GAMES = {
  reaction: { title: 'Reaction Rush', emoji: '⚡', tip: 'Wait for GREEN, then tap! Tapping early costs you.' },
  dodge: { title: 'Dodge Master', emoji: '🌪️', tip: 'Drag (or use ← →) to dodge. Last as long as you can!' },
  aim: { title: 'Aim Battle', emoji: '🎯', tip: 'Tap the targets before they vanish. Small ones pay more!' },
  smash: { title: 'Button Smash', emoji: '👊', tip: 'Smash the big button for 10 seconds!' },
};
const GAME_KEYS = Object.keys(GAMES);

/* ------------------------------------------------------------------ helpers */
function sanitizeName(raw) {
  let s = typeof raw === 'string' ? raw : '';
  s = s
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = Array.from(s).slice(0, 16).join('').trim();
  return s || 'Player' + (100 + crypto.randomInt(900));
}
function pickAvatar(i) {
  return Number.isInteger(i) && i >= 0 && i < AVATARS.length ? AVATARS[i] : AVATARS[0];
}
function normCode(c) {
  return typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
}
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if ((n.family === 'IPv4' || n.family === 4) && !n.internal) out.push(`http://${n.address}:${PORT}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------- app / socket */
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4, pingInterval: 5000, pingTimeout: 8000 });

app.use(express.static(PUBLIC_DIR));
app.get('/api/info', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ port: PORT, addresses: lanAddresses() });
});
app.get('/api/sounds', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ sounds: SOUNDS.map(soundInfo) });
});

/* -------------------------------------------------------------------- rooms */
const rooms = new Map();

function makeRoom() {
  return {
    code: newCode(), hostId: null, players: new Map(), state: 'lobby',
    game: null, winnerId: null, lastResults: null, rematch: new Set(),
    seq: 0, lastSoundAt: 0, timers: [], live: null, lastGameKey: null,
  };
}
function makePlayer(d) {
  return {
    id: crypto.randomBytes(4).toString('hex'),
    token: crypto.randomBytes(16).toString('hex'),
    name: sanitizeName(d.name), avatar: pickAvatar(d.avatar),
    socketId: null, connected: false, grace: null,
    score: 0, dq: false, inMatch: false, rtt: 80, g: {},
  };
}
function later(room, ms, fn) {
  const t = setTimeout(() => {
    try { fn(); } catch (e) { console.error(e); }
  }, ms);
  room.timers.push(t);
  return t;
}
function clearTimers(room) {
  room.timers.forEach(clearTimeout);
  room.timers = [];
  if (room.live) { clearInterval(room.live); room.live = null; }
}
const connectedPlayers = (room) => [...room.players.values()].filter((p) => p.connected);
const eligible = (room) => [...room.players.values()].filter((p) => p.inMatch && p.connected && !p.dq);

function publicState(room) {
  return {
    code: room.code, state: room.state, hostId: room.hostId, max: MAX_PLAYERS,
    winnerId: room.state === 'results' ? room.winnerId : null,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, connected: p.connected,
      ready: p.id === room.hostId ? true : room.rematch.has(p.id),
    })),
  };
}
const broadcast = (room) => io.to(room.code).emit('room:state', publicState(room));
const notify = (room, text, kind) => io.to(room.code).emit('notice', { text, kind: kind || 'info' });

function ensureHost(room) {
  const h = room.players.get(room.hostId);
  if (h && h.connected) return;
  const next = connectedPlayers(room)[0] || [...room.players.values()][0];
  if (!next) { room.hostId = null; return; }
  if (room.hostId !== next.id) {
    room.hostId = next.id;
    notify(room, `👑 ${next.name} is now the host.`, 'info');
  }
}
function destroyRoom(room) {
  clearTimers(room);
  room.players.forEach((p) => clearTimeout(p.grace));
  rooms.delete(room.code);
}
function attach(socket, room, p) {
  p.socketId = socket.id;
  p.connected = true;
  clearTimeout(p.grace);
  socket.data.code = room.code;
  socket.data.pid = p.id;
  socket.join(room.code);
}
function ctx(socket) {
  const room = rooms.get(socket.data.code);
  const p = room && room.players.get(socket.data.pid);
  if (!room || !p || p.socketId !== socket.id) return {};
  return { room, p };
}
function afterMembershipChange(room) {
  if (room.state === 'countdown' && connectedPlayers(room).length < MIN_PLAYERS) {
    clearTimers(room);
    room.state = 'lobby';
    room.game = null;
    notify(room, 'Match cancelled - not enough players.', 'warn');
    io.to(room.code).emit('match:cancelled');
  } else if (room.state === 'playing' && eligible(room).length <= 1) {
    finishMatch(room);
  }
}
function removePlayer(room, pid, silent) {
  const p = room.players.get(pid);
  if (!p) return;
  clearTimeout(p.grace);
  room.players.delete(pid);
  room.rematch.delete(pid);
  if (!silent) notify(room, `${p.name} left the room.`, 'warn');
  if (room.players.size === 0) { destroyRoom(room); return; }
  ensureHost(room);
  afterMembershipChange(room);
  broadcast(room);
}
function graceExpired(room, pid) {
  if (rooms.get(room.code) !== room) return;
  const p = room.players.get(pid);
  if (!p || p.connected) return;
  if (room.state === 'playing' || room.state === 'countdown') {
    p.grace = setTimeout(() => graceExpired(room, pid), 10000);
    return;
  }
  removePlayer(room, pid);
}
function handleDisconnect(room, p) {
  p.connected = false;
  p.socketId = null;
  if (room.state === 'playing' && p.inMatch) p.dq = true;
  notify(room, `${p.name} disconnected.`, 'warn');
  if (room.hostId === p.id) notify(room, 'Host disconnected.', 'warn');
  ensureHost(room);
  clearTimeout(p.grace);
  p.grace = setTimeout(() => graceExpired(room, p.id), GRACE_MS);
  afterMembershipChange(room);
  broadcast(room);
}

/* -------------------------------------------------------------- match flow */
function startMatch(room) {
  clearTimers(room);
  for (const p of [...room.players.values()]) if (!p.connected) removePlayer(room, p.id, true);
  if (!rooms.has(room.code)) return;
  ensureHost(room);

  const pool = GAME_KEYS.filter((k) => k !== room.lastGameKey);
  const key = pool[crypto.randomInt(pool.length)];
  room.lastGameKey = key;
  room.game = { key, startedAt: 0 };
  room.state = 'countdown';
  room.winnerId = null;
  room.lastResults = null;
  room.rematch.clear();
  io.to(room.code).emit('sound:stop');

  for (const p of room.players.values()) {
    p.score = 0; p.dq = false; p.inMatch = true; p.g = {}; p.rtt = 80;
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) { // server-measured round trip, used to even out reaction timing
      const t0 = Date.now();
      sock.timeout(2000).emit('srv:ping', (err) => { if (!err) p.rtt = Math.min(400, Date.now() - t0); });
    }
  }
  broadcast(room);
  const meta = { key, title: GAMES[key].title, emoji: GAMES[key].emoji, tip: GAMES[key].tip };
  [3, 2, 1].forEach((n, i) => later(room, i * 1000, () => io.to(room.code).emit('match:countdown', { n })));
  later(room, 3000, () => io.to(room.code).emit('match:countdown', { n: 0, game: meta }));
  later(room, 5200, () => beginGame(room));
}

function genTargets() {
  const targets = [];
  let t = 800;
  for (let i = 0; t < 13800; i++) {
    const big = Math.random() < 0.6;
    targets.push({
      i, x: 0.1 + Math.random() * 0.8, y: 0.12 + Math.random() * 0.76,
      at: Math.round(t), life: big ? 1400 : 1000, r: big ? 0.085 : 0.055, pts: big ? 10 : 25,
    });
    t += 380 + Math.random() * 220;
  }
  return targets;
}

function beginGame(room) {
  if (room.state !== 'countdown') return;
  for (const p of room.players.values()) if (!p.connected) p.inMatch = false;
  if (eligible(room).length < MIN_PLAYERS) {
    room.state = 'lobby';
    notify(room, 'Match cancelled - not enough players.', 'warn');
    io.to(room.code).emit('match:cancelled');
    broadcast(room);
    return;
  }
  const g = room.game;
  room.state = 'playing';
  g.startedAt = Date.now();
  const code = room.code;
  const liveTick = () => {
    room.live = setInterval(() => {
      io.to(code).emit('live:scores', {
        scores: [...room.players.values()].filter((p) => p.inMatch).map((p) => ({ id: p.id, score: p.score })),
      });
    }, 500);
  };

  switch (g.key) {
    case 'reaction': {
      g.goAt = 0;
      io.to(code).emit('match:begin', { game: 'reaction' });
      later(room, 2000 + Math.random() * 3500, () => {
        g.goAt = Date.now();
        io.to(code).emit('react:go');
        later(room, 3500, () => finishMatch(room));
      });
      break;
    }
    case 'dodge': {
      g.maxMs = 30000;
      io.to(code).emit('match:begin', { game: 'dodge', seed: crypto.randomInt(1, 2 ** 31), maxMs: g.maxMs });
      later(room, g.maxMs + 2500, () => finishMatch(room));
      break;
    }
    case 'aim': {
      g.duration = 15000;
      g.targets = genTargets();
      io.to(code).emit('match:begin', { game: 'aim', duration: g.duration, targets: g.targets });
      liveTick();
      later(room, g.duration + 1500, () => finishMatch(room));
      break;
    }
    case 'smash': {
      g.duration = 10000;
      io.to(code).emit('match:begin', { game: 'smash', duration: g.duration });
      liveTick();
      later(room, g.duration + 1200, () => finishMatch(room));
      break;
    }
  }
  broadcast(room);
}

function checkDone(room) {
  const g = room.game;
  if (!g || room.state !== 'playing') return;
  const act = eligible(room);
  if (g.key === 'reaction' && act.every((p) => p.g.done)) later(room, 600, () => finishMatch(room));
  if (g.key === 'dodge' && act.every((p) => p.g.submitted)) later(room, 600, () => finishMatch(room));
}

function scoreLabel(room, p) {
  switch (room.game.key) {
    case 'reaction':
      if (!p.g.done) return 'No tap';
      return `${p.g.ms} ms` + (p.g.penalties ? ` (+${p.g.penalties} early)` : '');
    case 'dodge': return p.g.submitted ? `${(p.score / 1000).toFixed(2)} s` : '—';
    case 'aim': return `${p.score} pts`;
    default: return `${p.score} taps`;
  }
}

function finishMatch(room) {
  if (room.state !== 'playing') return;
  clearTimers(room);
  const key = room.game.key;
  const list = [...room.players.values()].filter((p) => p.inMatch);
  list.forEach((p) => { p.score = Number.isFinite(p.score) ? Math.max(0, Math.floor(p.score)) : 0; });
  const elig = list.filter((p) => p.connected && !p.dq);

  let winner = null, tie = false, tiedIds = [];
  const forfeit = elig.length === 1 && list.length > 1;
  if (elig.length) {
    const top = Math.max(...elig.map((p) => p.score));
    const tops = elig.filter((p) => p.score === top);
    if (tops.length > 1) { tie = true; tiedIds = tops.map((p) => p.id); winner = tops[crypto.randomInt(tops.length)]; }
    else winner = tops[0];
  }
  const scores = list
    .map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, label: scoreLabel(room, p),
      dq: !(p.connected && !p.dq), connected: p.connected,
    }))
    .sort((a, b) => (a.dq - b.dq) || (b.score - a.score));

  room.state = 'results';
  room.winnerId = winner ? winner.id : null;
  room.rematch.clear();
  room.lastResults = {
    game: { key, title: GAMES[key].title, emoji: GAMES[key].emoji },
    winnerId: room.winnerId, winnerName: winner ? winner.name : null,
    winnerAvatar: winner ? winner.avatar : null, tie, tiedIds, forfeit, scores,
  };
  io.to(room.code).emit('match:results', room.lastResults);
  broadcast(room);
}

function resetToLobby(room) {
  clearTimers(room);
  room.state = 'lobby';
  room.winnerId = null;
  room.lastResults = null;
  room.game = null;
  room.rematch.clear();
  for (const p of [...room.players.values()]) if (!p.connected) removePlayer(room, p.id, true);
  if (!rooms.has(room.code)) return;
  ensureHost(room);
  io.to(room.code).emit('sound:stop');
  broadcast(room);
}

/* -------------------------------------------------------- socket handlers */
io.on('connection', (socket) => {
  socket.data = {};
  let wStart = Date.now(), cnt = 0;
  socket.use((_, next) => { // crude flood protection: 40 events / second
    const n = Date.now();
    if (n - wStart > 1000) { wStart = n; cnt = 0; }
    if (++cnt > 40) return;
    next();
  });
  const on = (ev, fn) => socket.on(ev, (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    const d = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {};
    try { fn(d, cb); } catch (e) { console.error(`[${ev}]`, e); cb({ ok: false, error: 'Server error. Please try again.' }); }
  });
  const NOROOM = { ok: false, error: 'You are not in a room.' };
  const NOTHOST = { ok: false, error: 'Only the host can do that.' };
  const leaveCurrent = () => {
    const { room, p } = ctx(socket);
    if (room && p) { socket.leave(room.code); removePlayer(room, p.id); }
    socket.data = {};
  };

  on('room:create', (d, cb) => {
    leaveCurrent();
    if (rooms.size >= MAX_ROOMS) return cb({ ok: false, error: 'Server is busy. Try again later.' });
    const room = makeRoom();
    const p = makePlayer(d);
    room.players.set(p.id, p);
    room.hostId = p.id;
    rooms.set(room.code, room);
    attach(socket, room, p);
    cb({ ok: true, you: { id: p.id, token: p.token }, state: publicState(room) });
    broadcast(room);
  });

  on('room:join', (d, cb) => {
    leaveCurrent();
    const code = normCode(d.code);
    if (code.length !== 4) return cb({ ok: false, error: 'Enter the 4-character room code.' });
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.state !== 'lobby') return cb({ ok: false, error: 'That match is already running. Wait for it to finish.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: `Room is full (${MAX_PLAYERS}/${MAX_PLAYERS}).` });
    const p = makePlayer(d);
    room.players.set(p.id, p);
    attach(socket, room, p);
    notify(room, `${p.avatar} ${p.name} joined!`, 'good');
    cb({ ok: true, you: { id: p.id, token: p.token }, state: publicState(room) });
    broadcast(room);
  });

  on('room:rejoin', (d, cb) => {
    const room = rooms.get(normCode(d.code));
    const token = typeof d.token === 'string' ? d.token : '';
    const p = room && [...room.players.values()].find((x) => x.token === token);
    if (!room || !p) return cb({ ok: false, error: 'Your session expired. Join the room again.' });
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) { old.leave(room.code); old.data = {}; }
    }
    attach(socket, room, p);
    notify(room, `${p.name} reconnected.`, 'good');
    ensureHost(room);
    cb({ ok: true, you: { id: p.id, token: p.token }, state: publicState(room), results: room.state === 'results' ? room.lastResults : null });
    broadcast(room);
  });

  on('room:leave', (d, cb) => { leaveCurrent(); cb({ ok: true }); });

  on('room:transferHost', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb(NOROOM);
    if (p.id !== room.hostId) return cb(NOTHOST);
    if (room.state !== 'lobby' && room.state !== 'results') return cb({ ok: false, error: 'Not during a match.' });
    const t = typeof d.targetId === 'string' ? room.players.get(d.targetId) : null;
    if (!t || !t.connected) return cb({ ok: false, error: 'That player is not available.' });
    room.hostId = t.id;
    notify(room, `👑 ${t.name} is now the host.`, 'info');
    broadcast(room);
    cb({ ok: true });
  });

  on('match:start', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb(NOROOM);
    if (p.id !== room.hostId) return cb(NOTHOST);
    if (room.state !== 'lobby') return cb({ ok: false, error: 'A match is already running.' });
    if (connectedPlayers(room).length < MIN_PLAYERS) return cb({ ok: false, error: 'Need at least 2 players to start!' });
    startMatch(room);
    cb({ ok: true });
  });

  on('room:lobby', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb(NOROOM);
    if (p.id !== room.hostId) return cb(NOTHOST);
    if (room.state !== 'results') return cb({ ok: false, error: 'Not available right now.' });
    resetToLobby(room);
    io.to(room.code).emit('room:lobby');
    cb({ ok: true });
  });

  /* ---- rematch ---- */
  on('rematch:vote', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb(NOROOM);
    if (room.state !== 'results') return cb({ ok: false, error: 'No match to rematch.' });
    if (room.rematch.has(p.id)) room.rematch.delete(p.id); else room.rematch.add(p.id);
    broadcast(room);
    cb({ ok: true, ready: room.rematch.has(p.id) });
  });
  on('rematch:confirm', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb(NOROOM);
    if (p.id !== room.hostId) return cb(NOTHOST);
    if (room.state !== 'results') return cb({ ok: false, error: 'No match to rematch.' });
    const conn = connectedPlayers(room);
    if (conn.length < MIN_PLAYERS) return cb({ ok: false, error: 'Need at least 2 players for a rematch.' });
    const waiting = conn.filter((x) => x.id !== room.hostId && !room.rematch.has(x.id));
    if (waiting.length) return cb({ ok: false, error: `Waiting for ${waiting.map((x) => x.name).join(', ')}` });
    startMatch(room);
    cb({ ok: true });
  });

  /* ---- mini-game input (all validated) ---- */
  on('react:tap', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room || room.state !== 'playing' || room.game.key !== 'reaction' || !p.inMatch || p.dq || p.g.done) return cb({ ok: false });
    const now = Date.now();
    if (now - (p.g.lastTap || 0) < 60) return cb({ ok: false });
    p.g.lastTap = now;
    const early = () => {
      p.g.penalties = Math.min(3, (p.g.penalties || 0) + 1);
      cb({ ok: true, early: true, penalties: p.g.penalties });
    };
    const goAt = room.game.goAt;
    if (!goAt) return early();
    const ms = Math.round(now - goAt - p.rtt); // remove network round trip
    if (ms < 80) return early(); // faster than a human: counts as early
    p.g.done = true;
    p.g.ms = ms;
    p.score = Math.max(0, 3000 - ms - (p.g.penalties || 0) * 1000);
    cb({ ok: true, early: false, ms, score: p.score });
    checkDone(room);
  });

  on('dodge:done', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room || room.state !== 'playing' || room.game.key !== 'dodge' || !p.inMatch || p.dq || p.g.submitted) return cb({ ok: false });
    const g = room.game;
    const elapsed = Date.now() - g.startedAt;
    let ms = Number(d.ms);
    if (!Number.isFinite(ms)) ms = 0;
    ms = Math.max(0, Math.min(Math.floor(ms), g.maxMs, elapsed + 300)); // cannot outlive the round
    p.g.submitted = true;
    p.score = ms;
    cb({ ok: true, score: ms });
    checkDone(room);
  });

  on('aim:hit', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room || room.state !== 'playing' || room.game.key !== 'aim' || !p.inMatch || p.dq) return cb({ ok: false });
    const g = room.game;
    const reply = (ok) => cb({ ok, score: p.score });
    const i = d.i;
    const t = Number.isInteger(i) ? g.targets[i] : null;
    if (!t) return reply(false);
    p.g.hits = p.g.hits || new Set();
    if (p.g.hits.has(i)) return reply(false);
    const now = Date.now();
    if (now - (p.g.lastHit || 0) < 40) return reply(false);
    const el = now - g.startedAt;
    if (el < t.at - 300 || el > t.at + t.life + 900) return reply(false); // outside the target's lifetime
    p.g.lastHit = now;
    p.g.hits.add(i);
    p.score += t.pts;
    reply(true);
  });

  on('smash:tap', () => {
    const { room, p } = ctx(socket);
    if (!room || room.state !== 'playing' || room.game.key !== 'smash' || !p.inMatch || p.dq) return;
    const g = room.game;
    const now = Date.now();
    const el = now - g.startedAt;
    if (el < 0 || el > g.duration + 700) return;
    p.g.win = (p.g.win || []).filter((t) => now - t < 1000);
    if (p.g.win.length >= 14) return; // faster than any thumb
    p.g.win.push(now);
    p.score += 1;
  });

  /* ---- sound deck (winner only) ---- */
  on('sound:play', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb({ ok: false, error: 'You are not in a room.' });
    if (room.state !== 'results' || room.winnerId !== p.id) return cb({ ok: false, error: 'Only the winner can play sounds.' });
    const s = typeof d.id === 'string' ? SOUND_BY_ID.get(d.id) : null;
    if (!s) return cb({ ok: false, error: 'Unknown sound.' });
    const info = soundInfo(s);
    if (!info.available) return cb({ ok: false, error: 'Audio file not added yet.' });
    const now = Date.now();
    if (now - room.lastSoundAt < SOUND_COOLDOWN_MS) return cb({ ok: false, cooldown: true, error: 'Cooldown - wait a moment.' });
    room.lastSoundAt = now;
    room.seq += 1;
    io.to(room.code).emit('sound:event', { seq: room.seq, id: s.id, label: s.label, url: info.url, by: { id: p.id, name: p.name } });
    cb({ ok: true });
  });
  on('sound:stop', (d, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return cb(NOROOM);
    if (room.state !== 'results' || room.winnerId !== p.id) return cb({ ok: false, error: 'Only the winner can stop the deck for everyone.' });
    io.to(room.code).emit('sound:stop');
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const { room, p } = ctx(socket);
    if (room && p) handleDisconnect(room, p);
  });
});

/* ------------------------------------------------------------------- start */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Close the other program or run:  PORT=3001 npm start\n`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n💀  MEME WARS server is running!\n');
  console.log(`   On this computer:   http://localhost:${PORT}`);
  const addrs = lanAddresses();
  if (addrs.length) addrs.forEach((a) => console.log(`   Friends on Wi-Fi:   ${a}`));
  else console.log('   No network address found - connect to Wi-Fi or turn on a hotspot.');
  console.log('\n   Press Ctrl+C to stop.\n');
});

process.on('SIGINT', () => process.exit(0));
