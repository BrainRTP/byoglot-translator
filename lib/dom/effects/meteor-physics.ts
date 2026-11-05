export const GRAVITY = 2400;
export const MAX_DT = 0.05;
export const FLIGHT_MS = 700;
export const STAGGER_MS = 600;
const START_SPREAD = 200;
const ABOVE = 24;

export type Point = { x: number; y: number };

// x, y is the center of the character on screen
export type Glyph = { ch: string; x: number; y: number; font: string; color: string };

export type Particle = Glyph & { vx: number; vy: number; angle: number; spin: number };

export type Meteor = {
  ch: string;
  font: string;
  color: string;
  from: Point;
  to: Point;
  // ms after the rain start
  delay: number;
};

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);

export function step(ps: Particle[], dt: number, viewportHeight: number): Particle[] {
  const d = Math.min(dt, MAX_DT);
  const out: Particle[] = [];
  for (const p of ps) {
    const vy = p.vy + GRAVITY * d;
    const y = p.y + vy * d;
    if (y > viewportHeight) continue;
    out.push({ ...p, x: p.x + p.vx * d, y, vy, angle: p.angle + p.spin * d });
  }
  return out;
}

export function meteorAt(from: Point, to: Point, t: number): Point {
  const q = Math.min(Math.max(t, 0), 1);
  const e = q * q;
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

export function spawnFalling(chars: Glyph[], random: () => number): Particle[] {
  return chars.map((g) => ({
    ...g,
    vx: between(random, -80, 80),
    vy: between(random, -200, 50),
    angle: 0,
    spin: between(random, -6, 6),
  }));
}

export function spawnMeteors(
  targets: Glyph[],
  viewportTop: number,
  random: () => number,
): Meteor[] {
  if (targets.length === 0) return [];
  const top = Math.min(...targets.map((t) => t.y));
  const span = Math.max(...targets.map((t) => t.y)) - top;
  return targets.map((t) => ({
    ch: t.ch,
    font: t.font,
    color: t.color,
    from: { x: t.x + between(random, -START_SPREAD, START_SPREAD), y: viewportTop - ABOVE },
    to: { x: t.x, y: t.y },
    delay: span > 0 ? ((t.y - top) / span) * STAGGER_MS : 0,
  }));
}
