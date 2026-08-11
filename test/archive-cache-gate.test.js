const test = require("node:test");
const assert = require("node:assert/strict");
const { ArchiveCacheGate } = require("../electron/archive-cache-gate");

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("archive cache gate prevents clearing a materialization in flight", async () => {
  const gate = new ArchiveCacheGate();
  const pending = deferred();
  const materialization = gate.materialize(async () => pending.promise);

  assert.equal(gate.isBusy, true);
  await assert.rejects(gate.clear(async () => {}), /in use/);
  pending.resolve("ready");
  assert.equal(await materialization, "ready");
  assert.equal(gate.isBusy, false);
});

test("archive cache gate rejects new materialization while clearing", async () => {
  const gate = new ArchiveCacheGate();
  const pending = deferred();
  const clearing = gate.clear(async () => pending.promise);

  assert.equal(gate.isBusy, true);
  await assert.rejects(gate.materialize(async () => "unexpected"), /being cleared/);
  pending.resolve("cleared");
  assert.equal(await clearing, "cleared");
  assert.equal(gate.isBusy, false);
});
