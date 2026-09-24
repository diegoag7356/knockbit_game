import { onValue, onChildAdded, ref, set, update, push, remove, get, onDisconnect, serverTimestamp } from 'firebase/database';
import { authReady, db } from './firebase';
import { ABILITIES, COLORS, GAME_MODES, GameEngine, GRAPHICS_PROFILES, PASSIVES } from './game';
import './style.css';

const app = document.querySelector('#app');
const settings = {
  graphics: localStorage.getItem('knockbit-graphics') || 'optimized',
  sound: localStorage.getItem('knockbit-sound') !== 'off',
};
const state = { id: '', room: '', profile: { name: localStorage.getItem('knockbit-name') || '', color: localStorage.getItem('knockbit-color') || COLORS[0], passive: 'alcance', ability: 'dash' }, roomValue: null, unsubscribe: null, gameUnsubs: [], engine: null, started: false, resultShown: false, hostChecked: false, leaving: false };
// La identidad en la base de datos es el UID de la Auth anónima: así las reglas
// pueden aislar la escritura de cada jugador ($playerId === auth.uid).
const authBoot = authReady
  .then((credential) => { state.id = credential?.user?.uid || ''; })
  .catch((error) => {
    console.error('Firebase Auth no disponible', error);
    toastMessage('No se pudo conectar con Firebase. ¿Estás en un dominio autorizado?');
    throw error;
  });

app.innerHTML = `
  <main class="shell">
    <section id="menu" class="screen"></section>
    <section id="lobby" class="screen hidden"></section>
    <section id="game" class="screen game-screen hidden"><canvas id="arena"></canvas><button id="leave-game" class="ghost small">Salir</button></section>
    <div id="toast" class="toast"></div>
  </main>`;
const menu = document.querySelector('#menu');
const lobby = document.querySelector('#lobby');
const game = document.querySelector('#game');
const canvas = document.querySelector('#arena');
const toast = document.querySelector('#toast');

function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function profile() {
  state.profile.name = document.querySelector('#name')?.value.trim() || state.profile.name || 'Jugador';
  localStorage.setItem('knockbit-name', state.profile.name);
  localStorage.setItem('knockbit-color', state.profile.color);
  return { ...state.profile, id: state.id, joinedAt: serverTimestamp(), alive: true, lives: 3, hitsTaken: 0 };
}

function renderMenu() {
  menu.innerHTML = `<div class="card hero-card">
    <div class="menu-heading"><div class="brand"><span class="brand-mark">K</span><span>KNOCK<span>BIT</span></span></div><button id="settings-toggle" class="ghost settings-toggle" aria-expanded="false">⚙ Ajustes</button></div>
    <div id="settings-panel" class="settings-panel hidden"><div class="settings-title"><strong>Ajustes</strong><span>Se guardan en este dispositivo</span></div><label class="field-label" for="graphics">Gráficos</label><select id="graphics" class="text-input">${Object.entries(GRAPHICS_PROFILES).map(([key, item]) => `<option value="${key}" ${settings.graphics === key ? 'selected' : ''}>${item.label}</option>`).join('')}</select><p class="settings-help">Optimizado reduce el coste en Macs con poca memoria; Alto usa más resolución y partículas.</p><label class="sound-setting"><input id="sound" type="checkbox" ${settings.sound ? 'checked' : ''}> Sonido de combate</label></div>
    <p class="eyebrow">Arena 2D · 2–8 jugadores</p>
    <h1>Golpea. Empuja.<br><em>No salgas de la zona.</em></h1>
    <label class="field-label" for="name">Tu nombre</label>
    <input id="name" class="text-input" maxlength="16" value="${esc(state.profile.name)}" placeholder="Escribe tu nombre" autocomplete="off">
    <label class="field-label">Tu color</label>
    <div class="color-picker">${COLORS.map((color) => `<button class="color-dot ${color === state.profile.color ? 'selected' : ''}" data-color="${color}" style="--color:${color}" aria-label="Color ${color}"></button>`).join('')}</div>
    <div class="menu-actions"><button id="create" class="primary">Crear sala</button><div class="join-row"><input id="room-code" class="text-input" maxlength="5" placeholder="CÓDIGO"><button id="join" class="secondary">Unirse</button></div></div>
    <p class="hint">WASD o flechas para moverte · Click para batear · Espacio para habilidad</p>
  </div>`;
  menu.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
    state.profile.color = button.dataset.color;
    menu.querySelectorAll('.color-dot').forEach((dot) => dot.classList.toggle('selected', dot === button));
  }));
  menu.querySelector('#settings-toggle').addEventListener('click', () => {
    const panel = menu.querySelector('#settings-panel');
    const open = panel.classList.toggle('hidden') === false;
    menu.querySelector('#settings-toggle').setAttribute('aria-expanded', String(open));
  });
  menu.querySelector('#graphics').addEventListener('change', (event) => {
    settings.graphics = event.target.value;
    localStorage.setItem('knockbit-graphics', settings.graphics);
    toastMessage(`Gráficos: ${GRAPHICS_PROFILES[settings.graphics].label}`);
  });
  menu.querySelector('#sound').addEventListener('change', (event) => {
    settings.sound = event.target.checked;
    localStorage.setItem('knockbit-sound', settings.sound ? 'on' : 'off');
    toastMessage(settings.sound ? 'Sonido activado.' : 'Sonido desactivado.');
  });
  menu.querySelector('#create').addEventListener('click', createRoom);
  menu.querySelector('#join').addEventListener('click', () => joinRoom(menu.querySelector('#room-code').value));
  menu.querySelector('#room-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(event.target.value); });
}

