const fs = require("fs").promises;
const path = require("path");
const { fastArchiveSignature, fastSourceSignature, materializeArchiveEntryForScan, materializeArchiveEntriesForScan, scanScratchSummary, availableScratchBytes } = require("./archive-resolver");
const { indexIndexedTracks, reusableRecordsForArchive, reusableRecordsForSource, sourceKey } = require("./library-scan");
const { routeForPath, routeForArchiveEntry } = require("./playback-core");
const { createScanOutcome, formatScanOutcome, summarizeScanOutcomes } = require("./scanner-model");
const { discoverPhysicalSources } = require("./scanner-discovery");
const { expandArchiveSources, ARCHIVE_LIST_CONCURRENCY } = require("./scanner-archive");

const DEFAULT_SCAN_VERSION = 3;
const DEFAULT_SCAN_CONCURRENCY = 8;
const DEFAULT_SCAN_SCRATCH_BUDGET_BYTES = 8 * 1024 * 1024 * 1024;
const MIN_FREE_SCRATCH_BYTES = 2 * 1024 * 1024 * 1024;
const SCRATCH_FREE_SPACE_RECHECK_BYTES = 16 * 1024 * 1024;

function scratchBudgetError(message) {
  const error = new Error(`Scan scratch space: ${message}`);
  error.scanState = "scratch-budget";
  return error;
}

async function createScanScratchBudget({ budgetBytes = DEFAULT_SCAN_SCRATCH_BUDGET_BYTES, recovery = {}, getSummary = scanScratchSummary, getAvailableBytes = availableScratchBytes } = {}) {
  const initial = await getSummary();
  let activeBytes = Number(initial.activeBytes) || 0;
  let activeRootCount = Number(initial.activeRootCount) || 0;
  let peakBytes = activeBytes;
  const ownedRoots = new Set();
  const normalizedBudget = Math.max(1, Number(budgetBytes) || DEFAULT_SCAN_SCRATCH_BUDGET_BYTES);
  let predictedAvailableBytes = null;
  let bytesSinceFreeSpaceCheck = 0;
  let lastFreeSpaceCheckAt = 0;
  let reserveTail = Promise.resolve();
  return {
    async ensureArchiveCapacity(archivePath) {
      const [stat, availableBytes] = await Promise.all([fs.stat(archivePath), getAvailableBytes()]);
      const estimate = Math.max(64 * 1024 * 1024, Math.min(normalizedBudget, Number(stat.size) || 0));
      if (Math.max(64 * 1024 * 1024, Number(stat.size) || 0) > normalizedBudget) {
        throw scratchBudgetError(`${archivePath} requires more than the ${normalizedBudget}-byte budget before extraction begins`);
      }
      if (availableBytes < MIN_FREE_SCRATCH_BYTES + estimate) {
        throw scratchBudgetError(`only ${availableBytes} bytes free; ${MIN_FREE_SCRATCH_BYTES + estimate} bytes are required before extracting ${archivePath}`);
      }
      if (activeBytes >= normalizedBudget) throw scratchBudgetError(`active scratch use has reached the ${normalizedBudget}-byte budget`);
      predictedAvailableBytes = predictedAvailableBytes === null
        ? availableBytes - SCRATCH_FREE_SPACE_RECHECK_BYTES
        : Math.min(predictedAvailableBytes, availableBytes - SCRATCH_FREE_SPACE_RECHECK_BYTES);
      bytesSinceFreeSpaceCheck = 0;
      lastFreeSpaceCheckAt = Date.now();
    },
    reserveBytes(_rootPath, byteCount) {
      const bytes = Math.max(0, Number(byteCount) || 0);
      if (activeBytes + bytes > normalizedBudget) throw scratchBudgetError(`the ${normalizedBudget}-byte budget would be exceeded`);
      ownedRoots.add(_rootPath);
      activeRootCount = Math.max(activeRootCount, ownedRoots.size);
      activeBytes += bytes;
      peakBytes = Math.max(peakBytes, activeBytes);
      const check = reserveTail.then(async () => {
        const shouldRefreshFreeSpace = predictedAvailableBytes === null
          || bytesSinceFreeSpaceCheck + bytes >= SCRATCH_FREE_SPACE_RECHECK_BYTES
          || Date.now() - lastFreeSpaceCheckAt >= 1_000;
        if (shouldRefreshFreeSpace) {
          const availableBytes = await getAvailableBytes();
          // Allow for output already admitted to stream buffers but not yet
          // reflected by statfs when this measurement completes.
          predictedAvailableBytes = availableBytes - SCRATCH_FREE_SPACE_RECHECK_BYTES;
          bytesSinceFreeSpaceCheck = 0;
          lastFreeSpaceCheckAt = Date.now();
        }
        if (predictedAvailableBytes - bytes < MIN_FREE_SCRATCH_BYTES) {
          throw scratchBudgetError(`streamed extraction would consume the ${MIN_FREE_SCRATCH_BYTES}-byte free-space reserve`);
        }
        predictedAvailableBytes -= bytes;
        bytesSinceFreeSpaceCheck += bytes;
      });
      reserveTail = check.catch(() => {});
      return check.catch((error) => {
        activeBytes = Math.max(0, activeBytes - bytes);
        throw error;
      });
    },
    async refresh() {
      await reserveTail;
      const summary = await getSummary();
      activeBytes = Number(summary.activeBytes) || 0;
      activeRootCount = Number(summary.activeRootCount) || 0;
      peakBytes = Math.max(peakBytes, activeBytes);
      predictedAvailableBytes = null;
      bytesSinceFreeSpaceCheck = 0;
      return summary;
    },
    snapshot() {
      return {
        activeRootCount,
        activeBytes,
        peakBytes,
        budgetBytes: normalizedBudget,
        recoveredRootCount: Number(recovery.recoveredRootCount) || 0,
        recoveredBytes: Number(recovery.recoveredBytes) || 0
      };
    }
  };
}

