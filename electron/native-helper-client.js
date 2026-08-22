const { spawn } = require("child_process");

class NativeHelperClient {
  constructor({ helperPath, helperArguments = ["serve"], spawnProcess = spawn, logError = console.error }) {
    if (!helperPath) throw new Error("Native helper path is required.");
    this.helperPath = helperPath;
    this.helperArguments = [...helperArguments];
    this.spawnProcess = spawnProcess;
    this.logError = logError;
    this.worker = null;
    this.nextRequestId = 0;
    this.responseBuffer = Buffer.alloc(0);
    this.pending = new Map();
    this.pendingState = null;
  }

  request(command, parts = []) {
    const worker = this.ensureWorker();
    const requestId = String(++this.nextRequestId);
    const line = [requestId, command, ...parts].join("\t");

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.stdin.write(`${line}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async requestJson(command, parts = []) {
    const payload = await this.request(command, parts);
    return JSON.parse(String(payload || ""));
  }

  state() {
    if (!this.pendingState) {
      this.pendingState = this.requestJson("player-state").finally(() => {
        this.pendingState = null;
      });
    }
    return this.pendingState;
  }

  terminate() {
    const worker = this.worker;
    this.worker = null;
    this.responseBuffer = Buffer.alloc(0);
    this.pendingState = null;
    this.rejectPending(new Error("native helper terminated"));
    if (worker && !worker.killed) worker.kill();
  }

  ensureWorker() {
    if (this.worker && !this.worker.killed) return this.worker;

    this.responseBuffer = Buffer.alloc(0);
    const worker = this.spawnProcess(this.helperPath, this.helperArguments, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.worker = worker;

    worker.stdout.on("data", (chunk) => {
      this.responseBuffer = Buffer.concat([this.responseBuffer, chunk]);
      try {
        this.drainResponses();
      } catch (error) {
        this.rejectPending(error);
        if (!worker.killed) worker.kill();
        if (this.worker === worker) this.worker = null;
      }
    });

    worker.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.logError("[SPCBoy] native helper", text);
    });

    worker.on("error", (error) => {
      this.rejectPending(error);
      if (this.worker === worker) this.worker = null;
    });

    worker.on("close", (code, signal) => {
      this.rejectPending(new Error(`native helper exited (${signal || code || 0})`));
      if (this.worker === worker) this.worker = null;
    });

    return worker;
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  drainResponses() {
    while (true) {
      const newlineIndex = this.responseBuffer.indexOf(0x0a);
      if (newlineIndex < 0) return;

      const header = this.responseBuffer.subarray(0, newlineIndex).toString("utf8");
      const parts = header.split("\t");
      if (parts[0] === "ERR") {
        this.responseBuffer = this.responseBuffer.subarray(newlineIndex + 1);
        const pending = this.pending.get(parts[1]);
        if (pending) {
          this.pending.delete(parts[1]);
          pending.reject(new Error(parts.slice(2).join("\t") || "native helper failed"));
        }
        continue;
      }

      if (parts[0] !== "OK" || parts.length < 4) {
        throw new Error(`invalid native helper response header: ${header}`);
      }

      const payloadLength = Number(parts[3]);
      if (!Number.isFinite(payloadLength) || payloadLength < 0) {
        throw new Error(`invalid native helper payload length: ${header}`);
      }

      const requiredLength = newlineIndex + 1 + payloadLength + 1;
      if (this.responseBuffer.length < requiredLength) return;
      if (this.responseBuffer[requiredLength - 1] !== 0x0a) {
        throw new Error("invalid native helper response terminator");
      }

      const requestId = parts[1];
      const payloadType = parts[2];
      const payload = this.responseBuffer.subarray(newlineIndex + 1, newlineIndex + 1 + payloadLength);
      this.responseBuffer = this.responseBuffer.subarray(requiredLength);

      const pending = this.pending.get(requestId);
      if (!pending) continue;
      this.pending.delete(requestId);
      pending.resolve(payloadType === "json" ? payload.toString("utf8") : Buffer.from(payload));
    }
  }
}

module.exports = { NativeHelperClient };
