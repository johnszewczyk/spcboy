const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createScanOutcome,
  formatScanOutcome,
  summarizeScanOutcomes
} = require("../electron/scanner-model");
const { normalizeArchiveEntry } = require("../electron/archive-path");

test("normalizes harmless archive member path prefixes", () => {
  assert.equal(normalizeArchiveEntry("./01\\Track.vgz"), "01/Track.vgz");
  assert.equal(normalizeArchiveEntry("01//Track.vgz"), "01/Track.vgz");
});

test("creates structured, copyable scan outcomes", () => {
  const outcome = createScanOutcome({
    identity: {
      rootPath: "/music",
      sourcePath: "/music/library.zip",
      archiveEntry: "game/track.miniusf"
    },
    route: { backendId: "lazyusf", extension: ".miniusf" },
    stage: "materialization",
    state: "failed",
    durationMs: 125,
    message: "Missing USF library"
  });

  assert.equal(formatScanOutcome(outcome), "/music/library.zip#game/track.miniusf [lazyusf]: materialization: Missing USF library");
  assert.equal(outcome.durationMs, 125);
});

test("summarizes scan outcomes by stage, state, and backend", () => {
  const outcomes = [
    createScanOutcome({ identity: { sourcePath: "/music/a.spc" }, route: { backendId: "libgme" }, stage: "metadata", state: "successful" }),
    createScanOutcome({ identity: { sourcePath: "/music/b.zip" }, stage: "archiveListing", state: "failed", message: "bad archive" }),
    createScanOutcome({ identity: { sourcePath: "/music/c.vgm" }, route: { backendId: "libvgm" }, stage: "metadata", state: "successful" })
  ];
  assert.deepEqual(summarizeScanOutcomes(outcomes), {
    total: 3,
    byStage: { metadata: 2, archiveListing: 1 },
    byState: { successful: 2, failed: 1 },
    byBackend: { libgme: 1, libvgm: 1 }
  });
});
