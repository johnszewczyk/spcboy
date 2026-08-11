function createPlaylistReader({ fs, path, supportsPath, isSupportedArchivePath, discoverPhysicalSources, expandArchiveSources, archiveListConcurrency }) {
  function playlistFromSources(sources, folderPath) {
    const orderedSources = [...sources].sort((left, right) => {
      const leftName = path.basename(left.archiveEntry || left.path);
      const rightName = path.basename(right.archiveEntry || right.path);
      return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: "base" });
    });

    return orderedSources.map((source, index) => {
      const sourcePath = source.archiveEntry ? `${source.path}#${source.archiveEntry}` : source.path;
      const sourceFilename = path.basename(source.archiveEntry || source.path);
      const extension = path.extname(sourceFilename).toLowerCase();
      const baseName = sourceFilename.replace(/\.[^.]+$/i, "");
      return {
        id: `${sourcePath}#0`,
        index: index + 1,
        path: sourcePath,
        trackIndex: 0,
        trackCount: 1,
        archivePath: source.archivePath,
        archiveEntry: source.archiveEntry,
        sourceFilename,
        filename: sourceFilename,
        displayName: baseName,
        title: baseName,
        game: path.basename(folderPath),
        artist: "—",
        system: extension === ".spc" ? "SNES" : "SEGA",
        lengthLabel: "—",
        basePlaybackSeconds: 0,
        specialAudioKind: null,
        metadataLoaded: false
      };
    });
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
