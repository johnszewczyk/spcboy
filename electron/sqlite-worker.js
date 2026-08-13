const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");
const { DatabaseSync } = require("node:sqlite");

if (!workerData.queryOnly) fs.mkdirSync(path.dirname(workerData.databasePath), { recursive: true });
const database = new DatabaseSync(workerData.databasePath, { readOnly: Boolean(workerData.queryOnly) });
database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
if (workerData.queryOnly) database.exec("PRAGMA query_only = ON;");

parentPort.on("message", ({ id, operation, commands, sql, query }) => {
  try {
    let result;
    if (operation === "preparedBatch") {
      const statements = new Map();
      for (const command of commands) {
        let statement = statements.get(command.sql);
        if (!statement) {
          statement = database.prepare(command.sql);
          statements.set(command.sql, statement);
        }
        statement.run(...(Array.isArray(command.params) ? command.params : []));
      }
      result = [];
    } else {
      result = query ? database.prepare(sql).all() : (database.exec(sql), []);
    }
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
