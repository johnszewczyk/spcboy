const test = require("node:test");
const assert = require("node:assert/strict");
const { createNativeAudioTools } = require("../electron/native-audio-tools");

class FakeNativeHelperClient {
  constructor(options) {
    this.options = options;
    this.requests = [];
    this.terminated = false;
  }

  request(command, parts) {
    this.requests.push({ command, parts });
    return Promise.resolve(Buffer.from('{"ok":true}'));
  }

  state() {
    return Promise.resolve({ transport_state: "stopped" });
  }

  terminate() {
    this.terminated = true;
  }
}

function createTools(overrides = {}) {
  return createNativeAudioTools({
    getAppPath: () => "/SPCBoy",
    NativeHelperClientClass: FakeNativeHelperClient,
    ...overrides
  });
}

test("native audio tools centralize helper paths, playback commands, and termination", async () => {
  let client = null;
  class CapturingNativeHelperClient extends FakeNativeHelperClient {
    constructor(options) {
      super(options);
      client = this;
    }
  }
  const tools = createTools({ NativeHelperClientClass: CapturingNativeHelperClient });

  assert.deepEqual(await tools.loadNativePlayback("/music/track.spc", 2.4, 100.2, 200.7, 300.1, { numerator: 5, denominator: 4 }), { ok: true });
  assert.deepEqual(await tools.nativePlaybackState(), { transport_state: "stopped" });
  assert.equal(client.options.helperPath, "/SPCBoy/native/vgmboy-electron-bridge");
  assert.deepEqual(client.requests, [{
    command: "player-load",
    parts: ["/music/track.spc", "2", "100", "201", "300", "5", "4"]
  }]);

  assert.deepEqual(await tools.rampNativePlaybackGain(1.5, 4.6), { ok: true });
  assert.deepEqual(client.requests.at(-1), {
    command: "player-ramp-gain",
    parts: ["1", "5"]
  });
  assert.deepEqual(await tools.unloadNativePlayback(), { ok: true });
  assert.deepEqual(client.requests.at(-1), { command: "player-unload", parts: [] });

  tools.terminate();
  assert.equal(client.terminated, true);
});

test("VGMBoy is the only playback helper", async () => {
  const clients = [];
  class CapturingNativeHelperClient extends FakeNativeHelperClient {
    constructor(options) {
      super(options);
      clients.push(this);
    }
  }
  const tools = createTools({
    NativeHelperClientClass: CapturingNativeHelperClient
  });

  await tools.initializeNativePlayback();

  const playbackClient = clients.find((client) => client.options.helperPath.endsWith("vgmboy-electron-bridge"));
  assert.ok(playbackClient);
  assert.deepEqual(playbackClient.requests, [{ command: "player-init", parts: [] }]);
});

test("native audio tools send every admitted track to VGMBoy", async () => {
  const tools = createTools();
  await tools.loadNativePlayback("/music/track.xm", 0, 0, 0, 0);
  await tools.playbackStructure("/music/track.xm");
});
