/* MEME WARS - browser client. Vanilla JS, Canvas, Socket.IO.
 * The browser only renders and sends input. The server decides scores, winner
 * and who may use the sound deck. */
(() => {
'use strict';

/* ================================================================ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const AVATARS = ['😎', '🤡', '👽', '💀', '🐸', '🦆', '🔥', '🤖', '🐱', '🍕', '👻', '🦄'];
const ADJ = ['Spicy', 'Cringe', 'Sneaky', 'Turbo', 'Salty', 'Ultra', 'Chaotic', 'Cursed', 'Mega', 'Soggy', 'Sigma', 'Funky'];
const NOUN = ['Baigan', 'Gamer', 'Goblin', 'Potato', 'Ninja', 'Banana', 'Lord', 'Pigeon', 'Noodle', 'Legend', 'Wizard', 'Bruh'];
const ROASTS = [
  'Your reflexes called. They want a refund.',
  'Bold strategy: lose on purpose. Did it work?',
  'Somewhere, a potato is feeling very proud of you.',
  'It is fine. Participation trophies exist for a reason.',
  'Lag? Skill issue? Why not both.',
  'You were so close... to the other side of the leaderboard.',
  'Even the tutorial bot is whispering "bruh".',
  'Plot twist: your thumbs were on a coffee break.',
  'That was legendary. Legendarily bad. But legendary.',
  'Next time try using the screen. Just a tip!',
];
const randomName = () => cleanName(pick(ADJ) + pick(NOUN) + (Math.random() < 0.5 ? String(10 + Math.floor(Math.random() * 90)) : ''));
function cleanName(v) {
  return Array.from(String(v || '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').replace(/\s+/g, ' ')).slice(0, 16).join('');
}
const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) { /* ignore */ } };

/* =============================================================== settings */
const SKEY = 'memewars:settings:v1';
const SESSKEY = 'memewars:session:v1';
const DEFAULTS = { master: 0.8, meme: 1, game: 0.6, muted: false, name: '', avatar: 0 };
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SKEY) || '{}') || {}; } catch (_) { /* ignore */ }
  const o = { ...DEFAULTS };
  ['master', 'meme', 'game'].forEach((k) => { if (typeof s[k] === 'number') o[k] = clamp(s[k], 0, 1); });
  o.muted = !!s.muted;
  if (typeof s.name === 'string') o.name = cleanName(s.name);
  if (Number.isInteger(s.avatar) && s.avatar >= 0 && s.avatar < AVATARS.length) o.avatar = s.avatar;
  return o;
}
let settings = loadSettings();
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (_) { /* ignore */ } }
function loadSession() {
  try { const s = JSON.parse(sessionStorage.getItem(SESSKEY) || 'null'); return s && s.code && s.token ? s : null; } catch (_) { return null; }
}
function saveSession(s) { try { sessionStorage.setItem(SESSKEY, JSON.stringify(s)); } catch (_) { /* ignore */ } }
function clearSession() { session = null; try { sessionStorage.removeItem(SESSKEY); } catch (_) { /* ignore */ } }

/* ================================================================= state */
const me = { id: null };
let session = loadSession();
let room = null;
let results = null;
let sounds = [];
let netInfo = null;
let prevState = null;
let currentScreen = 'menu';
let activeGame = null;
let lastSeq = 0;
let idMode = 'play';
let selectedAvatar = settings.avatar;
let deckTab = 'international';
let ovDismissed = false;

/* ================================================================== audio */
let actx = null;
let audioUnlocked = false;
let pendingSound = null;
let current = null; // { audio, ev }
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function audioCtx() {
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { actx = new AC(); } catch (_) { actx = null; } } }
  return actx;
}
function beep(freq = 440, dur = 0.1, type = 'square', vol = 0.3) {
  if (settings.muted) return;
  const a = audioCtx();
  if (!a || a.state !== 'running') return;
  const v = Math.max(0.0001, vol * settings.master * settings.game);
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(v, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur + 0.03);
}
function tune(notes, type) { notes.forEach(([f, d], i) => setTimeout(() => beep(f, d, type || 'square', 0.3), i * 130)); }
function unlockAudio() {
  const a = audioCtx();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
  try {
    const s = new Audio(SILENT);
    s.volume = 0;
    const p = s.play();
    if (p && p.then) p.then(() => { audioUnlocked = true; hideAudioBanner(); }).catch(() => {});
    else audioUnlocked = true;
  } catch (_) { /* ignore */ }
}
function showAudioBanner() { $('#audio-banner').hidden = false; }
function hideAudioBanner() { $('#audio-banner').hidden = true; }
const memeVolume = () => (settings.muted ? 0 : clamp(settings.master * settings.meme, 0, 1));

