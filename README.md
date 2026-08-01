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
| Size | ~300 B | larger |
| API | single function | single function |
| Inspect counts | `active` / `pending` | via separate package |

Same idea as the excellent [`p-limit`](https://github.com/sindresorhus/p-limit), stripped to the essentials.

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

Errors from individual jobs reject only that promise. The queue keeps draining.

## API

### `asyncq(maxRunning)`

Creates a limiter.

| Parameter | Type | Description |
|---|---|---|
| `maxRunning` | `number` | Max concurrent jobs. Integer `>= 1`. |

**Returns** a function with the shape:

```ts
type AsyncQueue = {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
};
```

| | |
|---|---|
| `limit(fn)` | Enqueues `fn` and returns its promise. Runs when a slot is free. FIFO. |
| `limit.active` | Jobs currently running. |
| `limit.pending` | Jobs waiting in the queue. |

Throws `RangeError` if `maxRunning` is not an integer `>= 1`.

## License

[MIT](./LICENSE) © justinwilliams.dev
