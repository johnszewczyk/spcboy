const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { createTrackInspector } = require("../electron/playlist-track-inspector");

test("track inspector caches lightweight metadata and expands native multi-track results", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-track-inspector-"));
  t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const trackPath = path.join(rootPath, "song.nsf");
  await fs.writeFile(trackPath, "fixture", "utf8");

  let gmeInspections = 0;
  let allInspections = 0;
  const inspector = createTrackInspector({
    nativeAudio: {
      async inspectGme() {
        gmeInspections += 1;
        return { song: "Song", game: "Game", author: "Artist", system: "NES", play_length: 12345 };
      },
      async inspectAll() {
        allInspections += 1;
        return {
          track_count: 2,
          tracks: [
            { song: "One", game: "Game", author: "Artist", system: "NES", play_length: 1000 },
            { song: "Two", game: "Game", author: "Artist", system: "NES", play_length: 2000 }
          ]
        };
      }
    },
    cacheMaxEntries: 2
  });

  const first = await inspector.inspectTrack(trackPath);
  const second = await inspector.inspectTrack(trackPath);
  const variants = await inspector.inspectTrackVariantsForPlaylist(trackPath);

  assert.equal(first.metadata.song, "Song");
  assert.equal(first.lengthLabel, "0:12");
  assert.deepEqual(second, first);
  assert.equal(gmeInspections, 1);
  assert.equal(allInspections, 1);
  assert.deepEqual(variants.map((variant) => variant.inspection.metadata.song), ["One", "Two"]);
  assert.deepEqual(variants.map((variant) => variant.trackCount), [2, 2]);
});

test("track inspector reports required decoder failures instead of indexing generic metadata", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-track-inspector-failure-"));
  t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const trackPath = path.join(rootPath, "broken.xm");
  await fs.writeFile(trackPath, "not a module", "utf8");
  const inspector = createTrackInspector({
    nativeAudio: {
      async inspectOpenMpt() {
        throw new Error("openmpt123 rejected the module");
      }
    }
  });

  await assert.rejects(
    inspector.inspectTrackVariantsForPlaylist(trackPath),
    /openmpt123 rejected the module/
  );
});
