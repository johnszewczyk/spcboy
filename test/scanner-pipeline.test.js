const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { discoverPhysicalSources } = require("../electron/scanner-discovery");
const { expandArchiveSources } = require("../electron/scanner-archive");

const execFileAsync = promisify(execFile);

test("discovers physical archives without listing them, then expands them in a bounded stage", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scanner-pipeline-"));
  try {
    await fs.writeFile(path.join(fixtureRoot, "direct.spc"), "direct", "utf8");
    await fs.writeFile(path.join(fixtureRoot, "inside.spc"), "inside", "utf8");
    const archivePath = path.join(fixtureRoot, "library.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, "inside.spc"], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const physical = await discoverPhysicalSources(fixtureRoot);
    const archiveCandidate = physical.find((source) => source.archivePath === archivePath);
    assert.ok(archiveCandidate);
    assert.equal(archiveCandidate.archiveEntry, null);

    const outcomes = [];
    const streamed = [];
    const expanded = await expandArchiveSources(physical, {
      onOutcome: (outcome) => outcomes.push(outcome),
      onEntries: (listing) => streamed.push(listing)
    });
    assert.ok(expanded.some((source) => source.archiveEntry === "inside.spc"));
    assert.equal(outcomes.length, 0);
    assert.deepEqual(streamed.map(({ source, entries }) => ({ path: source.archivePath, entries })), [{
      path: archivePath,
      entries: ["inside.spc"]
    }]);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("reports live bounded discovery progress while walking nested folders", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-discovery-progress-"));
  try {
    const nested = path.join(fixtureRoot, "nested");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(fixtureRoot, "one.spc"), "one");
    await fs.writeFile(path.join(nested, "two.vgm"), "two");
    const progress = [];
    const sources = await discoverPhysicalSources(fixtureRoot, { concurrency: 2, onProgress: (event) => progress.push(event) });
    assert.equal(sources.length, 2);
    assert.ok(progress.some((event) => event.visitedFolders >= 1));
    assert.ok(progress.at(-1).discoveredFiles >= 2);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("emits discovered source batches before the full walk completes", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-discovery-batches-"));
  try {
    await fs.mkdir(path.join(fixtureRoot, "first"));
    await fs.mkdir(path.join(fixtureRoot, "second"));
    await fs.writeFile(path.join(fixtureRoot, "first", "one.spc"), "one");
    await fs.writeFile(path.join(fixtureRoot, "second", "two.vgm"), "two");
    const batches = [];
    const sources = await discoverPhysicalSources(fixtureRoot, { concurrency: 1, onBatch: async (batch) => batches.push(batch) });
    assert.equal(sources.length, 2);
    assert.equal(batches.flat().length, 2);
    assert.ok(batches.length >= 1);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
