const fs = require("fs").promises;
const path = require("path");
const { BoundedMetadataCache, metadataFingerprint } = require("./metadata-cache");

const DEFAULT_CACHE_MAX_ENTRIES = 2048;

function formatPlaybackLength(totalSeconds) {
  const rounded = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function normalizePlaybackSeconds(lengthMs) {
  const numeric = Number(lengthMs);
  return Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.round(numeric / 1000)) : 0;
}

// Raw disk browsing is deliberately structural only. MediaScanner-authored
// rows remain the metadata authority; VGMBoy is never started for catalogue
// hydration or a frontend decoder fallback.
function createTrackInspector({ nativeAudio, cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES } = {}) {
  if (!nativeAudio?.playbackStructure) throw new Error("Track inspector requires the VGMBoy bridge client");
  const metadataCache = new BoundedMetadataCache(cacheMaxEntries);

  async function inspectTrack(trackPath, sourceName = trackPath) {
    const cacheKey = `${trackPath}\u0000${sourceName}`;
    const fingerprint = metadataFingerprint(await fs.stat(trackPath).catch(() => null));
    const cached = metadataCache.get(cacheKey, fingerprint);
    if (cached) return cached;

    const sourcePath = String(sourceName || trackPath);
    const extension = path.extname(sourcePath);
    const inspection = {
      metadata: {
        song: path.basename(sourcePath, extension),
        game: path.basename(path.dirname(sourcePath)),
        author: "",
        system: ""
      },
      lengthLabel: "—",
      basePlaybackSeconds: 0,
      metadataSource: "pathname"
    };
    metadataCache.set(cacheKey, fingerprint, inspection);
    return inspection;
  }

  async function inspectTrackVariants(trackPath, sourceName = trackPath) {
    const structure = await nativeAudio.playbackStructure(trackPath);
    const trackCount = Math.max(1, Number(structure?.trackCount) || 1);
    const timingByIndex = new Map((structure?.tracks || []).map((track) => [Number(track.index) || 0, track]));
    const inspection = await inspectTrack(trackPath, sourceName);
    return Array.from({ length: trackCount }, (_, trackIndex) => {
      const timing = timingByIndex.get(trackIndex);
      const playbackSeconds = normalizePlaybackSeconds(timing?.naturalPlayMilliseconds);
      return {
        trackIndex,
        trackCount,
        inspection: {
          ...inspection,
          lengthLabel: playbackSeconds > 0 ? formatPlaybackLength(playbackSeconds) : inspection.lengthLabel,
          basePlaybackSeconds: playbackSeconds
        }
      };
    });
  }

  return { inspectTrack, inspectTrackVariants, inspectTrackVariantsForPlaylist: inspectTrackVariants };
}

module.exports = { DEFAULT_CACHE_MAX_ENTRIES, createTrackInspector, formatPlaybackLength, normalizePlaybackSeconds };
