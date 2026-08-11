# CocoaSpice scanner parity plan for SPCBoy

Status: investigation complete; Phases 0 and 1 started  
Scope: SPCBoy only. CocoaSpice is reference material and is not modified.

## Executive finding

CocoaSpice is not just a recursive directory walk with a decoder call. Its scanner is a staged pipeline:

```text
discover -> identify/fingerprint -> list archive -> route -> materialize dependency set
         -> fast metadata handler or bounded decoder inspection -> persist outcome
```

Each stage has an explicit outcome and failure stage. Archive tools and decoder cores have separate async budgets, and incremental scans compare stable identities and archive signatures before doing expensive work.

SPCBoy currently performs discovery, archive listing, materialization, inspection, and record construction inside `scanLibraryRoot()`. It has useful format and archive tables, metadata fast paths, and record reuse, but it lacks CocoaSpice's typed pipeline boundaries. The result is unnecessary archive/decoder pressure, ambiguous failures, and difficulty proving whether a file was discovered, routed, materialized, inspected, or merely indexed.

## What CocoaSpice provides

### 1. Typed scan model

The CocoaSpice scanner models candidates with:

- a stable item identity: root, physical path, and optional archive member;
- a file fingerprint plus archive content signature;
- a central route containing plugin/backend and format capabilities;
- explicit states: discovered, queued, scanning, successful, failed, unsupported, cancelled;
- failures retaining identity, route, stage, and message;
- separate archive-completed results from playable-file results.

This lets the UI and database answer different questions without inferring them from a generic error string.

### 2. Central routing and admission

`ScanPluginRegistry` is the scanner-facing format registry. It decides whether an extension is admitted, which backend owns it, whether archive members are allowed, and whether it can produce multiple tracks. The same registry is used by discovery and archive listing.

### 3. Archive provider abstraction

`ScanArchiveProvider` owns listing, selected-member extraction, complete-set extraction, scan scratch directories, and cleanup. The executor does not know whether the provider uses ZIP, 7z, RSN, or TAR.ZST tooling.

Dependency-bearing formats are materialized according to policy:

- selected entry only;
- complete dependency set;
- complete set plus lazy aliases for formats such as USF;
- TXTP companion preparation where required.

This is the pattern that avoids the JoshW/N64 failure mode where a playable `.miniusf` is extracted without its `.usflib`.

### 4. Fast metadata handlers

CocoaSpice parses metadata without initializing a decoder when the container provides reliable metadata:

- SPC ID666/xID6;
- VGM/VGZ header and GD3;
- PSF-family footer tags, including USF and 2SF.

Each handler falls back to the appropriate decoder for unusual or untagged files. Corruption detectors can reject known invalid payloads before invoking a backend.

### 5. Resource scheduling and timeouts

The executor has bounded archive workers, while each decoder backend has its own async inspection scheduler. Archive listing, extraction, and metadata inspection have separate operation timeouts. Synchronous helper work is detached from the scheduler actor so one blocking process does not serialize all workers.

### 6. Incremental persistence

Successful rows are reused only when their fingerprint, archive signature, scan version, track count, and track ordering still match. Unsupported, failed, cancelled, and archive-completed outcomes remain distinguishable. Persistence is batched so a large archive does not create one giant transaction or result array.

## SPCBoy parity matrix

