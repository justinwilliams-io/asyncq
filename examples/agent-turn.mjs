/**
 * Fake agent turn: exercise asyncq the way a tool-using agent would.
 *
 *   npm run build && node examples/agent-turn.mjs
 *   node examples/agent-turn.mjs --abort-ms=80
 *
 * No LLM required. Prints pool load and timings so you can see the cap work.
 */

import asyncq, { AbortError, QueueClearedError } from "../dist/index.js";

const abortMs = Number(
  process.argv.find((a) => a.startsWith("--abort-ms="))?.split("=")[1] ?? "",
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pretend tool: variable latency work */
async function runTool(name, ms, signal) {
  const start = Date.now();
  const step = 20;
  let left = ms;
  while (left > 0) {
    if (signal?.aborted) {
      const err = new Error(`tool ${name} aborted in-flight`);
      err.name = "AbortError";
      throw err;
    }
    const chunk = Math.min(step, left);
    await sleep(chunk);
    left -= chunk;
  }
  return { name, ms, took: Date.now() - start };
}

function stamp(tools, llm, browser) {
  return `tools a=${tools.active}/p=${tools.pending}  llm a=${llm.active}/p=${llm.pending}  browser a=${browser.active}/p=${browser.pending}`;
}

async function main() {
  const tools = asyncq(3);
  const llm = asyncq(1);
  const browser = asyncq(1);
  const turn = new AbortController();

  console.log("=== agent turn: bounded tool + llm + browser pools ===\n");

  if (Number.isFinite(abortMs) && abortMs > 0) {
    console.log(`Will abort turn at ${abortMs}ms (pending cancel + clear)\n`);
    setTimeout(() => {
      console.log(`\n[stop] abort + clear @ ${abortMs}ms  (${stamp(tools, llm, browser)})`);
      turn.abort();
      tools.clear();
      llm.clear();
      browser.clear();
    }, abortMs);
  }

  const toolCalls = [
    ["read_file", 120],
    ["search", 200],
    ["web_fetch_a", 180],
    ["web_fetch_b", 150],
    ["web_fetch_c", 160],
    ["grep", 100],
    ["bash", 220],
  ];

  const log = [];
  const tick = setInterval(() => {
    log.push(stamp(tools, llm, browser));
  }, 40);

  const toolPromise = Promise.all(
    toolCalls.map(([name, ms]) =>
      tools(
        () => runTool(name, ms, turn.signal),
        { signal: turn.signal },
      )
        .then((r) => {
          console.log(`  ok   tool:${r.name} (${r.took}ms)`);
          return r;
        })
        .catch((err) => {
          const kind =
            err instanceof AbortError || err instanceof QueueClearedError
              ? err.name
              : err.name === "AbortError"
                ? "AbortError"
                : "Error";
          console.log(`  skip tool:${name} [${kind}] ${err.message}`);
          return null;
        }),
    ),
  );

  const llmPromise = llm(
    async () => {
      await sleep(90);
      if (turn.signal.aborted) throw new AbortError("llm pending/turn aborted");
      console.log("  ok   llm:plan");
      return { role: "assistant", content: "plan" };
    },
    { signal: turn.signal },
  ).catch((err) => {
    console.log(`  skip llm [${err.name}] ${err.message}`);
    return null;
  });

  const browserPromise = browser(
    () => runTool("click", 140, turn.signal),
    { signal: turn.signal },
  )
    .then((r) => {
      console.log(`  ok   browser:${r.name} (${r.took}ms)`);
      return r;
    })
    .catch((err) => {
      console.log(`  skip browser [${err.name}] ${err.message}`);
      return null;
    });

  const t0 = Date.now();
  const [toolResults, llmResult, browserResult] = await Promise.all([
    toolPromise,
    llmPromise,
    browserPromise,
  ]);

  await Promise.all([tools.onIdle(), llm.onIdle(), browser.onIdle()]);
  clearInterval(tick);

  const okTools = toolResults.filter(Boolean).length;
  console.log("\n=== done ===");
  console.log(`wall ${Date.now() - t0}ms`);
  console.log(`tools finished ${okTools}/${toolCalls.length}`);
  console.log(`llm ${llmResult ? "ok" : "skipped"} | browser ${browserResult ? "ok" : "skipped"}`);
  console.log(`final ${stamp(tools, llm, browser)}`);
  if (log.length) {
    console.log("\nload samples (every ~40ms):");
    for (const line of log.slice(0, 12)) console.log(`  ${line}`);
    if (log.length > 12) console.log(`  … ${log.length - 12} more`);
  }

  // Sanity: never more than 3 tools at once in samples
  const toolActives = log.map((l) => Number(l.match(/tools a=(\d+)/)?.[1] ?? 0));
  const peakTools = toolActives.length ? Math.max(...toolActives) : 0;
  if (peakTools > 3) {
    console.error(`\nFAIL: tools peak concurrency ${peakTools} > 3`);
    process.exitCode = 1;
  } else {
    console.log(`\npeak tools.active observed: ${peakTools} (cap 3)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
