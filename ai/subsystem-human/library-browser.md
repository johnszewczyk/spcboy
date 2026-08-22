# Library Browser

## Display

- Disk Path: recursive folder tree under the current user-selected local root.
- Browser: hidden dot-folders are omitted.
- Browser: selected-folder ancestors stay visible.
- Paths: a catalog-only `library root → stored folder → stored source file` tree read from MediaScanner's `file_sidebar_buckets` projection. It never enumerates the live filesystem.
- Consoles: the catalog game index grouped under expandable console headings.
- Disk Path: opening a folder, file, or dropped path selects the raw recursive local browser. It is independent from the catalog views.
- Sidebar views: Paths, Consoles, and Disk Path are available from the sidebar's view icon and the macOS Sidebar menu with Command-1, Command-2, and Command-3. File > Open Path (Command-O) chooses the Disk Path root.

## Search

- Search: temporarily shows indexed catalog game results from either catalog view. Clearing it restores Paths, Consoles, or Disk Path.
- Search: results are grouped under console headings.
- Search: Enter and list-edge navigation act on visible catalog results even when Paths or Disk Path is the covered underlying view.
- Search: does not interrupt playback.

## Selection

- Single-click: folders select/fold without changing the playlist. A dotted leaf file or archive replaces the playlist with its playable contents without starting playback.
- Activation: Enter or double-click sends the selected folder, file, or archive contents to the playlist and starts the first resulting track.
- Sidebar context menu: Show in Finder, Play Now, or Queue; Queue appends the selected folder/file/archive content to the current playlist.

## Root Selection

- Disk Path root: choose a folder or file through File > Open Path.
- Library root: drag a folder, supported audio file, or ZIP/7z/RSN/TZST/TAR.ZST archive onto SPCBoy to open it.
- File selection: uses the containing folder as the library root.
- Root and selected folder: restore between launches.

## Library Index

- SPCBoy reads library roots, game buckets, tracks, and metadata from the shared MediaScanner schema-23 catalog through a read-only SQLite connection, without creating, migrating, or writing it.
- Options / Database selects and validates the catalog path, shows library and archive-cache statistics, and reports when restart is required. Archive Cache remains SPCBoy-owned playback state and can still be configured or cleared while playback is stopped.
- Options / Library shows the catalog's configured roots. Root mutation, scans, Test Files, and destructive database maintenance are disabled because MediaScanner is the sole catalog-writer boundary.
- Database: ZIP-, 7z-, RSN-, and TZST-contained supported audio files appear as playable indexed tracks, including expanded internal songs from multi-track NSF and GBS files.
- Consoles: a game leaf previews its indexed tracks on selection, while console headings are expandable/collapsible and activate only with Enter or double-click. Console headings use a recognized collection tag such as `[PS1]`, then the nearest recognized collection folder by default; Prefer Embedded Console Tags reverses that priority. Known aliases are normalized after source selection. A recognized terminal console tag is omitted from an archive game name, while unrelated suffixes such as `[USA]` remain. Same-title games from separate library paths remain distinct and load only that root's indexed tracks.
- Database mode: single-click preview is delayed just long enough to distinguish a double-click, so activation issues one track query instead of previewing and immediately loading the same game again. Database read/search/activation failures remain visible below the existing game list.
- Console grouping: catalog games are always grouped under expandable console headings; there is no flat-list option. Grouping does not change search or activation behavior.
- Natural ordering: catalog names use numeric-aware ordering, so `Track 9` precedes `Track 10`.
- Playback Options: App Volume controls SPCBoy output only; Equalizer exposes ten shared 31 Hz–16 kHz parametric bands at ±12 dB and applies to renderer and native playback paths.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/catalog-reader-client.js](/Users/john/Downloads/Code/SPCBoy/electron/catalog-reader-client.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
