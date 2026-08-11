# Library Browser Database

## Scope

- Persistent library indexing and database-mode browsing.
- Main-process SQLite ownership and scan lifecycle.
- Indexed game and track queries exposed to the renderer.

## Ownership

- `electron/library-database.js` owns the SQLite schema, SQL operations, and database path contract. Its `sqlite-worker-client.js` boundary keeps Node's built-in synchronous SQLite API off the Electron main thread.
- `electron/main.js` owns windows, IPC, and filesystem browsing. `electron/track-inspector.js` owns metadata shortcut policy, bounded caching, and backend scan throttling; `electron/library-scan-service.js` owns scan orchestration through injected database, inspection, and progress boundaries.
- `web/app-library.js` owns renderer-side library root, scanning, and database-maintenance actions; `web/app-ui.js` owns shared rendering and exposes its small dependency surface.
- `electron/preload.js` exposes database operations without giving the renderer filesystem or database access.

## Invariants

- The database lives in Electron's user-data directory as `Library.sqlite`.
- A root scan replaces live records for that root transactionally while retaining records marked in `dead_sources`.
- Game rows are root-scoped by `root_id + browser_game + browser_system`. Same-title/same-console records in different library roots remain separate, and database activation binds that exact tuple.
- Existing committed records remain available if a scan fails before its transaction commits.
- A single archive listing failure is retained as a root scan warning without discarding successfully indexed files from the same root.
- Database queries are limited to enabled roots.

## Current State

