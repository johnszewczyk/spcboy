const test = require("node:test");
const assert = require("node:assert/strict");
const { runMediaScanner, validateEvent } = require("../electron/media-scanner-client");

test("validates the shared Swift scanner protocol before accepting events", () => {
  assert.deepEqual(validateEvent({
    contract: "media-scanner-jsonl",
    version: 1,
    kind: "sessionStarted",
    sequence: 0
  }), {
    contract: "media-scanner-jsonl",
    version: 1,
    kind: "sessionStarted",
    sequence: 0
  });
  assert.throws(() => validateEvent({ contract: "other", version: 1, kind: "sessionStarted", sequence: 0 }), /contract mismatch/);
  assert.throws(() => validateEvent({ contract: "media-scanner-jsonl", version: 2, kind: "sessionStarted", sequence: 0 }), /version mismatch/);
});

test("streams validated JSONL events from the Swift scanner process boundary", async () => {
  const script = [
    "const event={contract:'media-scanner-jsonl',version:1,kind:'sessionStarted',sequence:0};",
    "process.stdout.write(JSON.stringify(event)+'\\n');"
  ].join("");
  const observed = [];
  const events = await runMediaScanner({
    executablePath: process.execPath,
    command: "-e",
    args: [script],
    onEvent: (event) => observed.push(event)
  });
  assert.equal(events.length, 1);
  assert.deepEqual(observed, events);
});

test("rejects missing or reordered scanner events", async () => {
  const script = [
    "const event={contract:'media-scanner-jsonl',version:1,kind:'sessionStarted',sequence:1};",
    "process.stdout.write(JSON.stringify(event)+'\\n');"
  ].join("");
  await assert.rejects(runMediaScanner({
    executablePath: process.execPath,
    command: "-e",
    args: [script]
  }), /sequence mismatch/);
});

test("terminates the scanner subprocess when its host operation is cancelled", async () => {
  const controller = new AbortController();
  const scan = runMediaScanner({
    executablePath: process.execPath,
    command: "-e",
    args: ["setInterval(()=>{},1000)"],
    signal: controller.signal
  });
  controller.abort(new Error("cancelled by test"));
  await assert.rejects(scan, /cancelled by test/);
});

test("force-kills a scanner subprocess that ignores graceful cancellation", async () => {
  const controller = new AbortController();
  const scan = runMediaScanner({
    executablePath: process.execPath,
    command: "-e",
    args: ["process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    signal: controller.signal,
    terminationGraceMs: 20
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort(new Error("forced cancellation"));
  await assert.rejects(scan, /forced cancellation/);
});
