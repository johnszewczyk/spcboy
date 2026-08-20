const fsSync = require("fs");
const fs = fsSync.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { Transform } = require("stream");
const { StringDecoder } = require("string_decoder");
const { ArchiveCacheGate } = require("./archive-cache-gate");

const ZIP_BINARY = process.env.SPCBOY_UNZIP_BINARY || "/usr/bin/unzip";
const BSDTAR_BINARY = process.env.SPCBOY_BSDTAR_BINARY || "/usr/bin/bsdtar";
const TAR_BINARY = process.env.SPCBOY_TAR_BINARY || "/usr/bin/bsdtar";
const ZSTD_BINARY = process.env.SPCBOY_ZSTD_BINARY || "/opt/homebrew/bin/zstd";
const SEVEN_ZIP_BINARY = process.env.SPCBOY_7Z_BINARY || "/opt/homebrew/bin/7zz";
const LSAR_BINARY = process.env.SPCBOY_LSAR_BINARY || "/opt/homebrew/bin/lsar";
const UNAR_BINARY = process.env.SPCBOY_UNAR_BINARY || "/opt/homebrew/bin/unar";
const ARCHIVE_LIST_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const ARCHIVE_LIST_MAX_ENTRIES = 250_000;
const ARCHIVE_ENTRY_MAX_NAME_BYTES = 32 * 1024;
const MAX_DECOMPRESSED_TARS = 2;

// Session-scoped reuse of decompressed tar.zst streams so every member of an
// archive shares one decompression instead of restarting zstd per extraction.
const decompressedTarCache = new Map();

async function acquireRawTar(archivePath, options = {}) {
  const stat = await fs.stat(archivePath);
  const key = `${archivePath}\0${stat.size}\0${stat.mtimeMs}`;
  const cached = decompressedTarCache.get(archivePath);
  if (cached && cached.key === key) {
    const stillValid = await fs.access(cached.rawTarPath).then(() => true).catch(() => false);
    if (stillValid) {
      cached.lastUsedMs = Date.now();
      return { rawTarPath: cached.rawTarPath };
    }
    await fs.rm(cached.temporaryRoot, { recursive: true, force: true });
    decompressedTarCache.delete(archivePath);
  }
  const decompressed = await decompressTarZstandard(archivePath, null, options);
  const latest = decompressedTarCache.get(archivePath);
  if (latest && latest.key === key) {
    await fs.rm(decompressed.temporaryRoot, { recursive: true, force: true });
    latest.lastUsedMs = Date.now();
    return { rawTarPath: latest.rawTarPath };
  }
  decompressedTarCache.set(archivePath, {
    key,
    rawTarPath: decompressed.rawTarPath,
    temporaryRoot: decompressed.temporaryRoot,
    lastUsedMs: Date.now()
  });
  if (decompressedTarCache.size > MAX_DECOMPRESSED_TARS) {
    let oldestKey = null;
    let oldestUsed = Infinity;
    for (const [candidateKey, entry] of decompressedTarCache) {
      if (entry.lastUsedMs < oldestUsed) {
        oldestUsed = entry.lastUsedMs;
        oldestKey = candidateKey;
      }
    }
    if (oldestKey && oldestKey !== archivePath) {
      const evicted = decompressedTarCache.get(oldestKey);
      await fs.rm(evicted.temporaryRoot, { recursive: true, force: true });
      decompressedTarCache.delete(oldestKey);
    }
  }
  return { rawTarPath: decompressed.rawTarPath };
}

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
const INSPECTION_SCRATCH_PREFIX = "spcboy-playlist-inspection-scratch-";
const PLAYBACK_SCRATCH_PREFIX = "spcboy-playback-scratch-";
const DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_ARCHIVE_CACHE_LIMIT_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_CACHE_LIMIT_BYTES = 16 * 1024 * 1024 * 1024;
const PLAYBACK_SCRATCH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PLAYBACK_SCRATCH_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const SCRATCH_OWNER_FILE = ".spcboy-owner.json";
const activeInspectionScratchRoots = new Set();
const activePlaybackScratchRoots = new Set();

function inspectionScratchParentPath() {
  return process.env.SPCBOY_INSPECTION_SCRATCH_ROOT || os.tmpdir();
}