function setNowPlaying(ev) {
  $$('[data-now]').forEach((n) => {
    n.classList.toggle('on', !!ev);
    n.textContent = ev ? `🔊 Now playing: ${ev.label}${ev.by ? ' (by ' + ev.by.name + ')' : ''}` : '🦗 Silence…';
  });
  $$('.sound-btn').forEach((b) => b.classList.toggle('playing', !!ev && b.dataset.id === ev.id));
}
function stopMeme() {
  if (current) {
    try { current.audio.pause(); current.audio.currentTime = 0; } catch (_) { /* ignore */ }
    current = null;
  }
  setNowPlaying(null);
}
function playMeme(ev) {
  stopMeme();
  if (!ev || typeof ev.url !== 'string' || !ev.url.startsWith('/assets/sounds/')) { toast('Audio file not added yet.', 'warn'); return; }
  const a = new Audio(ev.url);
  a.preload = 'auto';
  a.volume = memeVolume();
  current = { audio: a, ev };
  a.onended = () => { if (current && current.audio === a) { current = null; setNowPlaying(null); } };
  a.onerror = () => {
    if (current && current.audio === a) { current = null; setNowPlaying(null); }
    toast(`Couldn't play "${ev.label}" - file missing or unsupported.`, 'error');
  };
  setNowPlaying(ev);
  const p = a.play();
  if (p && p.catch) {
    p.catch((err) => {
      if (err && err.name === 'NotAllowedError') {
        pendingSound = { ev, at: Date.now() };
        if (current && current.audio === a) { current = null; setNowPlaying(null); }
        showAudioBanner();
        toast('Audio is blocked. Tap ENABLE AUDIO.', 'warn');
      } else if (err && err.name !== 'AbortError') {
        if (current && current.audio === a) { current = null; setNowPlaying(null); }
        toast(`Playback failed for "${ev.label}".`, 'error');
      }
    });
  }
}
function applyVolumes() {
  $$('[data-vol]').forEach((i) => { i.value = String(Math.round(settings[i.dataset.vol] * 100)); });
  $$('[data-mute-label]').forEach((b) => { b.textContent = settings.muted ? '🔇 Unmute' : '🔊 Mute'; });
  $('#top-mute').textContent = settings.muted ? '🔇' : '🔊';
  if (current) current.audio.volume = memeVolume();
}
['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, () => { if (!audioUnlocked) unlockAudio(); }, { passive: true }));

/* ================================================================== UI */
function toast(text, kind) {
  const box = $('#toasts');
  const t = el('div', 'toast ' + (kind || ''), text);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 3600);
}
function show(name) {
  if (currentScreen === name && $('#screen-' + name).classList.contains('active')) return;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  currentScreen = name;
  document.body.classList.remove('flash');
  void document.body.offsetWidth;
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 260);
  window.scrollTo(0, 0);
}
async function copyText(text) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { /* fall through */ }
  if (!ok) { // plain http on a LAN is not a secure context, so use the old way
    const ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, 9999);
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
  }
  toast(ok ? 'Copied! 📋' : 'Could not copy. Select and copy it manually.', ok ? 'good' : 'warn');
}
function showOverlay(title, text) {
  if (ovDismissed) return;
  $('#ov-title').textContent = title;
  $('#ov-text').textContent = text;
  $('#overlay').hidden = false;
}
function hideOverlay() { $('#overlay').hidden = true; }
function setConn(kind) {
  const map = { ok: ['pill-ok', '🟢 Connected'], wait: ['pill-wait', '🟡 Connecting…'], bad: ['pill-bad', '🔴 Offline'] };
  ['#conn', '#lobby-conn'].forEach((s) => { const n = $(s); n.className = 'pill ' + map[kind][0]; n.textContent = map[kind][1]; });
}

/* ================================================================= net */
const socket = typeof io === 'function' ? io({ reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 }) : null;
function req(ev, payload) {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) return resolve({ ok: false, error: 'Not connected to the server. Check your Wi-Fi and try again.' });
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'The server did not answer. Try again.' }); } }, 6000);
    socket.emit(ev, payload || {}, (r) => { if (done) return; done = true; clearTimeout(t); resolve(r || { ok: false, error: 'Bad reply from server.' }); });
  });
}
function send(ev, payload, cb) {
  if (!socket || !socket.connected) return;
  if (cb) socket.emit(ev, payload || {}, cb); else socket.emit(ev, payload || {});
}

