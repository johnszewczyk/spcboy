const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteWorkerClient } = require("../electron/sqlite-worker-client");

test("SQLite worker client serializes commands and returns query rows", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-sqlite-worker-"));
  const client = new SqliteWorkerClient(path.join(fixtureRoot, "Library.sqlite"));
  try {
    await client.execute("CREATE TABLE values_table (value INTEGER NOT NULL);");
    await Promise.all([
      client.execute("INSERT INTO values_table(value) VALUES (1);"),
      client.execute("INSERT INTO values_table(value) VALUES (2);")
    ]);
    assert.deepEqual(await client.query("SELECT value FROM values_table ORDER BY value;"), [{ value: 1 }, { value: 2 }]);
  } finally {
    await client.close();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
