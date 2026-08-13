# Library Browser Database

## Scope

- Persistent library indexing and database-mode browsing.
- Main-process SQLite ownership and indexed browser queries.
- Indexed game and track queries exposed to the renderer.

## Ownership

- MediaScanner owns the canonical CocoaSpice schema-23 catalog contract and is the intended sole writer.
- `electron/canonical-library-reader.js` owns SPCBoy's production query adapter. Its `sqlite-worker-client.js` connection uses SQLite query-only mode and maps CocoaSpice `author` metadata to SPCBoy's `artist` presentation field.
- `electron/main.js` owns windows, database-location persistence, native Browse, restart-required state, and guarded IPC. `electron/library-database.js` and `electron/library-scan-service.js` are dormant migration reference, not the production database or scanner.
- `web/app-library.js` owns renderer-side library root, scanning, and database-maintenance actions; `web/app-ui.js` owns shared rendering and exposes its small dependency surface.
- `electron/preload.js` exposes database operations without giving the renderer filesystem or database access.

## Invariants

- The default database is `~/Library/Application Support/CocoaSpice/Library.sqlite`. Options may persist another absolute path only after the staged Swift `media-scan catalog validate` command confirms the current canonical schema and required tables.
- SPCBoy never initializes, migrates, scans into, clears, or writes playlist metadata back to the shared catalog. Mutation IPC fails explicitly and mutation controls are disabled while the canonical reader is active.
- A location change never swaps a live worker connection; Options reports that a restart is required.
- The following staged-generation notes describe the dormant JavaScript implementation retained during extraction, not active SPCBoy behavior.
- A legacy root scan writes a self-contained generation while retaining records marked in `dead_sources`.
- WAL readers use query-only worker lanes and keep the active generation visible while bounded physical-source checkpoints commit. Tracks, FTS rows, outcomes, and discovered sources become visible only when a short publish savepoint switches the root generation and game projection; cancellation or failure pauses the staged generation for a validated matching resume.
- Game rows are root-scoped by `root_id + browser_game + browser_system`. Same-title/same-console records in different library roots remain separate, and database activation binds that exact tuple.
- Existing active-generation records remain available if a scan fails before publication, even though complete-source checkpoints for the staged generation may already be committed.
- A single archive listing failure is retained as a root scan warning without discarding successfully indexed files from the same root.
- Database queries are limited to enabled roots.
- A database scan is authorized by configured root ID. The main process resolves the path from its database and rejects an unknown ID; the renderer cannot submit an arbitrary scan path.

## Critical Engineering Notes

