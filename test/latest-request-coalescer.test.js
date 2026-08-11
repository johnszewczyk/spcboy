const test = require("node:test");
const assert = require("node:assert/strict");
const { createLatestRequestCoalescer } = require("../electron/latest-request-coalescer");

test("latest request coalescer runs the active request and only the newest waiter", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  const search = createLatestRequestCoalescer(async (query) => {
    calls.push(query);
    if (query === "first") await firstGate;
    return [query];
  }, []);

  const first = search("first");
  const superseded = search("second");
  const latest = search("third");
  assert.deepEqual(await superseded, []);
  releaseFirst();

  assert.deepEqual(await first, ["first"]);
  assert.deepEqual(await latest, ["third"]);
  assert.deepEqual(calls, ["first", "third"]);
});

test("latest request coalescer propagates failures and continues", async () => {
  const search = createLatestRequestCoalescer(async (query) => {
    if (query === "bad") throw new Error("search failed");
    return query;
  }, null);
  await assert.rejects(search("bad"), /search failed/);
  assert.equal(await search("good"), "good");
});
