# Project Info

## Product

`SPCBoy` is an Electron desktop app with a web renderer UI. It reads the shared MediaScanner
catalog, owns its playlist and presentation, and sends all admitted playback through the bundled
VGMBoy bridge.

## Major Components

- Main shell, sidebar, and bottom transport UI.
- Selected-folder playlist and column behavior.
- Sidebar browser, search, and root selection.
- VGMBoy bridge playback, transport, and timing.
- Renderer settings persistence and playback-state ownership.
- Build, launch, and helper runtime packaging.

## Task Routing

Human-facing behavior:

- Main shell: [main-shell.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-human/main-shell.md)
- Playlist: [playlist.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-human/playlist.md)
- Library browser: [library-browser.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-human/library-browser.md)
- Playback: [playback.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-human/playback.md)
- Options: [options.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-human/options.md)

Agent engineering notes:

- Main shell and runtime: [gui-main-shell.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-main-shell.md), [build-runtime-bundle.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/build-runtime-bundle.md)
- Sidebar and root ownership: [gui-sidebar-browser.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-sidebar-browser.md), [gui-sidebar-search.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-sidebar-search.md), [library-root-selection.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/library-root-selection.md), [library-browser-database.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/library-browser-database.md)
- Shared scanner boundary and playlist media intake: [media-intake-lifecycle.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/media-intake-lifecycle.md)
- Playlist ownership and display: [gui-playlist-core.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-playlist-core.md), [gui-playlist-columns.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-playlist-columns.md)
- Shared playback lifecycle and transition ownership: [playback-coordinator.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/playback-coordinator.md)
- Shared playback core and decoder boundary: [audio-playback-streaming.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/audio-playback-streaming.md)
- Renderer state and persistence: [app-state-persistence.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/app-state-persistence.md)

## Local Rules

- Launch through `./launch.sh`.
- `./launch.sh` stages a fresh launch bundle on every run.
- Format admission and decoder selection are owned by the shared backend registry. Route playback work through the Playback and Audio Playback Streaming notes rather than duplicating its extension list here.
- Persisted settings live in renderer `localStorage`.
- Playlist metadata comes from the loaded MediaScanner catalog; raw disk browsing is pathname-only.
  Every admitted playback source uses the bundled VGMBoy bridge and its native buffered transport.
- Nintendo DS `SWAV` and headerless raw `_NN.wav` files are admitted by the standard `.wav` playlist route and retain their special decoder kind through playback inspection.
- Human subsystem notes describe only what users can see and do.
- Agent subsystem notes describe only current engineering constraints and ownership facts.

## Human Docs

- `Docs/` is the human-side folder.
- `Docs/` is not default intake.
