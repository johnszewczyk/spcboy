# GUI Sidebar Browser

## Scope

- Catalog Paths tree, Consoles index, and Disk Path tree.
- Folder selection.
- Tree expansion and selection visibility.

## Ownership and Invariants

- Paths reads MediaScanner's indexed `file_sidebar_buckets` into an in-memory tree. It is never a filesystem enumeration.
- Consoles reads the compact catalog game index and groups rows under console headings.
- Disk Path is the lazy raw file browser: the current local root is the top-level node, folders load their immediate children when expanded, and supported files appear beneath their parent.
- Opening or dropping a path explicitly selects Disk Path so the raw browser is visible.
- The sidebar view icon opens a native menu for Paths, Consoles, and Disk Path. The application Sidebar menu binds those views to Command-1, Command-2, and Command-3; File > Open Path remains Command-O.
- The Disk Path snapshot enumerates immediate directories and supported files without metadata inspection; selecting a folder for activation lists only its direct supported files and archive members.
- Hidden dot-folders are skipped.
- A single click on a folder selects and toggles only its disclosure state. A single click on a final leaf file/archive replaces the playlist with that leaf's playable content, without starting playback.
- Double-clicking or pressing Enter on a folder sends that folder's direct supported contents to the playlist; doing so on a file sends that file (or archive's playable members) to the playlist.
- Browser activation replaces the playlist and starts the first resulting track; the sidebar's Enter handler consumes the event before the global playlist shortcut.
- Space toggles the selected folder's expanded state without loading or playing it.
- Single-click browser navigation does not stop or replace an active playback session; explicit activation replaces the playlist and starts the selected target.
- The sidebar context menu offers Show in Finder, Play Now, and Queue. Queue appends unique tracks while preserving the active transport session.
- Selecting a folder rerenders the tree so its expanded/collapsed directory state and selected node stay synchronized with the playlist.
- OS file drops route through the main-process path resolver; unsupported dropped files are rejected before opening.
- Sidebar branches expand to keep the selected folder visible.
- The renderer auto-expands ancestors of the selected folder and keeps it scrolled into view.
- The sidebar/playlist boundary is a 1px `rgb(30 30 30)` drag handle with a wider invisible hit target. Dragging updates the CSS width directly; it persists on release without rebuilding the sidebar or playlist.
- Main-window startup and raw-tree refresh restore browser state without constructing a playlist. Playlist/archive enumeration is reserved for explicit folder/file activation, keeping large roots from blocking the initial UI.
- Direct NSF, GBS, AY, HES, KSS, NSFE, and SAP activation enumerates internal tracks before publishing the playlist; this is structural enumeration, not background display-only metadata hydration.

## Critical Engineering Notes

- Treat a branch click as browser selection/folding only. A final leaf click previews its playable content; only double-click, Enter, or an explicit context action starts playback.
- Keep playlist scope per selected folder unless the app explicitly changes that model.
- Keep tree rendering aligned with the renderer-owned in-memory tree shape.
- Console grouping uses only the already-loaded root-scoped catalog game rows; it must not trigger another database query. Sidebar matching uses the loaded game title and compact root name, not live filesystem work.
- Paths activation queries stored source identities by `root_id + path`; folder activation queries only descendant source identities. Neither path may fall back to a live scan.
- Apply numeric-aware comparison to visible catalog and path segments. SQLite's lexical order is not the UI ordering contract.
- Keep console-group row construction separate from archive playlist hydration; changing a database view must not materialize archive members.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
