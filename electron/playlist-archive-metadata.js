function createPlaylistArchiveMetadataService({ materializeArchiveEntries, inspectTrack, inspectionConcurrency = 4 }) {
  if (typeof materializeArchiveEntries !== "function") throw new Error("Archive metadata service requires materialization");
  if (typeof inspectTrack !== "function") throw new Error("Archive metadata service requires inspection");

  async function inspectArchiveGroup(archivePath, tracks) {
    const entries = [...new Set(tracks.map((track) => track.archiveEntry).filter(Boolean))];
    if (!archivePath || !entries.length) return [];
    const session = await materializeArchiveEntries(archivePath, entries);
    try {
      const updates = [];
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < tracks.length) {
          const track = tracks[nextIndex];
          nextIndex += 1;
          const materializedPath = session.paths.get(track.archiveEntry);
          if (!materializedPath) continue;
          try {
            const inspection = await inspectTrack(materializedPath, track.sourceFilename || track.archiveEntry);
            updates.push({ ...track, inspection });
          } catch {
            // Queue-time metadata is opportunistic. Scanner outcomes retain
            // durable failures and retry state; leave this row unresolved.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(inspectionConcurrency, tracks.length) }, worker));
      return updates;
    } finally {
      await session.cleanup();
    }
  }

  async function hydrate(tracks) {
    const groups = new Map();
    for (const track of Array.isArray(tracks) ? tracks : []) {
      if (!track?.id || !track.archivePath || !track.archiveEntry) continue;
      const group = groups.get(track.archivePath) || [];
      group.push(track);
      groups.set(track.archivePath, group);
    }
    const updates = [];
    // One archive at a time prevents independent TAR.ZST decompression from
    // competing with playback and keeps selection hydration predictable.
    for (const [archivePath, group] of groups) updates.push(...await inspectArchiveGroup(archivePath, group));
    return updates;
  }

  return { hydrate };
}

module.exports = { createPlaylistArchiveMetadataService };
