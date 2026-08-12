const { archivePlayableEntriesWithSignature } = require("./archive-resolver");
const { routeForArchiveEntry } = require("./playback-core");
const { createScanOutcome } = require("./scanner-model");
const { normalizeArchiveEntry } = require("./archive-path");
const { withScanTimeout } = require("./scanner-scheduler");

const ARCHIVE_LIST_TIMEOUT_MS = 30_000;
const ARCHIVE_LIST_CONCURRENCY = 2;

async function expandArchiveSources(sources, {
  rootPath = "",
  job = null,
  concurrency = ARCHIVE_LIST_CONCURRENCY,
  deepScan = false,
  onOutcome = () => {},
  onEntries = async () => {},
  archiveOptions = {}
} = {}) {
  const expanded = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < sources.length) {
      if (job?.cancelled) throw new Error("Library operation cancelled");
      const index = nextIndex;
      nextIndex += 1;
      const source = sources[index];
      if (!source.archivePath) {
        expanded.push(source);
        continue;
      }
      const startedAt = Date.now();
      try {
        const listing = await withScanTimeout(
          (signal) => archivePlayableEntriesWithSignature(
            source.archivePath,
            (extension) => Boolean(routeForArchiveEntry(`member${extension}`)),
            { ...archiveOptions, signal }
          ),
          ARCHIVE_LIST_TIMEOUT_MS,
          `listing ${source.archivePath}`,
          { signal: job?.signal || null }
        );
        if (!listing.entries.length) {
          onOutcome(createScanOutcome({
            identity: { rootPath, sourcePath: source.archivePath },
            stage: "archiveListing",
            state: "archiveCompleted",
            durationMs: Date.now() - startedAt,
            message: "No supported playable members"
          }));
        }
        await onEntries({
          source,
          entries: listing.entries.map((entry) => normalizeArchiveEntry(entry)),
          signature: listing.signature,
          deepScan
        });
        for (const archiveEntry of listing.entries) {
          expanded.push({
            path: source.archivePath,
            archivePath: source.archivePath,
            archiveEntry: normalizeArchiveEntry(archiveEntry),
            archiveSignature: listing.signature,
            sourceSignature: source.sourceSignature || null
          });
        }
      } catch (error) {
        const outcome = createScanOutcome({
          identity: { rootPath, sourcePath: source.archivePath },
          stage: "archiveListing",
          state: error.message === "Library operation cancelled" ? "cancelled" : "failed",
          durationMs: Date.now() - startedAt,
          message: error.message
        });
        onOutcome(outcome);
        if (error.message === "Library operation cancelled") throw error;
        // Keep the source out of the playable queue; its diagnostic outcome is
        // retained so a bad archive cannot abort unrelated files.
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, sources.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return expanded.sort((left, right) => {
    const leftKey = left.archiveEntry ? `${left.archivePath}#${left.archiveEntry}` : left.path;
    const rightKey = right.archiveEntry ? `${right.archivePath}#${right.archiveEntry}` : right.path;
    return leftKey.localeCompare(rightKey, undefined, { numeric: true, sensitivity: "base" });
  });
}

module.exports = {
  ARCHIVE_LIST_CONCURRENCY,
  ARCHIVE_LIST_TIMEOUT_MS,
  expandArchiveSources
};
