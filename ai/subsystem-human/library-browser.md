# Library Browser

## Display

- Browser: recursive folder tree under the current library root.
- Browser: hidden dot-folders are omitted.
- Browser: selected-folder ancestors stay visible.
- Folders view: opening a folder, file, or dropped path returns the sidebar to the raw recursive folder browser and selects the opened folder. Enabled configured library paths populate this view at startup.

## Search

- Search: is a temporary third view that returns the same indexed game results whether Folders or Database was selected. Clearing it restores the prior view.
- Search: Console View groups those results when enabled.
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

- Options: use the Library section to add configured library folders.
- Options: enable or disable configured library folders.
- Options: configured folders are listed alphabetically; delete them or rescan one folder.
- Options / Library: select configured folders with checkboxes and use `Scan Selected`; selected roots are scanned sequentially and only one library operation may run at a time.
- Scan: ordinary scans reuse completed unchanged sources; Deep Scan rechecks them. Failed or incomplete sources are retried automatically.
- Scan Status: live status shows compact progress and success/error counts; Cancel is available only while a scan or Test Files operation is active, and Log opens error details.
- Test Files: checks indexed source-path existence without rescanning metadata. Missing sources are hidden from the active library until rediscovered or removed with Clear Unlinked.
- Options / Database: shows library and archive-cache statistics. Archive Cache can be retained for repeat playback, disabled for disposable playback materialization, sized to a selected automatic limit, or cleared while playback is stopped.
- Database: ZIP-, 7z-, RSN-, and TZST-contained supported audio files appear as playable indexed tracks, including expanded internal songs from multi-track NSF and GBS files.
- Database mode: a game leaf previews its indexed tracks on selection, while console headings are expandable/collapsible and activate only with Enter or double-click. Console headings use a recognized collection tag such as `[PS1]`, then the nearest recognized collection folder by default; Prefer Embedded Console Tags reverses that priority. Same-title games from separate library paths remain distinct and load only that root's indexed tracks.
- Database mode: single-click preview is delayed just long enough to distinguish a double-click, so activation issues one track query instead of previewing and immediately loading the same game again. Database read/search/activation failures remain visible below the existing game list.
- During a scan, the Database sidebar continues showing the last completed library. A cancelled or failed scan discards the staged tracks, search rows, outcomes, and discovered-source set; scan status still records that the attempt started and, for a failure, its error.
- Console View: database games are grouped under expandable console headings by default, while the option can flatten the list without changing search or activation behavior.
- View toggle: one icon button switches between Folders and Database; search results remain unchanged while a query is active.
- Playback Options: App Volume controls SPCBoy output only; Equalizer exposes ten shared 31 Hz–16 kHz parametric bands at ±12 dB and applies to renderer and native playback paths.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
