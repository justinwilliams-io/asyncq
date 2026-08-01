import { describe, expect, it } from "vitest";
import asyncq from "../src/index.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("asyncq", () => {
  it("throws for invalid maxRunning", () => {
    expect(() => asyncq(0)).toThrow(RangeError);
    expect(() => asyncq(-1)).toThrow(RangeError);
    expect(() => asyncq(1.5)).toThrow(RangeError);
    expect(() => asyncq(NaN)).toThrow(RangeError);
  });

  it("resolves with the function result", async () => {
    const limit = asyncq(1);
    await expect(limit(async () => 42)).resolves.toBe(42);
    await expect(limit(async () => "ok")).resolves.toBe("ok");
  });

  it("never exceeds maxRunning concurrency", async () => {
    const limit = asyncq(2);
    let concurrent = 0;
    let peak = 0;

    const task = async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await delay(20);
      concurrent--;
    };

    await Promise.all(Array.from({ length: 8 }, () => limit(task)));

    expect(peak).toBe(2);
    expect(limit.active).toBe(0);
    expect(limit.pending).toBe(0);
  });

  it("runs jobs in FIFO order", async () => {
    const limit = asyncq(1);
    const order: number[] = [];

    const jobs = [0, 1, 2, 3].map((n) =>
      limit(async () => {
        order.push(n);
        await delay(5);
        return n;
      }),
    );

    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("continues after a rejection", async () => {
    const limit = asyncq(1);
    const error = new Error("boom");

    const failed = limit(async () => {
      throw error;
    });
    const ok = limit(async () => "recovered");

    await expect(failed).rejects.toBe(error);
    await expect(ok).resolves.toBe("recovered");
    expect(limit.active).toBe(0);
    expect(limit.pending).toBe(0);
  });

  it("exposes active and pending counts", async () => {
    const limit = asyncq(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const first = limit(async () => {
      await gate;
      return 1;
    });
    const second = limit(async () => 2);

    await delay(0);

    expect(limit.active).toBe(1);
    expect(limit.pending).toBe(1);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(limit.active).toBe(0);
    expect(limit.pending).toBe(0);
  });

  it("allows maxRunning concurrent starts immediately", async () => {
    const limit = asyncq(3);
    let started = 0;

    const tasks = Array.from({ length: 3 }, () =>
      limit(async () => {
        started++;
        await delay(30);
      }),
    );

    await delay(5);
    expect(started).toBe(3);
    expect(limit.active).toBe(3);

    await Promise.all(tasks);
  });
});
