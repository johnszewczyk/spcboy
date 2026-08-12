const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveLibraryBrowserIdentity } = require("../electron/library-database");

const fixturePath = path.join(__dirname, "cross-app-library-identity-v1.json");
const contract = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("matches the CocoaSpice/SPCBoy library identity contract", () => {
  assert.equal(contract.contract, "cocoaspice-spcboy-library-identity");
  assert.equal(contract.version, 1);
  assert.ok(contract.cases.length > 0);

  for (const fixture of contract.cases) {
    const record = {
      folderPath: path.dirname(fixture.sourcePath),
      rootPath: fixture.rootPath,
      path: fixture.archiveEntry
        ? `${fixture.sourcePath}#${fixture.archiveEntry}`
        : fixture.sourcePath,
      archivePath: fixture.archiveEntry ? fixture.sourcePath : null,
      archiveEntry: fixture.archiveEntry,
      metadata: fixture.metadata
    };
    assert.deepEqual(
      resolveLibraryBrowserIdentity(record, false),
      fixture.expected.collection,
      `${fixture.id} collection mode`
    );
    assert.deepEqual(
      resolveLibraryBrowserIdentity(record, true),
      fixture.expected.embedded,
      `${fixture.id} embedded mode`
    );
  }
});
