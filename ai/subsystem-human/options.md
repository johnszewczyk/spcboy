# Options

## Library

- Library is a read-only catalog status page. It lists roots and stored scan health supplied by the shared canonical database.
- Roots and scanner controls are read-only in SPCBoy. Add, enable, delete, Scan Selected, Deep Scan, Test Files, Clear Unlinked, and Clear Database are disabled; MediaScanner is the catalog writer.
- Scan Log displays diagnostics already stored with a catalog root. SPCBoy does not start or contain a JavaScript catalog scanner.
- Archive Cache: Options / Database shows its size and file count, offers a 512 MB–4 GB automatic LRU limit (2 GB by default), and can disable durable playback caching entirely. Cache-off playback materializations are deleted on Stop and abandoned playback scratch roots are recovered at launch; MediaScanner scratch is separate.

## Database

- Library Database displays the configured canonical `Library.sqlite` path. Browse uses the native file picker and MediaScanner schema validation; Use Default selects CocoaSpice's Application Support catalog. A changed location applies after restart.
- The active catalog is opened through an OS-level read-only SQLite handle with query-only mode. Indexed/unlinked statistics remain readable, while destructive maintenance is unavailable in SPCBoy.

## Playback

- Long Play: set a manual playback duration for every supported format.
- Fade Out: enable or disable the fade duration for every supported format.
- Play Speed: libgme supports SPC, NSF/NSFE, GBS, HES, KSS, AY, and SAP; libvgm supports GYM, S98, VGM, and VGZ. Each encoder has an independent enable control and accepts an exact decimal such as `1.25` or a fraction such as `5/4`.
- Play Speed: editing a disabled encoder's speed stores the next value without interrupting playback; enabling it applies the setting only when that encoder owns the active track.
- Queued Skips: the first skip starts the configured fade from the current playback position; another skip while that temporary fade is active advances at once. Long Play only changes normal playback duration and never changes the skip target.
- Play Stats: the dedicated panel shows live native transport, track/output state, position, buffer frames and fill, underruns, requested/supplied frames, and decode status. It remains connected when Options is open in its separate window.
- Equalizer: the app volume control is grouped with the ten EQ bands as a full-width slider; EQ frequency and dB labels use the system fixed-width font, and range controls use a short 125ms eased visual transition for click-snapped movement. The lower toolbar has a synchronized sliders-icon toggle to enable or disable EQ without opening Options.
- Play Time descriptions: Long Play is documented as “Loop song with original format control.” Fade Out is documented as “Apply transitional volume fade to song end.” Play Speed identifies each compatible encoder and accepts exact decimal or fractional input.
- Volume shortcuts: app-level `-` and `=` keys lower or raise volume by 5% when focus is not in a text editor.
- Playback: Volume and Equalizer are separate level-one panels, with Volume first.
- Options panel headers use the configured accent color.

## Routing

- Routing: lists decoder/plugin extension conflicts from the shared playback registry. The current registry has no overlapping extensions.
- Routing policy: for a real overlap, choose the SPCBoy playback decoder per extension. Selecting the first declared candidate means “use the registry default.” MediaScanner owns catalog routing independently.

## Theme

- Theme: combines the former Sidebar and Playlist appearance controls. The Options navigation is alphabetized as Database, Library, Playback, Routing, and Theme.
- Theme / Application: Accent Color accepts standard CSS color syntax, including named colors, hexadecimal values, `rgb()`, `hsl()`, and modern color functions supported by the browser. Application Monospace Font changes app chrome text to the system monospace font.
- Theme / Sidebar: independently adjust font size, font color, monospace mode, sidebar width, and Console View. The console-tag source control is disabled in query-only catalog mode because MediaScanner must own any stored grouping rewrite.
- Theme / Playlist: independently adjust font size, font color, monospace mode, bold header font, and item spacing.
- Console View: enables console-grouped database game headings in the main sidebar.

## Window

- Options: opens in a native child 800 by 600 pixel window with alphabetized Database, Library, Playback, Routing, and Theme sections; focusing it raises only that requested window, avoiding focus churn among auxiliary windows.
- Options: shows its dark native shell immediately and loads settings/library controls without enumerating the persisted raw folder tree.
- Library paths: each row shows its stored scan-health color dot, folder name, successful-file total, and Scan Log action. No root mutation or scan action is exposed.
- Scan Log: the header contains the pathname and all scan totals/status data; the body contains the selectable error-only log.

## Files

- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
