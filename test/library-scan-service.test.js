const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createScanScratchBudget, scanLibraryRoot } = require("../electron/library-scan-service");
const { scanScratchSummary } = require("../electron/archive-resolver");

test("scan scratch budget refuses low-space extraction and tracks released roots", async () => {
  let summary = { activeRootCount: 0, activeBytes: 0 };
  const budget = await createScanScratchBudget({
    budgetBytes: 100,
    recovery: { recoveredRootCount: 2, recoveredBytes: 30 },
    getSummary: async () => summary,
    getAvailableBytes: async () => 10 * 1024 * 1024 * 1024
  });
  await assert.rejects(budget.ensureArchiveCapacity(__filename), /scratch space/);
  assert.throws(() => budget.reserveBytes("/scratch/one", 101), /scratch space/);
  budget.reserveBytes("/scratch/one", 50);
  assert.equal(budget.snapshot().activeBytes, 50);
  summary = { activeRootCount: 0, activeBytes: 0 };
  await budget.refresh();
  assert.equal(budget.snapshot().activeBytes, 0);
  assert.equal(budget.snapshot().recoveredRootCount, 2);

  const lowDiskBudget = await createScanScratchBudget({
    budgetBytes: 8 * 1024 * 1024 * 1024,
    getSummary: async () => ({ activeRootCount: 0, activeBytes: 0 }),
    getAvailableBytes: async () => 1
  });
  await assert.rejects(lowDiskBudget.ensureArchiveCapacity(__filename), /only 1 bytes free/);
});

