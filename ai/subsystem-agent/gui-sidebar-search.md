# GUI Sidebar Search

## Scope

- Sidebar search field.
- Renderer-side tree filtering.
- Search-result visibility behavior.

## Current State

- Sidebar search filters the already-built renderer tree rather than rescanning disk.
- Search matches folder names and preserves ancestors of matching nodes.
- A non-empty query forces visible expansion so matching subtrees are shown without extra clicks.
- Search currently updates immediately on input rather than using a debounce.
- Database-mode rows are built once per loaded database result set; keystrokes update row visibility and selection state in place.
- Search itself does not interrupt playback.

## Rules

- Keep sidebar search renderer-side unless there is a strong reason to push it into Electron.
- Do not turn search into a filesystem rescan per keystroke.
- Keep search behavior aligned with the renderer tree model.

## Files

- [web/app.js](/Users/john/Downloads/Code/SPCBoy/web/app.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
