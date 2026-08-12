const path = require("path");
const fs = require("fs").promises;
const { randomUUID } = require("crypto");
const { normalizeArchiveEntry } = require("./archive-path");
const { SqliteWorkerClient } = require("./sqlite-worker-client");

const sqliteClients = new Map();
let nextSavepointId = 0;
const slowSQLiteMilliseconds = Math.max(1, Number(process.env.SPCBOY_SLOW_SQL_MS) || 250);

function sqlText(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "NULL";
}

const CONSOLE_TAG_NAMES = new Map([
  ["PS1", "Sony PlayStation"], ["PSX", "Sony PlayStation"], ["PS2", "Sony PlayStation 2"],
  ["PS3", "Sony PlayStation 3"], ["PSP", "Sony PSP"], ["PSV", "Sony PlayStation Vita"],
  ["NDS", "Nintendo DS"], ["DS", "Nintendo DS"], ["3DS", "Nintendo 3DS"],
  ["GBA", "Nintendo Game Boy Advance"], ["GBC", "Nintendo Game Boy Color"], ["GB", "Nintendo Game Boy"],
  ["N64", "Nintendo 64"], ["NES", "Nintendo Entertainment System"], ["SNES", "Super Nintendo"],
  ["GC", "Nintendo GameCube"], ["WII", "Nintendo Wii"], ["WIIU", "Nintendo Wii U"], ["SWITCH", "Nintendo Switch"],
  ["MD", "Sega Mega Drive"], ["GEN", "Sega Genesis"], ["SMS", "Sega Master System"],
  ["SAT", "Sega Saturn"], ["DC", "Sega Dreamcast"], ["GG", "Sega Game Gear"],
  ["PCE", "NEC PC Engine"], ["TG16", "NEC TurboGrafx-16"], ["PCFX", "NEC PC-FX"],
  ["XBOX", "Microsoft Xbox"], ["X360", "Microsoft Xbox 360"], ["XONE", "Microsoft Xbox One"],
  ["PC98", "NEC PC-98"], ["FMT", "FM Towns"], ["3DO", "Panasonic 3DO"], ["ARC", "Arcade"]
]);

const CONSOLE_FOLDER_NAMES = new Map([
  ...[...new Set(CONSOLE_TAG_NAMES.values())].map((name) => [name.toLowerCase(), name]),
  ["playstation", "Sony PlayStation"], ["playstation 2", "Sony PlayStation 2"],
  ["playstation 3", "Sony PlayStation 3"], ["sony playstation 4", "Sony PlayStation 4"],
  ["sony playstation 5", "Sony PlayStation 5"], ["nintendo nes", "Nintendo Entertainment System"],
  ["nintendo snes", "Super Nintendo"], ["microsoft msx", "Microsoft MSX"],
  ["snk neo geo cd", "SNK Neo Geo CD"], ["atari 2600", "Atari 2600"],
  ["atari 5200", "Atari 5200"], ["atari 7800", "Atari 7800"],
  ["atari jaguar", "Atari Jaguar"], ["atari lynx", "Atari Lynx"],
  ["commodore 64", "Commodore 64"], ["commodore amiga", "Commodore Amiga"],
  ["bandai wonderswan", "Bandai WonderSwan"], ["bandai wonderswan color", "Bandai WonderSwan Color"]
]);

function sourcePathForRecord(record) {
  return String(record?.archivePath || record?.path || "");
}

function archiveTitleFromPath(sourcePath) {
  let title = path.basename(String(sourcePath || ""));
  title = title.replace(/\.(?:tar\.(?:zst|gz|bz2|xz)|zip|7z|rar|rsn)$/i, "");
  title = title.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  return title;
}

function consoleFromSourceTag(sourcePath) {
  const tags = [...path.basename(String(sourcePath || "")).matchAll(/\[([^\]]+)\]/g)];
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    const consoleName = CONSOLE_TAG_NAMES.get(String(tags[index][1] || "").trim().toUpperCase());
    if (consoleName) return consoleName;
  }
  return "";
}

function consoleFromParentFolder(record) {
  const folderPath = String(record?.folderPath || path.dirname(sourcePathForRecord(record)) || "");
  const parts = path.resolve(folderPath).split(path.sep).filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isConsoleFolderName(parts[index])) return normalizeConsoleName(parts[index]);
  }
  return normalizeConsoleName(path.basename(folderPath).trim());
}

function isConsoleFolderName(value) {
  return CONSOLE_FOLDER_NAMES.has(String(value || "").trim().toLowerCase());
}

function normalizeConsoleName(value) {
  const text = String(value || "").trim();
  return CONSOLE_FOLDER_NAMES.get(text.toLowerCase()) || text;
}

function usableMetadataValue(value) {
  const text = String(value || "").trim();
  // Failed scan materialization used to leak scratch-directory names and
  // format probes (for example "Sony XA header") into sidebar identity.
  return text && !path.isAbsolute(text) && !/^spcboy-(?:scan|playback)-scratch-/i.test(text) ? text : "";
}

function browserBucketsForRecord(record, preferEmbeddedConsoleTags = false) {
  const sourcePath = sourcePathForRecord(record);
  const taggedConsole = consoleFromSourceTag(sourcePath);
  const parentConsole = consoleFromParentFolder(record);
  const archiveGame = record?.archivePath ? archiveTitleFromPath(record.archivePath) : "";
  return {
    game: usableMetadataValue(record?.metadata?.game)
      || archiveGame
      || path.basename(String(record?.folderPath || "")).trim()
      || archiveTitleFromPath(sourcePath)
      || "Untitled",
    // JoshW-style collection labels are authoritative when present. Metadata
    // remains a fallback for loose files outside a console-organized library.
    system: preferEmbeddedConsoleTags
      ? usableMetadataValue(record?.metadata?.system) || taggedConsole || (isConsoleFolderName(parentConsole) ? parentConsole : "") || parentConsole
      : taggedConsole || (isConsoleFolderName(parentConsole) ? parentConsole : "") || usableMetadataValue(record?.metadata?.system) || parentConsole
  };
}

function browserGameForRecord(record, preferEmbeddedConsoleTags = false) {
  return browserBucketsForRecord(record, preferEmbeddedConsoleTags).game;
}

function browserSystemForRecord(record, preferEmbeddedConsoleTags = false) {
  return browserBucketsForRecord(record, preferEmbeddedConsoleTags).system;
}

function displayLibraryRootPath(rootPath) {
  const parts = path.resolve(String(rootPath || "")).split(path.sep).filter(Boolean);
  const audioIndex = parts.lastIndexOf("audio");
  if (audioIndex >= 0 && audioIndex < parts.length - 1) return parts.slice(audioIndex + 1).join("/");
  return path.basename(String(rootPath || "")) || String(rootPath || "Library");
}

function searchDocumentExpression(trackAlias = "t", metadataAlias = "m") {
  return `
    COALESCE(${trackAlias}.filename, '') || ' ' ||
    COALESCE(${trackAlias}.archive_entry, '') || ' ' ||
    COALESCE(${trackAlias}.archive_path, '') || ' ' ||
    COALESCE(${trackAlias}.folder_path, '') || ' ' ||
    COALESCE(${trackAlias}.browser_game, '') || ' ' ||
    COALESCE(${trackAlias}.browser_system, '') || ' ' ||
    COALESCE(${metadataAlias}.title, '') || ' ' ||
    COALESCE(${metadataAlias}.game, '') || ' ' ||
    COALESCE(${metadataAlias}.artist, '') || ' ' ||
    COALESCE(${metadataAlias}.system, '')`;
}

function ftsQuery(terms) {
  return terms.map((term) => `"${String(term).replaceAll('"', '""')}"*`).join(" AND ");
}

