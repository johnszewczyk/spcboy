const test = require("node:test");
const assert = require("node:assert/strict");
const { BoundedMetadataCache, metadataFingerprint } = require("../electron/metadata-cache");

test("metadata cache keeps recent entries and evicts the least recently used entry", () => {
  const cache = new BoundedMetadataCache(2);
  cache.set("a", "one", { title: "A" });
  cache.set("b", "two", { title: "B" });
  assert.deepEqual(cache.get("a", "one"), { title: "A" });

  cache.set("c", "three", { title: "C" });
  assert.equal(cache.get("b", "two"), undefined);
  assert.deepEqual(cache.get("a", "one"), { title: "A" });
  assert.deepEqual(cache.get("c", "three"), { title: "C" });
  assert.equal(cache.size, 2);
});

test("metadata cache invalidates a path when its file fingerprint changes", () => {
  const cache = new BoundedMetadataCache(2);
  cache.set("/music/track.spc", "old", { title: "Old title" });

  assert.equal(cache.get("/music/track.spc", "new"), undefined);
  assert.equal(cache.size, 0);
  cache.set("/music/track.spc", "new", { title: "New title" });
  assert.deepEqual(cache.get("/music/track.spc", "new"), { title: "New title" });
});

test("metadata cache fingerprints use the source identity and change markers", () => {
  const base = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5 };
  assert.equal(metadataFingerprint(base), "1\u00002\u00003\u00004\u00005");
  assert.notEqual(metadataFingerprint({ ...base, ctimeMs: 6 }), metadataFingerprint(base));
  assert.equal(metadataFingerprint({ ...base, ino: undefined }), null);
});
