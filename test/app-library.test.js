const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const path = require("node:path");
const vm = require("node:vm");

test("Test Files completes through the shared database-change handler", async () => {
  const source = await fs.readFile(path.join(__dirname, "..", "web", "app-library.js"), "utf8");
  const state = {
    libraryOperationActive: false,
    libraryScanStatus: "No scan started.",
    libraryScanCurrentFile: "",
    libraryScanProgress: null
  };
  const result = { checkedSourceCount: 2, missingSourceCount: 0, roots: [] };
  let handledChange = null;
  const app = {
    state,
    refs: {},
    persistSettings() {},
    ui: {
      renderAll() {},
      async handleLibraryDatabaseChanged(change) { handledChange = change; }
    }
  };
  const context = {
    window: {
      SPCBoyApp: app,
      spcBoy: {
        trimMissingDatabaseSources: async () => result,
        databaseMaintenanceSummary: async () => ({})
      }
    },
    console
  };
  vm.runInNewContext(source, context, { filename: "web/app-library.js" });

  await app.ui.trimMissingLibrary();

  assert.equal(handledChange, result);
  assert.equal(state.libraryOperationActive, false);
  assert.equal(state.libraryScanStatus, "Test Files • 2 sources checked • 0 missing retained");
});
