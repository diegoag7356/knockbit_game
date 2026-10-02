import { onValue, onChildAdded, ref, set, update, push, remove, get, onDisconnect, serverTimestamp, runTransaction } from 'firebase/database';
import { authReady, db } from './firebase';
import { ABILITIES, COLORS, GAME_MODES, GameEngine, GRAPHICS_PROFILES, PASSIVES } from './game';
import './style.css';

const TURN_SECONDS = 15;
const LOADOUT_SECONDS = 15;
const MIN_BLACK_MS = 3000;   // el negro dura mínimo 3 s aunque todos carguen al instante
const AFTER_LOAD_MS = 1000;  // cuando todos cargan, +1 s y a la vez
const FINALE_DURATION_MS = 2600;
const LOAD_PHRASES = ['Cargando recursos…', 'Ya casi estamos…', 'Inicializando la arena…', 'Afinando el bate…', 'Puliendo cubys…'];

const app = document.querySelector('#app');
const settings = {
  graphics: localStorage.getItem('knockbit-graphics') || 'optimized',
  sound: localStorage.getItem('knockbit-sound') !== 'off',
};
const state = {
  id: '', room: '', profile: { name: localStorage.getItem('knockbit-name') || '', color: localStorage.getItem('knockbit-color') || COLORS[0], passive: 'alcance', ability: 'dash' },
  roomValue: null, unsubscribe: null, gameUnsubs: [], engine: null, started: false, resultShown: false, hostChecked: false, leaving: false,
  eliminationsRecorded: new Set(),
  screen: 'home', // home | gates | lobby | invite | ceremony | game
  ceremonyUnsubs: [], ceremonyTimer: null, ceremonyActive: false, ceremonyRenderedTurn: null,
  gateSentFor: '', gateShownFor: '', gatePoll: null, loadoutTick: null, countdownStarted: false, lastKickNonce: 0,
  serverOffset: 0, bootDone: false,
  previousPlayerIds: new Set(), hostMigrationAttemptedFor: '', matchResetFor: '', lastSavedMatchColor: '',
};
// La identidad en la base de datos es el UID de la Auth anónima: así las reglas
// pueden aislar la escritura de cada jugador ($playerId === auth.uid).
onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
  state.serverOffset = Number(snapshot.val()) || 0;
  if (state.engine) state.engine.serverOffset = state.serverOffset;
});
const serverNow = () => Date.now() + state.serverOffset;

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
    <section id="game" class="screen game-screen hidden">
      <canvas id="arena"></canvas>
      <div id="loadout-overlay" class="hidden"></div>
      <div id="countdown" class="hidden"></div>
      <button id="leave-game" class="ghost small">Salir</button>
      <div id="pause-menu" class="hidden"></div>
    </section>
    <div id="curtain" class="curtain"><div class="curtain-label"></div></div>
    <div id="preloader" class="preloader hidden"></div>
    <div id="ceremony" class="ceremony hidden"></div>
    <div id="toast" class="toast"></div>
  </main>`;
const menu = document.querySelector('#menu');
const lobby = document.querySelector('#lobby');
const game = document.querySelector('#game');
const canvas = document.querySelector('#arena');
const toast = document.querySelector('#toast');
const curtain = document.querySelector('#curtain');
const preloader = document.querySelector('#preloader');
const ceremonyEl = document.querySelector('#ceremony');

// El cargador de arranque (index.html) desaparece en cuanto el JS monta el menú.
function finishBoot() {
  if (state.bootDone) return;
  state.bootDone = true;
  document.querySelector('#boot')?.classList.add('done');
  setTimeout(() => document.querySelector('#boot')?.remove(), 500);
}
setTimeout(finishBoot, 2500);

function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }

function showSection(name) {
  state.screen = name;
  menu.classList.toggle('hidden', name !== 'home' && name !== 'gates' && name !== 'invite');
  lobby.classList.toggle('hidden', name !== 'lobby');
  game.classList.toggle('hidden', name !== 'game');
  ceremonyEl.classList.toggle('hidden', name !== 'ceremony');
}

function curtainClose(label = 'Un momento…', ms = 900) {
  curtain.querySelector('.curtain-label').textContent = label;
  curtain.classList.add('closed');
  return new Promise((resolve) => setTimeout(() => { resolve(); }, ms));
}
function curtainOpen() { curtain.classList.remove('closed'); }

function profile() {
  state.profile.name = document.querySelector('#name')?.value.trim() || state.profile.name || 'Jugador';
  localStorage.setItem('knockbit-name', state.profile.name);
  localStorage.setItem('knockbit-color', state.profile.color);
  return { ...state.profile, id: state.id, joinedAt: serverNow(), alive: true, lives: 3, hitsTaken: 0 };
}

// Jugadores ordenados: anfitrión primero, luego orden de unión (joinedAt).
function orderedPlayers(room) {
  const host = room?.host;
  return Object.entries(room?.players || {})
    .map(([id, player]) => ({ ...player, id }))
    .sort((a, b) => {
      if (a.id === host) return -1;
      if (b.id === host) return 1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
}

function setRoomUrl(code) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('sala', code);
  else url.searchParams.delete('sala');
  window.history.replaceState(null, '', url);
}

function writeOwnRoomState(path, value) {
  if (!state.room) return Promise.reject(new Error('No active room'));
  return set(ref(db, `rooms/${state.room}/state/${path}`), value);
}
function writePlayerStateMarkers(key, values) {
  return Promise.all(Object.entries(values).map(([playerId, value]) =>
    set(ref(db, `rooms/${state.room}/state/${key}/${playerId}`), value)));
}
function clearPlayerStateMarkers(keys, playerIds = Object.keys(state.roomValue?.players || {})) {
  return Promise.all(keys.flatMap((key) => playerIds.map((playerId) =>
    set(ref(db, `rooms/${state.room}/state/${key}/${playerId}`), null))));
}
function writeRoomStateFields(values) {
  const { phase, ...fields } = values;
  return Promise.all(Object.entries(fields).map(([key, value]) =>
    set(ref(db, `rooms/${state.room}/state/${key}`), value)))
    .then(() => Object.hasOwn(values, 'phase')
      ? set(ref(db, `rooms/${state.room}/state/phase`), phase)
      : undefined);
}
function inviteUrl(code) {
  const url = new URL(window.location.href);
  url.search = `?sala=${code}`;
  return url.toString();
}

/* ================= MENÚ (capa 1: nombre + JUGAR) ================= */

// Puestos de los cubys decorativos del menú: lejos del centro para no tapar la tarjeta.
const MENU_CUBYS = [
  [4, 12, 46], [13, 68, 34], [22, 26, 28], [31, 82, 40],
  [70, 10, 38], [79, 40, 30], [88, 74, 44], [66, 62, 26],
  [46, 6, 24], [92, 18, 26], [6, 44, 24], [58, 88, 32],
];

function renderMenu() {
  finishBoot();
  showSection('home');
  const confetti = MENU_CUBYS.map((spot, index) => {
    const color = COLORS[index % COLORS.length];
    return `<span class="cuby" style="--x:${spot[0]}%;--y:${spot[1]}%;--size:${spot[2]}px;--jump:-${14 + (index % 4) * 7}px;--delay:${(index % 6) * 0.11}s;--tilt:${index % 2 ? 5 : -5}deg;--cuby-color:${color}"></span>`;
  }).join('');
  menu.innerHTML = `<div class="hero-stage">
    <div class="menu-cubys" aria-hidden="true">${confetti}</div>
    <div class="card hero-card">
    <span class="tape tr" aria-hidden="true"></span>
    <div class="menu-heading">
      <div class="brand"><span class="brand-k" aria-hidden="true"><span class="eye"><i></i><i></i></span></span><span class="word">KNOCK<span class="accent">BIT</span></span></div>
      <button id="settings-toggle" class="settings-toggle" aria-expanded="false">⚙ Ajustes</button>
    </div>
    <div id="settings-panel" class="settings-panel hidden">
      <div class="settings-title"><strong>Ajustes</strong><span>Se guardan en este dispositivo</span></div>
      <label class="field-label" for="graphics">Gráficos</label>
      <select id="graphics" class="text-input">${Object.entries(GRAPHICS_PROFILES).map(([key, item]) => `<option value="${key}" ${settings.graphics === key ? 'selected' : ''}>${item.label}</option>`).join('')}</select>
      <p class="settings-help">Optimizado reduce el coste en equipos modestos; Alto usa más resolución y partículas.</p>
      <label class="sound-setting"><input id="sound" type="checkbox" ${settings.sound ? 'checked' : ''}> Sonido de combate</label>
    </div>
    <label class="field-label" for="name">Tu nombre</label>
    <input id="name" class="text-input name-input" maxlength="16" value="${esc(state.profile.name)}" placeholder="Escribe tu nombre" autocomplete="off">
    <button id="play" class="play-cta">JUGAR</button>
    </div>
  </div>`;
  menu.querySelector('#settings-toggle').addEventListener('click', () => {
    const panel = menu.querySelector('#settings-panel');
    const open = panel.classList.toggle('hidden') === false;
    menu.querySelector('#settings-toggle').setAttribute('aria-expanded', String(open));
  });
  menu.querySelector('#graphics').addEventListener('change', (event) => {
    settings.graphics = event.target.value;
    localStorage.setItem('knockbitgraphics', settings.graphics);
    localStorage.setItem('knockbit-graphics', settings.graphics);
    toastMessage(`Gráficos: ${GRAPHICS_PROFILES[settings.graphics].label}`);
  });
  menu.querySelector('#sound').addEventListener('change', (event) => {
    settings.sound = event.target.checked;
    localStorage.setItem('knockbit-sound', settings.sound ? 'on' : 'off');
    toastMessage(settings.sound ? 'Sonido activado.' : 'Sonido desactivado.');
  });
  menu.querySelector('#play').addEventListener('click', animateToGates);
  menu.querySelector('#name').addEventListener('keydown', (event) => { if (event.key === 'Enter') animateToGates(); });
}

function animateToGates() {
  state.profile.name = menu.querySelector('#name')?.value.trim() || 'Jugador';
  localStorage.setItem('knockbit-name', state.profile.name);
  menu.classList.add('screen-out');
  setTimeout(() => { menu.classList.remove('screen-out'); renderGates(); }, 260);
}

/* ============ CAPA 2: crear sala o unirse ============ */

function renderGates() {
  if (!state.profile.name) state.profile.name = 'Jugador';
  showSection('gates');
  menu.innerHTML = `<div class="card gate-card">
    <span class="tape tr" aria-hidden="true"></span>
    <p class="eyebrow">¿Cómo quieres jugar?</p>
    <h2 class="gate-title">Crear <span class="accent">o</span> unirse</h2>
    <div class="menu-actions">
      <button id="create" class="primary">Crear sala</button>
      <button id="show-join" class="secondary">Unirse a sala</button>
    </div>
    <div id="join-panel" class="hidden">
      <label class="field-label">Código de la sala</label>
      <div class="code-boxes">
        ${[0, 1, 2, 3, 4].map((index) => `<input id="code-${index}" class="code-box" maxlength="1" inputmode="text" autocomplete="off" spellcheck="false" aria-label="Carácter ${index + 1} del código">`).join('')}
      </div>
      <div class="menu-actions"><button id="join" class="primary">Unirse</button></div>
    </div>
    <button id="back-home" class="ghost gate-back">← Volver</button>
  </div>`;
  const joinPanel = menu.querySelector('#join-panel');
  const boxes = [...menu.querySelectorAll('.code-box')];
  const codeValue = () => boxes.map((box) => box.value.toUpperCase()).join('');

  menu.querySelector('#create').addEventListener('click', createRoom);
  menu.querySelector('#show-join').addEventListener('click', () => {
    joinPanel.classList.remove('hidden');
    menu.querySelector('#show-join').disabled = true;
    menu.querySelector('#create').disabled = true;
    boxes[0].focus();
  });
  boxes.forEach((box, index) => {
    box.addEventListener('input', () => {
      // Pegar un código completo rellena las 5 casillas.
      if (box.value.length > 1) {
        const paste = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        boxes.forEach((target, targetIndex) => { target.value = paste[targetIndex] || ''; });
        boxes[Math.min(paste.length, 4)].focus();
      } else {
        box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
        if (box.value && index < 4) boxes[index + 1].focus();
      }
      boxes.forEach((target) => target.classList.toggle('filled', !!target.value));
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !box.value && index > 0) boxes[index - 1].focus();
      if (event.key === 'Enter') joinRoom(codeValue());
    });
    box.addEventListener('paste', (event) => {
      event.preventDefault();
      const paste = (event.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      boxes.forEach((target, targetIndex) => { target.value = paste[targetIndex] || ''; });
      boxes[Math.min(paste.length, 4)].focus();
      boxes.forEach((target) => target.classList.toggle('filled', !!target.value));
    });
  });
  menu.querySelector('#join').addEventListener('click', () => joinRoom(codeValue()));
  menu.querySelector('#back-home').addEventListener('click', renderMenu);
}

/* ============ SALAS ============ */

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (value) => alphabet[Math.floor(value * alphabet.length / 256)]).join('');
}

async function createRoom() {
  const room = code();
  let roomPlayerRef;
  let roomCreated = false;
  try {
    await authBoot;
    await curtainClose('Preparando sala…', 950);
    state.profile.name = document.querySelector('#name')?.value.trim() || state.profile.name || 'Jugador';

    const player = profile();
    roomPlayerRef = ref(db, `rooms/${room}/players/${state.id}`);
    await onDisconnect(roomPlayerRef).remove();
    const roomCreation = await runTransaction(ref(db, `rooms/${room}`), (current) => current ? undefined : ({
      host: state.id,
      createdAt: serverNow(),
      state: {
        phase: 'lobby', map: 'circle', mode: 'territory', startedAt: null, winner: null,
        eliminationOrder: null, turn: null, turnEndsAt: null, colorReady: null,
        colorShown: null, gameReady: null, gameShown: null, spawnDone: null, countdownAt: null,
      },
      players: { [state.id]: player }, strikes: null, pings: null,
    }));
    if (!roomCreation.committed) {
      await onDisconnect(roomPlayerRef).cancel();
      throw new Error('El código de sala ya estaba ocupado.');
    }
    roomCreated = true;
    state.room = room;
    state.eliminationsRecorded.clear();
    state.wasPlaying = false;
    state.ceremonyStartRequested = false;
    state.matchResetFor = '';
    state.hostMigrationAttemptedFor = '';
    state.lastSavedMatchColor = '';
    setRoomUrl(room);
    watchRoom();
  } catch (error) {
    if (roomPlayerRef && !roomCreated) await onDisconnect(roomPlayerRef).cancel().catch(() => {});
    if (roomCreated) await remove(ref(db, `rooms/${room}`)).catch(() => {});
    console.error('No se pudo crear la sala', error);
    curtainOpen();
    toastMessage('No se pudo crear la sala. Comprueba tu conexión.');
  }
}

async function joinRoom(input) {
  try { await authBoot; } catch { return; }
  const room = String(input || '').trim().toUpperCase();
  if (room.length !== 5) return toastMessage('El código tiene 5 caracteres.');
  state.profile.name = document.querySelector('#name')?.value.trim() || state.profile.name || 'Jugador';
  const player = profile();
  const playerRef = ref(db, `rooms/${room}/players/${state.id}`);
  try {
    await onDisconnect(playerRef).remove();
    const roomRef = ref(db, `rooms/${room}`);
    const snapshot = await get(roomRef);
    const value = snapshot.val();
    if (!value) { await onDisconnect(playerRef).cancel(); return toastMessage('Sala no encontrada.'); }
    if (value.state?.phase !== 'lobby') { await onDisconnect(playerRef).cancel(); return toastMessage('La partida ya ha comenzado.'); }
    const existingPlayers = Object.keys(value.players || {});
    if (!value.players?.[state.id] && existingPlayers.length >= 8) { await onDisconnect(playerRef).cancel(); return toastMessage('La sala está llena.'); }
    const join = await runTransaction(playerRef, (current) => current || player);
    if (!join.committed) {
      await onDisconnect(ref(db, `rooms/${room}/players/${state.id}`)).cancel();
      return toastMessage('No se pudo reservar un puesto en la sala.');
    }
    state.room = room;
    state.eliminationsRecorded.clear();
    state.wasPlaying = false;
    state.ceremonyStartRequested = false;
    state.matchResetFor = '';
    state.hostMigrationAttemptedFor = '';
    state.lastSavedMatchColor = '';
    setRoomUrl(room);
    watchRoom();
  } catch (error) {
    await onDisconnect(playerRef).cancel().catch(() => {});
    console.error('No se pudo unirse a la sala', error);
    toastMessage('No se pudo entrar a la sala. Comprueba tu conexión.');
  }
}

// Pantalla de invitación directa por URL (?sala=XXXXX).
async function renderInvite(code) {
  try { await authBoot; } catch { return; }
  const snapshot = await get(ref(db, `rooms/${code}`)).catch((error) => { console.error('No se pudo comprobar la invitación', error); return null; });
  if (!snapshot) { toastMessage('No se pudo comprobar la sala. Revisa tu conexión.'); return renderMenu(); }
  if (!snapshot.exists()) { toastMessage('Esa sala ya no existe.'); setRoomUrl(null); return renderMenu(); }
  const room = snapshot.val();
  if (room.state?.phase !== 'lobby') { toastMessage('La partida ya ha comenzado.'); setRoomUrl(null); return renderMenu(); }
  setRoomUrl(code);
  const players = orderedPlayers(room);
  const hostName = players[0]?.name || 'Alguien';
  showSection('invite');
  menu.innerHTML = `<div class="card gate-card invite-wrap">
    <span class="tape tr" aria-hidden="true"></span>
    <p class="eyebrow">Invitación</p>
    <div class="invite-avatars">${players.slice(0, 5).map((player) => `<span class="cuby" style="background:${esc(player.color)}"></span>`).join('')}</div>
    <h2 class="gate-title">${esc(hostName)} te está<br>invitando a <span class="accent">una sala</span></h2>
    <label class="field-label" for="name">Tu nombre</label>
    <input id="name" class="text-input name-input" maxlength="16" value="${esc(state.profile.name)}" placeholder="Escribe tu nombre" autocomplete="off">
    <div class="menu-actions"><button id="join-invite" class="primary">Unirte</button></div>
  </div>`;
  menu.querySelector('#join-invite').addEventListener('click', () => joinRoom(code));
}

function watchRoom() {
  state.unsubscribe?.();
  state.hostChecked = false;
  state.lastKickNonce = Number(state.roomValue?.state?.kickNonce || 0);
  state.previousPlayerIds = new Set(Object.keys(state.roomValue?.players || {}));
  const watchedRoom = state.room;
  state.unsubscribe = onValue(ref(db, `rooms/${watchedRoom}`), (snapshot) => {
    state.roomValue = snapshot.val();
    if (!state.roomValue) return leaveToMenu();
    if (!state.roomValue.players?.[state.id] && !state.leaving) {
      if (state.roomValue.host === state.id && !Object.keys(state.roomValue.players || {}).length) {
        if (state.previousPlayerIds.has(state.id)) {
          setTimeout(() => remove(ref(db, `rooms/${watchedRoom}`)).catch(() => {}), 0);
          return leaveToMenu();
        }
        return;
      }
      if (state.previousPlayerIds.has(state.id)) {
        toastMessage('Te han sacado de la sala.');
        state.unsubscribe?.();
        state.unsubscribe = null;
        state.room = '';
        setTimeout(leaveToMenu, 450);
        return;
      }
      // Algunos SDKs notifican primero la creación vacía antes de confirmar
      // la escritura inicial del anfitrión. No abandonar la sala en esa carrera.
      if (state.roomValue.host !== state.id) return;
    }
    const currentPlayerIds = new Set(Object.keys(state.roomValue.players || {}));
    if (state.roomValue.host === state.id) {
      for (const departedId of state.previousPlayerIds) {
        if (currentPlayerIds.has(departedId)) continue;
        for (const node of ['spawnDone', 'colorReady', 'colorShown', 'gameReady', 'gameShown', 'pendingColors', 'colorsLocked', 'colorConfirm']) {
          remove(ref(db, `rooms/${state.room}/state/${node}/${departedId}`)).catch(() => {});
        }
        const roomState = state.roomValue.state || {};
        if (roomState.turn === departedId) {
          const order = roomState.colorOrder || [];
          const next = order.slice(order.indexOf(departedId) + 1).find((id) => currentPlayerIds.has(id) && !roomState.colorsLocked?.[id]);
          const turnUpdate = next
            ? { turn: next, turnIndex: order.indexOf(next), turnEndsAt: serverNow() + TURN_SECONDS * 1000 }
            : { phase: 'color-finale', turn: null, turnEndsAt: null, finaleAt: serverNow() };
          writeRoomStateFields(turnUpdate).catch(() => {});
        }
      }
    }
    state.previousPlayerIds = currentPlayerIds;
    migrateHostIfNeeded();
    const phase = state.roomValue.state?.phase;
    const lockedColor = state.roomValue.state?.colorsLocked?.[state.id];
    if (lockedColor && ['color-turns', 'color-finale', 'game-loading'].includes(phase)) {
      state.profile.color = lockedColor;
      localStorage.setItem('knockbit-color', lockedColor);
      const colorMarker = `${state.roomValue.state?.colorBlackStartedAt}:${lockedColor}`;
      if (state.lastSavedMatchColor !== colorMarker) {
        state.lastSavedMatchColor = colorMarker;
        update(ref(db, `rooms/${state.room}/players/${state.id}`), { color: lockedColor }).catch((error) => {
          state.lastSavedMatchColor = '';
          console.error('No se pudo guardar el color', error);
        });
      }
    }
    const kickNonce = Number(state.roomValue.state?.kickNonce || 0);
    if (kickNonce > state.lastKickNonce) {
      state.lastKickNonce = kickNonce;
      if (state.roomValue.state?.kick === state.id) {
        toastMessage('El anfitrión te ha expulsado de la sala.');
        setTimeout(() => leaveRoom(), 500);
        return;
      }
    }
    if (state.ceremonyActive && phase === 'lobby') return;
    if (['color-loading', 'color-turns', 'color-finale', 'game-loading'].includes(phase)) {
      if (!state.ceremonyActive) startCeremony();
      return;
    }
    if (phase === 'playing') { state.wasPlaying = true; startGame(); }
    else if (phase === 'ended') showResults();
    else if (!state.ceremonyActive) {
      const mine = state.roomValue.players?.[state.id];
      if (phase === 'lobby' && !mine?.ready) state.ceremonyStartRequested = false;
      if (phase === 'lobby' && state.wasPlaying) {
        state.wasPlaying = false;
        state.ceremonyStartRequested = false;
      }
      renderLobby();
    }
  }, (error) => {
    if (state.room !== watchedRoom || state.leaving) return;
    console.error('Se perdió el acceso a la sala', error);
    toastMessage('Ya no tienes acceso a esta sala.');
    leaveToMenu();
  });
}

// Si el anfitrión se desconecta, el jugador restante con "joinedAt" más antiguo toma el mando.
function migrateHostIfNeeded() {
  if (!state.roomValue) return;
  const room = state.roomValue;
  const players = Object.keys(room.players || {});
  if (!players.length) return;
  if (players.includes(room.host)) {
    state.hostMigrationAttemptedFor = '';
    return;
  }
  const ordered = players.sort((a, b) =>
    (room.players[a]?.joinedAt || 0) - (room.players[b]?.joinedAt || 0) || a.localeCompare(b));
  if (ordered[0] !== state.id) return;
  const attempt = `${room.host || 'missing'}:${state.id}`;
  if (state.hostMigrationAttemptedFor === attempt) return;
  state.hostMigrationAttemptedFor = attempt;
  set(ref(db, `rooms/${state.room}/host`), state.id)
    .then(() => toastMessage('Ahora eres el anfitrión.'))
    .catch((error) => {
      state.hostMigrationAttemptedFor = '';
      console.error('No se pudo transferir el anfitrión', error);
    });
}

async function preparePlayerForMatch(startedAt) {
  const matchId = String(startedAt || '');
  if (!state.room || !matchId || state.matchResetFor === matchId) return;
  state.matchResetFor = matchId;
  try {
    await update(ref(db, `rooms/${state.room}/players/${state.id}`), {
      ready: false, alive: true, lives: 3, hitsTaken: 0,
      x: null, y: null, vx: null, vy: null, aim: null,
      swingUntil: null, swingStarted: null, swingReadyAt: null,
      shieldUntil: null, abilityUntil: null, updatedAt: null,
    });
    const resetMarkers = [
      ['colorReady', false],
      ['colorShown', serverNow()],
      ['pendingColors', '#aeb4c0'],
      ['colorConfirm', null],
    ];
    await Promise.all(resetMarkers.map(([key, value]) => writeOwnRoomState(`${key}/${state.id}`, value)));
  } catch (error) {
    state.matchResetFor = '';
    console.error('No se pudo preparar al jugador para la partida', error);
    toastMessage('No se pudo sincronizar tu estado de partida.');
  }
}

function updateMyProfile(patch) {
  state.profile = { ...state.profile, ...patch };
  if (state.roomValue?.players?.[state.id]) Object.assign(state.roomValue.players[state.id], patch);

  if (state.engine?.me) Object.assign(state.engine.me, patch);
  if (state.room) update(ref(db, `rooms/${state.room}/players/${state.id}`), patch).catch(() => {});
}

/* ============ SALA (panel de control) ============ */

function renderLobby() {
  if (state.started) stopGame();
  finishBoot();
  showSection('lobby');
  const room = state.roomValue;
  const players = orderedPlayers(room);
  const mine = room.players?.[state.id] || state.profile;
  state.profile = { ...state.profile, ...mine };
  const amHost = room.host === state.id;
  const readyCount = players.filter((player) => player.ready).length;
  const allReady = players.length >= 2 && readyCount === players.length;
  lobby.innerHTML = `<div class="card lobby-card">
    <span class="tape tr" aria-hidden="true"></span>
    <div class="lobby-top">
      <div><p class="eyebrow">Sala privada</p><h2>${state.room}</h2></div>
      <div class="room-actions"><button id="copy" class="ghost copy-btn">Copiar invitación</button></div>
    </div>
    <div class="lobby-list">
      <h3>Jugadores <span>${players.length}/8</span></h3>
      <div class="player-list">
        ${players.map((player) => `<div class="player-row ${player.id === room.host ? 'has-host' : ''}">
          <span class="cuby" style="background:${esc(player.color)}"></span>
          <strong>${esc(player.name || 'Jugador')}</strong>
          ${player.id === state.id ? '<span class="you">TÚ</span>' : ''}
          ${player.ready ? '<span class="ready-mark">✓ listo</span>' : ''}
          ${player.id === room.host ? '<span class="host-tag">ANFITRIÓN</span>' : ''}
          ${amHost && player.id !== state.id ? `<button class="kick-btn" data-kick="${player.id}">Expulsar</button>` : ''}
        </div>`).join('')}
      </div>
      <p class="hint">Comparte el código o la invitación. Todos deben darle a LISTO para arrancar.</p>
    </div>
    <div class="ready-strip">
      <button id="ready" class="ready-btn ${mine.ready ? 'on' : ''}">${mine.ready ? 'CANCELAR' : 'LISTO'}</button>
      ${amHost ? `<button id="start" class="primary start-btn" ${!allReady ? 'disabled' : ''}>¡A JUGAR!</button><span class="ready-count">${readyCount}/${players.length} listos</span>` : `<span class="ready-count">Esperando a todos… ${readyCount}/${players.length} listos</span>`}
    </div>
    <button id="leave" class="ghost leave-btn">Salir de la sala</button>
  </div>`;
  lobby.querySelector('#copy').addEventListener('click', async () => {
    const link = inviteUrl(state.room);
    try {
      await navigator.clipboard.writeText(link);
      toastMessage('Enlace de la sala copiado.');
    } catch {
      toastMessage(`Copia este enlace: ${link}`);
    }
  });
  lobby.querySelector('#ready').addEventListener('click', () => updateMyProfile({ ready: !mine.ready }));
  lobby.querySelector('#start')?.addEventListener('click', () => {
    if (!players.every((player) => player.ready)) return toastMessage('Faltan jugadores por dar a LISTO.');
    beginCeremonyAsHost();
  });
  lobby.querySelectorAll('[data-kick]').forEach((button) => button.addEventListener('click', async () => {
    const target = button.dataset.kick;
    try {
      await remove(ref(db, `rooms/${state.room}/players/${target}`));
      toastMessage('Jugador expulsado.');
    } catch (error) {
      console.error('No se pudo expulsar', error);
      toastMessage('No se pudo expulsar al jugador.');
    }
  }));
  lobby.querySelector('#leave').addEventListener('click', leaveRoom);
  curtainOpen();
  // No iniciar hasta que haya al menos dos jugadores y todos estén listos.
  if (allReady && amHost) beginCeremonyAsHost();
}

/* ============ CEREMONIA DE COLORES ============ */

// El anfitrión abre la ceremonia: fase 'color-turns' + gate de recursos.
async function beginCeremonyAsHost() {
  if (state.ceremonyStartRequested || state.roomValue?.host !== state.id) return;
  state.ceremonyStartRequested = true;
  const players = orderedPlayers(state.roomValue);
  if (players.length < 2 || !players.every((player) => player.ready)) {
    state.ceremonyStartRequested = false;
    return toastMessage('Todos deben estar listos antes de comenzar.');
  }
  const colorOrder = players.map((player) => player.id);
  state.eliminationsRecorded.clear();
  state.matchResetFor = '';
  try {
    await remove(ref(db, `rooms/${state.room}/strikes`)).catch(() => {});
    const phaseState = {
      colorOrder,
      turn: null,
      turnIndex: 0,
      turnEndsAt: null,
      colorBlackStartedAt: serverNow(),
      colorAllReadyAt: null,
      finaleAt: null,
      gameBlackStartedAt: null,
      gameAllReadyAt: null,
      countdownAt: null,
      startedAt: null,
      playAt: null,
    };
    const markerWrites = [
      writePlayerStateMarkers('colorReady', Object.fromEntries(colorOrder.map((id) => [id, false]))),
      writePlayerStateMarkers('colorShown', Object.fromEntries(colorOrder.map((id) => [id, 0]))),
      writePlayerStateMarkers('pendingColors', Object.fromEntries(colorOrder.map((id) => [id, '#aeb4c0']))),
      writePlayerStateMarkers('colorConfirm', Object.fromEntries(colorOrder.map((id) => [id, null]))),
      writePlayerStateMarkers('colorsLocked', Object.fromEntries(colorOrder.map((id) => [id, null]))),
      writePlayerStateMarkers('gameReady', Object.fromEntries(colorOrder.map((id) => [id, null]))),
      writePlayerStateMarkers('gameShown', Object.fromEntries(colorOrder.map((id) => [id, null]))),
      writePlayerStateMarkers('spawnDone', Object.fromEntries(colorOrder.map((id) => [id, null]))),
    ];
    await writeRoomStateFields(phaseState);
    await Promise.all(markerWrites);
    await set(ref(db, `rooms/${state.room}/state/phase`), 'color-loading');
  } catch (error) {
    state.ceremonyStartRequested = false;
    console.error('No se pudo iniciar la ceremonia', error);
    toastMessage('No se pudo iniciar la ceremonia.');
  }
}

async function preloadForGate() {

  try {
    await Promise.race([
      Promise.all([document.fonts?.ready || Promise.resolve(), new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))]),
    ]);
    const warmCanvas = document.createElement('canvas');
    warmCanvas.width = 220;
    warmCanvas.height = 220;
    const context = warmCanvas.getContext('2d');
    context?.fillRect(0, 0, 1, 1);
  } catch { /* los recursos canvas no requieren descargas */ }
}

async function signalGateReady(phase) {
  if (!state.room || state.gateSentFor === phase) return;
  state.gateSentFor = phase;
  const shownKey = phase === 'color-loading' ? 'colorShown' : 'gameShown';
  const readyKey = phase === 'color-loading' ? 'colorReady' : 'gameReady';
  try {
    if (state.gateShownFor !== phase) {
      state.gateShownFor = phase;
      await writeOwnRoomState(`${shownKey}/${state.id}`, serverNow());
    }
    await preloadForGate();
    if (phase === 'color-loading') await preparePlayerForMatch(state.roomValue?.state?.colorBlackStartedAt);
    if (phase === 'game-loading') {
      const gameMarkers = [['gameReady', false], ['gameShown', serverNow()]];
      await Promise.all(gameMarkers.map(([key, value]) => writeOwnRoomState(`${key}/${state.id}`, value)));
    }
    await writeOwnRoomState(`${readyKey}/${state.id}`, true);
  } catch (error) {
    state.gateSentFor = '';
    state.gateShownFor = '';
    console.error('No se pudo confirmar la carga', error);
  }
}

function startCeremony() {
  state.ceremonyActive = true;
  state.gateSentFor = '';
  state.gateShownFor = '';
  state.ceremonyRenderedTurn = null;
  state.turnCommitInFlight = '';
  stopGame();

  showSection('ceremony');
  state.ceremonyUnsubs.push(onValue(ref(db, `rooms/${state.room}/state`), (snapshot) => {
    const roomState = snapshot.val() || {};
    if (state.roomValue) state.roomValue.state = roomState;
    if (roomState.phase === 'playing' || roomState.phase === 'ended') return;
    renderCeremonyFrame(roomState);
  }));
  state.ceremonyTimer = setInterval(tickCeremony, 200);
}

function preloaderHtml(percent, phrase, indeterminate) {
  return `<div class="preloader-inner">
    <div class="preloader-logo">KNOCK<span class="accent">BIT</span></div>
    <div class="preloader-status">${esc(phrase)}</div>
    <div class="preloader-bar ${indeterminate ? 'indeterminate' : ''}"><i style="width:${percent}%"></i></div>
    <div class="preloader-hint">Preparando la ceremonia de colores</div>
  </div>`;
}

// Gate: todos deben tener los recursos cargados; negro mínimo 3 s; +1 s cuando todos listos.
function gateProgressHtml(progress, phrase, waiting) {
  return `<div class="preloader-inner">
    <div class="preloader-logo">KNOCK<span class="accent">BIT</span></div>
    <div class="preloader-status">${esc(phrase)}</div>
    <div class="preloader-bar ${waiting ? 'indeterminate' : ''}"><i style="width:${progress}%"></i></div>
    <div class="preloader-hint">${waiting ? 'Esperando a los demás jugadores' : 'Todos listos · un segundo…'}</div>
  </div>`;
}

function renderCeremonyFrame(roomState) {
  if (state.screen !== 'ceremony') showSection('ceremony');
  if (state.gatePhase !== roomState.phase) {
    state.gatePhase = roomState.phase;
    state.gateSentFor = '';
    state.gateReleaseInFlight = '';
    state.gateStampInFlight = '';
    state.lastGateMarkup = '';
  }
  const players = orderedPlayers(state.roomValue);
  if (!players.length) return;
  if (roomState.phase === 'color-loading' || roomState.phase === 'game-loading') {
    const isColor = roomState.phase === 'color-loading';
    const readyMap = isColor ? roomState.colorReady || {} : roomState.gameReady || {};
    const shownMap = isColor ? roomState.colorShown || {} : roomState.gameShown || {};
    const readyCount = players.filter((player) => readyMap[player.id] === true).length;
    const allReady = players.every((player) => readyMap[player.id] === true);
    const allShown = players.every((player) => Number(shownMap[player.id]) > 0);
    const latestBlackShown = Math.max(0, ...players.map((player) => Number(shownMap[player.id]) || 0));
    const blackStart = Number(isColor ? roomState.colorBlackStartedAt : roomState.gameBlackStartedAt) || serverNow();
    const allReadyAt = Number(isColor ? roomState.colorAllReadyAt : roomState.gameAllReadyAt) || 0;
    preloader.classList.remove('hidden');
    ceremonyEl.classList.add('hidden');
    const phrase = LOAD_PHRASES[Math.floor(Date.now() / 1400) % LOAD_PHRASES.length];
    const markup = gateProgressHtml(Math.round(100 * readyCount / players.length), phrase, !allReady);
    if (markup !== state.lastGateMarkup) {
      preloader.innerHTML = markup;
      state.lastGateMarkup = markup;
    }
    if (state.gateSentFor !== roomState.phase) signalGateReady(roomState.phase);

    if (state.roomValue.host === state.id) {
      if (allReady && allShown && !allReadyAt && state.gateStampInFlight !== roomState.phase) {
        state.gateStampInFlight = roomState.phase;
        const stampKey = isColor ? 'colorAllReadyAt' : 'gameAllReadyAt';
        set(ref(db, `rooms/${state.room}/state/${stampKey}`), serverNow()).catch(() => { state.gateStampInFlight = ''; });
      } else if (allReady && allShown && allReadyAt) {
        const releaseAt = Math.max(blackStart + MIN_BLACK_MS, latestBlackShown + MIN_BLACK_MS, allReadyAt + AFTER_LOAD_MS);
        if (serverNow() >= releaseAt && state.gateReleaseInFlight !== roomState.phase) {
          state.gateReleaseInFlight = roomState.phase;
          const transition = isColor
            ? (() => {
                const colorOrder = (roomState.colorOrder || players.map((player) => player.id)).filter((id) => players.some((player) => player.id === id));
                return { turn: colorOrder[0], turnIndex: 0, turnEndsAt: serverNow() + TURN_SECONDS * 1000, colorOrder, phase: 'color-turns' };
              })()
            : { startedAt: serverNow(), playAt: null, countdownAt: null, phase: 'playing' };
          writeRoomStateFields(transition)
            .catch(() => { state.gateReleaseInFlight = ''; });
        }
      }
    }
    return;
  }

  preloader.classList.add('hidden');
  ceremonyEl.classList.remove('hidden');
  if (roomState.phase === 'color-turns') {
    renderCeremonyTurn(roomState, players);
  } else if (roomState.phase === 'color-finale') {
    renderColorFinale(roomState, players);
  }
}

function playersFromLoadouts(loadouts) {
  const source = state.roomValue?.players || {};
  const result = {};
  for (const id of Object.keys(loadouts)) if (source[id]) result[id] = source[id];
  return result;
}

function renderCeremonyTurn(roomState, players) {
  const order = roomState.colorOrder || players.map((player) => player.id);
  const turnId = roomState.turn;
  const player = players.find((candidate) => candidate.id === turnId);
  if (!player) return;
  const isMyTurn = turnId === state.id;
  const turnIndex = Math.max(0, order.indexOf(turnId));
  const pending = roomState.pendingColors || {};
  const locked = roomState.colorsLocked || {};
  const unavailableColors = new Set(Object.entries(locked).filter(([id]) => id !== turnId).map(([, color]) => color));
  const defaultColor = unavailableColors.has(player.color) ? COLORS.find((color) => !unavailableColors.has(color)) || COLORS[0] : player.color;
  const chosen = Object.hasOwn(pending, turnId) ? pending[turnId] : (defaultColor || COLORS[turnIndex % COLORS.length]);
  const isNewTurn = state.ceremonyRenderedTurn !== turnId;
  if (isNewTurn) {
    state.previousCeremonyTurn = state.ceremonyRenderedTurn;
    state.ceremonyRenderedTurn = turnId;
    state.pendingColor = chosen;
    ceremonyEl.innerHTML = `<div class="ceremony-hud">
      <div class="turn-timer" id="turn-timer">15s</div>
      <div class="turn-banner"><div class="who" id="turn-who"></div><div class="what" id="turn-what"></div></div>
      <button id="confirm-color" class="confirm-btn">Confirmar color</button>
    </div><div class="ceremony-stage"><div class="color-stage" id="color-stage">
      <div class="cuby-preview" id="cuby-preview"></div>
      <div class="color-palette">${COLORS.map((color) => `<button class="color-swatch" data-color="${color}" style="--color:${color}" aria-label="Elegir color ${color}"></button>`).join('')}</div>
    </div></div>`;
    const stage = ceremonyEl.querySelector('#color-stage');
    const previousId = state.previousCeremonyTurn;
    const previousColor = locked[previousId] || players.find((item) => item.id === previousId)?.color;
    if (previousId && previousColor) {
      const exit = document.createElement('div');
      exit.className = 'cuby-exit';
      exit.style.setProperty('--cuby-color', previousColor);
      exit.innerHTML = `<span class="cuby-block"></span><span>${esc(players.find((item) => item.id === previousId)?.name || '')}</span>`;
      stage.before(exit);
      setTimeout(() => exit.remove(), 550);
    }
    ceremonyEl.querySelectorAll('.color-swatch').forEach((button) => {
      button.addEventListener('click', () => {
        if (!isMyTurn) return;
        state.pendingColor = button.dataset.color;
        state.profile.color = button.dataset.color;
        localStorage.setItem('knockbit-color', state.pendingColor);
        writeOwnRoomState(`pendingColors/${state.id}`, state.pendingColor).catch(() => {});
        updateCeremonyControls(roomState, players);
      });
    });
    ceremonyEl.querySelector('#confirm-color').addEventListener('click', () => requestColorConfirm(state.pendingColor || chosen));
    drawCeremonyCuby(document.querySelector('#cuby-preview'), chosen, player.name, isMyTurn);
  } else {
    const record = cubyCanvases.get('cuby-preview');
    if (record) record.color = chosen;
  }
  updateCeremonyControls(roomState, players);
}

function updateCeremonyControls(roomState, players) {
  const turnId = roomState.turn;
  const player = players.find((candidate) => candidate.id === turnId);
  if (!player) return;
  const order = roomState.colorOrder || players.map((item) => item.id);
  const index = Math.max(0, order.indexOf(turnId));
  const remaining = Math.max(0, Math.ceil((Number(roomState.turnEndsAt || 0) - serverNow()) / 1000));
  const timer = ceremonyEl.querySelector('#turn-timer');
  if (timer) {
    timer.textContent = `${remaining}s`;
    timer.classList.toggle('low', remaining <= 5);
  }
  if (turnId !== state.id) state.pendingColor = null;
  const who = ceremonyEl.querySelector('#turn-who');
  const what = ceremonyEl.querySelector('#turn-what');
  if (who) who.textContent = `${turnId === state.id ? 'Elige tu color' : player.name} · ${index + 1}/${order.length}`;
  if (what) what.textContent = turnId === state.id ? 'Tu turno · elige y confirma' : `Turno de ${player.name}`;
  const selected = turnId === state.id
    ? (state.pendingColor || (Object.hasOwn(roomState.pendingColors || {}, turnId) ? roomState.pendingColors[turnId] : player.color))
    : (Object.hasOwn(roomState.pendingColors || {}, turnId) ? roomState.pendingColors[turnId] : player.color);
  ceremonyEl.querySelectorAll('.color-swatch').forEach((button) => {
    const lockedBy = Object.entries(roomState.colorsLocked || {}).find(([, color]) => color === button.dataset.color)?.[0];
    const unavailable = lockedBy && lockedBy !== turnId;
    button.disabled = ! (turnId === state.id) || !!unavailable;
    button.classList.toggle('taken', !!unavailable);
    button.classList.toggle('selected', button.dataset.color === selected);
  });
  const confirm = ceremonyEl.querySelector('#confirm-color');
  if (confirm) confirm.disabled = turnId !== state.id;
  const record = cubyCanvases.get('cuby-preview');
  if (record) record.color = selected;
}

async function requestColorConfirm(color) {
  const current = state.roomValue?.state;
  if (current?.phase !== 'color-turns' || current.turn !== state.id) return;

  const locked = current.colorsLocked || {};
  const taken = new Set(Object.values(locked));
  const selected = COLORS.includes(color) && !taken.has(color) ? color : COLORS.find((candidate) => !taken.has(candidate)) || COLORS[0];
  state.pendingColor = selected;
  try {
    await writeOwnRoomState(`pendingColors/${state.id}`, selected);
    await writeOwnRoomState(`colorConfirm/${state.id}`, true);
    playUiSound('confirm');
  } catch (error) {
    console.error('No se pudo confirmar el color', error);
    toastMessage('No se pudo confirmar.');
  }
}

async function advanceColorTurn(turnId, color) {
  if (state.roomValue?.host !== state.id || state.turnCommitInFlight === turnId) return;
  state.turnCommitInFlight = turnId;
  const roomState = state.roomValue.state;
  if (roomState.turn !== turnId || roomState.colorsLocked?.[turnId]) {
    state.turnCommitInFlight = '';
    return;
  }
  const order = (roomState.colorOrder || orderedPlayers(state.roomValue).map((player) => player.id)).filter((id) => state.roomValue.players?.[id]);
  const index = order.indexOf(turnId);
  const next = order[index + 1];
  const updates = { [`colorsLocked/${turnId}`]: color };
  if (next) {
    updates.turn = next;
    updates.turnIndex = index + 1;
    updates.turnEndsAt = serverNow() + TURN_SECONDS * 1000;
  } else {
    updates.phase = 'color-finale';
    updates.turn = null;
    updates.turnEndsAt = null;
    updates.finaleAt = serverNow();
  }
  try {
    await writeRoomStateFields(updates);
  } catch (error) {
    console.error('No se pudo avanzar el turno', error);
  } finally {
    state.turnCommitInFlight = '';
  }
}

function tickCeremony() {
  if (!state.ceremonyActive || !state.roomValue?.state) return;
  const roomState = state.roomValue.state;
  if (roomState.phase === 'color-turns') {
    updateCeremonyControls(roomState, orderedPlayers(state.roomValue));
    if (state.roomValue.host === state.id && roomState.turn && !state.turnCommitInFlight) {
      const turnId = roomState.turn;
      const currentOrder = (roomState.colorOrder || []).filter((id) => state.roomValue.players?.[id]);
      if (!currentOrder.includes(turnId)) {
        const next = currentOrder.find((id) => !roomState.colorsLocked?.[id]);
        const transition = next
          ? { turn: next, turnIndex: currentOrder.indexOf(next), turnEndsAt: serverNow() + TURN_SECONDS * 1000 }
          : { phase: 'color-finale', turn: null, turnEndsAt: null, finaleAt: serverNow() };
        state.turnCommitInFlight = turnId;
        writeRoomStateFields(transition).catch(() => {}).finally(() => { state.turnCommitInFlight = ''; });
        return;
      }
      if (!state.roomValue.players?.[turnId]) {
        const updates = { [`colorsLocked/${turnId}`]: COLORS.find((color) => !Object.values(roomState.colorsLocked || {}).includes(color)) || COLORS[0] };
        const next = currentOrder[currentOrder.indexOf(turnId) + 1];
        if (next) Object.assign(updates, { turn: next, turnIndex: currentOrder.indexOf(next), turnEndsAt: serverNow() + TURN_SECONDS * 1000 });
        else Object.assign(updates, { phase: 'color-finale', turn: null, turnEndsAt: null, finaleAt: serverNow() });
        state.turnCommitInFlight = turnId;
        writeRoomStateFields(updates).catch(() => {}).finally(() => { state.turnCommitInFlight = ''; });
        return;
      }
      const player = state.roomValue.players?.[turnId];
      const locked = roomState.colorsLocked || {};
      const unavailable = new Set(Object.entries(locked).filter(([id]) => id !== turnId).map(([, color]) => color));
      if (roomState.colorConfirm?.[turnId] === true) {
        const selected = roomState.pendingColors?.[turnId];
        const autoColor = COLORS.includes(selected) && !unavailable.has(selected)
          ? selected
          : (unavailable.has(player?.color) ? COLORS.find((color) => !unavailable.has(color)) : player?.color) || COLORS.find((color) => !unavailable.has(color)) || COLORS[0];
        advanceColorTurn(turnId, autoColor);
      } else if (Number(roomState.turnEndsAt) <= serverNow()) {
        const selected = roomState.pendingColors?.[turnId];
        const autoColor = COLORS.includes(selected) && !unavailable.has(selected)
          ? selected
          : (unavailable.has(player?.color) ? COLORS.find((color) => !unavailable.has(color)) : player?.color) || COLORS.find((color) => !unavailable.has(color)) || COLORS[0];
        advanceColorTurn(turnId, autoColor);
      }
    }
  } else if (roomState.phase === 'color-finale') {
    renderColorFinale(roomState, orderedPlayers(state.roomValue));
    if (state.roomValue.host === state.id && serverNow() - Number(roomState.finaleAt || 0) >= FINALE_DURATION_MS && !state.finalTransitionInFlight) {
      state.finalTransitionInFlight = true;
      const resetGate = {
        startedAt: null,
        gameBlackStartedAt: serverNow(),
        gameAllReadyAt: null,
      };
      const playerIds = Object.keys(state.roomValue.players || {});
      Promise.all([
        writeRoomStateFields(resetGate),
        writePlayerStateMarkers('gameReady', Object.fromEntries(playerIds.map((id) => [id, false]))),
        writePlayerStateMarkers('gameShown', Object.fromEntries(playerIds.map((id) => [id, 0]))),
        clearPlayerStateMarkers(['colorsLocked', 'pendingColors', 'colorConfirm', 'spawnDone'], playerIds),
      ])
        .then(() => set(ref(db, `rooms/${state.room}/state/phase`), 'game-loading'))
        .catch(() => { state.finalTransitionInFlight = false; });
    } else if (roomState.phase !== 'game-loading') {
      state.finalTransitionInFlight = false;
    }
  } else if (roomState.phase === 'color-loading' || roomState.phase === 'game-loading') {
    renderCeremonyFrame(roomState);
  }
}

function renderColorFinale(roomState, players) {
  preloader.classList.add('hidden');
  ceremonyEl.classList.remove('hidden');
  if (state.ceremonyRenderedTurn === 'finale') return;
  state.ceremonyRenderedTurn = 'finale';
  ceremonyEl.innerHTML = `<div class="finale-scene">
    <div class="finale-trophy" aria-hidden="true">🏆</div>
    <h1>¡COMENZANDO!</h1>
    <p>Que gane el cuby más escurridizo.</p>
    <div class="finale-lineup">${players.map((player) => `<div class="finale-player"><span class="finale-cuby" style="--cuby-color:${esc(roomState.colorsLocked?.[player.id] || player.color)}"></span><span>${esc(player.name)}</span></div>`).join('')}</div>
  </div>`;
  roomState.colorsLocked && Object.entries(roomState.colorsLocked).forEach(([id, color]) => {
    if (state.roomValue?.players?.[id]) state.roomValue.players[id].color = color;
  });
}

// El cuby de la ceremonia: canvas 2D con ojos que siguen al ratón.
const cubyCanvases = new Map();
function drawCeremonyCuby(container, color, name, interactive) {
  if (!container) return;
  const previous = cubyCanvases.get(container.id);
  if (previous?.raf) cancelAnimationFrame(previous.raf);
  container.innerHTML = `<canvas width="220" height="220"></canvas><div class="cuby-name">${esc(name)}</div>`;
  const canvasEl = container.querySelector('canvas');
  const ctx = canvasEl.getContext('2d');
  const record = { color, name, mouse: { x: 110, y: 80 }, raf: 0 };
  cubyCanvases.set(container.id, record);
  if (interactive) canvasEl.addEventListener('mousemove', (event) => {
    const rect = canvasEl.getBoundingClientRect();
    record.mouse = { x: (event.clientX - rect.left) * 220 / rect.width, y: (event.clientY - rect.top) * 220 / rect.height };
  });
  const renderCuby = (time) => {
    const size = 96, cx = 110, cy = 108;
    ctx.clearRect(0, 0, 220, 220);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + size / 2 + 8, size * 0.42, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time / 420) * 0.045);
    ctx.fillStyle = record.color;
    ctx.strokeStyle = 'rgba(239,231,214,.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(-size / 2, -size / 2, size, size, 20);
    ctx.fill();
    ctx.stroke();
    const angle = Math.atan2(record.mouse.y - cy, record.mouse.x - cx);
    const ex = Math.cos(angle) * 5, ey = Math.sin(angle) * 5;
    for (const eyeX of [-19, 19]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(eyeX, -8, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1b22';
      ctx.beginPath(); ctx.arc(eyeX + ex * .6, -8 + ey * .6, 5.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    record.raf = requestAnimationFrame(renderCuby);
  };
  record.raf = requestAnimationFrame(renderCuby);
}

function stopCeremony() {
  state.ceremonyActive = false;
  state.ceremonyUnsubs.splice(0).forEach((unsubscribe) => unsubscribe?.());
  clearInterval(state.ceremonyTimer);
  state.ceremonyTimer = null;
  for (const record of cubyCanvases.values()) cancelAnimationFrame(record.raf);
  cubyCanvases.clear();
  state.ceremonyRenderedTurn = null;
  state.gateSentFor = '';
  state.gateShownFor = '';
  state.gatePhase = '';
  state.finalTransitionInFlight = false;
  state.turnCommitInFlight = '';
  state.gateReleaseInFlight = '';
  state.gateStampInFlight = '';
  state.lastGateMarkup = '';
  preloader.classList.add('hidden');
  ceremonyEl.classList.add('hidden');
}

function playUiSound(kind) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !settings.sound) return;
  const context = window.__knockbitAudio || (window.__knockbitAudio = new AudioContext());
  if (context.state === 'suspended') context.resume();
  const now = context.currentTime;
  const settingsMap = { confirm: { start: 440, end: 660, duration: 0.16, volume: 0.05, type: 'triangle' } };
  const config = settingsMap[kind];
  if (!config) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = config.type;
  oscillator.frequency.setValueAtTime(config.start, now);
  oscillator.frequency.exponentialRampToValueAtTime(config.end, now + config.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(config.volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + config.duration + 0.02);
}

/* ============ PARTIDA ============ */

function startGame() {
  if (state.started) return;
  stopCeremony();
  state.started = true;
  state.resultShown = false;
  game.querySelector('.result')?.remove();
  showSection('game');
  const room = state.roomValue;
  const players = orderedPlayers(room).map((player) => ({ ...player, color: room.state?.colorsLocked?.[player.id] || player.color }));
  if (room.state?.colorsLocked?.[state.id]) state.profile.color = room.state.colorsLocked[state.id];
  lastSync = 0;
  state.engine = new GameEngine(canvas, {
    players,
    meId: state.id,
    map: room.state?.map,
    mode: room.state?.mode || 'territory',
    graphics: settings.graphics,
    sound: settings.sound,
    onStrike: (strike) => push(ref(db, `rooms/${state.room}/strikes`), { ...strike, createdAt: serverNow() }).catch(() => {}),
    onEliminate: (id) => {
      if (id !== state.id) return;
      update(ref(db, `rooms/${state.room}/players/${state.id}`), { alive: false, hitsTaken: 0 }).catch(() => {});
      recordElimination(id);
    },
    onLoseLife: (lives) => update(ref(db, `rooms/${state.room}/players/${state.id}`), { lives, hitsTaken: state.engine?.me?.hitsTaken || 0 }).catch(() => {}),
    onWin: async (winner) => {
      if (state.roomValue?.host !== state.id) return;
      try {
        await set(ref(db, `rooms/${state.room}/state/winner`), winner);
        await set(ref(db, `rooms/${state.room}/state/phase`), 'ended');
      } catch (error) {
        console.error('No se pudo guardar el resultado', error);
      }
    },
    onState: syncState,
  });
  state.engine.clockNow = serverNow;
  state.engine.startedAt = room.state?.playAt ? room.state.playAt : (room.state?.startedAt ? room.state.startedAt : serverNow());
  state.engine.serverOffset = state.serverOffset;
  state.engine.start();
  renderLoadoutOverlay(players.length);
  state.gameUnsubs.push(onValue(ref(db, `rooms/${state.room}/players`), (snapshot) => {
    const remote = Object.entries(snapshot.val() || {}).map(([id, player]) => ({ ...player, id }));
    state.engine?.applyRemote(remote);
  }));
  state.gameUnsubs.push(onChildAdded(ref(db, `rooms/${state.room}/strikes`), (snapshot) => {
    const strike = snapshot.val();
    if (strike?.victim === state.id) state.engine?.applyStrike(strike);
  }));
  state.gameUnsubs.push(onValue(ref(db, `rooms/${state.room}/state`), (snapshot) => {
    const roomState = snapshot.val() || {};
    if (roomState.phase !== 'playing') return;
    if (state.roomValue) state.roomValue.state = roomState;
    if (roomState.countdownAt) {
      const playAt = Number(roomState.playAt || roomState.countdownAt + 3000);
      state.engine.startedAt = playAt;
      if (serverNow() < playAt) state.engine.setPhase('countdown');
      else if (state.countdownStarted) state.engine.setPhase('play');
    }
    // Spawns visibles para todos.
    const spawns = roomState.spawnDone || {};
    for (const id of Object.keys(spawns)) if (!state.engine.spawned.has(id)) state.engine.spawnPlayer(id);
    // Cuenta atrás sincronizada: cuando todos tienen spawn, +1 s y 3-2-1.
    const activeIds = [...state.engine.players.keys()].filter((id) => state.roomValue?.players?.[id]);
    const everyoneSpawned = activeIds.length > 0 && activeIds.every((id) => spawns[id]);
    if (everyoneSpawned && !roomState.countdownAt && state.roomValue?.host === state.id && !state.countdownCommitInFlight) {
      state.countdownCommitInFlight = true;
      state.engine.setPhase('countdown');
      const countdownAt = serverNow() + 1000;
      const playAt = countdownAt + 3000;
      Promise.all([
        set(ref(db, `rooms/${state.room}/state/countdownAt`), countdownAt),
        set(ref(db, `rooms/${state.room}/state/playAt`), playAt),
      ]).catch(() => { state.countdownCommitInFlight = false; });
    }
    if (roomState.countdownAt && !state.countdownStarted) startCountdown(roomState.countdownAt, roomState.playAt);
  }));
  state.gameUnsubs.push(onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => { state.serverOffset = snapshot.val() || 0; }));
  state.gameUnsubs.push(onValue(ref(db, `rooms/${state.room}/pings/${state.id}`), (snapshot) => {
    const stamp = snapshot.val();
    if (typeof stamp === 'number') state.engine.pingMs = Date.now() + (state.serverOffset || 0) - stamp;
  }));
  clearInterval(state.pingTimer);
  state.pingTimer = setInterval(() => {
    if (!state.room) return;
    set(ref(db, `rooms/${state.room}/pings/${state.id}`), Date.now() + (state.serverOffset || 0)).catch(() => {});
  }, 5000);
  // Respaldo: si el temporizador de loadout muere (pestaña oculta), a los 15 s se juega igual.
  setTimeout(() => {
    if (state.engine && state.engine.phase === 'loadout') finishLoadout();
  }, (LOADOUT_SECONDS + 1) * 1000);
}

// Overlay semitransparente: elegir pasiva y habilidad con 15 s de cuenta atrás.
function renderLoadoutOverlay() {
  const overlay = document.querySelector('#loadout-overlay');
  overlay.classList.remove('hidden');
  const beganAt = Number(state.roomValue?.state?.startedAt) || serverNow();
  const deadline = beganAt + LOADOUT_SECONDS * 1000;
  state.loadoutDeadline = deadline;
  const renderOverlay = () => {
    if (!state.engine || state.engine.phase !== 'loadout') { overlay.classList.add('hidden'); return; }
    const remaining = Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
    const mine = state.roomValue?.players?.[state.id] || state.profile;
    overlay.innerHTML = `<div class="card loadout-card">
      <p class="eyebrow">Prepara tu cuby</p>
      <h2 class="gate-title">Elige tu <span class="accent">equipo</span></h2>
      <div class="loadout-timer">${remaining}s</div>
      <label>Pasiva</label>
      <div class="choice-grid">${Object.entries(PASSIVES).map(([key, item]) => `<button class="choice ${mine.passive === key ? 'chosen' : ''}" data-passive="${key}"><b>${item.label}</b><small>${item.description}</small></button>`).join('')}</div>
      <label>Habilidad · tecla Espacio</label>
      <div class="choice-grid">${Object.entries(ABILITIES).map(([key, item]) => `<button class="choice ${mine.ability === key ? 'chosen' : ''}" data-ability="${key}"><b>${item.label}</b><small>${item.description}</small></button>`).join('')}</div>
      <button id="loadout-ready" class="primary">LISTO</button>
    </div>`;
    overlay.querySelectorAll('[data-passive]').forEach((button) => button.addEventListener('click', () => {
      state.profile.passive = button.dataset.passive;
      updateMyProfile({ passive: button.dataset.passive });
      renderOverlay();
    }));
    overlay.querySelectorAll('[data-ability]').forEach((button) => button.addEventListener('click', () => {
      state.profile.ability = button.dataset.ability;
      updateMyProfile({ ability: button.dataset.ability });
      renderOverlay();
    }));
    overlay.querySelector('#loadout-ready').addEventListener('click', finishLoadout);
  };
  renderOverlay();
  clearInterval(state.loadoutTick);
  state.loadoutTick = setInterval(() => {
    if (!state.engine || state.engine.phase !== 'loadout') return clearInterval(state.loadoutTick);
    if (serverNow() >= deadline) finishLoadout();
    else {
      const timer = overlay.querySelector('.loadout-timer');
      if (timer) timer.textContent = `${Math.max(0, Math.ceil((deadline - serverNow()) / 1000))}s`;
    }
  }, 250);
}

function finishLoadout() {
  if (!state.engine || state.engine.phase !== 'loadout') return;
  clearInterval(state.loadoutTick);
  document.querySelector('#loadout-overlay').classList.add('hidden');
  state.engine.setPhase('spawning');
  state.engine.spawnPlayer(state.id);
  writeOwnRoomState(`spawnDone/${state.id}`, true).catch((error) => {
    console.error('No se pudo registrar el spawn', error);
    toastMessage('Problema de conexión al entrar a la arena.');
  });
}

// Cuenta atrás 3-2-1 sincronizada por timestamp del servidor.
function startCountdown(countdownAt, playAt = countdownAt + 3000) {
  state.countdownStarted = true;
  const overlay = document.querySelector('#countdown');
  let lastCount = null;
  overlay.classList.remove('hidden');
  const tick = () => {
    if (!state.engine) return;
    const remaining = Math.ceil((playAt - serverNow()) / 1000);
    if (remaining > 0) {
      if (remaining !== lastCount) { overlay.textContent = remaining; playUiSound('count'); lastCount = remaining; }
      setTimeout(tick, 100);
    } else {
      overlay.textContent = '¡YA!';
      playUiSound('go');
      setTimeout(() => overlay.classList.add('hidden'), 500);
      state.engine.setPhase('play');
      state.engine.startedAt = playAt;
      state.engine.playStartedAt = playAt;
    }
  };
  setTimeout(tick, Math.max(0, countdownAt - serverNow()));
}

// Cada cliente registra la eliminación que detecta; RTDB descarta duplicados por clave.
function recordElimination(id) {
  if (!state.room || state.eliminationsRecorded.has(id)) return;
  state.eliminationsRecorded.add(id);
  push(ref(db, `rooms/${state.room}/state/eliminationOrder`), id).catch(() => {});
}

let lastSync = 0;
function syncState(snapshot) {
  if (!state.room || !state.engine || state.engine.phase === 'loadout' || state.engine.phase === 'ended' || state.engine.phase === 'spawning' || state.engine.phase === 'countdown') return;
  const now = Date.now();
  if (now - lastSync < 65) return;
  lastSync = now;
  const me = snapshot.find((player) => player.id === state.id);
  if (!me) return;
  update(ref(db, `rooms/${state.room}/players/${state.id}`), {
    x: me.x, y: me.y, vx: me.vx, vy: me.vy, aim: me.aim, alive: me.alive,
    lives: me.lives, hitsTaken: me.hitsTaken,
    swingUntil: state.engine.toNetworkTime(me.swingUntil),
    swingStarted: state.engine.toNetworkTime(me.swingStarted),
    swingReadyAt: state.engine.toNetworkTime(me.swingReadyAt),
    shieldUntil: state.engine.toNetworkTime(me.shieldUntil),
    abilityUntil: state.engine.toNetworkTime(me.abilityUntil),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

function stopGame() {
  if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
  clearInterval(state.loadoutTick);
  state.countdownStarted = false;
  state.countdownCommitInFlight = false;
  state.gameUnsubs.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.engine?.stop();
  state.engine = null;
  state.started = false;
  document.querySelector('#loadout-overlay')?.classList.add('hidden');
  document.querySelector('#countdown')?.classList.add('hidden');
  document.querySelector('#pause-menu')?.classList.add('hidden');
}

function showResults() {
  if (state.resultShown) return;
  state.resultShown = true;
  state.engine?.setPhase('ended');
  stopGame();
  showSection('game');
  const room = state.roomValue;
  const winner = room?.state?.winner;
  const winnerName = room?.players?.[winner]?.name || 'Nadie';
  const order = Object.values(room?.state?.eliminationOrder || {});
  const eliminated = [...order].reverse().filter((id) => id !== winner);
  const rows = eliminated.map((id, index) => {
    const player = room?.players?.[id];
    return `<div class="result-row"><span>${index + 2}º</span><span class="color-dot" style="background:${esc(player?.color || '#888')}"></span><strong>${esc(player?.name || 'Jugador')}</strong></div>`;
  }).join('');
  const result = document.createElement('div');
  result.className = 'result card';
  result.innerHTML = `<p class="eyebrow">Partida terminada</p><h2>${winner ? `🏆 ${esc(winnerName)} gana` : 'Empate'}</h2>${rows ? `<div class="result-ranking">${rows}</div>` : '<p>La arena ha hablado.</p>'}<button id="result-lobby" class="primary">Volver a la sala</button>`;
  game.append(result);
  result.querySelector('#result-lobby').addEventListener('click', async () => {
    if (state.roomValue?.host !== state.id) return;
    state.ceremonyStartRequested = false;
    const resetState = {
      winner: null, startedAt: null, eliminationOrder: null,
      colorAllReadyAt: null, gameAllReadyAt: null, countdownAt: null, playAt: null,
    };
    const playerIds = Object.keys(state.roomValue?.players || {});
    try {
      await Promise.all([
        writeRoomStateFields(resetState),
        clearPlayerStateMarkers(['colorsLocked', 'colorReady', 'colorShown', 'gameReady', 'gameShown', 'spawnDone', 'pendingColors', 'colorConfirm'], playerIds),
      ]);
      await set(ref(db, `rooms/${state.room}/state/phase`), 'lobby');
    } catch (error) {
      console.error('No se pudo volver a la sala', error);
    }
  });
}

/* ============ PAUSA CON ESC ============ */

function togglePauseMenu() {
  const pause = document.querySelector('#pause-menu');
  if (!state.engine || pause.classList.contains('hidden') === false) { pause.classList.add('hidden'); return; }
  pause.classList.remove('hidden');
  pause.innerHTML = `<div class="card pause-card">
    <h2 class="gate-title">Pausa <span class="accent">(el juego sigue)</span></h2>
    <p class="hint">Te pueden golpear mientras estás aquí. Salir de la arena sigue eliminando.</p>
    <label class="field-label" for="pause-graphics">Gráficos</label>
    <select id="pause-graphics" class="text-input">${Object.entries(GRAPHICS_PROFILES).map(([key, item]) => `<option value="${key}" ${settings.graphics === key ? 'selected' : ''}>${item.label}</option>`).join('')}</select>
    <div class="menu-actions">
      <button id="pause-resume" class="primary">Seguir jugando</button>
      <button id="pause-leave" class="secondary">Salir de la sala</button>
    </div>
  </div>`;
  pause.querySelector('#pause-graphics').addEventListener('change', (event) => {
    settings.graphics = event.target.value;
    localStorage.setItem('knockbit-graphics', settings.graphics);
    if (state.engine) {
      state.engine.graphics = GRAPHICS_PROFILES[settings.graphics];
      state.engine.resize();
    }
    toastMessage(`Gráficos: ${GRAPHICS_PROFILES[settings.graphics].label}`);
  });
  pause.querySelector('#pause-resume').addEventListener('click', () => pause.classList.add('hidden'));
  pause.querySelector('#pause-leave').addEventListener('click', leaveRoom);
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Escape') return;
  if (state.screen === 'game' && state.engine) {
    event.preventDefault();
    togglePauseMenu();
  }
});

/* ============ SALIR ============ */

async function leaveRoom() {
  if (!state.room) return leaveToMenu();
  state.leaving = true;
  stopCeremony();
  const roomRef = ref(db, `rooms/${state.room}`);
  try {
    const playerRef = ref(db, `rooms/${state.room}/players/${state.id}`);
    await onDisconnect(playerRef).cancel();
    const snapshot = await get(roomRef);
    const room = snapshot.val();
    const players = Object.keys(room?.players || {});
    if (players.length === 0 && room?.host === state.id) await remove(roomRef);
    else if (players.length === 1 && players[0] === state.id) await remove(roomRef);
    else {
      if (room?.host === state.id && players.length > 1) {
        const successor = orderedPlayers(room).find((player) => player.id !== state.id);
        if (successor) await set(ref(db, `rooms/${state.room}/host`), successor.id);
      }
      await remove(ref(db, `rooms/${state.room}/players/${state.id}`));
    }
  } catch (error) {
    console.error('Error al salir de la sala', error);
    await remove(ref(db, `rooms/${state.room}/players/${state.id}`)).catch(() => {});
  }
  state.leaving = false;
  leaveToMenu();
}

function leaveToMenu() {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.room = '';
  state.roomValue = null;
  state.eliminationsRecorded.clear();
  setRoomUrl(null);
  state.ceremonyStartRequested = false;
  state.wasPlaying = false;
  state.matchResetFor = '';
  state.lastSavedMatchColor = '';
  state.hostMigrationAttemptedFor = '';
  state.previousPlayerIds.clear();
  state.gatePhase = '';
  state.gateShownFor = '';
  state.finalTransitionInFlight = false;
  state.turnCommitInFlight = '';
  stopGame();
  stopCeremony();
  game.querySelector('.result')?.remove();
  showSection('home');
  renderMenu();
}

document.querySelector('#leave-game').addEventListener('click', leaveRoom);

/* ============ ARRANQUE ============ */
const inviteCode = new URLSearchParams(window.location.search).get('sala');
renderMenu();
if (inviteCode && /^[A-Z0-9]{5}$/.test(inviteCode.toUpperCase())) renderInvite(inviteCode.toUpperCase());