function gameSidebarBucketStatements(rootIds = null) {
  const ids = rootIds == null
    ? null
    : [...new Set(rootIds.map(Number).filter(Number.isFinite))];
  if (ids && !ids.length) return [];
  const rootPredicate = ids ? `root_id IN (${ids.map(sqlNumber).join(",")})` : "1";
  const trackPredicate = ids ? `t.root_id IN (${ids.map(sqlNumber).join(",")})` : "1";
  return [
    `DELETE FROM game_sidebar_buckets WHERE ${rootPredicate};`,
    `INSERT INTO game_sidebar_buckets(root_id, browser_game, browser_system, track_count)
     SELECT t.root_id, t.browser_game, t.browser_system, COUNT(*)
     FROM tracks t JOIN library_roots r ON r.id=t.root_id
     WHERE ${trackPredicate}
       AND t.scan_generation=r.active_scan_generation
       AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
     GROUP BY t.root_id, t.browser_game, t.browser_system;`
  ];
}

async function runInSavepoint(databasePath, statements) {
  const name = `spcboy_tx_${++nextSavepointId}`;
  const body = Array.isArray(statements) ? statements.join("\n") : String(statements || "");
  await run(databasePath, `SAVEPOINT ${name};`);
  try {
    if (typeof statements === "function") await statements();
    else await run(databasePath, body);
    await run(databasePath, `RELEASE SAVEPOINT ${name};`);
  } catch (error) {
    await run(databasePath, `ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name};`).catch(() => {});
    throw error;
  }
}

function sqliteClientKey(databasePath, lane) {
  return `${lane}\u0000${databasePath}`;
}

function sqliteClient(databasePath, lane) {
  const key = sqliteClientKey(databasePath, lane);
  let client = sqliteClients.get(key);
  if (!client) {
    client = new SqliteWorkerClient(databasePath, { queryOnly: lane !== "write" });
    sqliteClients.set(key, client);
  }
  return client;
}

function reportSlowSQLite(startedAt, lane, operation) {
  const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  if (elapsedMilliseconds < slowSQLiteMilliseconds) return;
  console.warn(`[SPCBoy] slow SQLite ${operation} on ${lane} lane: ${elapsedMilliseconds.toFixed(1)} ms`);
}

async function run(databasePath, sql, json = false, lane = "write") {
  const client = sqliteClient(databasePath, lane);
  const startedAt = process.hrtime.bigint();
  try {
    return json ? await client.query(sql) : await client.execute(sql);
  } catch (error) {
    throw new Error(`SQLite operation failed: ${error.message}`.trim());
  } finally {
    reportSlowSQLite(startedAt, lane, json ? "query" : "execute");
  }
}

async function runPreparedBatch(databasePath, commands) {
  const startedAt = process.hrtime.bigint();
  try {
    return await sqliteClient(databasePath, "write").executePreparedBatch(commands);
  } catch (error) {
    throw new Error(`SQLite prepared batch failed: ${error.message}`.trim());
  } finally {
    reportSlowSQLite(startedAt, "write", `prepared batch (${commands.length} commands)`);
  }
}

