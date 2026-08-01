import type { AbortSignalLike, AsyncQueue, LimitOptions } from "./types/index.js";

export type { AbortSignalLike, AsyncQueue, LimitOptions } from "./types/index.js";

export class AbortError extends Error {
  readonly name = "AbortError";
  constructor(message = "Aborted") {
    super(message);
  }
}

export class QueueClearedError extends Error {
  readonly name = "QueueClearedError";
  constructor(message = "Queue cleared") {
    super(message);
  }
}

type Job = {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignalLike | undefined;
  onAbort?: (() => void) | undefined;
};

export function asyncq(maxRunning: number): AsyncQueue {
  if (!Number.isInteger(maxRunning) || maxRunning < 1) {
    throw new RangeError("maxRunning must be an integer >= 1");
  }

  let concurrency = maxRunning;
  let active = 0;
  const queue: Job[] = [];
  const idleWaiters: Array<() => void> = [];

  const notifyIdle = () => {
    if (active !== 0 || queue.length !== 0) return;
    while (idleWaiters.length > 0) {
      idleWaiters.shift()!();
    }
  };

  const detachSignal = (job: Job) => {
    if (job.signal && job.onAbort) {
      job.signal.removeEventListener("abort", job.onAbort);
      job.onAbort = undefined;
    }
  };

  const runNext = () => {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift()!;
      detachSignal(job);
      active++;

      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          notifyIdle();
          runNext();
        });
    }
  };

  const limit = (<T>(
    fn: () => Promise<T>,
    options?: LimitOptions,
  ): Promise<T> => {
    const signal = options?.signal;

    if (signal?.aborted) {
      return Promise.reject(new AbortError());
    }

    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
      };

      if (signal) {
        job.onAbort = () => {
          const index = queue.indexOf(job);
          if (index === -1) return;
          queue.splice(index, 1);
          detachSignal(job);
          reject(new AbortError());
          notifyIdle();
        };
        signal.addEventListener("abort", job.onAbort, { once: true });
      }

      queue.push(job);
      runNext();
    });
  }) as AsyncQueue;

  Object.defineProperties(limit, {
    active: {
      get: () => active,
      enumerable: true,
    },
    pending: {
      get: () => queue.length,
      enumerable: true,
    },
    concurrency: {
      get: () => concurrency,
      set: (value: number) => {
        if (!Number.isInteger(value) || value < 1) {
          throw new RangeError("concurrency must be an integer >= 1");
        }
        concurrency = value;
        runNext();
      },
      enumerable: true,
    },
    clear: {
      value: (rejectPending = true) => {
        const pending = queue.splice(0, queue.length);
        for (const job of pending) {
          detachSignal(job);
          if (rejectPending) {
            job.reject(new QueueClearedError());
          }
        }
        notifyIdle();
      },
      enumerable: true,
    },
    onIdle: {
      value: () => {
        if (active === 0 && queue.length === 0) {
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          idleWaiters.push(resolve);
        });
      },
      enumerable: true,
    },
  });

  return limit;
}

export default asyncq;