/* ============================================================== identity */
function renderAvatars() {
  const g = $('#avatar-grid');
  g.textContent = '';
  AVATARS.forEach((a, i) => {
    const b = el('button', 'av', a);
    b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', 'Avatar ' + (i + 1));
    b.setAttribute('aria-checked', String(i === selectedAvatar));
    b.addEventListener('click', () => { selectedAvatar = i; renderAvatars(); beep(600 + i * 30, 0.05); });
    g.append(b);
  });
}
function openIdentity(mode) {
  idMode = mode;
  $('#id-title').textContent = mode === 'create' ? 'CREATE A ROOM' : mode === 'join' ? 'JOIN A ROOM' : 'PLAY MULTIPLAYER';
  $('#code-field').hidden = mode === 'create';
  $('#btn-do-join').hidden = mode === 'create';
  $('#btn-do-create').hidden = mode === 'join';
  $('#name-input').value = settings.name || randomName();
  $('#id-error').hidden = true;
  renderAvatars();
  show('identity');
}
function idError(msg) { const e = $('#id-error'); e.textContent = msg; e.hidden = false; }
function readIdentity() {
  const input = $('#name-input');
  const name = cleanName(input.value).trim() || randomName();
  input.value = name;
  settings.name = name; settings.avatar = selectedAvatar; saveSettings();
  return { name, avatar: selectedAvatar };
}
async function doCreate() {
  const info = readIdentity();
  setBusy(true);
  const r = await req('room:create', info);
  setBusy(false);
  if (!r.ok) return idError(r.error || 'Could not create a room.');
  applyJoin(r);
}
async function doJoin() {
  const info = readIdentity();
  const code = $('#code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) return idError('Enter the 4-character room code.');
  setBusy(true);
  const r = await req('room:join', { ...info, code });
  setBusy(false);
  if (!r.ok) return idError(r.error || 'Could not join that room.');
  applyJoin(r);
}
function setBusy(b) { $$('#screen-identity .btn').forEach((x) => { x.disabled = b; }); }
function applyJoin(r) {
  me.id = r.you.id;
  session = { code: r.state.code, token: r.you.token, id: r.you.id };
  saveSession(session);
  room = r.state;
  results = r.results || null;
  prevState = null;
  lastSeq = 0;
  loadInfo();
  routeFromState(true);
  renderLobby();
}

/* ================================================================ lobby */
async function loadInfo() {
  try { const r = await fetch('/api/info', { cache: 'no-store' }); netInfo = await r.json(); } catch (_) { netInfo = null; }
  renderAddresses();
}
function renderAddresses() {
  const box = $('#addr-list');
  box.textContent = '';
  const list = netInfo && Array.isArray(netInfo.addresses) ? netInfo.addresses.slice() : [];
  const host = location.hostname;
  if (host && host !== 'localhost' && !host.startsWith('127.') && !list.includes(location.origin)) list.push(location.origin);
  if (!list.length) {
    box.append(el('p', 'hint', 'No network address found. Connect the host to Wi-Fi or turn on a hotspot, then restart the server.'));
    return;
  }
  list.forEach((a) => {
    const row = el('div', 'addr');
    row.append(el('code', '', a));
    const b = el('button', 'btn btn-small btn-cyan', '📋');
    b.type = 'button'; b.dataset.copy = a; b.setAttribute('aria-label', 'Copy address ' + a);
    row.append(b);
    box.append(row);
  });
}
function renderLobby() {
  if (!room) return;
  $('#lobby-code').textContent = room.code;
  const grid = $('#lobby-players');
  grid.textContent = '';
  const amHost = room.hostId === me.id;
  for (let i = 0; i < room.max; i++) {
    const p = room.players[i];
    const card = el('div', 'pcard' + (p ? '' : ' empty') + (p && !p.connected ? ' offline' : '') + (p && p.id === me.id ? ' me' : ''));
    if (p) {
      card.append(el('div', 'p-av', p.avatar));
      card.append(el('div', 'p-name', p.name + (p.id === me.id ? ' (you)' : '')));
      if (p.id === room.hostId) card.append(el('div', 'p-badge', '👑 HOST'));
      card.append(el('div', 'p-status', p.connected ? '🟢 Online' : '🔴 Reconnecting…'));
      if (amHost && p.id !== me.id && p.connected) {
        const b = el('button', 'make-host', 'Make host');
        b.type = 'button'; b.dataset.makeHost = p.id;
        card.append(b);
      }
    } else card.append(el('div', '', 'Waiting for player…'));
    grid.append(card);
  }
  const conn = room.players.filter((p) => p.connected).length;
  $('#lobby-count').textContent = `${room.players.length}/${room.max} players`;
  const start = $('#btn-start');
  start.hidden = !amHost;
  start.disabled = conn < 2;
  $('#lobby-hint').textContent = !amHost ? 'Waiting for the host to start the match…'
    : conn < 2 ? 'You need at least 2 players to start.' : 'Everyone ready? Hit start!';
}

/* ============================================================ routing */
function routeFromState(force) {
  if (!room) return;
  const st = room.state;
  if (!force && st === prevState) return;
  prevState = st;
  if (st === 'lobby') { stopActiveGame(); show('lobby'); }
  else if (st === 'countdown') show('countdown');
  else if (st === 'playing') {
    if (currentScreen !== 'game') {
      stopActiveGame();
      $$('.gbox').forEach((b) => { b.hidden = true; });
      $('#game-title').textContent = '⏳ Round in progress';
      $('#game-timer').textContent = '';
      $('#game-live').hidden = true;
      showWait('A round is running. You will see the results in a moment…');
      show('game');
    }
  } else if (st === 'results') {
    if (results) { if (currentScreen !== 'deck') { renderResults(false); show('results'); } }
    else show('lobby');
  }
}
function showWait(t) { const w = $('#game-wait'); w.textContent = t; w.hidden = false; }
function hideWait() { $('#game-wait').hidden = true; }

/* ============================================================== results */
const WIN_EMOJI = ['🎉', '👑', '🔥', '🏆', '😎', '🤑'];
const LOSE_EMOJI = ['😭', '💀', '🤡', '🪦', '📉', '🫠'];
function renderResults(fanfare) {
  const r = results;
  if (!r) return;
  const win = !!r.winnerId && r.winnerId === me.id;
  const banner = $('#res-banner');
  banner.className = 'res-banner ' + (!r.winnerId ? 'draw' : win ? 'win' : 'lose');
  banner.textContent = !r.winnerId ? 'NO CONTEST' : win ? 'VICTORY' : 'DEFEAT';
  let sub = !r.winnerId ? 'Everybody left. Spooky.' : win ? `${r.winnerAvatar} You win! 👑` : `${r.winnerAvatar} ${r.winnerName} wins`;
  if (r.winnerId && r.tie) sub += ' (coin-flip tiebreak 🪙)';
  else if (r.winnerId && r.forfeit) sub += ' (by forfeit)';
  $('#res-sub').textContent = sub;
  $('#res-roast').textContent = !r.winnerId ? '' : win ? 'The sound deck is yours. Choose wisely… or chaotically.' : pick(ROASTS);
  $('#res-game').textContent = `${r.game.emoji} ${r.game.title}`;
  const fl = $('#res-reactions');
  fl.textContent = '';
  const set = win ? WIN_EMOJI : LOSE_EMOJI;
  for (let i = 0; i < 10; i++) {
    const s = el('span', '', pick(set));
    s.style.left = Math.random() * 92 + '%';
    s.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
    s.style.animationDuration = (4 + Math.random() * 3).toFixed(2) + 's';
    fl.append(s);
  }
  const ol = $('#res-scores');
  ol.textContent = '';
  r.scores.forEach((s, i) => {
    const li = el('li', (s.id === r.winnerId ? 'winner ' : '') + (s.id === me.id ? 'me' : ''));
    li.append(el('span', 's-rank', String(i + 1)));
    li.append(el('span', 's-av', s.avatar));
    li.append(el('span', 's-name', s.name + (s.id === r.winnerId ? ' 👑' : '') + (s.dq ? ' 🔌' : '')));
    li.append(el('span', 's-val', s.label));
    ol.append(li);
  });
  $('#btn-deck').textContent = win ? '🔊 OPEN MEME SOUNDBOARD' : '🎧 OPEN SOUND DECK (listen only)';
  renderRematch();
  if (fanfare) {
    if (win) { confetti(); tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]]); vibrate([80, 40, 80, 40, 200]); }
    else if (r.winnerId) { tune([[330, 0.15], [262, 0.15], [196, 0.35]], 'sawtooth'); vibrate(120); }
  }
}
function renderRematch() {
  if (!room || room.state !== 'results') return;
  const amHost = room.hostId === me.id;
  const conn = room.players.filter((p) => p.connected);
  const others = conn.filter((p) => p.id !== room.hostId);
  const ready = others.filter((p) => p.ready).length;
  const mine = room.players.find((p) => p.id === me.id);
  const vote = $('#btn-rematch-vote'), start = $('#btn-rematch-start'), lobby = $('#btn-tolobby');
  vote.hidden = amHost; start.hidden = !amHost; lobby.hidden = !amHost;
  vote.textContent = mine && mine.ready ? '✅ READY - tap to cancel' : '🔁 REMATCH?';
  start.textContent = `🔁 START REMATCH (${ready}/${others.length} ready)`;
  start.disabled = conn.length < 2 || ready < others.length;
  $('#res-hint').textContent = amHost
    ? (conn.length < 2 ? 'Not enough players for a rematch.' : 'The rematch starts once everyone taps REMATCH and you confirm.')
    : 'Tap REMATCH if you are in. The host confirms.';
}

