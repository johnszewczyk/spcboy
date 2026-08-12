# Main Shell

## Display

- Window: left sidebar, right playlist, and bottom transport bar.
- Development build: `launch.sh` produces a self-consistent `SPCBoy.app` bundle whose `CFBundleExecutable` and executable file are both named `SPCBoy`.
- Sidebar: search field and folder tree.
- Sidebar selection: a final file/archive leaf previews its playable contents in the playlist; folders only unfold on selection and require Enter or double-click to load and play their contents.
- Playlist: tracks from the selected folder. Its Path column starts with the configured library root’s name, then the relative path (for example, `JoshW/3DO/...` and archive `#member` suffixes), never the machine-specific absolute source path.
- Bottom bar: individually pill-shaped Previous, Play/Pause, Next, Equalizer, Long Play, and Repeat controls use consistent Lucide SVG icons. Equalizer is a direct on/off toggle synchronized with Playback settings; Long Play, Repeat, and Equalizer brighten with the same selected 30-to-40 RGB fill as the Folder/Database view buttons. The progress slider is a flat 2 px rail with a small circular thumb and uniform control padding.
- Clock: the elapsed, track, and playlist time readout—including its separators—uses the system fixed-width font.
- Selection: Sidebar and playlist selection highlights are each a single rounded accent bar that moves to the selected row with a 100 ms eased transition, without animating row text.
- Options: separate native child window; it stays above SPCBoy's main window without staying above unrelated applications.
- Window focus: app activation restores the requested SPCBoy window only; the focused window remains the active keyboard target and auxiliary windows do not churn focus.
- About: the macOS application menu opens a dependency and license page listing bundled playback cores, runtime tools, versions, licenses, and upstream links where known.

## Persistence

- Options: Theme owns persisted Application, Sidebar, and Playlist typography, Sidebar width and Console View, Playlist item spacing, and Accent Color.

## Files

- [web/index.html](/Users/john/Downloads/Code/SPCBoy/web/index.html)
- [web/styles.css](/Users/john/Downloads/Code/SPCBoy/web/styles.css)