| Capability | SPCBoy today | Gap / risk | Priority |
|---|---|---|---|
| Single format registry for playback and scan admission | `BACKEND_MODULES` is shared for ordinary extensions | Archive dependency policy is separate from the playback registry; route/backend metadata is not retained in scan records | P0 |
| Recursive discovery | `collectSupportedTracks()` recursively walks and lists each archive during discovery | Discovery immediately performs expensive archive work and creates one candidate per archive member before planning | P0 |
| Raw browser path | Lazy sidebar browser now lists directories/files without metadata scanning | Keep this path permanently separate from library discovery | P0 |
| Archive listing | ZIP/7z/RSN/TAR.ZST supported through `archive-resolver.js` | No typed listing result or archive-listing timeout; warnings are strings | P0 |
| Dependency-set extraction | USF/GSF/2SF/PSF/vgmstream groups are recognized; recent USF precedence fix works | Policy is embedded in resolver; no route-aware provider; repeated members can repeatedly enumerate/extract | P0 |
| Fast metadata | SPC and VGM shortcuts exist; other formats call helpers | No PSF/USF/2SF footer shortcut; failure is often represented as null metadata | P1 |
| Backend concurrency | One global `LIBRARY_SCAN_CONCURRENCY = 8` | Decoder/helper pressure is not budgeted per backend; helper overload can reach 100% CPU | P0 |
| Timeouts/cancellation | Job cancellation exists | No operation-specific archive/inspection timeout boundary; subprocess cancellation is incomplete | P0 |
| Failure accounting | Scan warnings/errors are strings; fallback rows are still written | Cannot reliably distinguish unsupported, archive-listing, extraction, routing, metadata, and persistence failures | P0 |
| Incremental reuse | File stat, archive signature, scan version, track shape checks exist | No typed candidate/inventory state; archive parent and member planning are coupled | P1 |
| Persistence | `replaceTracks()` persists final records and counts | No bounded result batches or durable per-stage failure data | P1 |
| Format correctness | Registry covers current SPCBoy backends | Admission is extension-based; archive members and compound names need central route tests | P1 |
| Diagnostics | Copyable scan log and explicit 20/40/20 panels are now in place | Log needs structured fields before it can explain backend or stage bottlenecks | P1 |

## Implementation plan

### Phase 0 — instrument before restructuring

Add a scanner event/outcome shape without changing playback:

```js
{
  identity: { rootPath, sourcePath, archiveEntry: null },
  route: { backendId, extension, archivePolicy },
  stage: "discovery|archiveListing|materialization|routing|metadata|persistence",
  state: "successful|unsupported|failed|cancelled|archiveCompleted",
  durationMs,
  message
}
```

Keep the existing visible log, but generate it from these events. Record counts by stage, backend, archive type, and outcome. Do not hide inspection exceptions behind “could not inspect the file.”

Acceptance: one failed JoshW/N64 member identifies the archive, member, dependency family, extraction stage, and original helper error.

### Phase 1 — centralize admission and routing

Extend `playback-core.js` into the scanner’s single source of truth. Each backend descriptor should declare:

- playable extensions;
- archive-member support;
- multi-track behavior;
- dependency family/materialization policy;
- metadata shortcut, if any;
- scan concurrency and timeout.

Expose `routeForPath()` and `routeForArchiveEntry()` to the filesystem scanner, raw browser, drag/drop, playlist import, archive listing, and playback. Keep library-only acceptance separate from the raw browser’s cheap extension filter, but derive both from the same registry.

Acceptance: every accepted extension has tests for direct file, archive member, drag/drop, playlist import, and playback route—or an explicit reason it is not archive-safe.

### Phase 2 — split discovery from inspection

Replace `collectSupportedTracks()` with a discovery pass that returns physical source candidates and cheap fingerprints. Do not list every archive as part of the raw filesystem walk. Archive candidates should be queued for a bounded listing stage.

Use a single iterative enumerator or bounded directory walker with per-directory errors. Preserve deterministic ordering, skip hidden files, and keep the raw Folders view on the lazy browser path.

Acceptance: opening a folder performs no decoder/helper work and a library scan can report discovered sources before metadata inspection begins.

### Phase 3 — introduce a resolver-backed archive pipeline

Create a scanner archive provider around `archive-resolver.js`:

1. list and return a typed archive signature;
2. route supported members before extraction;
3. select materialization policy from all members in the archive;
4. materialize the complete dependency set when required;
5. inspect members against one shared scratch root;
6. discard scratch materialization deterministically.

Cache archive listings and dependency materializations by archive fingerprint/signature. Never let each member independently decompress a TAR.ZST or relist a solid archive.

Acceptance fixtures: JoshW/N64 miniUSF plus USFLIB, 2SF plus companion library, PSF/PSFLIB, GSF, vgmstream TXTP/companion files, ZIP, 7z, RSN, and TAR.ZST.

### Phase 4 — add metadata fast paths and safe fallbacks

Port the CocoaSpice handler order:

