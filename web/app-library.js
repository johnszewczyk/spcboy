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
  state.databaseFiles = [];
  state.databaseFileTree = [];
  persistSettings();
  renderAll();
  if (state.sidebarMode === "paths") {
    await app.ui.loadDatabaseFiles();
    renderAll();
  }
  app.ui.syncTreeSelection();
}

async function refreshArchiveCacheSummary() {
  if (!window.spcBoy?.archiveCacheSummary) return;
  try {
    state.archiveCacheSummary = await window.spcBoy.archiveCacheSummary();
  } catch (error) {
    state.archiveCacheSummary = null;
    state.databaseLocationStatus = `Archive cache status unavailable • ${error.message}`;
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

async function handleCatalogReloaded(result) {
  state.databaseLocation = result || await window.spcBoy?.databaseLocation?.() || null;
  state.databaseLocationStatus = state.databaseLocation?.reloaded
    ? "Library reloaded. SPCBoy is reading the latest MediaScanner catalog."
    : state.databaseLocation?.requiresRestart
      ? "Restart SPCBoy to use the selected database."
      : "The shared MediaScanner catalog is active and opened read-only.";
  if (!window.spcBoy?.isOptionsWindow && window.spcBoy?.databaseRoots) {
    state.libraryRoots = await window.spcBoy.databaseRoots();
    await handleLibraryRootsChanged(state.libraryRoots);
  }
  renderAll();
}

async function reloadDatabaseLibrary() {
  if (!window.spcBoy?.reloadDatabaseLibrary) return;
  await handleCatalogReloaded(await window.spcBoy.reloadDatabaseLibrary());
}

async function clearLibraryArchiveCache() {
  if (!window.spcBoy?.clearArchiveCache) return;
  try {
    await window.spcBoy.clearArchiveCache();
  } finally {
    await refreshArchiveCacheSummary();
  }
  renderAll();
}

Object.assign(app.ui, {
  refreshLibraryRoots,
  handleLibraryRootsChanged,
  refreshArchiveCacheSummary,
  refreshDatabaseLocation,
  chooseDatabaseLocation,
  useDefaultDatabaseLocation,
  handleCatalogReloaded,
  reloadDatabaseLibrary,
  clearLibraryArchiveCache
});
})();
