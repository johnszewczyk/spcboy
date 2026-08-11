const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createNativeAudioTools } = require("../electron/native-audio-tools");

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

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
    backendForPath: () => ({ displayName: "SPC" }),
    supportsNativePlayback: () => true,
    NativeHelperClientClass: FakeNativeHelperClient,
    ...overrides
  });
}

test("native audio tools run one-shot inspection commands through one runner", async () => {
  const child = new FakeChild();
  const calls = [];
  const tools = createTools({
    spawnProcess: (program, args, options) => {
      calls.push({ program, args, options });
      return child;
    }
  });

  const inspection = tools.inspectFfprobe("/music/track.flac");
  assert.deepEqual(calls, [{
    program: "ffprobe",
    args: ["-v", "error", "-show_entries", "format=duration:format_tags=title,artist,album", "-of", "json", "/music/track.flac"],
    options: { stdio: ["ignore", "pipe", "pipe"] }
  }]);
  child.stdout.emit("data", Buffer.from('{"format":{"duration":"12.5","tags":{"TITLE":"Track","ARTIST":"Artist","ALBUM":"Game"}}}'));
  child.emit("close", 0);

  assert.deepEqual(await inspection, {
    system: "Audio",
    game: "Game",
    song: "Track",
    author: "Artist",
    play_length: 12500
  });
});

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
  assert.equal(client.options.helperPath, "/SPCBoy/native/libgme-tool");
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

test("native audio tools retain the native-session capability guard", async () => {
  const tools = createTools({
    backendForPath: () => ({ displayName: "OpenMPT" }),
    supportsNativePlayback: () => false
  });

  await assert.rejects(tools.loadNativePlayback("/music/track.xm", 0, 0, 0, 0), /OpenMPT does not use the native playback session/);
});
