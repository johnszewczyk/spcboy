# Design System

## Scope

- SPCBoy renderer layout and visual hierarchy.

## Invariants

- Use `1rem` as the standard gap, padding, and margin unit inside Options panels. Use smaller spacing only for compact inline controls whose parent already supplies the panel rhythm.
- Keep surface hierarchy explicit: sidebars and input fields use `rgb(20 20 20)`; chrome and first nested rows use `rgb(30 30 30)`; primary content panels use `rgb(40 40 40)`; deeper nested panels use `rgb(50 50 50)`.
- Tool buttons use `rgb(40 40 40)` and the same 6px radius as library path panels.
- The renderer uses a bundled Lucide SVG symbol sprite for compact actions, with `title` and `aria-label` text preserved for accessibility. Do not introduce one-off Unicode glyphs or a second icon family.
- Options sidebar and content panel fill the available window height.
- A MediaScanner root row is one compact read-only line: health dot, folder name, successful-file total, and the stored Scan Log action.

## Files

- `web/styles.css`
- `web/app-ui.js`
