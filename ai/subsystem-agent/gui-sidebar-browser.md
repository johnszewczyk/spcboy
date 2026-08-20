# GUI Sidebar Browser

## Scope

- Recursive folder tree.
- Folder selection.
- Tree expansion and selection visibility.

## Ownership and Invariants

- The sidebar tree is a lazy file browser: the current root is the top-level node, folders load their immediate children when expanded, and supported files appear as file nodes beneath their parent.
- Opening or dropping a path explicitly selects the Folders view and clears a persisted Database-view selection so the raw folder browser is visible.
- One sidebar toolbar button toggles the stored Folders/Database mode and changes its icon to the destination view. A non-empty search remains visually authoritative until cleared.
- The Folders snapshot enumerates immediate directories and supported files without metadata inspection; selecting a folder for activation lists only its direct supported files and archive members.
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
- Console grouping uses only the already-loaded root-scoped database game rows; it must not trigger another database query. Sidebar matching uses the loaded game title and compact root name, not live filesystem work.
- Keep console-group row construction separate from archive playlist hydration; changing a database view must not materialize archive members.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