async function addColumnIfMissing(databasePath, table, column, definition) {
  const columns = await run(databasePath, `PRAGMA table_info(${table});`, true);
  if (columns.some((entry) => entry.name === column)) return;
  await run(databasePath, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

class LibraryDatabase {
  constructor(databasePath) {
    this.databasePath = databasePath;
    this.atomicScanRootId = null;
    this.atomicScanGeneration = null;
    this.atomicScanStats = null;
    this.atomicScanStartedAt = null;
    this.atomicScanInitialStorage = null;
    this.lastAtomicScanMetrics = null;
    this.preferEmbeddedConsoleTags = false;
  }

  async close() {
    const clients = [...sqliteClients.entries()]
      .filter(([, client]) => client.databasePath === this.databasePath);
    for (const [key] of clients) sqliteClients.delete(key);
    await Promise.all(clients.map(([, client]) => client.close()));
  }

  async beginAtomicScan(rootId) {
    if (this.atomicScanRootId !== null) throw new Error("An atomic library scan is already active");
    this.atomicScanInitialStorage = await this.databaseStorageMetrics().catch(() => ({ databaseBytes: 0, walBytes: 0, sharedMemoryBytes: 0 }));
    this.atomicScanRootId = Number(rootId);
    this.atomicScanGeneration = randomUUID();
    this.atomicScanStats = null;
    this.atomicScanStartedAt = process.hrtime.bigint();
  }

  async commitAtomicScan(rootId) {
    if (this.atomicScanRootId !== Number(rootId)) throw new Error("Atomic library scan root does not match the active transaction");
    const generation = this.atomicScanGeneration;
    const stats = this.atomicScanStats;
    if (!generation || !stats) throw new Error("Atomic library scan has no staged database result");
    const publishStartedAt = process.hrtime.bigint();
    await runInSavepoint(this.databasePath, `
      INSERT OR REPLACE INTO dead_sources(root_id, path, marked_at)
      SELECT t.root_id, COALESCE(t.archive_path, t.path), ${sqlNumber(Date.now() / 1000)}
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      WHERE t.root_id=${sqlNumber(rootId)}
        AND t.scan_generation=r.active_scan_generation
        AND NOT EXISTS (
          SELECT 1 FROM scan_generation_sources s
          WHERE s.root_id=t.root_id AND s.scan_generation=${sqlText(generation)}
            AND s.path=COALESCE(t.archive_path, t.path)
        )
      GROUP BY t.root_id, COALESCE(t.archive_path, t.path);
      DELETE FROM dead_sources
      WHERE root_id=${sqlNumber(rootId)} AND EXISTS (
        SELECT 1 FROM scan_generation_sources s
        WHERE s.root_id=dead_sources.root_id AND s.scan_generation=${sqlText(generation)} AND s.path=dead_sources.path
      );
      DELETE FROM game_sidebar_buckets WHERE root_id=${sqlNumber(rootId)};
      INSERT INTO game_sidebar_buckets(root_id, browser_game, browser_system, track_count)
      SELECT t.root_id, t.browser_game, t.browser_system, COUNT(*)
      FROM tracks t
      WHERE t.root_id=${sqlNumber(rootId)} AND t.scan_generation=${sqlText(generation)}
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
      GROUP BY t.root_id, t.browser_game, t.browser_system;
      UPDATE library_roots
      SET active_scan_generation=${sqlText(generation)},
          last_scan_completed_at=${sqlNumber(stats.completedAt)},
          last_scan_track_count=(
            SELECT COUNT(*) FROM tracks t
            WHERE t.root_id=${sqlNumber(rootId)} AND t.scan_generation=${sqlText(generation)}
              AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
          ),
          last_scan_file_count=${sqlNumber(stats.fileCount)},
          last_scan_success_count=${sqlNumber(stats.successCount)},
          last_scan_error_count=${sqlNumber(stats.errorCount)},
          last_scan_error=${stats.summary ? sqlText(stats.summary) : "NULL"},
          last_scan_log=${stats.errorLog ? sqlText(stats.errorLog) : "NULL"},
          needs_rescan=${stats.needsRescan ? 1 : 0}
      WHERE id=${sqlNumber(rootId)};
    `);
    const publishCompletedAt = process.hrtime.bigint();
    const stagingDurationMs = this.atomicScanStartedAt === null
      ? 0
      : Number(publishStartedAt - this.atomicScanStartedAt) / 1_000_000;
    const publishDurationMs = Number(publishCompletedAt - publishStartedAt) / 1_000_000;
    const initialStorage = this.atomicScanInitialStorage || { databaseBytes: 0, walBytes: 0, sharedMemoryBytes: 0 };
    this.atomicScanRootId = null;
    this.atomicScanGeneration = null;
    this.atomicScanStats = null;
    this.atomicScanStartedAt = null;
    this.atomicScanInitialStorage = null;
    const cleanupStartedAt = process.hrtime.bigint();
    await this.cleanupObsoleteScanGenerations(rootId).catch((error) => {
      console.warn(`[SPCBoy] obsolete scan generation cleanup failed: ${error.message}`);
    });
    const cleanupDurationMs = Number(process.hrtime.bigint() - cleanupStartedAt) / 1_000_000;
    const storage = await this.databaseStorageMetrics().catch(() => ({ databaseBytes: 0, walBytes: 0, sharedMemoryBytes: 0 }));
    const durationMs = stagingDurationMs + publishDurationMs + cleanupDurationMs;
    this.lastAtomicScanMetrics = {
      rootId: Number(rootId), durationMs, stagingDurationMs, publishDurationMs, cleanupDurationMs,
      ...storage, walGrowthBytes: storage.walBytes - initialStorage.walBytes
    };
    console.info(`[SPCBoy] database scan: stage ${stagingDurationMs.toFixed(1)} ms, publish ${publishDurationMs.toFixed(1)} ms, cleanup ${cleanupDurationMs.toFixed(1)} ms, WAL growth ${this.lastAtomicScanMetrics.walGrowthBytes} bytes`);
  }

  async rollbackAtomicScan(rootId) {
    if (this.atomicScanRootId === null) return;
    if (this.atomicScanRootId !== Number(rootId)) throw new Error("Atomic library scan root does not match the active transaction");
    try {
      await this.cleanupScanGeneration(rootId, this.atomicScanGeneration);
    } finally {
      this.atomicScanRootId = null;
      this.atomicScanGeneration = null;
      this.atomicScanStats = null;
      this.atomicScanStartedAt = null;
      this.atomicScanInitialStorage = null;
    }
  }

  async cleanupScanGeneration(rootId, generation) {
    if (!generation) return;
    while (true) {
      const rows = await run(this.databasePath, `SELECT id FROM tracks WHERE root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(generation)} LIMIT 5000;`, true);
      if (!rows.length) break;
      const ids = rows.map((row) => sqlNumber(row.id)).join(",");
      await runInSavepoint(this.databasePath, `DELETE FROM track_search WHERE rowid IN (${ids}); DELETE FROM tracks WHERE id IN (${ids});`);
    }
    await run(this.databasePath, `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(generation)}; DELETE FROM scan_generation_sources WHERE root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(generation)};`);
  }

  async cleanupObsoleteScanGenerations(rootId) {
    while (true) {
      const rows = await run(this.databasePath, `
        SELECT t.id
        FROM tracks t JOIN library_roots r ON r.id=t.root_id
        WHERE t.root_id=${sqlNumber(rootId)} AND t.scan_generation<>r.active_scan_generation
          AND NOT EXISTS (
            SELECT 1 FROM dead_sources d
            WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)
          )
        LIMIT 5000;
      `, true);
      if (!rows.length) break;
      const ids = rows.map((row) => sqlNumber(row.id)).join(",");
      await runInSavepoint(this.databasePath, `DELETE FROM track_search WHERE rowid IN (${ids}); DELETE FROM tracks WHERE id IN (${ids});`);
    }
    await run(this.databasePath, `
      DELETE FROM library_scan_outcomes
      WHERE root_id=${sqlNumber(rootId)}
        AND scan_generation<>(SELECT active_scan_generation FROM library_roots WHERE id=${sqlNumber(rootId)})
        AND NOT EXISTS (
          SELECT 1 FROM dead_sources d
          WHERE d.root_id=library_scan_outcomes.root_id AND d.path=library_scan_outcomes.source_path
        );
      DELETE FROM scan_generation_sources
      WHERE root_id=${sqlNumber(rootId)} AND scan_generation<>(SELECT active_scan_generation FROM library_roots WHERE id=${sqlNumber(rootId)});
    `);
  }

  async databaseStorageMetrics() {
    const size = async (filePath) => {
      try {
        return Number((await fs.stat(filePath)).size) || 0;
      } catch (error) {
        if (error?.code === "ENOENT") return 0;
        throw error;
      }
    };
    const [databaseBytes, walBytes, sharedMemoryBytes] = await Promise.all([
      size(this.databasePath), size(`${this.databasePath}-wal`), size(`${this.databasePath}-shm`)
    ]);
    return { databaseBytes, walBytes, sharedMemoryBytes };
  }

  async initialize() {
    await run(this.databasePath, `
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS library_roots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL,
        last_scan_started_at REAL,
        last_scan_completed_at REAL,
        last_scan_track_count INTEGER NOT NULL DEFAULT 0,
        last_scan_error TEXT,
        last_scan_file_count INTEGER NOT NULL DEFAULT 0,
        last_scan_success_count INTEGER NOT NULL DEFAULT 0,
        last_scan_error_count INTEGER NOT NULL DEFAULT 0,
        last_scan_log TEXT,
        needs_rescan INTEGER NOT NULL DEFAULT 0,
        active_scan_generation TEXT NOT NULL DEFAULT 'legacy'
      );
      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        path TEXT NOT NULL,
        filename TEXT NOT NULL,
        extension TEXT NOT NULL,
        backend_id TEXT,
        track_index INTEGER NOT NULL DEFAULT 0,
        track_count INTEGER NOT NULL DEFAULT 1,
        file_size INTEGER NOT NULL DEFAULT 0,
        modified_at REAL NOT NULL DEFAULT 0,
        discovered_at REAL NOT NULL,
        special_audio_kind TEXT,
        archive_signature TEXT,
        source_signature TEXT,
        scan_completed INTEGER NOT NULL DEFAULT 0,
        scan_version INTEGER NOT NULL DEFAULT 0,
        browser_game TEXT NOT NULL DEFAULT '',
        browser_system TEXT NOT NULL DEFAULT '',
        scan_generation TEXT NOT NULL DEFAULT 'legacy'
      );
      CREATE TABLE IF NOT EXISTS track_metadata (
        track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        game TEXT NOT NULL DEFAULT '',
        artist TEXT NOT NULL DEFAULT '',
        system TEXT NOT NULL DEFAULT '',
        play_length_ms INTEGER NOT NULL DEFAULT 0,
        metadata_scanned_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_scan_outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL,
        archive_entry TEXT,
        backend_id TEXT,
        stage TEXT NOT NULL,
        state TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT '',
        created_at REAL NOT NULL,
        scan_generation TEXT NOT NULL DEFAULT 'legacy'
      );
      CREATE TABLE IF NOT EXISTS dead_sources (
        root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        marked_at REAL NOT NULL,
        PRIMARY KEY(root_id, path)
      );
      CREATE TABLE IF NOT EXISTS library_schema_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_sidebar_buckets (
        root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
        browser_game TEXT NOT NULL,
        browser_system TEXT NOT NULL,
        track_count INTEGER NOT NULL,
        PRIMARY KEY(root_id, browser_game, browser_system)
      );
      CREATE TABLE IF NOT EXISTS scan_generation_sources (
        root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
        scan_generation TEXT NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY(root_id, scan_generation, path)
      );
      CREATE INDEX IF NOT EXISTS tracks_root_idx ON tracks(root_id);
      CREATE INDEX IF NOT EXISTS tracks_folder_idx ON tracks(folder_path);
      CREATE INDEX IF NOT EXISTS scan_outcomes_root_idx ON library_scan_outcomes(root_id, id);
    `);
    for (const [table, column, definition] of [
      ["tracks", "archive_path", "TEXT"],
      ["tracks", "archive_entry", "TEXT"],
      ["tracks", "backend_id", "TEXT"],
      ["tracks", "special_audio_kind", "TEXT"],
      ["tracks", "archive_signature", "TEXT"],
      ["tracks", "source_signature", "TEXT"],
      ["tracks", "scan_completed", "INTEGER NOT NULL DEFAULT 0"],
      ["tracks", "scan_version", "INTEGER NOT NULL DEFAULT 0"],
      ["tracks", "browser_game", "TEXT NOT NULL DEFAULT ''"],
      ["tracks", "browser_system", "TEXT NOT NULL DEFAULT ''"],
      ["tracks", "scan_generation", "TEXT NOT NULL DEFAULT 'legacy'"],
      ["library_roots", "last_scan_started_at", "REAL"],
      ["library_roots", "last_scan_completed_at", "REAL"],
      ["library_roots", "last_scan_track_count", "INTEGER NOT NULL DEFAULT 0"],
      ["library_roots", "last_scan_error", "TEXT"],
      ["library_roots", "last_scan_file_count", "INTEGER NOT NULL DEFAULT 0"],
      ["library_roots", "last_scan_success_count", "INTEGER NOT NULL DEFAULT 0"],
      ["library_roots", "last_scan_error_count", "INTEGER NOT NULL DEFAULT 0"],
      ["library_roots", "last_scan_log", "TEXT"],
      ["library_roots", "needs_rescan", "INTEGER NOT NULL DEFAULT 0"],
      ["library_roots", "active_scan_generation", "TEXT NOT NULL DEFAULT 'legacy'"],
      ["library_scan_outcomes", "scan_generation", "TEXT NOT NULL DEFAULT 'legacy'"]
    ]) {
      await addColumnIfMissing(this.databasePath, table, column, definition);
    }
    await run(this.databasePath, "CREATE INDEX IF NOT EXISTS tracks_generation_idx ON tracks(root_id, scan_generation); CREATE INDEX IF NOT EXISTS scan_outcomes_generation_idx ON library_scan_outcomes(root_id, scan_generation, id);");
    await run(this.databasePath, "DROP INDEX IF EXISTS tracks_game_idx; CREATE INDEX IF NOT EXISTS tracks_browser_bucket_index ON tracks(root_id, browser_game, browser_system);");
    await run(this.databasePath, "CREATE VIRTUAL TABLE IF NOT EXISTS track_search USING fts5(content);");
    const browserBucketsBackfilled = await run(this.databasePath, "SELECT 1 FROM library_schema_state WHERE key='browser-buckets-v1';", true);
    if (!browserBucketsBackfilled.length) {
      await run(this.databasePath, `
        BEGIN TRANSACTION;
        UPDATE tracks
        SET browser_game=COALESCE((
              SELECT CASE WHEN trim(COALESCE(m.game, '')) <> '' THEN trim(m.game) ELSE COALESCE(tracks.archive_path, tracks.folder_path) END
              FROM track_metadata m WHERE m.track_id=tracks.id
            ), COALESCE(archive_path, folder_path)),
            browser_system=COALESCE((SELECT trim(COALESCE(m.system, '')) FROM track_metadata m WHERE m.track_id=tracks.id), '')
        WHERE browser_game='';
        INSERT INTO library_schema_state(key, value) VALUES('browser-buckets-v1', 'complete');
        COMMIT;
      `);
    }
    const browserBucketsNormalized = await run(this.databasePath, "SELECT 1 FROM library_schema_state WHERE key='browser-buckets-v3';", true);
    if (!browserBucketsNormalized.length) await this.rebuildBrowserBuckets();
    await this.repairInternalCacheGameNames();
    const searchIndexBuilt = await run(this.databasePath, "SELECT 1 FROM library_schema_state WHERE key='track-search-v1';", true);
    if (!searchIndexBuilt.length) {
      await run(this.databasePath, `
        BEGIN TRANSACTION;
        INSERT INTO track_search(rowid, content)
        SELECT t.id, ${searchDocumentExpression()}
        FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id;
        INSERT OR REPLACE INTO library_schema_state(key, value) VALUES('track-search-v1', 'complete');
        COMMIT;
      `);
    }
    const gameSidebarBucketsBuilt = await run(this.databasePath, "SELECT 1 FROM library_schema_state WHERE key='game-sidebar-buckets-v1';", true);
    if (!gameSidebarBucketsBuilt.length) await this.rebuildGameSidebarBuckets();
    for (const root of await this.loadRoots()) await this.cleanupObsoleteScanGenerations(root.id);
  }

  async rebuildGameSidebarBuckets(rootIds = null) {
    const statements = gameSidebarBucketStatements(rootIds);
    if (!statements.length) return;
    await run(this.databasePath, `
      BEGIN TRANSACTION;
      ${statements.join("\n")}
      INSERT OR REPLACE INTO library_schema_state(key, value) VALUES('game-sidebar-buckets-v1', 'complete');
      COMMIT;
    `);
  }

  async rebuildBrowserBuckets() {
    const rows = await run(this.databasePath, `
      SELECT t.id, t.folder_path AS folderPath, t.path, t.archive_path AS archivePath,
             COALESCE(m.game, '') AS game, COALESCE(m.system, '') AS system
      FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id;
    `, true);
    if (!rows.length) {
      await run(this.databasePath, "INSERT OR REPLACE INTO library_schema_state(key, value) VALUES('browser-buckets-v3', 'complete');");
      return;
    }
    await run(this.databasePath, "CREATE TEMP TABLE browser_bucket_rebuild(track_id INTEGER PRIMARY KEY, browser_game TEXT NOT NULL, browser_system TEXT NOT NULL);");
    try {
      for (let index = 0; index < rows.length; index += 1000) {
        const values = rows.slice(index, index + 1000).map((row) => {
          const buckets = browserBucketsForRecord({
            folderPath: row.folderPath,
            path: row.path,
            archivePath: row.archivePath,
            metadata: { game: row.game, system: row.system }
          });
          return `(${sqlNumber(row.id)}, ${sqlText(buckets.game)}, ${sqlText(buckets.system)})`;
        });
        await run(this.databasePath, `INSERT INTO browser_bucket_rebuild(track_id, browser_game, browser_system) VALUES ${values.join(",")};`);
      }
      await run(this.databasePath, `
        BEGIN TRANSACTION;
        UPDATE tracks
        SET browser_game=(SELECT browser_game FROM browser_bucket_rebuild b WHERE b.track_id=tracks.id),
            browser_system=(SELECT browser_system FROM browser_bucket_rebuild b WHERE b.track_id=tracks.id);
        INSERT OR REPLACE INTO library_schema_state(key, value) VALUES('browser-buckets-v3', 'complete');
        COMMIT;
      `);
    } finally {
      await run(this.databasePath, "DROP TABLE IF EXISTS browser_bucket_rebuild;").catch(() => {});
    }
  }

  async repairInternalCacheGameNames() {
    const rows = await run(this.databasePath, `
      SELECT m.track_id AS trackId, t.archive_path AS archivePath
      FROM track_metadata m JOIN tracks t ON t.id=m.track_id
      WHERE lower(trim(m.game))='spcboy-archive-cache' AND t.archive_path IS NOT NULL;
    `, true);
    if (!rows.length) return;
    const updates = rows.map((row) => {
      const game = path.basename(row.archivePath, path.extname(row.archivePath));
      return `UPDATE track_metadata SET game=${sqlText(game)} WHERE track_id=${sqlNumber(row.trackId)}; UPDATE tracks SET browser_game=${sqlText(game)} WHERE id=${sqlNumber(row.trackId)};`;
    });
    await run(this.databasePath, `BEGIN TRANSACTION;${updates.join("")}COMMIT;`);
  }

  async loadRoots() {
    return run(this.databasePath, "SELECT * FROM library_roots ORDER BY display_order, id;", true);
  }

  async loadRoot(rootId) {
    const id = Number(rootId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return (await run(this.databasePath, `SELECT * FROM library_roots WHERE id=${sqlNumber(id)} LIMIT 1;`, true))[0] || null;
  }

  async ensureRoot(rootPath) {
    const roots = await this.loadRoots();
    const existing = roots.find((root) => root.path === rootPath);
    if (existing) return existing;
    const now = Date.now() / 1000;
    await run(this.databasePath, `INSERT INTO library_roots(path, display_order, created_at) VALUES(${sqlText(rootPath)}, ${sqlNumber(roots.length)}, ${sqlNumber(now)});`);
    return (await this.loadRoots()).find((root) => root.path === rootPath);
  }

  async removeRoot(rootId) {
    await run(this.databasePath, `BEGIN TRANSACTION; DELETE FROM track_search WHERE rowid IN (SELECT id FROM tracks WHERE root_id=${sqlNumber(rootId)}); DELETE FROM track_metadata WHERE track_id IN (SELECT id FROM tracks WHERE root_id=${sqlNumber(rootId)}); DELETE FROM tracks WHERE root_id=${sqlNumber(rootId)}; DELETE FROM library_roots WHERE id=${sqlNumber(rootId)}; COMMIT;`);
    await this.normalizeRootOrder();
    return this.loadRoots();
  }

  async setRootEnabled(rootId, enabled) {
    return this.setRootsEnabled([rootId], enabled);
  }

  async setRootsEnabled(rootIds, enabled) {
    const ids = [...new Set((Array.isArray(rootIds) ? rootIds : [])
      .map(Number)
      .filter(Number.isFinite))];
    if (!ids.length) return this.loadRoots();
    await run(this.databasePath, `UPDATE library_roots SET is_enabled=${enabled ? 1 : 0} WHERE id IN (${ids.map(sqlNumber).join(",")});`);
    return this.loadRoots();
  }

  async moveRoot(rootId, direction) {
    const roots = await this.loadRoots();
    const index = roots.findIndex((root) => Number(root.id) === Number(rootId));
    const nextIndex = index + Number(direction);
    if (index < 0 || nextIndex < 0 || nextIndex >= roots.length) return roots;
    [roots[index], roots[nextIndex]] = [roots[nextIndex], roots[index]];
    await run(this.databasePath, `BEGIN TRANSACTION;${roots.map((root, order) => `UPDATE library_roots SET display_order=${order} WHERE id=${sqlNumber(root.id)};`).join("")}COMMIT;`);
    return this.loadRoots();
  }

  async normalizeRootOrder() {
    const roots = await this.loadRoots();
    await run(this.databasePath, `BEGIN TRANSACTION;${roots.map((root, order) => `UPDATE library_roots SET display_order=${order} WHERE id=${sqlNumber(root.id)};`).join("")}COMMIT;`);
  }

  async markScanStarted(rootId) {
    await run(this.databasePath, `UPDATE library_roots SET last_scan_started_at=${sqlNumber(Date.now() / 1000)}, last_scan_error=NULL, last_scan_file_count=0, last_scan_success_count=0, last_scan_error_count=0, last_scan_log=NULL WHERE id=${sqlNumber(rootId)};`);
  }

  async replaceTracks(rootId, records, scanStats = {}) {
    const now = Date.now() / 1000;
    const staged = this.atomicScanRootId === Number(rootId) && Boolean(this.atomicScanGeneration);
    const rootState = staged ? null : (await run(this.databasePath, `SELECT active_scan_generation AS generation FROM library_roots WHERE id=${sqlNumber(rootId)};`, true))[0];
    const scanGeneration = staged ? this.atomicScanGeneration : String(rootState?.generation || "legacy");
    const errorLog = Array.isArray(scanStats.errors) ? scanStats.errors.join("\n").slice(0, 200000) : "";
    const errorCount = Number(scanStats.errorCount) || 0;
    const summary = errorCount > 0 ? `${errorCount} file${errorCount === 1 ? "" : "s"} errored` : null;
    const replaceSources = Array.isArray(scanStats.replaceSources) ? scanStats.replaceSources : null;
    const archivePaths = [...new Set((replaceSources || []).map((source) => source.archivePath).filter(Boolean))];
    const loosePaths = [...new Set((replaceSources || []).map((source) => source.path).filter(Boolean))];
    const sourcePredicates = [];
    if (archivePaths.length) sourcePredicates.push(`tracks.archive_path IN (${archivePaths.map(sqlText).join(",")})`);
    if (loosePaths.length) sourcePredicates.push(`tracks.archive_path IS NULL AND tracks.path IN (${loosePaths.map(sqlText).join(",")})`);
    const outcomePredicates = [];
    if (archivePaths.length) outcomePredicates.push(`library_scan_outcomes.source_path IN (${archivePaths.map(sqlText).join(",")})`);
    if (loosePaths.length) outcomePredicates.push(`library_scan_outcomes.source_path IN (${loosePaths.map(sqlText).join(",")})`);
    const cleanupTrackWhere = replaceSources
      ? `root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(scanGeneration)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path))${sourcePredicates.length ? ` AND (${sourcePredicates.join(" OR ")})` : " AND 0"}`
      : `root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(scanGeneration)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path))`;
    const cleanupTracks = `DELETE FROM tracks WHERE ${cleanupTrackWhere};`;
    const cleanupSearch = `DELETE FROM track_search WHERE rowid IN (SELECT id FROM tracks WHERE ${cleanupTrackWhere});`;
    const cleanupOutcomes = replaceSources
      ? `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(scanGeneration)}${outcomePredicates.length ? ` AND (${outcomePredicates.join(" OR ")})` : " AND 0"};`
      : `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)} AND scan_generation=${sqlText(scanGeneration)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=library_scan_outcomes.root_id AND d.path=library_scan_outcomes.source_path);`;
    if (!staged) await runInSavepoint(this.databasePath, [cleanupSearch, cleanupTracks, cleanupOutcomes]);
    const insertTrackSQL = "INSERT INTO tracks(root_id, folder_path, path, filename, extension, backend_id, track_index, track_count, file_size, modified_at, discovered_at, special_audio_kind, archive_path, archive_entry, archive_signature, source_signature, scan_completed, scan_version, browser_game, browser_system, scan_generation) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
    const insertMetadataSQL = "INSERT INTO track_metadata(track_id, title, game, artist, system, play_length_ms, metadata_scanned_at) VALUES(last_insert_rowid(), ?, ?, ?, ?, ?, ?);";
    const insertSearchSQL = `INSERT INTO track_search(rowid, content) SELECT t.id, ${searchDocumentExpression()} FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id WHERE t.id=last_insert_rowid();`;
    for (let index = 0; index < records.length; index += 1000) {
      const commands = [];
      for (const record of records.slice(index, index + 1000)) {
        commands.push({
          sql: insertTrackSQL,
          params: [
            Number(rootId), record.folderPath, record.path, record.filename, record.extension,
            record.backendId || null, Number(record.trackIndex) || 0, Number(record.trackCount) || 1,
            Number(record.fileSize) || 0, Number(record.modifiedAt) || 0, now,
            record.specialAudioKind || null, record.archivePath || null,
            record.archiveEntry ? normalizeArchiveEntry(record.archiveEntry) : null,
            record.archiveSignature || null, record.sourceSignature || null,
            record.scanCompleted ? 1 : 0, Number(record.scanVersion) || 0,
            browserGameForRecord(record, this.preferEmbeddedConsoleTags), browserSystemForRecord(record, this.preferEmbeddedConsoleTags), scanGeneration
          ]
        });
        if (record.metadata) {
          commands.push({
            sql: insertMetadataSQL,
            params: [
              record.metadata.title || "", record.metadata.game || "", record.metadata.artist || "",
              record.metadata.system || "", Number(record.metadata.playLengthMs) || 0, now
            ]
          });
        }
        commands.push({ sql: insertSearchSQL, params: [] });
      }
      await runInSavepoint(this.databasePath, () => runPreparedBatch(this.databasePath, commands));
    }
    const insertOutcomeSQL = "INSERT INTO library_scan_outcomes(root_id, source_path, archive_entry, backend_id, stage, state, duration_ms, message, created_at, scan_generation) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
    const outcomeCommands = [];
    for (const outcome of Array.isArray(scanStats.outcomes) ? scanStats.outcomes : []) {
      outcomeCommands.push({
        sql: insertOutcomeSQL,
        params: [
          Number(rootId), String(outcome.identity?.sourcePath || ""),
          outcome.identity?.archiveEntry ? normalizeArchiveEntry(outcome.identity.archiveEntry) : null,
          outcome.route?.backendId || null, String(outcome.stage || ""), String(outcome.state || ""),
          Number(outcome.durationMs) || 0, String(outcome.message || ""), now, scanGeneration
        ]
      });
    }
    for (let index = 0; index < outcomeCommands.length; index += 2000) {
      const commands = outcomeCommands.slice(index, index + 2000);
      await runInSavepoint(this.databasePath, () => runPreparedBatch(this.databasePath, commands));
    }
    if (staged) {
      this.atomicScanStats = {
        completedAt: now,
        fileCount: Number(scanStats.fileCount) || 0,
        successCount: Number(scanStats.successCount) || 0,
        errorCount,
        summary,
        errorLog,
        needsRescan: Boolean(scanStats.needsRescan)
      };
      return;
    }
    await runInSavepoint(this.databasePath, `${gameSidebarBucketStatements([rootId]).join("\n")} UPDATE library_roots SET last_scan_completed_at=${sqlNumber(now)}, last_scan_track_count=(SELECT COUNT(*) FROM tracks t WHERE t.root_id=${sqlNumber(rootId)} AND t.scan_generation=${sqlText(scanGeneration)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))), last_scan_file_count=${sqlNumber(scanStats.fileCount)}, last_scan_success_count=${sqlNumber(scanStats.successCount)}, last_scan_error_count=${sqlNumber(errorCount)}, last_scan_error=${summary ? sqlText(summary) : "NULL"}, last_scan_log=${errorLog ? sqlText(errorLog) : "NULL"}, needs_rescan=${scanStats.needsRescan ? 1 : 0} WHERE id=${sqlNumber(rootId)};`);
  }

  async indexedTrackRecords(rootId) {
    return run(this.databasePath, `
      SELECT t.folder_path AS folderPath, t.path, t.filename, t.extension, t.backend_id AS backendId,
             t.track_index AS trackIndex, t.track_count AS trackCount,
             t.file_size AS fileSize, t.modified_at AS modifiedAt,
             t.special_audio_kind AS specialAudioKind, t.archive_path AS archivePath, t.archive_entry AS archiveEntry,
             t.archive_signature AS archiveSignature, t.source_signature AS sourceSignature, t.scan_completed AS scanCompleted, t.scan_version AS scanVersion,
             m.track_id AS metadataTrackId, m.title, m.game, m.artist, m.system,
             m.play_length_ms AS playLengthMs
      FROM tracks t
      JOIN library_roots r ON r.id=t.root_id
      LEFT JOIN track_metadata m ON m.track_id=t.id
      WHERE t.root_id=${sqlNumber(rootId)}
        AND t.scan_generation=r.active_scan_generation
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
      ORDER BY t.path, t.track_index;
    `, true);
  }

  async updatePlaylistMetadata(updates) {
    const now = Date.now() / 1000;
    const statements = [];
    const changedPredicates = [];
    for (const update of Array.isArray(updates) ? updates : []) {
      const metadata = update?.metadata;
      if (!metadata) continue;
      const predicate = update.archivePath && update.archiveEntry
        ? `archive_path=${sqlText(update.archivePath)} AND archive_entry=${sqlText(normalizeArchiveEntry(update.archiveEntry))} AND track_index=${sqlNumber(update.trackIndex)}`
        : update.path
          ? `archive_path IS NULL AND path=${sqlText(update.path)} AND track_index=${sqlNumber(update.trackIndex)}`
          : null;
      if (!predicate) continue;
      const activePredicate = `(${predicate}) AND scan_generation=(SELECT active_scan_generation FROM library_roots WHERE id=tracks.root_id)`;
      changedPredicates.push(`(${activePredicate})`);
      // Queue-time tag hydration must preserve the source-derived console
      // bucket. Build each update from the existing source columns in SQL,
      // then repair its normalized identity in the next scan/initialization.
      // A tag may improve a game title, but must never turn PS1 into "SEGA".
      const browserGame = usableMetadataValue(metadata.game);
      statements.push(`UPDATE tracks SET browser_game=CASE WHEN ${sqlText(browserGame)} <> '' THEN ${sqlText(browserGame)} ELSE browser_game END WHERE ${activePredicate};`);
      if (this.preferEmbeddedConsoleTags) {
        const browserSystem = usableMetadataValue(metadata.system);
        statements.push(`UPDATE tracks SET browser_system=CASE WHEN ${sqlText(browserSystem)} <> '' THEN ${sqlText(browserSystem)} ELSE browser_system END WHERE ${activePredicate};`);
      }
      statements.push(`INSERT INTO track_metadata(track_id, title, game, artist, system, play_length_ms, metadata_scanned_at) SELECT id, ${sqlText(metadata.title)}, ${sqlText(metadata.game)}, ${sqlText(metadata.artist)}, ${sqlText(metadata.system)}, ${sqlNumber(metadata.playLengthMs)}, ${sqlNumber(now)} FROM tracks WHERE ${activePredicate} ON CONFLICT(track_id) DO UPDATE SET title=excluded.title, game=excluded.game, artist=excluded.artist, system=excluded.system, play_length_ms=excluded.play_length_ms, metadata_scanned_at=excluded.metadata_scanned_at;`);
      statements.push(`DELETE FROM track_search WHERE rowid IN (SELECT id FROM tracks WHERE ${activePredicate});`);
      statements.push(`INSERT INTO track_search(rowid, content) SELECT t.id, ${searchDocumentExpression()} FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id WHERE ${activePredicate.replaceAll("tracks.", "t.")};`);
    }
    if (!statements.length) return;
    const changedRoots = await run(this.databasePath, `SELECT DISTINCT root_id AS rootId FROM tracks WHERE ${changedPredicates.join(" OR ")};`, true);
    statements.push(...gameSidebarBucketStatements(changedRoots.map((row) => row.rootId)));
    await runInSavepoint(this.databasePath, statements);
  }

  async loadScanOutcomes(rootId) {
    return run(this.databasePath, `
      SELECT source_path AS sourcePath, archive_entry AS archiveEntry,
             backend_id AS backendId, stage, state, duration_ms AS durationMs,
             message, created_at AS createdAt
      FROM library_scan_outcomes
      WHERE root_id=${sqlNumber(rootId)}
        AND scan_generation=(SELECT active_scan_generation FROM library_roots WHERE id=${sqlNumber(rootId)})
      ORDER BY id;
    `, true);
  }

  async markScanFailed(rootId, error) {
    await run(this.databasePath, `UPDATE library_roots SET last_scan_completed_at=${sqlNumber(Date.now() / 1000)}, last_scan_error=${sqlText(error)} WHERE id=${sqlNumber(rootId)};`);
  }

  async markScanWarning(rootId, warnings) {
    const message = warnings.slice(0, 20).join("\n").slice(0, 8000);
    await run(this.databasePath, `UPDATE library_roots SET last_scan_error=${sqlText(message)} WHERE id=${sqlNumber(rootId)};`);
  }

  async indexedSources() {
    return run(this.databasePath, `
      SELECT t.root_id AS rootId, COALESCE(t.archive_path, t.path) AS path
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      WHERE t.scan_generation=r.active_scan_generation
        AND NOT EXISTS (
        SELECT 1 FROM dead_sources d
        WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)
      )
      GROUP BY t.root_id, COALESCE(t.archive_path, t.path)
      ORDER BY t.root_id, path;
    `, true);
  }

  async restoreSources(sources) {
    if (!sources.length) return;
    if (this.atomicScanRootId !== null) {
      const commands = [...new Set(sources.map((source) => String(source.path || "")))]
        .filter(Boolean)
        .map((sourcePath) => ({
          sql: "INSERT OR IGNORE INTO scan_generation_sources(root_id, scan_generation, path) VALUES(?, ?, ?);",
          params: [this.atomicScanRootId, this.atomicScanGeneration, sourcePath]
        }));
      for (let index = 0; index < commands.length; index += 2000) {
        await runPreparedBatch(this.databasePath, commands.slice(index, index + 2000));
      }
      return;
    }
    const sourceRows = sources.map((source) => `(${sqlNumber(source.rootId)}, ${sqlText(source.path)})`).join(",");
    const rootIds = sources.map((source) => source.rootId);
    await runInSavepoint(this.databasePath, `
      CREATE TEMP TABLE restore_sources(root_id INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(root_id, path));
      INSERT INTO restore_sources(root_id, path) VALUES ${sourceRows};
      DELETE FROM dead_sources
      WHERE EXISTS (SELECT 1 FROM restore_sources s WHERE s.root_id=dead_sources.root_id AND s.path=dead_sources.path);
      DROP TABLE restore_sources;
      ${gameSidebarBucketStatements(rootIds).join("\n")}
    `);
  }

  async markUndiscoveredSourcesDead(rootId, livePaths) {
    if (this.atomicScanRootId !== null) {
      if (this.atomicScanRootId !== Number(rootId)) throw new Error("Staged source root does not match the active scan");
      const commands = [...new Set(livePaths.map(String))].filter(Boolean).map((sourcePath) => ({
        sql: "INSERT OR IGNORE INTO scan_generation_sources(root_id, scan_generation, path) VALUES(?, ?, ?);",
        params: [this.atomicScanRootId, this.atomicScanGeneration, sourcePath]
      }));
      for (let index = 0; index < commands.length; index += 2000) {
        await runPreparedBatch(this.databasePath, commands.slice(index, index + 2000));
      }
      return;
    }
    const values = [...new Set(livePaths)].map((value) => sqlText(value)).join(",");
    if (!values) {
      await runInSavepoint(this.databasePath, `INSERT OR REPLACE INTO dead_sources(root_id, path, marked_at) SELECT DISTINCT t.root_id, COALESCE(t.archive_path, t.path), ${sqlNumber(Date.now() / 1000)} FROM tracks t JOIN library_roots r ON r.id=t.root_id WHERE t.root_id=${sqlNumber(rootId)} AND t.scan_generation=r.active_scan_generation; ${gameSidebarBucketStatements([rootId]).join("\n")}`);
      return;
    }
    await runInSavepoint(this.databasePath, `
      CREATE TEMP TABLE live_scan_sources(path TEXT PRIMARY KEY);
      INSERT INTO live_scan_sources(path) VALUES ${[...new Set(livePaths)].map((value) => `(${sqlText(value)})`).join(",")};
      INSERT OR REPLACE INTO dead_sources(root_id, path, marked_at)
      SELECT DISTINCT t.root_id, COALESCE(t.archive_path, t.path), ${sqlNumber(Date.now() / 1000)}
      FROM tracks t
      JOIN library_roots r ON r.id=t.root_id
      WHERE t.root_id=${sqlNumber(rootId)}
        AND t.scan_generation=r.active_scan_generation
        AND NOT EXISTS (SELECT 1 FROM live_scan_sources s WHERE s.path=COALESCE(t.archive_path, t.path));
      DROP TABLE live_scan_sources;
      ${gameSidebarBucketStatements([rootId]).join("\n")}
    `);
  }

  async markSourcesDead(sources) {
    if (!sources.length) return { markedSourceCount: 0, rootIds: [] };
    const uniqueSources = [...new Map(sources.map((source) => [`${source.rootId}\u0000${source.path}`, source])).values()];
    const rootIds = [...new Set(uniqueSources.map((source) => Number(source.rootId)))].filter(Number.isFinite);
    for (let offset = 0; offset < uniqueSources.length; offset += 500) {
      const batch = uniqueSources.slice(offset, offset + 500);
      const sourceRows = batch.map((source) =>
        `(${sqlNumber(source.rootId)}, ${sqlText(source.path)})`
      ).join(",\n");
      await run(this.databasePath, `
        BEGIN TRANSACTION;
        CREATE TEMP TABLE mark_missing_sources (
          root_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          PRIMARY KEY(root_id, path)
        );
        INSERT INTO mark_missing_sources(root_id, path) VALUES
        ${sourceRows};
        INSERT OR REPLACE INTO dead_sources(root_id, path, marked_at)
        SELECT root_id, path, ${sqlNumber(Date.now() / 1000)} FROM mark_missing_sources;
        UPDATE library_roots
        SET last_scan_track_count=(SELECT COUNT(*) FROM tracks t WHERE t.root_id=library_roots.id AND t.scan_generation=library_roots.active_scan_generation AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))),
            needs_rescan=1
        WHERE id IN (SELECT DISTINCT root_id FROM mark_missing_sources);
        DROP TABLE mark_missing_sources;
        ${gameSidebarBucketStatements(batch.map((source) => source.rootId)).join("\n")}
        COMMIT;
      `);
    }
    return { markedSourceCount: uniqueSources.length, rootIds };
  }

  async deadSourceCount() {
    return Number((await run(this.databasePath, "SELECT COUNT(*) AS count FROM dead_sources;", true))[0]?.count || 0);
  }

  async trackCount() {
    return Number((await run(this.databasePath, "SELECT COUNT(*) AS count FROM tracks t JOIN library_roots r ON r.id=t.root_id WHERE t.scan_generation=r.active_scan_generation AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path));", true))[0]?.count || 0);
  }

  async deadTrackCount() {
    return Number((await run(this.databasePath, `SELECT COUNT(*) AS count FROM tracks t WHERE EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path));`, true))[0]?.count || 0);
  }

  async deleteDeadSources() {
    const count = await this.deadSourceCount();
    if (!count) return { purgedSourceCount: 0, purgedTrackCount: 0 };
    const trackCount = await this.deadTrackCount();
    await run(this.databasePath, `
      BEGIN TRANSACTION;
      DELETE FROM library_scan_outcomes
      WHERE EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=library_scan_outcomes.root_id AND d.path=library_scan_outcomes.source_path);
      DELETE FROM track_search
      WHERE rowid IN (
        SELECT tracks.id FROM tracks
        WHERE EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path))
      );
      DELETE FROM tracks
      WHERE EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path));
      DELETE FROM dead_sources;
      ${gameSidebarBucketStatements().join("\n")}
      UPDATE library_roots
      SET last_scan_track_count=(SELECT COUNT(*) FROM tracks t WHERE t.root_id=library_roots.id AND t.scan_generation=library_roots.active_scan_generation), needs_rescan=1;
      COMMIT;
    `);
    return { purgedSourceCount: count, purgedTrackCount: trackCount };
  }

  async clearDatabase() {
    const trackCount = await this.trackCount();
    await run(this.databasePath, `
      BEGIN TRANSACTION;
      DELETE FROM library_scan_outcomes;
      DELETE FROM track_search;
      DELETE FROM tracks;
      DELETE FROM dead_sources;
      DELETE FROM game_sidebar_buckets;
      UPDATE library_roots
      SET last_scan_track_count=0, last_scan_file_count=0,
          last_scan_success_count=0, last_scan_error_count=0,
          last_scan_error=NULL, last_scan_log=NULL, needs_rescan=1;
      COMMIT;
    `);
    return { clearedTrackCount: trackCount };
  }

  async loadGames(query = "") {
    const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matchingGroups = terms.length ? `
      WITH matching_groups AS (
        SELECT DISTINCT t.root_id AS rootId, t.browser_game AS name, t.browser_system AS system
        FROM tracks t
        JOIN library_roots r ON r.id=t.root_id
        LEFT JOIN track_metadata m ON m.track_id=t.id
        JOIN track_search ON track_search.rowid=t.id
        WHERE r.is_enabled=1
          AND t.scan_generation=r.active_scan_generation
          AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
          AND track_search MATCH ${sqlText(ftsQuery(terms))}
      )` : "";
    const matchingJoin = terms.length
      ? "JOIN matching_groups g ON g.rootId=b.root_id AND g.name=b.browser_game AND g.system=b.browser_system"
      : "";
    const games = await run(this.databasePath, `${matchingGroups}
      SELECT b.root_id AS rootId, r.path AS rootPath,
             b.browser_game AS name, b.browser_system AS system,
             b.track_count AS trackCount
      FROM game_sidebar_buckets b JOIN library_roots r ON r.id=b.root_id
      ${matchingJoin}
      WHERE r.is_enabled=1
      ORDER BY lower(name), name, lower(system), system, lower(r.path), r.path;
    `, true, "sidebar");
    const duplicateBuckets = new Set();
    const seenBuckets = new Set();
    for (const game of games) {
      const key = `${game.name}\u0000${game.system}`;
      if (seenBuckets.has(key)) duplicateBuckets.add(key);
      seenBuckets.add(key);
    }
    return games.map((game) => {
      const key = `${game.name}\u0000${game.system}`;
      const rootName = displayLibraryRootPath(game.rootPath);
      const detail = game.system || "Unknown Console";
      return {
        ...game,
        rootName,
        displayName: duplicateBuckets.has(key) ? `${game.name} (${detail} • ${rootName})` : game.name
      };
    });
  }

  async searchGames(query) {
    return this.loadGames(query);
  }

  async setPreferEmbeddedConsoleTags(enabled) {
    const next = Boolean(enabled);
    this.preferEmbeddedConsoleTags = next;
    const key = "console-tag-source-v1";
    const stored = (await run(this.databasePath, `SELECT value FROM library_schema_state WHERE key=${sqlText(key)};`, true))[0]?.value;
    const nextValue = next ? "metadata" : "collection";
    if (stored === nextValue) return next;

    await runInSavepoint(this.databasePath, async () => {
      let lastTrackId = 0;
      while (true) {
        const rows = await run(this.databasePath, `
          SELECT t.id, t.folder_path AS folderPath, t.path, t.archive_path AS archivePath,
                 m.game, m.system
          FROM tracks t
          LEFT JOIN track_metadata m ON m.track_id=t.id
          WHERE t.id>${sqlNumber(lastTrackId)}
          ORDER BY t.id
          LIMIT 1000;
        `, true);
        if (!rows.length) break;
        await runPreparedBatch(this.databasePath, rows.map((row) => ({
          sql: "UPDATE tracks SET browser_game=?, browser_system=? WHERE id=?;",
          params: [browserGameForRecord({
            folderPath: row.folderPath,
            path: row.path,
            archivePath: row.archivePath,
            metadata: { game: row.game || "", system: row.system || "" }
          }, next), browserSystemForRecord({
            folderPath: row.folderPath,
            path: row.path,
            archivePath: row.archivePath,
            metadata: { game: row.game || "", system: row.system || "" }
          }, next), Number(row.id)]
        })));
        lastTrackId = Number(rows.at(-1).id);
      }
      await run(this.databasePath, [
        "DELETE FROM track_search;",
        `INSERT INTO track_search(rowid, content) SELECT t.id, ${searchDocumentExpression()} FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id;`,
        ...gameSidebarBucketStatements(),
        `INSERT OR REPLACE INTO library_schema_state(key, value) VALUES(${sqlText(key)}, ${sqlText(nextValue)});`
      ].join("\n"));
    });
    return next;
  }

  async searchBrowserEntries(rootPath, query) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!rootPath || !normalizedQuery) return [];
    const normalizedRootPath = path.resolve(rootPath);
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    return run(this.databasePath, `
      SELECT DISTINCT
             r.path AS rootPath,
             t.folder_path AS folderPath,
             t.path,
             t.filename,
             t.archive_path AS archivePath,
             t.archive_entry AS archiveEntry
      FROM tracks t
      JOIN library_roots r ON r.id=t.root_id
      LEFT JOIN track_metadata m ON m.track_id=t.id
      JOIN track_search ON track_search.rowid=t.id
      WHERE r.is_enabled=1
        AND t.scan_generation=r.active_scan_generation
        AND (t.folder_path=${sqlText(normalizedRootPath)} OR t.folder_path LIKE ${sqlText(`${normalizedRootPath}${path.sep}%`)})
        AND NOT EXISTS (
          SELECT 1 FROM dead_sources d
          WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)
        )
        AND track_search MATCH ${sqlText(ftsQuery(terms))}
      ORDER BY lower(r.path), lower(t.folder_path), lower(t.filename), lower(COALESCE(t.archive_entry, ''));
    `, true, "sidebar");
  }

  async tracksForGames(games) {
    if (!games.length) return [];
    const selection = JSON.stringify(games.map((game) => ({
      rootId: Number(game.rootId),
      name: String(game.name || ""),
      system: String(game.system || "")
    })));
    return run(this.databasePath, `
      WITH selected_games AS (
        SELECT CAST(json_extract(value, '$.rootId') AS INTEGER) AS root_id,
               json_extract(value, '$.name') AS browser_game,
               json_extract(value, '$.system') AS browser_system
        FROM json_each(${sqlText(selection)})
      )
      SELECT r.path AS rootPath, t.path, t.filename, t.special_audio_kind AS specialAudioKind, t.archive_path AS archivePath, t.archive_entry AS archiveEntry, t.track_index AS trackIndex, t.track_count AS trackCount,
             COALESCE(m.title, '') AS title, COALESCE(m.game, '') AS game,
             COALESCE(m.artist, '') AS artist, COALESCE(m.system, '') AS system,
             COALESCE(m.play_length_ms, 0) AS playLengthMs
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      JOIN selected_games s ON s.root_id=t.root_id AND s.browser_game=t.browser_game AND s.browser_system=t.browser_system
      LEFT JOIN track_metadata m ON m.track_id=t.id
      WHERE r.is_enabled=1 AND t.scan_generation=r.active_scan_generation
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
      ORDER BY lower(COALESCE(m.game, '')), lower(COALESCE(m.title, '')), t.path, t.track_index;
    `, true, "activation");
  }
}

module.exports = { LibraryDatabase };