- The schema stores library roots, indexed tracks, and inspected metadata.
- `game_sidebar_buckets` is the durable root-scoped Database sidebar projection. An unfiltered sidebar read uses this projection rather than grouping every track; FTS search resolves matching bucket identities and joins them back to the projection for counts.
- SQLite schema additions inspect `PRAGMA table_info` before each `ALTER TABLE`; an unexpected migration error is fatal and must not be caught as though the column already existed.
- Database sidebar/search and game activation use query-only worker connections separate from the serialized writer. WAL preserves a committed snapshot, and `latest-request-coalescer.js` discards superseded pending searches so stale typing cannot block the final query or activation.
- `tracks.browser_game` and `tracks.browser_system` store the normalized sidebar bucket at scan time and execute the shared CocoaSpice/SPCBoy identity contract. Game tags win when present; otherwise an archive uses its outer filename without a recognized terminal console tag and a loose source uses its immediate parent folder. Unrecognized title suffixes remain intact. Absolute materialization paths, scratch-directory names, and unknown folders are never visible console identity.
- Console identity uses a recognized terminal filename tag (for example `[PS1]`) or the nearest console-named ancestor by default. `Prefer Embedded Console Tags` reverses that priority, and known aliases normalize after selection. Existing rows are rewritten in bounded 1,000-row batches inside one savepoint without rescanning, extracting, or decoding audio; browser-buckets-v4 preserves the stored preference while republishing the game projection and FTS index.
- Indexed tracks persist special payload routing, including Nintendo DS `SWAV` and raw 22,050 Hz PCM WAV recognition, so database playback retains the scanner's content-based decoder choice.
- Scanning expands libgme multi-track files into one record per internal track, preserving `track_index` and `track_count` for database loading and playback.
- The existing folder-tree browser remains the active main sidebar; Options / Library is limited to root selection and scan controls. Options / Database owns database statistics and maintenance actions.
- Raw Folders navigation is separate from database scanning: root snapshots enumerate directory entries only. Multi-track libgme containers are enumerated before queue insertion so loose and archived NSF/GBS/AY/HES/KSS/NSFE/SAP sources publish one row per child; other queued rows receive bounded asynchronous metadata inspection. Archive metadata hydration materializes each queued archive once through a shared disposable session.
- Queue-time metadata updates only matching existing `tracks` rows; it guards source size, modification time, content/archive signature, scan version, member, and subtrack identity before upserting `track_metadata`, without changing `scan_completed` or retry state. Metadata completeness is represented by the metadata row itself; zero or unknown duration is not treated as missing metadata.
- Database mode defaults to expandable console groups; the Console View setting controls whether those parent disclosure rows are shown or the game list is flattened.
- Root removal explicitly deletes that root's indexed tracks before deleting the root record.
- Publication completes before obsolete-generation cleanup begins. Cleanup failure is logged and leaves the newly published generation active; it must not be reported as though publication rolled back.
- `scan_jobs` and `scan_source_checkpoints` retain only compatible hidden work. Startup preserves useful paused generations, active work becomes paused after an interrupted process, and publication removes its job/checkpoints before obsolete-generation cleanup.
- The Electron single-instance lock is acquired before database initialization. One process therefore owns staged-generation creation and startup cleanup for a user-data directory; a second launch focuses the existing app rather than opening a competing database writer.
- Add, remove, move, single-enable, and batch-enable root changes return one refreshed root list and broadcast it to both windows. Batch enablement is one SQL update, not one roots reload per checkbox.
- Purging retained missing sources deletes their `track_search` rows before deleting tracks; FTS must never retain orphan row IDs.
- `track_search` is the persistent FTS index for filename, source/archive path, archive entry, bucket names, and scanned tags. A non-empty sidebar query always searches enabled-root game buckets as a temporary third view, independent of the stored Folders/Database mode. The renderer immediately filters loaded buckets, then replaces that optimistic subset with the FTS-complete result. Clearing search returns to the stored underlying view.
- `sidebar-view-state.js` resolves the stored mode plus trimmed query into Folders, Database, or temporary Search. Search always has database content and that same resolution governs rendering and keyboard fallback, preventing the covered Folders mode from intercepting Search activation or Home/End navigation.
- Libgme playback commands receive the stored track index so NSF/GBS internal tracks start at the selected song rather than always starting at track zero.

## Files

- [canonical-library-reader.js](/Users/john/Downloads/Code/SPCBoy/electron/canonical-library-reader.js)
- [library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [sqlite-worker-client.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker-client.js)
- [sqlite-worker.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker.js)
- [latest-request-coalescer.js](/Users/john/Downloads/Code/SPCBoy/electron/latest-request-coalescer.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [playlist-archive-metadata.js](/Users/john/Downloads/Code/SPCBoy/electron/playlist-archive-metadata.js)
- [Cross-app identity fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-library-identity-v1.json)
- [Cross-app search-view fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-sidebar-search-view-v1.json)
- [Cross-app playlist activation fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-playlist-activation-v1.json)
- [Sister-app conformance contract](/Users/john/Downloads/Code/DocMan/Docs/cocoaspice-spcboy-conformance.md)
- [app-library.js](/Users/john/Downloads/Code/SPCBoy/web/app-library.js)
- [playback-core.js](/Users/john/Downloads/Code/SPCBoy/electron/playback-core.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
