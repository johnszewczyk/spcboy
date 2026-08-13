const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("main process owns one runtime and resolves scanner roots by configured ID", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(__dirname, "..", "web", "app-library.js"), "utf8");

  assert.match(mainSource, /requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /const SCAN_VERSION = DEFAULT_SCAN_VERSION/);
  assert.match(mainSource, /ipcMain\.handle\("library:database-scan", async \(_event, rootId/);
  assert.match(mainSource, /libraryDatabase\.loadRoot\(rootId\)/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\("library:database-scan", async \(_event, rootPath/);
  assert.doesNotMatch(mainSource, /library:database-add-root/);
  assert.doesNotMatch(preloadSource, /databaseAddRoot/);
  assert.match(preloadSource, /scanDatabaseRoot: \(rootId[\s\S]*Number\(rootId\)/);
  assert.match(rendererSource, /scanDatabaseRoot\(root\.id, deepScan\)/);
});

test("window focus raises only the requested window and sidebar search is mode independent", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(__dirname, "..", "web", "app-ui.js"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "web", "app.js"), "utf8");
  const markup = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf8");

  const focusHelper = mainSource.match(/function bringAppWindowsToFront[\s\S]*?\n}\n\nasync function openOptionsWindow/)?.[0] || "";
  assert.match(focusHelper, /const focusedWindow = preferredWindow/);
  assert.doesNotMatch(focusHelper, /for \(const window of/);
  assert.match(rendererSource, /const showDatabase = currentSidebarView\(\)\.contentMode === "database"/);
  assert.match(rendererSource, /if \(currentSidebarView\(\)\.contentMode === "folders"\)/);
  assert.match(appSource, /sidebarViewState\.resolve\(state\.sidebarMode, state\.sidebarQuery\)\.contentMode === "database"/);
  assert.match(rendererSource, /databaseSearchGames\(requestedQuery\)/);
  assert.doesNotMatch(markup, /id="sidebar-folder-mode-button"/);
  assert.doesNotMatch(markup, /id="sidebar-database-mode-button"/);
  assert.match(markup, /id="sidebar-view-toggle-button"/);
});

test("playlist number column is a display-only line count", () => {
  const coreSource = fs.readFileSync(path.join(__dirname, "..", "web", "app-core.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(__dirname, "..", "web", "app-ui.js"), "utf8");

  assert.match(coreSource, /id: "index"[^\n]*sortable: false/);
  assert.match(coreSource, /value !== "index"/);
  assert.match(rendererSource, /column\.id === "index"\) return rowIndex === null \? "" : rowIndex \+ 1/);
  assert.doesNotMatch(rendererSource, /track, index\) => \(\{ \.\.\.track, index: index \+ 1 \}\)/);
});
