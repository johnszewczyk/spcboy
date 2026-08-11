const fsSync = require("fs");
const fs = fsSync.promises;
const path = require("path");
const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, powerSaveBlocker, shell } = require("electron");
const { LibraryDatabase } = require("./library-database");
const { BACKEND_MODULES, backendForPath, setRoutingPreferences, supportsNativePlayback, supportsPath } = require("./playback-core");
const { archiveCacheSummary, clearArchiveCache, pruneArchiveCache, isArchiveCacheBusy, materializeZipEntry, materializeArchiveEntryForPlayback, materializeArchiveEntriesForScan, isSupportedArchivePath, recoverAbandonedScanScratchRoots, recoverAbandonedPlaybackScratchRoots, DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES, MIN_ARCHIVE_CACHE_LIMIT_BYTES, MAX_ARCHIVE_CACHE_LIMIT_BYTES } = require("./archive-resolver");
const { scanLibraryRoot: scanLibraryRootService } = require("./library-scan-service");
const { discoverPhysicalSources } = require("./scanner-discovery");
const { expandArchiveSources, ARCHIVE_LIST_CONCURRENCY } = require("./scanner-archive");
const { createPlaylistReader } = require("./library-playlist");
const { createNativeAudioTools } = require("./native-audio-tools");
const { createTrackInspector } = require("./track-inspector");
const { createPlaylistArchiveMetadataService } = require("./playlist-archive-metadata");

// SPCBoy originally persisted its library, window state, and renderer settings
// under the package-name profile. Keep that durable profile while presenting
// the application as SPCBoy; changing app.setName alone silently created a
// second empty profile and made the app look like an old/default install.
const LEGACY_USER_DATA_DIRECTORY = "spcboy-electron-port";
app.setName("SPCBoy");
app.setPath("userData", path.join(app.getPath("appData"), LEGACY_USER_DATA_DIRECTORY));

const SCAN_VERSION = 2;
const TREE_BUILD_CONCURRENCY = 24;
const RAW_TREE_CONCURRENCY = 8;
const LIBRARY_SCAN_CONCURRENCY = 8;
const METADATA_CACHE_MAX_ENTRIES = 2048;
const WINDOW_STATE_FILE_NAME = "window-state.json";
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
let activeLibraryJob = null;
let scanScratchRecovery = { recoveredRootCount: 0, recoveredBytes: 0 };
let playbackScratchRecovery = { recoveredRootCount: 0, recoveredBytes: 0 };
let quitAfterLibraryCleanup = false;
let quitAfterArchivePlaybackCleanup = false;
let activeArchivePlaybackMaterialization = null;
let archiveCacheSettings = { enabled: true, limitBytes: DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES };
const { readPlaylist, readPlaylistForFile } = createPlaylistReader({
  fs,
  path,
  supportsPath,
  isSupportedArchivePath,
  discoverPhysicalSources,
  expandArchiveSources,
  archiveListConcurrency: ARCHIVE_LIST_CONCURRENCY
});
let activeLibraryProgress = null;
let nextLibraryJobId = 1;

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

function beginLibraryJob(operation) {
  if (activeLibraryJob) throw new Error(`${activeLibraryJob.operation} is already running`);
  const job = { id: nextLibraryJobId++, operation, cancelled: false };
  activeLibraryJob = job;
  return job;
}

function throwIfLibraryJobCancelled(job) {
  if (job?.cancelled) throw new Error("Library operation cancelled");
}

function libraryOperationState() {
  return {
    active: Boolean(activeLibraryJob),
    jobId: activeLibraryJob?.id || 0,
    operation: activeLibraryJob?.operation || null,
    progress: activeLibraryProgress,
    scratchRecovery: scanScratchRecovery,
    playbackScratchRecovery
  };
}

function broadcastLibraryOperationState() {
  const state = libraryOperationState();
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("library:operation-state-changed", state);
  }
}

function broadcastLibraryProgress(progress) {
  const progressWithJob = {
    ...progress,
    jobId: activeLibraryJob?.id || 0
  };
  activeLibraryProgress = progressWithJob;
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("library:scan-progress", progressWithJob);
  }
}

