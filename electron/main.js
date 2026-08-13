const fsSync = require("fs");
const fs = fsSync.promises;
const path = require("path");
const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, powerSaveBlocker, shell } = require("electron");
const { CanonicalLibraryReader } = require("./canonical-library-reader");
const { runMediaScanner } = require("./media-scanner-client");
const { BACKEND_MODULES, backendForPath, routeForPath, setRoutingPreferences, supportsNativePlayback, supportsPath } = require("./playback-core");
const { archiveCacheSummary, clearArchiveCache, pruneArchiveCache, recoverArchiveCachePartials, isArchiveCacheBusy, materializeZipEntry, materializeArchiveEntryForPlayback, materializeArchiveEntriesForInspection, isSupportedArchivePath, recoverAbandonedInspectionScratchRoots, recoverAbandonedPlaybackScratchRoots, DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES, MIN_ARCHIVE_CACHE_LIMIT_BYTES, MAX_ARCHIVE_CACHE_LIMIT_BYTES } = require("./archive-resolver");
const { discoverPhysicalSources } = require("./media-source-discovery");
const { expandArchiveSources, ARCHIVE_LIST_CONCURRENCY } = require("./playlist-archive-discovery");
const { createPlaylistReader } = require("./library-playlist");
const { playlistTrackIdentity } = require("./playlist-track-identity");
const { createNativeAudioTools } = require("./native-audio-tools");
const { createTrackInspector } = require("./playlist-track-inspector");
const { createPlaylistArchiveMetadataService } = require("./playlist-archive-metadata");
const { createLatestRequestCoalescer } = require("./latest-request-coalescer");

// SPCBoy originally persisted its library, window state, and renderer settings
// under the package-name profile. Keep that durable profile while presenting
// the application as SPCBoy; changing app.setName alone silently created a
// second empty profile and made the app look like an old/default install.
const LEGACY_USER_DATA_DIRECTORY = "spcboy-electron-port";
app.setName("SPCBoy");
app.setPath("userData", path.join(app.getPath("appData"), LEGACY_USER_DATA_DIRECTORY));
const ownsSingleInstance = app.requestSingleInstanceLock();
if (!ownsSingleInstance) app.quit();

const TREE_BUILD_CONCURRENCY = 24;
const RAW_TREE_CONCURRENCY = 8;
const METADATA_CACHE_MAX_ENTRIES = 2048;
const WINDOW_STATE_FILE_NAME = "window-state.json";
const LIBRARY_DATABASE_LOCATION_FILE_NAME = "library-database-location.json";
const APP_ICON_FILE_NAME = "app-icon.png";
const NATIVE_PLAYBACK_BROADCAST_MS = 100;

let mainWindow = null;
let aboutWindow = null;
let optionsWindow = null;
let scanLogWindow = null;
let pendingOpenPath = null;
let pendingLibrarySnapshot = null;
let windowStateSaveTimer = null;
let appIconPath = null;
let playbackPowerSaveBlockerId = null;
let nativePlaybackBroadcastTimer = null;
let nativePlaybackBroadcastInFlight = false;
let libraryDatabase = null;

function defaultLibraryDatabasePath() {
  return path.join(app.getPath("appData"), "CocoaSpice", "Library.sqlite");
}

function libraryDatabaseLocationFilePath() {
  return path.join(app.getPath("userData"), LIBRARY_DATABASE_LOCATION_FILE_NAME);
}

function configuredLibraryDatabasePath() {
  try {
    const value = JSON.parse(fsSync.readFileSync(libraryDatabaseLocationFilePath(), "utf8"));
    if (typeof value?.path === "string" && path.isAbsolute(value.path)) return path.resolve(value.path);
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`[SPCBoy] ignored invalid database location: ${error.message}`);
  }
  return defaultLibraryDatabasePath();
}

