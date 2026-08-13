# Library Browser Database

## Scope

- Query-only access to the shared schema-23 catalog.
- Database-mode sidebar, search, activation, and selected catalog persistence.

## Ownership

- MediaScanner is the sole catalog writer and owns roots, scanning, metadata,
  projections, diagnostics, cancellation, and resume.
- `canonical-library-reader.js` owns SPCBoy's production query adapter and maps
  the catalog's `author` field to SPCBoy's `artist` presentation field.
- `sqlite-worker.js` opens query-only lanes with SQLite's OS-level `readOnly`
  option and also applies `PRAGMA query_only=ON`.
- `main.js` owns database-location persistence, native Browse, schema validation,
  restart-required state, and guarded read IPC.
- The renderer owns presentation only; no preload API exposes catalog mutation.

## Invariants

- The default database is
  `~/Library/Application Support/CocoaSpice/Library.sqlite`.
- Browse persists another absolute path only after the staged Swift
  `media-scan catalog validate` command accepts schema 23 and required tables.
- A changed location takes effect after restart; a live worker is never swapped.
- SPCBoy never creates directories for, initializes, migrates, scans into,
  clears, repairs, or writes playlist metadata to the shared catalog.
- The catalog must be a self-contained rollback-journal database. MediaScanner
  owns conversion from older WAL state before writing.
- Database queries include attached roots only.
- A game identity is `root_id + browser_game + browser_system`; same-title
  games in separate roots stay distinct.
- Queue-time metadata may enrich the in-memory playlist but is never written
  back to the catalog.
- Search is a temporary third database view independent of the stored Folders
  or Database mode. Clearing it restores the underlying mode.
- Database game activation preserves stored archive member and libgme subtrack
  identity so the selected child track is played.

## Performance and Failure Boundaries

- Durable `game_sidebar_buckets`, file-tree projections, and FTS data are read
  directly; SPCBoy does not rebuild them.
- `latest-request-coalescer.js` discards superseded pending search/activation
  work so stale typing cannot block the newest query.
- Schema or read failures remain visible and do not trigger a fallback scanner
  or an alternate SPCBoy database.

## Files

- [canonical-library-reader.js](/Users/john/Downloads/Code/SPCBoy/electron/canonical-library-reader.js)
- [sqlite-worker-client.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker-client.js)
- [sqlite-worker.js](/Users/john/Downloads/Code/SPCBoy/electron/sqlite-worker.js)
- [latest-request-coalescer.js](/Users/john/Downloads/Code/SPCBoy/electron/latest-request-coalescer.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [app-library.js](/Users/john/Downloads/Code/SPCBoy/web/app-library.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
