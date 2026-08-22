const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  BACKEND_MODULES,
  createBackendCandidateIndex,
  backendCandidatesForPath,
  backendForPath,
  routeForPath,
  routeForArchiveEntry,
  routingConflicts,
  playbackModeForPath,
  playbackSpeedModeForPath,
  supportsNativePlayback,
  supportsPlaybackSpeed,
  supportsPath
} = require("../electron/playback-core");

test("registers every supported backend format", () => {
  for (const backend of BACKEND_MODULES) {
    for (const extension of backend.extensions) {
      assert.equal(supportsPath(`track${extension}`), true, `${backend.id}:${extension}`);
    }
  }
});

test("routes USF-family files to lazyusf2", () => {
  assert.equal(backendForPath("track.usf").id, "lazyusf");
  assert.equal(backendForPath("track.miniusf").id, "lazyusf");
  assert.equal(backendForPath("track.psf").id, "playpsf");
  assert.equal(backendForPath("track.minipsf2").id, "playpsf");
});

test("routes PlayStation 2, PSP, and PlayStation 3 streamed formats to vgmstream", () => {
  for (const extension of [".adp", ".at3", ".bika", ".msf", ".ss2", ".svag", ".xmd", ".xvag"]) {
    assert.equal(backendForPath(`track${extension}`).id, "vgmstream", extension);
    assert.equal(supportsNativePlayback(`track${extension}`), true, extension);
  }
});

test("routes each registered PlayStation streamed extension through the bundled VGMBoy bridge", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "native-audio-tools.js"), "utf8");
  const vgmstream = BACKEND_MODULES.find((backend) => backend.id === "vgmstream");
  for (const extension of vgmstream.extensions) {
    assert.equal(supportsNativePlayback(`track${extension}`), true, extension);
  }
  assert.match(source, /VGMBoy_ELECTRON_BRIDGE_NAME/);
  assert.doesNotMatch(source, /decode-raw|session-open|ffmpeg/);
});

test("routes VGMBoy-covered modules and standard audio to the native session", () => {
  assert.equal(backendForPath("track.xm").id, "openmpt");
  assert.equal(backendForPath("track.flac").id, "standard-audio");
  assert.equal(backendForPath("track.aac").id, "standard-audio");
  assert.equal(backendForPath("track.mp2").id, "standard-audio");
  assert.equal(backendForPath("track.tak").id, "standard-audio");
  assert.equal(playbackModeForPath("track.xm"), "native-session");
  assert.equal(playbackModeForPath("track.wav"), "native-session");
  assert.equal(playbackModeForPath("track.tak"), "native-session");
});

test("declares one playback mode for every registered backend", () => {
  for (const backend of BACKEND_MODULES) {
    assert.equal(backend.playbackMode, "native-session", backend.id);
    for (const extension of backend.extensions) {
      assert.equal(playbackModeForPath(`track${extension}`), backend.playbackMode, extension);
    }
  }
});

test("native-session routing covers every active decoder", () => {
  assert.equal(supportsNativePlayback("track.spc"), true);
  assert.equal(supportsNativePlayback("track.miniusf"), true);
  assert.equal(supportsNativePlayback("track.vgm"), true);
  assert.equal(supportsNativePlayback("track.minigsf"), true);
  assert.equal(supportsNativePlayback("track.mini2sf"), true);
  assert.equal(supportsNativePlayback("track.xa"), true);
  assert.equal(supportsNativePlayback("track.zip"), false);
});

test("declares native tempo for libgme and libvgm routes, not vgmstream", () => {
  assert.equal(playbackSpeedModeForPath("track.spc"), "native-tempo");
  assert.equal(supportsPlaybackSpeed("track.spc"), true);
  assert.equal(supportsPlaybackSpeed("track.nsf"), true);
  assert.equal(supportsPlaybackSpeed("track.gbs"), true);
  assert.equal(supportsPlaybackSpeed("track.vgm"), true);
  assert.equal(supportsPlaybackSpeed("track.gym"), true);
  assert.equal(supportsPlaybackSpeed("track.xa"), false);
});

test("keeps archive containers outside decoder routing", () => {
  assert.equal(backendForPath("library.zip"), null);
  assert.equal(BACKEND_MODULES.length, 9);
});

test("keeps every backend candidate instead of silently overwriting an overlapping extension", () => {
  const first = { id: "first", extensions: [".demo"] };
  const second = { id: "second", extensions: [".demo"] };
  const candidates = createBackendCandidateIndex([first, second]);

  assert.deepEqual(candidates.get(".demo"), [first, second]);
  assert.equal(backendCandidatesForPath("track.spc")[0].id, "libgme");
  assert.deepEqual(routingConflicts(), []);
});

test("exposes playlist inspection policies from the playback registry", () => {
  const usfRoute = routeForArchiveEntry("music/02 Title Theme.miniusf");
  assert.deepEqual({
    backendId: usfRoute.backendId,
    extension: usfRoute.extension,
    archiveMember: usfRoute.archiveMember,
    archivePolicy: usfRoute.archivePolicy
  }, {
    backendId: "lazyusf",
    extension: ".miniusf",
    archiveMember: true,
    archivePolicy: "dependency-set"
  });

  const wavRoute = routeForPath("capture.wav");
  assert.equal(wavRoute.backendId, "standard-audio");
  assert.equal(wavRoute.archivePolicy, "selected-entry");
  assert.equal(routeForPath("library.zip"), null);
});

test("renderer playback scheduling consumes the preload registry without a duplicate format table", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "web", "playback-backends.js"), "utf8");
  const window = {
    spcBoy: {
      playbackBackends: BACKEND_MODULES.map((backend) => ({
        id: backend.id,
        playbackMode: backend.playbackMode,
        playbackSpeedMode: backend.playbackSpeedMode || null,
        playbackSpeedExtensions: [...(backend.playbackSpeedExtensions || [])],
        extensions: [...backend.extensions]
      }))
    }
  };
  vm.runInNewContext(source, { window });

  assert.equal(window.SPCBoyPlaybackBackends.forPath("archive/track.vgz").id, "libvgm");
  assert.equal(window.SPCBoyPlaybackBackends.forPath("archive/track.xm").playbackMode, "native-session");
  assert.deepEqual(JSON.parse(JSON.stringify(window.SPCBoyPlaybackBackends.conflicts)), []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.SPCBoyPlaybackBackends.all)),
    JSON.parse(JSON.stringify(window.spcBoy.playbackBackends))
  );

  const overlapWindow = {
    spcBoy: {
      playbackBackends: [
        { id: "first", displayName: "First", extensions: [".route"] },
        { id: "second", displayName: "Second", extensions: [".route"] }
      ]
    }
  };
  vm.runInNewContext(source, { window: overlapWindow });
  assert.deepEqual(
    JSON.parse(JSON.stringify(overlapWindow.SPCBoyPlaybackBackends.candidatesForPath("track.route").map((backend) => backend.id))),
    ["first", "second"]
  );
  assert.equal(overlapWindow.SPCBoyPlaybackBackends.forPath("track.route").id, "first");
  assert.equal(overlapWindow.SPCBoyPlaybackBackends.conflicts[0].extension, ".route");
});
