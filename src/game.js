export const WORLD = 1000;
export const CENTER = WORLD / 2;
export const PLAYER_SIZE = 34;
export const PLAYER_RADIUS = 21;
export const COLORS = ['#ff5c67', '#ff9f43', '#ffe66d', '#55d889', '#4dd7d0', '#5ca9ff', '#a875ff', '#f783c8'];
export const PASSIVES = {
  alcance: { label: 'Alcance', description: 'Bate 35% más largo', range: 1.35, impact: 1, rhythm: 1 },
  impacto: { label: 'Impacto', description: 'Empuje 60% más fuerte', range: 1, impact: 1.6, rhythm: 1 },
  ritmo: { label: 'Ritmo', description: 'Cooldown de habilidad -20%', range: 1, impact: 1, rhythm: 0.8 },
};
export const ABILITIES = {
  dash: { label: 'Dash', description: 'Impulso rápido', cooldown: 5000 },
  backstab: { label: 'Backstab', description: 'Teletransporte + golpe', cooldown: 30000 },
  shell: { label: 'Caparazón', description: 'Inmune durante 2,5 s', cooldown: 15000 },
};
export const GAME_MODES = {
  territory: { label: 'Territorio', description: 'Sobrevive a la zona. Último en pie gana.' },
  lives: { label: 'Vidas', description: '3 vidas. 3 impactos restan una vida; salir del área resta una entera.' },
};

