export type AsyncQueue = {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
};

export function asyncq(maxRunning: number): AsyncQueue {
  if (!Number.isInteger(maxRunning) || maxRunning < 1) {
    throw new RangeError("maxRunning must be an integer >= 1");
  }

  let active = 0;

  const queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];

  const runNext = () => {
    if (active >= maxRunning || queue.length === 0) return;

    active++;
    const job = queue.shift()!;

    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        runNext();
      });
  };

  const limit = (<T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push({
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      runNext();
    })) as AsyncQueue;

  Object.defineProperties(limit, {
    active: {
      get: () => active,
      enumerable: true,
    },
    pending: {
      get: () => queue.length,
      enumerable: true,
    },
  });

  return limit;
}

export default asyncq;
