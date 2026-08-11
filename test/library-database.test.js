const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { LibraryDatabase } = require("../electron/library-database");
const { SqliteWorkerClient } = require("../electron/sqlite-worker-client");

test("upgrades a pre-browser-bucket library before creating its bucket index", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-db-migration-"));
  const databasePath = path.join(fixtureRoot, "Library.sqlite");
  const legacy = new SqliteWorkerClient(databasePath);
  try {
    await legacy.execute(`
      CREATE TABLE library_roots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL
      );
      CREATE TABLE tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_id INTEGER NOT NULL,
        folder_path TEXT NOT NULL,
        path TEXT NOT NULL,
        filename TEXT NOT NULL,
        extension TEXT NOT NULL,
        track_index INTEGER NOT NULL DEFAULT 0,
        track_count INTEGER NOT NULL DEFAULT 1,
        file_size INTEGER NOT NULL DEFAULT 0,
        modified_at REAL NOT NULL DEFAULT 0,
        discovered_at REAL NOT NULL
      );
    `);
    await legacy.close();
    const database = new LibraryDatabase(databasePath);
    await database.initialize();
    const columnClient = new SqliteWorkerClient(databasePath);
    const columns = await columnClient.query("PRAGMA table_info(tracks);");
    await columnClient.close();
    assert.equal(columns.some((column) => column.name === "browser_game"), true);
    assert.equal(columns.some((column) => column.name === "browser_system"), true);
    const rootColumns = await columnClient.query("PRAGMA table_info(library_roots);");
    assert.equal(rootColumns.some((column) => column.name === "last_scan_started_at"), true);
    assert.equal(rootColumns.some((column) => column.name === "needs_rescan"), true);
    await database.close();
  } finally {
    await legacy.close().catch(() => {});
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("persists scan fingerprints and archive signatures", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-db-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const root = await database.ensureRoot(path.join(fixtureRoot, "library"));
    await database.replaceTracks(root.id, [{
      folderPath: path.join(fixtureRoot, "library"),
      path: `${fixtureRoot}/set.zip#song.nsf`,
      filename: "song.nsf",
      extension: ".nsf",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 123,
      modifiedAt: 4.5,
      archivePath: `${fixtureRoot}/set.zip`,
      archiveEntry: "song.nsf",
      backendId: "libgme",
      specialAudioKind: "nds-raw-pcm22",
      archiveSignature: "listing-signature",
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title: "Song", game: "Game", artist: "Artist", system: "NES", playLengthMs: 1000 }
    }], {
      fileCount: 1,
      successCount: 1,
      outcomes: [{
        identity: { sourcePath: `${fixtureRoot}/set.zip`, archiveEntry: "song.nsf" },
        route: { backendId: "libgme" },
        stage: "metadata",
        state: "successful",
        durationMs: 12,
        message: ""
      }]
    });

    const rows = await database.indexedTrackRecords(root.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].archiveSignature, "listing-signature");
    assert.equal(rows[0].specialAudioKind, "nds-raw-pcm22");
    assert.equal(rows[0].backendId, "libgme");
    assert.equal(rows[0].scanVersion, 1);
    assert.equal(rows[0].scanCompleted, 1);
    assert.equal(rows[0].metadataTrackId > 0, true);
    assert.equal(rows[0].title, "Song");
    const outcomes = await database.loadScanOutcomes(root.id);
    assert.deepEqual(outcomes.map(({ sourcePath, archiveEntry, backendId, stage, state, durationMs }) => ({ sourcePath, archiveEntry, backendId, stage, state, durationMs })), [{
      sourcePath: `${fixtureRoot}/set.zip`,
      archiveEntry: "song.nsf",
      backendId: "libgme",
      stage: "metadata",
      state: "successful",
      durationMs: 12
    }]);

    await database.markSourcesDead([{ rootId: root.id, path: `${fixtureRoot}/set.zip` }]);
    assert.equal(await database.deadSourceCount(), 1);
    assert.equal(await database.deadTrackCount(), 1);
    assert.equal((await database.indexedTrackRecords(root.id)).length, 0);
    await database.restoreSources([{ rootId: root.id, path: `${fixtureRoot}/set.zip` }]);
    assert.equal(await database.deadSourceCount(), 0);
    assert.equal((await database.indexedTrackRecords(root.id)).length, 1);

    await database.markUndiscoveredSourcesDead(root.id, []);
    assert.equal(await database.deadSourceCount(), 1);
    await database.restoreSources([{ rootId: root.id, path: `${fixtureRoot}/set.zip` }]);
    assert.equal(await database.deadSourceCount(), 0);

    await database.markSourcesDead([{ rootId: root.id, path: `${fixtureRoot}/set.zip` }]);
    const purge = await database.deleteDeadSources();
    assert.deepEqual(purge, { purgedSourceCount: 1, purgedTrackCount: 1 });
    assert.equal((await database.indexedTrackRecords(root.id)).length, 0);
    const searchClient = new SqliteWorkerClient(database.databasePath);
    assert.equal(Number((await searchClient.query("SELECT COUNT(*) AS count FROM track_search;"))[0].count), 0);
    await searchClient.close();
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("keeps same game and system separate for each library root", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-root-scoped-games-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const joshPath = path.join(fixtureRoot, "JoshW");
    const smoPath = path.join(fixtureRoot, "SNESMusicOrg");
    const joshRoot = await database.ensureRoot(joshPath);
    const smoRoot = await database.ensureRoot(smoPath);
    const record = (rootPath, title) => ({
      folderPath: rootPath,
      path: path.join(rootPath, "Final Fight.spc"),
      filename: "Final Fight.spc",
      extension: ".spc",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 1,
      modifiedAt: 1,
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title, game: "Final Fight", artist: "Capcom", system: "SNES", playLengthMs: 60_000 }
    });
    await database.replaceTracks(joshRoot.id, [record(joshPath, "Josh Theme")], { fileCount: 1, successCount: 1 });
    await database.replaceTracks(smoRoot.id, [record(smoPath, "SMO Theme")], { fileCount: 1, successCount: 1 });

    const games = await database.loadGames();
    assert.equal(games.length, 2);
    assert.deepEqual(games.map((game) => game.displayName), [
      "Final Fight (SNES • JoshW)",
      "Final Fight (SNES • SNESMusicOrg)"
    ]);

    const joshGame = games.find((game) => game.rootId === joshRoot.id);
    const smoGame = games.find((game) => game.rootId === smoRoot.id);
    assert.deepEqual((await database.tracksForGames([joshGame])).map((row) => row.path), [path.join(joshPath, "Final Fight.spc")]);
    assert.deepEqual((await database.tracksForGames([smoGame])).map((row) => row.path), [path.join(smoPath, "Final Fight.spc")]);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("atomic scans keep the committed sidebar visible and roll back failed replacement", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-atomic-scan-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const root = await database.ensureRoot(path.join(fixtureRoot, "library"));
    const record = (game) => ({
      folderPath: fixtureRoot,
      path: path.join(fixtureRoot, `${game}.spc`),
      filename: `${game}.spc`,
      extension: ".spc",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 1,
      modifiedAt: 1,
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title: "Theme", game, artist: "", system: "SNES", playLengthMs: 1 }
    });

    await database.replaceTracks(root.id, [record("Old")], { fileCount: 1, successCount: 1 });
    assert.deepEqual((await database.loadGames()).map((game) => game.name), ["Old"]);

    await database.beginAtomicScan(root.id);
    await database.restoreSources([{ rootId: root.id, path: record("Uncommitted").path }]);
    await database.replaceTracks(root.id, [record("Uncommitted")], { fileCount: 1, successCount: 1 });
    assert.deepEqual((await database.loadGames()).map((game) => game.name), ["Old"]);
    const observer = new SqliteWorkerClient(database.databasePath, { queryOnly: true });
    const generations = await observer.query(`
      SELECT t.scan_generation AS generation, COUNT(*) AS count,
             t.scan_generation=r.active_scan_generation AS active
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      WHERE t.root_id=${root.id}
      GROUP BY t.scan_generation, active
      ORDER BY active DESC;
    `);
    await observer.close();
    assert.deepEqual(generations.map((row) => [Number(row.active), Number(row.count)]), [[1, 1], [0, 1]]);
    await database.rollbackAtomicScan(root.id);
    assert.deepEqual((await database.loadGames()).map((game) => game.name), ["Old"]);

    await database.beginAtomicScan(root.id);
    await database.restoreSources([{ rootId: root.id, path: record("New").path }]);
    await database.replaceTracks(root.id, [record("New")], { fileCount: 1, successCount: 1 });
    await database.commitAtomicScan(root.id);
    assert.deepEqual((await database.loadGames()).map((game) => game.name), ["New"]);
    assert.equal(await database.deadSourceCount(), 1);
    assert.equal(await database.deadTrackCount(), 1);
    assert.deepEqual(await database.deleteDeadSources(), { purgedSourceCount: 1, purgedTrackCount: 1 });
    assert.deepEqual((await database.loadGames()).map((game) => game.name), ["New"]);
    assert.equal(database.lastAtomicScanMetrics.durationMs >= 0, true);
    assert.equal(database.lastAtomicScanMetrics.stagingDurationMs >= 0, true);
    assert.equal(database.lastAtomicScanMetrics.publishDurationMs >= 0, true);
    assert.equal(database.lastAtomicScanMetrics.cleanupDurationMs >= 0, true);
    assert.equal(Number.isFinite(database.lastAtomicScanMetrics.walGrowthBytes), true);
    assert.equal(database.lastAtomicScanMetrics.databaseBytes > 0, true);
    await database.close();
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("replaces changed archive members by source, not member spelling", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-repack-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const root = await database.ensureRoot(path.join(fixtureRoot, "library"));
    const archivePath = path.join(fixtureRoot, "set.tar.zst");
    const otherArchivePath = path.join(fixtureRoot, "other.zip");
    const record = (archive, entry, title) => ({
      folderPath: fixtureRoot,
      path: `${archive}#${entry}`,
      filename: entry.split("/").pop(),
      extension: ".vgz",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 10,
      modifiedAt: 1,
      archivePath: archive,
      archiveEntry: entry,
      archiveSignature: "new-signature",
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title, game: "Game", artist: "Artist", system: "SEGA", playLengthMs: 1000 }
    });
    await database.replaceTracks(root.id, [
      record(archivePath, "01 - Title Screen.vgz", "Old"),
      record(otherArchivePath, "other.vgz", "Other")
    ], { fileCount: 2, successCount: 2 });
    await database.replaceTracks(root.id, [
      record(archivePath, "./01 - Title Screen.vgz", "New")
    ], {
      fileCount: 1,
      successCount: 1,
      replaceSources: [{ archivePath }]
    });

    const rows = await database.indexedTrackRecords(root.id);
    assert.deepEqual(rows.map((row) => [row.archivePath, row.archiveEntry, row.title]), [
      [otherArchivePath, "other.vgz", "Other"],
      [archivePath, "01 - Title Screen.vgz", "New"]
    ]);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("persists large scan results in metadata-safe batches", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-batches-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const root = await database.ensureRoot(path.join(fixtureRoot, "library"));
    const records = Array.from({ length: 1001 }, (_, index) => ({
      folderPath: fixtureRoot,
      path: path.join(fixtureRoot, `track-${index}.spc`),
      filename: `track-${index}.spc`,
      extension: ".spc",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 10,
      modifiedAt: 1,
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title: `Track ${index}`, game: "Batch", artist: "Artist", system: "SNES", playLengthMs: 1000 }
    }));
    await database.replaceTracks(root.id, records, { fileCount: records.length, successCount: records.length });
    const rows = await database.indexedTrackRecords(root.id);
    assert.equal(rows.length, records.length);
    assert.equal(rows.find((row) => row.path.endsWith("track-1000.spc")).title, "Track 1000");
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("retains queue-time metadata for matching loose and archive tracks", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-queued-metadata-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const root = await database.ensureRoot(path.join(fixtureRoot, "library"));
    const loosePath = path.join(fixtureRoot, "library", "track.vgm");
    const archivePath = path.join(fixtureRoot, "library", "set.zip");
    await database.replaceTracks(root.id, [
      {
        folderPath: path.dirname(loosePath), path: loosePath, filename: "track.vgm", extension: ".vgm", trackIndex: 0, trackCount: 1,
        fileSize: 1, modifiedAt: 1, scanCompleted: true, scanVersion: 1,
        metadata: { title: "Old loose", game: "Old", artist: "Old", system: "SEGA", playLengthMs: 1 }
      },
      {
        folderPath: path.dirname(archivePath), path: `${archivePath}#folder/track.vgm`, filename: "track.vgm", extension: ".vgm", trackIndex: 0, trackCount: 1,
        fileSize: 1, modifiedAt: 1, archivePath, archiveEntry: "folder/track.vgm", scanCompleted: true, scanVersion: 1,
        metadata: { title: "Old archive", game: "Old", artist: "Old", system: "SEGA", playLengthMs: 1 }
      }
    ], { fileCount: 2, successCount: 2 });

    await database.updatePlaylistMetadata([
      { path: loosePath, trackIndex: 0, metadata: { title: "Loose tag", game: "Loose game", artist: "Loose artist", system: "Mega Drive", playLengthMs: 2000 } },
      { archivePath, archiveEntry: "./folder/track.vgm", trackIndex: 0, metadata: { title: "Archive tag", game: "Archive game", artist: "Archive artist", system: "Master System", playLengthMs: 3000 } },
      { path: path.join(fixtureRoot, "not-indexed.vgm"), trackIndex: 0, metadata: { title: "Ignored", game: "", artist: "", system: "", playLengthMs: 1 } }
    ]);

    const rows = await database.indexedTrackRecords(root.id);
    assert.deepEqual(rows.map((row) => [row.archivePath, row.title, row.game, row.artist, row.system, row.playLengthMs]), [
      [archivePath, "Archive tag", "Archive game", "Archive artist", "Master System", 3000],
      [null, "Loose tag", "Loose game", "Loose artist", "Mega Drive", 2000]
    ]);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("finds indexed descendants for Folder view search before their browser branch is opened", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-browser-search-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const rootPath = path.join(fixtureRoot, "library");
    const root = await database.ensureRoot(rootPath);
    const folderPath = path.join(rootPath, "Nintendo DS", "Jenga World Tour");
    const archivePath = path.join(folderPath, "Jenga World Tour.tar.zst");
    await database.replaceTracks(root.id, [{
      folderPath,
      path: `${archivePath}#sound/bgm.xa`,
      filename: "bgm.xa",
      extension: ".xa",
      archivePath,
      archiveEntry: "sound/bgm.xa",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 1,
      modifiedAt: 1,
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title: "Title Screen", game: "Jenga World Tour", artist: "Ato", system: "Nintendo DS", playLengthMs: 1000 }
    }], { fileCount: 1, successCount: 1 });

    const byGame = await database.searchBrowserEntries(rootPath, "jenga world");
    assert.deepEqual(byGame, [{
      rootPath,
      folderPath,
      path: `${archivePath}#sound/bgm.xa`,
      filename: "bgm.xa",
      archivePath,
      archiveEntry: "sound/bgm.xa"
    }]);
    assert.equal((await database.searchBrowserEntries(rootPath, "title screen")).length, 1);
    assert.equal((await database.searchBrowserEntries(rootPath, "jenga nintendo")).length, 1);
    assert.equal((await database.searchBrowserEntries(rootPath, "missing")).length, 0);

    const otherRootPath = path.join(fixtureRoot, "other-library");
    const otherRoot = await database.ensureRoot(otherRootPath);
    const otherFolderPath = path.join(otherRootPath, "Nintendo DS", "Jenga World Tour");
    const otherPath = path.join(otherFolderPath, "other.xa");
    await database.replaceTracks(otherRoot.id, [{
      folderPath: otherFolderPath,
      path: otherPath,
      filename: "other.xa",
      extension: ".xa",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 1,
      modifiedAt: 1,
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title: "Other Title", game: "Jenga World Tour", artist: "Other", system: "Nintendo DS", playLengthMs: 1000 }
    }], { fileCount: 1, successCount: 1 });
    assert.deepEqual((await database.searchBrowserEntries(rootPath, "jenga world")).map((entry) => entry.rootPath), [rootPath]);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("normalizes JoshW archive names and console tags, and keeps Folder and Database searches aligned", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-search-parity-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const rootPath = path.join(fixtureRoot, "audio", "JoshW");
    const root = await database.ensureRoot(rootPath);
    const folderPath = path.join(rootPath, "Sony PlayStation");
    const archivePath = path.join(folderPath, "Silent Hill (1999-03-04)(KCE Tokyo)(Konami)[PS1].tar.zst");
    await database.replaceTracks(root.id, [{
      folderPath,
      path: `${archivePath}#BGM/intro.xa`,
      filename: "intro.xa",
      extension: ".xa",
      archivePath,
      archiveEntry: "BGM/intro.xa",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 1,
      modifiedAt: 1,
      scanCompleted: false,
      scanVersion: 1,
      // This is representative of a failed XA materialization in the old
      // scanner: neither value is suitable for the sidebar's game identity.
      metadata: { title: "", game: "spcboy-scan-scratch-abc", artist: "", system: "Sony XA header", playLengthMs: 0 }
    }], { fileCount: 1, successCount: 0 });

    const games = await database.searchGames("silent hill");
    assert.deepEqual(games.map((game) => ({ name: game.name, system: game.system, rootName: game.rootName })), [{
      name: "Silent Hill (1999-03-04)(KCE Tokyo)(Konami)",
      system: "Sony PlayStation",
      rootName: "JoshW"
    }]);
    assert.equal(games[0].name.includes(fixtureRoot), false);

    const folderEntries = await database.searchBrowserEntries(rootPath, "silent hill");
    assert.equal(folderEntries.length, 1);
    assert.deepEqual(await database.searchGames("silent hill sony"), games);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("batches retained missing sources and excludes them from later Test Files work", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-missing-sources-"));
  try {
    const database = new LibraryDatabase(path.join(fixtureRoot, "Library.sqlite"));
    await database.initialize();
    const root = await database.ensureRoot(path.join(fixtureRoot, "library"));
    const records = Array.from({ length: 501 }, (_, index) => ({
      folderPath: path.join(fixtureRoot, "library"),
      path: path.join(fixtureRoot, "library", `missing-${index}.vgm`),
      filename: `missing-${index}.vgm`,
      extension: ".vgm",
      trackIndex: 0,
      trackCount: 1,
      fileSize: 1,
      modifiedAt: 1,
      scanCompleted: true,
      scanVersion: 1,
      metadata: { title: "", game: "", artist: "", system: "", playLengthMs: 0 }
    }));
    await database.replaceTracks(root.id, records, { fileCount: records.length, successCount: records.length });
    const sources = await database.indexedSources();
    assert.equal(sources.length, 501);
    assert.equal((await database.markSourcesDead(sources)).markedSourceCount, 501);
    assert.equal(await database.deadSourceCount(), 501);
    assert.deepEqual(await database.indexedSources(), []);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