test("releases each completed archive session before the next archive consumes the scratch budget", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-session-release-"));
  const scratchPath = path.join(rootPath, "scratch");
  const previousScratchRoot = process.env.SPCBOY_SCAN_SCRATCH_ROOT;
  process.env.SPCBOY_SCAN_SCRATCH_ROOT = scratchPath;
  t.after(async () => {
    if (previousScratchRoot === undefined) delete process.env.SPCBOY_SCAN_SCRATCH_ROOT;
    else process.env.SPCBOY_SCAN_SCRATCH_ROOT = previousScratchRoot;
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  const sourcePath = path.join(rootPath, "member.vgm");
  await fs.mkdir(scratchPath, { recursive: true });
  await fs.writeFile(sourcePath, Buffer.alloc(64 * 1024 * 1024));
  const archivePaths = ["first.zip", "second.zip"].map((name) => path.join(rootPath, name));
  await Promise.all(archivePaths.map((archivePath) => execFileAsync("/usr/bin/zip", ["-q", "-j", archivePath, sourcePath])));
  await fs.rm(sourcePath);

  const roots = [{ id: 71, path: rootPath, last_scan_track_count: 0 }];
  const database = {
    async ensureRoot() { return roots[0]; },
    async markScanStarted() {},
    async beginAtomicScan() {},
    async commitAtomicScan() {},
    async rollbackAtomicScan() {},
    async indexedTrackRecords() { return []; },
    async restoreSources() {},
    async markUndiscoveredSourcesDead() {},
    async replaceTracks(_rootId, records, details) { roots[0].last_scan_track_count = records.length; roots[0].details = details; },
    async loadRoots() { return roots; },
    async markScanFailed(rootId, message) { throw new Error(`unexpected scan failure for ${rootId}: ${message}`); }
  };
  const result = await scanLibraryRoot({
    rootPath,
    job: { cancelled: false },
    database,
    scanConcurrency: 1,
    scratchBudgetBytes: 96 * 1024 * 1024,
    inspectTrackVariants: async () => [{
      trackIndex: 0,
      trackCount: 1,
      inspection: { metadata: { song: "", game: "", author: "", system: "" }, basePlaybackSeconds: 0, specialAudioKind: null }
    }]
  });
  assert.equal(result.warningCount, 0, JSON.stringify({ result, details: roots[0].details }));
  assert.equal(result.trackCount, 2);
  assert.equal(result.scratch.activeRootCount, 0);
  assert.equal(result.scratch.activeBytes, 0);
});

const execFileAsync = promisify(execFile);

test("scan service coordinates discovery, inspection, progress, and one database commit", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-scan-service-"));
  t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const trackPath = path.join(rootPath, "song.nsf");
  await fs.writeFile(trackPath, "fixture", "utf8");

  const roots = [{ id: 7, path: rootPath, last_scan_track_count: 0 }];
  const calls = { inspected: [], probed: [], progress: [], replaced: null, began: false, committed: false };
  const database = {
    async ensureRoot() { return roots[0]; },
    async markScanStarted() {},
    async beginAtomicScan() { calls.began = true; },
    async commitAtomicScan() { calls.committed = true; },
    async rollbackAtomicScan() {},
    async indexedTrackRecords() { return [{ path: path.join(rootPath, "previously-indexed.nsf"), archivePath: null, archiveEntry: null }]; },
    async restoreSources() {},
    async markUndiscoveredSourcesDead() {},
    async replaceTracks(rootId, records, details) {
      calls.replaced = { rootId, records, details };
      roots[0].last_scan_track_count = records.length;
    },
    async loadRoots() { return roots; },
    async markScanFailed(errorRootId, message) {
      throw new Error(`unexpected scan failure for ${errorRootId}: ${message}`);
    }
  };

  const result = await scanLibraryRoot({
    rootPath,
    job: { cancelled: false },
    database,
    scanConcurrency: 1,
    onProgress: (progress) => calls.progress.push(progress),
    probePlayback: async (probe) => calls.probed.push(probe),
    inspectTrackVariants: async (inspectPath, sourceName) => {
      calls.inspected.push({ inspectPath, sourceName });
      return [{
        trackIndex: 0,
        trackCount: 1,
        inspection: {
          metadata: { song: "Song", game: "Game", author: "Artist", system: "NES" },
          basePlaybackSeconds: 12,
          specialAudioKind: null
        }
      }];
    }
  });

  assert.deepEqual(calls.inspected, [{ inspectPath: trackPath, sourceName: trackPath }]);
  const discoveryProgress = calls.progress.find((progress) => progress.operation === "discover");
  assert.equal(discoveryProgress?.estimatedTotal, 1);
  assert.deepEqual(calls.probed, [{
    path: trackPath,
    sourceName: trackPath,
    route: {
      backendId: "libgme",
      displayName: "libgme",
      extension: ".nsf",
      archiveMember: false,
      archivePolicy: "selected-entry",
      playbackMode: "native-session",
      scanConcurrency: 1,
      scanTimeoutSeconds: 60,
      playbackSpeedMode: "native-tempo"
    },
    trackIndex: 0,
    specialAudioKind: null
  }]);
  assert.equal(calls.replaced.rootId, 7);
  assert.equal(calls.replaced.records.length, 1);
  assert.equal(calls.replaced.records[0].metadata.title, "Song");
  assert.equal(calls.replaced.records[0].scanCompleted, true);
  assert.equal(calls.began, true);
  assert.equal(calls.committed, true);
  assert.equal(calls.replaced.details.fileCount, 1);
  assert.equal(result.trackCount, 1);
  assert.equal(result.warningCount, 0);
  assert.equal(result.scanSummary.byStage.playback, 1);
  assert.equal(calls.progress[0].operation, "prepare");
  assert.equal(calls.progress.at(-1).operation, "scan");
});

