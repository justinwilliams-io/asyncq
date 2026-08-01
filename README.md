# asyncq

[![npm version](https://img.shields.io/npm/v/@justinwilliams-io/asyncq.svg)](https://www.npmjs.com/package/@justinwilliams-io/asyncq)
[![CI](https://github.com/justinwilliams-io/asyncq/actions/workflows/ci.yml/badge.svg)](https://github.com/justinwilliams-io/asyncq/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@justinwilliams-io/asyncq.svg)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@justinwilliams-io/asyncq)](https://bundlephobia.com/package/@justinwilliams-io/asyncq)

Tiny zero-dependency async concurrency limiter.

Limit how many promises run at once — rate-limited fetches, controlled parallelism, gentle backpressure.

```ts
import asyncq from "@justinwilliams-io/asyncq";

const limit = asyncq(3);

const results = await Promise.all(
  urls.map((url) => limit(() => fetch(url).then((r) => r.json()))),
);
```

## Install

```bash
npm install @justinwilliams-io/asyncq
```

```bash
pnpm add @justinwilliams-io/asyncq
```

```bash
yarn add @justinwilliams-io/asyncq
```

## Why asyncq?

| | asyncq | p-limit |
|---|---|---|
| Dependencies | **0** | 1 |
| Size | tiny | larger |
| API | single function | single function |
| Inspect counts | `active` / `pending` | via separate package |
| Clear / idle / abort | built in | partial / extra packages |

Same idea as the excellent [`p-limit`](https://github.com/sindresorhus/p-limit), stripped to the essentials — plus clear, dynamic concurrency, idle wait, and abort.

## Usage

### Basic

```ts
import asyncq from "@justinwilliams-io/asyncq";
// or: import { asyncq } from "@justinwilliams-io/asyncq";

const limit = asyncq(2);

await limit(async () => {
  // at most 2 of these run at once
});
```

### Rate-limited fetches

```ts
import asyncq from "@justinwilliams-io/asyncq";

const limit = asyncq(5);

async function getUser(id: string) {
  return limit(async () => {
    const res = await fetch(`https://api.example.com/users/${id}`);
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  });
}

const users = await Promise.all(ids.map(getUser));
```

### Inspect the queue

```ts
const limit = asyncq(3);

limit(() => doWork());
limit(() => doWork());
limit(() => doWork());
limit(() => doWork());

limit.active;  // 3 — currently running
limit.pending; // 1 — waiting in queue
```

### Clear pending work

```ts
const limit = asyncq(2);

// start a batch…
const jobs = ids.map((id) => limit(() => fetchItem(id)));

// abort the rest of the batch (running jobs keep going)
limit.clear(); // pending promises reject with QueueClearedError

// or drop pending without settling (promises hang — use with care)
limit.clear(false);
```

### Dynamic concurrency

```ts
const limit = asyncq(2);

// scale up under load
limit.concurrency = 10;

// scale back down (does not stop in-flight jobs)
limit.concurrency = 2;
```

### Wait until idle

```ts
const limit = asyncq(4);

for (const item of items) {
  limit(() => process(item));
}

await limit.onIdle(); // active === 0 && pending === 0
```

### AbortSignal (pending jobs only)

```ts
const limit = asyncq(3);
const controller = new AbortController();

const job = limit(() => fetch(url), { signal: controller.signal });

// if still queued, rejects with AbortError and never runs
controller.abort();

// once a job has started, abort does not reject it —
// pass the same signal into fetch/work if you need in-flight cancel
```

Errors from individual jobs reject only that promise. The queue keeps draining.

## API

### `asyncq(maxRunning)`

Creates a limiter.

| Parameter | Type | Description |
|---|---|---|
| `maxRunning` | `number` | Initial max concurrent jobs. Integer `>= 1`. |

**Returns** a function with the shape:

```ts
type LimitOptions = { signal?: AbortSignalLike }; // native AbortSignal works

type AsyncQueue = {
  <T>(fn: () => Promise<T>, options?: LimitOptions): Promise<T>;
  readonly active: number;
  readonly pending: number;
  concurrency: number;
  clear(rejectPending?: boolean): void;
  onIdle(): Promise<void>;
};
```

| | |
|---|---|
| `limit(fn, options?)` | Enqueues `fn` and returns its promise. Runs when a slot is free. FIFO. Optional `signal` cancels while still pending. |
| `limit.active` | Jobs currently running. |
| `limit.pending` | Jobs waiting in the queue. |
| `limit.concurrency` | Get/set max concurrent jobs (`integer >= 1`). Increasing starts waiting jobs; decreasing only affects new starts. |
| `limit.clear(rejectPending?)` | Removes all pending jobs. Default `true` rejects them with `QueueClearedError`. `false` drops without settling. Does not stop active jobs. |
| `limit.onIdle()` | Resolves when `active === 0` and `pending === 0`. Resolves immediately if already idle. |

Throws `RangeError` if `maxRunning` / `concurrency` is not an integer `>= 1`.

### Errors

| Class | When |
|---|---|
| `AbortError` | Pending job aborted via `AbortSignal`, or signal already aborted at enqueue. |
| `QueueClearedError` | Pending job rejected by `clear()` / `clear(true)`. |

```ts
import asyncq, { AbortError, QueueClearedError } from "@justinwilliams-io/asyncq";
```

## License

[MIT](./LICENSE) © justinwilliams.dev