/* =============================================================== deck */
const isWinner = () => !!room && room.state === 'results' && room.winnerId === me.id;
async function loadSounds() {
  try {
    const r = await fetch('/api/sounds', { cache: 'no-store' });
    if (!r.ok) throw new Error('bad status');
    sounds = (await r.json()).sounds || [];
  } catch (_) { toast('Could not load the sound list.', 'error'); }
}
async function openDeck() { await loadSounds(); renderDeck(); setTab(deckTab); show('deck'); }
function setTab(t) {
  deckTab = t;
  $$('.tab').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  $('#deck-international').hidden = t !== 'international';
  $('#deck-custom').hidden = t !== 'custom';
}
function renderDeck() {
  const win = isWinner();
  $('#deck-role').textContent = win ? '👑 You won! You choose every meme. Everyone in the room hears it.' : '🔒 Only the winner can play sounds. Sit back and listen.';
  ['international', 'custom'].forEach((tab) => {
    const grid = $('#deck-' + tab);
    grid.textContent = '';
    sounds.filter((s) => s.tab === tab).forEach((s) => {
      const b = el('button', 'sound-btn');
      b.type = 'button'; b.dataset.id = s.id;
      b.append(el('span', '', s.label));
      if (!s.available) {
        b.disabled = true; b.classList.add('missing'); b.title = s.note || 'Audio file not added yet.';
        b.append(el('span', 'sb-note', 'Audio file not added yet.'));
      } else if (!win) { b.disabled = true; b.classList.add('locked'); b.append(el('span', '', '🔒')); }
      if (current && current.ev.id === s.id) b.classList.add('playing');
      grid.append(b);
    });
  });
}

