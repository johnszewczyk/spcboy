const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { createTrackInspector } = require("../electron/playlist-track-inspector");

test("track inspector caches pathname-only disk entries without starting a decoder", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-track-inspector-"));
  t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const trackPath = path.join(rootPath, "song.nsf");
  await fs.writeFile(trackPath, "fixture", "utf8");

  const inspector = createTrackInspector({
    cacheMaxEntries: 2,
    nativeAudio: { playbackStructure: async () => ({ trackCount: 2, tracks: [{ index: 1, naturalPlayMilliseconds: 12_345 }] }) }
  });

  const first = await inspector.inspectTrack(trackPath);
  const second = await inspector.inspectTrack(trackPath);
  const variants = await inspector.inspectTrackVariantsForPlaylist(trackPath);

  assert.equal(first.metadata.song, "song");
  assert.equal(first.lengthLabel, "—");
  assert.deepEqual(second, first);
  assert.deepEqual(variants.map((variant) => variant.inspection.metadata.song), ["song", "song"]);
  assert.deepEqual(variants.map((variant) => variant.trackCount), [2, 2]);
  assert.equal(variants[1].inspection.lengthLabel, "0:12");
});

test("track inspector does not ask a decoder to validate local browsing", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-track-inspector-failure-"));
  t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const trackPath = path.join(rootPath, "broken.xm");
  await fs.writeFile(trackPath, "not a module", "utf8");
  const inspector = createTrackInspector({ nativeAudio: { playbackStructure: async () => ({ trackCount: 1, tracks: [] }) } });
  const variants = await inspector.inspectTrackVariantsForPlaylist(trackPath);
  assert.equal(variants[0].inspection.metadataSource, "pathname");
});
