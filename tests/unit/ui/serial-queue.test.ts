import { describe, expect, it } from "vitest";
import { createSerialQueue } from "../../../lib/ui/serial-queue";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSerialQueue", () => {
  it("runs tasks one after another in call order", async () => {
    const q = createSerialQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await delay(ms);
      log.push(`end ${name}`);
      return name;
    };
    await Promise.all([
      q.enqueue(task("a", 20), () => {}),
      q.enqueue(task("b", 1), () => {}),
      q.enqueue(task("c", 1), () => {}),
    ]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("applies only the reply of the latest call", async () => {
    const q = createSerialQueue();
    const applied: string[] = [];
    await Promise.all([
      q.enqueue(
        async () => "first",
        (r) => applied.push(r),
      ),
      q.enqueue(
        async () => "second",
        (r) => applied.push(r),
      ),
    ]);
    expect(applied).toEqual(["second"]);
  });

  it("ignores a slow stale reply that finishes after a newer call was issued", async () => {
    const q = createSerialQueue();
    const applied: string[] = [];
    const slow = q.enqueue(
      async () => {
        await delay(15);
        return "slow";
      },
      (r) => applied.push(r),
    );
    const fast = q.enqueue(
      async () => "fast",
      (r) => applied.push(r),
    );
    await Promise.all([slow, fast]);
    expect(applied).toEqual(["fast"]);
  });

  it("a read queued behind a pending write sees the written value", async () => {
    const q = createSerialQueue();
    let stored = "old";
    let shown = "";
    const write = q.enqueue(
      async () => {
        await delay(10);
        stored = "new";
      },
      () => {},
    );
    const read = q.enqueue(
      async () => stored,
      (v) => {
        shown = v;
      },
    );
    await Promise.all([write, read]);
    expect(shown).toBe("new");
  });

  it("applies the reply when nothing newer was issued", async () => {
    const q = createSerialQueue();
    const applied: string[] = [];
    await q.enqueue(
      async () => "only",
      (r) => applied.push(r),
    );
    expect(applied).toEqual(["only"]);
  });

  it("a failing task rejects its caller but does not block the chain", async () => {
    const q = createSerialQueue();
    const applied: string[] = [];
    const bad = q.enqueue(
      async () => {
        throw new Error("boom");
      },
      () => {},
    );
    const good = q.enqueue(
      async () => "ok",
      (r) => applied.push(r),
    );
    await expect(bad).rejects.toThrow("boom");
    await good;
    expect(applied).toEqual(["ok"]);
  });
});
