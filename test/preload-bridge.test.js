const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("sandboxed preload receives the backend registry over IPC before exposing the renderer bridge", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
  const registry = [{
    id: "libgme",
    displayName: "libgme",
    playbackMode: "native-session",
    playbackSpeedMode: "native-tempo",
    playbackSpeedExtensions: [".spc"],
    extensions: [".spc"]
  }];
  let exposed = null;
  const ipcRenderer = {
    sendSync(channel) {
      assert.equal(channel, "app:playback-backends");
      return registry;
    },
    invoke() { return Promise.resolve(); },
    send() {},
    on() {},
    removeAllListeners() {}
  };
  vm.runInNewContext(source, {
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: { exposeInMainWorld(_name, value) { exposed = value; } },
        ipcRenderer
      };
    },
    process: { argv: [] }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(exposed.playbackBackends)), registry);
  assert.equal(typeof exposed.bootstrap, "function");
  assert.equal(typeof exposed.databaseSearchBrowser, "function");
  assert.equal(typeof exposed.configureConsoleTagPreference, "function");
  assert.equal(typeof exposed.onLibraryOperationState, "function");
});
