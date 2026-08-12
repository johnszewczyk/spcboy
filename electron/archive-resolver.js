const fsSync = require("fs");
const fs = fsSync.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { Transform } = require("stream");
const { ArchiveCacheGate } = require("./archive-cache-gate");

const execFileAsync = promisify(execFile);
const ZIP_BINARY = process.env.SPCBOY_UNZIP_BINARY || "/usr/bin/unzip";
const BSDTAR_BINARY = process.env.SPCBOY_BSDTAR_BINARY || "/usr/bin/bsdtar";
const TAR_BINARY = process.env.SPCBOY_TAR_BINARY || "/usr/bin/bsdtar";
const ZSTD_BINARY = process.env.SPCBOY_ZSTD_BINARY || "/opt/homebrew/bin/zstd";
const SEVEN_ZIP_BINARY = process.env.SPCBOY_7Z_BINARY || "/opt/homebrew/bin/7zz";
const LSAR_BINARY = process.env.SPCBOY_LSAR_BINARY || "/opt/homebrew/bin/lsar";
const UNAR_BINARY = process.env.SPCBOY_UNAR_BINARY || "/opt/homebrew/bin/unar";
const ARCHIVE_LIST_MAX_BUFFER = 128 * 1024 * 1024;
const ARCHIVE_ENTRY_MAX_BUFFER = 128 * 1024 * 1024;
function cacheRootPath() {
  return process.env.SPCBOY_ARCHIVE_CACHE_ROOT
    || path.join(os.tmpdir(), "SPCBoy", "ArchiveCache");
}

function legacyCacheRootPath() {
  return path.join(os.tmpdir(), "spcboy-archive-cache");
}
const USF_ARCHIVE_EXTENSIONS = new Set([".usf", ".miniusf", ".usflib"]);
const GSF_ARCHIVE_EXTENSIONS = new Set([".gsf", ".minigsf", ".gsflib"]);
const TWOSF_ARCHIVE_EXTENSIONS = new Set([".2sf", ".mini2sf", ".2sflib"]);
const PSF_ARCHIVE_EXTENSIONS = new Set([".psf", ".minipsf", ".psflib", ".psf2", ".minipsf2", ".psf2lib"]);
const PSF1_ARCHIVE_EXTENSIONS = new Set([".psf", ".minipsf", ".psflib"]);
const PSF2_ARCHIVE_EXTENSIONS = new Set([".psf2", ".minipsf2", ".psf2lib"]);
const VGMSTREAM_ARCHIVE_EXTENSIONS = new Set([".aa3", ".adp", ".adpcm", ".adx", ".ads", ".aifc", ".at3", ".aus", ".bik", ".bika", ".bk2", ".bnk", ".fsb", ".genh", ".hd", ".hbd", ".iecs", ".int", ".mib", ".msf", ".mtaf", ".ogg", ".ps3", ".rws", ".s14", ".ss2", ".stream", ".strm", ".svag", ".swav", ".txtp", ".vag", ".xa", ".xmd", ".xvag"]);
// TXT P definitions can refer to raw CD-XA `.DA` streams and vgmstream reads
// sibling `.TXTH` descriptors for headerless companions. They are not tracks.
const VGMSTREAM_COMPANION_EXTENSIONS = new Set([...VGMSTREAM_ARCHIVE_EXTENSIONS, ".da", ".txth"]);
const VGMSTREAM_COMPLETE_EXTENSIONS = new Set([".hd", ".hbd", ".iecs", ".txtp"]);
const DEPENDENCY_ARCHIVE_EXTENSIONS = new Set([...USF_ARCHIVE_EXTENSIONS, ...GSF_ARCHIVE_EXTENSIONS, ...TWOSF_ARCHIVE_EXTENSIONS, ...PSF_ARCHIVE_EXTENSIONS, ...VGMSTREAM_COMPLETE_EXTENSIONS]);
const materializationPromises = new Map();
const archiveCacheGate = new ArchiveCacheGate();
const SCAN_SCRATCH_PREFIX = "spcboy-scan-scratch-";
const PLAYBACK_SCRATCH_PREFIX = "spcboy-playback-scratch-";
const DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_ARCHIVE_CACHE_LIMIT_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_CACHE_LIMIT_BYTES = 16 * 1024 * 1024 * 1024;
const PLAYBACK_SCRATCH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PLAYBACK_SCRATCH_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const activeScanScratchRoots = new Set();
const activePlaybackScratchRoots = new Set();

function commandOptions(maxBuffer, signal = null) {
  return signal ? { maxBuffer, signal } : { maxBuffer };
}

function scanScratchParentPath() {
  return process.env.SPCBOY_SCAN_SCRATCH_ROOT || os.tmpdir();
}

function isScanScratchRoot(rootPath) {
  return path.dirname(rootPath) === scanScratchParentPath() && path.basename(rootPath).startsWith(SCAN_SCRATCH_PREFIX);
}

