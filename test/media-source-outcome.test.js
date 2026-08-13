const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMediaOutcome,
  formatMediaOutcome,
  summarizeMediaOutcomes
} = require("../electron/media-source-outcome");
const { normalizeArchiveEntry } = require("../electron/archive-path");

test("normalizes harmless archive member path prefixes", () => {
  assert.equal(normalizeArchiveEntry("./01\\Track.vgz"), "01/Track.vgz");
  assert.equal(normalizeArchiveEntry("01//Track.vgz"), "01/Track.vgz");
});

test("creates structured, copyable media outcomes", () => {
  const outcome = createMediaOutcome({
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

  assert.equal(formatMediaOutcome(outcome), "/music/library.zip#game/track.miniusf [lazyusf]: materialization: Missing USF library");
  assert.equal(outcome.durationMs, 125);
});

test("summarizes media outcomes by stage, state, and backend", () => {
  const outcomes = [
    createMediaOutcome({ identity: { sourcePath: "/music/a.spc" }, route: { backendId: "libgme" }, stage: "metadata", state: "successful" }),
    createMediaOutcome({ identity: { sourcePath: "/music/b.zip" }, stage: "archiveListing", state: "failed", message: "bad archive" }),
    createMediaOutcome({ identity: { sourcePath: "/music/c.vgm" }, route: { backendId: "libvgm" }, stage: "metadata", state: "successful" })
  ];
  assert.deepEqual(summarizeMediaOutcomes(outcomes), {
    total: 3,
    byStage: { metadata: 2, archiveListing: 1 },
    byState: { successful: 2, failed: 1 },
    byBackend: { libgme: 1, libvgm: 1 }
  });
});
