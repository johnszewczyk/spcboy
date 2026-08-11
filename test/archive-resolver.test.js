const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  archivePlayableEntries,
  archivePlayableEntriesWithSignature,
  archiveType,
  materializeArchiveEntryForScan,
  materializeArchiveEntryForPlayback,
  materializeArchiveEntriesForScan,
  materializeZipEntry,
  archiveCacheSummary,
  clearArchiveCache,
  pruneArchiveCache,
  fastArchiveSignature,
  scanScratchSummary,
  recoverAbandonedScanScratchRoots
} = require("../electron/archive-resolver");

const execFileAsync = promisify(execFile);
const TAR_BINARY = process.env.SPCBOY_TAR_BINARY || "/usr/bin/bsdtar";
const ZSTD_BINARY = process.env.SPCBOY_ZSTD_BINARY || "/opt/homebrew/bin/zstd";

test("lists and concurrently materializes ZIP dependency-family members", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-zip-fixture-"));
  try {
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    const members = ["Track [mix].psf", "Track two.psf", "Track three.psf", "re2.psflib"];
    for (const member of members) {
      await fs.writeFile(path.join(fixtureRoot, member), member, "utf8");
    }
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, ...members], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    assert.equal(archiveType(archivePath), "zip");
    const playableEntries = await archivePlayableEntries(archivePath, (extension) => extension === ".psf");
    assert.deepEqual(playableEntries, members.slice(0, 3));
    const signedListing = await archivePlayableEntriesWithSignature(archivePath, (extension) => extension === ".psf");
    assert.deepEqual(signedListing.entries, playableEntries);
    assert.match(signedListing.signature, /^[0-9a-f]{64}$/);

    const materializedPaths = await Promise.all(playableEntries.map((entry) => materializeZipEntry(archivePath, entry)));
    assert.equal(new Set(materializedPaths).size, playableEntries.length);
    for (let index = 0; index < playableEntries.length; index += 1) {
      assert.equal(await fs.readFile(materializedPaths[index], "utf8"), playableEntries[index]);
    }
    const scanMaterialized = await materializeArchiveEntryForScan(archivePath, playableEntries[0]);
    assert.equal(await fs.readFile(scanMaterialized.path, "utf8"), playableEntries[0]);
    assert.equal(await fs.readFile(path.join(path.dirname(scanMaterialized.path), "re2.psflib"), "utf8"), "re2.psflib");
    await scanMaterialized.cleanup();
    await assert.rejects(fs.access(scanMaterialized.path));
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("preserves relative vgmstream TXT dependency paths in ZIPs", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-txtp-fixture-"));
  try {
    const candidateRoot = path.join(fixtureRoot, "candidate");
    const rawRoot = path.join(fixtureRoot, "raw");
    await fs.mkdir(candidateRoot);
    await fs.mkdir(rawRoot);
    const txtpEntry = "candidate/track.xa.txtp";
    await fs.writeFile(path.join(candidateRoot, "track.xa.txtp"), "../raw/source.xa #I 0 100\n", "utf8");
    await fs.writeFile(path.join(rawRoot, "source.xa"), "stream fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", "-r", archivePath, "candidate", "raw"], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const playableEntries = await archivePlayableEntries(archivePath, (extension) => extension === ".txtp");
    assert.deepEqual(playableEntries, [txtpEntry]);
    const materializedPath = await materializeZipEntry(archivePath, txtpEntry);
    assert.equal(await fs.readFile(materializedPath, "utf8"), "../raw/source.xa #I 0 100\n");
    assert.equal(await fs.readFile(path.resolve(path.dirname(materializedPath), "../raw/source.xa"), "utf8"), "stream fixture");
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("materializes TXT P CD-XA DA companions without admitting them as tracks", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-txtp-da-fixture-"));
  try {
    const soundRoot = path.join(fixtureRoot, "sound");
    await fs.mkdir(soundRoot);
    const txtpEntry = "CD1[jp].txtp";
    const companionEntry = "sound/CD1[jp].DA";
    await fs.writeFile(path.join(fixtureRoot, txtpEntry), `${companionEntry}\n`, "utf8");
    await fs.writeFile(path.join(fixtureRoot, companionEntry), "CD-XA fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", "-r", archivePath, txtpEntry, "sound"], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const materialized = await materializeArchiveEntryForScan(archivePath, txtpEntry);
    assert.equal(await fs.readFile(materialized.path, "utf8"), `${companionEntry}\n`);
    assert.equal(await fs.readFile(path.join(path.dirname(materialized.path), companionEntry), "utf8"), "CD-XA fixture");
    await materialized.cleanup();
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("repairs safe TXT P references to uniquely flattened raw companions", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-flattened-txtp-fixture-"));
  try {
    const txtpEntry = "mix.txtp";
    await fs.writeFile(
      path.join(fixtureRoot, txtpEntry),
      "Sound\\Music\\Instruments\\arcade01.swav\nvoice.s14\nmode = layers\n",
      "utf8"
    );
    await fs.writeFile(path.join(fixtureRoot, "arcade01.swav"), "SWAV fixture", "utf8");
    await fs.writeFile(path.join(fixtureRoot, "voice.s14"), "S14 fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, txtpEntry, "arcade01.swav", "voice.s14"], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const materializedPath = await materializeZipEntry(archivePath, txtpEntry);
    const materializedRoot = path.dirname(materializedPath);
    assert.equal(
      await fs.readFile(path.join(materializedRoot, "Sound", "Music", "Instruments", "arcade01.swav"), "utf8"),
      "SWAV fixture"
    );
    assert.equal(await fs.readFile(path.join(materializedRoot, "voice.s14"), "utf8"), "S14 fixture");
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("cleans scan-only archive materialization after inspection", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scan-scratch-fixture-"));
  try {
    const member = "song.nsf";
    await fs.writeFile(path.join(fixtureRoot, member), "scan fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, member], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const materialized = await materializeArchiveEntryForScan(archivePath, member);
    assert.equal(await fs.readFile(materialized.path, "utf8"), "scan fixture");
    await materialized.cleanup();
    await assert.rejects(fs.access(materialized.path));
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("recovers abandoned scan scratch roots while retaining a live materialization", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scratch-recovery-"));
  const previousScratchRoot = process.env.SPCBOY_SCAN_SCRATCH_ROOT;
  process.env.SPCBOY_SCAN_SCRATCH_ROOT = fixtureRoot;
  try {
    const member = "song.nsf";
    await fs.writeFile(path.join(fixtureRoot, member), "scan fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, member], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }
    const live = await materializeArchiveEntryForScan(archivePath, member);
    const abandoned = path.join(fixtureRoot, "spcboy-scan-scratch-abandoned");
    await fs.mkdir(abandoned);
    await fs.writeFile(path.join(abandoned, "payload.bin"), Buffer.alloc(4096));

    const recovered = await recoverAbandonedScanScratchRoots();
    assert.equal(recovered.recoveredRootCount, 1);
    assert.equal(recovered.recoveredBytes, 4096);
    await fs.access(live.path);
    await assert.rejects(fs.access(abandoned));
    assert.equal((await scanScratchSummary()).activeRootCount, 1);
    await live.cleanup();
    assert.deepEqual(await scanScratchSummary(), { activeRootCount: 0, activeBytes: 0 });
  } finally {
    if (previousScratchRoot === undefined) delete process.env.SPCBOY_SCAN_SCRATCH_ROOT;
    else process.env.SPCBOY_SCAN_SCRATCH_ROOT = previousScratchRoot;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("removes an active scan scratch root when streamed extraction exceeds its budget", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scratch-budget-"));
  const previousScratchRoot = process.env.SPCBOY_SCAN_SCRATCH_ROOT;
  process.env.SPCBOY_SCAN_SCRATCH_ROOT = fixtureRoot;
  try {
    const member = "oversized.nsf";
    await fs.writeFile(path.join(fixtureRoot, member), Buffer.alloc(4096));
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, member], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }
    let reserved = 0;
    await assert.rejects(
      materializeArchiveEntryForScan(archivePath, member, {
        reserveBytes(_rootPath, byteCount) {
          reserved += byteCount;
          if (reserved > 1024) throw new Error("scratch quota exceeded");
        }
      }),
      /scratch quota exceeded/
    );
    assert.deepEqual(await scanScratchSummary(), { activeRootCount: 0, activeBytes: 0 });
  } finally {
    if (previousScratchRoot === undefined) delete process.env.SPCBOY_SCAN_SCRATCH_ROOT;
    else process.env.SPCBOY_SCAN_SCRATCH_ROOT = previousScratchRoot;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("shares one scan scratch root across archive members", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-shared-scan-fixture-"));
  try {
    const members = ["one.psf", "two.psf", "game.psflib"];
    for (const member of members) await fs.writeFile(path.join(fixtureRoot, member), member, "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, ...members], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const materialized = await materializeArchiveEntriesForScan(archivePath, members.slice(0, 2));
    assert.equal(new Set([...materialized.paths.values()].map((value) => path.dirname(value).split("/psf")[0])).size, 1);
    assert.equal(await fs.readFile(materialized.paths.get("one.psf"), "utf8"), "one.psf");
    assert.equal(await fs.readFile(materialized.paths.get("two.psf"), "utf8"), "two.psf");
    assert.equal(await fs.readFile(path.join(materialized.root, "game.psflib"), "utf8"), "game.psflib");
    await materialized.cleanup();
    await assert.rejects(fs.access(materialized.root));
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("materializes N64 miniUSF members with their USF library from TAR.ZST", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-usf-tzst-fixture-"));
  try {
    const sourceRoot = path.join(fixtureRoot, "source");
    await fs.mkdir(sourceRoot);
    const selected = "02 Title Theme.miniusf";
    const library = "NUS-NSME-USA.usflib";
    await fs.writeFile(path.join(sourceRoot, selected), "miniUSF fixture", "utf8");
    await fs.writeFile(path.join(sourceRoot, library), "USF library fixture", "utf8");
    const rawTarPath = path.join(fixtureRoot, "fixture.tar");
    const archivePath = path.join(fixtureRoot, "fixture.tar.zst");
    try {
      await execFileAsync(TAR_BINARY, ["-cf", rawTarPath, "-C", sourceRoot, selected, library]);
      await execFileAsync(ZSTD_BINARY, ["-q", "-f", rawTarPath, "-o", archivePath]);
    } catch (error) {
      return t.skip(`TAR/Zstandard fixture tools unavailable: ${error.message}`);
    }

    const materialized = await materializeArchiveEntryForScan(archivePath, selected);
    assert.equal(await fs.readFile(materialized.path, "utf8"), "miniUSF fixture");
    assert.equal(await fs.readFile(path.join(path.dirname(materialized.path), library), "utf8"), "USF library fixture");
    await materialized.cleanup();
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("discovers and materializes module and standard-audio ZIP members", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-rendered-audio-fixture-"));
  try {
    const members = ["01 module.xm", "02 recording.flac", "03 capture.wav"];
    for (const member of members) {
      await fs.writeFile(path.join(fixtureRoot, member), member, "utf8");
    }
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, ...members], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }

    const playableEntries = await archivePlayableEntries(
      archivePath,
      (extension) => new Set([".xm", ".flac", ".wav"]).has(extension)
    );
    assert.deepEqual(playableEntries, members);
    const materializedPaths = await Promise.all(playableEntries.map((entry) => materializeZipEntry(archivePath, entry)));
    assert.equal(new Set(materializedPaths).size, members.length);
    for (let index = 0; index < members.length; index += 1) {
      assert.equal(await fs.readFile(materializedPaths[index], "utf8"), members[index]);
    }
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("lists and materializes TZST and TAR.ZST members", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-tzst-fixture-"));
  try {
    const members = ["01 module.xm", "02 recording.flac"];
    for (const member of members) {
      await fs.writeFile(path.join(fixtureRoot, member), member, "utf8");
    }
    const rawTarPath = path.join(fixtureRoot, "fixture.tar");
    const archivePath = path.join(fixtureRoot, "fixture.tar.zst");
    try {
      await execFileAsync(TAR_BINARY, ["-cf", rawTarPath, "-C", fixtureRoot, ...members]);
      await execFileAsync(ZSTD_BINARY, ["-q", "-f", rawTarPath, "-o", archivePath]);
    } catch (error) {
      if (error?.code === "ENOENT") return t.skip(`TZST fixture tools unavailable: ${error.message}`);
      throw error;
    }

    assert.equal(archiveType(path.join(fixtureRoot, "fixture.tzst")), "tzst");
    assert.equal(archiveType(archivePath), "tzst");
    const playableEntries = await archivePlayableEntries(archivePath, (extension) => new Set([".xm", ".flac"]).has(extension));
    assert.deepEqual(playableEntries, members);
    const materializedPaths = await Promise.all(playableEntries.map((entry) => materializeZipEntry(archivePath, entry)));
    assert.equal(new Set(materializedPaths).size, members.length);
    for (let index = 0; index < members.length; index += 1) {
      assert.equal(await fs.readFile(materializedPaths[index], "utf8"), members[index]);
    }
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("reports and clears the managed durable archive cache", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-cache-summary-fixture-"));
  const previousCacheRoot = process.env.SPCBOY_ARCHIVE_CACHE_ROOT;
  process.env.SPCBOY_ARCHIVE_CACHE_ROOT = path.join(fixtureRoot, "managed-cache");
  try {
    const member = "track.nsf";
    await fs.writeFile(path.join(fixtureRoot, member), "cache fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, member], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }
    await materializeZipEntry(archivePath, member);
    const summary = await archiveCacheSummary();
    assert.equal(summary.rootPath, process.env.SPCBOY_ARCHIVE_CACHE_ROOT);
    assert.ok(summary.fileCount > 0);
    assert.ok(summary.byteCount > 0);
    await clearArchiveCache();
    const cleared = await archiveCacheSummary();
    assert.equal(cleared.fileCount, 0);
    assert.equal(cleared.byteCount, 0);
  } finally {
    if (previousCacheRoot === undefined) delete process.env.SPCBOY_ARCHIVE_CACHE_ROOT;
    else process.env.SPCBOY_ARCHIVE_CACHE_ROOT = previousCacheRoot;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("cache pruning retains a protected playback lease and removes older entries", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-cache-prune-fixture-"));
  const previousCacheRoot = process.env.SPCBOY_ARCHIVE_CACHE_ROOT;
  process.env.SPCBOY_ARCHIVE_CACHE_ROOT = path.join(fixtureRoot, "managed-cache");
  try {
    await fs.mkdir(process.env.SPCBOY_ARCHIVE_CACHE_ROOT, { recursive: true });
    const oldEntry = path.join(process.env.SPCBOY_ARCHIVE_CACHE_ROOT, "old.nsf");
    const liveEntry = path.join(process.env.SPCBOY_ARCHIVE_CACHE_ROOT, "live.nsf");
    const recentEntry = path.join(process.env.SPCBOY_ARCHIVE_CACHE_ROOT, "recent.nsf");
    for (const entry of [oldEntry, liveEntry, recentEntry]) {
      await fs.writeFile(entry, "x");
      await fs.truncate(entry, 64 * 1024 * 1024);
    }
    const now = Date.now() / 1000;
    await fs.utimes(oldEntry, now - 30, now - 30);
    await fs.utimes(liveEntry, now - 20, now - 20);
    await fs.utimes(recentEntry, now - 10, now - 10);

    const result = await pruneArchiveCache(128 * 1024 * 1024, [liveEntry]);
    assert.ok(result.evictedBytes >= 64 * 1024 * 1024);
    await assert.rejects(fs.access(oldEntry));
    await fs.access(liveEntry);
    await fs.access(recentEntry);
  } finally {
    if (previousCacheRoot === undefined) delete process.env.SPCBOY_ARCHIVE_CACHE_ROOT;
    else process.env.SPCBOY_ARCHIVE_CACHE_ROOT = previousCacheRoot;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("cache-off playback materialization is disposable", async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-playback-scratch-fixture-"));
  try {
    const member = "track.nsf";
    await fs.writeFile(path.join(fixtureRoot, member), "playback fixture", "utf8");
    const archivePath = path.join(fixtureRoot, "fixture.zip");
    try {
      await execFileAsync("/usr/bin/zip", ["-q", archivePath, member], { cwd: fixtureRoot });
    } catch (error) {
      return t.skip(`zip fixture tool unavailable: ${error.message}`);
    }
    const materialized = await materializeArchiveEntryForPlayback(archivePath, member);
    assert.equal(await fs.readFile(materialized.path, "utf8"), "playback fixture");
    await materialized.cleanup();
    await assert.rejects(fs.access(materialized.path));
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("fast archive signatures detect same-size content changes", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-fast-signature-"));
  try {
    const archivePath = path.join(fixtureRoot, "archive.bin");
    await fs.writeFile(archivePath, Buffer.alloc(131072, 0x41));
    const first = await fastArchiveSignature(archivePath);
    const stat = await fs.stat(archivePath);
    const replacement = Buffer.alloc(131072, 0x41);
    replacement[0] = 0x42;
    replacement[replacement.length - 1] = 0x43;
    await fs.writeFile(archivePath, replacement);
    await fs.utimes(archivePath, stat.atime, stat.mtime);
    const second = await fastArchiveSignature(archivePath);
    assert.notEqual(first, second);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
