const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const path = require("node:path");
const { createNativeAudioTools } = require("../electron/native-audio-tools");
const { backendForPath, supportsNativePlayback } = require("../electron/playback-core");
const { createTrackInspector } = require("../electron/track-inspector");
const { createCompatibilityPcmProbe, scanCompatibilityRoots } = require("../test-support/production-scanner-harness");

const fixtureRoots = String(process.env.SPCBOY_COMPATIBILITY_ROOTS || "")
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter(Boolean);

function failureSummary(report) {
  return report.roots
    .flatMap((root) => root.outcomes)
    .filter((outcome) => outcome.state === "failed" || outcome.state === "cancelled")
    .map((outcome) => `${outcome.stage}: ${outcome.identity.sourcePath}${outcome.identity.archiveEntry ? `#${outcome.identity.archiveEntry}` : ""}: ${outcome.message}`)
    .join("\n");
}

test("production scanner accepts and audibly probes the configured compatibility corpus", {
  skip: fixtureRoots.length === 0
    ? "Set SPCBOY_COMPATIBILITY_ROOTS to one or more fixture folders to exercise the production scanner."
    : false
}, async () => {
  for (const rootPath of fixtureRoots) {
    const stat = await fs.stat(rootPath);
    assert.equal(stat.isDirectory(), true, `fixture root is not a folder: ${rootPath}`);
  }

  const nativeAudio = createNativeAudioTools({
    getAppPath: () => path.resolve(__dirname, ".."),
    backendForPath,
    supportsNativePlayback
  });
  try {
    const inspector = createTrackInspector({ nativeAudio });
    const report = await scanCompatibilityRoots({
      rootPaths: fixtureRoots,
      inspectTrackVariants: inspector.inspectTrackVariantsForScan,
      probePlayback: createCompatibilityPcmProbe({ nativeAudio })
    });
    const totalTracks = report.roots.reduce((count, root) => count + root.trackCount, 0);
    const playbackChecks = report.roots.reduce((count, root) => count + (root.scanSummary.byStage.playback || 0), 0);

    assert.ok(totalTracks > 0, "the compatibility corpus did not yield any playable tracks");
    assert.ok(playbackChecks > 0, "the compatibility corpus did not perform any PCM probes");
    assert.equal(failureSummary(report), "");
  } finally {
    nativeAudio.terminate();
  }
});
