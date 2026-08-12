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

## Critical Engineering Notes

- The schema stores library roots, indexed tracks, and inspected metadata.
- `game_sidebar_buckets` is the durable root-scoped Database sidebar projection. An unfiltered sidebar read uses this projection rather than grouping every track; FTS search resolves matching bucket identities and joins them back to the projection for counts.
- SQLite schema additions inspect `PRAGMA table_info` before each `ALTER TABLE`; an unexpected migration error is fatal and must not be caught as though the column already existed.
- Database sidebar/search and game activation use query-only worker connections separate from the serialized writer. WAL preserves a committed snapshot, and `latest-request-coalescer.js` discards superseded pending searches so stale typing cannot block the final query or activation.
- `tracks.browser_game` and `tracks.browser_system` store the normalized sidebar bucket at scan time. For a collection source, a recognized terminal filename tag (for example `[PS1]`) determines its console; otherwise a console-named parent folder does. Decoder probe labels are never console identity. The composite `tracks_browser_bucket_index` supports exact root-scoped game activation; do not rebuild game identity from `track_metadata` during selection.
- Existing databases populate empty buckets once in `browser-buckets-v1`, then receive the one-time `browser-buckets-v3` normalization. Archive containers remain one game leaf even when a subset of decoded track tags disagree. That work reads stored paths and metadata only; it does not rescan, extract, or decode audio, and it must not repeat at later launches.
- Indexed tracks persist special payload routing, including Nintendo DS `SWAV` and raw 22,050 Hz PCM WAV recognition, so database playback retains the scanner's content-based decoder choice.
- Scanning expands libgme multi-track files into one record per internal track, preserving `track_index` and `track_count` for database loading and playback.
- The existing folder-tree browser remains the active main sidebar; Options / Library is limited to root selection and scan controls. Options / Database owns database statistics and maintenance actions.
- Raw Folders navigation is separate from database scanning: root snapshots enumerate directory entries only, then queued playlist rows receive bounded asynchronous metadata inspection without delaying selection. Archive rows are grouped by archive path, materialized once per queued archive, and inspected through that shared disposable session.
- Queue-time metadata updates only matching existing `tracks` rows; it upserts `track_metadata` without changing `scan_completed`, scan signatures, or retry state.
- Database mode defaults to expandable console groups; the Console View setting controls whether those parent disclosure rows are shown or the game list is flattened.
- Root removal explicitly deletes that root's indexed tracks before deleting the root record.
- Publication completes before obsolete-generation cleanup begins. Cleanup failure is logged and leaves the newly published generation active; it must not be reported as though publication rolled back.
- Add, remove, move, single-enable, and batch-enable root changes return one refreshed root list and broadcast it to both windows. Batch enablement is one SQL update, not one roots reload per checkbox.
- Purging retained missing sources deletes their `track_search` rows before deleting tracks; FTS must never retain orphan row IDs.
- `track_search` is the persistent FTS index for filename, source/archive path, archive entry, bucket names, and scanned tags. Folder search scopes FTS matches to the active Folder root; Database search scopes them to enabled roots and returns whole game buckets. The renderer immediately filters its loaded game buckets, then replaces that optimistic subset with the FTS-complete result. Never reintroduce a concatenated `LIKE '%term%'` table scan on each keystroke.
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