async function directoryByteCount(rootPath) {
  let total = 0;
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) total += await directoryByteCount(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
}

async function createScanScratchRoot() {
  await fs.mkdir(scanScratchParentPath(), { recursive: true });
  const rootPath = await fs.mkdtemp(path.join(scanScratchParentPath(), SCAN_SCRATCH_PREFIX));
  activeScanScratchRoots.add(rootPath);
  return rootPath;
}

async function removeScanScratchRoot(rootPath) {
  if (!isScanScratchRoot(rootPath)) throw new Error(`Refusing to remove non-scan scratch root: ${rootPath}`);
  try {
    await fs.rm(rootPath, { recursive: true, force: true });
  } finally {
    activeScanScratchRoots.delete(rootPath);
  }
}

function isPlaybackScratchRoot(rootPath) {
  return path.dirname(rootPath) === scanScratchParentPath() && path.basename(rootPath).startsWith(PLAYBACK_SCRATCH_PREFIX);
}

async function createPlaybackScratchRoot() {
  await fs.mkdir(scanScratchParentPath(), { recursive: true });
  const rootPath = await fs.mkdtemp(path.join(scanScratchParentPath(), PLAYBACK_SCRATCH_PREFIX));
  activePlaybackScratchRoots.add(rootPath);
  return rootPath;
}

async function removePlaybackScratchRoot(rootPath) {
  if (!isPlaybackScratchRoot(rootPath)) throw new Error(`Refusing to remove non-playback scratch root: ${rootPath}`);
  try {
    await fs.rm(rootPath, { recursive: true, force: true });
  } finally {
    activePlaybackScratchRoots.delete(rootPath);
  }
}

async function scanScratchSummary() {
  const roots = [...activeScanScratchRoots];
  const activeBytes = (await Promise.all(roots.map((rootPath) => directoryByteCount(rootPath).catch(() => 0))))
    .reduce((total, bytes) => total + bytes, 0);
  return { activeRootCount: roots.length, activeBytes };
}

async function recoverAbandonedScanScratchRoots() {
  const recovered = { recoveredRootCount: 0, recoveredBytes: 0 };
  const entries = await fs.readdir(scanScratchParentPath(), { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(SCAN_SCRATCH_PREFIX)) continue;
    const rootPath = path.join(scanScratchParentPath(), entry.name);
    if (activeScanScratchRoots.has(rootPath)) continue;
    const bytes = await directoryByteCount(rootPath).catch(() => 0);
    await fs.rm(rootPath, { recursive: true, force: true });
    recovered.recoveredRootCount += 1;
    recovered.recoveredBytes += bytes;
  }
  return { ...recovered, ...await scanScratchSummary() };
}

async function recoverAbandonedPlaybackScratchRoots() {
  const recovered = { recoveredRootCount: 0, recoveredBytes: 0 };
  const entries = await fs.readdir(scanScratchParentPath(), { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PLAYBACK_SCRATCH_PREFIX)) continue;
    const rootPath = path.join(scanScratchParentPath(), entry.name);
    if (activePlaybackScratchRoots.has(rootPath)) continue;
    const bytes = await directoryByteCount(rootPath).catch(() => 0);
    await fs.rm(rootPath, { recursive: true, force: true });
    recovered.recoveredRootCount += 1;
    recovered.recoveredBytes += bytes;
  }
  return recovered;
}

async function availableScratchBytes() {
  const stat = await fs.statfs(scanScratchParentPath());
  return Number(stat.bavail) * Number(stat.bsize);
}

function disposableMaterializationReserve(externalReserve = null, rootPath = null) {
  if (externalReserve) return (byteCount) => externalReserve(rootPath, byteCount);
  let reservedBytes = 0;
  return async (byteCount) => {
    const nextBytes = reservedBytes + Number(byteCount || 0);
    if (nextBytes > PLAYBACK_SCRATCH_MAX_BYTES) {
      throw new Error("Disposable archive materialization exceeds the 2 GB temporary-file limit.");
    }
    const freeBytes = await availableScratchBytes();
    if (freeBytes - Number(byteCount || 0) < PLAYBACK_SCRATCH_MIN_FREE_BYTES) {
      throw new Error("Insufficient free disk space to materialize this archive safely.");
    }
    reservedBytes = nextBytes;
  };
}

function isSafeEntry(entry) {
  const normalized = path.posix.normalize(entry.replaceAll("\\", "/"));
  return normalized !== "." && !normalized.startsWith("../") && !normalized.includes("/../") && !path.posix.isAbsolute(normalized);
}

