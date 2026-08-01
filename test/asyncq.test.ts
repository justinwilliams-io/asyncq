import { describe, expect, it } from "vitest";
import asyncq, { AbortError, QueueClearedError } from "../src/index.js";

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

  describe("clear", () => {
    it("rejects pending jobs by default and leaves active running", async () => {
      const limit = asyncq(1);
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const activeJob = limit(async () => {
        await gate;
        return "active";
      });
      const pendingJob = limit(async () => "pending");

      await delay(0);
      expect(limit.active).toBe(1);
      expect(limit.pending).toBe(1);

      limit.clear();

      expect(limit.pending).toBe(0);
      await expect(pendingJob).rejects.toBeInstanceOf(QueueClearedError);

      release();
      await expect(activeJob).resolves.toBe("active");
      expect(limit.active).toBe(0);
    });

    it("clear(false) drops pending without settling", async () => {
      const limit = asyncq(1);
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const activeJob = limit(async () => {
        await gate;
        return "active";
      });
      const pendingJob = limit(async () => "pending");

      await delay(0);
      limit.clear(false);

      expect(limit.pending).toBe(0);

      const raced = await Promise.race([
        pendingJob.then(
          () => "resolved",
          () => "rejected",
        ),
        delay(30).then(() => "hanging"),
      ]);
      expect(raced).toBe("hanging");

      release();
      await expect(activeJob).resolves.toBe("active");
    });
  });

  describe("concurrency", () => {
    it("reads initial concurrency", () => {
      const limit = asyncq(4);
      expect(limit.concurrency).toBe(4);
    });

    it("throws for invalid concurrency", () => {
      const limit = asyncq(2);
      expect(() => {
        limit.concurrency = 0;
      }).toThrow(RangeError);
      expect(() => {
        limit.concurrency = 1.5;
      }).toThrow(RangeError);
      expect(limit.concurrency).toBe(2);
    });

    it("increases concurrency and drains backlog", async () => {
      const limit = asyncq(1);
      let concurrent = 0;
      let peak = 0;
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((r) => {
        releaseFirst = r;
      });

      const jobs = [
        limit(async () => {
          concurrent++;
          peak = Math.max(peak, concurrent);
          await firstGate;
          concurrent--;
        }),
        ...Array.from({ length: 3 }, () =>
          limit(async () => {
            concurrent++;
            peak = Math.max(peak, concurrent);
            await delay(20);
            concurrent--;
          }),
        ),
      ];

      await delay(0);
      expect(limit.active).toBe(1);
      expect(limit.pending).toBe(3);

      limit.concurrency = 3;
      releaseFirst();

      await Promise.all(jobs);
      expect(peak).toBe(3);
    });

    it("decreases concurrency without preempting active jobs", async () => {
      const limit = asyncq(3);
      let concurrent = 0;
      let peak = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const firstWave = Array.from({ length: 3 }, () =>
        limit(async () => {
          concurrent++;
          peak = Math.max(peak, concurrent);
          await gate;
          concurrent--;
        }),
      );

      await delay(0);
      expect(limit.active).toBe(3);

      limit.concurrency = 1;
      expect(limit.concurrency).toBe(1);

      const secondWave = Array.from({ length: 2 }, () =>
        limit(async () => {
          concurrent++;
          peak = Math.max(peak, concurrent);
          await delay(10);
          concurrent--;
        }),
      );

      release();
      await Promise.all([...firstWave, ...secondWave]);

      expect(peak).toBe(3);
      expect(limit.active).toBe(0);
    });
  });

  describe("onIdle", () => {
    it("resolves immediately when already idle", async () => {
      const limit = asyncq(1);
      await expect(limit.onIdle()).resolves.toBeUndefined();
    });

    it("resolves when active and pending drain", async () => {
      const limit = asyncq(1);
      let settled = false;

      const work = limit(async () => {
        await delay(20);
      });
      const idle = limit.onIdle().then(() => {
        settled = true;
      });

      await delay(0);
      expect(settled).toBe(false);

      await work;
      await idle;
      expect(settled).toBe(true);
      expect(limit.active).toBe(0);
      expect(limit.pending).toBe(0);
    });

    it("resolves multiple waiters", async () => {
      const limit = asyncq(1);
      const work = limit(async () => {
        await delay(10);
      });

      const a = limit.onIdle();
      const b = limit.onIdle();

      await work;
      await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
    });

    it("does not resolve while work remains", async () => {
      const limit = asyncq(1);
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const work = limit(async () => {
        await gate;
      });
      const idle = limit.onIdle();

      const raced = await Promise.race([
        idle.then(() => "idle"),
        delay(20).then(() => "waiting"),
      ]);
      expect(raced).toBe("waiting");

      release();
      await work;
      await idle;
    });
  });

  describe("AbortSignal", () => {
    it("rejects immediately when signal is already aborted", async () => {
      const limit = asyncq(1);
      const controller = new AbortController();
      controller.abort();

      let ran = false;
      await expect(
        limit(
          async () => {
            ran = true;
          },
          { signal: controller.signal },
        ),
      ).rejects.toBeInstanceOf(AbortError);
      expect(ran).toBe(false);
    });

    it("aborts a pending job before it starts", async () => {
      const limit = asyncq(1);
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const activeJob = limit(async () => {
        await gate;
        return "active";
      });

      const controller = new AbortController();
      let ran = false;
      const pendingJob = limit(
        async () => {
          ran = true;
          return "pending";
        },
        { signal: controller.signal },
      );

      await delay(0);
      expect(limit.pending).toBe(1);

      controller.abort();
      await expect(pendingJob).rejects.toBeInstanceOf(AbortError);
      expect(ran).toBe(false);
      expect(limit.pending).toBe(0);

      release();
      await expect(activeJob).resolves.toBe("active");
    });

    it("does not reject after the job has started", async () => {
      const limit = asyncq(1);
      const controller = new AbortController();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const job = limit(
        async () => {
          await gate;
          return "done";
        },
        { signal: controller.signal },
      );

      await delay(0);
      expect(limit.active).toBe(1);

      controller.abort();
      release();
      await expect(job).resolves.toBe("done");
    });

    it("does not stall the queue after aborting pending work", async () => {
      const limit = asyncq(1);
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      const first = limit(async () => {
        await gate;
      });

      const controller = new AbortController();
      const aborted = limit(async () => "nope", { signal: controller.signal });
      const third = limit(async () => "ok");

      await delay(0);
      controller.abort();
      await expect(aborted).rejects.toBeInstanceOf(AbortError);

      release();
      await first;
      await expect(third).resolves.toBe("ok");
    });
  });
});