async function saveLibraryDatabasePath(databasePath) {
  const locationPath = libraryDatabaseLocationFilePath();
  const temporaryPath = `${locationPath}.tmp`;
  await fs.mkdir(path.dirname(locationPath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify({ path: path.resolve(databasePath) }, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, locationPath);
}

function libraryDatabaseLocation() {
  const configuredPath = configuredLibraryDatabasePath();
  return {
    activePath: libraryDatabase?.databasePath || configuredPath,
    configuredPath,
    defaultPath: defaultLibraryDatabasePath(),
    readOnly: Boolean(libraryDatabase?.isReadOnly),
    requiresRestart: Boolean(libraryDatabase && path.resolve(libraryDatabase.databasePath) !== configuredPath),
    mode: libraryDatabase?.catalogKind || "unavailable"
  };
}

let playbackScratchRecovery = { recoveredRootCount: 0, recoveredBytes: 0 };
let archiveCacheRecovery = { recoveredPartialCount: 0, recoveredBytes: 0 };
let quitAfterArchivePlaybackCleanup = false;
let activeArchivePlaybackMaterialization = null;
let archiveCacheSettings = { enabled: true, limitBytes: DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES };
const { readPlaylist, readPlaylistForFile } = createPlaylistReader({
  fs,
  path,
  supportsPath,
  routeForPath,
  isSupportedArchivePath,
  discoverPhysicalSources,
  expandArchiveSources,
  materializeArchiveEntries: materializeArchiveEntriesForInspection,
  inspectTrackVariants: (...args) => inspectTrackVariants(...args),
  archiveListConcurrency: ARCHIVE_LIST_CONCURRENCY
});
const searchDatabaseGames = createLatestRequestCoalescer(
  (query) => libraryDatabase.searchGames(query),
  []
);
const searchDatabaseBrowser = createLatestRequestCoalescer(
  (rootPath, query) => libraryDatabase.searchBrowserEntries(rootPath, query),
  []
);

function attachWebContentsDiagnostics(window, label) {
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[SPCBoy] ${label} preload failed (${preloadPath})`, error);
  });
}

function rendererPlaybackBackendPayload() {
  return BACKEND_MODULES.map((backend) => ({
    id: backend.id,
    displayName: backend.displayName,
    playbackMode: backend.playbackMode,
    playbackSpeedMode: backend.playbackSpeedMode || null,
    playbackSpeedExtensions: [...(backend.playbackSpeedExtensions || [])],
    extensions: [...backend.extensions]
  }));
}

ipcMain.on("app:playback-backends", (event) => {
  event.returnValue = rendererPlaybackBackendPayload();
});

const nativeAudio = createNativeAudioTools({
  getAppPath: () => app.getAppPath(),
  backendForPath,
  supportsNativePlayback
});

function bringAppWindowsToFront(preferredWindow = null) {
  const focusedWindow = preferredWindow && !preferredWindow.isDestroyed()
    ? preferredWindow
    : BrowserWindow.getFocusedWindow() || mainWindow;
  if (!focusedWindow || focusedWindow.isDestroyed()) return;
  if (focusedWindow.isMinimized()) focusedWindow.restore();
  if (!focusedWindow.isVisible()) focusedWindow.show();
  if (typeof focusedWindow.moveTop === "function") focusedWindow.moveTop();
  if (!focusedWindow.isFocused()) focusedWindow.focus();
}

async function openOptionsWindow() {
  if (optionsWindow && !optionsWindow.isDestroyed()) {
    optionsWindow.show();
    optionsWindow.focus();
    bringAppWindowsToFront(optionsWindow);
    return;
  }
  let savedOptionsBounds = null;
  try {
    const saved = JSON.parse(fsSync.readFileSync(path.join(app.getPath("userData"), "spcboy-options-window.json"), "utf8"));
    if (isValidWindowBounds(saved.bounds)) savedOptionsBounds = saved.bounds;
  } catch {}
  optionsWindow = new BrowserWindow({
    width: savedOptionsBounds?.width ?? 800,
    height: savedOptionsBounds?.height ?? 600,
    x: savedOptionsBounds?.x,
    y: savedOptionsBounds?.y,
    minWidth: 800,
    minHeight: 600,
    title: "SPCBoy Options",
    parent: mainWindow,
    modal: false,
    // Show the dark native shell immediately. The renderer can populate the
    // controls asynchronously without making Options appear to hang on a
    // large library root.
    show: true,
    backgroundColor: "#141414",
    icon: appIconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: ["--spcboy-options-window"]
    }
  });
  attachWebContentsDiagnostics(optionsWindow, "options");
  optionsWindow.on("focus", () => bringAppWindowsToFront(optionsWindow));
  const saveOptionsBounds = () => {
    if (!optionsWindow || optionsWindow.isDestroyed() || optionsWindow.isMaximized()) return;
    try { fsSync.writeFileSync(path.join(app.getPath("userData"), "spcboy-options-window.json"), JSON.stringify({ bounds: optionsWindow.getBounds() }, null, 2)); } catch {}
  };
  optionsWindow.on("resize", saveOptionsBounds);
  optionsWindow.on("move", saveOptionsBounds);
  optionsWindow.on("closed", () => { saveOptionsBounds(); optionsWindow = null; });
  optionsWindow.once("ready-to-show", () => {
    optionsWindow?.show();
    optionsWindow?.focus();
    bringAppWindowsToFront(optionsWindow);
  });
  await optionsWindow.loadFile(path.join(app.getAppPath(), "web", "index.html"));
  if (optionsWindow.isDestroyed()) return;
  optionsWindow.focus();
  bringAppWindowsToFront(optionsWindow);
}

async function openScanLogWindow(root) {
  if (scanLogWindow && !scanLogWindow.isDestroyed()) {
    scanLogWindow.show();
    scanLogWindow.focus();
    scanLogWindow.webContents.send("scan-log:data", root);
    bringAppWindowsToFront(scanLogWindow);
    return;
  }
  scanLogWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    title: "Scan Log",
    parent: mainWindow,
    modal: false,
    icon: appIconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: ["--spcboy-scan-log-window"]
    }
  });
  scanLogWindow.on("focus", () => bringAppWindowsToFront(scanLogWindow));
  scanLogWindow.on("closed", () => { scanLogWindow = null; });
  scanLogWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key?.toLowerCase() !== "w" || (!input.meta && !input.control)) return;
    event.preventDefault();
    if (scanLogWindow && !scanLogWindow.isDestroyed()) scanLogWindow.close();
  });
  scanLogWindow.webContents.once("did-finish-load", () => {
    if (scanLogWindow && !scanLogWindow.isDestroyed()) scanLogWindow.webContents.send("scan-log:data", root);
  });
  await scanLogWindow.loadFile(path.join(app.getAppPath(), "web", "scan-log.html"));
  scanLogWindow.show();
  scanLogWindow.focus();
  bringAppWindowsToFront(scanLogWindow);
}

function resolveRootPngIconPath() {
  const iconPath = path.join(app.getAppPath(), APP_ICON_FILE_NAME);
  return fsSync.existsSync(iconPath) ? iconPath : null;
}

function windowStatePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE_NAME);
}

function isValidWindowBounds(bounds) {
  return Boolean(
    bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 320 &&
    bounds.height >= 240
  );
}

async function loadWindowState() {
  try {
    const raw = await fs.readFile(windowStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      bounds: isValidWindowBounds(parsed.bounds) ? parsed.bounds : null,
      isMaximized: Boolean(parsed.isMaximized)
    };
  } catch {
    return {
      bounds: null,
      isMaximized: false
    };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  return saveWindowStateForWindow(mainWindow);
}

function saveWindowStateForWindow(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const payload = {
    bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
    isMaximized: window.isMaximized()
  };

  fsSync.writeFileSync(windowStatePath(), JSON.stringify(payload, null, 2));
}

function scheduleWindowStateSave() {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }

  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    Promise.resolve().then(() => saveWindowState()).catch((error) => {
      console.error("[SPCBoy] save window state failed", error);
    });
  }, 150);
}

function sendTransportAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("transport:shortcut", action);
}

async function openAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: "About SPCBoy",
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  aboutWindow.on("focus", () => bringAppWindowsToFront(aboutWindow));
  aboutWindow.on("closed", () => { aboutWindow = null; });
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  aboutWindow.webContents.on("will-navigate", (event, url) => {
    if (!/^file:/i.test(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  await aboutWindow.loadFile(path.join(app.getAppPath(), "web", "about.html"));
  bringAppWindowsToFront(aboutWindow);
}

function setPlaybackPowerSaveBlockerEnabled(enabled) {
  if (enabled) {
    if (
      playbackPowerSaveBlockerId === null ||
      !powerSaveBlocker.isStarted(playbackPowerSaveBlockerId)
    ) {
      playbackPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
    return;
  }

  if (
    playbackPowerSaveBlockerId !== null &&
    powerSaveBlocker.isStarted(playbackPowerSaveBlockerId)
  ) {
    powerSaveBlocker.stop(playbackPowerSaveBlockerId);
  }
  playbackPowerSaveBlockerId = null;
}

function normalizeArchiveCacheSettings(settings = {}) {
  const requestedLimit = Number(settings.limitBytes);
  return {
    enabled: settings.enabled !== false,
    limitBytes: Number.isFinite(requestedLimit)
      ? Math.max(MIN_ARCHIVE_CACHE_LIMIT_BYTES, Math.min(MAX_ARCHIVE_CACHE_LIMIT_BYTES, Math.floor(requestedLimit)))
      : archiveCacheSettings.limitBytes
  };
}

async function releaseArchivePlaybackMaterialization() {
  const materialization = activeArchivePlaybackMaterialization;
  activeArchivePlaybackMaterialization = null;
  if (materialization?.cleanup) await materialization.cleanup();
  await pruneArchiveCache(archiveCacheSettings.enabled ? archiveCacheSettings.limitBytes : 0).catch((error) => {
    console.error("[SPCBoy] archive cache prune after playback failed", error);
  });
}

async function configureArchiveCache(settings) {
  archiveCacheSettings = normalizeArchiveCacheSettings(settings);
  const protectedPaths = activeArchivePlaybackMaterialization?.cleanup ? [] : [activeArchivePlaybackMaterialization?.path].filter(Boolean);
  const pruning = await pruneArchiveCache(archiveCacheSettings.enabled ? archiveCacheSettings.limitBytes : 0, protectedPaths);
  return { ...archiveCacheSettings, pruning, summary: await archiveCacheSummary() };
}

function canSendToMainWindow() {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isLoadingMainFrame()
  );
}

function deliverNativePlaybackState(snapshot) {
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isLoadingMainFrame()) {
      window.webContents.send("playback:native-state-changed", snapshot);
    }
  }
}

async function syncNativePlaybackStateToWindow() {
  try {
    const snapshot = await nativeAudio.nativePlaybackState();
    deliverNativePlaybackState(snapshot);
    return snapshot;
  } catch (error) {
    deliverNativePlaybackState({
      transport_state: "stopped",
      output_state: "idle",
      track_loaded: false,
      decode_error: true,
      reached_end: false,
      buffered_frames: 0,
      ring_buffer_frames: 0,
      underrun_count: 0,
      frames_requested: 0,
      frames_supplied: 0,
      position_ms: 0,
      error: error.message
    });
    throw error;
  }
}

async function pumpNativePlaybackState() {
  if (nativePlaybackBroadcastInFlight) {
    return;
  }

  nativePlaybackBroadcastInFlight = true;
  try {
    const snapshot = await nativeAudio.nativePlaybackState();
    deliverNativePlaybackState(snapshot);
  } catch {
    return;
  } finally {
    nativePlaybackBroadcastInFlight = false;
  }
}

function startNativePlaybackBroadcasts() {
  if (nativePlaybackBroadcastTimer) {
    return;
  }

  nativePlaybackBroadcastTimer = setInterval(() => {
    void pumpNativePlaybackState();
  }, NATIVE_PLAYBACK_BROADCAST_MS);
}

function stopNativePlaybackBroadcasts() {
  if (!nativePlaybackBroadcastTimer) {
    return;
  }

  clearInterval(nativePlaybackBroadcastTimer);
  nativePlaybackBroadcastTimer = null;
}

function registerAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { label: "About SPCBoy", click: () => openAboutWindow().catch((error) => console.error("[SPCBoy] about window failed", error)) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder or Track",
          accelerator: "CommandOrControl+O",
          click: () => openLibraryFromDialog().catch((error) => {
            console.error("[SPCBoy] open dialog failed", error);
          })
        }
      ]
    },
    {
      label: "Playback",
      submenu: [
        {
          label: "Previous",
          accelerator: "F7",
          click: () => sendTransportAction("previous")
        },
        {
          label: "Play/Pause",
          accelerator: "F8",
          click: () => sendTransportAction("toggle")
        },
        {
          label: "Next",
          accelerator: "F9",
          click: () => sendTransportAction("next")
        }
      ]
    },
    {
      label: "Options",
      submenu: [
        {
          label: "Settings",
          accelerator: "CommandOrControl+,",
          click: () => {
            if (optionsWindow && !optionsWindow.isDestroyed()) optionsWindow.close();
            else openOptionsWindow().catch((error) => console.error("[SPCBoy] open options failed", error));
          }
        },
        {
          label: "Close Options",
          accelerator: "CommandOrControl+W",
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if ((scanLogWindow?.isFocused() || focusedWindow === scanLogWindow) && !scanLogWindow.isDestroyed()) {
              scanLogWindow.close();
              return;
            }
            if (optionsWindow && !optionsWindow.isDestroyed()) optionsWindow.close();
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerMediaShortcuts() {
  const shortcuts = [
    ["F7", "previous"],
    ["F8", "toggle"],
    ["F9", "next"],
    ["MediaPreviousTrack", "previous"],
    ["MediaPlayPause", "toggle"],
    ["MediaNextTrack", "next"]
  ];

  for (const [accelerator, action] of shortcuts) {
    globalShortcut.register(accelerator, () => {
      sendTransportAction(action);
    });
  }
}

function normalizeFolderPath(folderPath) {
  return path.resolve(folderPath);
}

async function isDirectory(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

const { inspectTrack, inspectTrackVariants } = createTrackInspector({
  nativeAudio,
  cacheMaxEntries: METADATA_CACHE_MAX_ENTRIES
});
const playlistArchiveMetadata = createPlaylistArchiveMetadataService({
  materializeArchiveEntries: materializeArchiveEntriesForInspection,
  inspectTrack
});

async function readDirectoryFolders(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((entry) => ({
      id: path.join(folderPath, entry.name),
      name: entry.name,
      path: path.join(folderPath, entry.name)
    }));
}

async function readBrowserDirectory(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((entry) => ({
      id: path.join(folderPath, entry.name),
      kind: "folder",
      name: entry.name,
      path: path.join(folderPath, entry.name),
      children: [],
      childrenLoaded: false
    }));
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && (supportsPath(entry.name) || isSupportedArchivePath(entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((entry) => ({
      id: path.join(folderPath, entry.name),
      kind: "file",
      name: entry.name,
      path: path.join(folderPath, entry.name),
      parentPath: folderPath,
      children: [],
      childrenLoaded: true
    }));
  return [...folders, ...files];
}

async function hasSupportedAudioFiles(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(folderPath, entry.name);
      if (entry.isFile() && (supportsPath(entry.name) || isSupportedArchivePath(entryPath))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function buildTreeNode(folderPath) {
  const children = await readDirectoryFolders(folderPath);
  const nestedChildren = await mapConcurrent(children, TREE_BUILD_CONCURRENCY, (child) => buildTreeNode(child.path));
  const hasTracks = (await hasSupportedAudioFiles(folderPath)) || nestedChildren.some((child) => child.hasTracks);

  return {
    id: folderPath,
    name: path.basename(folderPath),
    path: folderPath,
    hasTracks,
    children: nestedChildren
  };
}

function flattenTree(nodes) {
  const result = [];

  for (const node of nodes) {
    result.push(node);
    result.push(...flattenTree(node.children));
  }

  return result;
}

function findFirstPlayablePath(nodes) {
  for (const node of nodes) {
    if (node.hasTracks) {
      return node.path;
    }

    const descendant = findFirstPlayablePath(node.children);
    if (descendant) {
      return descendant;
    }
  }

  return null;
}


async function expandBrowserPath(node, targetPath) {
  if (node.kind !== "folder" || node.path === targetPath || !targetPath.startsWith(`${node.path}${path.sep}`)) return;
  const nextFolder = node.children.find((child) => child.kind === "folder" && (targetPath === child.path || targetPath.startsWith(`${child.path}${path.sep}`)));
  if (!nextFolder) return;
  await loadBrowserNodeChildren(nextFolder);
  await expandBrowserPath(nextFolder, targetPath);
}

async function loadBrowserNodeChildren(node) {
  if (node.kind !== "folder" || node.childrenLoaded) return;
  node.children = await readBrowserDirectory(node.path).catch(() => []);
  node.childrenLoaded = true;
}

async function readTree(rootPath, selectedPath = null) {
  if (!(await isDirectory(rootPath))) return [];
  const root = await buildRawTreeNode(rootPath, true);
  if (selectedPath) await expandBrowserPath(root, selectedPath);
  return [root];
}

async function buildRawTreeNode(folderPath, loadChildren = false) {
  const children = loadChildren ? await readBrowserDirectory(folderPath).catch(() => []) : [];
  return {
    id: folderPath,
    kind: "folder",
    name: path.basename(folderPath),
    path: folderPath,
    children,
    childrenLoaded: loadChildren
  };
}

async function getDefaultRoot() {
  const envRoot = process.env.SPCBOY_LIBRARY_ROOT;
  if (envRoot && (await isDirectory(envRoot))) {
    return normalizeFolderPath(envRoot);
  }

  const fallbackRoots = [
    path.resolve(app.getAppPath(), "..", "SPC", "spcsets_extracted"),
    path.resolve(app.getAppPath(), "..", "spcsets_extracted"),
    path.resolve(app.getAppPath(), "..", "SPC", "gymsets_extracted"),
    path.resolve(app.getAppPath(), "..", "gymsets_extracted")
  ];

  for (const candidate of fallbackRoots) {
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function snapshotForRoot(rootPath, selectedFolderPath, includePlaylist = false) {
  if (!rootPath) {
    return {
      rootPath: null,
      tree: [],
      selectedFolderPath: null,
      selectedBrowserPath: null,
      playlist: []
    };
  }

  const resolvedRoot = normalizeFolderPath(rootPath);
  const preferredSelected = selectedFolderPath && (await isDirectory(selectedFolderPath))
    ? normalizeFolderPath(selectedFolderPath)
    : null;
  const resolvedSelected = preferredSelected || resolvedRoot;
  const tree = await readTree(resolvedRoot, resolvedSelected);
  // Startup and tree refreshes must remain browser-only. Constructing a
  // playlist here expands archives and can block the app for minutes on a
  // large persisted root. Explicit folder/file activation owns that work.
  const playlist = includePlaylist ? await readPlaylist(resolvedSelected) : [];

  return {
    rootPath: resolvedRoot,
    tree,
    selectedFolderPath: resolvedSelected,
    selectedBrowserPath: resolvedSelected,
    playlist
  };
}

async function resolveLibraryTarget(inputPath) {
  if (!inputPath) {
    return null;
  }

  const resolvedPath = normalizeFolderPath(inputPath);
  let stat;

  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    return null;
  }

  if (stat.isDirectory()) {
    return {
      rootPath: resolvedPath,
      selectedFolderPath: resolvedPath
    };
  }

  if (stat.isFile()) {
    const folderPath = normalizeFolderPath(path.dirname(resolvedPath));
    return {
      rootPath: folderPath,
      selectedFolderPath: folderPath
    };
  }

  return null;
}

async function snapshotForOpenPath(inputPath) {
  const target = await resolveLibraryTarget(inputPath);
  if (!target) {
    return null;
  }

  return {
    ...(await snapshotForRoot(target.rootPath, target.selectedFolderPath, true)),
    sidebarMode: "folders",
    sidebarQuery: "",
    selectedDatabaseGameKey: null
  };
}

function deliverLibrarySnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  pendingLibrarySnapshot = snapshot;

  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  mainWindow.webContents.send("library:snapshot", pendingLibrarySnapshot);
  pendingLibrarySnapshot = null;
}

async function chooseLibrarySnapshot() {
  const window = await ensureMainWindow();
  if (!window || window.isDestroyed()) {
    return null;
  }

  const result = await dialog.showOpenDialog(window, {
    properties: ["openDirectory", "openFile"],
    title: "Open SPC Folder or Track"
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return snapshotForOpenPath(result.filePaths[0]);
}

async function openLibraryFromDialog() {
  const snapshot = await chooseLibrarySnapshot();
  deliverLibrarySnapshot(snapshot);
  return snapshot;
}

async function openLibraryPath(inputPath) {
  const snapshot = await snapshotForOpenPath(inputPath);
  deliverLibrarySnapshot(snapshot);
  return snapshot;
}

async function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  await createWindow();
  return mainWindow;
}

async function createWindow() {
  const windowState = await loadWindowState();
  appIconPath = appIconPath || resolveRootPngIconPath();
  mainWindow = new BrowserWindow({
    width: windowState.bounds?.width ?? 1320,
    height: windowState.bounds?.height ?? 860,
    x: windowState.bounds?.x,
    y: windowState.bounds?.y,
    minWidth: 320,
    minHeight: 240,
    title: "SPCBoy",
    icon: appIconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  attachWebContentsDiagnostics(mainWindow, "main");

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const shortcutMap = {
      F7: "previous",
      F8: "toggle",
      F9: "next",
      MediaTrackPrevious: "previous",
      MediaPreviousTrack: "previous",
      MediaPlayPause: "toggle",
      MediaTrackNext: "next",
      MediaNextTrack: "next"
    };

    const fKey = shortcutMap[input.key] || shortcutMap[input.code];
    const lowerKey = typeof input.key === "string" ? input.key.toLowerCase() : "";
    if ((input.meta || input.control) && lowerKey === "q") {
      event.preventDefault();
      app.quit();
      return;
    }

    if ((input.meta || input.control) && lowerKey === "o") {
      event.preventDefault();
      openLibraryFromDialog().catch((error) => {
        console.error("[SPCBoy] shortcut open failed", error);
      });
      return;
    }

    const action = (input.meta || input.control) && input.key === ","
      ? "settings"
      : fKey;
    if (!action) {
      return;
    }

    event.preventDefault();
    sendTransportAction(action);
  });

  mainWindow.on("closed", () => {
    stopNativePlaybackBroadcasts();
    mainWindow = null;
  });
  mainWindow.on("focus", () => bringAppWindowsToFront(mainWindow));

  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("close", () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    Promise.resolve().then(() => saveWindowStateForWindow(mainWindow)).catch((error) => {
      console.error("[SPCBoy] close window state save failed", error);
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingLibrarySnapshot) {
      mainWindow.webContents.send("library:snapshot", pendingLibrarySnapshot);
      pendingLibrarySnapshot = null;
    }

    void syncNativePlaybackStateToWindow().catch(() => null);
  });

  await mainWindow.loadFile(path.join(app.getAppPath(), "web", "index.html"));
}

ipcMain.handle("app:bootstrap", async () => {
  if (pendingOpenPath) {
    const openPath = pendingOpenPath;
    pendingOpenPath = null;
    const snapshot = await snapshotForOpenPath(openPath);
    if (snapshot) {
      return snapshot;
    }
  }

  const defaultRoot = await getDefaultRoot();
  return snapshotForRoot(defaultRoot, defaultRoot);
});

ipcMain.handle("library:choose-root", async () => chooseLibrarySnapshot());
ipcMain.handle("library:database-location", async () => libraryDatabaseLocation());
ipcMain.handle("library:database-location-choose", async () => {
  const result = await dialog.showOpenDialog(optionsWindow || mainWindow, {
    title: "Choose Library Database",
    buttonLabel: "Choose Database",
    properties: ["openFile"],
    filters: [{ name: "SQLite Database", extensions: ["sqlite", "sqlite3", "db"] }]
  });
  const selectedPath = result.canceled ? null : result.filePaths[0];
  if (!selectedPath) return null;
  const events = await runMediaScanner({ command: "catalog", args: ["validate", selectedPath] });
  const validated = events.find((event) => event.kind === "catalogValidated")?.catalog;
  if (!validated) throw new Error("MediaScanner did not validate the selected database.");
  await saveLibraryDatabasePath(validated.path);
  return { ...libraryDatabaseLocation(), configuredPath: validated.path, requiresRestart: path.resolve(validated.path) !== path.resolve(libraryDatabase.databasePath), catalog: validated };
});
ipcMain.handle("library:database-location-default", async () => {
  await saveLibraryDatabasePath(defaultLibraryDatabasePath());
  return libraryDatabaseLocation();
});
ipcMain.handle("library:open-path", async (_event, inputPath) => {
  const droppedPath = normalizeFolderPath(inputPath);
  const droppedStat = await fs.stat(droppedPath).catch(() => null);
  if (droppedStat?.isFile() && !supportsPath(droppedPath) && !isSupportedArchivePath(droppedPath)) {
    throw new Error("Dropped file is not a supported audio file or archive.");
  }
  const snapshot = await snapshotForOpenPath(inputPath);
  if (!snapshot) throw new Error("Dropped path is not a readable library folder or supported file.");
  return snapshot;
});

ipcMain.handle("library:select-folder", async (_event, folderPath) => {
  const playlist = await readPlaylist(folderPath);
  return {
    selectedFolderPath: normalizeFolderPath(folderPath),
    selectedBrowserPath: normalizeFolderPath(folderPath),
    playlist
  };
});

ipcMain.handle("library:list-folder", async (_event, folderPath) => {
  return readBrowserDirectory(normalizeFolderPath(folderPath));
});

ipcMain.handle("library:select-file", async (_event, filePath) => {
  const resolvedPath = normalizeFolderPath(filePath);
  return {
    selectedFolderPath: path.dirname(resolvedPath),
    selectedBrowserPath: resolvedPath,
    playlist: await readPlaylistForFile(resolvedPath)
  };
});

ipcMain.handle("library:show-in-finder", async (_event, targetPath) => {
  const resolvedPath = normalizeFolderPath(targetPath);
  const stat = await fs.stat(resolvedPath).catch(() => null);
  if (!stat) throw new Error("The selected sidebar path no longer exists.");
  shell.showItemInFolder(resolvedPath);
  return true;
});

ipcMain.handle("library:refresh-tree", async (_event, rootPath, selectedFolderPath) =>
  snapshotForRoot(rootPath, selectedFolderPath));

ipcMain.handle("library:database-roots", async () => libraryDatabase.loadRoots());
ipcMain.handle("library:database-games", async () => libraryDatabase.loadGames());
ipcMain.handle("library:database-search-games", async (_event, query) => searchDatabaseGames(query));
ipcMain.handle("library:database-search-browser", async (_event, rootPath, query) =>
  searchDatabaseBrowser(normalizeFolderPath(rootPath), query));
ipcMain.handle("library:database-game-tracks", async (_event, games) => {
  const rows = await libraryDatabase.tracksForGames(Array.isArray(games) ? games : []);
  return rows.map((row) => ({
    ...row,
    playlistId: playlistTrackIdentity(row.archivePath || row.path, row.archiveEntry, row.trackIndex)
  }));
});
ipcMain.handle("library:database-maintenance-summary", async () => {
  if (!libraryDatabase) throw new Error("Library database is not initialized");
  return {
    indexedTrackCount: await libraryDatabase.trackCount(),
    unlinkedSourceCount: await libraryDatabase.deadSourceCount(),
    unlinkedTrackCount: await libraryDatabase.deadTrackCount(),
    databaseStorage: await libraryDatabase.databaseStorageMetrics(),
    archiveCache: { ...await archiveCacheSummary(), recovery: archiveCacheRecovery }
  };
});
ipcMain.handle("library:archive-cache-summary", async () => ({
  ...await archiveCacheSummary(),
  enabled: archiveCacheSettings.enabled,
  limitBytes: archiveCacheSettings.limitBytes
}));
ipcMain.handle("library:archive-cache-clear", async () => {
  if (playbackPowerSaveBlockerId !== null) throw new Error("Stop playback before clearing the archive cache.");
  if (isArchiveCacheBusy()) throw new Error("Wait for archive materialization to finish before clearing the archive cache.");
  return clearArchiveCache();
});
ipcMain.handle("library:archive-cache-configure", async (_event, settings) => configureArchiveCache(settings));
ipcMain.handle("app:open-options", async () => openOptionsWindow());
ipcMain.handle("app:close-options", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === optionsWindow) window.close();
});
ipcMain.handle("app:open-scan-log", async (_event, root) => openScanLogWindow(root));
ipcMain.on("app:console-view-changed", (event, enabled) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed() && window !== sender) {
      window.webContents.send("app:console-view-changed", Boolean(enabled));
    }
  }
});
ipcMain.on("app:playback-settings-changed", (event, settings) => {
  if (settings && (typeof settings.archiveCacheEnabled === "boolean" || settings.archiveCacheLimitBytes !== undefined)) {
    void configureArchiveCache({
      enabled: settings.archiveCacheEnabled,
      limitBytes: settings.archiveCacheLimitBytes
    }).catch((error) => console.error("[SPCBoy] archive cache setting update failed", error));
  }
  const sender = BrowserWindow.fromWebContents(event.sender);
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed() && window !== sender) {
      window.webContents.send("app:playback-settings-changed", settings || {});
    }
  }
});
ipcMain.handle("app:routing-preferences-set", (event, preferences) => {
  const normalizedPreferences = setRoutingPreferences(preferences);
  const sender = BrowserWindow.fromWebContents(event.sender);
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed() && window !== sender) {
      window.webContents.send("app:routing-preferences-changed", normalizedPreferences);
    }
  }
  return normalizedPreferences;
});
ipcMain.on("app:appearance-settings-changed", (event, settings) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed() && window !== sender) {
      window.webContents.send("app:appearance-settings-changed", settings || {});
    }
  }
});

ipcMain.handle("playlist:inspect-track", async (_event, trackPath, sourceName) => inspectTrack(trackPath, sourceName || trackPath));
ipcMain.handle("playlist:hydrate-loose-metadata", async (_event, track) => {
  const inspection = await inspectTrack(
    track.inspectionPath || track.path,
    track.sourceFilename || track.path
  );
  if (!libraryDatabase?.isReadOnly) await libraryDatabase?.updatePlaylistMetadata([{
    path: track.path,
    trackIndex: track.trackIndex,
    fileSize: track.fileSize,
    modifiedAt: track.modifiedAt,
    sourceSignature: track.sourceSignature,
    scanVersion: track.scanVersion,
    metadata: {
      title: inspection.metadata.song,
      game: inspection.metadata.game,
      artist: inspection.metadata.author,
      system: inspection.metadata.system,
      playLengthMs: Math.round(Math.max(0, Number(inspection.basePlaybackSeconds) || 0) * 1000)
    }
  }]);
  return inspection;
});
ipcMain.handle("playlist:hydrate-archive-metadata", async (_event, tracks) => {
  const updates = await playlistArchiveMetadata.hydrate(tracks);
  if (!libraryDatabase?.isReadOnly) await libraryDatabase?.updatePlaylistMetadata(updates.map((update) => ({
    path: update.path,
    archivePath: update.archivePath,
    archiveEntry: update.archiveEntry,
    trackIndex: update.trackIndex,
    fileSize: update.fileSize,
    modifiedAt: update.modifiedAt,
    sourceSignature: update.sourceSignature,
    scanVersion: update.scanVersion,
    metadata: {
      title: update.inspection.metadata.song,
      game: update.inspection.metadata.game,
      artist: update.inspection.metadata.author,
      system: update.inspection.metadata.system,
      playLengthMs: Math.round(Math.max(0, Number(update.inspection.basePlaybackSeconds) || 0) * 1000)
    }
  })));
  return updates;
});
ipcMain.handle("playlist:materialize-track", async (_event, archivePath, archiveEntry) => {
  await releaseArchivePlaybackMaterialization();
  if (!archiveCacheSettings.enabled) {
    const materialized = await materializeArchiveEntryForPlayback(archivePath, archiveEntry);
    activeArchivePlaybackMaterialization = materialized;
    return materialized.path;
  }
  const playbackPath = await materializeZipEntry(archivePath, archiveEntry, {
    cacheLimitBytes: archiveCacheSettings.limitBytes
  });
  activeArchivePlaybackMaterialization = { path: playbackPath, cleanup: null };
  return playbackPath;
});
ipcMain.handle("playlist:release-materialized-track", async () => {
  await releaseArchivePlaybackMaterialization();
  return true;
});

ipcMain.handle("playlist:decode-track-pcm", async (_event, trackPath, trackIndex, startMs, playMs, fadeMs, specialAudioKind) => {
  if (specialAudioKind === "nds-swav") {
    return Uint8Array.from(await nativeAudio.decodeNdsSwav(trackPath, trackIndex, startMs, playMs, fadeMs));
  }
  if (specialAudioKind === "nds-raw-pcm22") {
    return Uint8Array.from(await nativeAudio.decodeNdsRawPcm22(trackPath, startMs, playMs));
  }
  const backend = backendForPath(trackPath)?.id;
  const decoded = backend === "openmpt"
    ? await nativeAudio.decodeOpenMpt(trackPath, startMs, playMs)
    : backend === "standard-audio"
      ? await nativeAudio.decodeFfmpeg(trackPath, startMs, playMs)
      : backend === "libvgm"
        ? await nativeAudio.decodeLibVgm(trackPath, startMs, playMs, fadeMs)
        : backend === "vgmstream"
          ? await nativeAudio.decodeGme(trackPath, trackIndex, startMs, playMs, fadeMs)
          : backend === "lazyusf"
            ? await nativeAudio.decodeLazyUsf(trackPath, startMs, playMs)
            : await nativeAudio.decodeGme(trackPath, trackIndex, startMs, playMs, fadeMs);
  return Uint8Array.from(decoded);
});

ipcMain.handle("playlist:playback-session-open", async (_event, trackPath, trackIndex, startMs, playMs, fadeMs) => {
  await nativeAudio.openSession(trackPath, trackIndex, startMs, playMs, fadeMs);
  return true;
});

ipcMain.handle("playlist:playback-session-read", async (_event, frameCount) => {
  const decoded = await nativeAudio.readSession(frameCount);
  return Uint8Array.from(decoded);
});

ipcMain.handle("playlist:playback-session-close", async () => {
  await nativeAudio.closeSession();
  return true;
});

ipcMain.handle("playback:native-init", async () => {
  const result = await nativeAudio.initializeNativePlayback();
  startNativePlaybackBroadcasts();
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-load", async (_event, trackPath, trackIndex, startMs, playMs, fadeMs, speed) => {
  const result = await nativeAudio.loadNativePlayback(trackPath, trackIndex, startMs, playMs, fadeMs, speed);
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-play", async () => {
  const result = await nativeAudio.playNativePlayback();
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-pause", async () => {
  const result = await nativeAudio.pauseNativePlayback();
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-stop", async () => {
  const result = await nativeAudio.stopNativePlayback();
  await releaseArchivePlaybackMaterialization();
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-unload", async () => {
  const result = await nativeAudio.unloadNativePlayback();
  await releaseArchivePlaybackMaterialization();
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-ramp-gain", async (_event, gain, durationMs) => {
  return nativeAudio.rampNativePlaybackGain(gain, durationMs);
});

ipcMain.handle("playback:native-seek", async (_event, startMs) => {
  const result = await nativeAudio.seekNativePlayback(startMs);
  await syncNativePlaybackStateToWindow().catch(() => null);
  return result;
});

ipcMain.handle("playback:native-state", async () => nativeAudio.nativePlaybackState());
ipcMain.handle("playback:native-audio-config", async (_event, volume, equalizerEnabled, bandGains) => {
  return nativeAudio.configureNativePlaybackAudio(volume, equalizerEnabled, bandGains);
});

ipcMain.handle("playback:native-close", async () => {
  await nativeAudio.closeNativePlayback();
  await releaseArchivePlaybackMaterialization();
  stopNativePlaybackBroadcasts();
  return true;
});

ipcMain.handle("playback:set-power-save-blocker", async (_event, enabled) => {
  setPlaybackPowerSaveBlockerEnabled(Boolean(enabled));
  return true;
});

app.on("second-instance", () => {
  if (app.isReady()) bringAppWindowsToFront();
});

app.whenReady().then(async () => {
  if (!ownsSingleInstance) return;
  archiveCacheRecovery = await recoverArchiveCachePartials();
  await recoverAbandonedInspectionScratchRoots();
  playbackScratchRecovery = await recoverAbandonedPlaybackScratchRoots();
  libraryDatabase = new CanonicalLibraryReader(configuredLibraryDatabasePath());
  await libraryDatabase.initialize();
  appIconPath = resolveRootPngIconPath();
  if (process.platform === "darwin" && app.dock && appIconPath) {
    app.dock.setIcon(appIconPath);
  }

  registerAppMenu();
  registerMediaShortcuts();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
      return;
    }
    bringAppWindowsToFront();
  });
});

app.on("browser-window-focus", (_event, focusedWindow) => {
  bringAppWindowsToFront(focusedWindow);
});

app.on("open-file", (event, targetPath) => {
  event.preventDefault();

  if (!app.isReady()) {
    pendingOpenPath = targetPath;
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = targetPath;
    ensureMainWindow();
    return;
  }

  openLibraryPath(targetPath).catch((error) => {
    console.error("[SPCBoy] open-file failed", error);
  });
});

app.on("before-quit", (event) => {
  if (activeArchivePlaybackMaterialization && !quitAfterArchivePlaybackCleanup) {
    event.preventDefault();
    nativeAudio.terminate();
    void releaseArchivePlaybackMaterialization().finally(() => {
      quitAfterArchivePlaybackCleanup = true;
      app.quit();
    });
    return;
  }
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
  }
  nativeAudio.terminate();
  void libraryDatabase?.close().catch((error) => {
    console.error("[SPCBoy] SQLite worker shutdown failed", error);
  });
  setPlaybackPowerSaveBlockerEnabled(false);
  Promise.resolve().then(() => saveWindowState()).catch((error) => {
    console.error("[SPCBoy] final window state save failed", error);
  });
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
