# Design System

## Scope

- SPCBoy renderer layout and visual hierarchy.

## Invariants

- Use `1rem` as the standard gap, padding, and margin unit inside Options panels. Use smaller spacing only for compact inline controls whose parent already supplies the panel rhythm.
- Keep surface hierarchy explicit: sidebars and input fields use `rgb(20 20 20)`; chrome and first nested rows use `rgb(30 30 30)`; primary content panels use `rgb(40 40 40)`; deeper nested panels use `rgb(50 50 50)`.
- Tool buttons use `rgb(40 40 40)` and the same 6px radius as library path panels.
- The renderer has no bundled SF Symbols/icon font; compact actions use Unicode glyphs with `title` and `aria-label` text, while native macOS SF Symbols would require a native view or bundled assets.
- Options sidebar and content panel fill the available window height.
- A library root row is one compact line: checkbox, health dot, existing folder name, successful-file total in parentheses, and glyph actions. Detailed scan totals belong in the Scan Log header.

## Files

- `web/styles.css`
- `web/app-ui.js`