function throwIfCancelled(job) {
  if (job?.cancelled) throw new Error("Library operation cancelled");
}

function isCancellation(error) {
  return error?.message === "Library operation cancelled";
}

function sourceIdentity(rootPath, source) {
  return {
    rootPath,
    sourcePath: source.archivePath || source.path,
    archiveEntry: source.archiveEntry
  };
}

function routeForSource(source) {
  return source.archiveEntry ? routeForArchiveEntry(source.archiveEntry) : routeForPath(source.path);
}

function backendIdForSource(source) {
  return routeForSource(source)?.backendId || null;
}

function fallbackRecord(source, scanVersion) {
  const displayPath = source.archiveEntry ? `${source.archivePath}#${source.archiveEntry}` : source.path;
  return {
    folderPath: source.archiveEntry ? path.dirname(source.archivePath) : path.dirname(source.path),
    path: displayPath,
    filename: source.archiveEntry ? path.basename(source.archiveEntry) : path.basename(source.path),
    extension: path.extname(source.archiveEntry || source.path).toLowerCase(),
    backendId: backendIdForSource(source),
    archivePath: source.archivePath,
    archiveEntry: source.archiveEntry,
    archiveSignature: source.archiveSignature || null,
    trackIndex: 0,
    trackCount: 1,
    fileSize: 0,
    modifiedAt: 0,
    scanCompleted: false,
    scanVersion,
    specialAudioKind: null,
    metadata: null
  };
}