function txtpReferencedPaths(contents) {
  return String(contents || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(";") && !line.includes("="))
    .map((line) => line.split(/\s+#/, 1)[0].trim().replaceAll("\\", "/"))
    .filter((entry) => isSafeEntry(entry));
}

async function materializeTxtpRelativeAliases(outputRoot, entries) {
  const materializedFilesByBasename = new Map();
  for (const entry of entries) {
    if (!isSafeEntry(entry)) continue;
    const filePath = path.join(outputRoot, ...entry.split("/"));
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }
    const basename = path.posix.basename(entry);
    const matches = materializedFilesByBasename.get(basename) || [];
    matches.push(filePath);
    materializedFilesByBasename.set(basename, matches);
  }

  for (const txtpEntry of entries) {
    if (path.extname(txtpEntry).toLowerCase() !== ".txtp" || !isSafeEntry(txtpEntry)) continue;
    const txtpPath = path.join(outputRoot, ...txtpEntry.split("/"));
    const contents = await fs.readFile(txtpPath, "utf8").catch(() => "");
    for (const referencedPath of txtpReferencedPaths(contents)) {
      const relativeTarget = path.posix.normalize(path.posix.join(path.posix.dirname(txtpEntry), referencedPath));
      if (!isSafeEntry(relativeTarget)) continue;
      const targetPath = path.join(outputRoot, ...relativeTarget.split("/"));
      try {
        await fs.access(targetPath);
        continue;
      } catch {
        // Flattened archives sometimes retain only a uniquely identifiable basename.
      }
      const candidates = materializedFilesByBasename.get(path.posix.basename(referencedPath)) || [];
      if (candidates.length !== 1) continue;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      try {
        await fs.link(candidates[0], targetPath);
      } catch {
        await fs.copyFile(candidates[0], targetPath);
      }
    }
  }
}

async function fastArchiveSignature(archivePath) {
  const stat = await fs.stat(archivePath);
  const handle = await fs.open(archivePath, "r");
  try {
    const sampleSize = 64 * 1024;
    const firstLength = Math.min(sampleSize, stat.size);
    const first = Buffer.alloc(firstLength);
    if (firstLength) await handle.read(first, 0, firstLength, 0);
    const lastLength = stat.size > sampleSize ? sampleSize : 0;
    const last = Buffer.alloc(lastLength);
    if (lastLength) await handle.read(last, 0, lastLength, Math.max(0, stat.size - lastLength));
    return crypto.createHash("sha256")
      .update(`${stat.size}\0${stat.mtimeMs}\0`)
      .update(first)
      .update(last)
      .digest("hex");
  } finally {
    await handle.close();
  }
}

async function listZipEntries(archivePath, { signal = null } = {}) {
  const result = await execFileAsync(ZIP_BINARY, ["-Z1", archivePath], commandOptions(ARCHIVE_LIST_MAX_BUFFER, signal));
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).filter(isSafeEntry);
}

function archiveType(archivePath) {
  const extension = path.extname(archivePath).toLowerCase();
  if (extension === ".zip") return "zip";
  if (extension === ".7z") return "7z";
  if (extension === ".tzst") return "tzst";
  if (extension === ".zst" && path.extname(path.basename(archivePath, extension)).toLowerCase() === ".tar") return "tzst";
  // RSN is a solid RAR archive, not a 7z archive.  Some RAR methods that
  // are common in SNESMusic.org sets are not supported by 7zz.
  if (extension === ".rsn") return "rsn";
  return null;
}

function isSupportedArchivePath(archivePath) {
  return archiveType(archivePath) !== null;
}

async function listSevenZipEntries(archivePath, { signal = null } = {}) {
  const result = await execFileAsync(SEVEN_ZIP_BINARY, ["l", "-slt", "-ba", archivePath], commandOptions(ARCHIVE_LIST_MAX_BUFFER, signal));
  return result.stdout.split(/\r?\n/)
    .filter((line) => line.startsWith("Path = "))
    .map((line) => line.slice("Path = ".length).trim())
    .filter((entry) => entry && !entry.endsWith("/") && isSafeEntry(entry));
}

async function listRsnEntries(archivePath, { signal = null } = {}) {
  const result = await execFileAsync(LSAR_BINARY, ["-j", archivePath], commandOptions(ARCHIVE_LIST_MAX_BUFFER, signal));
  const listing = JSON.parse(result.stdout);
  return (listing.lsarContents || [])
    .map((entry) => entry.XADFileName)
    .filter((entry) => entry && isSafeEntry(entry));
}

async function decompressTarZstandard(archivePath, parentRoot = null, options = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(parentRoot || os.tmpdir(), parentRoot ? "tar-" : "spcboy-tzst-"));
  const rawTarPath = path.join(temporaryRoot, "archive.tar");
  await streamCommandToFile(ZSTD_BINARY, ["-d", "-q", "-c", "--", archivePath], rawTarPath, "zstd", options).catch(async (error) => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  });
  return { temporaryRoot, rawTarPath };
}

