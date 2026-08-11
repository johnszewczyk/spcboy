const path = require("path");
const { normalizeArchiveEntry } = require("./archive-path");
const { SqliteWorkerClient } = require("./sqlite-worker-client");

const sqliteClients = new Map();

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
  return path.basename(folderPath).trim();
}

function isConsoleFolderName(value) {
  return /(?:^|\s)(?:sony|playstation|nintendo|sega|nec|microsoft|xbox|panasonic|atari|arcade|commodore|amiga|msx|fm towns|pc-?98|wonder\s*swan|bandai)(?:\s|$)/i.test(String(value || ""));
}

function usableMetadataValue(value) {
  const text = String(value || "").trim();
  // Failed scan materialization used to leak scratch-directory names and
  // format probes (for example "Sony XA header") into sidebar identity.
  return text && !path.isAbsolute(text) && !/^spcboy-(?:scan|playback)-scratch-/i.test(text) ? text : "";
}

function browserBucketsForRecord(record) {
  const sourcePath = sourcePathForRecord(record);
  const taggedConsole = consoleFromSourceTag(sourcePath);
  const parentConsole = consoleFromParentFolder(record);
  const archiveGame = record?.archivePath ? archiveTitleFromPath(record.archivePath) : "";
  return {
    // An archive is the durable game container in JoshW-style libraries. Do
    // not let a subset of decoder tags split one archive into several game
    // leaves; loose files still use their inspected game tag when available.
    game: archiveGame || usableMetadataValue(record?.metadata?.game) || archiveTitleFromPath(sourcePath) || parentConsole || "Untitled",
    // JoshW-style collection labels are authoritative when present. Metadata
    // remains a fallback for loose files outside a console-organized library.
    system: taggedConsole || (isConsoleFolderName(parentConsole) ? parentConsole : "") || usableMetadataValue(record?.metadata?.system) || parentConsole
  };
}

function browserGameForRecord(record) {
  return browserBucketsForRecord(record).game;
}

