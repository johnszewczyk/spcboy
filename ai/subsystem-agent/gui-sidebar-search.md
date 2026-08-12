# GUI Sidebar Search

## Scope

- Sidebar search field.
- Renderer-side tree filtering.
- Search-result visibility behavior.

## Ownership and Invariants

- Sidebar search filters the already-built renderer tree rather than rescanning disk.
- Search matches folder names and preserves ancestors of matching nodes.
- A non-empty query forces visible expansion so matching subtrees are shown without extra clicks.
- Folder View updates its local tree immediately, then debounces the indexed FTS descendant query. The main-process latest-request broker runs the active query and only the newest waiter, so pauses during rapid typing cannot build an obsolete SQLite queue.
- Database mode preserves the shared query while switching views. It immediately filters loaded game buckets, then replaces that optimistic result with the FTS-complete matching buckets.
- Search itself does not interrupt playback.

## Critical Engineering Notes

- Keep local sidebar filtering renderer-side. Indexed Folder-view descendant search stays behind its narrow preload/database boundary and is scoped to the active Folder root.
- Folder indexed-search failures remain visible in the sidebar; do not reduce them to console-only diagnostics or an ordinary empty result.
- Do not turn search into a filesystem rescan per keystroke.
- Keep search behavior aligned with the renderer tree model.

## Files

- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [latest-request-coalescer.js](/Users/john/Downloads/Code/SPCBoy/electron/latest-request-coalescer.js)
