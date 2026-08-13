const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPlaylistReader } = require("../electron/library-playlist");
const { playlistTrackIdentity } = require("../electron/playlist-track-identity");

const contract = JSON.parse(fs.readFileSync(
  path.join(__dirname, "cross-app-playlist-activation-v1.json"),
  "utf8"
));

function variants(titles) {
  return titles.map((title, trackIndex) => ({
    trackIndex,
    trackCount: titles.length,
    inspection: { metadata: { song: title, game: "Game", system: "System" } }
  }));
}

test("matches the CocoaSpice/SPCBoy playlist activation contract", async () => {
  assert.equal(contract.contract, "cocoaspice-spcboy-playlist-activation");
  assert.equal(contract.version, 1);
  assert.ok(contract.cases.length > 0);

  for (const fixture of contract.cases) {
    let titles = fixture.metadataBefore;
    const reader = createPlaylistReader({
      fs: {},
      path,
      supportsPath: () => true,
      routeForPath: () => ({ supportsMultiTrack: true }),
      isSupportedArchivePath: () => false,
      discoverPhysicalSources: async () => [],
      expandArchiveSources: async () => [],
      materializeArchiveEntries: async (_archivePath, entries) => ({
        paths: new Map([[entries[0], "/tmp/materialized-track"]]),
        cleanup: async () => {}
      }),
      inspectTrackVariants: async () => variants(titles),
      archiveListConcurrency: 1
    });
    const source = {
      path: fixture.sourcePath,
      archivePath: fixture.archiveEntry ? fixture.sourcePath : null,
      archiveEntry: fixture.archiveEntry
    };

    const initial = await reader.playlistFromSources([source], path.dirname(fixture.sourcePath));
    assert.deepEqual(initial.map((track) => track.id), fixture.expectedTrackIDs, fixture.id);
    assert.deepEqual(initial.map((track) => track.trackIndex), [...Array(fixture.trackCount).keys()], fixture.id);
    assert.deepEqual(initial.map((track) => track.title), fixture.metadataBefore, fixture.id);

    titles = fixture.metadataAfter;
    const enriched = await reader.playlistFromSources([source], path.dirname(fixture.sourcePath));
    assert.deepEqual(enriched.map((track) => track.id), fixture.expectedTrackIDs, `${fixture.id} metadata update changed identity`);
    assert.deepEqual(enriched.map((track) => track.title), fixture.metadataAfter, fixture.id);
    assert.deepEqual(
      enriched.map((track) => playlistTrackIdentity(fixture.sourcePath, fixture.archiveEntry, track.trackIndex)),
      fixture.expectedTrackIDs,
      fixture.id
    );
  }
});