/* =========================================================== game flow */
const GAME_META = { reaction: ['⚡', 'Reaction Rush'], dodge: ['🌪️', 'Dodge Master'], aim: ['🎯', 'Aim Battle'], smash: ['👊', 'Button Smash'] };
function stopActiveGame() { if (activeGame) { try { activeGame.stop(); } catch (_) { /* ignore */ } activeGame = null; } }
function startGame(d) {
  stopActiveGame();
  const meta = GAME_META[d.game];
  if (!meta) return;
  show('game');
  $('#game-title').textContent = `${meta[0]} ${meta[1]}`;
  $('#game-timer').textContent = '';
  $('#game-live').hidden = true;
  hideWait();
  $$('.gbox').forEach((b) => { b.hidden = b.id !== 'g-' + d.game; });
  const starters = { reaction: startReaction, dodge: startDodge, aim: startAim, smash: startSmash };
  try { activeGame = starters[d.game](d); }
  catch (e) { console.error(e); showWait('Something went wrong in this mini-game. Waiting for results…'); }
}
function makeCleaner() {
  const offs = [];
  return {
    on(target, ev, fn, opts) { target.addEventListener(ev, fn, opts); offs.push(() => target.removeEventListener(ev, fn, opts)); },
    sock(ev, fn) { if (socket) { socket.on(ev, fn); offs.push(() => socket.off(ev, fn)); } },
    add(fn) { offs.push(fn); },
    run() { offs.splice(0).forEach((f) => { try { f(); } catch (_) { /* ignore */ } }); },
  };
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function toLogical(e, cv, W, H) {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
function sizeCanvas(cv, W, H) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

/* ---- A. Reaction Rush ---- */
function startReaction() {
  const pad = $('#react-pad'), big = $('#react-big'), small = $('#react-small');
  const cl = makeCleaner();
  let state = 'wait', active = true, early = 0;
  const paint = (s, b, sm) => { pad.className = 'pad ' + s; big.textContent = b; small.textContent = sm || ''; };
  paint('wait', 'WAIT…', 'Tap only when the screen turns GREEN');
  cl.sock('react:go', () => {
    if (!active || state === 'done') return;
    state = 'go'; paint('go', 'TAP!!!', 'NOW NOW NOW'); beep(900, 0.12, 'square', 0.4); vibrate(30);
  });
  const down = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!active || state === 'done') return;
    if (state === 'go') {
      state = 'done'; paint('done', '…', 'Checking with the server'); beep(660, 0.06);
      send('react:tap', {}, (r) => {
        if (!active) return;
        if (r && r.ok && !r.early) paint('done', `${r.ms} ms`, early ? `(+${early} early-tap penalty) Waiting for the others…` : 'Waiting for the others…');
        else if (r && r.ok && r.early) { early = r.penalties || early; state = 'go'; paint('go', 'TAP!!!', 'That was a hair too early. Tap again!'); }
        else paint('done', 'Tap lost 😬', 'Waiting for results…');
      });
    } else {
      early++;
      paint('wait', 'TOO EARLY! 🙈', '+1000 ms penalty. Wait for GREEN…');
      pad.classList.add('shake'); setTimeout(() => pad.classList.remove('shake'), 300);
      beep(160, 0.25, 'sawtooth', 0.4); vibrate(60);
      send('react:tap', {}, (r) => { if (r && r.ok && typeof r.penalties === 'number') early = r.penalties; });
    }
  };
  cl.on(pad, 'pointerdown', down);
  cl.on(window, 'keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) down(e); });
  return { stop() { active = false; cl.run(); } };
}

/* ---- B. Dodge Master ---- */
function startDodge(d) {
  const cv = $('#dodge-canvas');
  const W = 360, H = 520, PY = 462, PR = 12;
  const c = sizeCanvas(cv, W, H);
  const maxMs = d.maxMs || 30000;
  const R = rng(d.seed || 1);
  const EM = ['💩', '🍅', '🔥', '🪨', '🧨', '🥒'];
  const spawns = [];
  for (let t = 700; t < maxMs;) {
    const r = 10 + R() * 12;
    spawns.push({ t, x: r + R() * (W - 2 * r), r, v: 170 + (t / maxMs) * 170 + R() * 70, e: EM[Math.floor(R() * EM.length)] });
    t += Math.max(260, 760 - t * 0.017) * (0.7 + R() * 0.6);
  }
  const cl = makeCleaner();
  const timerEl = $('#game-timer');
  const avatar = AVATARS[selectedAvatar] || '😎';
  const keys = { l: false, r: false };
  let px = W / 2, tx = W / 2, raf = 0, over = false, first = 0, lastT = 0, lastShown = -1;
  const start = performance.now();
  lastT = start;

  const setTx = (e) => { tx = clamp(toLogical(e, cv, W, H).x, 16, W - 16); };
  cl.on(cv, 'pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } setTx(e); });
  cl.on(cv, 'pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) setTx(e); });
  cl.on(window, 'keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.l = true; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.r = true; e.preventDefault(); }
  });
  cl.on(window, 'keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.l = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.r = false;
  });

  function drawBase(t) {
    c.fillStyle = '#120a22'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(178,75,255,.14)'; c.lineWidth = 1;
    const off = (t / 8) % 40;
    for (let y = -40 + off; y < H; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.textAlign = 'center'; c.textBaseline = 'middle';
  }
  function end(t, survived) {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    const ms = Math.min(Math.floor(t), maxMs);
    c.fillStyle = 'rgba(8,5,15,.72)'; c.fillRect(0, 0, W, H);
    c.fillStyle = survived ? '#39ff88' : '#ff2e63'; c.font = '900 34px system-ui,sans-serif';
    c.fillText(survived ? 'SURVIVED! 😎' : 'BOOM 💥', W / 2, H / 2 - 20);
    c.fillStyle = '#ffe14d'; c.font = '800 22px system-ui,sans-serif';
    c.fillText(`${(ms / 1000).toFixed(2)} s`, W / 2, H / 2 + 22);
    timerEl.textContent = `${(ms / 1000).toFixed(2)}s`;
    send('dodge:done', { ms });
    beep(survived ? 880 : 140, 0.35, survived ? 'square' : 'sawtooth', 0.4); vibrate(survived ? 40 : 150);
    showWait('Waiting for the other players…');
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const t = now - start;
    if (keys.l) tx -= 420 * dt;
    if (keys.r) tx += 420 * dt;
    tx = clamp(tx, 16, W - 16);
    px += (tx - px) * Math.min(1, dt * 18);
    drawBase(t);
    for (let i = first; i < spawns.length; i++) {
      const o = spawns[i];
      if (o.t > t) break;
      const y = -o.r + (o.v * (t - o.t)) / 1000;
      if (y > H + o.r) { if (i === first) first++; continue; }
      c.font = `${Math.round(o.r * 2)}px serif`;
      c.fillText(o.e, o.x, y);
      const dx = px - o.x, dy = PY - y, rr = PR + o.r * 0.8;
      if (dx * dx + dy * dy < rr * rr) { end(t, false); return; }
    }
    c.font = '30px serif';
    c.fillText(avatar, px, PY);
    const shown = Math.floor(t / 100);
    if (shown !== lastShown) { lastShown = shown; timerEl.textContent = `${(t / 1000).toFixed(1)}s`; }
    if (t >= maxMs) end(maxMs, true);
  }
  raf = requestAnimationFrame(frame);
  return { stop() { over = true; cancelAnimationFrame(raf); cl.run(); } };
}

/* ---- C. Aim Battle ---- */
function startAim(d) {
  const cv = $('#aim-canvas');
  const W = 360, H = 520;
  const c = sizeCanvas(cv, W, H);
  const targets = Array.isArray(d.targets) ? d.targets : [];
  const duration = d.duration || 15000;
  const hits = new Set();
  const floats = [];
  const cl = makeCleaner();
  const timerEl = $('#game-timer');
  let score = 0, raf = 0, stopped = false, finished = false, lastShown = -1;
  const start = performance.now();

  cl.on(cv, 'pointerdown', (e) => {
    if (e.cancelable) e.preventDefault();
    const t = performance.now() - start;
    if (t >= duration) return;
    const pt = toLogical(e, cv, W, H);
    for (let k = targets.length - 1; k >= 0; k--) {
      const tg = targets[k];
      if (hits.has(tg.i) || t < tg.at || t >= tg.at + tg.life) continue;
      const dx = pt.x - tg.x * W, dy = pt.y - tg.y * H, rr = tg.r * W * 1.2;
      if (dx * dx + dy * dy <= rr * rr) {
        hits.add(tg.i);
        score += tg.pts;
        floats.push({ x: tg.x * W, y: tg.y * H, txt: '+' + tg.pts, born: t });
        send('aim:hit', { i: tg.i }, (r) => { if (r && typeof r.score === 'number') score = r.score; });
        beep(tg.pts > 10 ? 1100 : 760, 0.06, 'square', 0.3); vibrate(15);
        break;
      }
    }
  });
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const t = now - start;
    c.fillStyle = '#120a22'; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const tg of targets) {
      if (hits.has(tg.i) || t < tg.at || t >= tg.at + tg.life) continue;
      const x = tg.x * W, y = tg.y * H, r = tg.r * W, left = 1 - (t - tg.at) / tg.life;
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fillStyle = tg.pts > 10 ? '#ffe14d' : '#ff2e63'; c.fill();
      c.beginPath(); c.arc(x, y, r * 0.66, 0, 6.2832); c.fillStyle = '#fff'; c.fill();
      c.beginPath(); c.arc(x, y, r * 0.33, 0, 6.2832); c.fillStyle = tg.pts > 10 ? '#ff2e63' : '#b24bff'; c.fill();
      c.beginPath(); c.arc(x, y, r + 5, -1.5708, -1.5708 + 6.2832 * left); c.strokeStyle = '#27f3ff'; c.lineWidth = 3; c.stroke();
    }
    c.font = '800 20px system-ui,sans-serif';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], age = t - f.born;
      if (age > 600) { floats.splice(i, 1); continue; }
      c.globalAlpha = 1 - age / 600; c.fillStyle = '#39ff88'; c.fillText(f.txt, f.x, f.y - age / 14); c.globalAlpha = 1;
    }
    c.fillStyle = '#ffe14d'; c.textAlign = 'left'; c.font = '900 22px system-ui,sans-serif';
    c.fillText(`Score: ${score}`, 12, 24);
    const shown = Math.floor(t / 100);
    if (shown !== lastShown) { lastShown = shown; timerEl.textContent = `${Math.max(0, (duration - t) / 1000).toFixed(1)}s`; }
    if (t >= duration && !finished) {
      finished = true;
      c.fillStyle = 'rgba(8,5,15,.7)'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#ff2e63'; c.textAlign = 'center'; c.font = '900 40px system-ui,sans-serif'; c.fillText("TIME'S UP!", W / 2, H / 2);
      timerEl.textContent = '0.0s';
      showWait('Waiting for the final scores…');
      beep(300, 0.3, 'sawtooth', 0.4);
      setTimeout(() => { if (!stopped) cancelAnimationFrame(raf); }, 150);
    }
  }
  raf = requestAnimationFrame(frame);
  return { stop() { stopped = true; cancelAnimationFrame(raf); cl.run(); } };
}

