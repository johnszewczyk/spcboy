class BoundedMetadataCache {
  constructor(maxEntries = 2048) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("metadata cache capacity must be a positive integer");
    }
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key, fingerprint) {
    if (!fingerprint) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.fingerprint !== fingerprint) {
      this.entries.delete(key);
      return undefined;
    }

    // Map insertion order is the LRU order. Move a hit to the newest slot.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, fingerprint, value) {
    if (!fingerprint) return;
    this.entries.delete(key);
    this.entries.set(key, { fingerprint, value });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}

function metadataFingerprint(stat) {
  if (!stat) return null;
  const fields = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
  if (fields.some((field) => field === undefined || field === null)) return null;
  return fields.join("\u0000");
}

module.exports = { BoundedMetadataCache, metadataFingerprint };
