# GUI Main Shell

## Scope

- Main Electron window layout.
- Sidebar and content-region roles.
- Bottom transport and progress bar.
- Options window placement.

## Ownership and Invariants

- The window is a two-region layout with a left sidebar and right content area.
- The sidebar runs full height and contains the search field and recursive folder tree.
- The main content area contains the explicitly activated folder/file playlist; restoring a large browser root does not eagerly enumerate it into the playlist.
- The bottom bar holds previous, play-pause, next, a progress slider, and elapsed or total readout.
- Options open in a separate native window rather than an inline drawer.
- Options are a separate 800 by 600 native child BrowserWindow parented to the main window; it stays above SPCBoy's main window without system-level always-on-top behavior. The main, Options, and About windows are restored and raised together when the app is activated or any app window gains focus.
- Theme owns persisted sidebar/playlist appearance controls and the shared CSS Accent Color. Accent values are validated by the renderer with `CSS.supports("color", value)` and broadcast to the other app window through the narrow appearance IPC surface.
- Options navigation order is alphabetical: Database, Library, Playback, Routing, Theme.

## Critical Engineering Notes

- Treat the Electron window and web renderer as the active UI implementation.
- Keep layout notes aligned with `web/index.html` and `web/styles.css`.
- If controls move between sidebar, playlist, Options window, or bottom bar, update this file.

## Files

- [web/index.html](/Users/john/Downloads/Code/SPCBoy/web/index.html)
- [web/styles.css](/Users/john/Downloads/Code/SPCBoy/web/styles.css)
- [web/app.js](/Users/john/Downloads/Code/SPCBoy/web/app.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
