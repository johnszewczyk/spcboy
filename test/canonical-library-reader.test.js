const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { CanonicalLibraryReader } = require("../electron/canonical-library-reader");

function createCanonicalFixture(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA user_version = 23;
    CREATE TABLE library_roots (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, is_enabled INTEGER NOT NULL,
      display_order INTEGER NOT NULL, is_attached INTEGER NOT NULL,
      last_scan_completed_at REAL, last_scan_error TEXT
    );
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY, root_id INTEGER NOT NULL, folder_path TEXT NOT NULL,
      path TEXT NOT NULL, filename TEXT NOT NULL, browser_game TEXT NOT NULL,
      browser_system TEXT NOT NULL, track_index INTEGER NOT NULL, track_count INTEGER NOT NULL,
      file_size INTEGER NOT NULL, modified_at REAL NOT NULL, archive_path TEXT, archive_entry TEXT
    );
    CREATE TABLE track_metadata (
      track_id INTEGER PRIMARY KEY, title TEXT, game TEXT, author TEXT, system TEXT, play_length_ms INTEGER
    );
    CREATE TABLE dead_sources (root_id INTEGER NOT NULL, path TEXT NOT NULL);
    CREATE TABLE game_sidebar_buckets (root_id INTEGER, browser_game TEXT, browser_system TEXT, track_count INTEGER);
    CREATE TABLE file_sidebar_buckets (root_id INTEGER, folder_path TEXT, path TEXT, is_archive INTEGER, track_count INTEGER);
    INSERT INTO library_roots VALUES (1, '/Music/PS2', 1, 0, 1, 1, NULL);
    INSERT INTO game_sidebar_buckets VALUES (1, 'Castlevania', 'Sony PlayStation 2', 1);
    INSERT INTO tracks VALUES (1, 1, '/Music/PS2/Castlevania', '/Music/PS2/Castlevania/game.psf2', 'game.psf2', 'Castlevania', 'Sony PlayStation 2', 0, 1, 42, 100, NULL, NULL);
    INSERT INTO track_metadata VALUES (1, 'Prologue', 'Castlevania', 'Konami', 'Sony PlayStation 2', 120000);
  `);
  database.close();
}

test("canonical reader loads the CocoaSpice catalog without mutating it", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spcboy-canonical-reader-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "Library.sqlite");
  createCanonicalFixture(databasePath);

  const reader = new CanonicalLibraryReader(databasePath);
  t.after(() => reader.close());
  await reader.initialize();
  assert.equal(reader.isReadOnly, true);
  assert.equal(await reader.trackCount(), 1);
  assert.equal((await reader.loadRoots())[0].path, "/Music/PS2");
  const games = await reader.searchGames("castlevania ps2");
  assert.equal(games.length, 0, "search is token based and does not invent console aliases");
  const selected = await reader.searchGames("Castlevania PlayStation");
  assert.equal(selected[0].system, "Sony PlayStation 2");
  const tracks = await reader.tracksForGames(selected);
  assert.equal(tracks[0].artist, "Konami");
  assert.equal(tracks[0].playLengthMs, 120000);
  await assert.rejects(reader.clearDatabase(), /read-only in SPCBoy/);
  assert.equal(await reader.trackCount(), 1);
});

test("canonical reader rejects a noncanonical schema", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spcboy-invalid-reader-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "Other.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA user_version = 1;");
  database.close();
  const reader = new CanonicalLibraryReader(databasePath);
  t.after(() => reader.close());
  await assert.rejects(reader.initialize(), /expected 23/);
});
