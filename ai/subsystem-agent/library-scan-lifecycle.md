# Library Scan Lifecycle

## Scope

- Scanner discovery, inspection, reuse, cancellation, diagnostics, and archive materialization.
- Durable archive playback cache and disposable scan/playback scratch roots.

## Ownership

- `library-scan-service.js` owns one cancellable library job, progress, generation publication, and scratch-budget enforcement. The main process gives each job an `AbortSignal` so cancellation reaches active archive and decoder subprocesses.
- `scanner-discovery.js`, `scanner-archive.js`, `scanner-scheduler.js`, and `track-inspector.js` own discovery, archive expansion, bounded inspection scheduling, and metadata routing.
- `archive-resolver.js` owns physical archive materialization roots and recovery; `archive-cache-gate.js` serializes cache mutation.

## Invariants

- A root scan commits atomically. Cancellation or failure cannot replace its last committed records.
- Ordinary scans reuse only complete records whose source fingerprint, archive signature, scan version, and configured decoder route still match. Scan version 3 fingerprints loose files and archives with metadata plus SHA-256 content: files up to 1 MiB are hashed completely, while larger files sample the first, middle, and final 64 KiB. Deep Scan bypasses reuse.
- Discovery, archive listing, and metadata inspection remain distinct phases. Inspection starts after a stable playable-source total exists; progress never drives filesystem or decoder work.
- Scanner admission uses the shared backend registry. Every indexed row retains its decoder route, and a changed routing preference forces reinspection.
- `Test Files` checks source existence only. It marks only `ENOENT`/`ENOTDIR` sources dead and hides them from views without listing archives, materializing entries, or reading metadata. Permission or other access failures stop with the exact source path and error code.
- The production scanner harness uses the production pipeline through an in-memory database and never modifies the app library database.

## Lifecycle

- A scan discovers non-hidden sources, expands archive members, performs bounded backend-aware inspection, and records a self-contained root generation.
- The atomic scan records its discovered physical-source set once through `markUndiscoveredSourcesDead`; that staged operation also restores rediscovered sources at publication. Do not precede it with a duplicate `restoreSources` pass.
- Track, metadata, FTS, outcome, and discovered-source batches commit throughout the scan without replacing the active generation. Publish updates dead-source state, game buckets, root statistics, and the active-generation pointer in one short savepoint. Failure deletes only the staged generation; startup also removes obsolete abandoned generations.
- Database scan metrics separate staging, publication, obsolete-generation cleanup, database/WAL/shared-memory size, and WAL growth. The database logs the completed measurement and retains the latest value in process memory. No automatic checkpoint is currently applied; require representative large-library measurements before adding one or moving cleanup off the scan-completion path.
- Scan progress is throttled and terminal operation state clears the job before late telemetry can revive Cancel. Discovery is visible as indeterminate progress until a stable source total exists; Cancel is rendered only for a live job.
- Graceful quit aborts the active job and waits for its subprocesses and scratch cleanup. Scanner deadlines abort the underlying decoder or archive process before releasing that backend's concurrency slot; a timeout must not merely abandon its Promise.
- SPCBoy owns one user-data directory from one Electron process. The single-instance lock is acquired before database or cache initialization; this is the cross-process ownership boundary for scan scratch, durable-cache mutation, and staged database generations.
- Startup recovery removes abandoned inactive scanner roots before a new scan begins. Every active scratch root contains a `.spcboy-owner.json` marker; recovery preserves a root whose recorded process is still alive and removes roots with missing or dead owners.
- Scan scratch roots use the exact `spcboy-scan-scratch-*` prefix. They are disposable, never a playback cache, and are removed after normal completion, cancellation, or materialization failure. A shared archive extraction is released as soon as its final member has been inspected; a root scan must never retain prior archives until the whole library completes.
- The scan service enforces its 8 GiB scratch budget and 2 GiB free-space reserve before and during archive extraction. TAR.ZST listing decompresses into an owned, accounted scratch root rather than the unbounded general temporary directory. Streamed materialization periodically remeasures filesystem space, refuses output beyond either boundary, and cleans its active root on failure.
- Durable playback cache entries live under `SPCBoy/ArchiveCache`, use a user-selected 512 MiB–4 GiB LRU cap, and protect the active playback lease. Cache writes use process-and-UUID partial names with `finally` cleanup. Startup removes abandoned `.tmp-*` files and dependency directories that lack their `.complete` marker, then includes the recovered count and bytes in maintenance telemetry. Cache-off playback uses disposable `spcboy-playback-scratch-*` roots with their own bounded budget and launch recovery.

## Failure Boundaries

- Archive listing or one-source inspection failure is a typed warning/outcome; it must not discard successful records from the same root.
- Headerless `.ss2` data is an unsupported outcome, not a metadata failure. Vgmstream TXT P dependency materialization retains required `.DA` and `.TXTH` siblings.
- Archive member output is streamed to owned scratch files; no extracted member may accumulate in a Node command buffer. ZIP, 7z, and TAR directory listings are parsed line by line without trimming significant filename whitespace. Every listing is bounded to 64 MiB of output, 250,000 accepted entries, and 32 KiB per entry name. RSN listing remains JSON-shaped but is streamed into the same bounded collector before parsing.
- A required decoder inspection failure is a metadata-stage failure and leaves the source incomplete for retry. Fast SPC, VGM, PSF-tag, and special-payload metadata routes remain intentional shortcuts and do not imply a full PCM compatibility probe during every ordinary scan.
- Retained missing-source writes are batched so a disconnected or inaccessible corpus cannot create one unbounded SQLite command.

## Files

- [library-scan-service.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan-service.js)
- [library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [library-scan.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan.js)
- [scanner-discovery.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-discovery.js)
- [scanner-archive.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-archive.js)
- [scanner-scheduler.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-scheduler.js)
- [track-inspector.js](/Users/john/Downloads/Code/SPCBoy/electron/track-inspector.js)
- [archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [archive-cache-gate.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-cache-gate.js)
- [production-scanner-harness.js](/Users/john/Downloads/Code/SPCBoy/test-support/production-scanner-harness.js)