function code() { return Array.from(crypto.getRandomValues(new Uint8Array(5)), (value) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 30]).join(''); }
async function createRoom() {
  try { await authBoot; } catch { return; }
  const room = code();
  const player = profile();
  await set(ref(db, `rooms/${room}`), { host: state.id, createdAt: serverTimestamp(), state: { phase: 'lobby', map: 'circle', mode: 'territory', startedAt: null, winner: null, eliminationOrder: null }, players: { [state.id]: player }, strikes: null, pings: null });
  state.room = room;
  await onDisconnect(ref(db, `rooms/${room}/players/${state.id}`)).remove();
  watchRoom();
}
async function joinRoom(input) {
  try { await authBoot; } catch { return; }
  const room = input.trim().toUpperCase();
  if (!room) return toastMessage('Escribe el código de la sala.');
  const player = profile();
  const roomRef = ref(db, `rooms/${room}`);
  let accepted = false;
  onValue(roomRef, async (snapshot) => {
    if (accepted) return;
    const value = snapshot.val();
    if (!value) return toastMessage('Sala no encontrada.');
    if (value.state?.phase !== 'lobby') return toastMessage('La partida ya ha comenzado.');
    if (Object.keys(value.players || {}).length >= 8) return toastMessage('La sala está llena.');
    accepted = true;
    await update(ref(db, `rooms/${room}/players/${state.id}`), player);
    await onDisconnect(ref(db, `rooms/${room}/players/${state.id}`)).remove();
    state.room = room;
    watchRoom();
  }, { onlyOnce: true });
}

function watchRoom() {
  state.unsubscribe?.();
  state.hostChecked = false;
  state.unsubscribe = onValue(ref(db, `rooms/${state.room}`), (snapshot) => {
    state.roomValue = snapshot.val();
    if (!state.roomValue) return leaveToMenu();
    migrateHostIfNeeded();
    if (state.roomValue.state?.phase === 'playing') startGame();
    else if (state.roomValue.state?.phase === 'ended') showResults();
    else renderLobby();
  });
}

// Si el anfitrión se desconecta, el jugador restante con "joinedAt" más antiguo toma el mando.
function migrateHostIfNeeded() {
  if (state.hostChecked || !state.roomValue) return;
  const room = state.roomValue;
  const players = Object.keys(room.players || {});
  if (!players.length) return;
  if (players.includes(room.host)) { state.hostChecked = true; return; }
  const ordered = players.sort((a, b) => (room.players[a]?.joinedAt || 0) - (room.players[b]?.joinedAt || 0));
  if (ordered[0] !== state.id) return;
  state.hostChecked = true;
  update(ref(db, `rooms/${state.room}`), { host: state.id }).then(() => toastMessage('Ahora eres el anfitrión.'));
}