/* ---- D. Button Smash ---- */
function startSmash(d) {
  const btn = $('#smash-btn'), cnt = $('#smash-count'), tm = $('#game-timer');
  const duration = d.duration || 10000;
  const cl = makeCleaner();
  const start = performance.now();
  let n = 0, over = false;
  cnt.textContent = '0';
  btn.disabled = false;
  const tick = setInterval(() => {
    const left = Math.max(0, duration - (performance.now() - start));
    tm.textContent = (left / 1000).toFixed(1) + 's';
    if (left <= 0) end();
  }, 100);
  cl.add(() => clearInterval(tick));
  function end() {
    if (over) return;
    over = true;
    btn.disabled = true; btn.classList.remove('down');
    tm.textContent = '0.0s';
    showWait(`Time! You smashed ${n} times. Waiting for the final scores…`);
    beep(300, 0.3, 'sawtooth', 0.4);
  }
  function hit(e) {
    if (e && e.cancelable) e.preventDefault();
    if (over || performance.now() - start > duration) return;
    n++;
    cnt.textContent = String(n);
    send('smash:tap');
    if (n % 4 === 0) beep(420 + (n % 24) * 18, 0.04, 'square', 0.2);
    if (n % 25 === 0) vibrate(25);
  }
  cl.on(btn, 'pointerdown', (e) => { btn.classList.add('down'); hit(e); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => cl.on(btn, ev, () => btn.classList.remove('down')));
  cl.on(window, 'keydown', (e) => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) hit(e); });
  return { stop() { over = true; btn.classList.remove('down'); cl.run(); } };
}