function recordsForVariants(source, stat, variants, failureOutcome, scanVersion) {
  const fallbackVariants = failureOutcome?.state === "unsupported"
    ? []
    : variants.length > 0
      ? variants
      : [{ trackIndex: 0, trackCount: 1, inspection: null }];
  const displayPath = source.archiveEntry ? `${source.archivePath}#${source.archiveEntry}` : source.path;
  const fallbackGame = source.archiveEntry
    ? path.basename(source.archivePath, path.extname(source.archivePath))
    : path.basename(path.dirname(source.path));

  return fallbackVariants.map(({ trackIndex, trackCount, inspection }) => ({
    folderPath: source.archiveEntry ? path.dirname(source.archivePath) : path.dirname(source.path),
    path: displayPath,
    filename: source.archiveEntry ? path.basename(source.archiveEntry) : path.basename(source.path),
    extension: path.extname(source.archiveEntry || source.path).toLowerCase(),
    backendId: backendIdForSource(source),
    archivePath: source.archivePath,
    archiveEntry: source.archiveEntry,
    archiveSignature: source.archiveSignature || null,
    sourceSignature: source.sourceSignature || null,
    trackIndex,
    trackCount,
    fileSize: stat.size,
    modifiedAt: stat.mtimeMs / 1000,
    scanCompleted: !failureOutcome,
    scanVersion,
    specialAudioKind: inspection?.specialAudioKind || null,
    metadata: inspection ? {
      title: inspection.metadata.song,
      game: inspection.metadata.game === "spcboy-archive-cache" ? fallbackGame : inspection.metadata.game,
      artist: inspection.metadata.author,
      system: inspection.metadata.system,
      playLengthMs: Math.round(inspection.basePlaybackSeconds * 1000)
    } : null
  }));
}