function browserSystemForRecord(record) {
  return browserBucketsForRecord(record).system;
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

async function run(databasePath, sql, json = false) {
  let client = sqliteClients.get(databasePath);
  if (!client) {
    client = new SqliteWorkerClient(databasePath);
    sqliteClients.set(databasePath, client);
  }
  try {
    return json ? await client.query(sql) : await client.execute(sql);
  } catch (error) {
    throw new Error(`SQLite operation failed: ${error.message}`.trim());
  }
}

class LibraryDatabase {
  constructor(databasePath) {
    this.databasePath = databasePath;
  }

  async close() {
    const client = sqliteClients.get(this.databasePath);
    if (!client) return;
    sqliteClients.delete(this.databasePath);
    await client.close();
  }

  async initialize() {
    await run(this.databasePath, `
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
        needs_rescan INTEGER NOT NULL DEFAULT 0
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
        browser_system TEXT NOT NULL DEFAULT ''
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
        created_at REAL NOT NULL
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
      CREATE INDEX IF NOT EXISTS tracks_root_idx ON tracks(root_id);
      CREATE INDEX IF NOT EXISTS tracks_folder_idx ON tracks(folder_path);
      CREATE INDEX IF NOT EXISTS scan_outcomes_root_idx ON library_scan_outcomes(root_id, id);
    `);
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN archive_path TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN archive_entry TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN backend_id TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN special_audio_kind TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN archive_signature TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN source_signature TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN scan_completed INTEGER NOT NULL DEFAULT 0;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN scan_version INTEGER NOT NULL DEFAULT 0;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN browser_game TEXT NOT NULL DEFAULT '';").catch(() => {});
    await run(this.databasePath, "ALTER TABLE tracks ADD COLUMN browser_system TEXT NOT NULL DEFAULT '';").catch(() => {});
    await run(this.databasePath, "ALTER TABLE library_roots ADD COLUMN last_scan_file_count INTEGER NOT NULL DEFAULT 0;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE library_roots ADD COLUMN last_scan_success_count INTEGER NOT NULL DEFAULT 0;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE library_roots ADD COLUMN last_scan_error_count INTEGER NOT NULL DEFAULT 0;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE library_roots ADD COLUMN last_scan_log TEXT;").catch(() => {});
    await run(this.databasePath, "ALTER TABLE library_roots ADD COLUMN needs_rescan INTEGER NOT NULL DEFAULT 0;").catch(() => {});
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
    await run(this.databasePath, `UPDATE library_roots SET is_enabled=${enabled ? 1 : 0} WHERE id=${sqlNumber(rootId)};`);
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
      ? `root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path))${sourcePredicates.length ? ` AND (${sourcePredicates.join(" OR ")})` : " AND 0"}`
      : `root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path))`;
    const cleanupTracks = `DELETE FROM tracks WHERE ${cleanupTrackWhere};`;
    const cleanupSearch = `DELETE FROM track_search WHERE rowid IN (SELECT id FROM tracks WHERE ${cleanupTrackWhere});`;
    const cleanupOutcomes = replaceSources
      ? `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)}${outcomePredicates.length ? ` AND (${outcomePredicates.join(" OR ")})` : " AND 0"};`
      : `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=library_scan_outcomes.root_id AND d.path=library_scan_outcomes.source_path);`;
    await run(this.databasePath, ["BEGIN TRANSACTION;", cleanupSearch, cleanupTracks, cleanupOutcomes, "COMMIT;"].join("\n"));
    for (let index = 0; index < records.length; index += 1000) {
      const insertStatements = ["BEGIN TRANSACTION;"];
      for (const record of records.slice(index, index + 1000)) {
        insertStatements.push(`INSERT INTO tracks(root_id, folder_path, path, filename, extension, backend_id, track_index, track_count, file_size, modified_at, discovered_at, special_audio_kind, archive_path, archive_entry, archive_signature, source_signature, scan_completed, scan_version, browser_game, browser_system) VALUES(${sqlNumber(rootId)}, ${sqlText(record.folderPath)}, ${sqlText(record.path)}, ${sqlText(record.filename)}, ${sqlText(record.extension)}, ${record.backendId ? sqlText(record.backendId) : "NULL"}, ${sqlNumber(record.trackIndex)}, ${sqlNumber(record.trackCount)}, ${sqlNumber(record.fileSize)}, ${sqlNumber(record.modifiedAt)}, ${sqlNumber(now)}, ${record.specialAudioKind ? sqlText(record.specialAudioKind) : "NULL"}, ${record.archivePath ? sqlText(record.archivePath) : "NULL"}, ${record.archiveEntry ? sqlText(normalizeArchiveEntry(record.archiveEntry)) : "NULL"}, ${record.archiveSignature ? sqlText(record.archiveSignature) : "NULL"}, ${record.sourceSignature ? sqlText(record.sourceSignature) : "NULL"}, ${record.scanCompleted ? 1 : 0}, ${sqlNumber(record.scanVersion)}, ${sqlText(browserGameForRecord(record))}, ${sqlText(browserSystemForRecord(record))});`);
        if (record.metadata) {
          insertStatements.push(`INSERT INTO track_metadata(track_id, title, game, artist, system, play_length_ms, metadata_scanned_at) VALUES(last_insert_rowid(), ${sqlText(record.metadata.title)}, ${sqlText(record.metadata.game)}, ${sqlText(record.metadata.artist)}, ${sqlText(record.metadata.system)}, ${sqlNumber(record.metadata.playLengthMs)}, ${sqlNumber(now)});`);
        }
        insertStatements.push(`INSERT INTO track_search(rowid, content) SELECT t.id, ${searchDocumentExpression()} FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id WHERE t.id=last_insert_rowid();`);
      }
      insertStatements.push("COMMIT;");
      await run(this.databasePath, insertStatements.join("\n"));
    }
    const outcomeStatements = [];
    for (const outcome of Array.isArray(scanStats.outcomes) ? scanStats.outcomes : []) {
      outcomeStatements.push(`INSERT INTO library_scan_outcomes(root_id, source_path, archive_entry, backend_id, stage, state, duration_ms, message, created_at) VALUES(${sqlNumber(rootId)}, ${sqlText(outcome.identity?.sourcePath)}, ${outcome.identity?.archiveEntry ? sqlText(normalizeArchiveEntry(outcome.identity.archiveEntry)) : "NULL"}, ${outcome.route?.backendId ? sqlText(outcome.route.backendId) : "NULL"}, ${sqlText(outcome.stage)}, ${sqlText(outcome.state)}, ${sqlNumber(outcome.durationMs)}, ${sqlText(outcome.message)}, ${sqlNumber(now)});`);
    }
    for (let index = 0; index < outcomeStatements.length; index += 2000) {
      await run(this.databasePath, ["BEGIN TRANSACTION;", ...outcomeStatements.slice(index, index + 2000), "COMMIT;"].join("\n"));
    }
    await run(this.databasePath, `BEGIN TRANSACTION; UPDATE library_roots SET last_scan_completed_at=${sqlNumber(now)}, last_scan_track_count=(SELECT COUNT(*) FROM tracks t WHERE t.root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))), last_scan_file_count=${sqlNumber(scanStats.fileCount)}, last_scan_success_count=${sqlNumber(scanStats.successCount)}, last_scan_error_count=${sqlNumber(errorCount)}, last_scan_error=${summary ? sqlText(summary) : "NULL"}, last_scan_log=${errorLog ? sqlText(errorLog) : "NULL"}, needs_rescan=${scanStats.needsRescan ? 1 : 0} WHERE id=${sqlNumber(rootId)}; COMMIT;`);
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
      LEFT JOIN track_metadata m ON m.track_id=t.id
      WHERE t.root_id=${sqlNumber(rootId)}
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
      ORDER BY t.path, t.track_index;
    `, true);
  }

  async updatePlaylistMetadata(updates) {
    const now = Date.now() / 1000;
    const statements = ["BEGIN TRANSACTION;"];
    for (const update of Array.isArray(updates) ? updates : []) {
      const metadata = update?.metadata;
      if (!metadata) continue;
      const predicate = update.archivePath && update.archiveEntry
        ? `archive_path=${sqlText(update.archivePath)} AND archive_entry=${sqlText(normalizeArchiveEntry(update.archiveEntry))} AND track_index=${sqlNumber(update.trackIndex)}`
        : update.path
          ? `archive_path IS NULL AND path=${sqlText(update.path)} AND track_index=${sqlNumber(update.trackIndex)}`
          : null;
      if (!predicate) continue;
      // Queue-time tag hydration must preserve the source-derived console
      // bucket. Build each update from the existing source columns in SQL,
      // then repair its normalized identity in the next scan/initialization.
      // A tag may improve a game title, but must never turn PS1 into "SEGA".
      const browserGame = usableMetadataValue(metadata.game);
      statements.push(`UPDATE tracks SET browser_game=CASE WHEN ${sqlText(browserGame)} <> '' THEN ${sqlText(browserGame)} ELSE browser_game END WHERE ${predicate};`);
      statements.push(`INSERT INTO track_metadata(track_id, title, game, artist, system, play_length_ms, metadata_scanned_at) SELECT id, ${sqlText(metadata.title)}, ${sqlText(metadata.game)}, ${sqlText(metadata.artist)}, ${sqlText(metadata.system)}, ${sqlNumber(metadata.playLengthMs)}, ${sqlNumber(now)} FROM tracks WHERE ${predicate} ON CONFLICT(track_id) DO UPDATE SET title=excluded.title, game=excluded.game, artist=excluded.artist, system=excluded.system, play_length_ms=excluded.play_length_ms, metadata_scanned_at=excluded.metadata_scanned_at;`);
      statements.push(`DELETE FROM track_search WHERE rowid IN (SELECT id FROM tracks WHERE ${predicate});`);
      statements.push(`INSERT INTO track_search(rowid, content) SELECT t.id, ${searchDocumentExpression()} FROM tracks t LEFT JOIN track_metadata m ON m.track_id=t.id WHERE ${predicate};`);
    }
    if (statements.length === 1) return;
    statements.push("COMMIT;");
    await run(this.databasePath, statements.join("\n"));
  }

  async loadScanOutcomes(rootId) {
    return run(this.databasePath, `
      SELECT source_path AS sourcePath, archive_entry AS archiveEntry,
             backend_id AS backendId, stage, state, duration_ms AS durationMs,
             message, created_at AS createdAt
      FROM library_scan_outcomes
      WHERE root_id=${sqlNumber(rootId)}
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
      FROM tracks t
      WHERE NOT EXISTS (
        SELECT 1 FROM dead_sources d
        WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)
      )
      GROUP BY t.root_id, COALESCE(t.archive_path, t.path)
      ORDER BY t.root_id, path;
    `, true);
  }

  async restoreSources(sources) {
    if (!sources.length) return;
    const sourceRows = sources.map((source) => `(${sqlNumber(source.rootId)}, ${sqlText(source.path)})`).join(",");
    await run(this.databasePath, `
      CREATE TEMP TABLE restore_sources(root_id INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(root_id, path));
      INSERT INTO restore_sources(root_id, path) VALUES ${sourceRows};
      DELETE FROM dead_sources
      WHERE EXISTS (SELECT 1 FROM restore_sources s WHERE s.root_id=dead_sources.root_id AND s.path=dead_sources.path);
      DROP TABLE restore_sources;
    `);
  }

  async markUndiscoveredSourcesDead(rootId, livePaths) {
    const values = [...new Set(livePaths)].map((value) => sqlText(value)).join(",");
    if (!values) {
      await run(this.databasePath, `INSERT OR REPLACE INTO dead_sources(root_id, path, marked_at) SELECT DISTINCT root_id, COALESCE(archive_path, path), ${sqlNumber(Date.now() / 1000)} FROM tracks WHERE root_id=${sqlNumber(rootId)};`);
      return;
    }
    await run(this.databasePath, `
      CREATE TEMP TABLE live_scan_sources(path TEXT PRIMARY KEY);
      INSERT INTO live_scan_sources(path) VALUES ${[...new Set(livePaths)].map((value) => `(${sqlText(value)})`).join(",")};
      INSERT OR REPLACE INTO dead_sources(root_id, path, marked_at)
      SELECT DISTINCT t.root_id, COALESCE(t.archive_path, t.path), ${sqlNumber(Date.now() / 1000)}
      FROM tracks t
      WHERE t.root_id=${sqlNumber(rootId)}
        AND NOT EXISTS (SELECT 1 FROM live_scan_sources s WHERE s.path=COALESCE(t.archive_path, t.path));
      DROP TABLE live_scan_sources;
    `);
  }

  async markSourcesDead(sources) {
    if (!sources.length) return { markedSourceCount: 0, rootIds: [] };
    const uniqueSources = [...new Map(sources.map((source) => [`${source.rootId}\u0000${source.path}`, source])).values()];
    const rootIds = [...new Set(uniqueSources.map((source) => Number(source.rootId)))].filter(Number.isFinite);
    for (let offset = 0; offset < uniqueSources.length; offset += 500) {
      const sourceRows = uniqueSources.slice(offset, offset + 500).map((source) =>
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
        SET last_scan_track_count=(SELECT COUNT(*) FROM tracks t WHERE t.root_id=library_roots.id AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))),
            needs_rescan=1
        WHERE id IN (SELECT DISTINCT root_id FROM mark_missing_sources);
        DROP TABLE mark_missing_sources;
        COMMIT;
      `);
    }
    return { markedSourceCount: uniqueSources.length, rootIds };
  }

  async deadSourceCount() {
    return Number((await run(this.databasePath, "SELECT COUNT(*) AS count FROM dead_sources;", true))[0]?.count || 0);
  }

  async trackCount() {
    return Number((await run(this.databasePath, "SELECT COUNT(*) AS count FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path));", true))[0]?.count || 0);
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
      DELETE FROM tracks
      WHERE EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path));
      DELETE FROM dead_sources;
      UPDATE library_roots
      SET last_scan_track_count=(SELECT COUNT(*) FROM tracks t WHERE t.root_id=library_roots.id), needs_rescan=1;
      COMMIT;
    `);
    return { purgedSourceCount: count, purgedTrackCount: trackCount };
  }

  async clearDatabase() {
    const trackCount = Number((await run(this.databasePath, "SELECT COUNT(*) AS count FROM tracks;", true))[0]?.count || 0);
    await run(this.databasePath, `
      BEGIN TRANSACTION;
      DELETE FROM library_scan_outcomes;
      DELETE FROM track_search;
      DELETE FROM tracks;
      DELETE FROM dead_sources;
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
          AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
          AND track_search MATCH ${sqlText(ftsQuery(terms))}
      )` : "";
    const matchingJoin = terms.length
      ? "JOIN matching_groups g ON g.rootId=t.root_id AND g.name=t.browser_game AND g.system=t.browser_system"
      : "";
    const games = await run(this.databasePath, `${matchingGroups}
      SELECT t.root_id AS rootId, r.path AS rootPath,
             t.browser_game AS name, t.browser_system AS system,
             COUNT(*) AS trackCount
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      ${matchingJoin}
      WHERE r.is_enabled=1
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
      GROUP BY t.root_id, r.path, name, system
      ORDER BY lower(name), name, lower(system), system, lower(r.path), r.path;
    `, true);
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
        AND (t.folder_path=${sqlText(normalizedRootPath)} OR t.folder_path LIKE ${sqlText(`${normalizedRootPath}${path.sep}%`)})
        AND NOT EXISTS (
          SELECT 1 FROM dead_sources d
          WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)
        )
        AND track_search MATCH ${sqlText(ftsQuery(terms))}
      ORDER BY lower(r.path), lower(t.folder_path), lower(t.filename), lower(COALESCE(t.archive_entry, ''));
    `, true);
  }

  async tracksForGames(games) {
    if (!games.length) return [];
    const predicate = games.map((game) => `(t.root_id=${sqlNumber(game.rootId)} AND t.browser_game=${sqlText(game.name)} AND t.browser_system=${sqlText(game.system)})`).join(" OR ");
    return run(this.databasePath, `
      SELECT r.path AS rootPath, t.path, t.filename, t.special_audio_kind AS specialAudioKind, t.archive_path AS archivePath, t.archive_entry AS archiveEntry, t.track_index AS trackIndex, t.track_count AS trackCount,
             COALESCE(m.title, '') AS title, COALESCE(m.game, '') AS game,
             COALESCE(m.artist, '') AS artist, COALESCE(m.system, '') AS system,
             COALESCE(m.play_length_ms, 0) AS playLengthMs
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      LEFT JOIN track_metadata m ON m.track_id=t.id
      WHERE r.is_enabled=1 AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)) AND (${predicate})
      ORDER BY lower(COALESCE(m.game, '')), lower(COALESCE(m.title, '')), t.path, t.track_index;
    `, true);
  }
}

module.exports = { LibraryDatabase };
