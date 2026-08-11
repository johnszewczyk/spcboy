const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");
const { DatabaseSync } = require("node:sqlite");

fs.mkdirSync(path.dirname(workerData.databasePath), { recursive: true });
const database = new DatabaseSync(workerData.databasePath);
database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

parentPort.on("message", ({ id, sql, query }) => {
  try {
    const result = query ? database.prepare(sql).all() : (database.exec(sql), []);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
