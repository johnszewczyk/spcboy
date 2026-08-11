// Test support only: this intentionally drives the production scanner through
// its public service boundary without touching a user's library database.
const path = require("path");
const { scanLibraryRoot, DEFAULT_SCAN_CONCURRENCY } = require("../electron/library-scan-service");
const { backendForPath } = require("../electron/playback-core");

const PCM_PROBE_CHUNK_MS = 375;
const PCM_PROBE_CHUNK_COUNT = 2;

function hasAudiblePcm(pcm) {
  const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    if (bytes.readInt16LE(offset) !== 0) return true;
  }
  return false;
}

async function decodeProbeChunk(nativeAudio, { filePath, sourceName, route, trackIndex, specialAudioKind, startMs, durationMs }) {
  const backendId = route?.backendId || backendForPath(sourceName)?.id || backendForPath(filePath)?.id;
  if (backendId === "libgme" || backendId === "highlycomplete" || backendId === "twosf" || backendId === "vgmstream" || backendId === "playpsf") {
    return nativeAudio.decodeGme(filePath, trackIndex, startMs, durationMs, 0);
  }
  if (backendId === "libvgm") return nativeAudio.decodeLibVgm(filePath, startMs, durationMs, 0);
  if (backendId === "lazyusf") return nativeAudio.decodeLazyUsf(filePath, startMs, durationMs);
  if (backendId === "openmpt") return nativeAudio.decodeOpenMpt(filePath, startMs, durationMs);
  if (backendId === "standard-audio") {
    if (specialAudioKind === "nds-raw-pcm22") return nativeAudio.decodeNdsRawPcm22(filePath, startMs, durationMs);
    if (specialAudioKind === "nds-swav") return nativeAudio.decodeNdsSwav(filePath, trackIndex, startMs, durationMs, 0);
    return nativeAudio.decodeFfmpeg(filePath, startMs, durationMs);
  }
  throw new Error(`No PCM probe decoder is declared for ${route?.displayName || path.extname(sourceName) || "this format"}`);
}

function createCompatibilityPcmProbe({ nativeAudio, chunkDurationMs = PCM_PROBE_CHUNK_MS, chunkCount = PCM_PROBE_CHUNK_COUNT } = {}) {
  if (!nativeAudio) throw new Error("Compatibility PCM probe requires native audio tools");
  const durationMs = Math.max(1, Math.round(Number(chunkDurationMs) || PCM_PROBE_CHUNK_MS));
  const chunks = Math.max(2, Math.round(Number(chunkCount) || PCM_PROBE_CHUNK_COUNT));

  return async function probePlayback({ path: filePath, sourceName = filePath, route, trackIndex = 0, specialAudioKind = null }) {
    let totalBytes = 0;
    let audibleChunks = 0;
    for (let index = 0; index < chunks; index += 1) {
      const pcm = await decodeProbeChunk(nativeAudio, {
        filePath,
        sourceName,
        route,
        trackIndex,
        specialAudioKind,
        startMs: index * durationMs,
        durationMs
      });
      const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
      if (bytes.length === 0) throw new Error(`PCM probe returned no audio in chunk ${index + 1} of ${chunks}`);
      totalBytes += bytes.length;
      if (hasAudiblePcm(bytes)) audibleChunks += 1;
    }
    if (audibleChunks === 0) throw new Error(`PCM probe returned only silence across ${chunks} chunks`);
    return Object.freeze({ chunkCount: chunks, chunkDurationMs: durationMs, totalBytes, audibleChunks });
  };
}

function createCompatibilityScanDatabase() {
  let nextRootId = 1;
  const rootsByPath = new Map();
  const recordsByRootId = new Map();
  const commitsByRootId = new Map();

  function rootRows() {
    return [...rootsByPath.values()].map((root) => ({ ...root }));
  }

  return {
    async ensureRoot(rootPath) {
      let root = rootsByPath.get(rootPath);
      if (!root) {
        root = { id: nextRootId, path: rootPath, last_scan_track_count: 0, last_scan_error: "" };
        nextRootId += 1;
        rootsByPath.set(rootPath, root);
      }
      return root;
    },
    async markScanStarted(rootId) {
      const root = [...rootsByPath.values()].find((entry) => entry.id === rootId);
      if (root) root.last_scan_error = "";
    },
    async indexedTrackRecords(rootId) {
      return recordsByRootId.get(rootId) || [];
    },
    async restoreSources() {},
    async markUndiscoveredSourcesDead() {},
    async replaceTracks(rootId, records, details) {
      recordsByRootId.set(rootId, records.map((record) => ({ ...record })));
      commitsByRootId.set(rootId, { ...details, outcomes: [...(details.outcomes || [])] });
      const root = [...rootsByPath.values()].find((entry) => entry.id === rootId);
      if (root) root.last_scan_track_count = records.length;
    },
    async loadRoots() {
      return rootRows();
    },
    async markScanFailed(rootId, message) {
      const root = [...rootsByPath.values()].find((entry) => entry.id === rootId);
      if (root) root.last_scan_error = String(message || "Scan failed");
    },
    snapshot(rootPath) {
      const root = rootsByPath.get(rootPath);
      if (!root) return { records: [], outcomes: [], outcomeSummary: null };
      const commit = commitsByRootId.get(root.id) || {};
      return {
        records: [...(recordsByRootId.get(root.id) || [])],
        outcomes: [...(commit.outcomes || [])],
        outcomeSummary: commit.outcomeSummary || null
      };
    }
  };
}

async function scanCompatibilityRoots({
  rootPaths,
  inspectTrackVariants,
  probePlayback = null,
  onProgress = () => {},
  deepScan = true,
  scanConcurrency = probePlayback ? 1 : DEFAULT_SCAN_CONCURRENCY
}) {
  if (!Array.isArray(rootPaths) || rootPaths.length === 0) throw new Error("Compatibility scan requires at least one folder");
  if (typeof inspectTrackVariants !== "function") throw new Error("Compatibility scan requires a metadata inspector");
  const database = createCompatibilityScanDatabase();
  const roots = [];
  for (const rootPath of rootPaths) {
    const resolvedRoot = path.resolve(rootPath);
    const result = await scanLibraryRoot({
      rootPath: resolvedRoot,
      job: { cancelled: false },
      database,
      inspectTrackVariants,
      probePlayback,
      onProgress,
      deepScan,
      scanConcurrency
    });
    roots.push(Object.freeze({ rootPath: resolvedRoot, ...result, ...database.snapshot(resolvedRoot) }));
  }
  return Object.freeze({ roots: Object.freeze(roots) });
}

module.exports = {
  PCM_PROBE_CHUNK_MS,
  PCM_PROBE_CHUNK_COUNT,
  hasAudiblePcm,
  decodeProbeChunk,
  createCompatibilityPcmProbe,
  createCompatibilityScanDatabase,
  scanCompatibilityRoots
};
