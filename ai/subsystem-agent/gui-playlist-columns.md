# GUI Playlist Columns

## Scope

- Playlist column set.
- Column default values.
- Column order persistence.

## Ownership and Invariants

- Current visible columns are `#`, `File`, `Title`, `Game`, `Artist`, `System`, `Path`, and `Length`.
- `#` is the 1-based row index within the selected folder.
- `File` is the actual filename including extension.
- Catalog metadata columns come directly from MediaScanner. Raw DiskPath rows use pathname labels and intentionally leave unavailable catalog columns blank.
- `Length` is the catalog value when present; a raw DiskPath row shows `—` until VGMBoy returns its non-metadata playback structure.
- Playlist column order is draggable and persisted.
- Column widths and visibility are persisted; headers can be resized, sorted, and right-clicked for the visibility menu.
- A newly loaded playlist autosizes all visible columns to their longest rendered content; double-clicking a header seam autosizes only that column.
- Auto-sizing keys off the rendered visible-column content, so raw structural timing completion can remeasure a changed Length value.
- Auto-sizing gives the playlist table the measured content width; wide playlists use the existing horizontal scroller instead of squeezing every column back into the viewport.
- The `index` column is display-only. Derive its value from the rendered row position after sorting; never persist it on a track or allow it to become a sort key.
- Filename ascending is the default playlist sort; clicking a header toggles ascending and descending order.

## Critical Engineering Notes

- Keep column behavior aligned with the actual renderer table.
- Treat catalog display fields as immutable frontend input. Raw structural timing is not metadata and must not alter a playlist source.
- Do not describe hidden-column menus, autosize, or richer header behaviors as live unless implemented.

## Files

- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/styles.css](/Users/john/Downloads/Code/SPCBoy/web/styles.css)
