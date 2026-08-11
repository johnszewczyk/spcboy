# Library Browser

## Display

- Browser: recursive folder tree under the current library root.
- Browser: hidden dot-folders are omitted.
- Browser: selected-folder ancestors stay visible.
- Folders view: opening a folder, file, or dropped path returns the sidebar to the raw recursive folder browser and selects the opened folder. Enabled configured library paths populate this view at startup.

## Search

- Search: finds indexed file names, archive entries, and scanned tags even when their Folder-view branch has not yet been opened, then shows the matching path and source under its ancestors.
- Search: expands matching branches automatically.
- Search: does not interrupt playback.

## Selection

- Folder selection: loads only that folder's direct audio files and playable archive members into the playlist; descendants remain available through their own folder rows.
- Single-click: folders select/fold. A dotted leaf file or archive replaces the playlist with its playable contents without starting playback. Double-click or Enter replaces the playlist and starts the first resulting track.
- Sidebar context menu: Show in Finder, Play Now, or Queue; Queue appends the selected folder/file/archive content to the current playlist.

## Root Selection

- Library root: choose a folder or file through the native open dialog.
- Library root: drag a folder, supported audio file, or ZIP/7z/RSN/TZST/TAR.ZST archive onto SPCBoy to open it.
- File selection: uses the containing folder as the library root.
- Root and selected folder: restore between launches.

## Library Index

- Options: use the Library section to add configured library folders.
- Options: enable or disable configured library folders.
- Options: configured folders are listed alphabetically; delete them or rescan one folder.
- Options / Library: select configured folders with checkboxes and use `Scan Selected`; selected roots are scanned sequentially and only one library operation may run at a time.
- Options: repeat scans reuse unchanged indexed files and archive members when their source fingerprint and archive listing are unchanged.
- Deep Scan: the Library page exposes a checkbox that forces re-analysis of selected roots, including archives whose saved completion and source fingerprints are unchanged.
- Retained records: completed scan records remain available when their source path becomes unlinked; Test Files marks them and Clear Unlinked removes them.
- Options: show throttled scan progress and compact scan success/error counts; Cancel is enabled only for a live scan or Test Files operation and settles disabled when that operation completes or cancels. Open Log for error-only file details.
- Options: scan progress updates only the status panel, so the active playlist and sidebar remain responsive during large scans.
- Headerless `.ss2` resources are recorded as unsupported rather than reported as decoder failures; valid SSHD `.ss2` files remain routed through vgmstream.
- Scan Log: opens a selectable, copyable monospace 8 pt error log; use Copy, the close button, Escape, click the backdrop, or Command/Ctrl-W to dismiss it without closing Options.
- Options: Test Files checks indexed source-path existence only, immediately removes missing sources from the active playlist/database view, and retains them as unlinked database records without a metadata rescan.
- Ordinary scans reuse only successfully completed unchanged records. Incomplete or failed files are retried automatically; Deep Scan deliberately rechecks every source.
- Options / Database: shows indexed-track, unlinked-source, unlinked-track, and archive-cache statistics.
- Options / Database / Archive Cache: `Keep Archive Cache` retains recently played archive members for fast repeat playback. It defaults to a 2 GB limit and automatically removes least-recently-used entries; the track currently playing is protected. Disabling it uses a disposable archive file that is removed when playback stops. `Clear Cache` removes retained entries when playback is stopped.
- Database: ZIP-, 7z-, RSN-, and TZST-contained supported audio files appear as playable indexed tracks, including expanded internal songs from multi-track NSF and GBS files.
- Database mode: search filters the loaded game list immediately without rescanning the library; a game leaf previews its indexed tracks on selection, while console headings are expandable/collapsible and activate only with Enter or double-click. The same game and console from separate library paths remains separate, shows its compact source-root name only when needed, and loads only that root's indexed tracks.
- Console View: database games are grouped under expandable console headings by default, while the option can flatten the list without changing search or activation behavior.
- Playback Options: App Volume controls SPCBoy output only; Equalizer exposes ten shared 31 Hz–16 kHz parametric bands at ±12 dB and applies to renderer and native playback paths.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
