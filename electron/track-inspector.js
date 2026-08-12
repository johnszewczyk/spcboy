const fs = require("fs").promises;
const path = require("path");
const { backendForPath, routeForPath } = require("./playback-core");
const { detectSpecialWav } = require("./special-audio");
const { readSpcMetadata, readVgmMetadata, readPsfMetadata } = require("./scan-metadata-shortcuts");
const { BoundedMetadataCache, metadataFingerprint } = require("./metadata-cache");
const { createAsyncLimiter, withScanTimeout } = require("./scanner-scheduler");

const DEFAULT_CACHE_MAX_ENTRIES = 2048;

function formatPlaybackLength(totalSeconds) {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizePlaybackSeconds(lengthMs) {
  const numeric = Number(lengthMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(1, Math.round(numeric / 1000));
}

function trackVariantsFromNativeResult(trackPath, result) {
  const trackCount = Math.max(1, Number(result.track_count) || 1);
  return (Array.isArray(result.tracks) ? result.tracks : []).map((metadata, trackIndex) => {
    const playbackSeconds = normalizePlaybackSeconds(metadata.play_length);
    return {
      trackIndex,
      trackCount,
      inspection: {
        metadata: {
          song: metadata.song || path.basename(trackPath, path.extname(trackPath)),
          game: metadata.game || path.basename(path.dirname(trackPath)),
          author: metadata.author || "",
          system: metadata.system || ""
        },
        lengthLabel: playbackSeconds > 0 ? formatPlaybackLength(playbackSeconds) : "—",
        basePlaybackSeconds: playbackSeconds
      }
    };
  });
}

function createTrackInspector({ nativeAudio, cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES }) {
  if (!nativeAudio) throw new Error("Track inspector requires native audio tools");
  const metadataCache = new BoundedMetadataCache(cacheMaxEntries);
  const backendScanLimiters = new Map();

  async function inspectTrack(trackPath, sourceName = trackPath, { signal = null } = {}) {
    const cacheKey = `${trackPath}\u0000${sourceName}`;
    const cacheFingerprint = metadataFingerprint(await fs.stat(trackPath).catch(() => null));
    const cached = metadataCache.get(cacheKey, cacheFingerprint);
    if (cached) return cached;

    const extension = path.extname(trackPath).toLowerCase();
    const basename = path.basename(trackPath, extension);
    const parentName = path.basename(path.dirname(trackPath));
    const backend = backendForPath(trackPath);
    const specialAudio = extension === ".wav" ? await detectSpecialWav(trackPath, sourceName).catch(() => null) : null;
    const spcMetadata = extension === ".spc" ? await readSpcMetadata(trackPath) : null;
    const psfMetadata = [".psf", ".minipsf", ".psf2", ".minipsf2"].includes(extension) ? await readPsfMetadata(trackPath) : null;
    const vgmFastMetadata = backend?.id === "libvgm" ? await readVgmMetadata(trackPath) : null;
    const inspectionOptions = { signal };
    const gmeMetadata = backend?.id === "libgme" && !spcMetadata ? await nativeAudio.inspectGme(trackPath, inspectionOptions) : null;
    const vgmMetadata = backend?.id === "libvgm" && !vgmFastMetadata ? await nativeAudio.inspectLibVgm(trackPath, inspectionOptions) : null;
    const lazyUsfMetadata = backend?.id === "lazyusf" ? await nativeAudio.inspectLazyUsf(trackPath, inspectionOptions) : null;
    const highlyCompleteMetadata = backend?.id === "highlycomplete" ? await nativeAudio.inspectHighlyComplete(trackPath, inspectionOptions) : null;
    const openMptMetadata = backend?.id === "openmpt" ? await nativeAudio.inspectOpenMpt(trackPath, inspectionOptions) : null;
    const standardAudioMetadata = backend?.id === "standard-audio" && !specialAudio ? await nativeAudio.inspectFfprobe(trackPath, inspectionOptions) : null;
    const twoSFMetadata = backend?.id === "twosf" ? await nativeAudio.inspectTwoSF(trackPath, inspectionOptions) : null;
    const vgmstreamMetadata = specialAudio?.kind === "nds-swav"
      ? await nativeAudio.inspectNdsSwav(trackPath, inspectionOptions)
      : backend?.id === "vgmstream" ? await nativeAudio.inspectVgmstream(trackPath, inspectionOptions) : null;
    // PSF/PSF2 carries the scan metadata in its [TAG] footer. CocoaSpice uses
    // that shortcut before starting the Play! core; doing both here launched a
    // full PSX inspector for every otherwise-valid member in a JoshW archive.
    const playPsfMetadata = backend?.id === "playpsf" && !psfMetadata
      ? await nativeAudio.inspectPlayPsf(trackPath, inspectionOptions)
      : null;
    const rawPcmMetadata = specialAudio?.kind === "nds-raw-pcm22"
      ? { system: specialAudio.system, game: "", song: basename, author: "", play_length: Math.round(specialAudio.frameCount * 1000 / specialAudio.sampleRate) }
      : null;
    const basePlaybackSeconds = normalizePlaybackSeconds(spcMetadata?.play_length)
      || normalizePlaybackSeconds(vgmFastMetadata?.play_length)
      || normalizePlaybackSeconds(gmeMetadata?.play_length);
    const playbackSeconds = basePlaybackSeconds
      || normalizePlaybackSeconds(psfMetadata?.play_length)
      || normalizePlaybackSeconds(rawPcmMetadata?.play_length)
      || normalizePlaybackSeconds(vgmMetadata?.play_length)
      || normalizePlaybackSeconds(lazyUsfMetadata?.play_length)
      || normalizePlaybackSeconds(highlyCompleteMetadata?.play_length)
      || normalizePlaybackSeconds(openMptMetadata?.play_length)
      || normalizePlaybackSeconds(standardAudioMetadata?.play_length)
      || normalizePlaybackSeconds(twoSFMetadata?.play_length)
      || normalizePlaybackSeconds(vgmstreamMetadata?.play_length)
      || normalizePlaybackSeconds(playPsfMetadata?.play_length);
    const systemLabel = specialAudio?.system || rawPcmMetadata?.system || spcMetadata?.system || vgmFastMetadata?.system || gmeMetadata?.system || vgmMetadata?.system || lazyUsfMetadata?.system || highlyCompleteMetadata?.system || openMptMetadata?.system || standardAudioMetadata?.system || twoSFMetadata?.system || vgmstreamMetadata?.system || playPsfMetadata?.system || (extension === ".spc" ? "SNES" : "SEGA");
    const inspection = {
      metadata: {
        song: rawPcmMetadata?.song || spcMetadata?.title || psfMetadata?.title || vgmFastMetadata?.song || gmeMetadata?.song || vgmMetadata?.song || lazyUsfMetadata?.song || highlyCompleteMetadata?.song || openMptMetadata?.song || standardAudioMetadata?.song || twoSFMetadata?.song || vgmstreamMetadata?.song || playPsfMetadata?.song || basename,
        game: rawPcmMetadata?.game || spcMetadata?.game || psfMetadata?.game || vgmFastMetadata?.game || gmeMetadata?.game || vgmMetadata?.game || lazyUsfMetadata?.game || highlyCompleteMetadata?.game || openMptMetadata?.game || standardAudioMetadata?.game || twoSFMetadata?.game || vgmstreamMetadata?.game || playPsfMetadata?.game || parentName,
        author: rawPcmMetadata?.author || spcMetadata?.artist || psfMetadata?.artist || vgmFastMetadata?.author || gmeMetadata?.author || vgmMetadata?.author || lazyUsfMetadata?.author || highlyCompleteMetadata?.author || openMptMetadata?.author || standardAudioMetadata?.author || twoSFMetadata?.author || vgmstreamMetadata?.author || playPsfMetadata?.author || "",
        system: specialAudio?.system || rawPcmMetadata?.system || psfMetadata?.system || gmeMetadata?.system || lazyUsfMetadata?.system || highlyCompleteMetadata?.system || standardAudioMetadata?.system || twoSFMetadata?.system || vgmstreamMetadata?.system || playPsfMetadata?.system || systemLabel
      },
      lengthLabel: playbackSeconds > 0 ? formatPlaybackLength(playbackSeconds) : "—",
      basePlaybackSeconds: playbackSeconds,
      specialAudioKind: specialAudio?.kind || null
    };
    metadataCache.set(cacheKey, cacheFingerprint, inspection);
    return inspection;
  }

  async function inspectTrackVariants(trackPath, sourceName = trackPath, options = {}) {
    const backend = backendForPath(trackPath);
    if (path.extname(trackPath).toLowerCase() === ".spc") {
      const inspection = await inspectTrack(trackPath, sourceName, options);
      return [{ trackIndex: 0, trackCount: 1, inspection }];
    }
    if (backend?.id !== "libgme") {
      if (backend?.id === "vgmstream") return trackVariantsFromNativeResult(trackPath, await nativeAudio.inspectAll(trackPath, options));
      const inspection = await inspectTrack(trackPath, sourceName, options);
      return [{ trackIndex: 0, trackCount: 1, inspection }];
    }
    return trackVariantsFromNativeResult(trackPath, await nativeAudio.inspectAll(trackPath, options));
  }

  async function inspectTrackVariantsForScan(trackPath, sourceName = trackPath, { signal = null } = {}) {
    const route = routeForPath(sourceName) || routeForPath(trackPath);
    if (!route) return inspectTrackVariants(trackPath, sourceName, { signal });
    if (path.extname(sourceName).toLowerCase() === ".ss2") {
      const handle = await fs.open(trackPath, "r");
      try {
        const header = Buffer.alloc(4);
        const result = await handle.read(header, 0, header.length, 0);
        if (result.bytesRead < header.length || header.toString("ascii") !== "SShd") {
          const error = new Error("Headerless SS2 resource; standalone playback requires missing stream parameters.");
          error.scanState = "unsupported";
          throw error;
        }
      } finally {
        await handle.close();
      }
    }
    let limiter = backendScanLimiters.get(route.backendId);
    if (!limiter) {
      limiter = createAsyncLimiter(route.scanConcurrency);
      backendScanLimiters.set(route.backendId, limiter);
    }
    return limiter(() => withScanTimeout(
      (deadlineSignal) => inspectTrackVariants(trackPath, sourceName, { signal: deadlineSignal }),
      route.scanTimeoutSeconds * 1000,
      `${route.backendId} metadata inspection for ${sourceName}`,
      { signal }
    ));
  }

  return { inspectTrack, inspectTrackVariants, inspectTrackVariantsForScan };
}

module.exports = { DEFAULT_CACHE_MAX_ENTRIES, createTrackInspector, formatPlaybackLength, normalizePlaybackSeconds };
