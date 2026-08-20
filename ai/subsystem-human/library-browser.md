# Library Browser

## Display

- Browser: recursive folder tree under the current library root.
- Browser: hidden dot-folders are omitted.
- Browser: selected-folder ancestors stay visible.
- Folders view: opening a folder, file, or dropped path returns the sidebar to the raw recursive folder browser and selects the opened folder. Enabled configured library paths populate this view at startup.

## Search

- Search: is a temporary third view that returns the same indexed game results whether Folders or Database was selected. Clearing it restores the prior view.
- Search: results are grouped under console headings.
- Search: Enter and list-edge navigation act on visible database results even when Folders is the covered underlying view.
- Search: does not interrupt playback.

## Selection

- Single-click: folders select/fold without changing the playlist. A dotted leaf file or archive replaces the playlist with its playable contents without starting playback.
- Activation: Enter or double-click sends the selected folder, file, or archive contents to the playlist and starts the first resulting track.
- Sidebar context menu: Show in Finder, Play Now, or Queue; Queue appends the selected folder/file/archive content to the current playlist.

## Root Selection

- Library root: choose a folder or file through the native open dialog.
- Library root: drag a folder, supported audio file, or ZIP/7z/RSN/TZST/TAR.ZST archive onto SPCBoy to open it.
- File selection: uses the containing folder as the library root.
- Root and selected folder: restore between launches.

## Library Index

- SPCBoy reads library roots, game buckets, tracks, and metadata from the shared MediaScanner schema-23 catalog through a read-only SQLite connection, without creating, migrating, or writing it.
- Options / Database selects and validates the catalog path, shows library and archive-cache statistics, and reports when restart is required. Archive Cache remains SPCBoy-owned playback state and can still be configured or cleared while playback is stopped.
- Options / Library shows the catalog's configured roots. Root mutation, scans, Test Files, and destructive database maintenance are disabled because MediaScanner is the sole catalog-writer boundary.
- Database: ZIP-, 7z-, RSN-, and TZST-contained supported audio files appear as playable indexed tracks, including expanded internal songs from multi-track NSF and GBS files.
- Database mode: a game leaf previews its indexed tracks on selection, while console headings are expandable/collapsible and activate only with Enter or double-click. Console headings use a recognized collection tag such as `[PS1]`, then the nearest recognized collection folder by default; Prefer Embedded Console Tags reverses that priority. Known aliases are normalized after source selection. A recognized terminal console tag is omitted from an archive game name, while unrelated suffixes such as `[USA]` remain. Same-title games from separate library paths remain distinct and load only that root's indexed tracks.
- Database mode: single-click preview is delayed just long enough to distinguish a double-click, so activation issues one track query instead of previewing and immediately loading the same game again. Database read/search/activation failures remain visible below the existing game list.
- Console grouping: database games are always grouped under expandable console headings; there is no flat-list option. Grouping does not change search or activation behavior.
- View toggle: one icon button switches between Folders and Database; search results remain unchanged while a query is active.
- Playback Options: App Volume controls SPCBoy output only; Equalizer exposes ten shared 31 Hz–16 kHz parametric bands at ±12 dB and applies to renderer and native playback paths.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/canonical-library-reader.js](/Users/john/Downloads/Code/SPCBoy/electron/canonical-library-reader.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