1. validate lightweight container signature;
2. parse cheap native metadata;
3. use a backend-specific inspector only when the shortcut cannot decide;
4. apply a bounded timeout;
5. return a typed failure instead of a null inspection.

Priority order for SPCBoy: PSF/PSF2/USF/2SF footer tags, then any remaining GME-family metadata shortcuts, then format-specific corruption checks. Preserve the existing SPC and VGM paths and add regression tests so fast paths never bypass track-count handling.

### Phase 5 — backend-aware scheduling and timeouts

Replace the global eight-worker pressure with independent limits:

- archive listing/extraction lane;
- libgme lane;
- libvgm lane;
- vgmstream lane;
- ffprobe/Core Audio lane;
- OpenMPT and other native helper lanes.

Use async queues or permits, detached subprocess/decoder work, cancellation propagation, and operation-specific timeouts. A slow archive should not consume every decoder permit, and eight simultaneous helper processes should not be the default.

Acceptance: a mixed large scan keeps the UI responsive, does not pin the helper at 100% indefinitely, and reports timeout stage/backend accurately.

### Phase 6 — staged persistence and incremental planning

Introduce scanner inventory rows separate from playable track rows. Persist each bounded batch with its candidate identity, fingerprint, route, state, and failure details. Reuse only complete successful outcomes whose source/archive signatures and scan version match.

Keep failed and unsupported rows available for diagnostics; do not turn a failed inspection into a successful-looking metadata-null track. Preserve missing/dead-link records until the explicit Test Links action removes or marks them.

### Phase 7 — parity and robustness test matrix

Tests should cover the full admission-to-playback path, not just extension recognition:

- direct files for every backend;
- each supported archive container;
- dependency families and complete-set materialization;
- multi-track GME/VGMstream entries;
- malformed signatures, missing dependencies, unsafe paths, empty archives, and helper failures;
- cancellation and timeout at listing, extraction, metadata, and persistence;
- incremental no-op scans, changed files, timestamp-only archive changes, and archive-content changes;
- browser folder opening with no library scan side effects;
- scanner count/log consistency and copyable failure reports.

Use real collection fixtures where possible, especially the JoshW/N64 archives and representative `audio/Zophar/PSX` material, then add small synthetic fixtures for deterministic failure cases.

## Implementation status

The first Phase 0/1 slice is now implemented:

- `playback-core.js` exposes scanner routes and backend scan policy from the same registry used for playback admission;
- `scanner-model.js` defines typed stages, states, identities, formatted diagnostics, and summary counters;
- library scan errors now retain backend and stage context in the existing copyable log;
- route and outcome unit tests are passing.

The first Phase 2/3 slice is also implemented:

- physical discovery no longer lists archive contents;
- archive members are expanded by a separate bounded stage;
- archive listing errors are retained as typed archive-listing outcomes;
- raw folder playlists use the same separation and still avoid metadata inspection.

The remaining Phase 3 and Phase 4/5 foundation is now implemented:

- archive members in one scan share a scratch materialization and dependency extraction is de-duplicated;
- archive listing and metadata inspection have explicit timeout boundaries;
- metadata inspection is limited independently per backend rather than only by the global worker count;
- PSF-family footer tags are parsed before helper inspection;
- scanner-level inspection catches no longer erase helper errors.

Phase 6 persistence has started:

- typed scan outcomes are persisted transactionally in `library_scan_outcomes`;
- outcome loading preserves source/member, backend, stage, state, duration, and message for later log/report UI;
- existing track replacement, compact counts, and copyable error log behavior remain intact.

The next slice is to make incremental planning explicitly source-oriented: inspect archive signatures once per physical archive, retain failed/unsupported inventory states, and avoid re-materializing unchanged members.

## Recommended next implementation target

Start with Phase 0 and Phase 1 together: add typed scan outcomes and make the playback registry authoritative for scanner routing. This is the smallest change that immediately improves diagnostics and creates the seam needed for archive caching, backend scheduling, PSF-family fast paths, and reliable incremental reuse. The current JoshW/N64 extraction fix should remain as a regression test while this boundary is introduced.

Do not begin by adding more global scan workers or more extension cases. That would increase helper pressure while leaving the discovery/materialization coupling intact.
