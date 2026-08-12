# Library Root Selection

## Scope

- Open-folder or file dialog behavior.
- Default-root resolution.
- Root and selected-folder restore.

## Ownership and Lifecycle

- Root library is chosen through a native Electron open dialog that accepts either a folder or a file path.
- Database root addition uses a main-process-owned, native folder-only multi-selection dialog. Main resolves and de-duplicates the selected paths, persists the roots directly, and returns the refreshed root list and counts; the renderer has no IPC operation that can add an arbitrary path.
- Starting a database scan sends a configured root ID. Main resolves that ID through the database and rejects an unknown root instead of accepting a renderer-provided filesystem path.
- Opening a file path loads its containing folder as the library root.
- Renderer settings persist `rootPath` and `selectedFolderPath` in `localStorage`.
- App bootstrap first tries to refresh the persisted root and selected folder.
- If persisted paths fail, bootstrap uses the main-process default root lookup.
- Default root lookup uses `SPCBOY_LIBRARY_ROOT` when valid.
- If that environment variable is absent or invalid, the app uses the sibling `spcsets_extracted` directory next to the app path when present.

## Critical Engineering Notes

- Keep root selection behavior explicit.
- Keep default-root resolution aligned with launch behavior.
- Keep persisted root restoration aligned with renderer settings.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
