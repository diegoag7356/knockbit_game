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
  const progress = clamp((elapsed - ZONE_START) / ZONE_DURATION, 0, 1);
  const size = elapsed < ZONE_START ? full : full - (full - 75) * progress;
  return { x: CENTER, y: CENTER, size };
}

export function insideZone(player, zone) {
  return Math.hypot(player.x - zone.x, player.y - zone.y) <= zone.size - PLAYER_RADIUS * 0.2;
}

export class GameEngine {
  constructor(canvas, { players, meId, map = 'circle', onStrike, onEliminate, onWin, onState, graphics = 'optimized', sound = true }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.graphics = GRAPHICS_PROFILES[graphics] || GRAPHICS_PROFILES.optimized;
    this.sound = sound;
    this.meId = meId;
    this.map = map;
    this.players = new Map(players.map((player, index) => [player.id, makePlayer(player, index, players.length)]));
    this.onStrike = onStrike;
    this.onEliminate = onEliminate;
    this.onWin = onWin;
    this.onState = onState;
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
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get me() { return this.players.get(this.meId); }

  bindInput() {
    this.keyDown = (event) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
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
    if (this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('KeyS')) y += 1;
    if (this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('KeyD')) x += 1;
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
    this.onStrike?.({ attacker: attacker.id, victim: target.id, dx: dir.x, dy: dir.y, power, automatic });
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

  update(dt, now) {
    this.elapsed = (Date.now() - this.startedAt) / 1000;
    const me = this.me;
    if (!me || !me.alive) return;
    const direction = this.movementDirection(me);
    const moving = this.keys.has('KeyW') || this.keys.has('KeyA') || this.keys.has('KeyS') || this.keys.has('KeyD');
    if (moving) {
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
        me.alive = false;
        this.onEliminate?.(me.id);
      }
    } else {
      const zone = getZone(this.elapsed);
      if (!insideZone(me, zone)) {
        if (!me.outsideSince) me.outsideSince = now;
        if (now - me.outsideSince > 1000) {
          me.alive = false;
          this.onEliminate?.(me.id);
        }
      } else {
        me.outsideSince = 0;
      }
    }

    const alive = [...this.players.values()].filter((player) => player.alive);
    if (alive.length === 1 && this.players.size > 1) this.onWin?.(alive[0].id);
    this.onState?.(this.snapshot());
  }

  applyStrike(strike) {
    const target = this.players.get(this.meId);
    if (!target || !target.alive || target.shieldUntil > performance.now()) return;
    target.vx += Number(strike.dx || 0) * Number(strike.power || 0);
    target.vy += Number(strike.dy || 0) * Number(strike.power || 0);
    playSound('hit', this.sound);
  }

  applyRemote(snapshot) {
    for (const data of snapshot) {
      const player = this.players.get(data.id);
      if (!player || player.id === this.meId) continue;
      const networkState = {};
      for (const key of ['x', 'y', 'vx', 'vy', 'aim', 'alive', 'swingUntil', 'shieldUntil', 'abilityUntil', 'color', 'name', 'passive', 'ability']) {
        if (data[key] !== undefined && data[key] !== null) networkState[key] = data[key];
      }
      if (data.x !== undefined && data.y !== undefined) {
        const jump = Math.hypot(data.x - player.x, data.y - player.y);
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
    return [...this.players.values()].map(({ id, x, y, vx, vy, aim, alive, swingUntil, swingStarted, shieldUntil, abilityUntil, color, name, passive, ability }) => ({ id, x, y, vx, vy, aim, alive, swingUntil, swingStarted, shieldUntil, abilityUntil, color, name, passive, ability }));
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
    ctx.strokeStyle = this.elapsed >= ZONE_START ? '#ffdb6e' : '#6ce5ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, zone.size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#576070';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, MAP_SIZE, 0, Math.PI * 2);
    ctx.stroke();

    this.drawEffects(ctx);
    for (const player of this.players.values()) this.drawPlayer(ctx, player);
    ctx.restore();
    this.drawHud(ctx, width, height);
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
      }
      ctx.globalAlpha = 1;
    }
  }

  drawPlayer(ctx, player) {
    if (!player.alive) return;
    const now = performance.now();
    ctx.save();
    ctx.translate(player.x, player.y);
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
    ctx.restore();
  }

  drawHud(ctx, width, height) {
    const me = this.me;
    const zoneText = this.elapsed < ZONE_START ? `La zona se encoge en ${Math.ceil(ZONE_START - this.elapsed)}s` : `Zona activa · ${Math.ceil(Math.max(0, ZONE_DURATION - (this.elapsed - ZONE_START)))}s`;
    ctx.fillStyle = 'rgba(12,13,18,.82)';
    ctx.fillRect(18, 18, Math.min(width - 36, 360), 72);
    ctx.fillStyle = '#f2f4fa';
    ctx.font = '700 18px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`Tiempo ${Math.floor(this.elapsed)}s`, 32, 47);
    ctx.font = '14px system-ui';
    ctx.fillStyle = '#b9c1d3';
    ctx.fillText(zoneText, 32, 70);
    if (me) {
      const remaining = Math.max(0, me.abilityUntil - performance.now());
      const abilityText = remaining ? `${ABILITIES[me.ability].label}: ${(remaining / 1000).toFixed(1)}s` : `${ABILITIES[me.ability].label}: LISTA (Espacio)`;
      ctx.fillStyle = remaining ? '#b9c1d3' : '#7df2b1';
      ctx.fillText(abilityText, 32, 91);
    }
  }
}
