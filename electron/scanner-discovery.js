const fs = require("fs").promises;
const path = require("path");
const { supportsPath } = require("./playback-core");
const { isSupportedArchivePath } = require("./archive-resolver");

async function discoverPhysicalSources(rootPath, {
  recursive = true,
  job = null,
  onIssue = () => {},
  onProgress = () => {},
  onBatch = async () => {},
  concurrency = 8
} = {}) {
  const sources = [];
  const queue = [path.resolve(rootPath)];
  let queueHead = 0;
  const waiters = [];
  let active = 0;
  let visitedFolders = 0;
  let discoveredFiles = 0;
  let lastProgressAt = 0;

  const publishProgress = (folderPath, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 100 && discoveredFiles > 0) return;
    lastProgressAt = now;
    onProgress({ folderPath, visitedFolders, discoveredFiles });
  };

  const wake = () => waiters.shift()?.();
  const enqueue = (folderPath) => {
    queue.push(folderPath);
    wake();
  };

  async function nextFolder() {
    while (true) {
      if (job?.cancelled) throw new Error("Library operation cancelled");
      const folderPath = queueHead < queue.length ? queue[queueHead++] : null;
      if (folderPath) {
        active += 1;
        return folderPath;
      }
      if (active === 0) return null;
      await new Promise((resolve) => waiters.push(resolve));
    }
  }

  async function worker() {
    while (true) {
      const folderPath = await nextFolder();
      if (!folderPath) return;
      try {
        let entries;
        try {
          entries = await fs.readdir(folderPath, { withFileTypes: true });
        } catch (error) {
          onIssue({ folderPath, error });
          continue;
        }
        visitedFolders += 1;
        publishProgress(folderPath);
        const foundSources = [];
        for (const entry of entries) {
          if (job?.cancelled) throw new Error("Library operation cancelled");
          if (entry.name.startsWith(".")) continue;
          const entryPath = path.join(folderPath, entry.name);
          if (entry.isDirectory() && recursive) {
            enqueue(entryPath);
          } else if (entry.isFile() && supportsPath(entry.name)) {
            const source = { path: entryPath, archivePath: null, archiveEntry: null };
            sources.push(source);
            foundSources.push(source);
            discoveredFiles += 1;
          } else if (entry.isFile() && isSupportedArchivePath(entryPath)) {
            const source = { path: entryPath, archivePath: entryPath, archiveEntry: null };
            sources.push(source);
            foundSources.push(source);
            discoveredFiles += 1;
          }
        }
        if (foundSources.length) await onBatch(foundSources);
        publishProgress(folderPath, true);
      } finally {
        active -= 1;
        if (active === 0 && queueHead >= queue.length) {
          while (waiters.length) waiters.shift()();
        } else {
          wake();
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(32, concurrency)) }, worker));
  sources.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }));
  return sources;
}

module.exports = { discoverPhysicalSources };
