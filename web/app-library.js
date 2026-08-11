(() => {
const app = window.SPCBoyApp;
const { state, refs, persistSettings } = app;

function renderAll() {
  app.ui.renderAll();
}

function refreshDatabaseGamesForVisibleRoots() {
  return app.ui.refreshDatabaseGamesForVisibleRoots();
}

function scanCompleteStatus(trackCount, warningCount, scratch = null) {
  const diagnostics = scratch
    ? ` • Scratch peak ${(Number(scratch.peakBytes || 0) / (1024 * 1024)).toFixed(0)} MB • recovered ${scratch.recoveredRootCount || 0}/${(Number(scratch.recoveredBytes || 0) / (1024 * 1024)).toFixed(0)} MB`
    : "";
  return `Scan complete • ${trackCount} tracks${warningCount ? ` • ${warningCount} archive warning${warningCount === 1 ? "" : "s"}` : ""}${diagnostics}`;
}

async function refreshLibraryRoots() {
  if (!window.spcBoy?.databaseRoots) return;
  state.libraryRoots = await window.spcBoy.databaseRoots();
  renderAll();
}

async function addLibraryRoot() {
  const rootPaths = await window.spcBoy.chooseLibraryPath();
  if (!rootPaths?.length) return;
  for (const rootPath of rootPaths) await window.spcBoy.databaseAddRoot(rootPath);
  state.libraryScanStatus = `Added ${rootPaths.length} library path${rootPaths.length === 1 ? "" : "s"}. Select Scan Selected to begin.`;
  await refreshLibraryRoots();
}

async function selectAllLibraryRoots() {
  await window.spcBoy.databaseSetRootsEnabled(state.libraryRoots.map((root) => root.id), true);
}

async function scanOneLibraryRoot(root, deepScan = state.libraryDeepScanEnabled) {
  state.libraryOperationActive = true;
  state.libraryScanStatus = "Preparing scan…";
  state.libraryScanCurrentFile = root.path;
  state.libraryScanProgress = { completed: 0, total: 0, path: root.path };
  renderAll();
  try {
    const result = await window.spcBoy.scanDatabaseRoot(root.path, deepScan);
    state.libraryRoots = await window.spcBoy.databaseRoots();
    state.databaseGames = await window.spcBoy.databaseGames();
    state.databaseSearchGames = null;
    state.libraryScanStatus = scanCompleteStatus(result.trackCount, result.warningCount, result.scratch);
  } catch (error) {
    state.libraryScanStatus = error.message === "Library operation cancelled" ? "Scan cancelled." : `Scan failed • ${error.message}`;
  } finally {
    state.libraryOperationActive = false;
    state.libraryScanProgress = null;
    state.libraryScanCurrentFile = "";
  }
  renderAll();
}

async function scanLibrary() {
  const root = state.libraryRoots.find((entry) => entry.is_enabled) || state.libraryRoots[0];
  if (!root) {
    state.libraryScanStatus = "Add a library folder first.";
    renderAll();
    return;
  }
  await scanOneLibraryRoot(root);
}

async function setLibraryRootEnabled(rootId, enabled) {
  await window.spcBoy.databaseSetRootEnabled(rootId, enabled);
}

async function handleLibraryRootsChanged(roots) {
  state.libraryRoots = Array.isArray(roots) ? roots : [];
  await refreshDatabaseGamesForVisibleRoots();
  if (state.sidebarMode !== "folders") {
    renderAll();
    return;
  }

  const enabledRoots = state.libraryRoots.filter((root) => root.is_enabled);
  const activeRoot = enabledRoots.find((root) => root.path === state.rootPath) || enabledRoots[0] || null;
  if (!activeRoot) {
    state.rootPath = null;
    state.tree = [];
    state.selectedFolderPath = null;
    state.selectedBrowserPath = null;
    state.playlist = [];
    state.selectedTrackId = null;
    state.lastSelectedTrackId = null;
    persistSettings();
    renderAll();
    return;
  }
  if (activeRoot.path !== state.rootPath) {
    const snapshot = await window.spcBoy.refreshTree(activeRoot.path, activeRoot.path);
    Object.assign(state, snapshot);
    state.selectedTrackId = app.ui.resolveSelectedTrackId(snapshot.playlist);
    state.lastSelectedTrackId = state.selectedTrackId;
    persistSettings();
  }
  renderAll();
  app.ui.syncTreeSelection();
}

async function moveLibraryRoot(rootId, direction) {
  state.libraryRoots = await window.spcBoy.databaseMoveRoot(rootId, direction);
  renderAll();
}

async function removeLibraryRoot(rootId) {
  state.libraryRoots = await window.spcBoy.databaseRemoveRoot(rootId);
  await refreshDatabaseGamesForVisibleRoots();
  // Removing an indexed root is not a scan. Do not surface the scan-status
  // card or its Cancel control for a completed database-only operation.
  state.libraryScanStatus = "No scan started.";
  state.libraryScanCurrentFile = "";
  state.libraryScanProgress = null;
  state.libraryOperationActive = false;
  renderAll();
}

async function scanLibraryRoot(rootId) {
  const root = state.libraryRoots.find((entry) => Number(entry.id) === Number(rootId));
  if (!root) return;
  await scanOneLibraryRoot(root);
}

async function scanSelectedLibraries(deepScan = false) {
  if (state.libraryOperationActive) return;
  const selectedRoots = state.libraryRoots.filter((root) => root.is_enabled);
  if (!selectedRoots.length) {
    state.libraryScanStatus = "Select at least one library folder first.";
    renderAll();
    return;
  }
  state.libraryOperationActive = true;
  const folderLabel = `${selectedRoots.length} selected library folder${selectedRoots.length === 1 ? "" : "s"}`;
  state.libraryScanStatus = `${deepScan ? "Preparing deep scan" : "Preparing scan"} of ${folderLabel}…`;
  state.libraryScanCurrentFile = "";
  state.libraryScanProgress = { completed: 0, total: 0, path: folderLabel };
  renderAll();
  try {
    const results = await window.spcBoy.scanAllDatabaseRoots(deepScan);
    state.libraryRoots = await window.spcBoy.databaseRoots();
    state.databaseGames = await window.spcBoy.databaseGames();
    state.databaseSearchGames = null;
    const warningCount = results.reduce((sum, result) => sum + (result.warningCount || 0), 0);
    state.libraryScanStatus = scanCompleteStatus(results.reduce((sum, result) => sum + result.trackCount, 0), warningCount, results.at(-1)?.scratch);
  } catch (error) {
    state.libraryScanStatus = error.message === "Library operation cancelled" ? "Scan cancelled." : `Scan failed • ${error.message}`;
  } finally {
    state.libraryOperationActive = false;
    state.libraryScanProgress = null;
    state.libraryScanCurrentFile = "";
  }
  renderAll();
}

async function trimMissingLibrary() {
  if (state.libraryOperationActive) return;
  state.libraryOperationActive = true;
  state.libraryScanStatus = "Checking indexed source paths…";
  renderAll();
  try {
    const result = await window.spcBoy.trimMissingDatabaseSources();
    await app.ui.handleLibraryDatabaseChanged(result);
    await refreshDatabaseMaintenanceSummary();
    state.libraryScanStatus = `Test Files • ${result.checkedSourceCount} sources checked • ${result.missingSourceCount} missing retained`;
  } catch (error) {
    state.libraryScanStatus = error.message === "Library operation cancelled" ? "Test Files cancelled." : `Test Files failed • ${error.message}`;
  } finally {
    state.libraryOperationActive = false;
  }
  renderAll();
}

async function purgeUnlinkedLibrary() {
  if (!window.spcBoy?.purgeUnlinkedDatabaseSources || state.libraryOperationActive) return;
  state.libraryOperationActive = true;
  state.libraryScanStatus = "Purging unlinked database sources…";
  renderAll();
  try {
    const result = await window.spcBoy.purgeUnlinkedDatabaseSources();
    state.libraryRoots = await window.spcBoy.databaseRoots();
    await refreshDatabaseGamesForVisibleRoots();
    state.libraryScanStatus = `Clear Unlinked • ${result.purgedSourceCount} sources cleared • ${result.purgedTrackCount} tracks removed`;
    await refreshDatabaseMaintenanceSummary();
  } catch (error) {
    state.libraryScanStatus = `Clear Unlinked failed • ${error.message}`;
  } finally {
    state.libraryOperationActive = false;
  }
  renderAll();
}

async function clearLibraryDatabase() {
  if (!window.spcBoy?.clearLibraryDatabase || state.libraryOperationActive) return;
  state.libraryOperationActive = true;
  state.libraryScanStatus = "Clearing database…";
  renderAll();
  try {
    const result = await window.spcBoy.clearLibraryDatabase();
    state.libraryRoots = await window.spcBoy.databaseRoots();
    state.databaseGames = [];
    state.databaseSearchGames = null;
    state.libraryScanStatus = `Database cleared • ${result.clearedTrackCount} tracks removed`;
    await refreshDatabaseMaintenanceSummary();
  } catch (error) {
    state.libraryScanStatus = `Clear Database failed • ${error.message}`;
  } finally {
    state.libraryOperationActive = false;
  }
  renderAll();
}

async function refreshDatabaseMaintenanceSummary() {
  if (!window.spcBoy?.databaseMaintenanceSummary) return;
  try {
    state.databaseMaintenanceSummary = await window.spcBoy.databaseMaintenanceSummary();
  } catch (error) {
    state.databaseMaintenanceSummary = null;
    state.libraryScanStatus = `Database stats unavailable • ${error.message}`;
  }
  renderAll();
}

async function clearLibraryArchiveCache() {
  if (!window.spcBoy?.clearArchiveCache || state.libraryOperationActive) return;
  state.libraryOperationActive = true;
  state.libraryScanStatus = "Clearing archive cache…";
  renderAll();
  try {
    await window.spcBoy.clearArchiveCache();
    state.libraryScanStatus = "Archive cache cleared.";
  } catch (error) {
    state.libraryScanStatus = `Clear Cache failed • ${error.message}`;
  } finally {
    state.libraryOperationActive = false;
    await refreshDatabaseMaintenanceSummary();
  }
  renderAll();
}

async function cancelLibraryOperation() {
  if (!state.libraryOperationActive) return;
  state.libraryScanStatus = "Cancelling…";
  refs.libraryScanStatus.textContent = state.libraryScanStatus;
  await window.spcBoy.cancelLibraryOperation();
}

Object.assign(app.ui, {
  refreshLibraryRoots,
  addLibraryRoot,
  selectAllLibraryRoots,
  scanLibrary,
  setLibraryRootEnabled,
  handleLibraryRootsChanged,
  moveLibraryRoot,
  removeLibraryRoot,
  scanLibraryRoot,
  scanSelectedLibraries,
  trimMissingLibrary,
  purgeUnlinkedLibrary,
  clearLibraryDatabase,
  refreshDatabaseMaintenanceSummary,
  clearLibraryArchiveCache,
  cancelLibraryOperation
});
})();
