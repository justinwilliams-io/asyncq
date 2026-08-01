# asyncq

[![npm version](https://img.shields.io/npm/v/@justinwilliams-io/asyncq.svg)](https://www.npmjs.com/package/@justinwilliams-io/asyncq)
[![CI](https://github.com/justinwilliams-io/asyncq/actions/workflows/ci.yml/badge.svg)](https://github.com/justinwilliams-io/asyncq/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@justinwilliams-io/asyncq.svg)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@justinwilliams-io/asyncq)](https://bundlephobia.com/package/@justinwilliams-io/asyncq)

Tiny zero-dependency async concurrency limiter.

Cap how many promises run at once. Same primitive for everyday JS/TS work (fetches, jobs, backpressure) and for AI agent runtimes (tool calls, subagents, provider fan-out).

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

Same idea as the excellent [`p-limit`](https://github.com/sindresorhus/p-limit), stripped to the essentials, plus clear, dynamic concurrency, idle wait, and abort.

### When to use which

- **asyncq** if you want zero dependencies, built-in `active` / `pending`, `clear()`, `onIdle()`, mutable `concurrency`, and pending-job `AbortSignal` support in one small API.
- **p-limit** if you already depend on the sindresorhus stack, or you only need a minimal limiter and are fine pulling its dependency tree.

Neither replaces a rate limiter (requests per minute, token buckets). Use a concurrency limiter for "how many at once"; pair it with RPM/backoff logic when the API requires it.

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

limit.active;  // 3, currently running
limit.pending; // 1, waiting in queue
```

### Clear pending work

```ts
const limit = asyncq(2);

// start a batch…
const jobs = ids.map((id) => limit(() => fetchItem(id)));

// drop the rest of the batch (running jobs keep going)
limit.clear(); // pending promises reject with QueueClearedError

// or drop pending without settling (promises hang; use with care)
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

// once a job has started, abort does not reject it.
// pass the same signal into fetch/work if you need in-flight cancel
```

Errors from individual jobs reject only that promise. The queue keeps draining.

## AI agents

Agent loops love unbounded `Promise.all`: too many tool calls, subagents, or model requests at once burns rate limits and makes "stop" hard. asyncq is a plain concurrency limiter. It is not an agent framework. Use it at the edges where fan-out happens.

| Agent need | asyncq |
|---|---|
| Cap parallel tool calls | `asyncq(n)` |
| Wait until the turn's work finishes | `onIdle()` |
| User hit stop / plan changed | `clear()` and/or `AbortSignal` on pending jobs |
| Ease up after 429s, open up when healthy | `concurrency = …` |
| See load | `active` / `pending` |

### Bound parallel tool calls

```ts
import asyncq from "@justinwilliams-io/asyncq";

// e.g. at most 4 tools in flight for this turn
const tools = asyncq(4);
const turn = new AbortController();

const results = await Promise.all(
  calls.map((call) =>
    tools(() => runTool(call), { signal: turn.signal }),
  ),
);
```

Pass `turn.signal` into the tool implementation as well if in-flight work should cancel, not only queued work.

### Separate pools for tools, model calls, and browser

One global limit mixes different bottlenecks. Prefer small named limiters:

```ts
import asyncq from "@justinwilliams-io/asyncq";

const tools = asyncq(4);
const llm = asyncq(2);
const browser = asyncq(1); // serial UI / computer-use steps

await Promise.all([
  tools(() => readFile(path)),
  tools(() => search(query)),
  llm(() => complete(messages)),
  browser(() => click(selector)),
]);

await Promise.all([tools.onIdle(), llm.onIdle(), browser.onIdle()]);
```

### Subagents

```ts
import asyncq from "@justinwilliams-io/asyncq";

// hard cap so one workflow cannot spawn dozens of children
const agents = asyncq(3);

await Promise.all(
  tasks.map((task) => agents(() => runSubagent(task))),
);

await agents.onIdle();
```

### Stop / tear down a turn

```ts
import asyncq, { AbortError, QueueClearedError } from "@justinwilliams-io/asyncq";

const tools = asyncq(4);
const turn = new AbortController();

const pending = calls.map((call) =>
  tools(() => runTool(call), { signal: turn.signal }).catch((err) => {
    if (err instanceof AbortError || err instanceof QueueClearedError) {
      return null; // expected on cancel
    }
    throw err;
  }),
);

// user hit stop:
turn.abort();   // rejects jobs still waiting in the queue
tools.clear();  // same idea for anything enqueued without a signal

await tools.onIdle(); // in-flight tools finish unless they honor the signal
```

### Soften concurrency on provider pressure

```ts
const llm = asyncq(4);

async function complete(req: Request) {
  return llm(async () => {
    const res = await callModel(req);
    if (res.status === 429) {
      llm.concurrency = Math.max(1, llm.concurrency - 1);
      // retry / backoff at the call site
    }
    return res;
  });
}
```

Concurrency caps "how many at once." It does not replace retry-after, token buckets, or provider-specific RPM helpers.

### Try it without an LLM

Fake tool/llm/browser pools, optional mid-turn abort:

```bash
npm run example:agent
npm run example:agent:abort
```

See `examples/agent-turn.mjs`.

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