- The schema stores library roots, indexed tracks, and inspected metadata.
- `tracks.browser_game` and `tracks.browser_system` store the normalized sidebar bucket at scan time. The composite `tracks_browser_bucket_index` supports exact root-scoped game activation; do not rebuild game identity from `track_metadata` during selection.
- Existing databases populate empty browser buckets once in the `browser-buckets-v1` schema-state transaction. That work reads stored paths and metadata only; it does not rescan, extract, or decode audio, and it must not repeat at later launches.
- Indexed tracks store the source size/modification fingerprint, archive member-list signature when applicable, and scan-version marker used for safe incremental reuse.
- Indexed tracks persist special payload routing, including Nintendo DS `SWAV` and raw 22,050 Hz PCM WAV recognition, so database playback retains the scanner's content-based decoder choice.
- Scanning expands libgme multi-track files into one record per internal track, preserving `track_index` and `track_count` for database loading and playback.
- Root scans recurse through all non-hidden subfolders before finalizing the root index and starting metadata inspection.
- Scanner discovery emits physical source batches for progress reporting, but the library scan keeps discovery and inspection as separate phases. Archive members are fully expanded after discovery, yielding a stable playable-source total before bounded metadata inspection begins. Archive listing retains its 30-second boundary and two-listing concurrency limit.
- Metadata inspection uses per-backend async permits and route-specific 60-second timeout boundaries; the global scan worker count no longer directly determines helper-process concurrency.
- Inspection metadata uses a 2,048-entry LRU only while the file's device, inode, size, modification time, and change time still match. This prevents process-lifetime growth and stale results after a source is replaced.
- PSF-family footer metadata is read before helper inspection; scanner-level helper exceptions retain their backend/stage context instead of becoming generic metadata-null rows.
- Valid PSF/PSF2 footer metadata completely bypasses Play! helper startup during scanning. Play! is only the fallback for a missing or malformed footer.
- Headerless `.ss2` payloads are retained as `unsupported` scan outcomes, not metadata failures. vgmstream's SSHD route requires the `SShd` header and the raw payload does not contain enough channel/rate/container information for safe playback.
- A scan loads the previous root records before inspection. Complete sources whose scan version, source fingerprint, metadata rows, track indices, and archive listing signature still match are reused; changed, incomplete, or legacy-version sources are inspected again.
- Complete archive member groups are now reused at the parent-source level before archive listing when archive size/mtime, a bounded fast content signature, and all member rows remain complete; changed parents enter the bounded listing/materialization path.
- A deep scan explicitly bypasses source and archive reuse, but still commits atomically only after the operation completes; interrupted work cannot replace the last committed records.
- The existing folder-tree browser remains the active main sidebar; Options / Library is limited to root selection and scan controls. Options / Database owns database statistics and maintenance actions.
- Raw Folders navigation is separate from database scanning: root snapshots enumerate directory entries only, then queued playlist rows receive bounded asynchronous metadata inspection without delaying selection. Archive rows are grouped by archive path, materialized once per queued archive, and inspected through that shared disposable session.
- Queue-time metadata updates only matching existing `tracks` rows; it upserts `track_metadata` without changing `scan_completed`, scan signatures, or retry state.
- Database mode defaults to expandable console groups; the Console View setting controls whether those parent disclosure rows are shown or the game list is flattened.
- Scan progress is sent to the renderer at most every 100 ms and updates one readout directly, so rendering does not pace filesystem or metadata work.
- Library operation state is a separate IPC signal carrying a monotonic job ID. Progress telemetry never creates an operation in the renderer; terminal state clears the active job before a delayed progress message can re-enable Cancel.
- Renderer scan-progress events update only the status panel and progress fill. They must not rebuild the sidebar tree, playlist, or options control tree.
- Scan metadata inspection uses bounded per-backend and archive-member concurrency in the main process; database commit remains one transaction per root.
- Scanner admission now derives from the playback backend registry, which exposes backend ID, extension, archive-member status, dependency-set policy, scan concurrency, and metadata timeout for each route.
- The backend registry preserves every candidate for an extension instead of silently overwriting a later plugin/backend. Its declared order supplies the common scanner/playback default, while Routing stores an optional per-extension decoder preference and reports real overlaps.
- Indexed track records retain the decoder backend ID. A normal rescan reuses a source only when its configured route still matches, so a Routing preference change refreshes that source's metadata instead of preserving stale decoder results.
- Scan failures and successes are represented in-memory as typed outcomes with source/member identity, route, stage, state, duration, and message; the visible log remains compatible while structured summaries are returned with scan results.
- `test-support/production-scanner-harness.js` is test support, not an app command surface. It reuses production discovery, archive expansion/materialization, backend routing, and metadata inspection through an in-memory database adapter. Its optional PCM probe decodes two bounded consecutive chunks per playable subtrack and records a `playback` outcome without modifying the app library database.
- `npm run test:scanner` runs the corpus integration test only when `SPCBOY_COMPATIBILITY_ROOTS` provides one or more fixture folders; it always performs the bounded PCM probe and leaves the app database untouched.
- Scan progress distinguishes discovery and archive listing text from the stable-count metadata inspection phase; the progress bar is only shown after the complete playable-source total is known.
- Root removal explicitly deletes that root's indexed tracks before deleting the root record.
- Scan state stores file, success, and error counts separately from the detailed error-only log; the options row must show only the compact summary and expose detail through Log.
- Each completed root scan also persists typed outcomes in `library_scan_outcomes`; this retains source/member, backend, stage, state, duration, and message diagnostics independently of the compact root summary.
- The renderer's Scan Log is selectable and copyable, uses a monospace 8 pt body, and closes through its close button, Escape, or backdrop click.
- Test Files reads each distinct `COALESCE(archive_path, path)` source from the index, checks filesystem existence only, and marks confirmed-missing sources in `dead_sources` without deleting tracks or metadata. The change is broadcast to both renderers so active playlists and database/sidebar views immediately hide those sources. It must not list archives, materialize members, or inspect metadata.
- Folder-view search first retains its in-memory raw-tree result, then asks the indexed database across every enabled root for matching descendants by filename, archive entry, title, game, artist, or system. Whitespace-separated query terms match independently, so a user need not reproduce a tag's exact punctuation or word order. The renderer rebuilds only compact ancestor paths for indexed sources; it does not recursively unfold or rescan the filesystem per keystroke.
- A later discovery restores a rediscovered source before incremental reuse; `Clear Unlinked` explicitly deletes dead-source tracks, scan outcomes, and markers. `Clear Database` clears indexed contents while retaining configured roots.
- `Scan Selected` scans enabled roots sequentially under the existing single-library-operation guard; concurrent scan/maintenance requests are rejected or disabled.
- A successful root scan clears `needs_rescan`; Test Files and purge operations set it so the renderer can distinguish a clean scan from maintenance-required state.
- Each stored track row carries `scan_completed`. Only rows whose scan completed, metadata exists, route/version matches, and source size/mtime plus archive fingerprints still match may be reused by an ordinary scan; failed or incomplete rows are always re-inspected.
- The main process owns one cancellable library operation at a time. Cancellation is checked between recursive discovery, archive listing, source inspection, and integrity checks; cancelled scans must not replace a root's committed tracks.
- SQLite runs through Node's built-in runtime in a dedicated worker. The main process keeps its asynchronous database API and does not depend on a host `sqlite3` executable.
- ZIP, 7z, RSN, TZST, and TAR.ZST entries are indexed as virtual tracks with archive path and entry fields; playback materializes the selected entry through the archive resolver. RSN listing uses `lsar` and RSN extraction uses `unar` for solid RAR-family sets; TZST/TAR.ZST listing and extraction explicitly use `zstd` plus `bsdtar`.
- Archive extraction uses macOS `bsdtar` for ZIP exact entry matching, with `7zz` fallback; 7z archives use `7zz`; TZST/TAR.ZST archives are decompressed with `zstd` and read by `bsdtar`; and this avoids unzip wildcard interpretation of bracketed filenames.
- A scan materializes all selected members of one TZST/TAR.ZST through one decompressed TAR scratch stream. Member stdout is streamed directly into scratch files, never accumulated in a Node maxBuffer; it must not restart zstd once per PSF/PSF2 or vgmstream member. The TAR expansion is nested under the owned scan-scratch root.
- Scan scratch roots live directly under the configured temp parent with the exact `spcboy-scan-scratch-*` prefix. Resolver creation/removal tracks live roots; startup recovery removes only inactive roots with that exact parent/prefix, never the durable ArchiveCache.
- The scan service applies an 8 GiB scratch budget and a 2 GiB free-space reserve before beginning another archive; streamed materialization refuses bytes that would exceed the budget. Cleanup refreshes scratch accounting before a cancelled or completed scan settles.
- Graceful quit cancels an active library job and waits for its scan cleanup before exiting. Forced termination is recovered on the next startup.
- Vgmstream TXT P dependency materialization includes non-track `.DA` CD-XA streams and `.TXTH` descriptors alongside playable vgmstream members, preserving the definition's relative paths.
- Scan-only archive extraction uses disposable `spcboy-scan-scratch-*` directories and removes them after inspection; durable archive-cache materialization remains a playback concern.
- Durable archive materialization is managed under `SPCBoy/ArchiveCache`, keyed by source path, file size, and modification time. It is enabled by default with a 2 GiB user-selected cap (512 MiB–4 GiB): completed top-level entries are touched on use and least-recently-used entries are pruned after materialization, while the active playback lease is protected. A cache entry cannot stream beyond the selected cap.
- Cache-off playback uses an owned `spcboy-playback-scratch-*` root rather than the durable cache. It is released on Stop/replacement, capped at 2 GiB with a 1 GiB free-space reserve, and abandoned roots are removed at startup. Queue-time metadata inspection is also disposable and receives the same no-unbounded-materialization fallback budget when it is outside a scan job.
- Options exposes current byte/file use, an enable switch, a cache limit, and explicit Clear Cache. Clearing is mutually exclusive with materialization and active playback remains protected.
- Libgme playback commands receive the stored track index so NSF/GBS internal tracks start at the selected song rather than always starting at track zero.
- Archive-member scans must never use the internal materialization-cache directory as a game name; absent embedded game metadata falls back to the archive filename.

## Files

- [library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [sqlite-worker-client.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker-client.js)
- [sqlite-worker.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [library-scan-service.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan-service.js)
- [track-inspector.js](/Users/john/Downloads/Code/SPCBoy/electron/track-inspector.js)
- [playlist-archive-metadata.js](/Users/john/Downloads/Code/SPCBoy/electron/playlist-archive-metadata.js)
- [archive-cache-gate.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-cache-gate.js)
- [metadata-cache.js](/Users/john/Downloads/Code/SPCBoy/electron/metadata-cache.js)
- [app-library.js](/Users/john/Downloads/Code/SPCBoy/web/app-library.js)
- [library-scan.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan.js)
- [archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [playback-core.js](/Users/john/Downloads/Code/SPCBoy/electron/playback-core.js)
- [scanner-model.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-model.js)
- [scanner-discovery.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-discovery.js)
- [scanner-archive.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-archive.js)
- [scanner-scheduler.js](/Users/john/Downloads/Code/SPCBoy/electron/scanner-scheduler.js)
- [production-scanner-harness.js](/Users/john/Downloads/Code/SPCBoy/test-support/production-scanner-harness.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
