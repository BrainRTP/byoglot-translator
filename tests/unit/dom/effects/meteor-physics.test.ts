import { describe, expect, it } from "vitest";
import {
  type Glyph,
  meteorAt,
  type Particle,
  spawnFalling,
  spawnMeteors,
  step,
} from "../../../../lib/dom/effects/meteor-physics";

function lcg(seed = 3) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const glyph = (ch: string, x: number, y: number): Glyph => ({
  ch,
  x,
  y,
  font: "16px serif",
  color: "black",
});

const particle = (over: Partial<Particle> = {}): Particle => ({
  ...glyph("a", 10, 10),
  vx: 0,
  vy: 0,
  angle: 0,
  spin: 0,
  ...over,
});

describe("step", () => {
  it("adds g*dt to vy", () => {
    const [p] = step([particle()], 0.01, 1000);
    expect(p?.vy).toBeCloseTo(24, 5);
  });

  it("moves by the new velocity and rotates", () => {
    const [p] = step([particle({ vx: 100, spin: 2 })], 0.01, 1000);
    expect(p?.x).toBeCloseTo(11, 5);
    expect(p?.y).toBeCloseTo(10 + 24 * 0.01, 5);
    expect(p?.angle).toBeCloseTo(0.02, 5);
  });

  it("drops particles below the viewport", () => {
    expect(step([particle({ y: 1001 })], 0.01, 1000)).toEqual([]);
  });

  it("clamps dt to 0.05s after a background tab", () => {
    expect(step([particle()], 1, 1000)).toEqual(step([particle()], 0.05, 1000));
  });

  it("does not mutate its input", () => {
    const p = particle();
    step([p], 0.01, 1000);
    expect(p.vy).toBe(0);
  });
});

describe("meteorAt", () => {
  const from = { x: 0, y: -50 };
  const to = { x: 100, y: 200 };

  it("hits both ends and clamps t", () => {
    expect(meteorAt(from, to, 0)).toEqual(from);
    expect(meteorAt(from, to, 1)).toEqual(to);
    expect(meteorAt(from, to, 2)).toEqual(to);
    expect(meteorAt(from, to, -1)).toEqual(from);
  });

  it("is monotonic in y and eases in", () => {
    let last = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const y = meteorAt(from, to, t).y;
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    expect(meteorAt(from, to, 0.5).y).toBeLessThan((from.y + to.y) / 2);
  });
});

describe("spawnFalling", () => {
  it("uses the spec ranges", () => {
    const chars = Array.from({ length: 200 }, (_, i) => glyph("x", i, 5));
    for (const p of spawnFalling(chars, lcg())) {
      expect(p.vy).toBeGreaterThanOrEqual(-200);
      expect(p.vy).toBeLessThanOrEqual(50);
      expect(Math.abs(p.vx)).toBeLessThanOrEqual(80);
      expect(Math.abs(p.spin)).toBeLessThanOrEqual(6);
      expect(p.angle).toBe(0);
    }
  });
});

describe("spawnMeteors", () => {
  const targets = [glyph("a", 100, 300), glyph("b", 120, 100), glyph("c", 140, 200)];

  it("starts above the viewport top within +-200px of the target x", () => {
    for (const m of spawnMeteors(targets, 0, lcg())) {
      expect(m.from.y).toBeLessThan(0);
      expect(Math.abs(m.from.x - m.to.x)).toBeLessThanOrEqual(200);
    }
  });

  it("staggers by height, top lines first", () => {
    const ms = spawnMeteors(targets, 0, lcg());
    const delay = (ch: string) => ms.find((m) => m.ch === ch)?.delay as number;
    expect(delay("b")).toBe(0);
    expect(delay("b")).toBeLessThan(delay("c"));
    expect(delay("c")).toBeLessThan(delay("a"));
    expect(delay("a")).toBeLessThanOrEqual(600);
  });

  it("handles one line and no targets", () => {
    expect(spawnMeteors([glyph("a", 1, 1)], 0, lcg())[0]?.delay).toBe(0);
    expect(spawnMeteors([], 0, lcg())).toEqual([]);
  });
});
