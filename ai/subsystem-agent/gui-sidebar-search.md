# GUI Sidebar Search

## Scope

- Sidebar search field.
- Renderer-side tree filtering.
- Search-result visibility behavior.

## Ownership and Invariants

- A non-empty query is a temporary third sidebar view and always searches indexed game buckets, regardless of the stored Folders/Database mode.
- `sidebar-view-state.js` is the production effective-view owner and executes the shared CocoaSpice/SPCBoy search-view contract. Rendering, Enter fallback, and Home/End navigation consult its database content mode while Search covers the stored mode.
- The renderer filters loaded game buckets immediately, then replaces that optimistic result with the debounced FTS-complete result from enabled roots. The latest-request broker runs the active query and only the newest waiter.
- Search results are always grouped under console headings. Clearing the query restores the stored underlying view and its disclosure state.
- Search itself does not interrupt playback.

## Critical Engineering Notes

- Keep the optimistic game-bucket filter renderer-side and the complete query behind its narrow preload/database boundary.
- Do not turn search into a filesystem rescan per keystroke.
- Do not branch search results on the underlying Folders/Database mode.

## Files

- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/sidebar-view-state.js](/Users/john/Downloads/Code/SPCBoy/web/sidebar-view-state.js)
- [main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [canonical-library-reader.js](/Users/john/Downloads/Code/SPCBoy/electron/canonical-library-reader.js)
- [latest-request-coalescer.js](/Users/john/Downloads/Code/SPCBoy/electron/latest-request-coalescer.js)
- [Cross-app search-view fixture](/Users/john/Downloads/Code/SPCBoy/test/cross-app-sidebar-search-view-v1.json)
- [Sister-app conformance contract](/Users/john/Downloads/Code/DocMan/Docs/cocoaspice-spcboy-conformance.md)
