# GUI Playlist Core

## Scope

- Selected-folder playlist surface.
- Row activation.
- Current-row versus selected-row behavior.

## Ownership and Invariants

- The playlist data source is the selected folder only.
- The playlist does not recurse into descendant folders.
- Multi-track libgme files appear as one row per internal track, with the stored track index carried into playback.
- Archive-backed playlist rows retain their archive source identity; selecting a row must not require the sidebar tree to rebuild.
- Every row uses the versioned, delimiter-safe `pt1` identity built from source
  path, optional archive member path, and zero-based subtrack index. Catalog
  display fields and raw-path structural timing never change that identity.
- Single click selects a row.
- Playlist rows are keyboard-focusable; clicking or focusing a row establishes playlist focus before Enter activation.
- Double click starts playback of that row.
- `Enter` plays the selected row.
- Enter activation resolves the focused playlist, folder/file, database-game, or database-console row before falling back to the current pane selection; it must not default to playlist row one.
- Selected row and current playing row are separate states.
- Current playing row may remain accented even if selection moves elsewhere.
- Previous and next wrap within the current selected-folder playlist.
- Database rows publish immediately from their catalog values. Raw-path rows
  may receive VGMBoy structural timing and subtrack count after materialization;
  they never receive decoder display tags or write anything to the MediaScanner
  catalog. Structural completion never changes the stable row identity.

## Critical Engineering Notes

- Treat this as a simple folder playlist, not a full playlist editor.
- Do not describe richer playlist-editing behavior as live unless the app actually exposes it.
- Keep row selection separate from playback state.

## Files

- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [Cross-app playlist activation fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-playlist-activation-v1.json)