async function listTarZstandardEntries(archivePath, options = {}) {
  await options.ensureCapacity?.(archivePath);
  const scannerOwned = options.scratchOwner === "scan";
  const scratchRoot = scannerOwned ? await createScanScratchRoot() : await createPlaybackScratchRoot();
  const scratchOptions = {
    ...options,
    reserveBytes: scannerOwned
      ? disposableMaterializationReserve(options.reserveScratchBytes, scratchRoot)
      : disposableMaterializationReserve()
  };
  try {
    const { temporaryRoot, rawTarPath } = await decompressTarZstandard(archivePath, scratchRoot, scratchOptions);
    try {
      const result = await execFileAsync(TAR_BINARY, ["-tf", rawTarPath], commandOptions(ARCHIVE_LIST_MAX_BUFFER, options.signal));
      return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).filter(isSafeEntry);
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    if (scannerOwned) await removeScanScratchRoot(scratchRoot);
    else await removePlaybackScratchRoot(scratchRoot);
    await options.onScratchReleased?.();
  }
}

async function listArchiveEntries(archivePath, options = {}) {
  if (archiveType(archivePath) === "zip") return listZipEntries(archivePath, options);
  if (archiveType(archivePath) === "7z") return listSevenZipEntries(archivePath, options);
  if (archiveType(archivePath) === "rsn") return listRsnEntries(archivePath, options);
  if (archiveType(archivePath) === "tzst") return listTarZstandardEntries(archivePath, options);
  throw new Error(`Unsupported archive type: ${path.extname(archivePath)}`);
}

