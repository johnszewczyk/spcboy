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

function browserGameForRecord(record) {
  return String(record?.metadata?.game || "").trim() || record?.archivePath || record?.folderPath || "";
}

function browserSystemForRecord(record) {
  return String(record?.metadata?.system || "").trim();
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
    await this.repairInternalCacheGameNames();
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
    await run(this.databasePath, `BEGIN TRANSACTION; DELETE FROM track_metadata WHERE track_id IN (SELECT id FROM tracks WHERE root_id=${sqlNumber(rootId)}); DELETE FROM tracks WHERE root_id=${sqlNumber(rootId)}; DELETE FROM library_roots WHERE id=${sqlNumber(rootId)}; COMMIT;`);
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
    const cleanupTracks = replaceSources
      ? `DELETE FROM tracks WHERE root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path))${sourcePredicates.length ? ` AND (${sourcePredicates.join(" OR ")})` : " AND 0"};`
      : `DELETE FROM tracks WHERE root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=tracks.root_id AND d.path=COALESCE(tracks.archive_path, tracks.path));`;
    const cleanupOutcomes = replaceSources
      ? `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)}${outcomePredicates.length ? ` AND (${outcomePredicates.join(" OR ")})` : " AND 0"};`
      : `DELETE FROM library_scan_outcomes WHERE root_id=${sqlNumber(rootId)} AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=library_scan_outcomes.root_id AND d.path=library_scan_outcomes.source_path);`;
    await run(this.databasePath, ["BEGIN TRANSACTION;", cleanupTracks, cleanupOutcomes, "COMMIT;"].join("\n"));
    for (let index = 0; index < records.length; index += 1000) {
      const insertStatements = ["BEGIN TRANSACTION;"];
      for (const record of records.slice(index, index + 1000)) {
        insertStatements.push(`INSERT INTO tracks(root_id, folder_path, path, filename, extension, backend_id, track_index, track_count, file_size, modified_at, discovered_at, special_audio_kind, archive_path, archive_entry, archive_signature, source_signature, scan_completed, scan_version, browser_game, browser_system) VALUES(${sqlNumber(rootId)}, ${sqlText(record.folderPath)}, ${sqlText(record.path)}, ${sqlText(record.filename)}, ${sqlText(record.extension)}, ${record.backendId ? sqlText(record.backendId) : "NULL"}, ${sqlNumber(record.trackIndex)}, ${sqlNumber(record.trackCount)}, ${sqlNumber(record.fileSize)}, ${sqlNumber(record.modifiedAt)}, ${sqlNumber(now)}, ${record.specialAudioKind ? sqlText(record.specialAudioKind) : "NULL"}, ${record.archivePath ? sqlText(record.archivePath) : "NULL"}, ${record.archiveEntry ? sqlText(normalizeArchiveEntry(record.archiveEntry)) : "NULL"}, ${record.archiveSignature ? sqlText(record.archiveSignature) : "NULL"}, ${record.sourceSignature ? sqlText(record.sourceSignature) : "NULL"}, ${record.scanCompleted ? 1 : 0}, ${sqlNumber(record.scanVersion)}, ${sqlText(browserGameForRecord(record))}, ${sqlText(browserSystemForRecord(record))});`);
        if (record.metadata) {
          insertStatements.push(`INSERT INTO track_metadata(track_id, title, game, artist, system, play_length_ms, metadata_scanned_at) VALUES(last_insert_rowid(), ${sqlText(record.metadata.title)}, ${sqlText(record.metadata.game)}, ${sqlText(record.metadata.artist)}, ${sqlText(record.metadata.system)}, ${sqlNumber(record.metadata.playLengthMs)}, ${sqlNumber(now)});`);
        }
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
      const browserGame = String(metadata.game || "").trim();
      const browserSystem = String(metadata.system || "").trim();
      statements.push(`UPDATE tracks SET browser_game=CASE WHEN ${sqlText(browserGame)} <> '' THEN ${sqlText(browserGame)} ELSE COALESCE(archive_path, folder_path) END, browser_system=${sqlText(browserSystem)} WHERE ${predicate};`);
      statements.push(`INSERT INTO track_metadata(track_id, title, game, artist, system, play_length_ms, metadata_scanned_at) SELECT id, ${sqlText(metadata.title)}, ${sqlText(metadata.game)}, ${sqlText(metadata.artist)}, ${sqlText(metadata.system)}, ${sqlNumber(metadata.playLengthMs)}, ${sqlNumber(now)} FROM tracks WHERE ${predicate} ON CONFLICT(track_id) DO UPDATE SET title=excluded.title, game=excluded.game, artist=excluded.artist, system=excluded.system, play_length_ms=excluded.play_length_ms, metadata_scanned_at=excluded.metadata_scanned_at;`);
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
    const rootIds = [...new Set(sources.map((source) => Number(source.rootId)))].filter(Number.isFinite);
    const sourceRows = sources.map((source) =>
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
    return { markedSourceCount: sources.length, rootIds };
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

  async loadGames() {
    const games = await run(this.databasePath, `
      SELECT t.root_id AS rootId, r.path AS rootPath,
             t.browser_game AS name, t.browser_system AS system,
             COUNT(*) AS trackCount
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
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
      const rootName = path.basename(game.rootPath || "") || game.rootPath || "Library";
      const detail = game.system || "Unknown Console";
      return {
        ...game,
        rootName,
        displayName: duplicateBuckets.has(key) ? `${game.name} (${detail} • ${rootName})` : game.name
      };
    });
  }

  async searchBrowserEntries(rootPath, query) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!rootPath || !normalizedQuery) return [];
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const searchText = `lower(
      COALESCE(t.filename, '') || ' ' ||
      COALESCE(t.archive_entry, '') || ' ' ||
      COALESCE(m.title, '') || ' ' ||
      COALESCE(m.game, '') || ' ' ||
      COALESCE(m.artist, '') || ' ' ||
      COALESCE(m.system, '')
    )`;
    const termPredicate = terms.map((term) => `${searchText} LIKE ${sqlText(`%${term}%`)}`).join(" AND ");
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
      WHERE r.is_enabled=1
        AND NOT EXISTS (
          SELECT 1 FROM dead_sources d
          WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path)
        )
        AND (${termPredicate})
      ORDER BY lower(r.path), lower(t.folder_path), lower(t.filename), lower(COALESCE(t.archive_entry, ''));
    `, true);
  }

  async tracksForGames(games) {
    if (!games.length) return [];
    const predicate = games.map((game) => `(t.root_id=${sqlNumber(game.rootId)} AND t.browser_game=${sqlText(game.name)} AND t.browser_system=${sqlText(game.system)})`).join(" OR ");
    return run(this.databasePath, `
      SELECT t.path, t.filename, t.special_audio_kind AS specialAudioKind, t.archive_path AS archivePath, t.archive_entry AS archiveEntry, t.track_index AS trackIndex, t.track_count AS trackCount,
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
