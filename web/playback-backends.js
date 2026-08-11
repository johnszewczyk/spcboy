(() => {
  const BACKENDS = window.spcBoy?.playbackBackends;
  if (!Array.isArray(BACKENDS)) {
    throw new Error("Playback backend registry is unavailable from the Electron preload bridge.");
  }
  const CANDIDATES_BY_EXTENSION = new Map();
  for (const backend of BACKENDS) {
    for (const extension of backend.extensions) {
      const candidates = [...(CANDIDATES_BY_EXTENSION.get(extension) || [])];
      candidates.push(backend);
      CANDIDATES_BY_EXTENSION.set(extension, Object.freeze(candidates));
    }
  }

  function candidatesForPath(filePath) {
    const source = String(filePath || "");
    const extension = source.slice(source.lastIndexOf(".")).toLowerCase();
    return CANDIDATES_BY_EXTENSION.get(extension) || Object.freeze([]);
  }

  function backendForPath(filePath) {
    return candidatesForPath(filePath)[0] || null;
  }

  const conflicts = Object.freeze([...CANDIDATES_BY_EXTENSION]
    .filter(([, candidates]) => candidates.length > 1)
    .map(([extension, candidates]) => Object.freeze({ extension, candidates })));

  window.SPCBoyPlaybackBackends = Object.freeze({
    all: BACKENDS,
    conflicts,
    forPath: backendForPath,
    candidatesForPath
  });
})();
