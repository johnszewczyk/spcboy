# Library Browser Database

## Scope

- Query-only access to the shared schema-23 catalog.
- Database-mode sidebar, search, activation, and selected catalog persistence.

## Ownership

- MediaScanner is the sole catalog writer and owns roots, scanning, metadata,
  projections, diagnostics, cancellation, and resume.
- The bundled `catalog-reader-electron-bridge` owns every production schema
  validation, query-only SQLite connection, sidebar projection, numeric-aware
  ordering, filtering, and catalog-row mapping through the shared Swift
  `CatalogReader` package. `catalog-reader-client.js` only frames bridge calls.
- `main.js` owns database-location persistence, native Browse, schema validation,
  safe reader reload, restart-required state, and guarded read IPC.
- The renderer owns presentation only; no preload API exposes catalog mutation.

## Invariants

- The default database is
  `~/Library/Application Support/CocoaSpice/Library.sqlite`.
- Browse persists another absolute path only after the Swift CatalogReader
  bridge accepts schema 23 and its required catalog shape.
- A changed location takes effect after restart. Reload Library replaces only the
  active reader after its replacement has passed schema validation; a staged
  different path still requires restart.
- Reloading preserves queued/playback files and swaps query-only catalog access
  only, then notifies both the main and Options renderers to refresh their view.
- SPCBoy never creates directories for, initializes, migrates, scans into,
  clears, repairs, or writes playlist metadata to the shared catalog.
- The catalog must be a self-contained rollback-journal database. MediaScanner
  owns conversion from older WAL state before writing.
- Database queries include attached roots only.
- A game identity is `root_id + browser_game + browser_system`; same-title
  games in separate roots stay distinct.
- Queue-time metadata may enrich the in-memory playlist but is never written
  back to the catalog.
- Database activation reads the stored source, archive member, and subtrack
  identity used by playback; a player never reinterprets that identity as a
  new catalog row.
- Paths and Consoles are distinct catalog views. Search temporarily covers any
  stored view with the catalog game index; clearing it restores Paths,
  Consoles, or Disk Path.
- Database game activation preserves stored archive member and libgme subtrack
  identity so the selected child track is played.

## Performance and Failure Boundaries

- Durable `game_sidebar_buckets` and `file_sidebar_buckets` are read directly;
  SPCBoy builds only its renderer-local presentation tree and never rebuilds
  or writes catalog projections.
- The shared Swift reader applies numeric-aware ordering before it returns
  renderer rows because SQLite NOCASE ordering is lexical (`10` before `9`).
- `latest-request-coalescer.js` discards superseded pending search/activation
  work so stale typing cannot block the newest query.
- Schema or read failures remain visible and do not trigger a fallback scanner
  or an alternate SPCBoy database.

## Files

- [catalog-reader-client.js](/Users/john/Downloads/Code/SPCBoy/electron/catalog-reader-client.js)
- [CatalogReader bridge](/Users/john/Downloads/Code/CatalogReader/Sources/CatalogReaderElectronBridge/main.swift)
- [latest-request-coalescer.js](/Users/john/Downloads/Code/SPCBoy/electron/latest-request-coalescer.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [app-library.js](/Users/john/Downloads/Code/SPCBoy/web/app-library.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
