class ArchiveCacheGate {
  constructor() {
    this.activeMaterializations = 0;
    this.clearing = false;
  }

  get isBusy() {
    return this.clearing || this.activeMaterializations > 0;
  }

  async materialize(operation) {
    if (this.clearing) throw new Error("Archive cache is being cleared; retry playback after it finishes.");
    this.activeMaterializations += 1;
    try {
      return await operation();
    } finally {
      this.activeMaterializations -= 1;
    }
  }

  async clear(operation) {
    if (this.clearing) throw new Error("Archive cache clearing is already in progress.");
    if (this.activeMaterializations > 0) throw new Error("Archive cache is in use; wait for materialization to finish.");
    this.clearing = true;
    try {
      return await operation();
    } finally {
      this.clearing = false;
    }
  }
}

module.exports = { ArchiveCacheGate };
