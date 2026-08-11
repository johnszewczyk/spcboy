# GUI Playlist Columns

## Scope

- Playlist column set.
- Column default values.
- Column order persistence.

## Ownership and Invariants

- Current visible columns are `#`, `File`, `Title`, `Game`, `Artist`, `System`, `Path`, and `Length`.
- `#` is the 1-based row index within the selected folder.
- `File` is the actual filename including extension.
- Metadata columns are seeded from lightweight defaults and hydrated later when richer inspection data arrives.
- `Length` starts as `—` and is filled in after helper inspection.
- Playlist column order is draggable and persisted.
- Column widths and visibility are persisted; headers can be resized, sorted, and right-clicked for the visibility menu.
- A newly loaded playlist autosizes all visible columns to their longest rendered content; double-clicking a header seam autosizes only that column.
- Auto-sizing keys off the rendered visible-column content, so metadata hydration remeasures columns after titles, games, artists, systems, or lengths change.
- Auto-sizing gives the playlist table the measured content width; wide playlists use the existing horizontal scroller instead of squeezing every column back into the viewport.
- Filename ascending is the default playlist sort; clicking a header toggles ascending and descending order.

## Critical Engineering Notes

- Keep column behavior aligned with the actual renderer table.
- Treat metadata hydration as display enrichment, not a playlist-source change.
- Do not describe hidden-column menus, autosize, or richer header behaviors as live unless implemented.

## Files

- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/styles.css](/Users/john/Downloads/Code/SPCBoy/web/styles.css)
