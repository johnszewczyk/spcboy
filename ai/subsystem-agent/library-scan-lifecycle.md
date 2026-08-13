# Library Scan Lifecycle

## Scope

- Scanner discovery, inspection, reuse, cancellation, diagnostics, and archive materialization.
- Durable archive playback cache and disposable scan/playback scratch roots.

## Current Production Status

- SPCBoy does not run this JavaScript catalog scanner while the canonical MediaScanner catalog reader is active. Scan and database-mutation IPC reject the operation and the renderer disables those controls.
- The implementation below remains as migration reference and regression coverage until MediaScanner owns archive/decoder packaging, resumable writes, and all required scan commands. It must not be described as SPCBoy's active writer.

## Ownership

- `library-scan-service.js` owns one cancellable library job, progress, generation publication, and scratch-budget enforcement. The main process gives each job an `AbortSignal` so cancellation reaches active archive and decoder subprocesses.
- `scanner-discovery.js`, `scanner-archive.js`, `scanner-scheduler.js`, and `track-inspector.js` own discovery, archive expansion, bounded inspection scheduling, and metadata routing.
- `archive-resolver.js` owns physical archive materialization roots and recovery; `archive-cache-gate.js` serializes cache mutation.

## Invariants

- A root scan commits atomically. Cancellation or failure cannot replace its last committed records.
- Ordinary scans reuse only complete records whose source content signature, scan version, and configured decoder route still match. Scan version 4 separates content identity from mutable stat metadata: files up to 1 MiB are hashed completely, while larger files sample the first, middle, and final 64 KiB; archive signatures use the archive listing contract. A timestamp-only change refreshes the retained stat fields after content reuse. Deep Scan bypasses reuse.
- Discovery, archive listing, and metadata inspection remain distinct phases. Inspection starts after a stable playable-source total exists; progress never drives filesystem or decoder work.
- Scanner admission uses the shared backend registry. Every indexed row retains its decoder route, and a changed routing preference forces reinspection.
- `Test Files` checks source existence only. It marks only `ENOENT`/`ENOTDIR` sources dead and hides them from views without listing archives, materializing entries, or reading metadata. Permission or other access failures stop with the exact source path and error code.
- The production scanner harness uses the production pipeline through an in-memory database and never modifies the app library database.

## Lifecycle

- A scan discovers non-hidden physical sources, expands required archive members, performs bounded backend-aware work, and records a self-contained root generation. Each scanner route declares structural policy (`known-single`, `enumerate`, or `dependency-enumerate`) separately from metadata policy (`direct`, `decoder`, or `optional-deferred`). Required embedded-track enumeration remains eager; known single-track optional metadata may hydrate later.
- The atomic scan records its discovered physical-source set once through `markUndiscoveredSourcesDead`; that staged operation also restores rediscovered sources at publication. Do not precede it with a duplicate `restoreSources` pass.
- Each fully completed loose source or physical archive is written to the hidden
  generation and checkpointed in one database savepoint. An archive checkpoint
  is created only after its complete eligible member set succeeds, so resume
  cannot expose half an archive. Publish updates dead-source state, game
  buckets, root statistics, and the active-generation pointer in one short
  savepoint.
- Savepoint ownership is serialized per database for the complete asynchronous
  scope, and nested database helpers re-enter that owning scope. Individual
  SQLite worker requests must never interleave concurrent scanner savepoints;
  doing so can release another checkpoint's savepoint and strand the scan.
- Scan progress is resumable at physical-source boundaries. Cancellation and
  failure pause the hidden generation. The next scan with matching Deep Scan
  mode and scan version rediscovers sources, prunes vanished staged data,
  validates saved content/archive signatures, skips valid checkpoints, and
  replaces invalid ones. Startup retains generations referenced by scan jobs
  and converts interrupted active work to paused; incompatible work is removed.
- Database scan metrics separate staging, publication, obsolete-generation cleanup, database/WAL/shared-memory size, and WAL growth. Lifecycle telemetry additionally reports total and per-phase elapsed time using the shared sister-app vocabulary. The database logs the completed measurement and retains the latest value in process memory. No automatic WAL checkpoint is currently applied; require representative large-library measurements before adding one or moving cleanup off the scan-completion path.
- Scan progress is throttled and terminal operation state clears the job before late telemetry can revive Cancel. Discovery is visible as indeterminate progress until a stable source total exists. The status panel owns a persistent Cancel control: it is enabled only for a live job and remains visible but disabled while retained status is shown.
- Live scan telemetry uses the shared sister-app phase vocabulary: preparing,
  discovery, planning, archive listing, materialization, inspection,
  persistence, publication, and cleanup. Cancelling remains an active operation
  state until stage pause and scratch cleanup settle, disables repeated Cancel,
  and suppresses late progress. Backend resource permits remove aborted waiters
  immediately so cancelled work cannot consume capacity or start inspection.
- Graceful quit aborts the active job and waits up to 30 seconds for its subprocesses and scratch cleanup. If defective cleanup exceeds that bound, process exit leaves the checkpointed hidden job recoverable at startup. Scanner deadlines abort the underlying decoder or archive process before releasing that backend's concurrency slot; an ordinary operation timeout must not merely abandon its Promise.
- SPCBoy owns one user-data directory from one Electron process. The single-instance lock is acquired before database or cache initialization; this is the cross-process ownership boundary for scan scratch, durable-cache mutation, and staged database generations.
- Startup recovery preserves useful paused scanner generations and removes only incompatible or unreferenced hidden generations. Disposable scratch recovery is separate: every active scratch root contains a `.spcboy-owner.json` marker; recovery preserves a root whose recorded process is still alive and removes roots with missing or dead owners.
- Scan scratch roots use the exact `spcboy-scan-scratch-*` prefix. They are disposable, never a playback cache, and are removed after normal completion, cancellation, or materialization failure. A shared archive extraction is released as soon as its final member has been inspected; a root scan must never retain prior archives until the whole library completes.
- The scan service enforces its 8 GiB scratch budget and 2 GiB free-space reserve before and during archive extraction. TAR.ZST listing decompresses into an owned, accounted scratch root rather than the unbounded general temporary directory. One physical TAR.ZST scan uses one temporary TAR for all required members; do not restart `zstd` per member or pipe selected-member completion directly back into the decompressor, because early consumer closure can surface as a false SIGPIPE failure. Streamed materialization periodically remeasures filesystem space, refuses output beyond either boundary, and cleans its active root on failure.
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
- [Shared scanner policy fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-scanner-policy-v1.json)
- [Shared scanner lifecycle fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-scanner-lifecycle-v1.json)
