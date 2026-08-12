function createPlaylistReader({ fs, path, supportsPath, routeForPath = () => null, isSupportedArchivePath, discoverPhysicalSources, expandArchiveSources, materializeArchiveEntries, inspectTrackVariants, archiveListConcurrency }) {
  function playlistTrack(source, folderPath, variant = null) {
    const sourcePath = source.archiveEntry ? `${source.path}#${source.archiveEntry}` : source.path;
    const sourceFilename = path.basename(source.archiveEntry || source.path);
    const extension = path.extname(sourceFilename).toLowerCase();
    const baseName = sourceFilename.replace(/\.[^.]+$/i, "");
    const trackIndex = Number(variant?.trackIndex) || 0;
    const trackCount = Math.max(1, Number(variant?.trackCount) || 1);
    const inspection = variant?.inspection || null;
    return {
      id: `${sourcePath}#${trackIndex}`,
      index: 0,
      path: sourcePath,
      trackIndex,
      trackCount,
      archivePath: source.archivePath,
      archiveEntry: source.archiveEntry,
      sourceFilename,
      filename: `${sourceFilename}${trackCount > 1 ? ` [${trackIndex + 1}]` : ""}`,
      displayName: `${baseName}${trackCount > 1 ? ` [${trackIndex + 1}]` : ""}`,
      title: inspection?.metadata?.song || baseName,
      game: inspection?.metadata?.game || path.basename(folderPath),
      artist: inspection?.metadata?.author || "—",
      system: inspection?.metadata?.system || (extension === ".spc" ? "SNES" : "SEGA"),
      lengthLabel: inspection?.lengthLabel || "—",
      basePlaybackSeconds: Number(inspection?.basePlaybackSeconds) || 0,
      specialAudioKind: inspection?.specialAudioKind || null,
      metadataLoaded: Boolean(inspection)
    };
  }

  async function playlistFromSources(sources, folderPath) {
    const orderedSources = [...sources].sort((left, right) => {
      const leftName = path.basename(left.archiveEntry || left.path);
      const rightName = path.basename(right.archiveEntry || right.path);
      return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: "base" });
    });

    const rows = [];
    for (const source of orderedSources) {
      const sourceName = source.archiveEntry || source.path;
      if (!routeForPath(sourceName, { archiveMember: Boolean(source.archiveEntry) })?.supportsMultiTrack) {
        rows.push(playlistTrack(source, folderPath));
        continue;
      }
      if (source.archivePath) {
        if (typeof materializeArchiveEntries !== "function") throw new Error("Archive multi-track playlist expansion requires materialization.");
        const session = await materializeArchiveEntries(source.archivePath, [source.archiveEntry]);
        try {
          const materializedPath = session.paths.get(source.archiveEntry);
          if (!materializedPath) throw new Error(`Could not materialize ${source.archiveEntry}.`);
          const variants = await inspectTrackVariants(materializedPath, sourceName);
          rows.push(...variants.map((variant) => playlistTrack(source, folderPath, variant)));
        } finally {
          await session.cleanup();
        }
      } else {
        const variants = await inspectTrackVariants(source.path, sourceName);
        rows.push(...variants.map((variant) => playlistTrack(source, folderPath, variant)));
      }
    }
    return rows.map((track, index) => ({ ...track, index: index + 1 }));
  }

  async function readPlaylist(folderPath) {
    const physicalSources = await discoverPhysicalSources(folderPath, { recursive: false });
    const sources = await expandArchiveSources(physicalSources, { concurrency: archiveListConcurrency });
    return playlistFromSources(sources, folderPath);
  }

  async function readPlaylistForFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile() || (!supportsPath(resolvedPath) && !isSupportedArchivePath(resolvedPath))) {
      throw new Error("The selected browser item is not a supported audio file or archive.");
    }
    if (supportsPath(resolvedPath)) {
      return playlistFromSources([{ path: resolvedPath, archivePath: null, archiveEntry: null }], path.dirname(resolvedPath));
    }
    const sources = await expandArchiveSources([{ path: resolvedPath, archivePath: resolvedPath, archiveEntry: null }], {
      concurrency: archiveListConcurrency
    });
    return playlistFromSources(sources, path.dirname(resolvedPath));
  }

  return { playlistFromSources, readPlaylist, readPlaylistForFile };
}

module.exports = { createPlaylistReader };