/* ============================================================ visual fx */
let confettiRaf = 0;
function confetti() {
  const cv = $('#fx'), c = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const W = cv.width, H = cv.height;
  const cols = ['#ff2e63', '#ffe14d', '#27f3ff', '#b24bff', '#39ff88'];
  let parts = Array.from({ length: 120 }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
    s: 5 + Math.random() * 7, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.35, col: pick(cols),
  }));
  cancelAnimationFrame(confettiRaf);
  (function f() {
    c.clearRect(0, 0, W, H);
    parts = parts.filter((p) => p.y < H + 20);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.fillStyle = p.col; c.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); c.restore();
    }
    if (parts.length) confettiRaf = requestAnimationFrame(f); else c.clearRect(0, 0, W, H);
  })();
}
function startBackground() {
  const cv = $('#bg'), c = cv.getContext('2d');
  if (!c) return;
  const E = ['💀', '😂', '🔥', '🤡', '💥', '🗿', '👽', '🍕'];
  let W = 0, H = 0, raf = 0, last = 0;
  const items = [];
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 14; i++) items.push({ x: Math.random() * W, y: Math.random() * H, vy: 0.3 + Math.random() * 0.7, s: 22 + Math.random() * 26, e: pick(E) });
  const draw = () => {
    c.clearRect(0, 0, W, H);
    c.globalAlpha = 0.13; c.textAlign = 'center';
    for (const it of items) { c.font = it.s + 'px serif'; c.fillText(it.e, it.x, it.y); }
    c.globalAlpha = 1;
  };
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 50) return;
    last = t;
    for (const it of items) { it.y -= it.vy; if (it.y < -40) { it.y = H + 40; it.x = Math.random() * W; } }
    draw();
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(); return; }
  raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(frame);
  });
}

/* =========================================================== actions */
async function leaveRoom() {
  stopActiveGame(); stopMeme();
  if (socket && socket.connected) await req('room:leave', {});
  clearSession();
  room = null; results = null; me.id = null; prevState = null;
  show('menu');
}
const actions = {
  play: () => openIdentity('play'),
  create: () => openIdentity('create'),
  join: () => openIdentity('join'),
  how: () => show('how'),
  settings: () => { applyVolumes(); show('settings'); },
  menu: () => show('menu'),
  'rand-name': () => { $('#name-input').value = randomName(); beep(700, 0.05); },
  'do-create': doCreate,
  'do-join': doJoin,
  'copy-code': () => room && copyText(room.code),
  start: async () => { const r = await req('match:start', {}); if (!r.ok) toast(r.error || 'Could not start.', 'error'); },
  leave: leaveRoom,
  'open-deck': openDeck,
  'close-deck': () => { renderResults(false); show('results'); },
  rematch: async () => { const r = await req('rematch:vote', {}); if (!r.ok) toast(r.error || 'Could not vote.', 'error'); },
  'rematch-start': async () => { const r = await req('rematch:confirm', {}); if (!r.ok) toast(r.error || 'Could not start rematch.', 'warn'); },
  'to-lobby': async () => { const r = await req('room:lobby', {}); if (!r.ok) toast(r.error || 'Could not go back.', 'error'); },
  'stop-sound': () => { stopMeme(); if (isWinner()) req('sound:stop', {}); },
  mute: () => { settings.muted = !settings.muted; saveSettings(); applyVolumes(); },
  'enable-audio': () => {
    unlockAudio(); hideAudioBanner();
    if (pendingSound && Date.now() - pendingSound.at < 8000) { const ev = pendingSound.ev; pendingSound = null; setTimeout(() => playMeme(ev), 120); }
  },
  retry: () => { if (socket) { socket.connect(); } toast('Retrying…'); },
  dismiss: () => { ovDismissed = true; hideOverlay(); },
  'test-sound': () => { unlockAudio(); tune([[523, 0.1], [659, 0.1], [784, 0.2]]); },
  'reset-data': () => {
    try { localStorage.removeItem(SKEY); } catch (_) { /* ignore */ }
    settings = loadSettings(); selectedAvatar = settings.avatar; applyVolumes(); toast('Saved data cleared.', 'good');
  },
};
document.addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { copyText(copy.dataset.copy); return; }
  const mh = e.target.closest('[data-make-host]');
  if (mh) { req('room:transferHost', { targetId: mh.dataset.makeHost }).then((r) => { if (!r.ok) toast(r.error || 'Could not transfer host.', 'error'); }); return; }
  const tab = e.target.closest('.tab');
  if (tab) { setTab(tab.dataset.tab); return; }
  const sb = e.target.closest('.sound-btn');
  if (sb) {
    if (sb.disabled) return;
    unlockAudio();
    req('sound:play', { id: sb.dataset.id }).then((r) => {
      if (r.ok) return;
      if (r.cooldown) toast('Easy! Wait a moment ⏳', 'warn'); else toast(r.error || 'Could not play that sound.', 'error');
    });
    return;
  }
  const a = e.target.closest('[data-action]');
  if (a && actions[a.dataset.action]) { beep(520, 0.05, 'square', 0.15); actions[a.dataset.action](a); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-vol]')) {
    settings[t.dataset.vol] = clamp(Number(t.value) / 100, 0, 1);
    saveSettings(); applyVolumes();
  } else if (t.id === 'name-input') {
    const v = cleanName(t.value);
    if (v !== t.value) t.value = v;
  } else if (t.id === 'code-input') {
    t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  }
});
$('#code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && idMode !== 'create') doJoin(); });
$('#name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') (idMode === 'create' ? doCreate : doJoin)(); });

