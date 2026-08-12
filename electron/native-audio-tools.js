const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { NativeHelperClient } = require("./native-helper-client");

const LIBGME_HELPER_NAME = "libgme-tool";
const LIBVGM_HELPER_NAME = "libvgm-tool";
const LAZYUSF_HELPER_NAME = "lazyusf-tool";
const FFMPEG_BINARY = process.env.SPCBOY_FFMPEG || "ffmpeg";
const FFPROBE_BINARY = process.env.SPCBOY_FFPROBE || "ffprobe";
const OPENMPT_BINARY = process.env.SPCBOY_OPENMPT123 || "openmpt123";

function createNativeAudioTools({
  getAppPath,
  backendForPath,
  supportsNativePlayback,
  spawnProcess = spawn,
  NativeHelperClientClass = NativeHelperClient
}) {
  if (typeof getAppPath !== "function") throw new Error("getAppPath is required");
  if (typeof backendForPath !== "function") throw new Error("backendForPath is required");
  if (typeof supportsNativePlayback !== "function") throw new Error("supportsNativePlayback is required");

  let nativeHelperClient = null;

  function helperPath(name) {
    return path.join(getAppPath(), "native", name);
  }

  function libGmeHelperPath() {
    return helperPath(LIBGME_HELPER_NAME);
  }

  function ensureNativeHelperClient() {
    if (!nativeHelperClient) {
      nativeHelperClient = new NativeHelperClientClass({
        helperPath: libGmeHelperPath(),
        spawnProcess
      });
    }
    return nativeHelperClient;
  }

  function terminate() {
    nativeHelperClient?.terminate();
    nativeHelperClient = null;
  }

  async function runCommand(program, args, label, { encoding = null, signal = null } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`));
        return;
      }
      const child = spawnProcess(program, args, { stdio: ["ignore", "pipe", "pipe"] });
      const stdoutChunks = [];
      const stderrChunks = [];
      let settled = false;
      let abortError = null;
      let forceKillTimer = null;
      const cleanup = () => {
        if (forceKillTimer) clearTimeout(forceKillTimer);
        signal?.removeEventListener("abort", abort);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const abort = () => {
        if (settled || abortError) return;
        abortError = signal?.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`);
        if (!child.killed) child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 1_000);
        forceKillTimer.unref?.();
      };

      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
      child.on("error", fail);
      child.on("close", (code) => {
        if (abortError) {
          fail(abortError);
          return;
        }
        if (code !== 0) {
          fail(new Error(Buffer.concat(stderrChunks).toString("utf8").trim() || `${label} exited with code ${code}`));
          return;
        }
        const stdout = Buffer.concat(stdoutChunks);
        finish(encoding ? stdout.toString(encoding) : stdout);
      });
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  function runLibGmeTool(args, options) {
    return runCommand(libGmeHelperPath(), args, "libgme helper", options);
  }

  function runLibVgmTool(args, options) {
    return runCommand(helperPath(LIBVGM_HELPER_NAME), args, "libvgm helper", options);
  }

  function runLazyUsfTool(args, options) {
    return runCommand(helperPath(LAZYUSF_HELPER_NAME), args, "lazyusf helper", options);
  }

  async function request(command, parts) {
    return ensureNativeHelperClient().request(command, parts);
  }

  async function requestJson(command, parts = []) {
    return JSON.parse(String(await request(command, parts) || ""));
  }

  function trackArguments(trackPath, trackIndex, startMs, playMs, fadeMs) {
    return [
      trackPath,
      String(Math.max(0, Math.round(trackIndex))),
      String(Math.max(0, Math.round(startMs))),
      String(Math.max(0, Math.round(playMs))),
      String(Math.max(0, Math.round(fadeMs)))
    ];
  }

  function nativePlaybackTrackArguments(trackPath, trackIndex, startMs, playMs, fadeMs, speed = {}) {
    const numerator = Math.max(1, Math.min(1_000_000, Math.round(Number(speed?.numerator) || 1)));
    const denominator = Math.max(1, Math.min(1_000_000, Math.round(Number(speed?.denominator) || 1)));
    return [...trackArguments(trackPath, trackIndex, startMs, playMs, fadeMs), String(numerator), String(denominator)];
  }

  async function withNdsSwavAlias(filePath, work) {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-nds-swav-"));
    const aliasPath = path.join(temporaryRoot, "track.adpcm");
    try {
      try {
        await fs.link(filePath, aliasPath);
      } catch {
        await fs.copyFile(filePath, aliasPath);
      }
      return await work(aliasPath);
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async function inspectWithGme(trackPath, { signal = null } = {}) {
    return JSON.parse(await runLibGmeTool(["inspect", trackPath], { encoding: "utf8", signal }));
  }

  async function inspectWithLibVgm(trackPath, { signal = null } = {}) {
    return JSON.parse(await runLibVgmTool(["inspect", trackPath], { encoding: "utf8", signal }));
  }

  function parseOpenMptDuration(value) {
    const match = String(value || "").trim().match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
    if (!match) return 0;
    const fraction = Number(`0.${match[3] || "0"}`);
    return (Number(match[1]) * 60 + Number(match[2]) + fraction) * 1000;
  }

  function openMptInfoValue(text, label) {
    const expression = new RegExp(`^${label}\\.*:\\s*(.*)$`, "mi");
    return expression.exec(text)?.[1]?.trim() || "";
  }

  async function inspectWithOpenMpt(trackPath, { signal = null } = {}) {
    const stdout = await runCommand(OPENMPT_BINARY, ["--info", "--", trackPath], "openmpt123", { encoding: "utf8", signal });
    return {
      system: "Module",
      game: "",
      song: openMptInfoValue(stdout, "Title") || path.basename(trackPath, path.extname(trackPath)),
      author: openMptInfoValue(stdout, "Artist"),
      play_length: Math.round(parseOpenMptDuration(openMptInfoValue(stdout, "Duration")))
    };
  }

  function ffprobeTag(tags, name) {
    const key = Object.keys(tags || {}).find((candidate) => candidate.toLowerCase() === name);
    return key ? String(tags[key] || "").trim() : "";
  }

  async function inspectWithFfprobe(trackPath, { signal = null } = {}) {
    const stdout = await runCommand(FFPROBE_BINARY, [
      "-v", "error",
      "-show_entries", "format=duration:format_tags=title,artist,album",
      "-of", "json",
      trackPath
    ], "ffprobe", { encoding: "utf8", signal });
    const format = JSON.parse(stdout).format || {};
    const tags = format.tags || {};
    const duration = Number(format.duration);
    return {
      system: "Audio",
      game: ffprobeTag(tags, "album"),
      song: ffprobeTag(tags, "title") || path.basename(trackPath, path.extname(trackPath)),
      author: ffprobeTag(tags, "artist"),
      play_length: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0
    };
  }

  async function inspectNdsSwav(trackPath, options = {}) {
    return withNdsSwavAlias(trackPath, (aliasPath) => inspectWithGme(aliasPath, options));
  }

  async function decodeGme(trackPath, trackIndex, startMs, playMs, fadeMs) {
    return request("decode-raw", trackArguments(trackPath, trackIndex, startMs, playMs, fadeMs));
  }

  function decodeFfmpeg(trackPath, startMs, playMs) {
    return runCommand(FFMPEG_BINARY, [
      "-v", "error",
      "-i", trackPath,
      "-ss", String(Math.max(0, Number(startMs) || 0) / 1000),
      "-t", String(Math.max(1, Number(playMs) || 1) / 1000),
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", "44100",
      "-ac", "2",
      "pipe:1"
    ], "ffmpeg");
  }

  function decodeNdsRawPcm22(trackPath, startMs, playMs) {
    return runCommand(FFMPEG_BINARY, [
      "-v", "error",
      "-f", "s8",
      "-ar", "22050",
      "-ac", "1",
      "-i", trackPath,
      "-ss", String(Math.max(0, Number(startMs) || 0) / 1000),
      "-t", String(Math.max(1, Number(playMs) || 1) / 1000),
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", "44100",
      "-ac", "2",
      "pipe:1"
    ], "ffmpeg");
  }

  function decodeNdsSwav(trackPath, trackIndex, startMs, playMs, fadeMs) {
    return withNdsSwavAlias(trackPath, (aliasPath) => decodeGme(aliasPath, trackIndex, startMs, playMs, fadeMs));
  }

  function decodeOpenMpt(trackPath, startMs, playMs) {
    const startSeconds = Math.max(0, Number(startMs) || 0) / 1000;
    const durationSeconds = Math.max(1, Number(playMs) || 1) / 1000;
    return runCommand(OPENMPT_BINARY, [
      "--quiet", "--batch", "--samplerate", "44100", "--channels", "2", "--no-float",
      "--seek", String(startSeconds),
      "--end-time", String(startSeconds + durationSeconds),
      "--stdout", "--", trackPath
    ], "openmpt123");
  }

  function assertNativePlaybackPath(trackPath) {
    if (supportsNativePlayback(trackPath)) return;
    const backend = backendForPath(trackPath);
    throw new Error(`${backend?.displayName || "This format"} does not use the native playback session yet.`);
  }

  return {
    terminate,
    inspectAll: async (trackPath, { signal = null } = {}) => JSON.parse(await runLibGmeTool(["inspect-all", trackPath], { encoding: "utf8", signal })),
    inspectGme: inspectWithGme,
    inspectLibVgm: inspectWithLibVgm,
    inspectLazyUsf: async (trackPath, { signal = null } = {}) => JSON.parse(await runLazyUsfTool(["inspect", trackPath], { encoding: "utf8", signal })),
    inspectHighlyComplete: inspectWithGme,
    inspectOpenMpt: inspectWithOpenMpt,
    inspectFfprobe: inspectWithFfprobe,
    inspectTwoSF: inspectWithGme,
    inspectVgmstream: inspectWithGme,
    inspectNdsSwav,
    inspectPlayPsf: inspectWithGme,
    decodeGme,
    decodeLibVgm: (trackPath, startMs, playMs, fadeMs) => runLibVgmTool([
      "decode-raw", trackPath, String(Math.max(0, Math.round(startMs))), String(Math.max(1, Math.round(playMs))), String(Math.max(0, Math.round(fadeMs)))
    ]),
    decodeLazyUsf: (trackPath, startMs, playMs) => runLazyUsfTool([
      "decode-raw", trackPath, String(Math.max(0, Math.round(startMs))), String(Math.max(1, Math.round(playMs)))
    ]),
    decodeFfmpeg,
    decodeNdsRawPcm22,
    decodeNdsSwav,
    decodeOpenMpt,
    openSession: (trackPath, trackIndex, startMs, playMs, fadeMs) => request("session-open", trackArguments(trackPath, trackIndex, startMs, playMs, fadeMs)),
    readSession: (frameCount) => request("session-read", [String(Math.max(1, Math.round(frameCount)))]),
    closeSession: () => request("session-close", []),
    initializeNativePlayback: () => requestJson("player-init"),
    loadNativePlayback: async (trackPath, trackIndex, startMs, playMs, fadeMs, speed) => {
      assertNativePlaybackPath(trackPath);
      return requestJson("player-load", nativePlaybackTrackArguments(trackPath, trackIndex, startMs, playMs, fadeMs, speed));
    },
    playNativePlayback: () => requestJson("player-play"),
    pauseNativePlayback: () => requestJson("player-pause"),
    stopNativePlayback: () => requestJson("player-stop"),
    unloadNativePlayback: () => requestJson("player-unload"),
    rampNativePlaybackGain: (gain, durationMs) => requestJson("player-ramp-gain", [
      String(Math.max(0, Math.min(1, Number(gain) || 0))),
      String(Math.max(1, Math.round(Number(durationMs) || 1)))
    ]),
    seekNativePlayback: (startMs) => requestJson("player-seek", [String(Math.max(0, Math.round(startMs)))]),
    nativePlaybackState: () => ensureNativeHelperClient().state(),
    configureNativePlaybackAudio: (volume, equalizerEnabled, bandGains) => requestJson("player-audio-config", [
      String(Math.max(0, Math.min(1, Number(volume) || 0))),
      equalizerEnabled ? "1" : "0",
      ...Array.from({ length: 10 }, (_, index) => String(Math.max(-12, Math.min(12, Number(bandGains?.[index]) || 0))))
    ]),
    closeNativePlayback: () => request("player-close", [])
  };
}

module.exports = { createNativeAudioTools };
