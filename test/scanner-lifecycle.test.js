const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCAN_LIFECYCLE_PHASES, scanProgressPhase, createScannerPhaseTimeline } = require("../electron/scanner-lifecycle");

const contract = JSON.parse(fs.readFileSync(
  path.join(__dirname, "cross-app-scanner-lifecycle-v1.json"),
  "utf8"
));

test("scanner lifecycle uses the shared sister-app phase vocabulary", () => {
  assert.equal(contract.contract, "cocoaspice-spcboy-scanner-lifecycle");
  assert.equal(contract.version, 1);
  assert.deepEqual(SCAN_LIFECYCLE_PHASES, contract.phases);
  assert.deepEqual(scanProgressPhase("inspection", { completed: 2 }), {
    completed: 2,
    phase: "inspection"
  });
  assert.throws(() => scanProgressPhase("mystery"), /Unknown scanner lifecycle phase/);
});

test("scanner timeline reports phase and total elapsed time", () => {
  let now = 0;
  const timeline = createScannerPhaseTimeline(() => now);
  assert.equal(timeline.enter("preparing").elapsedMs, 0);
  now = 5;
  const discovery = timeline.enter("discovery");
  assert.equal(discovery.phaseDurationsMs.preparing, 5);
  now = 12;
  assert.deepEqual(timeline.snapshot(), {
    elapsedMs: 12,
    phaseDurationsMs: {
      preparing: 5,
      discovery: 7,
      planning: 0,
      archiveListing: 0,
      materialization: 0,
      inspection: 0,
      persistence: 0,
      publication: 0,
      cleanup: 0
    }
  });
});
