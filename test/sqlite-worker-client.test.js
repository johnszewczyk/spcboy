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

test("SQLite worker client reuses prepared statements for parameter batches", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-sqlite-worker-batch-"));
  const databasePath = path.join(fixtureRoot, "Library.sqlite");
  const client = new SqliteWorkerClient(databasePath);
  try {
    await client.execute("CREATE TABLE values_table (value INTEGER NOT NULL, label TEXT NOT NULL);");
    await client.executePreparedBatch([
      { sql: "INSERT INTO values_table(value, label) VALUES (?, ?);", params: [1, "one"] },
      { sql: "INSERT INTO values_table(value, label) VALUES (?, ?);", params: [2, "two"] }
    ]);
    assert.deepEqual(await client.query("SELECT value, label FROM values_table ORDER BY value;"), [
      { value: 1, label: "one" },
      { value: 2, label: "two" }
    ]);
  } finally {
    await client.close();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("SQLite query-only worker lanes reject accidental writes", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-sqlite-worker-readonly-"));
  const databasePath = path.join(fixtureRoot, "Library.sqlite");
  const writer = new SqliteWorkerClient(databasePath);
  const reader = new SqliteWorkerClient(databasePath, { queryOnly: true });
  try {
    await writer.execute("CREATE TABLE values_table (value INTEGER NOT NULL); INSERT INTO values_table(value) VALUES (1);");
    assert.deepEqual(await reader.query("SELECT value FROM values_table;"), [{ value: 1 }]);
    await assert.rejects(reader.execute("INSERT INTO values_table(value) VALUES (2);"), /readonly|read-only/i);
  } finally {
    await Promise.all([writer.close(), reader.close()]);
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