/* ====================================================== socket events */
function initNet() {
  socket.on('connect', async () => {
    ovDismissed = false; hideOverlay(); setConn('ok');
    if (session && session.code && session.token) {
      const r = await req('room:rejoin', { code: session.code, token: session.token });
      if (r.ok) { applyJoin(r); toast('Reconnected! 🎉', 'good'); }
      else { clearSession(); room = null; results = null; me.id = null; prevState = null; stopActiveGame(); show('menu'); toast(r.error || 'Could not rejoin the room.', 'error'); }
    }
  });
  socket.on('disconnect', (reason) => {
    setConn('wait');
    if (reason === 'io client disconnect') return;
    showOverlay('Connection lost', 'Trying to reconnect… Make sure you are still on the same Wi-Fi or hotspot as the host.');
  });
  socket.on('connect_error', () => {
    setConn('bad');
    showOverlay('Server unavailable', "Can't reach the game server. Make sure the host started it (npm start) and that you are on the same Wi-Fi or hotspot.");
  });
  socket.on('srv:ping', (cb) => { if (typeof cb === 'function') cb(); });
  socket.on('room:state', (s) => {
    if (!s || typeof s !== 'object') return;
    room = s;
    routeFromState(false);
    renderLobby();
    if (currentScreen === 'results') renderRematch();
  });
  socket.on('notice', (n) => {
    if (!n || typeof n.text !== 'string') return;
    toast(n.text, n.kind === 'good' ? 'good' : n.kind === 'warn' ? 'warn' : '');
    if (n.kind === 'good') beep(880, 0.08, 'sine', 0.2); else if (n.kind === 'warn') beep(260, 0.12, 'triangle', 0.2);
  });
  socket.on('match:countdown', (d) => {
    show('countdown');
    const big = $('#cd-num');
    big.className = 'cd-num'; void big.offsetWidth; big.classList.add('pop');
    if (d.n > 0) {
      big.textContent = String(d.n);
      $('#cd-game').textContent = ''; $('#cd-tip').textContent = '';
      beep(380 + (3 - d.n) * 120, 0.15, 'square', 0.35); vibrate(30);
    } else {
      big.textContent = 'GO!';
      if (d.game) { $('#cd-game').textContent = `${d.game.emoji} ${d.game.title}`; $('#cd-tip').textContent = d.game.tip; }
      beep(988, 0.35, 'sawtooth', 0.4); vibrate([60, 30, 60]);
    }
  });
  socket.on('match:begin', (d) => { if (d && d.game) startGame(d); });
  socket.on('live:scores', (d) => {
    if (currentScreen !== 'game' || !room || !d || !Array.isArray(d.scores)) return;
    const bar = $('#game-live');
    bar.hidden = false; bar.textContent = '';
    d.scores.forEach((s) => {
      const p = room.players.find((x) => x.id === s.id);
      if (p) bar.append(el('span', 'live-chip' + (s.id === me.id ? ' me' : ''), `${p.avatar} ${p.name}: ${s.score}`));
    });
  });
  socket.on('match:results', (d) => {
    if (!d) return;
    results = d; stopActiveGame(); $('#game-live').hidden = true;
    renderResults(true);
    if (currentScreen !== 'deck') show('results');
  });
  socket.on('match:cancelled', () => { stopActiveGame(); toast('Match cancelled.', 'warn'); show('lobby'); });
  socket.on('room:lobby', () => { results = null; stopMeme(); });
  socket.on('sound:event', (ev) => {
    if (!room || !ev || typeof ev.seq !== 'number' || ev.seq <= lastSeq) return;
    lastSeq = ev.seq;
    playMeme(ev);
  });
  socket.on('sound:stop', () => stopMeme());
}

/* ================================================================ boot */
function boot() {
  applyVolumes();
  startBackground();
  setConn(socket ? 'wait' : 'bad');
  show('menu');
  if (socket) initNet();
  else {
    ovDismissed = false;
    showOverlay('Game server not running', 'Open this page through the Node.js server (npm start, then visit http://localhost:3000). Opening index.html directly cannot run multiplayer.');
  }
}
boot();
})();
