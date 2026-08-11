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
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
