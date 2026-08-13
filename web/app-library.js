(() => {
const app = window.SPCBoyApp;
const { state, persistSettings } = app;

function renderAll() {
  app.ui.renderAll();
}

function refreshDatabaseGamesForVisibleRoots() {
  return app.ui.refreshDatabaseGamesForVisibleRoots();
}

async function refreshLibraryRoots() {
  if (!window.spcBoy?.databaseRoots) return;
  state.libraryRoots = await window.spcBoy.databaseRoots();
  renderAll();
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

async function refreshDatabaseMaintenanceSummary() {
  if (!window.spcBoy?.databaseMaintenanceSummary) return;
  try {
    state.databaseMaintenanceSummary = await window.spcBoy.databaseMaintenanceSummary();
  } catch (error) {
    state.databaseMaintenanceSummary = null;
    state.databaseLocationStatus = `Database stats unavailable • ${error.message}`;
  }
  renderAll();
}

async function refreshDatabaseLocation() {
  if (!window.spcBoy?.databaseLocation) return;
  state.databaseLocation = await window.spcBoy.databaseLocation();
  state.databaseLocationStatus = state.databaseLocation.requiresRestart
    ? "Restart SPCBoy to use the selected database."
    : "The shared MediaScanner catalog is active and opened read-only.";
  renderAll();
}

async function chooseDatabaseLocation() {
  const result = await window.spcBoy?.chooseDatabaseLocation?.();
  if (!result) return;
  state.databaseLocation = result;
  state.databaseLocationStatus = `Validated ${Number(result.catalog?.trackCount || 0).toLocaleString()} tracks. Restart SPCBoy to use this database.`;
  renderAll();
}

async function useDefaultDatabaseLocation() {
  state.databaseLocation = await window.spcBoy?.useDefaultDatabaseLocation?.();
  state.databaseLocationStatus = state.databaseLocation?.requiresRestart
    ? "Restart SPCBoy to use the default CocoaSpice database."
    : "The default CocoaSpice database is already active.";
  renderAll();
}

async function clearLibraryArchiveCache() {
  if (!window.spcBoy?.clearArchiveCache) return;
  try {
    await window.spcBoy.clearArchiveCache();
  } finally {
    await refreshDatabaseMaintenanceSummary();
  }
  renderAll();
}

Object.assign(app.ui, {
  refreshLibraryRoots,
  handleLibraryRootsChanged,
  refreshDatabaseMaintenanceSummary,
  refreshDatabaseLocation,
  chooseDatabaseLocation,
  useDefaultDatabaseLocation,
  clearLibraryArchiveCache
});
})();
