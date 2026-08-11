const test = require("node:test");
const assert = require("node:assert/strict");
const { createCompatibilityPcmProbe, hasAudiblePcm } = require("../test-support/production-scanner-harness");

test("PCM compatibility probe decodes two SPC chunks through the native libgme route", async () => {
  const calls = [];
  const probe = createCompatibilityPcmProbe({
    nativeAudio: {
      async decodeGme(...args) {
        calls.push(args);
        return Buffer.from([1, 0, 0, 0]);
      }
    },
    chunkDurationMs: 250
  });

  const result = await probe({
    path: "/temporary/track.spc",
    sourceName: "archive/track.spc",
    route: { backendId: "libgme", displayName: "libgme" },
    trackIndex: 3
  });

  assert.deepEqual(calls, [
    ["/temporary/track.spc", 3, 0, 250, 0],
    ["/temporary/track.spc", 3, 250, 250, 0]
  ]);
  assert.deepEqual(result, { chunkCount: 2, chunkDurationMs: 250, totalBytes: 8, audibleChunks: 2 });
});

test("PCM compatibility probe rejects entirely silent output", async () => {
  const probe = createCompatibilityPcmProbe({
    nativeAudio: {
      async decodeFfmpeg() {
        return Buffer.alloc(8);
      }
    }
  });

  await assert.rejects(probe({
    path: "/temporary/track.flac",
    sourceName: "/music/track.flac",
    route: { backendId: "standard-audio", displayName: "Core Audio" }
  }), /only silence across 2 chunks/);
  assert.equal(hasAudiblePcm(Buffer.from([0, 0, 1, 0])), true);
  assert.equal(hasAudiblePcm(Buffer.alloc(8)), false);
});
