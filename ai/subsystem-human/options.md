# Options

## Library

- Library: opens as the default Options section. Library Paths, Scan Options, and Scan Status are equal top-level panels, using the same panel treatment as Playlist.
- Roots: configured library paths are listed alphabetically with a single-line Add Folder, Select All, Scan Selected, and Test Files bar; each root has distinct Scan, scan-log, and Delete SVG icon controls.
- Scan log: the root row shows one-line success/error counts; Log opens only errored file lines.
- Test Files: checks each unique indexed loose-file or archive source path, then removes tracks whose source no longer exists without reopening archives or reading metadata.
- Test Files: updates each affected root's displayed file and track counts after pruning missing sources, while leaving the root marked for attention.
- Scan and Test Files: show live progress and expose Cancel while work is running; cancelling preserves the previously committed index.
- Scan status: after the first library operation begins, a level-one status panel appears at the end of the Library page with a one-line summary, current path on its own line, an eased show/hide progress bar, and a full-width Cancel Scan button. The summary includes active scan-scratch roots and bytes plus startup recovery totals; completed scans retain the scratch peak.
- Startup recovery: SPCBoy removes abandoned disposable scan-scratch roots before allowing a new scan and reports reclaimed roots and bytes. This never clears the playback archive cache.
- Archive Cache: Options / Database shows its size and file count, offers a 512 MB–4 GB automatic LRU limit (2 GB by default), and can disable durable playback caching entirely. Cache-off playback materializations are deleted on Stop and abandoned playback scratch roots are recovered at launch; neither mode turns scanner scratch space into a cache.
- Deep Scan: scans the selected library folders while bypassing unchanged-file and unchanged-archive reuse, updating existing records; ordinary Scan Selected retains complete reusable records.
- Per-root scanning: replaces the root's prior scan readout with a 100px progress bar and current/total count while that root is active.
- Root health: a leading status dot starts the second row; green means the latest scan was clean and orange means errors or a pruned index need attention.

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
- Routing policy: for a real overlap, choose the decoder per extension. Selecting the first declared candidate means “use the registry default.” The scanner and playback deliberately share that selected route.

## Theme

- Theme: combines the former Sidebar and Playlist appearance controls. The Options navigation is alphabetized as Database, Library, Playback, Routing, and Theme.
- Theme / Application: Accent Color accepts standard CSS color syntax, including named colors, hexadecimal values, `rgb()`, `hsl()`, and modern color functions supported by the browser. Application Monospace Font changes app chrome text to the system monospace font.
- Theme / Sidebar: independently adjust font size, font color, monospace mode, sidebar width, and Console View.
- Theme / Playlist: independently adjust font size, font color, monospace mode, bold header font, and item spacing.
- Console View: enables console-grouped database game headings in the main sidebar.

## Window

- Options: opens in a native child 800 by 600 pixel window with alphabetized Database, Library, Playback, Routing, and Theme sections; it overlays SPCBoy's main window but does not stay above unrelated applications.
- Options: shows its dark native shell immediately and loads settings/library controls without enumerating the persisted raw folder tree.
- Library paths: each row has an enable checkbox, scan-health color dot, existing folder name, successful-file total in parentheses, and Scan, Log, and Delete glyph buttons.
- Scan Log: the header contains the pathname and all scan totals/status data; the body contains the selectable error-only log.

## Files

- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