test("cancelled archive scans settle only after their scratch root is removed", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-scan-cancel-"));
  const previousScratchRoot = process.env.SPCBOY_SCAN_SCRATCH_ROOT;
  process.env.SPCBOY_SCAN_SCRATCH_ROOT = rootPath;
  t.after(async () => {
    if (previousScratchRoot === undefined) delete process.env.SPCBOY_SCAN_SCRATCH_ROOT;
    else process.env.SPCBOY_SCAN_SCRATCH_ROOT = previousScratchRoot;
    await fs.rm(rootPath, { recursive: true, force: true });
  });
  const member = "song.nsf";
  await fs.writeFile(path.join(rootPath, member), "fixture", "utf8");
  const archivePath = path.join(rootPath, "set.zip");
  try {
    await execFileAsync("/usr/bin/zip", ["-q", archivePath, member], { cwd: rootPath });
  } catch (error) {
    return t.skip(`zip fixture tool unavailable: ${error.message}`);
  }
  const job = { cancelled: false };
  const root = { id: 1, path: rootPath, last_scan_track_count: 0 };
  const database = {
    async ensureRoot() { return root; }, async markScanStarted() {}, async indexedTrackRecords() { return []; },
    async beginAtomicScan() {}, async commitAtomicScan() {}, async rollbackAtomicScan() {},
    async restoreSources() {}, async markUndiscoveredSourcesDead() {}, async replaceTracks() { throw new Error("cancelled scan must not commit"); },
    async loadRoots() { return [root]; }, async markScanFailed() { throw new Error("cancellation must not mark scan failed"); }
  };
  await assert.rejects(scanLibraryRoot({
    rootPath, job, database, scanConcurrency: 1,
    inspectTrackVariants: async () => {
      job.cancelled = true;
      return [{ trackIndex: 0, trackCount: 1, inspection: { metadata: { song: "Song", game: "Game", author: "Artist", system: "NES" }, basePlaybackSeconds: 1 } }];
    }
  }), /Library operation cancelled/);
  assert.deepEqual(await scanScratchSummary(), { activeRootCount: 0, activeBytes: 0 });
});

test("archive members that fail their recognized codec route retain the retry requirement", async (t) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-library-archive-retry-"));
  t.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const archivePath = path.join(rootPath, "broken.zip");
  await fs.writeFile(path.join(rootPath, "broken.nsf"), "not a valid NSF", "utf8");
  await fs.writeFile(path.join(rootPath, "cover.txt"), "unrelated text is allowed", "utf8");
  try {
    await execFileAsync("/usr/bin/zip", ["-q", archivePath, "broken.nsf", "cover.txt"], { cwd: rootPath });
  } catch (error) {
    return t.skip(`zip fixture tool unavailable: ${error.message}`);
  }
  await fs.rm(path.join(rootPath, "broken.nsf"));
  await fs.rm(path.join(rootPath, "cover.txt"));

  const roots = [{ id: 8, path: rootPath, last_scan_track_count: 0, needs_rescan: 0 }];
  const calls = { replaced: null };
  const database = {
    async ensureRoot() { return roots[0]; },
    async markScanStarted() {},
    async beginAtomicScan() {},
    async commitAtomicScan() {},
    async rollbackAtomicScan() {},
    async indexedTrackRecords() { return []; },
    async restoreSources() {},
    async markUndiscoveredSourcesDead() {},
    async replaceTracks(rootId, records, details) {
      calls.replaced = { rootId, records, details };
      roots[0].last_scan_track_count = records.length;
      roots[0].needs_rescan = details.needsRescan ? 1 : 0;
    },
    async loadRoots() { return roots; },
    async markScanFailed(errorRootId, message) {
      throw new Error(`unexpected scan failure for ${errorRootId}: ${message}`);
    }
  };

  await scanLibraryRoot({
    rootPath,
    job: { cancelled: false },
    database,
    scanConcurrency: 1,
    inspectTrackVariants: async () => {
      throw new Error("decoder rejected recognized NSF member");
    }
  });

  assert.equal(calls.replaced.records.length, 1);
  assert.equal(calls.replaced.records[0].scanCompleted, false);
  assert.equal(calls.replaced.details.needsRescan, true);
  assert.equal(calls.replaced.details.outcomes.some((outcome) => outcome.identity.archiveEntry === "broken.nsf" && outcome.state === "failed"), true);
});
