# Library Browser Database

## Scope

- Persistent library indexing and database-mode browsing.
- Main-process SQLite ownership and indexed browser queries.
- Indexed game and track queries exposed to the renderer.

## Ownership

- `electron/library-database.js` owns the SQLite schema, SQL operations, and database path contract. Its `sqlite-worker-client.js` boundary keeps Node's built-in synchronous SQLite API off the Electron main thread.
- `electron/main.js` owns windows and IPC. `electron/library-scan-service.js` owns scan orchestration; its lifecycle constraints live in `library-scan-lifecycle.md`.
- `web/app-library.js` owns renderer-side library root, scanning, and database-maintenance actions; `web/app-ui.js` owns shared rendering and exposes its small dependency surface.
- `electron/preload.js` exposes database operations without giving the renderer filesystem or database access.

## Invariants

- The database lives in Electron's user-data directory as `Library.sqlite`.
- A root scan writes a self-contained generation while retaining records marked in `dead_sources`.
- WAL readers use query-only worker lanes and keep the active generation visible while bounded staged batches commit. Tracks, FTS rows, outcomes, and discovered sources become visible only when a short publish savepoint switches the root generation and game projection; failure deletes the staged generation.
- Game rows are root-scoped by `root_id + browser_game + browser_system`. Same-title/same-console records in different library roots remain separate, and database activation binds that exact tuple.
- Existing active-generation records remain available if a scan fails before publication, even though bounded batches for the staged generation may already be committed.
- A single archive listing failure is retained as a root scan warning without discarding successfully indexed files from the same root.
- Database queries are limited to enabled roots.
- A database scan is authorized by configured root ID. The main process resolves the path from its database and rejects an unknown ID; the renderer cannot submit an arbitrary scan path.

## Critical Engineering Notes

- The schema stores library roots, indexed tracks, and inspected metadata.
- `game_sidebar_buckets` is the durable root-scoped Database sidebar projection. An unfiltered sidebar read uses this projection rather than grouping every track; FTS search resolves matching bucket identities and joins them back to the projection for counts.
- SQLite schema additions inspect `PRAGMA table_info` before each `ALTER TABLE`; an unexpected migration error is fatal and must not be caught as though the column already existed.
- Database sidebar/search and game activation use query-only worker connections separate from the serialized writer. WAL preserves a committed snapshot, and `latest-request-coalescer.js` discards superseded pending searches so stale typing cannot block the final query or activation.
- `tracks.browser_game` and `tracks.browser_system` store the normalized sidebar bucket at scan time. Game tags win when present; otherwise an archive uses its archive filename and a loose source uses its immediate parent folder. Absolute materialization paths and scratch-directory names are never visible identity.
- Console identity uses a recognized terminal filename tag (for example `[PS1]`) or the nearest console-named ancestor by default. `Prefer Embedded Console Tags` reverses that priority. Existing rows are rewritten in bounded 1,000-row batches inside one savepoint without rescanning, extracting, or decoding audio; the game projection and FTS index publish with the preference marker.
- Indexed tracks persist special payload routing, including Nintendo DS `SWAV` and raw 22,050 Hz PCM WAV recognition, so database playback retains the scanner's content-based decoder choice.
- Scanning expands libgme multi-track files into one record per internal track, preserving `track_index` and `track_count` for database loading and playback.
- The existing folder-tree browser remains the active main sidebar; Options / Library is limited to root selection and scan controls. Options / Database owns database statistics and maintenance actions.
- Raw Folders navigation is separate from database scanning: root snapshots enumerate directory entries only. Multi-track libgme containers are enumerated before queue insertion so loose and archived NSF/GBS/AY/HES/KSS/NSFE/SAP sources publish one row per child; other queued rows receive bounded asynchronous metadata inspection. Archive metadata hydration materializes each queued archive once through a shared disposable session.
- Queue-time metadata updates only matching existing `tracks` rows; it upserts `track_metadata` without changing `scan_completed`, scan signatures, or retry state. Database rows with an unknown length remain eligible for queue-time hydration rather than being marked complete merely because other scan metadata exists.
- Database mode defaults to expandable console groups; the Console View setting controls whether those parent disclosure rows are shown or the game list is flattened.
- Root removal explicitly deletes that root's indexed tracks before deleting the root record.
- Publication completes before obsolete-generation cleanup begins. Cleanup failure is logged and leaves the newly published generation active; it must not be reported as though publication rolled back.
- The Electron single-instance lock is acquired before database initialization. One process therefore owns staged-generation creation and startup cleanup for a user-data directory; a second launch focuses the existing app rather than opening a competing database writer.
- Add, remove, move, single-enable, and batch-enable root changes return one refreshed root list and broadcast it to both windows. Batch enablement is one SQL update, not one roots reload per checkbox.
- Purging retained missing sources deletes their `track_search` rows before deleting tracks; FTS must never retain orphan row IDs.
- `track_search` is the persistent FTS index for filename, source/archive path, archive entry, bucket names, and scanned tags. A non-empty sidebar query always searches enabled-root game buckets as a temporary third view, independent of the stored Folders/Database mode. The renderer immediately filters loaded buckets, then replaces that optimistic subset with the FTS-complete result. Clearing search returns to the stored underlying view.
- Libgme playback commands receive the stored track index so NSF/GBS internal tracks start at the selected song rather than always starting at track zero.

## Files

- [library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [sqlite-worker-client.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker-client.js)
- [sqlite-worker.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker.js)
- [latest-request-coalescer.js](/Users/john/Downloads/Code/SPCBoy/electron/latest-request-coalescer.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [playlist-archive-metadata.js](/Users/john/Downloads/Code/SPCBoy/electron/playlist-archive-metadata.js)
- [app-library.js](/Users/john/Downloads/Code/SPCBoy/web/app-library.js)
- [playback-core.js](/Users/john/Downloads/Code/SPCBoy/electron/playback-core.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
