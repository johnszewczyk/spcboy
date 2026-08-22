const path = require("path");
const { NativeHelperClient } = require("./native-helper-client");

const VGMBoy_ELECTRON_BRIDGE_NAME = "vgmboy-electron-bridge";

// This is intentionally only a typed command client. It contains no decoder,
// inspection, PCM, or format-specific fallback path.
function createNativeAudioTools({ getAppPath, spawnProcess, NativeHelperClientClass = NativeHelperClient }) {
  if (typeof getAppPath !== "function") throw new Error("getAppPath is required");
  let client = null;

  function ensureClient() {
    if (!client) {
      client = new NativeHelperClientClass({
        helperPath: path.join(getAppPath(), "native", VGMBoy_ELECTRON_BRIDGE_NAME),
        spawnProcess
      });
    }
    return client;
  }

  function requestJSON(command, parts = []) {
    return ensureClient().request(command, parts).then((value) => JSON.parse(String(value || "")));
  }

  function trackArguments(trackPath, trackIndex, startMs, playMs, fadeMs, speed = {}) {
    const numerator = Math.max(1, Math.min(1_000_000, Math.round(Number(speed?.numerator) || 1)));
    const denominator = Math.max(1, Math.min(1_000_000, Math.round(Number(speed?.denominator) || 1)));
    return [
      trackPath,
      String(Math.max(0, Math.round(trackIndex))),
      String(Math.max(0, Math.round(startMs))),
      String(Math.max(0, Math.round(playMs))),
      String(Math.max(0, Math.round(fadeMs))),
      String(numerator),
      String(denominator)
    ];
  }

  return {
    terminate: () => { client?.terminate(); client = null; },
    playbackStructure: (trackPath) => requestJSON("player-structure", [trackPath]),
    initializeNativePlayback: () => requestJSON("player-init"),
    loadNativePlayback: (trackPath, trackIndex, startMs, playMs, fadeMs, speed) =>
      requestJSON("player-load", trackArguments(trackPath, trackIndex, startMs, playMs, fadeMs, speed)),
    playNativePlayback: () => requestJSON("player-play"),
    pauseNativePlayback: () => requestJSON("player-pause"),
    stopNativePlayback: () => requestJSON("player-stop"),
    unloadNativePlayback: () => requestJSON("player-unload"),
    rampNativePlaybackGain: (gain, durationMs) => requestJSON("player-ramp-gain", [
      String(Math.max(0, Math.min(1, Number(gain) || 0))),
      String(Math.max(1, Math.round(Number(durationMs) || 1)))
    ]),
    seekNativePlayback: (startMs) => requestJSON("player-seek", [String(Math.max(0, Math.round(startMs)))]),
    nativePlaybackState: () => ensureClient().state(),
    configureNativePlaybackAudio: (volume, equalizerEnabled, bandGains) => requestJSON("player-audio-config", [
      String(Math.max(0, Math.min(1, Number(volume) || 0))),
      equalizerEnabled ? "1" : "0",
      ...Array.from({ length: 10 }, (_, index) => String(Math.max(-12, Math.min(12, Number(bandGains?.[index]) || 0))))
    ]),
    closeNativePlayback: () => ensureClient().request("player-close", [])
  };
}

module.exports = { VGMBoy_ELECTRON_BRIDGE_NAME, createNativeAudioTools };