function isInspectionScratchRoot(rootPath) {
  return path.dirname(rootPath) === inspectionScratchParentPath() && path.basename(rootPath).startsWith(INSPECTION_SCRATCH_PREFIX);
}

async function directoryByteCount(rootPath) {
  let total = 0;
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.name === SCRATCH_OWNER_FILE) continue;
    if (entry.isDirectory()) total += await directoryByteCount(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
}

async function writeScratchOwner(rootPath) {
  await fs.writeFile(path.join(rootPath, SCRATCH_OWNER_FILE), JSON.stringify({
    pid: process.pid,
    token: crypto.randomUUID(),
    createdAt: Date.now()
  }), { encoding: "utf8", flag: "wx" });
}

async function scratchOwnerIsLive(rootPath) {
  const owner = await fs.readFile(path.join(rootPath, SCRATCH_OWNER_FILE), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function createInspectionScratchRoot() {
  await fs.mkdir(inspectionScratchParentPath(), { recursive: true });
  const rootPath = await fs.mkdtemp(path.join(inspectionScratchParentPath(), INSPECTION_SCRATCH_PREFIX));
  try {
    await writeScratchOwner(rootPath);
  } catch (error) {
    await fs.rm(rootPath, { recursive: true, force: true });
    throw error;
  }
  activeInspectionScratchRoots.add(rootPath);
  return rootPath;
}

async function removeInspectionScratchRoot(rootPath) {
  if (!isInspectionScratchRoot(rootPath)) throw new Error(`Refusing to remove non-inspection scratch root: ${rootPath}`);
  try {
    await fs.rm(rootPath, { recursive: true, force: true });
  } finally {
    activeInspectionScratchRoots.delete(rootPath);
  }
}

function isPlaybackScratchRoot(rootPath) {
  return path.dirname(rootPath) === inspectionScratchParentPath() && path.basename(rootPath).startsWith(PLAYBACK_SCRATCH_PREFIX);
}

async function createPlaybackScratchRoot() {
  await fs.mkdir(inspectionScratchParentPath(), { recursive: true });
  const rootPath = await fs.mkdtemp(path.join(inspectionScratchParentPath(), PLAYBACK_SCRATCH_PREFIX));
  try {
    await writeScratchOwner(rootPath);
  } catch (error) {
    await fs.rm(rootPath, { recursive: true, force: true });
    throw error;
  }
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

async function inspectionScratchSummary() {
  const roots = [...activeInspectionScratchRoots];
  const activeBytes = (await Promise.all(roots.map((rootPath) => directoryByteCount(rootPath).catch(() => 0))))
    .reduce((total, bytes) => total + bytes, 0);
  return { activeRootCount: roots.length, activeBytes };
}

async function recoverAbandonedInspectionScratchRoots() {
  const recovered = { recoveredRootCount: 0, recoveredBytes: 0 };
  const entries = await fs.readdir(inspectionScratchParentPath(), { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(INSPECTION_SCRATCH_PREFIX)) continue;
    const rootPath = path.join(inspectionScratchParentPath(), entry.name);
    if (activeInspectionScratchRoots.has(rootPath)) continue;
    if (await scratchOwnerIsLive(rootPath)) continue;
    const bytes = await directoryByteCount(rootPath).catch(() => 0);
    await fs.rm(rootPath, { recursive: true, force: true });
    recovered.recoveredRootCount += 1;
    recovered.recoveredBytes += bytes;
  }
  return { ...recovered, ...await inspectionScratchSummary() };
}

async function recoverAbandonedPlaybackScratchRoots() {
  const recovered = { recoveredRootCount: 0, recoveredBytes: 0 };
  const entries = await fs.readdir(inspectionScratchParentPath(), { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PLAYBACK_SCRATCH_PREFIX)) continue;
    const rootPath = path.join(inspectionScratchParentPath(), entry.name);
    if (activePlaybackScratchRoots.has(rootPath)) continue;
    if (await scratchOwnerIsLive(rootPath)) continue;
    const bytes = await directoryByteCount(rootPath).catch(() => 0);
    await fs.rm(rootPath, { recursive: true, force: true });
    recovered.recoveredRootCount += 1;
    recovered.recoveredBytes += bytes;
  }
  return recovered;
}

async function availableScratchBytes() {
  const stat = await fs.statfs(inspectionScratchParentPath());
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

async function fastSourceSignature(sourcePath, knownStat = null) {
  const stat = knownStat || await fs.stat(sourcePath);
  const handle = await fs.open(sourcePath, "r");
  try {
    const readAt = async (length, position) => {
      const buffer = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const result = await handle.read(buffer, offset, length - offset, position + offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      return offset === length ? buffer : buffer.subarray(0, offset);
    };
    const sampleSize = 64 * 1024;
    const fullHashThreshold = 1024 * 1024;
    // Content identity is deliberately independent from stat identity. A
    // timestamp-only copy can reuse inspected rows after the cheap stat gate
    // misses, while size/mtime remain separately persisted guards.
    const hash = crypto.createHash("sha256").update("spcboy-content-v1\0");
    if (stat.size <= fullHashThreshold) {
      const contents = await readAt(stat.size, 0);
      return hash.update(contents).digest("hex");
    }
    const offsets = [
      0,
      Math.max(0, Math.floor((stat.size - sampleSize) / 2)),
      Math.max(0, stat.size - sampleSize)
    ];
    for (const offset of offsets) {
      const sample = await readAt(Math.min(sampleSize, stat.size - offset), offset);
      hash.update(sample);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

const fastArchiveSignature = fastSourceSignature;

function listingLimit(options, key, fallback) {
  const value = Number(options?.[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(fallback, Math.floor(value)) : fallback;
}

function createArchiveEntryCollector(options = {}) {
  const maxEntries = listingLimit(options, "maxEntries", ARCHIVE_LIST_MAX_ENTRIES);
  const maxEntryNameBytes = listingLimit(options, "maxEntryNameBytes", ARCHIVE_ENTRY_MAX_NAME_BYTES);
  const entries = [];
  return {
    add(entry) {
      const value = String(entry ?? "");
      if (!value || !isSafeEntry(value)) return;
      const nameBytes = Buffer.byteLength(value, "utf8");
      if (nameBytes > maxEntryNameBytes) throw new Error(`Archive member name exceeds the ${maxEntryNameBytes}-byte safety limit.`);
      if (entries.length >= maxEntries) throw new Error(`Archive contains more than the ${maxEntries}-entry safety limit.`);
      entries.push(value);
    },
    entries
  };
}

function runListingCommand(program, args, label, { signal = null, maxOutputBytes = ARCHIVE_LIST_MAX_OUTPUT_BYTES, onLine = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`));
      return;
    }
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    const outputLimit = Math.min(ARCHIVE_LIST_MAX_OUTPUT_BYTES, Math.max(1, Number(maxOutputBytes) || ARCHIVE_LIST_MAX_OUTPUT_BYTES));
    const decoder = onLine ? new StringDecoder("utf8") : null;
    const outputChunks = [];
    const stderrChunks = [];
    let pendingLine = "";
    let outputBytes = 0;
    let stderrBytes = 0;
    let failure = null;
    let forceKillTimer = null;
    const cleanup = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
    };
    const stop = (error) => {
      if (failure) return;
      failure = error;
      if (!child.killed) child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1_000);
      forceKillTimer.unref?.();
    };
    const emitLine = (line) => {
      const value = line.endsWith("\r") ? line.slice(0, -1) : line;
      onLine(value);
    };
    const consumeText = (text) => {
      pendingLine += text;
      while (true) {
        const newline = pendingLine.indexOf("\n");
        if (newline < 0) break;
        const line = pendingLine.slice(0, newline);
        pendingLine = pendingLine.slice(newline + 1);
        emitLine(line);
      }
      if (Buffer.byteLength(pendingLine, "utf8") > ARCHIVE_ENTRY_MAX_NAME_BYTES + 4096) {
        throw new Error("Archive listing contains an overlong output line.");
      }
    };
    const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`));

    child.stdout.on("data", (chunk) => {
      if (failure) return;
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        stop(new Error(`${label} exceeds the ${outputLimit}-byte listing-output safety limit.`));
        return;
      }
      try {
        if (onLine) consumeText(decoder.write(chunk));
        else outputChunks.push(chunk);
      } catch (error) {
        stop(error);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= 1024 * 1024) return;
      const retained = chunk.subarray(0, Math.max(0, 1024 * 1024 - stderrBytes));
      stderrChunks.push(retained);
      stderrBytes += retained.length;
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (!failure && onLine) {
        try {
          consumeText(decoder.end());
          if (pendingLine) emitLine(pendingLine);
        } catch (error) {
          failure = error;
        }
      }
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderrChunks).toString("utf8").trim() || `${label} exited with code ${code}`));
        return;
      }
      resolve(onLine ? null : Buffer.concat(outputChunks).toString("utf8"));
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function listZipEntries(archivePath, options = {}) {
  const collector = createArchiveEntryCollector(options);
  await runListingCommand(ZIP_BINARY, ["-Z1", archivePath], "ZIP listing", {
    ...options,
    onLine: (entry) => collector.add(entry)
  });
  return collector.entries;
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

async function listSevenZipEntries(archivePath, options = {}) {
  const collector = createArchiveEntryCollector(options);
  await runListingCommand(SEVEN_ZIP_BINARY, ["l", "-slt", "-ba", archivePath], "7z listing", {
    ...options,
    onLine: (line) => {
      if (!line.startsWith("Path = ")) return;
      const entry = line.slice("Path = ".length);
      if (!entry.endsWith("/")) collector.add(entry);
    }
  });
  return collector.entries;
}

async function listRsnEntries(archivePath, options = {}) {
  const output = await runListingCommand(LSAR_BINARY, ["-j", "-jss", archivePath], "RSN listing", options);
  const listing = JSON.parse(output);
  const collector = createArchiveEntryCollector(options);
  for (const entry of listing.lsarContents || []) collector.add(entry.XADFileName);
  return collector.entries;
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
  const inspectionOwned = options.scratchOwner === "inspection";
  const scratchRoot = inspectionOwned ? await createInspectionScratchRoot() : await createPlaybackScratchRoot();
  const scratchOptions = {
    ...options,
    reserveBytes: inspectionOwned
      ? disposableMaterializationReserve(options.reserveScratchBytes, scratchRoot)
      : disposableMaterializationReserve()
  };
  try {
    const { temporaryRoot, rawTarPath } = await decompressTarZstandard(archivePath, scratchRoot, scratchOptions);
    try {
      const collector = createArchiveEntryCollector(options);
      await runListingCommand(TAR_BINARY, ["-tf", rawTarPath], "TAR listing", {
        ...options,
        onLine: (entry) => collector.add(entry)
      });
      return collector.entries;
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    if (inspectionOwned) await removeInspectionScratchRoot(scratchRoot);
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
    const { rawTarPath: sharedRawTar } = await acquireRawTar(archivePath, options);
    return streamCommandToFile(TAR_BINARY, ["-xOf", sharedRawTar, escapeArchivePattern(entry)], outputPath, "bsdtar", options);
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
  const tempPath = `${outputPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await streamArchiveEntryToFile(archivePath, entry, tempPath, null, options);
    await fs.rename(tempPath, outputPath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
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

async function recoverArchiveCachePartials() {
  return archiveCacheGate.clear(async () => {
    let recoveredPartialCount = 0;
    let recoveredBytes = 0;
    for (const rootPath of new Set([cacheRootPath(), legacyCacheRootPath()])) {
      const entries = await fs.readdir(rootPath, { withFileTypes: true })
        .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
      for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);
        const temporaryFile = entry.isFile() && entry.name.includes(".tmp-");
        const incompleteDependencyRoot = entry.isDirectory()
          && !await fs.access(path.join(entryPath, ".complete")).then(() => true).catch(() => false);
        if (!temporaryFile && !incompleteDependencyRoot) continue;
        recoveredBytes += entry.isDirectory()
          ? await directoryByteCount(entryPath).catch(() => 0)
          : Number((await fs.stat(entryPath).catch(() => null))?.size || 0);
        await fs.rm(entryPath, { recursive: true, force: true });
        recoveredPartialCount += 1;
      }
    }
    return { recoveredPartialCount, recoveredBytes, ...await archiveCacheSummary() };
  });
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
  const temporaryCompletionPath = `${completionPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryCompletionPath, "complete", { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryCompletionPath, completionPath);
  } finally {
    await fs.rm(temporaryCompletionPath, { force: true });
  }
  return materializedPath;
}

async function materializeDependencySetEntryIntoRoot(archivePath, selectedEntry, dependencyKind, outputRoot, options = {}) {
  const outputPath = path.join(outputRoot, selectedEntry.split("/").join(path.sep));
  if (!outputPath.startsWith(`${outputRoot}${path.sep}`)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
  const entries = (await listArchiveEntries(archivePath, options)).filter((entry) => (
    (dependencyKind === "vgmstream" ? VGMSTREAM_COMPANION_EXTENSIONS : dependencyKind === "psf" ? PSF1_ARCHIVE_EXTENSIONS : dependencyKind === "psf2" ? PSF2_ARCHIVE_EXTENSIONS : DEPENDENCY_ARCHIVE_EXTENSIONS).has(path.extname(entry).toLowerCase())
  ));
  // A tar.zst is a single compressed stream. Share one decompressed TAR for
  // every member instead of restarting zstd (and charging the whole archive
  // against the cache quota) on each extraction.
  let rawTarPath = null;
  if (archiveType(archivePath) === "tzst") {
    ({ rawTarPath } = await acquireRawTar(archivePath, options));
  }
  for (const entry of entries) {
    const destination = path.join(outputRoot, entry.split("/").join(path.sep));
    if (!destination.startsWith(`${outputRoot}${path.sep}`)) continue;
    try {
      await fs.access(destination);
      continue;
    } catch {}
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const tempPath = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      await streamArchiveEntryToFile(archivePath, entry, tempPath, rawTarPath, options);
      await fs.rename(tempPath, destination);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }
  if (dependencyKind === "vgmstream") {
    await materializeTxtpRelativeAliases(outputRoot, entries);
  }

  await fs.access(outputPath);
  return outputPath;
}

async function materializeArchiveEntryForInspection(archivePath, selectedEntry, options = {}) {
  if (!isSafeEntry(selectedEntry)) throw new Error(`Unsafe archive entry path: ${selectedEntry}`);
  const scratchRoot = await createInspectionScratchRoot();
  const scratchOptions = {
    ...options,
    scratchOwner: "inspection",
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
      cleanup: () => removeInspectionScratchRoot(scratchRoot)
    };
  } catch (error) {
    await removeInspectionScratchRoot(scratchRoot);
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

async function materializeArchiveEntriesForInspection(archivePath, selectedEntries, options = {}) {
  const entries = [...new Set(selectedEntries || [])];
  if (!entries.every(isSafeEntry)) throw new Error("Unsafe archive entry path");
  const scratchRoot = await createInspectionScratchRoot();
  const scratchOptions = {
    ...options,
    scratchOwner: "inspection",
    reserveScratchBytes: options.reserveBytes,
    reserveBytes: disposableMaterializationReserve(options.reserveBytes, scratchRoot)
  };
  const preparedDependencyKinds = new Set();
  const paths = new Map();
  try {
    // A tar.zst is a single compressed stream. Extracting each member with
    // extractArchiveEntry would restart zstd from byte zero for every PSF,
    // PSF2, or vgmstream member. Keep one decompressed TAR for the whole
    // playlist request so dependency families are extracted only once.
    if (archiveType(archivePath) === "tzst") {
      const { temporaryRoot, rawTarPath } = await decompressTarZstandard(archivePath, scratchRoot, scratchOptions);
      try {
        const collector = createArchiveEntryCollector(options);
        await runListingCommand(TAR_BINARY, ["-tf", rawTarPath], "TAR listing", {
          ...options,
          onLine: (entry) => collector.add(entry)
        });
        const allEntries = collector.entries;
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
        cleanup: () => removeInspectionScratchRoot(scratchRoot)
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
      cleanup: () => removeInspectionScratchRoot(scratchRoot)
    };
  } catch (error) {
    await removeInspectionScratchRoot(scratchRoot);
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

module.exports = { archivePlayableEntries, archivePlayableEntriesWithSignature, materializeArchiveEntryForInspection, materializeArchiveEntryForPlayback, materializeArchiveEntriesForInspection, materializeZipEntry, listZipEntries, listArchiveEntries, archiveType, isSupportedArchivePath, archiveCacheSummary, clearArchiveCache, pruneArchiveCache, recoverArchiveCachePartials, cacheRootPath, fastSourceSignature, fastArchiveSignature, isArchiveCacheBusy, inspectionScratchSummary, recoverAbandonedInspectionScratchRoots, recoverAbandonedPlaybackScratchRoots, availableScratchBytes, DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES, MIN_ARCHIVE_CACHE_LIMIT_BYTES, MAX_ARCHIVE_CACHE_LIMIT_BYTES };
