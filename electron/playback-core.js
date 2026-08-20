const BACKEND_MODULES = Object.freeze([
  Object.freeze({
    id: "libgme",
    displayName: "libgme",
    playbackMode: "native-session",
    helper: "libgme-tool",
    extensions: Object.freeze([".ay", ".gbs", ".hes", ".kss", ".nsf", ".nsfe", ".sap", ".sid", ".spc"]),
    multiTrackExtensions: Object.freeze([".ay", ".gbs", ".hes", ".kss", ".nsf", ".nsfe", ".sap"]),
    structurePolicy: "known-single-or-enumerate",
    metadataPolicy: "direct-or-decoder",
    playbackSpeedMode: "native-tempo",
    playbackSpeedExtensions: Object.freeze([".ay", ".gbs", ".hes", ".kss", ".nsf", ".nsfe", ".sap", ".spc"]),
    inspectionConcurrency: 1,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "libvgm",
    displayName: "libvgm",
    playbackMode: "native-session",
    helper: "libvgm-tool",
    extensions: Object.freeze([".gym", ".s98", ".vgm", ".vgz"]),
    structurePolicy: "known-single",
    metadataPolicy: "direct",
    playbackSpeedMode: "native-tempo",
    playbackSpeedExtensions: Object.freeze([".gym", ".s98", ".vgm", ".vgz"]),
    inspectionConcurrency: 1,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "lazyusf",
    displayName: "lazyusf2",
    playbackMode: "native-session",
    helper: "libgme-tool",
    extensions: Object.freeze([".usf", ".miniusf"]),
    structurePolicy: "known-single",
    metadataPolicy: "direct",
    archivePolicy: "dependency-set",
    inspectionConcurrency: 1,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "highlycomplete",
    displayName: "Highly Complete",
    playbackMode: "native-session",
    helper: "libgme-tool",
    extensions: Object.freeze([".gsf", ".minigsf"]),
    structurePolicy: "known-single",
    metadataPolicy: "decoder",
    archivePolicy: "dependency-set",
    inspectionConcurrency: 1,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "openmpt",
    displayName: "libopenmpt",
    playbackMode: "renderer-pcm",
    helper: "openmpt123",
    extensions: Object.freeze([".669", ".dmf", ".far", ".it", ".mod", ".mptm", ".mtm", ".okt", ".ptm", ".s3m", ".stm", ".ult", ".xm"]),
    structurePolicy: "known-single",
    metadataPolicy: "optional-deferred",
    inspectionConcurrency: 2,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "standard-audio",
    displayName: "Core Audio",
    playbackMode: "renderer-pcm",
    helper: "ffmpeg",
    extensions: Object.freeze([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp2", ".mp3", ".ogg", ".tak", ".wav"]),
    structurePolicy: "known-single",
    metadataPolicy: "optional-deferred",
    inspectionConcurrency: 2,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "twosf",
    displayName: "2SF",
    playbackMode: "native-session",
    helper: "libgme-tool",
    extensions: Object.freeze([".2sf", ".mini2sf"]),
    structurePolicy: "known-single",
    metadataPolicy: "direct",
    archivePolicy: "dependency-set",
    inspectionConcurrency: 1,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "vgmstream",
    displayName: "vgmstream",
    playbackMode: "native-session",
    helper: "libgme-tool",
    extensions: Object.freeze([".aa3", ".adp", ".adpcm", ".adx", ".ads", ".aifc", ".at3", ".aus", ".bik", ".bika", ".bk2", ".bnk", ".fsb", ".genh", ".hd", ".hbd", ".iecs", ".int", ".mib", ".msf", ".mtaf", ".ps3", ".rws", ".s14", ".ss2", ".stream", ".strm", ".svag", ".swav", ".txtp", ".vag", ".xa", ".xmd", ".xvag"]),
    structurePolicy: "dependency-enumerate",
    metadataPolicy: "decoder",
    archivePolicy: "dependency-set-when-required",
    inspectionConcurrency: 2,
    inspectionTimeoutSeconds: 60
  }),
  Object.freeze({
    id: "playpsf",
    displayName: "Play! PSF",
    playbackMode: "native-session",
    helper: "libgme-tool",
    extensions: Object.freeze([".psf", ".minipsf", ".psf2", ".minipsf2"]),
    structurePolicy: "known-single",
    metadataPolicy: "direct",
    archivePolicy: "dependency-set",
    inspectionConcurrency: 1,
    inspectionTimeoutSeconds: 60
  })
]);

const NO_BACKEND_CANDIDATES = Object.freeze([]);

function createBackendCandidateIndex(backends) {
  const candidatesByExtension = new Map();
  for (const backend of backends) {
    for (const extension of backend.extensions || []) {
      const normalizedExtension = String(extension).toLowerCase();
      const candidates = candidatesByExtension.get(normalizedExtension) || [];
      candidates.push(backend);
      candidatesByExtension.set(normalizedExtension, candidates);
    }
  }
  const indexedCandidates = [...candidatesByExtension].map(([extension, candidates]) => (
    [extension, Object.freeze([...candidates])]
  ));
  return new Map(indexedCandidates);
}

const BACKEND_CANDIDATES_BY_EXTENSION = createBackendCandidateIndex(BACKEND_MODULES);
let preferredBackendIdsByExtension = new Map();

function extensionForPath(filePath) {
  return require("path").extname(filePath).toLowerCase();
}

function backendCandidatesForPath(filePath) {
  return BACKEND_CANDIDATES_BY_EXTENSION.get(extensionForPath(filePath)) || NO_BACKEND_CANDIDATES;
}

function routingConflicts() {
  return Object.freeze(
    [...BACKEND_CANDIDATES_BY_EXTENSION]
      .filter(([, candidates]) => candidates.length > 1)
      .map(([extension, candidates]) => Object.freeze({ extension, candidates }))
  );
}

function routingPreferences() {
  return Object.freeze(Object.fromEntries(preferredBackendIdsByExtension));
}

function setRoutingPreferences(nextPreferences) {
  const next = new Map();
  for (const [rawExtension, rawBackendId] of Object.entries(nextPreferences || {})) {
    const extension = String(rawExtension).toLowerCase();
    const backendId = String(rawBackendId || "");
    if (BACKEND_CANDIDATES_BY_EXTENSION.get(extension)?.some((backend) => backend.id === backendId)) {
      next.set(extension, backendId);
    }
  }
  preferredBackendIdsByExtension = next;
  return routingPreferences();
}

function routeForPath(filePath, { archiveMember = false, preferredBackendId = null } = {}) {
  const extension = extensionForPath(filePath);
  const backend = backendForPath(filePath, { preferredBackendId });
  if (!backend) return null;
  const supportsMultiTrack = Boolean(backend.multiTrackExtensions?.includes(extension));
  const structurePolicy = backend.structurePolicy === "known-single-or-enumerate"
    ? (supportsMultiTrack ? "enumerate" : "known-single")
    : backend.structurePolicy || (supportsMultiTrack ? "enumerate" : "known-single");
  const metadataPolicy = backend.metadataPolicy === "direct-or-decoder"
    ? (extension === ".spc" ? "direct" : "decoder")
    : backend.metadataPolicy || "decoder";
  return Object.freeze({
    backendId: backend.id,
    displayName: backend.displayName,
    extension,
    archiveMember: Boolean(archiveMember),
    archivePolicy: backend.archivePolicy || "selected-entry",
    playbackMode: backend.playbackMode,
    inspectionConcurrency: backend.inspectionConcurrency || 1,
    inspectionTimeoutSeconds: backend.inspectionTimeoutSeconds || 60,
    playbackSpeedMode: backend.playbackSpeedExtensions?.includes(extension) ? backend.playbackSpeedMode || null : null,
    supportsMultiTrack,
    structurePolicy,
    metadataPolicy
  });
}

function routeForArchiveEntry(entryPath) {
  return routeForPath(entryPath, { archiveMember: true });
}

function backendForPath(filePath, { preferredBackendId = null } = {}) {
  const candidates = backendCandidatesForPath(filePath);
  const configuredBackendId = preferredBackendId || preferredBackendIdsByExtension.get(extensionForPath(filePath));
  return candidates.find((backend) => backend.id === configuredBackendId) || candidates[0] || null;
}

function supportsPath(filePath) {
  return Boolean(routeForPath(filePath));
}

function playbackModeForPath(filePath) {
  return backendForPath(filePath)?.playbackMode || null;
}

function supportsNativePlayback(filePath) {
  return playbackModeForPath(filePath) === "native-session";
}

function playbackSpeedModeForPath(filePath) {
  return routeForPath(filePath)?.playbackSpeedMode || null;
}

function supportsPlaybackSpeed(filePath) {
  return Boolean(playbackSpeedModeForPath(filePath));
}

module.exports = {
  BACKEND_MODULES,
  createBackendCandidateIndex,
  backendCandidatesForPath,
  backendForPath,
  routingConflicts,
  routingPreferences,
  setRoutingPreferences,
  routeForPath,
  routeForArchiveEntry,
  playbackModeForPath,
  playbackSpeedModeForPath,
  supportsNativePlayback,
  supportsPlaybackSpeed,
  supportsPath
};
