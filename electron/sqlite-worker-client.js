const path = require("path");
const { Worker } = require("worker_threads");

class SqliteWorkerClient {
  constructor(databasePath, { WorkerClass = Worker } = {}) {
    if (!databasePath) throw new Error("SQLite database path is required");
    this.databasePath = databasePath;
    this.WorkerClass = WorkerClass;
    this.worker = null;
    this.nextRequestId = 0;
    this.pending = new Map();
  }

  execute(sql) {
    return this.request(sql, false);
  }

  query(sql) {
    return this.request(sql, true);
  }

  async close() {
    const worker = this.worker;
    this.worker = null;
    this.rejectPending(new Error("SQLite worker closed"));
    if (worker) await worker.terminate();
  }

  request(sql, query) {
    const worker = this.ensureWorker();
    const id = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, sql, query });
    });
  }

  ensureWorker() {
    if (this.worker) return this.worker;

    const worker = new this.WorkerClass(path.join(__dirname, "sqlite-worker.js"), {
      workerData: { databasePath: this.databasePath }
    });
    this.worker = worker;

    worker.on("message", ({ id, result, error }) => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result);
    });
    worker.on("error", (error) => {
      this.rejectPending(error);
      if (this.worker === worker) this.worker = null;
    });
    worker.on("exit", (code) => {
      if (code !== 0) this.rejectPending(new Error(`SQLite worker exited with code ${code}`));
      if (this.worker === worker) this.worker = null;
    });
    worker.unref?.();
    return worker;
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

module.exports = { SqliteWorkerClient };
