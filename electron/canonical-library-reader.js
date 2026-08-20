const fs = require("fs").promises;
const path = require("path");
const { SqliteWorkerClient } = require("./sqlite-worker-client");

const CANONICAL_SCHEMA_VERSION = 23;
const REQUIRED_TABLES = [
  "library_roots", "tracks", "track_metadata", "dead_sources",
  "game_sidebar_buckets", "file_sidebar_buckets"
];

function sqlText(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "NULL";
}

function displayLibraryRootPath(rootPath) {
  const parts = path.resolve(String(rootPath || "")).split(path.sep).filter(Boolean);
  const audioIndex = parts.lastIndexOf("audio");
  if (audioIndex >= 0 && audioIndex < parts.length - 1) return parts.slice(audioIndex + 1).join("/");
  return path.basename(String(rootPath || "")) || String(rootPath || "Library");
}

class CanonicalLibraryReader {
  static async validate(databasePath) {
    const reader = new CanonicalLibraryReader(databasePath);
    try {
      await reader.initialize();
      return {
        path: reader.databasePath,
        trackCount: await reader.trackCount(),
        rootCount: (await reader.loadRoots()).length
      };
    } finally {
      await reader.close();
    }
  }

  constructor(databasePath, { ClientClass = SqliteWorkerClient } = {}) {
    if (!path.isAbsolute(String(databasePath || ""))) throw new Error("Canonical library database path must be absolute");
    this.databasePath = path.resolve(databasePath);
    this.client = new ClientClass(this.databasePath, { queryOnly: true });
    this.isReadOnly = true;
    this.catalogKind = "media-scanner-canonical";
  }

  async initialize() {
    const version = Number((await this.client.query("PRAGMA user_version;"))[0]?.user_version || 0);
    if (version !== CANONICAL_SCHEMA_VERSION) {
      throw new Error(`Unsupported library database schema ${version}; expected ${CANONICAL_SCHEMA_VERSION}`);
    }
    const tables = new Set((await this.client.query("SELECT name FROM sqlite_master WHERE type='table';")).map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((name) => !tables.has(name));
    if (missing.length) throw new Error(`Library database is missing required tables: ${missing.join(", ")}`);
    return this;
  }

  async close() {
    await this.client.close();
  }

  async databaseStorageMetrics() {
    const size = async (filePath) => {
      try { return Number((await fs.stat(filePath)).size) || 0; }
      catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
    };
    const [databaseBytes, walBytes, sharedMemoryBytes] = await Promise.all([
      size(this.databasePath), size(`${this.databasePath}-wal`), size(`${this.databasePath}-shm`)
    ]);
    return { databaseBytes, walBytes, sharedMemoryBytes };
  }

  async loadRoots() {
    return this.client.query(`
      SELECT * FROM library_roots
      WHERE is_attached=1
      ORDER BY display_order, id;
    `);
  }

  async loadRoot(rootId) {
    const id = Number(rootId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return (await this.client.query(`SELECT * FROM library_roots WHERE id=${sqlNumber(id)} AND is_attached=1 LIMIT 1;`))[0] || null;
  }

  async deadSourceCount() {
    return Number((await this.client.query("SELECT COUNT(*) AS count FROM dead_sources;"))[0]?.count || 0);
  }

  async trackCount() {
    return Number((await this.client.query(`
      SELECT COUNT(*) AS count FROM tracks t JOIN library_roots r ON r.id=t.root_id
      WHERE r.is_attached=1
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path));
    `))[0]?.count || 0);
  }

  async deadTrackCount() {
    return Number((await this.client.query(`
      SELECT COUNT(*) AS count FROM tracks t
      WHERE EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path));
    `))[0]?.count || 0);
  }

  async loadGames(query = "") {
    const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const predicates = terms.map((term) => {
      const pattern = sqlText(`%${term}%`);
      return `lower(b.browser_game || ' ' || b.browser_system) LIKE ${pattern}`;
    });
    const games = await this.client.query(`
      SELECT b.root_id AS rootId, r.path AS rootPath,
             b.browser_game AS name, b.browser_system AS system,
             b.track_count AS trackCount
      FROM game_sidebar_buckets b JOIN library_roots r ON r.id=b.root_id
      WHERE r.is_attached=1 AND r.is_enabled=1
        ${predicates.length ? `AND ${predicates.join(" AND ")}` : ""}
      ORDER BY lower(name), name, lower(system), system, lower(r.path), r.path;
    `);
    const seen = new Set();
    const duplicates = new Set();
    for (const game of games) {
      const key = `${game.name}\u0000${game.system}`;
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    return games.map((game) => ({
      ...game,
      rootName: displayLibraryRootPath(game.rootPath),
      displayName: duplicates.has(`${game.name}\u0000${game.system}`)
        ? `${game.name} (${game.system || "Unknown Console"} • ${displayLibraryRootPath(game.rootPath)})`
        : game.name
    }));
  }

  async searchGames(query) {
    return this.loadGames(query);
  }

  async tracksForGames(games) {
    if (!Array.isArray(games) || !games.length) return [];
    const selections = games.map((game) => `(${sqlNumber(game.rootId)}, ${sqlText(game.name)}, ${sqlText(game.system)})`).join(",");
    return this.client.query(`
      WITH selected_games(root_id, browser_game, browser_system) AS (VALUES ${selections})
      SELECT r.path AS rootPath, t.path, t.filename, NULL AS specialAudioKind,
             t.archive_path AS archivePath, t.archive_entry AS archiveEntry,
             t.track_index AS trackIndex, t.track_count AS trackCount,
             t.file_size AS fileSize, t.modified_at AS modifiedAt,
             NULL AS sourceSignature, 0 AS scanVersion,
             m.track_id AS metadataTrackId,
             COALESCE(m.title, '') AS title, COALESCE(m.game, '') AS game,
             COALESCE(m.author, '') AS artist, COALESCE(m.system, '') AS system,
             COALESCE(m.play_length_ms, 0) AS playLengthMs
      FROM tracks t JOIN library_roots r ON r.id=t.root_id
      JOIN selected_games s ON s.root_id=t.root_id AND s.browser_game=t.browser_game AND s.browser_system=t.browser_system
      LEFT JOIN track_metadata m ON m.track_id=t.id
      WHERE r.is_attached=1 AND r.is_enabled=1
        AND NOT EXISTS (SELECT 1 FROM dead_sources d WHERE d.root_id=t.root_id AND d.path=COALESCE(t.archive_path, t.path))
      ORDER BY lower(COALESCE(m.game, '')), lower(COALESCE(m.title, '')), t.path, t.track_index;
    `);
  }

}

module.exports = { CANONICAL_SCHEMA_VERSION, CanonicalLibraryReader };
