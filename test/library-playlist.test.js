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

test("selecting a loose multi-track file expands every native child track", async () => {
  const inspected = [];
  const reader = createPlaylistReader({
    fs: { stat: async () => ({ isFile: () => true }) },
    path,
    supportsPath: (filePath) => filePath.endsWith(".nsf"),
    routeForPath: () => ({ supportsMultiTrack: true }),
    isSupportedArchivePath: () => false,
    discoverPhysicalSources: async () => [],
    expandArchiveSources: async () => [],
    inspectTrackVariants: async (filePath, sourceName) => {
      inspected.push({ filePath, sourceName });
      return [0, 1, 2].map((trackIndex) => ({
        trackIndex,
        trackCount: 3,
        inspection: { metadata: { song: `Song ${trackIndex + 1}`, game: "Game", system: "NES" } }
      }));
    },
    archiveListConcurrency: 2
  });

  const playlist = await reader.readPlaylistForFile("/music/Nintendo Entertainment System/Game/game.nsf");
  assert.deepEqual(inspected, [{
    filePath: "/music/Nintendo Entertainment System/Game/game.nsf",
    sourceName: "/music/Nintendo Entertainment System/Game/game.nsf"
  }]);
  assert.deepEqual(playlist.map((track) => ({ id: track.id, title: track.title, trackIndex: track.trackIndex })), [
    { id: "/music/Nintendo Entertainment System/Game/game.nsf#0", title: "Song 1", trackIndex: 0 },
    { id: "/music/Nintendo Entertainment System/Game/game.nsf#1", title: "Song 2", trackIndex: 1 },
    { id: "/music/Nintendo Entertainment System/Game/game.nsf#2", title: "Song 3", trackIndex: 2 }
  ]);
});

test("selecting an archived multi-track file materializes it once and expands its children", async () => {
  let cleaned = false;
  const reader = createPlaylistReader({
    fs: { stat: async () => ({ isFile: () => true }) },
    path,
    supportsPath: () => false,
    routeForPath: () => ({ supportsMultiTrack: true }),
    isSupportedArchivePath: (filePath) => filePath.endsWith(".zip"),
    discoverPhysicalSources: async () => [],
    expandArchiveSources: async (sources) => [{ path: sources[0].path, archivePath: sources[0].path, archiveEntry: "game.gbs" }],
    materializeArchiveEntries: async (archivePath, entries) => ({
      paths: new Map([[entries[0], "/tmp/materialized-game.gbs"]]),
      cleanup: async () => { cleaned = true; }
    }),
    inspectTrackVariants: async () => [0, 1].map((trackIndex) => ({
      trackIndex,
      trackCount: 2,
      inspection: { metadata: { song: `GB Song ${trackIndex + 1}`, game: "GB Game", system: "Game Boy" } }
    })),
    archiveListConcurrency: 2
  });

  const playlist = await reader.readPlaylistForFile("/music/Game Boy/game.zip");
  assert.equal(cleaned, true);
  assert.deepEqual(playlist.map((track) => ({ archiveEntry: track.archiveEntry, trackIndex: track.trackIndex })), [
    { archiveEntry: "game.gbs", trackIndex: 0 },
    { archiveEntry: "game.gbs", trackIndex: 1 }
  ]);
});
