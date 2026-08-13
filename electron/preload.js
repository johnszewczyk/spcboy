const { contextBridge, ipcRenderer } = require("electron");

// The renderer needs playback-mode ownership for scheduling, but it must not
// maintain a second format table. Keep this deliberately data-only surface so
// extension admission and Electron routing still have one source of truth.
// Sandboxed Electron preloads cannot require sibling app modules. Receive the
// registry once from the main process before publishing the narrow bridge.
const rendererPlaybackBackends = Object.freeze((ipcRenderer.sendSync("app:playback-backends") || []).map((backend) => Object.freeze({
  id: backend.id,
  displayName: backend.displayName,
  playbackMode: backend.playbackMode,
  playbackSpeedMode: backend.playbackSpeedMode || null,
  playbackSpeedExtensions: Object.freeze([...(backend.playbackSpeedExtensions || [])]),
  extensions: Object.freeze([...backend.extensions])
})));

contextBridge.exposeInMainWorld("spcBoy", {
  isOptionsWindow: process.argv.includes("--spcboy-options-window"),
  isScanLogWindow: process.argv.includes("--spcboy-scan-log-window"),
  playbackBackends: rendererPlaybackBackends,
  openOptionsWindow: () => ipcRenderer.invoke("app:open-options"),
  closeOptionsWindow: () => ipcRenderer.invoke("app:close-options"),
  openScanLog: (root) => ipcRenderer.invoke("app:open-scan-log", root),
  onScanLogData: (callback) => ipcRenderer.on("scan-log:data", (_event, root) => callback(root)),
  setConsoleViewEnabled: (enabled) => ipcRenderer.send("app:console-view-changed", Boolean(enabled)),
  setPlaybackSettings: (settings) => ipcRenderer.send("app:playback-settings-changed", settings),
  setRoutingPreferences: (preferences) => ipcRenderer.invoke("app:routing-preferences-set", preferences || {}),
  onRoutingPreferencesChanged: (callback) => ipcRenderer.on("app:routing-preferences-changed", (_event, preferences) => callback(preferences || {})),
  setAppearanceSettings: (settings) => ipcRenderer.send("app:appearance-settings-changed", settings || {}),
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  chooseRootFolder: () => ipcRenderer.invoke("library:choose-root"),
  openPath: (inputPath) => ipcRenderer.invoke("library:open-path", inputPath),
  chooseLibraryPath: () => ipcRenderer.invoke("library:choose-path"),
  selectFolder: (folderPath) => ipcRenderer.invoke("library:select-folder", folderPath),
  listFolder: (folderPath) => ipcRenderer.invoke("library:list-folder", folderPath),
  selectFile: (filePath) => ipcRenderer.invoke("library:select-file", filePath),
  showInFinder: (targetPath) => ipcRenderer.invoke("library:show-in-finder", targetPath),
  refreshTree: (rootPath, selectedFolderPath) =>
    ipcRenderer.invoke("library:refresh-tree", rootPath, selectedFolderPath),
  databaseRoots: () => ipcRenderer.invoke("library:database-roots"),
  databaseLocation: () => ipcRenderer.invoke("library:database-location"),
  chooseDatabaseLocation: () => ipcRenderer.invoke("library:database-location-choose"),
  useDefaultDatabaseLocation: () => ipcRenderer.invoke("library:database-location-default"),
  libraryOperationState: () => ipcRenderer.invoke("library:operation-state"),
  databaseRemoveRoot: (rootId) => ipcRenderer.invoke("library:database-remove-root", rootId),
  databaseSetRootEnabled: (rootId, enabled) => ipcRenderer.invoke("library:database-set-root-enabled", rootId, enabled),
  databaseSetRootsEnabled: (rootIds, enabled) => ipcRenderer.invoke("library:database-set-roots-enabled", rootIds, enabled),
  databaseMoveRoot: (rootId, direction) => ipcRenderer.invoke("library:database-move-root", rootId, direction),
  databaseGames: () => ipcRenderer.invoke("library:database-games"),
  configureConsoleTagPreference: (enabled) => ipcRenderer.invoke("library:console-tag-preference", Boolean(enabled)),
  databaseSearchGames: (query) => ipcRenderer.invoke("library:database-search-games", query),
  databaseSearchBrowser: (rootPath, query) => ipcRenderer.invoke("library:database-search-browser", rootPath, query),
  databaseGameTracks: (games) => ipcRenderer.invoke("library:database-game-tracks", games),
  scanDatabaseRoot: (rootId, deepScan = false) => ipcRenderer.invoke("library:database-scan", Number(rootId), Boolean(deepScan)),
  scanAllDatabaseRoots: (deepScan = false) => ipcRenderer.invoke("library:database-scan-all", Boolean(deepScan)),
  trimMissingDatabaseSources: () => ipcRenderer.invoke("library:database-trim-missing"),
  purgeUnlinkedDatabaseSources: () => ipcRenderer.invoke("library:database-purge-unlinked"),
  clearLibraryDatabase: () => ipcRenderer.invoke("library:database-clear"),
  databaseMaintenanceSummary: () => ipcRenderer.invoke("library:database-maintenance-summary"),
  archiveCacheSummary: () => ipcRenderer.invoke("library:archive-cache-summary"),
  clearArchiveCache: () => ipcRenderer.invoke("library:archive-cache-clear"),
  configureArchiveCache: (settings) => ipcRenderer.invoke("library:archive-cache-configure", settings || {}),
  cancelLibraryOperation: () => ipcRenderer.invoke("library:database-cancel-operation"),
  inspectTrack: (trackPath, sourceName) => ipcRenderer.invoke("playlist:inspect-track", trackPath, sourceName),
  hydrateLooseMetadata: (track) => ipcRenderer.invoke("playlist:hydrate-loose-metadata", track || {}),
  hydrateArchiveMetadata: (tracks) => ipcRenderer.invoke("playlist:hydrate-archive-metadata", tracks),
  materializeTrack: (archivePath, archiveEntry) => ipcRenderer.invoke("playlist:materialize-track", archivePath, archiveEntry),
  releaseMaterializedTrack: () => ipcRenderer.invoke("playlist:release-materialized-track"),
  decodeTrackPcm: (trackPath, trackIndex, startMs, playMs, fadeMs, specialAudioKind, sourceName) =>
    ipcRenderer.invoke("playlist:decode-track-pcm", trackPath, trackIndex, startMs, playMs, fadeMs, specialAudioKind, sourceName),
  openPlaybackSession: (trackPath, trackIndex, startMs, playMs, fadeMs) =>
    ipcRenderer.invoke("playlist:playback-session-open", trackPath, trackIndex, startMs, playMs, fadeMs),
  readPlaybackSessionChunk: (frameCount) =>
    ipcRenderer.invoke("playlist:playback-session-read", frameCount),
  closePlaybackSession: () =>
    ipcRenderer.invoke("playlist:playback-session-close"),
  nativePlaybackInit: () =>
    ipcRenderer.invoke("playback:native-init"),
  nativePlaybackLoad: (trackPath, trackIndex, startMs, playMs, fadeMs, speed) =>
    ipcRenderer.invoke("playback:native-load", trackPath, trackIndex, startMs, playMs, fadeMs, speed),
  nativePlaybackPlay: () =>
    ipcRenderer.invoke("playback:native-play"),
  nativePlaybackPause: () =>
    ipcRenderer.invoke("playback:native-pause"),
  nativePlaybackStop: () =>
    ipcRenderer.invoke("playback:native-stop"),
  nativePlaybackUnload: () =>
    ipcRenderer.invoke("playback:native-unload"),
  nativePlaybackRampGain: (gain, durationMs) =>
    ipcRenderer.invoke("playback:native-ramp-gain", gain, durationMs),
  nativePlaybackSeek: (startMs) =>
    ipcRenderer.invoke("playback:native-seek", startMs),
  nativePlaybackState: () =>
    ipcRenderer.invoke("playback:native-state"),
  nativePlaybackAudioConfig: (volume, equalizerEnabled, bandGains) =>
    ipcRenderer.invoke("playback:native-audio-config", volume, Boolean(equalizerEnabled), bandGains),
  nativePlaybackClose: () =>
    ipcRenderer.invoke("playback:native-close"),
  setPlaybackPowerSaveBlocker: (enabled) =>
    ipcRenderer.invoke("playback:set-power-save-blocker", Boolean(enabled)),
  onLibrarySnapshot: (handler) => {
    ipcRenderer.removeAllListeners("library:snapshot");
    ipcRenderer.on("library:snapshot", (_event, snapshot) => handler(snapshot));
  },
  onConsoleViewChanged: (handler) => {
    ipcRenderer.removeAllListeners("app:console-view-changed");
    ipcRenderer.on("app:console-view-changed", (_event, enabled) => handler(Boolean(enabled)));
  },
  onPlaybackSettingsChanged: (handler) => {
    ipcRenderer.removeAllListeners("app:playback-settings-changed");
    ipcRenderer.on("app:playback-settings-changed", (_event, settings) => handler(settings || {}));
  },
  onAppearanceSettingsChanged: (handler) => {
    ipcRenderer.removeAllListeners("app:appearance-settings-changed");
    ipcRenderer.on("app:appearance-settings-changed", (_event, settings) => handler(settings || {}));
  },
  onLibraryScanProgress: (handler) => {
    ipcRenderer.removeAllListeners("library:scan-progress");
    ipcRenderer.on("library:scan-progress", (_event, progress) => handler(progress));
  },
  onLibraryOperationState: (handler) => {
    ipcRenderer.removeAllListeners("library:operation-state-changed");
    ipcRenderer.on("library:operation-state-changed", (_event, state) => handler(state || {}));
  },
  onLibraryRootsChanged: (handler) => {
    ipcRenderer.removeAllListeners("library:roots-changed");
    ipcRenderer.on("library:roots-changed", (_event, roots) => handler(Array.isArray(roots) ? roots : []));
  },
  onLibraryDatabaseChanged: (handler) => {
    ipcRenderer.removeAllListeners("library:database-changed");
    ipcRenderer.on("library:database-changed", (_event, change) => handler(change || {}));
  },
  onTransportShortcut: (handler) => {
    ipcRenderer.removeAllListeners("transport:shortcut");
    ipcRenderer.on("transport:shortcut", (_event, action) => handler(action));
  },
  onLibraryCommand: (handler) => {
    ipcRenderer.removeAllListeners("library:command");
    ipcRenderer.on("library:command", (_event, command) => handler(command));
  },
  onNativePlaybackState: (handler) => {
    ipcRenderer.removeAllListeners("playback:native-state-changed");
    ipcRenderer.on("playback:native-state-changed", (_event, snapshot) => handler(snapshot));
  }
});