const MAP_SIZE = 420;
const BASE_SPEED = 260;
const DAMPING = 7;
const BAT_COOLDOWN = 600;
const BAT_DURATION = 210;
const BAT_RANGE = 78;
const BAT_SWING_ANGLE = Math.PI * 0.82;
const MAX_PARTICLES = 72;
export const GRAPHICS_PROFILES = {
  optimized: { label: 'Optimizado', dpr: 1.25, renderMs: 1000 / 55, maxParticles: 72 },
  normal: { label: 'Normal', dpr: 1.5, renderMs: 1000 / 60, maxParticles: 110 },
  high: { label: 'Alto', dpr: 2, renderMs: 1000 / 60, maxParticles: 160 },
};
const KNOCKBACK = 620;
const ARENA_EXIT_RADIUS = MAP_SIZE + PLAYER_RADIUS * 0.45;
const ZONE_START = 30;
const ZONE_DURATION = 75;
const START_LIVES = 3;
const LIVES_HITS_PER_LIFE = 3;
const SUDDEN_DEATH_SHRINK = 26;
const SUDDEN_DEATH_MIN_RADIUS = 24;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const normalize = (x, y) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function playSound(kind, enabled) {
  if (!enabled || typeof window === 'undefined') return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = window.__knockbitAudio || (window.__knockbitAudio = new AudioContext());
  if (context.state === 'suspended') context.resume();
  const now = context.currentTime;
  const settings = {
    swing: { start: 180, end: 85, duration: 0.12, volume: 0.045, type: 'sawtooth' },
    dash: { start: 120, end: 420, duration: 0.18, volume: 0.06, type: 'triangle' },
    teleport: { start: 520, end: 150, duration: 0.34, volume: 0.055, type: 'sine' },
    hit: { start: 300, end: 90, duration: 0.15, volume: 0.07, type: 'square' },
    shell: { start: 220, end: 440, duration: 0.25, volume: 0.05, type: 'sine' },
    zone: { start: 65, end: 130, duration: 0.55, volume: 0.05, type: 'sawtooth' },
    tick: { start: 520, end: 490, duration: 0.08, volume: 0.04, type: 'sine' },
    lose: { start: 330, end: 110, duration: 0.7, volume: 0.07, type: 'triangle' },
    win: { start: 260, end: 660, duration: 0.75, volume: 0.07, type: 'triangle' },
  }[kind];
  if (!settings) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = settings.type;
  oscillator.frequency.setValueAtTime(settings.start, now);
  oscillator.frequency.exponentialRampToValueAtTime(settings.end, now + settings.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(settings.volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + settings.duration + 0.02);
}

export function makePlayer(data, index = 0, total = 1) {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  return {
    id: data.id,
    name: data.name || 'Jugador',
    color: data.color || COLORS[index % COLORS.length],
    passive: data.passive || 'alcance',
    ability: data.ability || 'dash',
    x: CENTER + Math.cos(angle) * 260,
    y: CENTER + Math.sin(angle) * 260,
    vx: 0,
    vy: 0,
    aim: -Math.PI / 2,
    alive: true,
    lives: data.lives !== undefined ? data.lives : START_LIVES,
    hitsTaken: data.hitsTaken || 0,
    respawnUntil: 0,
    swingUntil: 0,
    swingStarted: 0,
    swingHit: false,
    shieldUntil: 0,
    abilityUntil: 0,
    outsideSince: 0,
    lastSeen: Date.now(),
    remote: false,
  };
}

export function getZone(elapsed) {
  const full = MAP_SIZE;
  if (elapsed < ZONE_START) return { x: CENTER, y: CENTER, size: full, suddenDeath: false };
  const shrinkProgress = clamp((elapsed - ZONE_START) / ZONE_DURATION, 0, 1);
  if (shrinkProgress < 1) {
    const size = full - (full - 75) * shrinkProgress;
    return { x: CENTER, y: CENTER, size, suddenDeath: false };
  }
  // Muerte súbita: la zona sigue encogiendo lentamente hasta forzar el desenlace.
  const extra = Math.min((elapsed - ZONE_START - ZONE_DURATION) * SUDDEN_DEATH_SHRINK, full - SUDDEN_DEATH_MIN_RADIUS - 75);
  const size = Math.max(SUDDEN_DEATH_MIN_RADIUS, 75 - extra);
  return { x: CENTER, y: CENTER, size, suddenDeath: true };
}

export function insideZone(player, zone) {
  return Math.hypot(player.x - zone.x, player.y - zone.y) <= zone.size - PLAYER_RADIUS * 0.2;
}

export class GameEngine {
  constructor(canvas, { players, meId, map = 'circle', mode = 'territory', onStrike, onEliminate, onWin, onState, onLoseLife, graphics = 'optimized', sound = true }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.graphics = GRAPHICS_PROFILES[graphics] || GRAPHICS_PROFILES.optimized;
    this.sound = sound;
    this.meId = meId;
    this.map = map;
    this.mode = mode;
    this.players = new Map(players.map((player, index) => [player.id, makePlayer(player, index, players.length)]));
    this.onStrike = onStrike;
    this.onEliminate = onEliminate;
    this.onWin = onWin;
    this.onState = onState;
    this.onLoseLife = onLoseLife;
    this.running = false;
    this.lastFrame = 0;
    this.lastRender = 0;
    this.frameCount = 0;
    this.lastSync = 0;
    this.effects = [];
    this.arenaExitGrace = 280;
    this.elapsed = 0;
    this.startedAt = Date.now();
    this.keys = new Set();
    this.mouse = { x: 0, y: 0 };
    this.mouseWorld = { x: CENTER, y: CENTER };
    this.zoneAnnounced = false;
    this.lastZoneTick = 0;
    this.wonAnnounced = false;
    this.deadAnnounced = false;
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get me() { return this.players.get(this.meId); }
  get isLivesMode() { return this.mode === 'lives'; }

  bindInput() {
    this.keyDown = (event) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
        if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.activateAbility();
      }
    };
    this.keyUp = (event) => this.keys.delete(event.code);
    this.mouseMove = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = event.clientX - rect.left;
      this.mouse.y = event.clientY - rect.top;
      this.mouseWorld = this.screenToWorld(this.mouse.x, this.mouse.y);
    };
    this.click = () => this.swing();
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    this.canvas.addEventListener('mousemove', this.mouseMove);
    this.canvas.addEventListener('mousedown', this.click);
  }

  resize() {
    // El perfil elegido limita el coste de una pantalla Retina sin cambiar el tamaño lógico del juego.
    const dpr = Math.min(window.devicePixelRatio || 1, this.graphics.dpr);
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.dpr = dpr;
  }

  screenToWorld(x, y) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const scale = Math.min(width, height) / WORLD;
    return { x: (x - (width - WORLD * scale) / 2) / scale, y: (y - (height - WORLD * scale) / 2) / scale };
  }

  activateAbility() {
    const player = this.me;
    if (!player || !player.alive) return;
    const now = performance.now();
    if (now < player.abilityUntil) return;
    const rhythm = PASSIVES[player.passive]?.rhythm || 1;
    const ability = ABILITIES[player.ability];
    if (!ability) return;
    if (player.ability === 'dash') {
      const direction = this.movementDirection(player);
      player.vx += direction.x * 720;
      player.vy += direction.y * 720;
      playSound('dash', this.sound);
      this.addBurst(player.x, player.y, direction.x, direction.y, '#63e6be', 18);
      this.effects.push({ type: 'dash', x: player.x, y: player.y, dx: direction.x, dy: direction.y, until: now + 320 });
      player.abilityUntil = now + ability.cooldown * rhythm;
    } else if (player.ability === 'shell') {
      player.shieldUntil = now + 2500;
      playSound('shell', this.sound);
      player.abilityUntil = now + ability.cooldown * rhythm;
    } else if (player.ability === 'backstab') {
      const enemy = [...this.players.values()].filter((candidate) => candidate.id !== this.meId && candidate.alive).sort((a, b) => distance(player, a) - distance(player, b))[0];
      if (!enemy) return;
      const direction = normalize(enemy.x - player.x, enemy.y - player.y);
      const destination = { x: enemy.x + direction.x * 52, y: enemy.y + direction.y * 52 };
      const zone = getZone(this.elapsed);
      if (Math.hypot(destination.x - CENTER, destination.y - CENTER) > zone.size - PLAYER_RADIUS) return;
      const origin = { x: player.x, y: player.y };
      player.x = destination.x;
      player.y = destination.y;
      player.aim = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      playSound('teleport', this.sound);
      this.addBurst(origin.x, origin.y, direction.x, direction.y, '#b68cff', 12);
      this.addBurst(player.x, player.y, -direction.x, -direction.y, '#ff7bd5', 24);
      this.effects.push({ type: 'teleport', x: player.x, y: player.y, fromX: origin.x, fromY: origin.y, until: now + 520 });
      player.abilityUntil = now + ability.cooldown * rhythm;
      this.hitEnemy(player, enemy, now, true);
    }
  }

  movementDirection(player) {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (!x && !y) return { x: Math.cos(player.aim), y: Math.sin(player.aim) };
    return normalize(x, y);
  }

  swing() {
    const player = this.me;
    if (!player?.alive) return;
    const now = performance.now();
    if (now < player.swingUntil) return;
    player.swingStarted = now;
    player.swingUntil = now + BAT_DURATION;
    playSound('swing', this.sound);
    player.swingHit = false;
    player.aim = Math.atan2(this.mouseWorld.y - player.y, this.mouseWorld.x - player.x);
  }

  hitEnemy(attacker, target, now, automatic = false) {
    if (!target.alive || target.shieldUntil > now) return;
    const dir = normalize(target.x - attacker.x, target.y - attacker.y);
    const power = KNOCKBACK * (PASSIVES[attacker.passive]?.impact || 1) * (attacker.shieldUntil > now ? 0.4 : 1);
    target.vx += dir.x * power;
    target.vy += dir.y * power;
    playSound('hit', this.sound);
    this.addBurst(target.x, target.y, dir.x, dir.y, '#f7c948', 10);
    // En modo Vidas el golpe acumula daño; a los N impactos se pierde una vida.
    if (this.isLivesMode && target.id === this.meId) {
      target.hitsTaken = (target.hitsTaken || 0) + 1;
      if (target.hitsTaken >= LIVES_HITS_PER_LIFE) {
        target.hitsTaken = 0;
        this.loseLife(target, 'impact');
      }
    }
    this.onStrike?.({ attacker: attacker.id, victim: target.id, dx: dir.x, dy: dir.y, power, automatic });
  }

  loseLife(player, cause) {
    if (!player.alive) return;
    player.lives = Math.max(0, (player.lives ?? START_LIVES) - 1);
    this.addBurst(player.x, player.y, 0, -1, '#ff5c67', 22);
    if (player.id === this.meId) {
      playSound('lose', this.sound);
      this.onLoseLife?.(player.lives, cause);
    }
    if (player.lives <= 0) {
      player.alive = false;
      this.onEliminate?.(player.id);
    } else if (cause === 'exit') {
      // Reaparece cerca del centro tras perder una vida por expulsión.
      const angle = Math.random() * Math.PI * 2;
      player.x = CENTER + Math.cos(angle) * 120;
      player.y = CENTER + Math.sin(angle) * 120;
      player.vx = 0;
      player.vy = 0;
      player.outsideSince = 0;
      player.respawnUntil = performance.now() + 900;
      this.effects.push({ type: 'respawn', x: player.x, y: player.y, until: performance.now() + 900 });
    }
  }

  addBurst(x, y, dx, dy, color, count = 8) {
    const amount = Math.min(count, this.graphics.maxParticles - this.effects.length);
    for (let index = 0; index < amount; index += 1) {
      const spread = (Math.random() - 0.5) * 1.5;
      const speed = 60 + Math.random() * 180;
      this.effects.push({ type: 'particle', x, y, vx: dx * speed - dy * spread * 50, vy: dy * speed + dx * spread * 50, color, size: 2 + Math.random() * 3, born: performance.now(), until: performance.now() + 380 });
    }
  }

  updateEffects(now, dt) {
    this.effects = this.effects.filter((effect) => effect.until > now);
    for (const effect of this.effects) {
      if (effect.type === 'particle') {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        effect.vx *= 0.92;
        effect.vy *= 0.92;
      }
    }
  }

  // Separa pares de cajas solapadas repartiendo el empuje entre ambos (el Caparazón no es empujado).
  resolveCollisions() {
    const players = [...this.players.values()].filter((player) => player.alive && performance.now() > player.respawnUntil);
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i];
        const b = players[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const overlap = PLAYER_RADIUS * 1.7 - dist;
        if (overlap <= 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const aShielded = a.shieldUntil > performance.now();
        const bShielded = b.shieldUntil > performance.now();
        const aMove = bShielded ? 0 : (aShielded ? 1 : 0.5);
        const bMove = aShielded ? 0 : (bShielded ? 1 : 0.5);
        a.x -= nx * overlap * aMove;
        a.y -= ny * overlap * aMove;
        b.x += nx * overlap * bMove;
        b.y += ny * overlap * bMove;
        const push = 60;
        if (!aShielded) { a.vx -= nx * push * bMove; a.vy -= ny * push * bMove; }
        if (!bShielded) { b.vx += nx * push * aMove; b.vy += ny * push * aMove; }
      }
    }
  }

  update(dt, now) {
    this.elapsed = (Date.now() - this.startedAt) / 1000;
    const me = this.me;
    const zone = getZone(this.elapsed);

    // Avisos de zona: anuncio al empezar a encoger y tics mientras encoge.
    if (this.elapsed >= ZONE_START) {
      if (!this.zoneAnnounced) {
        this.zoneAnnounced = true;
        playSound('zone', this.sound);
      }
      if (me?.alive && !insideZone(me, zone) && now - this.lastZoneTick > 2000) {
        this.lastZoneTick = now;
        playSound('tick', this.sound);
      }
    }

    // Espectador: aunque yo esté muerto, el mundo sigue vivo (remotos, efectos, zona).
    if (!me || !me.alive) {
      for (const player of this.players.values()) {
        if (player.id === this.meId) continue;
        player.x += player.vx * dt;
        player.y += player.vy * dt;
        player.vx *= 0.97;
        player.vy *= 0.97;
        if (player.targetX !== undefined) {
          const blend = 1 - Math.exp(-16 * dt);
          player.x += (player.targetX - player.x) * blend;
          player.y += (player.targetY - player.y) * blend;
        }
      }
      this.updateEffects(performance.now(), dt);
      const alive = [...this.players.values()].filter((player) => player.alive);
      if (alive.length === 1 && this.players.size > 1) {
        if (!this.wonAnnounced) {
          this.wonAnnounced = true;
          if (alive[0].id === this.meId) playSound('win', this.sound);
        }
        this.onWin?.(alive[0].id);
      }
      this.onState?.(this.snapshot());
      return;
    }
    if (!this.deadAnnounced && me.alive) this.deadAnnounced = false;

    const direction = this.movementDirection(me);
    const moving = this.keys.has('KeyW') || this.keys.has('KeyA') || this.keys.has('KeyS') || this.keys.has('KeyD') || this.keys.has('ArrowUp') || this.keys.has('ArrowDown') || this.keys.has('ArrowLeft') || this.keys.has('ArrowRight');
    if (moving && performance.now() > me.respawnUntil) {
      me.vx += direction.x * BASE_SPEED * 7 * dt;
      me.vy += direction.y * BASE_SPEED * 7 * dt;
    }
    const damping = Math.exp(-DAMPING * dt);
    me.vx *= damping;
    me.vy *= damping;
    me.x += me.vx * dt;
    me.y += me.vy * dt;
    me.aim = Math.atan2(this.mouseWorld.y - me.y, this.mouseWorld.x - me.x);

    for (const player of this.players.values()) {
      if (player.id === me.id || !player.alive) continue;
      // Avance local de remotos para que los paquetes de 15 Hz no produzcan saltos.
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.vx *= damping;
      player.vy *= damping;
      if (player.targetX !== undefined) {
        const blend = 1 - Math.exp(-16 * dt);
        player.x += (player.targetX - player.x) * blend;
        player.y += (player.targetY - player.y) * blend;
      }
      player.lastSeen = now;
    }

    this.resolveCollisions();

    const nowPerformance = performance.now();
    this.updateEffects(nowPerformance, dt);
    if (nowPerformance >= me.swingStarted + BAT_DURATION * 0.38 && !me.swingHit && nowPerformance < me.swingUntil + 30) {
      me.swingHit = true;
      const reach = BAT_RANGE * (PASSIVES[me.passive]?.range || 1);
      for (const target of this.players.values()) {
        if (target.id === me.id || !target.alive || distance(me, target) > reach) continue;
        const targetAngle = Math.atan2(target.y - me.y, target.x - me.x);
        if (Math.abs(angleDifference(targetAngle, me.aim)) <= Math.PI * 0.34) this.hitEnemy(me, target, nowPerformance);
      }
    }

    const arenaDistance = Math.hypot(me.x - CENTER, me.y - CENTER);
    // El borde exterior es una eliminación real: el bate puede empujar al rival fuera
    // del círculo completo, en lugar de dejarlo pegado a un límite invisible.
    if (arenaDistance > ARENA_EXIT_RADIUS) {
      if (!me.outsideSince) me.outsideSince = now;
      if (now - me.outsideSince > this.arenaExitGrace) {
        if (this.isLivesMode) this.loseLife(me, 'exit');
        else {
          me.alive = false;
          this.onEliminate?.(me.id);
        }
      }
    } else {
      if (!insideZone(me, zone)) {
        if (!me.outsideSince) me.outsideSince = now;
        if (now - me.outsideSince > 1000) {
          if (this.isLivesMode) this.loseLife(me, 'exit');
          else {
            me.alive = false;
            this.onEliminate?.(me.id);
          }
        }
      } else {
        me.outsideSince = 0;
      }
    }

    const alive = [...this.players.values()].filter((player) => player.alive);
    if (alive.length === 1 && this.players.size > 1) {
      if (!this.wonAnnounced) {
        this.wonAnnounced = true;
        if (alive[0].id === this.meId) playSound('win', this.sound);
      }
      this.onWin?.(alive[0].id);
    }
    this.onState?.(this.snapshot());
  }

  applyStrike(strike) {
    const target = this.players.get(this.meId);
    if (!target || !target.alive || target.shieldUntil > performance.now()) return;
    target.vx += Number(strike.dx || 0) * Number(strike.power || 0);
    target.vy += Number(strike.dy || 0) * Number(strike.power || 0);
    playSound('hit', this.sound);
    if (this.isLivesMode) {
      target.hitsTaken = (target.hitsTaken || 0) + 1;
      if (target.hitsTaken >= LIVES_HITS_PER_LIFE) {
        target.hitsTaken = 0;
        this.loseLife(target, 'impact');
      }
    }
  }

  applyRemote(snapshot) {
    for (const data of snapshot) {
      const player = this.players.get(data.id);
      if (!player || player.id === this.meId) continue;
      const networkState = {};
      for (const key of ['x', 'y', 'vx', 'vy', 'aim', 'alive', 'lives', 'hitsTaken', 'swingUntil', 'shieldUntil', 'abilityUntil', 'color', 'name', 'passive', 'ability']) {
        if (data[key] !== undefined && data[key] !== null) networkState[key] = data[key];
      }
      if (data.x !== undefined && data.y !== undefined) {
        const jump = Math.hypot(data.x - player.x, player.y !== undefined ? data.y - player.y : 0);
        // Teletransporte/respawn se aplica de inmediato; el movimiento normal se interpola.
        if (jump > 180) {
          player.x = data.x;
          player.y = data.y;
        } else {
          player.targetX = data.x;
          player.targetY = data.y;
        }
        delete networkState.x;
        delete networkState.y;
      }
      Object.assign(player, networkState, { remote: true });
      if (data.swingStarted !== undefined) player.swingStarted = data.swingStarted;
    }
  }

  snapshot() {
    return [...this.players.values()].map(({ id, x, y, vx, vy, aim, alive, lives, hitsTaken, swingUntil, swingStarted, shieldUntil, abilityUntil, color, name, passive, ability }) => ({ id, x, y, vx, vy, aim, alive, lives, hitsTaken, swingUntil, swingStarted, shieldUntil, abilityUntil, color, name, passive, ability }));
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.update(dt, Date.now());
      // Mantiene la simulación a 60 Hz, pero limita el coste de pintura en Macs modestos.
      if (now - this.lastRender >= this.graphics.renderMs) {
        this.render();
        this.lastRender = now;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    this.canvas.removeEventListener('mousemove', this.mouseMove);
    this.canvas.removeEventListener('mousedown', this.click);
  }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#111218';
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width, height) / WORLD;
    const ox = (width - WORLD * scale) / 2;
    const oy = (height - WORLD * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#232630';
    ctx.fillRect(0, 0, WORLD, WORLD);
    // Pocas marcas estáticas: dan profundidad sin generar objetos ni gradientes por frame.
    ctx.fillStyle = 'rgba(255,255,255,.025)';
    for (let x = 40; x < WORLD; x += 80) ctx.fillRect(x, 0, 1, WORLD);
    for (let y = 40; y < WORLD; y += 80) ctx.fillRect(0, y, WORLD, 1);
    const zone = getZone(this.elapsed);
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, zone.size, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#293b46';
    ctx.fillRect(0, 0, WORLD, WORLD);
    ctx.restore();
    ctx.strokeStyle = zone.suddenDeath ? '#ff5c67' : (this.elapsed >= ZONE_START ? '#ffdb6e' : '#6ce5ff');
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, zone.size, 0, Math.PI * 2);
    ctx.stroke();
    // Anillo pulsante de aviso mientras la zona se encoge.
    if (this.elapsed >= ZONE_START && this.elapsed < ZONE_START + ZONE_DURATION) {
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * Math.PI * 2.4);
      ctx.globalAlpha = 0.16 + pulse * 0.24;
      ctx.strokeStyle = '#ffdb6e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, zone.size + 8 + pulse * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = '#576070';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, MAP_SIZE, 0, Math.PI * 2);
    ctx.stroke();

    this.drawEffects(ctx);
    for (const player of this.players.values()) this.drawPlayer(ctx, player);
    ctx.restore();
    this.drawHud(ctx, width, height);
    // Viñeta roja si estoy fuera de la zona (aviso barato: gradiente radial precalculado por frame mínimo).
    if (this.me?.alive && !insideZone(this.me, zone)) {
      const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.32, width / 2, height / 2, Math.max(width, height) * 0.72);
      gradient.addColorStop(0, 'rgba(255,60,80,0)');
      gradient.addColorStop(1, 'rgba(255,60,80,.34)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  }

  drawEffects(ctx) {
    const now = performance.now();
    for (const effect of this.effects) {
      const life = clamp((effect.until - now) / 520, 0, 1);
      if (effect.type === 'particle') {
        ctx.globalAlpha = life;
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.size * life, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.type === 'dash') {
        ctx.globalAlpha = life * 0.7;
        ctx.strokeStyle = '#63e6be';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(effect.x - effect.dx * 70, effect.y - effect.dy * 70);
        ctx.lineTo(effect.x + effect.dx * 12, effect.y + effect.dy * 12);
        ctx.stroke();
      } else if (effect.type === 'teleport') {
        ctx.globalAlpha = life * 0.8;
        ctx.strokeStyle = '#c29bff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(effect.fromX, effect.fromY);
        ctx.lineTo(effect.x, effect.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, 28 + (1 - life) * 24, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === 'respawn') {
        ctx.globalAlpha = life * 0.8;
        ctx.strokeStyle = '#7df2b1';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, 20 + (1 - life) * 34, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  drawPlayer(ctx, player) {
    if (!player.alive) return;
    const now = performance.now();
    ctx.save();
    ctx.translate(player.x, player.y);
    // Parpadeo breve al reaparecer tras perder una vida.
    if (player.respawnUntil > now && Math.floor(now / 90) % 2 === 0) {
      ctx.restore();
      return;
    }
    // Sombra simple y barata para separar personajes del suelo.
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.beginPath();
    ctx.ellipse(2, 18, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    if (player.shieldUntil > now) {
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(111, 220, 255, .22)';
      ctx.fill();
      ctx.strokeStyle = '#6fe5ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const swingActive = player.swingUntil > now;
    const swingProgress = swingActive ? clamp((now - player.swingStarted) / BAT_DURATION, 0, 1) : 0;
    const swingOffset = swingActive ? -BAT_SWING_ANGLE / 2 + Math.sin(swingProgress * Math.PI) * BAT_SWING_ANGLE : 0;
    const batLength = 78 * (PASSIVES[player.passive]?.range || 1);
    // El bate permanece visible y apunta a la dirección del ratón; durante el golpe hace un arco.
    ctx.save();
    ctx.rotate(player.aim + swingOffset);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6f432d';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(batLength, 0);
    ctx.stroke();
    ctx.strokeStyle = swingActive ? '#ffe28a' : '#f0b957';
    ctx.lineWidth = swingActive ? 13 : 9;
    ctx.beginPath();
    ctx.moveTo(batLength - 17, 0);
    ctx.lineTo(batLength, 0);
    ctx.stroke();
    ctx.restore();
    if (swingActive) {
      ctx.globalAlpha = 0.28 * (1 - swingProgress);
      ctx.strokeStyle = '#ffe28a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, batLength * 0.72, player.aim - BAT_SWING_ANGLE / 2, player.aim + BAT_SWING_ANGLE / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Aro de alcance propio: muestra tu rango real de bate (crece con la pasiva Alcance).
    if (player.id === this.meId) {
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = '#9da6ba';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 11]);
      ctx.beginPath();
      ctx.arc(0, 0, batLength + PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = player.color;
    ctx.strokeStyle = player.id === this.meId ? '#ffffff' : 'rgba(0,0,0,.5)';
    ctx.lineWidth = player.id === this.meId ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE, 8);
    ctx.fill();
    ctx.stroke();
    const look = player.id === this.meId ? this.mouseWorld : { x: player.x + player.vx, y: player.y + player.vy };
    const lookAngle = Math.atan2(look.y - player.y, look.x - player.x);
    const ex = Math.cos(lookAngle) * 2;
    const ey = Math.sin(lookAngle) * 2;
    for (const eyeX of [-7, 7]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(eyeX, -5, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1b22';
      ctx.beginPath();
      ctx.arc(eyeX + ex, -5 + ey, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f2f4fa';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, 0, -29);
    // En modo Vidas, vidas visibles sobre cada jugador.
    if (this.isLivesMode) {
      const lives = player.lives ?? START_LIVES;
      ctx.font = '11px system-ui';
      ctx.fillText('❤'.repeat(lives) || '💀', 0, -44);
    }
    ctx.restore();
  }

  drawHud(ctx, width, height) {
    const me = this.me;
    const zone = getZone(this.elapsed);
    const zoneText = zone.suddenDeath
      ? 'MUERTE SÚBITA'
      : this.elapsed < ZONE_START
        ? `La zona se encoge en ${Math.ceil(ZONE_START - this.elapsed)}s`
        : `Zona activa · ${Math.ceil(Math.max(0, ZONE_DURATION - (this.elapsed - ZONE_START)))}s`;
    ctx.fillStyle = 'rgba(12,13,18,.82)';
    ctx.fillRect(18, 18, Math.min(width - 36, 360), 72);
    ctx.fillStyle = '#f2f4fa';
    ctx.font = '700 18px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`Tiempo ${Math.floor(this.elapsed)}s`, 32, 47);
    ctx.font = '14px system-ui';
    ctx.fillStyle = zone.suddenDeath ? '#ff5c67' : '#b9c1d3';
    ctx.fillText(zoneText, 32, 70);
    if (me) {
      const remaining = Math.max(0, me.abilityUntil - performance.now());
      const abilityText = remaining ? `${ABILITIES[me.ability].label}: ${(remaining / 1000).toFixed(1)}s` : `${ABILITIES[me.ability].label}: LISTA (Espacio)`;
      ctx.fillStyle = remaining ? '#b9c1d3' : '#7df2b1';
      ctx.fillText(abilityText, 32, 91);
      // Vidas propias en el HUD (modo Vidas).
      if (this.isLivesMode) {
        const lives = me.lives ?? START_LIVES;
        ctx.font = '18px system-ui';
        ctx.fillStyle = lives > 1 ? '#ff5c67' : '#ffe66d';
        ctx.fillText(`❤ ${lives}${me.hitsTaken ? `  (+${me.hitsTaken})` : ''}`, 200, 47);
      }
    }
    if (me && !me.alive) {
      ctx.fillStyle = 'rgba(12,13,18,.72)';
      ctx.fillRect(width / 2 - 150, height - 88, 300, 44);
      ctx.fillStyle = '#ff9f9f';
      ctx.font = '700 16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('ELIMINADO · viendo la partida', width / 2, height - 60);
    }
    // Ping en la esquina superior derecha.
    if (this.pingMs !== null && this.pingMs !== undefined) {
      ctx.font = '12px system-ui';
      ctx.textAlign = 'right';
      ctx.fillStyle = this.pingMs < 90 ? '#7df2b1' : this.pingMs < 200 ? '#ffe66d' : '#ff5c67';
      ctx.fillText(`${Math.round(this.pingMs)} ms`, width - 24, 34);
    }
  }
}
