const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistArchiveMetadataService } = require("../electron/playlist-archive-metadata");

test("hydrates archive rows through one materialization session per archive", async () => {
  const materializedGroups = [];
  const inspectedPaths = [];
  let cleanupCount = 0;
  const service = createPlaylistArchiveMetadataService({
    async materializeArchiveEntries(archivePath, entries) {
      materializedGroups.push({ archivePath, entries });
      return {
        paths: new Map(entries.map((entry) => [entry, `/scratch/${archivePath.split("/").pop()}/${entry}`])),
        cleanup: async () => { cleanupCount += 1; }
      };
    },
    async inspectTrack(trackPath, sourceName) {
      inspectedPaths.push({ trackPath, sourceName });
      return { metadata: { song: sourceName, game: "Game", author: "Artist", system: "System" }, lengthLabel: "1:23", basePlaybackSeconds: 83 };
    },
    inspectionConcurrency: 2
  });

  const updates = await service.hydrate([
    { id: "one", archivePath: "/music/one.tar.zst", archiveEntry: "one.vgm", sourceFilename: "one.vgm", trackIndex: 0 },
    { id: "two", archivePath: "/music/one.tar.zst", archiveEntry: "two.vgm", sourceFilename: "two.vgm", trackIndex: 0 },
    { id: "three", archivePath: "/music/two.zip", archiveEntry: "three.vgm", sourceFilename: "three.vgm", trackIndex: 0 }
  ]);

  assert.deepEqual(materializedGroups, [
    { archivePath: "/music/one.tar.zst", entries: ["one.vgm", "two.vgm"] },
    { archivePath: "/music/two.zip", entries: ["three.vgm"] }
  ]);
  assert.equal(cleanupCount, 2);
  assert.equal(inspectedPaths.length, 3);
  assert.deepEqual(updates.map((update) => [update.id, update.inspection.metadata.song]), [["one", "one.vgm"], ["two", "two.vgm"], ["three", "three.vgm"]]);
});
