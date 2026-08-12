# App State Persistence

## Scope

- Renderer-side source of truth.
- Persisted settings.
- Selection versus current playback semantics.

## Ownership and Invariants

- The active UI state lives in the renderer `state` object in `web/app-core.js`.
- Persisted settings are stored in browser `localStorage` under `spcboy-electron-settings`.
- Persisted values include root path, selected folder, last selected track, timing settings, independent Sidebar/Playlist font size, color, and monospace settings, sidebar width, item spacing, Console View, console-tag source, underlying Folders/Database mode, and column order. Search temporarily overrides the visible mode without changing that stored underlying selection.
- Play time is normalized to 30-second steps.
- libgme and libvgm playback speeds persist as separate reduced `{ numerator, denominator }` rationals, not floating-point values. Their enable settings persist independently and are broadcast to the separate Options window before only a compatible active route is refreshed.
- Font size and sidebar width are clamped to safe UI ranges before storage.
- `selectedTrackId` is the row selection target.
- `currentTrackId` is the active playback row.
- Selecting a row does not automatically start playback.
- Selecting a different folder in the sidebar does not automatically stop current playback.
- Metadata hydration for older playlist generations is ignored once a newer metadata token exists. Archive hydration returns only to the generation that requested it, while matching indexed rows persist the refreshed metadata through the main process.

## Critical Engineering Notes

- Treat renderer state as the active UI-state authority.
- Keep selection separate from current playback.
- If settings move out of `localStorage`, update this file and `project-info.md`.

## Files

- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
