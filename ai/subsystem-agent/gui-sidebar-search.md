# GUI Sidebar Search

## Scope

- Sidebar search field.
- Renderer-side tree filtering.
- Search-result visibility behavior.

## Ownership and Invariants

- Sidebar search filters the already-built renderer tree rather than rescanning disk.
- Search matches folder names and preserves ancestors of matching nodes.
- A non-empty query forces visible expansion so matching subtrees are shown without extra clicks.
- Folder View updates its local tree immediately, then debounces the indexed FTS descendant query. This prevents stale keystroke searches from queuing ahead of the final query in the SQLite worker.
- Database mode preserves the shared query while switching views. It immediately filters loaded game buckets, then replaces that optimistic result with the FTS-complete matching buckets.
- Search itself does not interrupt playback.

## Critical Engineering Notes

- Keep local sidebar filtering renderer-side. Indexed Folder-view descendant search stays behind its narrow preload/database boundary and is scoped to the active Folder root.
- Do not turn search into a filesystem rescan per keystroke.
- Keep search behavior aligned with the renderer tree model.

## Files

- [web/app.js](/Users/john/Downloads/Code/SPCBoy/web/app.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