function escapeArchivePattern(entry) {
  return entry.replace(/[\[*?]/g, (character) => ({
    "[": "[[]",
    "*": "[*]",
    "?": "[?]"
  })[character]);
}

function streamCommandToFile(program, args, outputPath, label, { reserveBytes = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`));
      return;
    }
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output = fsSync.createWriteStream(outputPath, { flags: "wx" });
    const stderrChunks = [];
    let stderrLength = 0;
    let childCode = null;
    let outputFinished = false;
    let settled = false;
    let abortError = null;
    let forceKillTimer = null;
    const cleanup = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (error = null) => {
      if (settled) return;
      if (error) {
        settled = true;
        cleanup();
        child.kill();
        output.destroy();
        reject(error);
        return;
      }
      if (childCode === null || !outputFinished) return;
      settled = true;
      cleanup();
      if (abortError) reject(abortError);
      else if (childCode === 0) resolve();
      else reject(new Error(Buffer.concat(stderrChunks).toString("utf8").trim() || `${label} exited with code ${childCode}`));
    };
    const abort = () => {
      if (settled || abortError) return;
      abortError = signal?.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`);
      if (!child.killed) child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1_000);
      forceKillTimer.unref?.();
    };
    const quota = reserveBytes ? new Transform({
      transform(chunk, _encoding, callback) {
        Promise.resolve(reserveBytes(chunk.length)).then(() => callback(null, chunk), callback);
      }
    }) : null;
    if (quota) {
      child.stdout.pipe(quota).pipe(output);
      quota.on("error", finish);
    } else {
      child.stdout.pipe(output);
    }
    child.stderr.on("data", (chunk) => {
      if (stderrLength >= 1024 * 1024) return;
      const retained = chunk.subarray(0, Math.max(0, 1024 * 1024 - stderrLength));
      stderrChunks.push(retained);
      stderrLength += retained.length;
    });
    child.on("error", finish);
    child.on("close", (code) => {
      childCode = code;
      finish();
    });
    output.on("error", finish);
    output.on("finish", () => {
      outputFinished = true;
      finish();
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function streamArchiveEntryToFile(archivePath, entry, outputPath, rawTarPath = null, options = {}) {
  const type = archiveType(archivePath);
  if (type === "rsn") {
    // unar supports the solid RAR4 method used by these RSN sets and can
    // stream one member to stdout without unpacking the entire archive.
    return streamCommandToFile(UNAR_BINARY, ["-q", "-f", "-o", "-", archivePath, entry], outputPath, "unar", options);
  }

  if (type === "zip") {
    try {
      await fs.access(BSDTAR_BINARY);
      // macOS ships bsdtar. It matches the member name directly, avoiding
      // wildcard interpretation of brackets in valid filenames after the
      // archive member is converted to a literal glob pattern.
      return streamCommandToFile(BSDTAR_BINARY, ["-xOf", archivePath, escapeArchivePattern(entry)], outputPath, "bsdtar", options);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // Keep 7zz as a fallback for systems without bsdtar.
    }
  }

  if (type === "tzst") {
    if (rawTarPath) return streamCommandToFile(TAR_BINARY, ["-xOf", rawTarPath, escapeArchivePattern(entry)], outputPath, "bsdtar", options);
    const decompressed = await decompressTarZstandard(archivePath, null, options);
    try {
      return await streamArchiveEntryToFile(archivePath, entry, outputPath, decompressed.rawTarPath, options);
    } finally {
      await fs.rm(decompressed.temporaryRoot, { recursive: true, force: true });
    }
  }

  // 7zz treats the entry as an exact archive member.
  return streamCommandToFile(SEVEN_ZIP_BINARY, ["x", "-so", archivePath, entry], outputPath, "7zz", options);
}

function dependencyKindForExtension(extension) {
  return USF_ARCHIVE_EXTENSIONS.has(extension) ? "usf"
    : GSF_ARCHIVE_EXTENSIONS.has(extension) ? "gsf"
    : TWOSF_ARCHIVE_EXTENSIONS.has(extension) ? "twosf"
      : PSF1_ARCHIVE_EXTENSIONS.has(extension) ? "psf"
        : PSF2_ARCHIVE_EXTENSIONS.has(extension) ? "psf2"
          : "vgmstream";
}

async function materializeZipEntryUnlocked(archivePath, entry, options = {}) {
  if (!isSafeEntry(entry)) throw new Error(`Unsafe archive entry path: ${entry}`);
  if (DEPENDENCY_ARCHIVE_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
    return materializeDependencySetEntry(archivePath, entry, options);
  }
  const stat = await fs.stat(archivePath);
  const key = crypto.createHash("sha256").update(`${archivePath}\0${entry}\0${stat.size}\0${stat.mtimeMs}`).digest("hex");
  const extension = path.extname(entry).toLowerCase();
  const outputPath = path.join(cacheRootPath(), `${key}${extension}`);
  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {}
  await fs.mkdir(cacheRootPath(), { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}`;
  await streamArchiveEntryToFile(archivePath, entry, tempPath, null, options);
  await fs.rename(tempPath, outputPath);
  return outputPath;
}

function normalizeArchiveCacheLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES;
  return Math.max(MIN_ARCHIVE_CACHE_LIMIT_BYTES, Math.min(MAX_ARCHIVE_CACHE_LIMIT_BYTES, Math.floor(numeric)));
}

function archiveCacheEntryRoot(entryPath, rootPath = cacheRootPath()) {
  const relative = path.relative(rootPath, entryPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return path.join(rootPath, relative.split(path.sep)[0]);
}

async function touchArchiveCacheEntry(entryPath) {
  const rootPath = archiveCacheEntryRoot(entryPath);
  if (!rootPath) return;
  const stat = await fs.stat(rootPath).catch(() => null);
  if (!stat) return;
  const now = new Date();
  if (stat.isDirectory()) {
    await fs.writeFile(path.join(rootPath, ".last-used"), String(now.getTime()), "utf8");
  } else {
    await fs.utimes(rootPath, now, now);
  }
}

function isProtectedArchiveCacheEntry(entryPath, protectedPaths) {
  return protectedPaths.some((protectedPath) => protectedPath === entryPath || protectedPath.startsWith(`${entryPath}${path.sep}`));
}

async function archiveCacheEntries(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const results = [];
  for (const entry of entries) {
    if (entry.name.includes(".tmp-")) continue;
    const entryPath = path.join(rootPath, entry.name);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat || (!stat.isDirectory() && !stat.isFile())) continue;
    const lastUsed = stat.isDirectory()
      ? await fs.stat(path.join(entryPath, ".last-used")).then((marker) => marker.mtimeMs).catch(() => stat.mtimeMs)
      : stat.mtimeMs;
    results.push({ path: entryPath, bytes: stat.isDirectory() ? await directoryByteCount(entryPath) : stat.size, lastUsed });
  }
  return results;
}

async function pruneArchiveCacheUnlocked(limitBytes, protectedPaths = []) {
  const entries = [
    ...await archiveCacheEntries(cacheRootPath()),
    ...(legacyCacheRootPath() === cacheRootPath() ? [] : await archiveCacheEntries(legacyCacheRootPath()))
  ];
  let byteCount = entries.reduce((total, entry) => total + entry.bytes, 0);
  let evictedBytes = 0;
  let evictedEntryCount = 0;
  for (const entry of entries.sort((left, right) => left.lastUsed - right.lastUsed)) {
    if (byteCount <= limitBytes) break;
    if (isProtectedArchiveCacheEntry(entry.path, protectedPaths)) continue;
    await fs.rm(entry.path, { recursive: true, force: true });
    byteCount -= entry.bytes;
    evictedBytes += entry.bytes;
    evictedEntryCount += 1;
  }
  return { byteCount: Math.max(0, byteCount), evictedBytes, evictedEntryCount, overLimitBytes: Math.max(0, byteCount - limitBytes) };
}

async function pruneArchiveCache(limitBytes = DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES, protectedPaths = []) {
  return archiveCacheGate.clear(() => pruneArchiveCacheUnlocked(normalizeArchiveCacheLimit(limitBytes), protectedPaths));
}

async function materializeZipEntry(archivePath, entry, options = {}) {
  return archiveCacheGate.materialize(async () => {
    if (!isSafeEntry(entry)) throw new Error(`Unsafe archive entry path: ${entry}`);
    const extension = path.extname(entry).toLowerCase();
    const lockScope = DEPENDENCY_ARCHIVE_EXTENSIONS.has(extension)
      ? dependencyKindForExtension(extension)
      : `entry:${entry}`;
    const lockKey = `${archivePath}\0${lockScope}`;
    const previous = materializationPromises.get(lockKey) || Promise.resolve();
    // Different tracks in one dependency family must queue behind one another,
    // but each caller still needs its own selected member path.
    const cacheLimitBytes = normalizeArchiveCacheLimit(options.cacheLimitBytes);
    let writtenBytes = 0;
    const reserveBytes = async (byteCount) => {
      writtenBytes += Number(byteCount || 0);
      if (writtenBytes > cacheLimitBytes) {
        throw new Error(`Archive member exceeds the configured ${(cacheLimitBytes / (1024 * 1024)).toFixed(0)} MB cache limit. Increase the Archive Cache limit or disable caching for disposable playback.`);
      }
    };
    const promise = previous.catch(() => {}).then(() => materializeZipEntryUnlocked(archivePath, entry, { reserveBytes }));
    materializationPromises.set(lockKey, promise);
    const clear = () => {
      if (materializationPromises.get(lockKey) === promise) materializationPromises.delete(lockKey);
    };
    promise.then(clear, clear);
    const outputPath = await promise;
    await touchArchiveCacheEntry(outputPath);
    // The entry just returned is a live playback lease until the main process
    // replaces or releases it; never evict it while enforcing the cache cap.
    await pruneArchiveCacheUnlocked(normalizeArchiveCacheLimit(options.cacheLimitBytes), [...(options.protectedPaths || []), outputPath]);
    return outputPath;
  });
}

async function materializeDependencySetEntry(archivePath, selectedEntry, options = {}) {
  const stat = await fs.stat(archivePath);
  const selectedExtension = path.extname(selectedEntry).toLowerCase();
  const dependencyKind = dependencyKindForExtension(selectedExtension);
  const key = crypto.createHash("sha256").update(`${archivePath}\0${dependencyKind}\0${stat.size}\0${stat.mtimeMs}`).digest("hex");
  const outputRoot = path.join(cacheRootPath(), `${dependencyKind}-${key}`);
  const outputPath = path.join(outputRoot, selectedEntry.split("/").join(path.sep));
  const completionPath = path.join(outputRoot, ".complete");
  if (!outputPath.startsWith(`${outputRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);

  try {
    await fs.access(completionPath);
    await fs.access(outputPath);
    return outputPath;
  } catch {}

  await fs.mkdir(outputRoot, { recursive: true });
  const materializedPath = await materializeDependencySetEntryIntoRoot(archivePath, selectedEntry, dependencyKind, outputRoot, options);
  await fs.writeFile(`${completionPath}.tmp-${process.pid}`, "complete", "utf8");
  await fs.rename(`${completionPath}.tmp-${process.pid}`, completionPath);
  return materializedPath;
}

async function materializeDependencySetEntryIntoRoot(archivePath, selectedEntry, dependencyKind, outputRoot, options = {}) {
  const outputPath = path.join(outputRoot, selectedEntry.split("/").join(path.sep));
  if (!outputPath.startsWith(`${outputRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
  const entries = (await listArchiveEntries(archivePath, options)).filter((entry) => (
    (dependencyKind === "vgmstream" ? VGMSTREAM_COMPANION_EXTENSIONS : dependencyKind === "psf" ? PSF1_ARCHIVE_EXTENSIONS : dependencyKind === "psf2" ? PSF2_ARCHIVE_EXTENSIONS : DEPENDENCY_ARCHIVE_EXTENSIONS).has(path.extname(entry).toLowerCase())
  ));
  for (const entry of entries) {
    const destination = path.join(outputRoot, entry.split("/").join(path.sep));
    if (!destination.startsWith(`${outputRoot}${path.sep}`)) continue;
    try {
      await fs.access(destination);
      continue;
    } catch {}
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const tempPath = `${destination}.tmp-${process.pid}`;
    await streamArchiveEntryToFile(archivePath, entry, tempPath, null, options);
    await fs.rename(tempPath, destination);
  }
  if (dependencyKind === "vgmstream") {
    await materializeTxtpRelativeAliases(outputRoot, entries);
  }

  await fs.access(outputPath);
  return outputPath;
}

async function materializeArchiveEntryForScan(archivePath, selectedEntry, options = {}) {
  if (!isSafeEntry(selectedEntry)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
  const scratchRoot = await createScanScratchRoot();
  const scratchOptions = {
    ...options,
    scratchOwner: "scan",
    reserveScratchBytes: options.reserveBytes,
    reserveBytes: disposableMaterializationReserve(options.reserveBytes, scratchRoot)
  };
  try {
    const extension = path.extname(selectedEntry).toLowerCase();
    let playablePath;
    if (DEPENDENCY_ARCHIVE_EXTENSIONS.has(extension)) {
      playablePath = await materializeDependencySetEntryIntoRoot(archivePath, selectedEntry, dependencyKindForExtension(extension), scratchRoot, scratchOptions);
    } else {
      playablePath = path.join(scratchRoot, selectedEntry.split("/").join(path.sep));
      if (!playablePath.startsWith(`${scratchRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
      await fs.mkdir(path.dirname(playablePath), { recursive: true });
      await streamArchiveEntryToFile(archivePath, selectedEntry, playablePath, null, scratchOptions);
    }
    return {
      path: playablePath,
      cleanup: () => removeScanScratchRoot(scratchRoot)
    };
  } catch (error) {
    await removeScanScratchRoot(scratchRoot);
    throw error;
  }
}

async function materializeArchiveEntryForPlayback(archivePath, selectedEntry) {
  if (!isSafeEntry(selectedEntry)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
  const scratchRoot = await createPlaybackScratchRoot();
  const reserveBytes = disposableMaterializationReserve();
  try {
    const extension = path.extname(selectedEntry).toLowerCase();
    let playablePath;
    if (DEPENDENCY_ARCHIVE_EXTENSIONS.has(extension)) {
      playablePath = await materializeDependencySetEntryIntoRoot(archivePath, selectedEntry, dependencyKindForExtension(extension), scratchRoot, { reserveBytes });
    } else {
      playablePath = path.join(scratchRoot, selectedEntry.split("/").join(path.sep));
      if (!playablePath.startsWith(`${scratchRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
      await fs.mkdir(path.dirname(playablePath), { recursive: true });
      await streamArchiveEntryToFile(archivePath, selectedEntry, playablePath, null, { reserveBytes });
    }
    return { path: playablePath, cleanup: () => removePlaybackScratchRoot(scratchRoot) };
  } catch (error) {
    await removePlaybackScratchRoot(scratchRoot);
    throw error;
  }
}

async function materializeArchiveEntriesForScan(archivePath, selectedEntries, options = {}) {
  const entries = [...new Set(selectedEntries || [])];
  if (!entries.every(isSafeEntry)) throw new Error("Unsafe archive entry path");
  const scratchRoot = await createScanScratchRoot();
  const scratchOptions = {
    ...options,
    scratchOwner: "scan",
    reserveScratchBytes: options.reserveBytes,
    reserveBytes: disposableMaterializationReserve(options.reserveBytes, scratchRoot)
  };
  const preparedDependencyKinds = new Set();
  const paths = new Map();
  try {
    // A tar.zst is a single compressed stream. Extracting each member with
    // extractArchiveEntry would restart zstd from byte zero for every PSF,
    // PSF2, or vgmstream member. Keep one decompressed TAR for the whole
    // archive job, matching CocoaSpice's shared scan materialization model.
    if (archiveType(archivePath) === "tzst") {
      const { temporaryRoot, rawTarPath } = await decompressTarZstandard(archivePath, scratchRoot, scratchOptions);
      try {
        const listing = await execFileAsync(TAR_BINARY, ["-tf", rawTarPath], commandOptions(ARCHIVE_LIST_MAX_BUFFER, options.signal));
        const allEntries = listing.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).filter(isSafeEntry);
        const requiredEntries = new Set(entries);
        for (const selectedEntry of entries) {
          const extension = path.extname(selectedEntry).toLowerCase();
          if (!DEPENDENCY_ARCHIVE_EXTENSIONS.has(extension)) continue;
          const dependencyKind = dependencyKindForExtension(extension);
          if (preparedDependencyKinds.has(dependencyKind)) continue;
          preparedDependencyKinds.add(dependencyKind);
          const allowedExtensions = dependencyKind === "vgmstream"
            ? VGMSTREAM_COMPANION_EXTENSIONS
            : dependencyKind === "psf"
              ? PSF1_ARCHIVE_EXTENSIONS
              : dependencyKind === "psf2"
                ? PSF2_ARCHIVE_EXTENSIONS
                : DEPENDENCY_ARCHIVE_EXTENSIONS;
          allEntries.forEach((entry) => {
            if (allowedExtensions.has(path.extname(entry).toLowerCase())) requiredEntries.add(entry);
          });
        }
        for (const entry of requiredEntries) {
          const destination = path.join(scratchRoot, entry.split("/").join(path.sep));
          if (!destination.startsWith(`${scratchRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${entry}`);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          try {
            await fs.access(destination);
            continue;
          } catch {}
          const tempPath = `${destination}.tmp-${process.pid}`;
          await streamArchiveEntryToFile(archivePath, entry, tempPath, rawTarPath, scratchOptions);
          await fs.rename(tempPath, destination);
        }
        if (preparedDependencyKinds.has("vgmstream")) {
          await materializeTxtpRelativeAliases(scratchRoot, [...requiredEntries]);
        }
        for (const selectedEntry of entries) {
          const playablePath = path.join(scratchRoot, selectedEntry.split("/").join(path.sep));
          await fs.access(playablePath);
          paths.set(selectedEntry, playablePath);
        }
      } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
      return {
        root: scratchRoot,
        paths,
        cleanup: () => removeScanScratchRoot(scratchRoot)
      };
    }

    for (const selectedEntry of entries) {
      const extension = path.extname(selectedEntry).toLowerCase();
      let playablePath;
      if (DEPENDENCY_ARCHIVE_EXTENSIONS.has(extension)) {
        const dependencyKind = dependencyKindForExtension(extension);
        if (!preparedDependencyKinds.has(dependencyKind)) {
          await materializeDependencySetEntryIntoRoot(archivePath, selectedEntry, dependencyKind, scratchRoot, scratchOptions);
          preparedDependencyKinds.add(dependencyKind);
        }
        playablePath = path.join(scratchRoot, selectedEntry.split("/").join(path.sep));
      } else {
        playablePath = path.join(scratchRoot, selectedEntry.split("/").join(path.sep));
        if (!playablePath.startsWith(`${scratchRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
        try {
          await fs.access(playablePath);
        } catch {
          await fs.mkdir(path.dirname(playablePath), { recursive: true });
          const tempPath = `${playablePath}.tmp-${process.pid}`;
          await streamArchiveEntryToFile(archivePath, selectedEntry, tempPath, null, scratchOptions);
          await fs.rename(tempPath, playablePath);
        }
      }
      paths.set(selectedEntry, playablePath);
    }
    for (const playablePath of paths.values()) await fs.access(playablePath);
    return {
      root: scratchRoot,
      paths,
      cleanup: () => removeScanScratchRoot(scratchRoot)
    };
  } catch (error) {
    await removeScanScratchRoot(scratchRoot);
    throw error;
  }
}

async function archivePlayableEntries(archivePath, supportedExtension, options = {}) {
  const entries = await listArchiveEntries(archivePath, options);
  return entries.filter((entry) => supportedExtension(path.extname(entry).toLowerCase()));
}

async function archivePlayableEntriesWithSignature(archivePath, supportedExtension, options = {}) {
  const entries = await listArchiveEntries(archivePath, options);
  const signature = crypto.createHash("sha256").update(entries.slice().sort().join("\0")).digest("hex");
  return {
    entries: entries.filter((entry) => supportedExtension(path.extname(entry).toLowerCase())),
    signature
  };
}

async function archiveCacheSummary() {
  let fileCount = 0;
  let byteCount = 0;
  let partialCount = 0;
  async function walk(folderPath) {
    let entries;
    try {
      entries = await fs.readdir(folderPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile() || entry.name === ".last-used") continue;
      const stat = await fs.stat(entryPath);
      fileCount += 1;
      byteCount += stat.size;
      if (entry.name.includes(".tmp-") || entry.name === ".partial") partialCount += 1;
    }
  }
  await walk(cacheRootPath());
  let legacyFileCount = 0;
  let legacyByteCount = 0;
  if (legacyCacheRootPath() !== cacheRootPath()) {
    const currentFileCount = fileCount;
    const currentByteCount = byteCount;
    fileCount = 0;
    byteCount = 0;
    await walk(legacyCacheRootPath());
    legacyFileCount = fileCount;
    legacyByteCount = byteCount;
    fileCount = currentFileCount + legacyFileCount;
    byteCount = currentByteCount + legacyByteCount;
  }
  return { rootPath: cacheRootPath(), fileCount, byteCount, partialCount, legacyFileCount, legacyByteCount };
}

async function clearArchiveCache() {
  return archiveCacheGate.clear(async () => {
    await fs.rm(cacheRootPath(), { recursive: true, force: true });
    if (legacyCacheRootPath() !== cacheRootPath()) await fs.rm(legacyCacheRootPath(), { recursive: true, force: true });
    return archiveCacheSummary();
  });
}

function isArchiveCacheBusy() {
  return archiveCacheGate.isBusy;
}

module.exports = { archivePlayableEntries, archivePlayableEntriesWithSignature, materializeArchiveEntryForScan, materializeArchiveEntryForPlayback, materializeArchiveEntriesForScan, materializeZipEntry, listZipEntries, listArchiveEntries, archiveType, isSupportedArchivePath, archiveCacheSummary, clearArchiveCache, pruneArchiveCache, cacheRootPath, fastArchiveSignature, isArchiveCacheBusy, scanScratchSummary, recoverAbandonedScanScratchRoots, recoverAbandonedPlaybackScratchRoots, availableScratchBytes, DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES, MIN_ARCHIVE_CACHE_LIMIT_BYTES, MAX_ARCHIVE_CACHE_LIMIT_BYTES };
