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
const BAT_DURATION = 180;
const BAT_RANGE = 78;
const KNOCKBACK = 620;
const ZONE_START = 30;
const ZONE_DURATION = 75;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const normalize = (x, y) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

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

function keepInArena(player) {
  const dx = player.x - CENTER;
  const dy = player.y - CENTER;
  const length = Math.hypot(dx, dy);
  const max = MAP_SIZE - PLAYER_RADIUS;
  if (length > max) {
    player.x = CENTER + (dx / length) * max;
    player.y = CENTER + (dy / length) * max;
    const normal = normalize(dx, dy);
    const outward = player.vx * normal.x + player.vy * normal.y;
    if (outward > 0) {
      player.vx -= normal.x * outward;
      player.vy -= normal.y * outward;
    }
  }
}

export class GameEngine {
  constructor(canvas, { players, meId, map = 'circle', onStrike, onEliminate, onWin, onState }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.meId = meId;
    this.map = map;
    this.players = new Map(players.map((player, index) => [player.id, makePlayer(player, index, players.length)]));
    this.onStrike = onStrike;
    this.onEliminate = onEliminate;
    this.onWin = onWin;
    this.onState = onState;
    this.running = false;
    this.lastFrame = 0;
    this.lastSync = 0;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      player.abilityUntil = now + ability.cooldown * rhythm;
    } else if (player.ability === 'shell') {
      player.shieldUntil = now + 2500;
      player.abilityUntil = now + ability.cooldown * rhythm;
    } else if (player.ability === 'backstab') {
      const enemy = [...this.players.values()].filter((candidate) => candidate.id !== this.meId && candidate.alive).sort((a, b) => distance(player, a) - distance(player, b))[0];
      if (!enemy) return;
      const direction = normalize(enemy.x - player.x, enemy.y - player.y);
      const destination = { x: enemy.x + direction.x * 52, y: enemy.y + direction.y * 52 };
      const zone = getZone(this.elapsed);
      if (Math.hypot(destination.x - CENTER, destination.y - CENTER) > zone.size - PLAYER_RADIUS) return;
      player.x = destination.x;
      player.y = destination.y;
      player.aim = Math.atan2(enemy.y - player.y, enemy.x - player.x);
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
    player.swingUntil = now + BAT_COOLDOWN;
    player.swingHit = false;
    player.aim = Math.atan2(this.mouseWorld.y - player.y, this.mouseWorld.x - player.x);
  }

  hitEnemy(attacker, target, now, automatic = false) {
    if (!target.alive || target.shieldUntil > now) return;
    const dir = normalize(target.x - attacker.x, target.y - attacker.y);
    const power = KNOCKBACK * (PASSIVES[attacker.passive]?.impact || 1) * (attacker.shieldUntil > now ? 0.4 : 1);
    target.vx += dir.x * power;
    target.vy += dir.y * power;
    this.onStrike?.({ attacker: attacker.id, victim: target.id, dx: dir.x, dy: dir.y, power, automatic });
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
    keepInArena(me);

    for (const player of this.players.values()) {
      if (player.id === me.id || !player.alive) continue;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.vx *= damping;
      player.vy *= damping;
      player.lastSeen = now;
    }

    const nowPerformance = performance.now();
    if (nowPerformance + 20 >= me.swingUntil - BAT_COOLDOWN + BAT_DURATION && !me.swingHit && nowPerformance < me.swingUntil) {
      me.swingHit = true;
      const reach = BAT_RANGE * (PASSIVES[me.passive]?.range || 1);
      for (const target of this.players.values()) {
        if (target.id === me.id || !target.alive || distance(me, target) > reach) continue;
        const targetAngle = Math.atan2(target.y - me.y, target.x - me.x);
        if (Math.abs(angleDifference(targetAngle, me.aim)) <= Math.PI * 0.34) this.hitEnemy(me, target, nowPerformance);
      }
    }

    const zone = getZone(this.elapsed);
    if (!insideZone(me, zone)) {
      if (!me.outsideSince) me.outsideSince = now;
      if (now - me.outsideSince > 1000) {
        me.alive = false;
        this.onEliminate?.(me.id);
      }
    } else me.outsideSince = 0;

    const alive = [...this.players.values()].filter((player) => player.alive);
    if (alive.length === 1 && this.players.size > 1) this.onWin?.(alive[0].id);
    this.onState?.(this.snapshot());
  }

  applyStrike(strike) {
    const target = this.players.get(this.meId);
    if (!target || !target.alive || target.shieldUntil > performance.now()) return;
    target.vx += Number(strike.dx || 0) * Number(strike.power || 0);
    target.vy += Number(strike.dy || 0) * Number(strike.power || 0);
  }

  applyRemote(snapshot) {
    for (const data of snapshot) {
      const player = this.players.get(data.id);
      if (!player || player.id === this.meId) continue;
      Object.assign(player, data, { remote: true });
    }
  }

  snapshot() {
    return [...this.players.values()].map(({ id, x, y, vx, vy, aim, alive, swingUntil, shieldUntil, abilityUntil, color, name, passive, ability }) => ({ id, x, y, vx, vy, aim, alive, swingUntil, shieldUntil, abilityUntil, color, name, passive, ability }));
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.update(dt, Date.now());
      this.render();
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

    for (const player of this.players.values()) this.drawPlayer(ctx, player);
    ctx.restore();
    this.drawHud(ctx, width, height);
  }

  drawPlayer(ctx, player) {
    if (!player.alive) return;
    const now = performance.now();
    ctx.save();
    ctx.translate(player.x, player.y);
    if (player.shieldUntil > now) {
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(111, 220, 255, .22)';
      ctx.fill();
      ctx.strokeStyle = '#6fe5ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (player.id === this.meId && player.swingUntil > now) {
      ctx.rotate(player.aim);
      ctx.strokeStyle = '#f7c948';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(82, 0);
      ctx.stroke();
      ctx.rotate(-player.aim);
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
