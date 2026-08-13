# Library Root Selection

## Scope

- Raw Folders-view root selection and restore.
- Separation from MediaScanner catalog roots.

## Ownership and Lifecycle

- The Folders browser uses a native Electron dialog that accepts a folder or
  file. A file selection uses its containing folder.
- Renderer settings persist `rootPath` and `selectedFolderPath` in
  `localStorage`; bootstrap refreshes those paths before using the default.
- `SPCBOY_LIBRARY_ROOT` supplies the development default when valid. Otherwise
  the sibling `spcsets_extracted` directory may supply it.
- Catalog roots are read from the selected MediaScanner database and are not
  added, enabled, moved, removed, or scanned by SPCBoy.

## Invariants

- Raw Folders navigation is a playlist-browsing concern and never mutates the
  catalog root list.
- The renderer cannot submit an arbitrary path to a database-write IPC because
  no such IPC exists.
- Persisted raw-browser restoration failure is visible and does not trigger a
  catalog scan.

## Files

- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
