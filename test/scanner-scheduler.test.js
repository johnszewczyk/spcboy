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

test("times out bounded scanner work", async () => {
  await assert.rejects(
    withScanTimeout(() => new Promise(() => {}), 10, "fixture inspection"),
    /Timed out after 0.01 seconds: fixture inspection/
  );
});
