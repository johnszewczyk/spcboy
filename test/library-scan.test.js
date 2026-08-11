const test = require("node:test");
const assert = require("node:assert/strict");
const { indexIndexedTracks, reusableRecordsForArchive, reusableRecordsForSource, sourceKey } = require("../electron/library-scan");

function indexedRow(overrides = {}) {
  return {
    path: "/library/game/song.nsf",
    filename: "song.nsf",
    folderPath: "/library/game",
    extension: ".nsf",
    trackIndex: 0,
    trackCount: 1,
    fileSize: 100,
    modifiedAt: 1,
    scanVersion: 1,
    scanCompleted: true,
    metadataTrackId: 7,
    title: "Song",
    game: "Game",
    artist: "Artist",
    system: "NES",
    playLengthMs: 120000,
    archivePath: null,
    archiveEntry: null,
    archiveSignature: null,
    specialAudioKind: null,
    ...overrides
  };
}

test("groups indexed rows by loose-file or archive-member source", () => {
  const loose = { path: "/library/game/song.nsf" };
  const archive = { path: "/library/set.zip", archivePath: "/library/set.zip", archiveEntry: "song.nsf" };
  assert.notEqual(sourceKey(loose), sourceKey(archive));
  const indexed = indexIndexedTracks([indexedRow(), indexedRow({ path: "/library/set.zip#song.nsf", archivePath: "/library/set.zip", archiveEntry: "song.nsf" })]);
  assert.equal(indexed.get(sourceKey(loose)).length, 1);
  assert.equal(indexed.get(sourceKey(archive)).length, 1);
});

test("reuses a complete unchanged indexed source", () => {
  const source = { path: "/library/game/song.nsf" };
  const rows = [indexedRow()];
  const records = reusableRecordsForSource(source, { size: 100, mtimeMs: 1000 }, rows, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].metadata.title, "Song");
  assert.equal(records[0].scanVersion, 1);
});

test("reuses special payload routing metadata", () => {
  const records = reusableRecordsForSource(
    { path: "/library/game/track_01.wav" },
    { size: 100, mtimeMs: 1000 },
    [indexedRow({ specialAudioKind: "nds-raw-pcm22" })],
    1
  );
  assert.equal(records[0].specialAudioKind, "nds-raw-pcm22");
});

test("invalidates reuse for changed or incomplete indexed sources", () => {
  const source = { path: "/library/game/song.nsf" };
  const row = indexedRow();
  assert.equal(reusableRecordsForSource(source, { size: 101, mtimeMs: 1000 }, [row], 1), null);
  assert.equal(reusableRecordsForSource(source, { size: 100, mtimeMs: 2000 }, [row], 1), null);
  assert.equal(reusableRecordsForSource(source, { size: 100, mtimeMs: 1000 }, [row], 2), null);
  assert.equal(reusableRecordsForSource(source, { size: 100, mtimeMs: 1000 }, [indexedRow({ metadataTrackId: null })], 1), null);
  assert.equal(reusableRecordsForSource(source, { size: 100, mtimeMs: 1000 }, [indexedRow({ scanCompleted: false })], 1), null);
  assert.equal(reusableRecordsForSource({ ...source, archiveEntry: "song.nsf", archivePath: "/library/set.zip", archiveSignature: "new" }, { size: 100, mtimeMs: 1000 }, [indexedRow({ archivePath: "/library/set.zip", archiveEntry: "song.nsf", archiveSignature: "old" })], 1), null);
  assert.equal(reusableRecordsForSource(source, { size: 100, mtimeMs: 1000 }, [indexedRow({ backendId: "libgme" })], 1, "alternate"), null);
});

test("reuses a complete unchanged archive without expanding its members", () => {
  const archivePath = "/music/library.zip";
  const stat = { size: 512, mtimeMs: 4000 };
  const rows = [
    {
      path: `${archivePath}#one.nsf`, archivePath, archiveEntry: "one.nsf", archiveSignature: "sig", sourceSignature: null,
      scanVersion: 2, scanCompleted: true, metadataTrackId: 1, fileSize: 512, modifiedAt: 4, trackIndex: 0, trackCount: 1,
      folderPath: "/music", filename: "one.nsf", extension: ".nsf", specialAudioKind: null,
      title: "One", game: "Game", artist: "Artist", system: "NES", playLengthMs: 1000
    },
    {
      path: `${archivePath}#two.nsf`, archivePath, archiveEntry: "two.nsf", archiveSignature: "sig", sourceSignature: null,
      scanVersion: 2, scanCompleted: true, metadataTrackId: 2, fileSize: 512, modifiedAt: 4, trackIndex: 0, trackCount: 1,
      folderPath: "/music", filename: "two.nsf", extension: ".nsf", specialAudioKind: null,
      title: "Two", game: "Game", artist: "Artist", system: "NES", playLengthMs: 2000
    }
  ];
  const records = reusableRecordsForArchive(rows, archivePath, stat, null, 2);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.archiveEntry), ["one.nsf", "two.nsf"]);
  assert.equal(reusableRecordsForArchive(rows, archivePath, { size: 513, mtimeMs: 4000 }, null, 2), null);
});
