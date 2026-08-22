const test = require("node:test");
const assert = require("node:assert/strict");
const { CatalogReaderClient } = require("../electron/catalog-reader-client");

class FakeBridgeClient {
  constructor(options) {
    this.options = options;
    this.requests = [];
    this.terminated = false;
  }

  request(command, parts) {
    const payload = parts?.[0] ? JSON.parse(Buffer.from(parts[0], "base64").toString("utf8")) : undefined;
    this.requests.push({ command, payload });
    const values = {
      summary: { path: "/music/Library.sqlite", trackCount: 2, rootCount: 1 },
      roots: [{ id: 1, path: "/music", isEnabled: true, trackCount: 2 }],
      games: [{ rootId: 1, name: "Track 9", system: "SNES" }],
      files: [{ rootId: 1, path: "/music/a.spc" }],
      "game-tracks": [{ path: "/music/a.spc" }],
      "file-tracks": [{ path: "/music/a.spc" }],
      "folder-tracks": [{ path: "/music/a.spc" }],
      "storage-metrics": { databaseBytes: 1, walBytes: 0, sharedMemoryBytes: 0 }
    };
    return Promise.resolve(Buffer.from(JSON.stringify(values[command])));
  }

  terminate() { this.terminated = true; }
}

test("CatalogReader client is a thin Swift-bridge client with no SQLite query path", async () => {
  const reader = new CatalogReaderClient("/music/Library.sqlite", {
    getAppPath: () => "/SPCBoy",
    NativeHelperClientClass: FakeBridgeClient
  });

  await reader.initialize();
  assert.equal(reader.isReadOnly, true);
  assert.equal(reader.catalogKind, "catalog-reader-swift");
  assert.equal(reader.client.options.helperPath, "/SPCBoy/native/catalog-reader-electron-bridge");
  assert.deepEqual(reader.client.options.helperArguments, ["serve", "/music/Library.sqlite"]);
  assert.deepEqual(await reader.searchGames("track 9"), [{ rootId: 1, name: "Track 9", system: "SNES" }]);
  assert.deepEqual(reader.client.requests.map((request) => request.command), ["summary", "games"]);
  assert.equal(reader.client.requests[1].payload, "track 9");
  reader.close();
  assert.equal(reader.client.terminated, true);
});

test("CatalogReader validation opens only the Swift bridge", async () => {
  const result = await CatalogReaderClient.validate("/music/Library.sqlite", {
    getAppPath: () => "/SPCBoy",
    NativeHelperClientClass: FakeBridgeClient
  });
  assert.deepEqual(result, { path: "/music/Library.sqlite", trackCount: 2, rootCount: 1 });
});