function updateMyProfile(patch) {
  state.profile = { ...state.profile, ...patch };
  if (state.room) update(ref(db, `rooms/${state.room}/players/${state.id}`), patch);
}
function renderLobby() {
  if (state.started) stopGame();
  menu.classList.add('hidden'); game.classList.add('hidden'); lobby.classList.remove('hidden');
  const room = state.roomValue;
  const players = Object.values(room.players || {});
  const mine = room.players?.[state.id] || state.profile;
  state.profile = { ...state.profile, ...mine };
  lobby.innerHTML = `<div class="card lobby-card">
    <div class="lobby-top"><div><p class="eyebrow">Sala privada</p><h2>${state.room}</h2></div><button id="copy" class="ghost">Copiar código</button></div>
    <div class="lobby-grid"><div><h3>Jugadores <span>${players.length}/8</span></h3><div class="player-list">${players.map((player) => `<div class="player-row"><span class="color-dot" style="--color:${esc(player.color)}"></span><strong>${esc(player.name || 'Jugador')}</strong>${player.id === room.host ? '<span class="host">ANFITRIÓN</span>' : ''}</div>`).join('')}</div><p class="hint">Comparte el código para invitar a tus amigos.</p></div>
    <div class="loadout"><h3>Tu equipamiento</h3><label>Pasiva</label><div class="choice-grid">${Object.entries(PASSIVES).map(([key, item]) => `<button class="choice ${mine.passive === key ? 'chosen' : ''}" data-passive="${key}"><b>${item.label}</b><small>${item.description}</small></button>`).join('')}</div><label>Habilidad · tecla Espacio</label><div class="choice-grid">${Object.entries(ABILITIES).map(([key, item]) => `<button class="choice ${mine.ability === key ? 'chosen' : ''}" data-ability="${key}"><b>${item.label}</b><small>${item.description}</small></button>`).join('')}</div></div></div>
    ${room.host === state.id ? `<div class="host-controls"><label>Modo <select id="mode">${Object.entries(GAME_MODES).map(([key, item]) => `<option value="${key}" ${(room.state?.mode || 'territory') === key ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label><label>Mapa <select id="map"><option value="circle" selected>Círculo</option></select></label><button id="start" class="primary" ${players.length < 2 ? 'disabled' : ''}>Empezar partida</button></div>` : `<p class="waiting">Esperando al anfitrión… · Modo: ${GAME_MODES[room.state?.mode || 'territory']?.label || 'Territorio'}</p>`}
    <button id="leave" class="ghost">Salir de la sala</button>
  </div>`;
  lobby.querySelector('#copy').addEventListener('click', async () => { await navigator.clipboard?.writeText(state.room); toastMessage('Código copiado.'); });
  lobby.querySelectorAll('[data-passive]').forEach((button) => button.addEventListener('click', () => updateMyProfile({ passive: button.dataset.passive })));
  lobby.querySelectorAll('[data-ability]').forEach((button) => button.addEventListener('click', () => updateMyProfile({ ability: button.dataset.ability })));
  lobby.querySelector('#leave').addEventListener('click', leaveRoom);
  lobby.querySelector('#map')?.addEventListener('change', (event) => update(ref(db, `rooms/${state.room}/state`), { map: event.target.value }));
  lobby.querySelector('#mode')?.addEventListener('change', (event) => update(ref(db, `rooms/${state.room}/state`), { mode: event.target.value }));
  lobby.querySelector('#start')?.addEventListener('click', () => update(ref(db, `rooms/${state.room}/state`), { phase: 'playing', startedAt: serverTimestamp(), winner: null, eliminationOrder: null }));
}

function startGame() {
  if (state.started) return;
  state.started = true;
  state.resultShown = false;
  game.querySelector('.result')?.remove();
  menu.classList.add('hidden'); lobby.classList.add('hidden'); game.classList.remove('hidden');
  const room = state.roomValue;
  const players = Object.entries(room.players || {}).map(([id, player]) => ({ ...player, id }));
  state.engine = new GameEngine(canvas, {
    players,
    meId: state.id,
    map: room.state?.map,
    mode: room.state?.mode || 'territory',
    graphics: settings.graphics,
    sound: settings.sound,
    onStrike: (strike) => push(ref(db, `rooms/${state.room}/strikes`), { ...strike, createdAt: serverTimestamp() }),
    onEliminate: (id) => {
      update(ref(db, `rooms/${state.room}/players/${id}`), { alive: false, hitsTaken: 0 });
      recordElimination(id);
    },
    onLoseLife: (lives) => update(ref(db, `rooms/${state.room}/players/${state.id}`), { lives, hitsTaken: state.engine?.me?.hitsTaken || 0 }),
    onWin: (winner) => { if (room.host === state.id) update(ref(db, `rooms/${state.room}/state`), { phase: 'ended', winner }); },
    onState: syncState,
  });
  state.engine.startedAt = room.state?.startedAt || Date.now();
  state.engine.start();
  state.gameUnsubs.push(onValue(ref(db, `rooms/${state.room}/players`), (snapshot) => {
    const remote = Object.entries(snapshot.val() || {}).map(([id, player]) => ({ ...player, id }));
    state.engine?.applyRemote(remote);
  }));
  state.gameUnsubs.push(onChildAdded(ref(db, `rooms/${state.room}/strikes`), (snapshot) => {
    const strike = snapshot.val();
    if (strike?.victim === state.id) state.engine?.applyStrike(strike);
  }));
  // Ping: offset de reloj del servidor + eco periódico propio.
  state.gameUnsubs.push(onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => { state.serverOffset = snapshot.val() || 0; }));
  state.gameUnsubs.push(onValue(ref(db, `rooms/${state.room}/pings/${state.id}`), (snapshot) => {
    const stamp = snapshot.val();
    if (typeof stamp === 'number') state.engine.pingMs = Date.now() + (state.serverOffset || 0) - stamp;
  }));
  state.pingTimer = setInterval(() => {
    if (!state.room) return;
    set(ref(db, `rooms/${state.room}/pings/${state.id}`), Date.now() + (state.serverOffset || 0)).catch(() => {});
  }, 5000);
}

// Cada cliente registra la eliminación que detecta; RTDB descarta duplicados por clave.
function recordElimination(id) {
  if (!state.room) return;
  const order = state.roomValue?.state?.eliminationOrder || {};
  const count = Object.keys(order).length;
  set(ref(db, `rooms/${state.room}/state/eliminationOrder/${count}`), id).catch(() => {});
}

let lastSync = 0;
function syncState(snapshot) {
  if (!state.room || !state.engine) return;
  const now = Date.now();
  if (now - lastSync < 65) return;
  lastSync = now;
  const me = snapshot.find((player) => player.id === state.id);
  if (!me) return;
  update(ref(db, `rooms/${state.room}/players/${state.id}`), {
    x: me.x,
    y: me.y,
    vx: me.vx,
    vy: me.vy,
    aim: me.aim,
    alive: me.alive,
    lives: me.lives,
    hitsTaken: me.hitsTaken,
    swingUntil: me.swingUntil,
    swingStarted: me.swingStarted,
    shieldUntil: me.shieldUntil,
    updatedAt: serverTimestamp(),
  });
}
function stopGame() {
  if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
  state.gameUnsubs.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.engine?.stop();
  state.engine = null;
  state.started = false;
}
function showResults() {
  if (state.resultShown) return;
  state.resultShown = true;
  stopGame();
  game.classList.remove('hidden'); lobby.classList.add('hidden'); menu.classList.add('hidden');
  const room = state.roomValue;
  const winner = room?.state?.winner;
  const winnerName = room?.players?.[winner]?.name || 'Nadie';
  // Ranking: ganador primero y después los eliminados en orden inverso (el último eliminado fue 2º).
  const order = Object.values(room?.state?.eliminationOrder || {});
  const eliminated = [...order].reverse().filter((id) => id !== winner);
  const rows = eliminated.map((id, index) => {
    const player = room?.players?.[id];
    return `<div class="result-row"><span>${index + 2}º</span><span class="color-dot" style="--color:${esc(player?.color || '#888')}"></span><strong>${esc(player?.name || 'Jugador')}</strong></div>`;
  }).join('');
  const result = document.createElement('div');
  result.className = 'result card';
  result.innerHTML = `<p class="eyebrow">Partida terminada</p><h2>${winner ? `🏆 ${esc(winnerName)} gana` : 'Empate'}</h2>${rows ? `<div class="result-ranking">${rows}</div>` : '<p>La arena ha hablado.</p>'}<button id="result-lobby" class="primary">Volver a la sala</button>`;
  game.append(result);
  result.querySelector('#result-lobby').addEventListener('click', () => { if (room?.host === state.id) update(ref(db, `rooms/${state.room}/state`), { phase: 'lobby', winner: null, startedAt: null, eliminationOrder: null }); });
}
async function leaveRoom() {
  if (!state.room) return leaveToMenu();
  state.leaving = true;
  const roomRef = ref(db, `rooms/${state.room}`);
  await remove(ref(db, `rooms/${state.room}/players/${state.id}`)).catch(() => {});
  // El último jugador en salir limpia la sala para que no se acumulen salas huérfanas.
  try {
    const snapshot = await get(ref(db, `rooms/${state.room}/players`));
    if (!snapshot.exists()) await remove(roomRef);
  } catch { /* si no podemos comprobarlo, dejamos la sala */ }
  state.leaving = false;
  leaveToMenu();
}
function leaveToMenu() { state.unsubscribe?.(); state.unsubscribe = null; state.room = ''; state.roomValue = null; stopGame(); game.querySelector('.result')?.remove(); lobby.classList.add('hidden'); game.classList.add('hidden'); menu.classList.remove('hidden'); renderMenu(); }
document.querySelector('#leave-game').addEventListener('click', leaveRoom);
renderMenu();
