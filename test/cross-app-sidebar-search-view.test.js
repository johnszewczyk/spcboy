const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function sidebarViewApi() {
  const source = fs.readFileSync(path.join(__dirname, "..", "web", "sidebar-view-state.js"), "utf8");
  const window = {};
  vm.runInNewContext(source, { window });
  return window.SPCBoySidebarViewState;
}

const contract = JSON.parse(fs.readFileSync(
  path.join(__dirname, "cross-app-sidebar-search-view-v1.json"),
  "utf8"
));

test("matches the CocoaSpice/SPCBoy sidebar search-view contract", () => {
  const api = sidebarViewApi();
  assert.equal(contract.contract, "cocoaspice-spcboy-sidebar-search-view");
  assert.equal(contract.version, 2);
  assert.ok(contract.cases.length > 0);

  for (const fixture of contract.cases) {
    let storedMode = fixture.initialMode;
    let query = "";
    for (const step of fixture.steps) {
      if (typeof step.setMode === "string") storedMode = step.setMode;
      if (typeof step.setQuery === "string") query = step.setQuery;
      assert.deepEqual(
        JSON.parse(JSON.stringify(api.resolve(storedMode, query))),
        step.expected,
        fixture.id
      );
    }
  }
});