function bringAppWindowsToFront(preferredWindow = null) {
  const windows = [mainWindow, optionsWindow, scanLogWindow, aboutWindow]
    .filter((window) => window && !window.isDestroyed());
  for (const window of windows) {
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.showInactive();
    if (typeof window.moveTop === "function") window.moveTop();
  }

  const focusedWindow = preferredWindow && !preferredWindow.isDestroyed()
    ? preferredWindow
    : BrowserWindow.getFocusedWindow() || mainWindow;
  if (focusedWindow && !focusedWindow.isFocused()) focusedWindow.focus();
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

async function withLibraryJob(operation, work) {
  const job = beginLibraryJob(operation);
  activeLibraryProgress = { operation: "prepare", completed: 0, total: 0, path: operation, jobId: job.id };
  broadcastLibraryOperationState();
  try {
    return await work(job);
  } finally {
    if (activeLibraryJob === job) {
      activeLibraryJob = null;
      activeLibraryProgress = null;
      broadcastLibraryOperationState();
    }
  }
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

const { inspectTrack, inspectTrackVariantsForScan } = createTrackInspector({
  nativeAudio,
  cacheMaxEntries: METADATA_CACHE_MAX_ENTRIES
});
const playlistArchiveMetadata = createPlaylistArchiveMetadataService({
  materializeArchiveEntries: materializeArchiveEntriesForScan,
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

async function scanLibraryRoot(rootPath, inheritedJob = null, options = {}) {
  if (!inheritedJob) return withLibraryJob("Library scan", (job) => scanLibraryRoot(rootPath, job, options));
  return scanLibraryRootService({
    rootPath,
    job: inheritedJob,
    database: libraryDatabase,
    inspectTrackVariants: inspectTrackVariantsForScan,
    onProgress: broadcastLibraryProgress,
    deepScan: Boolean(options.deepScan),
    scanVersion: SCAN_VERSION,
    scanConcurrency: LIBRARY_SCAN_CONCURRENCY,
    scratchRecovery: scanScratchRecovery
  });
}

async function trimMissingLibrary(inheritedJob = null) {
  if (!inheritedJob) return withLibraryJob("Test Files", (job) => trimMissingLibrary(job));
  const job = inheritedJob;
  if (!libraryDatabase) throw new Error("Library database is not initialized");
  const sources = await libraryDatabase.indexedSources();
  const missingSources = [];
  let lastProgressAt = 0;
  for (let index = 0; index < sources.length; index += 1) {
    throwIfLibraryJobCancelled(job);
    const source = sources[index];
    try {
      await fs.access(source.path);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        missingSources.push(source);
      } else {
        throw new Error(`Cannot access indexed source: ${source.path} (${error?.code || error?.message || "unknown error"})`);
      }
    }
    const now = Date.now();
    if (now - lastProgressAt >= 100 || index + 1 === sources.length) {
      lastProgressAt = now;
      broadcastLibraryProgress({
        operation: "trim",
        completed: index + 1,
        total: sources.length,
        path: source.path
      });
    }
  }
  throwIfLibraryJobCancelled(job);
  const result = await libraryDatabase.markSourcesDead(missingSources);
  return {
    ...result,
    checkedSourceCount: sources.length,
    missingSourceCount: missingSources.length,
    missingSourcePaths: missingSources.map((source) => source.path),
    roots: await libraryDatabase.loadRoots()
  };
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

async function chooseLibraryPath() {
  const window = await ensureMainWindow();
  if (!window || window.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(window, {
    properties: ["openDirectory", "multiSelections"],
    title: "Add Library Folders"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const rootPaths = [];
  for (const selectedPath of result.filePaths) {
    const target = await resolveLibraryTarget(selectedPath);
    if (target?.rootPath && !rootPaths.includes(target.rootPath)) rootPaths.push(target.rootPath);
  }
  return rootPaths;
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
ipcMain.handle("library:choose-path", async () => chooseLibraryPath());
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
ipcMain.handle("library:operation-state", async () => ({
  ...libraryOperationState()
}));
function broadcastLibraryRoots(roots) {
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("library:roots-changed", roots);
  }
}

ipcMain.handle("library:database-add-root", async (_event, rootPath) => {
  const roots = await libraryDatabase.ensureRoot(normalizeFolderPath(rootPath));
  broadcastLibraryRoots(await libraryDatabase.loadRoots());
  return roots;
});
ipcMain.handle("library:database-remove-root", async (_event, rootId) => libraryDatabase.removeRoot(rootId));
ipcMain.handle("library:database-set-root-enabled", async (_event, rootId, enabled) => {
  const roots = await libraryDatabase.setRootEnabled(rootId, enabled);
  broadcastLibraryRoots(roots);
  return roots;
});
ipcMain.handle("library:database-set-roots-enabled", async (_event, rootIds, enabled) => {
  for (const rootId of Array.isArray(rootIds) ? rootIds : []) {
    await libraryDatabase.setRootEnabled(rootId, enabled);
  }
  const roots = await libraryDatabase.loadRoots();
  broadcastLibraryRoots(roots);
  return roots;
});
ipcMain.handle("library:database-move-root", async (_event, rootId, direction) => libraryDatabase.moveRoot(rootId, direction));
ipcMain.handle("library:database-games", async () => libraryDatabase.loadGames());
ipcMain.handle("library:database-search-games", async (_event, query) => libraryDatabase.searchGames(query));
ipcMain.handle("library:database-search-browser", async (_event, rootPath, query) =>
  libraryDatabase.searchBrowserEntries(normalizeFolderPath(rootPath), query));
ipcMain.handle("library:database-game-tracks", async (_event, games) => {
  return libraryDatabase.tracksForGames(Array.isArray(games) ? games : []);
});
ipcMain.handle("library:database-scan", async (_event, rootPath, deepScan = false) => scanLibraryRoot(rootPath, null, { deepScan }));
ipcMain.handle("library:database-scan-all", async (_event, deepScan = false) => {
  return withLibraryJob("Library scan", async (job) => {
    const roots = (await libraryDatabase.loadRoots()).filter((root) => root.is_enabled);
    const results = [];
    for (const root of roots) {
      throwIfLibraryJobCancelled(job);
      results.push(await scanLibraryRoot(root.path, job, { deepScan }));
    }
    return results;
  });
});
ipcMain.handle("library:database-trim-missing", async (event) => {
  const result = await trimMissingLibrary();
  for (const window of [mainWindow, optionsWindow]) {
    if (window && !window.isDestroyed() && window.webContents !== event.sender) {
      window.webContents.send("library:database-changed", result);
    }
  }
  return result;
});
ipcMain.handle("library:database-purge-unlinked", async () => {
  if (!libraryDatabase) throw new Error("Library database is not initialized");
  return libraryDatabase.deleteDeadSources();
});
ipcMain.handle("library:database-clear", async () => {
  if (!libraryDatabase) throw new Error("Library database is not initialized");
  return libraryDatabase.clearDatabase();
});
ipcMain.handle("library:database-maintenance-summary", async () => {
  if (!libraryDatabase) throw new Error("Library database is not initialized");
  return {
    indexedTrackCount: await libraryDatabase.trackCount(),
    unlinkedSourceCount: await libraryDatabase.deadSourceCount(),
    unlinkedTrackCount: await libraryDatabase.deadTrackCount(),
    archiveCache: await archiveCacheSummary()
  };
});
ipcMain.handle("library:archive-cache-summary", async () => ({
  ...await archiveCacheSummary(),
  enabled: archiveCacheSettings.enabled,
  limitBytes: archiveCacheSettings.limitBytes
}));
ipcMain.handle("library:archive-cache-clear", async () => {
  if (activeLibraryJob) throw new Error("Stop the library operation before clearing the archive cache.");
  if (playbackPowerSaveBlockerId !== null) throw new Error("Stop playback before clearing the archive cache.");
  if (isArchiveCacheBusy()) throw new Error("Wait for archive materialization to finish before clearing the archive cache.");
  return clearArchiveCache();
});
ipcMain.handle("library:archive-cache-configure", async (_event, settings) => configureArchiveCache(settings));
ipcMain.handle("library:database-cancel-operation", async () => {
  if (!activeLibraryJob) return false;
  activeLibraryJob.cancelled = true;
  return true;
});
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
ipcMain.handle("playlist:hydrate-archive-metadata", async (_event, tracks) => {
  const updates = await playlistArchiveMetadata.hydrate(tracks);
  await libraryDatabase?.updatePlaylistMetadata(updates.map((update) => ({
    path: update.path,
    archivePath: update.archivePath,
    archiveEntry: update.archiveEntry,
    trackIndex: update.trackIndex,
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

app.whenReady().then(async () => {
  scanScratchRecovery = await recoverAbandonedScanScratchRoots();
  playbackScratchRecovery = await recoverAbandonedPlaybackScratchRoots();
  libraryDatabase = new LibraryDatabase(path.join(app.getPath("userData"), "Library.sqlite"));
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
  if (activeLibraryJob && !quitAfterLibraryCleanup) {
    event.preventDefault();
    activeLibraryJob.cancelled = true;
    const job = activeLibraryJob;
    const waitForCleanup = () => {
      if (activeLibraryJob !== job) {
        quitAfterLibraryCleanup = true;
        app.quit();
        return;
      }
      setTimeout(waitForCleanup, 25);
    };
    waitForCleanup();
    return;
  }
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
