# Playlist

## Display

- Scope: supported files and playable archive members directly inside the selected folder, or the contents of a selected archive/file leaf.
- Columns: `#`, `File`, `Title`, `Game`, `Artist`, `System`, `Path`, and `Length`.
- Columns: order is draggable and persisted.
- Columns: headers are centered, resizable, sortable, and support right-click show/hide controls.
- Columns: all visible columns snap to their longest content when a playlist loads; double-click a header seam to snap one column again.
- Sorting: filename ascending is the default.
- Metadata: rows queue immediately, then metadata fills visible values asynchronously. Raw-folder rows use up to four direct inspections; archive rows share one archive materialization session and persist matching indexed metadata. VGM/VGZ GD3 tags do not wait for playback.
- Multi-track NSF and GBS files: each internal song appears as its own playlist row.

## Selection

- Selection: one row at a time.
- Selection: selected row and currently playing row remain separate.

## Activation

- Rows: double-click starts playback.
- Rows: Enter starts playback of the selected row.
- Rows: clicking a row gives the playlist focus, so Enter cannot be intercepted by the sidebar.
- Navigation: previous and next wrap within the selected folder.

## Files

- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
