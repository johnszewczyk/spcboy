const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { NativeHelperClient } = require("../electron/native-helper-client");

class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.writes = [];
    this.stdin = {
      write: (line, _encoding, callback) => {
        this.writes.push(line);
        callback(null);
      }
    };
  }

  kill() {
    this.killed = true;
    this.emit("close", 0, null);
  }
}

test("native helper client reconstructs framed responses and coalesces state requests", async () => {
  const worker = new FakeWorker();
  const client = new NativeHelperClient({
    helperPath: "/tmp/libgme-tool",
    spawnProcess: () => worker,
    logError: () => {}
  });

  const first = client.requestJson("player-init");
  const stateA = client.state();
  const stateB = client.state();
  assert.strictEqual(stateA, stateB);
  assert.deepEqual(worker.writes, ["1\tplayer-init\n", "2\tplayer-state\n"]);

  worker.stdout.emit("data", Buffer.from("OK\t1\tjson\t11\n{\"ok\":true}"));
  worker.stdout.emit("data", Buffer.from("\nOK\t2\tjson\t19\n{\"state\":\"stopped\"}\n"));

  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await stateA, { state: "stopped" });
  client.terminate();
  assert.equal(worker.killed, true);
});

test("native helper client rejects an error response for its matching command", async () => {
  const worker = new FakeWorker();
  const client = new NativeHelperClient({
    helperPath: "/tmp/libgme-tool",
    spawnProcess: () => worker,
    logError: () => {}
  });

  const request = client.request("player-load", ["missing.spc"]);
  worker.stdout.emit("data", Buffer.from("ERR\t1\tfailed to load native playback track\n"));
  await assert.rejects(request, /failed to load native playback track/);
  client.terminate();
});

test("native helper client rejects a malformed framed response without desynchronizing", async () => {
  const worker = new FakeWorker();
  const client = new NativeHelperClient({
    helperPath: "/tmp/libgme-tool",
    spawnProcess: () => worker,
    logError: () => {}
  });

  const request = client.request("player-state");
  worker.stdout.emit("data", Buffer.from("OK\t1\tjson\t2\n{}x"));
  await assert.rejects(request, /response terminator/);
  assert.equal(worker.killed, true);
});