async function scanLibraryRoot({
  rootPath,
  job,
  database,
  inspectTrackVariants,
  probePlayback = null,
  onProgress = () => {},
  deepScan = false,
  scanVersion = DEFAULT_SCAN_VERSION,
  scanConcurrency = DEFAULT_SCAN_CONCURRENCY,
  scratchBudgetBytes = DEFAULT_SCAN_SCRATCH_BUDGET_BYTES,
  scratchRecovery = {},
  scratchSummary = scanScratchSummary,
  scratchAvailableBytes = availableScratchBytes
}) {
  if (!database) throw new Error("Library database is not initialized");
  if (typeof inspectTrackVariants !== "function") throw new Error("Library scan requires a metadata inspector");
  if (probePlayback !== null && typeof probePlayback !== "function") throw new Error("Library scan playback probe must be a function");

  const resolvedRoot = path.resolve(rootPath);
  const root = await database.ensureRoot(resolvedRoot);
  await database.markScanStarted(root.id);
  const scratchBudget = await createScanScratchBudget({
    budgetBytes: scratchBudgetBytes,
    recovery: scratchRecovery,
    getSummary: scratchSummary,
    getAvailableBytes: scratchAvailableBytes
  });
  const reportProgress = (progress) => onProgress({ ...progress, scratch: scratchBudget.snapshot() });
  try {
    await database.beginAtomicScan(root.id);
    reportProgress({ operation: "prepare", completed: 0, total: 0, path: resolvedRoot });
    const scanWarnings = [];
    const scanOutcomes = [];
    const indexedTracks = indexIndexedTracks(await database.indexedTrackRecords(root.id));
    // A rescan already knows how many physical sources its previous successful
    // index contained. It is not an exact total (the filesystem can change),
    // but it gives discovery an honest, useful expectation without making a
    // second full directory walk just to count entries.
    const estimatedDiscoverySources = new Set(
      [...indexedTracks.values()].flatMap((rows) => rows.map((row) => row.archivePath || row.path))
    ).size;
    const archiveRowsByPath = new Map();
    for (const rows of indexedTracks.values()) {
      for (const row of rows) {
        if (!row.archivePath) continue;
        const archiveRows = archiveRowsByPath.get(row.archivePath) || [];
        archiveRows.push(row);
        archiveRowsByPath.set(row.archivePath, archiveRows);
      }
    }

    const reusableArchiveRecords = [];
    const physicalSources = await discoverPhysicalSources(resolvedRoot, {
      job,
      onProgress: ({ folderPath, visitedFolders, discoveredFiles }) => {
        reportProgress({
          operation: "discover",
          completed: discoveredFiles,
          total: 0,
          path: folderPath,
          visitedFolders,
          estimatedTotal: estimatedDiscoverySources
        });
      },
      onIssue: ({ folderPath, error }) => {
        const outcome = createScanOutcome({
          identity: { rootPath: resolvedRoot, sourcePath: folderPath },
          stage: "discovery",
          state: "failed",
          message: `could not read directory (${error.message})`
        });
        scanOutcomes.push(outcome);
        scanWarnings.push(formatScanOutcome(outcome));
      }
    });
    const discoveredSourcePaths = physicalSources.map((source) => source.archivePath || source.path);
    await database.markUndiscoveredSourcesDead(
      root.id,
      discoveredSourcePaths
    );

    const physicalSourcesNeedingExpansion = [];
    for (const source of physicalSources) {
      if (!source.archivePath) {
        physicalSourcesNeedingExpansion.push(source);
        continue;
      }
      let reusable = null;
      try {
        const stat = await fs.stat(source.archivePath);
        source.sourceSignature = await fastArchiveSignature(source.archivePath);
        reusable = (deepScan || root.needs_rescan) ? null : reusableRecordsForArchive(
          archiveRowsByPath.get(source.archivePath),
          source.archivePath,
          stat,
          source.sourceSignature,
          scanVersion,
          (archiveEntry) => routeForArchiveEntry(archiveEntry)?.backendId || null
        );
      } catch {
        reusable = null;
      }
      if (reusable) {
        reusableArchiveRecords.push(...reusable);
      } else {
        physicalSourcesNeedingExpansion.push(source);
      }
    }

    const trackPaths = await expandArchiveSources(physicalSourcesNeedingExpansion, {
      rootPath: resolvedRoot,
      job,
      deepScan,
      concurrency: ARCHIVE_LIST_CONCURRENCY,
      archiveOptions: {
        scratchOwner: "scan",
        reserveScratchBytes: scratchBudget.reserveBytes,
        ensureCapacity: scratchBudget.ensureArchiveCapacity,
        onScratchReleased: scratchBudget.refresh
      },
      onOutcome: (outcome) => {
        scanOutcomes.push(outcome);
        if (outcome.state === "failed" || outcome.state === "cancelled" || outcome.state === "incomplete") scanWarnings.push(formatScanOutcome(outcome));
      }
    });
    const reusedArchiveSourceCount = new Set(reusableArchiveRecords.map((record) => `${record.archivePath || record.path}\u0000${record.archiveEntry || ""}`)).size;
    const totalScanSources = trackPaths.length + reusedArchiveSourceCount;
    reportProgress({
      operation: "scan",
      rootPath: resolvedRoot,
      completed: reusedArchiveSourceCount,
      total: totalScanSources,
      path: resolvedRoot
    });

    const scanErrors = [];
    const recordsBySource = new Array(trackPaths.length);
    const sourceStats = new Map();
    const sharedScanMaterializations = new Map();
    const archivePendingSources = new Map();
    const archiveEntriesByPath = new Map();
    for (const source of trackPaths) {
      if (source.archivePath && source.archiveEntry) {
        archivePendingSources.set(source.archivePath, (archivePendingSources.get(source.archivePath) || 0) + 1);
        const entries = archiveEntriesByPath.get(source.archivePath) || [];
        entries.push(source.archiveEntry);
        archiveEntriesByPath.set(source.archivePath, entries);
      }
    }
    let lastProgressAt = 0;
    let completedCount = reusedArchiveSourceCount;
    let nextIndex = 0;
    async function statForSource(source) {
      const sourcePath = source.archivePath || source.path;
      if (!sourceStats.has(sourcePath)) sourceStats.set(sourcePath, fs.stat(sourcePath));
      return sourceStats.get(sourcePath);
    }
    async function materializationForSource(source) {
      if (!source.archiveEntry) return materializeArchiveEntryForScan(source.path, source.path);
      const archivePath = source.archivePath;
      let sessionPromise = sharedScanMaterializations.get(archivePath);
      if (!sessionPromise) {
        await scratchBudget.ensureArchiveCapacity(archivePath);
        const entryPaths = archiveEntriesByPath.get(archivePath) || [];
        sessionPromise = materializeArchiveEntriesForScan(archivePath, entryPaths, {
          reserveBytes: scratchBudget.reserveBytes,
          signal: job?.signal || null
        });
        sharedScanMaterializations.set(archivePath, sessionPromise);
      }
      const session = await sessionPromise;
      return { path: session.paths.get(source.archiveEntry), session };
    }
    async function releaseArchiveMaterialization(source) {
      const archivePath = source.archivePath;
      if (!archivePath || !source.archiveEntry) return;
      const remaining = (archivePendingSources.get(archivePath) || 1) - 1;
      if (remaining > 0) {
        archivePendingSources.set(archivePath, remaining);
        return;
      }
      archivePendingSources.delete(archivePath);
      const sessionPromise = sharedScanMaterializations.get(archivePath);
      sharedScanMaterializations.delete(archivePath);
      const session = await sessionPromise?.catch(() => null);
      await session?.cleanup();
      await scratchBudget.refresh();
    }
    function publishScanProgress(source, index) {
      completedCount += 1;
      const now = Date.now();
      if (now - lastProgressAt >= 100 || index + 1 === trackPaths.length) {
        lastProgressAt = now;
        reportProgress({
          operation: "scan",
          rootPath: resolvedRoot,
          completed: completedCount,
          total: totalScanSources,
          path: source.archiveEntry ? `${source.archivePath}#${source.archiveEntry}` : source.path
        });
      }
    }
    async function scanWorker() {
      while (nextIndex < trackPaths.length) {
        throwIfCancelled(job);
        const index = nextIndex;
        nextIndex += 1;
        const source = trackPaths[index];
        let stat;
        try {
          stat = await statForSource(source);
          if (!source.sourceSignature) source.sourceSignature = await fastSourceSignature(source.path, stat);
        } catch (error) {
          const outcome = createScanOutcome({
            identity: sourceIdentity(resolvedRoot, source),
            route: routeForSource(source),
            stage: "discovery",
            state: "failed",
            message: `could not read file attributes (${error.message})`
          });
          scanOutcomes.push(outcome);
          scanErrors.push(formatScanOutcome(outcome));
          recordsBySource[index] = [fallbackRecord(source, scanVersion)];
          publishScanProgress(source, index);
          continue;
        }
        const reusableRecords = deepScan ? null : reusableRecordsForSource(
          source,
          stat,
          indexedTracks.get(sourceKey(source)),
          scanVersion,
          backendIdForSource(source)
        );
        if (reusableRecords) {
          recordsBySource[index] = reusableRecords;
          await releaseArchiveMaterialization(source);
          publishScanProgress(source, index);
          continue;
        }

        let playablePath = source.path;
        let scanMaterialization = null;
        let variants = [];
        let failureOutcome = null;
        try {
          if (source.archiveEntry) {
            scanMaterialization = await materializationForSource(source);
            playablePath = scanMaterialization.path;
          }
        } catch (error) {
          failureOutcome = createScanOutcome({
            identity: sourceIdentity(resolvedRoot, source),
            route: routeForSource(source),
            stage: "materialization",
            state: error.scanState === "unsupported" ? "unsupported" : isCancellation(error) ? "cancelled" : "failed",
            message: error.message
          });
        }
        if (!failureOutcome) {
          try {
            variants = await inspectTrackVariants(playablePath, source.archiveEntry || source.path, { signal: job?.signal || null });
            throwIfCancelled(job);
          } catch (error) {
            failureOutcome = createScanOutcome({
              identity: sourceIdentity(resolvedRoot, source),
              route: routeForSource(source),
              stage: "metadata",
              state: error.scanState === "unsupported" ? "unsupported" : isCancellation(error) ? "cancelled" : "failed",
              message: error.message
            });
          }
        }
        if (!failureOutcome && variants.length > 0 && probePlayback) {
          const startedAt = Date.now();
          try {
            for (const variant of variants) {
              await probePlayback({
                path: playablePath,
                sourceName: source.archiveEntry || source.path,
                route: routeForSource(source),
                trackIndex: variant.trackIndex,
                specialAudioKind: variant.inspection?.specialAudioKind || null
              });
              throwIfCancelled(job);
            }
            scanOutcomes.push(createScanOutcome({
              identity: sourceIdentity(resolvedRoot, source),
              route: routeForSource(source),
              stage: "playback",
              state: "successful",
              durationMs: Date.now() - startedAt
            }));
          } catch (error) {
            const outcome = createScanOutcome({
              identity: sourceIdentity(resolvedRoot, source),
              route: routeForSource(source),
              stage: "playback",
              state: isCancellation(error) ? "cancelled" : "failed",
              durationMs: Date.now() - startedAt,
              message: error.message
            });
            scanOutcomes.push(outcome);
            scanErrors.push(formatScanOutcome(outcome));
          }
        }
        if (scanMaterialization && !scanMaterialization.session) {
          await scanMaterialization.cleanup();
          await scratchBudget.refresh();
        }
        if (failureOutcome) {
          scanOutcomes.push(failureOutcome);
          if (failureOutcome.state !== "unsupported") scanErrors.push(formatScanOutcome(failureOutcome));
        } else if (variants.length === 0) {
          failureOutcome = createScanOutcome({
            identity: sourceIdentity(resolvedRoot, source),
            route: routeForSource(source),
            stage: "metadata",
            state: "failed",
            message: "decoder returned no playable tracks"
          });
          scanOutcomes.push(failureOutcome);
          scanErrors.push(formatScanOutcome(failureOutcome));
        } else {
          scanOutcomes.push(createScanOutcome({
            identity: sourceIdentity(resolvedRoot, source),
            route: routeForSource(source),
            stage: "metadata",
            state: "successful"
          }));
        }
        // Archive members are grouped only while that archive is being
        // inspected. Retaining every shared extraction until the full root
        // finishes turned the safety budget into a cumulative 8 GB cap and
        // made later JoshW entries fail even though earlier roots were idle.
        await releaseArchiveMaterialization(source);
        recordsBySource[index] = recordsForVariants(source, stat, variants, failureOutcome, scanVersion);
        publishScanProgress(source, index);
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(scanConcurrency, trackPaths.length) }, () => scanWorker()));
    } finally {
      await Promise.all([...sharedScanMaterializations.values()].map(async (sessionPromise) => {
        const session = await sessionPromise.catch(() => null);
        await session?.cleanup();
      }));
      await scratchBudget.refresh();
    }
    throwIfCancelled(job);
    const allRecords = [...reusableArchiveRecords, ...recordsBySource.flat()];
    // A generation is self-contained: unchanged reusable records are copied
    // into the staged generation so publication is one root-pointer switch.
    const records = allRecords;
    const scanLog = [...scanWarnings, ...scanErrors];
    const needsRescan = scanOutcomes.some((outcome) => {
      const archiveMember = Boolean(outcome.identity?.archiveEntry);
      const archiveOperation = outcome.stage === "archiveListing";
      return (archiveMember || archiveOperation) && ["failed", "unsupported", "incomplete"].includes(outcome.state);
    });
    const errorCount = scanLog.length;
    const scanSummary = summarizeScanOutcomes(scanOutcomes);
    await database.replaceTracks(root.id, records, {
      fileCount: trackPaths.length + reusableArchiveRecords.length,
      successCount: Math.max(0, trackPaths.length + reusableArchiveRecords.length - scanErrors.length),
      errorCount,
      errors: scanLog,
      outcomes: scanOutcomes,
      outcomeSummary: scanSummary,
      needsRescan,
      replaceSources: null
    });
    await database.commitAtomicScan(root.id);
    const rootRows = await database.loadRoots();
    const currentRoot = rootRows.find((entry) => Number(entry.id) === Number(root.id));
    return { root: rootRows, trackCount: Number(currentRoot?.last_scan_track_count) || 0, warningCount: errorCount, scanSummary, scratch: scratchBudget.snapshot() };
  } catch (error) {
    await database.rollbackAtomicScan(root.id);
    if (!isCancellation(error)) await database.markScanFailed(root.id, error.message);
    throw error;
  }
}

module.exports = { DEFAULT_SCAN_VERSION, DEFAULT_SCAN_CONCURRENCY, DEFAULT_SCAN_SCRATCH_BUDGET_BYTES, createScanScratchBudget, scanLibraryRoot };
