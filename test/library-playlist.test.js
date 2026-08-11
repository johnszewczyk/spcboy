const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createPlaylistReader } = require("../electron/library-playlist");

test("selecting a playable file builds its one-item playlist without listing sibling sources", async () => {
  const calls = { expand: 0 };
  const reader = createPlaylistReader({
    fs: { stat: async () => ({ isFile: () => true }) },
    path,
    supportsPath: (filePath) => filePath.endsWith(".spc"),
    isSupportedArchivePath: () => false,
    discoverPhysicalSources: async () => { throw new Error("sibling enumeration is forbidden for a file selection"); },
    expandArchiveSources: async () => { calls.expand += 1; return []; },
    archiveListConcurrency: 2
  });

  const playlist = await reader.readPlaylistForFile("/music/set/song.spc");
  assert.equal(calls.expand, 0);
  assert.deepEqual(playlist.map((track) => ({ path: track.path, title: track.title, system: track.system })), [{
    path: "/music/set/song.spc", title: "song", system: "SNES"
  }]);
});

test("selecting an archive expands only that archive", async () => {
  const expandedSources = [];
  const reader = createPlaylistReader({
    fs: { stat: async () => ({ isFile: () => true }) },
    path,
    supportsPath: () => false,
    isSupportedArchivePath: (filePath) => filePath.endsWith(".zip"),
    discoverPhysicalSources: async () => { throw new Error("sibling enumeration is forbidden for an archive selection"); },
    expandArchiveSources: async (sources) => {
      expandedSources.push(...sources);
      return [{ path: sources[0].path, archivePath: sources[0].path, archiveEntry: "track.spc" }];
    },
    archiveListConcurrency: 2
  });

  const playlist = await reader.readPlaylistForFile("/music/set/game.zip");
  assert.deepEqual(expandedSources, [{ path: "/music/set/game.zip", archivePath: "/music/set/game.zip", archiveEntry: null }]);
  assert.equal(playlist[0].archiveEntry, "track.spc");
});
