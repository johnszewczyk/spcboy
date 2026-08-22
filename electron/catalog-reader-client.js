const path = require("path");
const { NativeHelperClient } = require("./native-helper-client");

const CATALOG_READER_BRIDGE_NAME = "catalog-reader-electron-bridge";

// This is command framing only. All schema validation, SQLite access, sidebar
// projections, filtering, ordering, and catalog row construction live in the
// shared Swift CatalogReader bridge.
class CatalogReaderClient {
  static async validate(databasePath, options = {}) {
    const reader = new CatalogReaderClient(databasePath, options);
    try {
      await reader.initialize();
      const summary = await reader.summary();
      return { path: reader.databasePath, trackCount: summary.trackCount, rootCount: summary.rootCount };
    } finally {
      reader.close();
    }
  }

  constructor(databasePath, { getAppPath, NativeHelperClientClass = NativeHelperClient, spawnProcess } = {}) {
    if (!path.isAbsolute(String(databasePath || ""))) throw new Error("Canonical library database path must be absolute");
    if (typeof getAppPath !== "function") throw new Error("getAppPath is required");
    this.databasePath = path.resolve(databasePath);
    this.isReadOnly = true;
    this.catalogKind = "catalog-reader-swift";
    this.client = new NativeHelperClientClass({
      helperPath: path.join(getAppPath(), "native", CATALOG_READER_BRIDGE_NAME),
      helperArguments: ["serve", this.databasePath],
      spawnProcess
    });
  }

  async initialize() {
    await this.summary();
    return this;
  }

  close() {
    this.client.terminate();
  }

  request(command, payload) {
    const parts = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload), "utf8").toString("base64")];
    return this.client.request(command, parts).then((value) => JSON.parse(String(value || "")));
  }

  summary() { return this.request("summary"); }
  databaseStorageMetrics() { return this.request("storage-metrics"); }
  loadRoots() { return this.request("roots"); }
  loadGames() { return this.request("games", ""); }
  searchGames(query) { return this.request("games", String(query || "")); }
  loadFiles() { return this.request("files"); }
  tracksForGames(games) { return this.request("game-tracks", Array.isArray(games) ? games : []); }
  tracksForFiles(files) { return this.request("file-tracks", Array.isArray(files) ? files : []); }
  tracksForFolders(folders) { return this.request("folder-tracks", Array.isArray(folders) ? folders : []); }
}

module.exports = { CATALOG_READER_BRIDGE_NAME, CatalogReaderClient };
