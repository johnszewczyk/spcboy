const test = require("node:test");
const assert = require("node:assert/strict");
const { createAsyncLimiter, withScanTimeout } = require("../electron/scanner-scheduler");

test("limits concurrent scanner operations", async () => {
  const run = createAsyncLimiter(1);
  let active = 0;
  let maximum = 0;
  await Promise.all([1, 2, 3].map(() => run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  })));
  assert.equal(maximum, 1);
});

test("cancelled limiter waiters settle immediately without consuming capacity", async () => {
  const run = createAsyncLimiter(1);
  let releaseFirst;
  let queuedOperationRan = false;
  const first = run(() => new Promise((resolve) => { releaseFirst = resolve; }));
  while (!releaseFirst) await new Promise((resolve) => setImmediate(resolve));

  const controller = new AbortController();
  const queued = run(async () => {
    queuedOperationRan = true;
  }, { signal: controller.signal });
  controller.abort(new Error("Library operation cancelled"));

  await assert.rejects(queued, /Library operation cancelled/);
  assert.equal(queuedOperationRan, false);
  releaseFirst();
  await first;
  assert.equal(await run(async () => 42), 42);
});

test("times out bounded scanner work", async () => {
  let aborted = false;
  await assert.rejects(
    withScanTimeout((signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    }), 10, "fixture inspection"),
    /Timed out after 0.01 seconds: fixture inspection/
  );
  assert.equal(aborted, true);
});

test("propagates caller cancellation into active scanner work", async () => {
  const controller = new AbortController();
  const operation = withScanTimeout((signal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), 10_000, "fixture inspection", { signal: controller.signal });
  controller.abort(new Error("Library operation cancelled"));
  await assert.rejects(operation, /Library operation cancelled/);
});
