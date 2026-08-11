# Library Scan Lifecycle

## Scope

- Scanner discovery, inspection, reuse, cancellation, diagnostics, and archive materialization.
- Durable archive playback cache and disposable scan/playback scratch roots.

## Ownership

- `library-scan-service.js` owns one cancellable library job, progress, transaction handoff, and scratch-budget enforcement.
- `scanner-discovery.js`, `scanner-archive.js`, `scanner-scheduler.js`, and `track-inspector.js` own discovery, archive expansion, bounded inspection scheduling, and metadata routing.
- `archive-resolver.js` owns physical archive materialization roots and recovery; `archive-cache-gate.js` serializes cache mutation.

## Invariants

- A root scan commits atomically. Cancellation or failure cannot replace its last committed records.
- Ordinary scans reuse only complete records whose source fingerprint, archive signature, scan version, and configured decoder route still match. Deep Scan bypasses reuse.
- Discovery, archive listing, and metadata inspection remain distinct phases. Inspection starts after a stable playable-source total exists; progress never drives filesystem or decoder work.
- Scanner admission uses the shared backend registry. Every indexed row retains its decoder route, and a changed routing preference forces reinspection.
- `Test Files` checks source existence only. It marks only `ENOENT`/`ENOTDIR` sources dead and hides them from views without listing archives, materializing entries, or reading metadata. Permission or other access failures stop with the exact source path and error code.
- The production scanner harness uses the production pipeline through an in-memory database and never modifies the app library database.

## Lifecycle

- A scan discovers non-hidden sources, expands archive members, performs bounded backend-aware inspection, records typed outcomes, and commits one root transaction.
- The writer begins that transaction before any restore/dead-source change. Replacement batches use SQLite savepoints, and the service commits only after tracks, outcomes, FTS, game buckets, and root statistics are complete. Its failure path rolls back before recording the scan error.
- Scan progress is throttled and terminal operation state clears the job before late telemetry can revive Cancel. Discovery is visible as indeterminate progress until a stable source total exists; Cancel is rendered only for a live job.
- Graceful quit cancels the active job and waits for scratch cleanup. Startup recovery removes abandoned inactive scanner roots before a new scan begins.
- Scan scratch roots use the exact `spcboy-scan-scratch-*` prefix. They are disposable, never a playback cache, and are removed after normal completion, cancellation, or materialization failure. A shared archive extraction is released as soon as its final member has been inspected; a root scan must never retain prior archives until the whole library completes.
- The scan service enforces its 8 GiB scratch budget and 2 GiB free-space reserve before archive extraction. Streamed materialization refuses output beyond the remaining budget and cleans its active root on failure.
- Durable playback cache entries live under `SPCBoy/ArchiveCache`, use a user-selected 512 MiB–4 GiB LRU cap, and protect the active playback lease. Cache-off playback uses disposable `spcboy-playback-scratch-*` roots with their own bounded budget and launch recovery.

## Failure Boundaries

- Archive listing or one-source inspection failure is a typed warning/outcome; it must not discard successful records from the same root.
- Headerless `.ss2` data is an unsupported outcome, not a metadata failure. Vgmstream TXT P dependency materialization retains required `.DA` and `.TXTH` siblings.
- Archive stdout is streamed to owned scratch files; no archive member may accumulate in a Node command buffer.
- Retained missing-source writes are batched so a disconnected or inaccessible corpus cannot create one unbounded SQLite command.

## Files

- [library-scan-service.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan-service.js)
- [library-scan.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan.js)
- [scanner-discovery.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-discovery.js)
- [scanner-archive.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-archive.js)
- [scanner-scheduler.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-scheduler.js)
- [track-inspector.js](/Users/john/Downloads/Code/SPCBoy/electron/track-inspector.js)
- [archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [archive-cache-gate.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-cache-gate.js)
- [production-scanner-harness.js](/Users/john/Downloads/Code/SPCBoy/test-support/production-scanner-harness.js)
