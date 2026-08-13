# Project Info

## Product

- `SPCBoy` is now an Electron desktop app with a web renderer UI.
- Audio playback uses a registered backend system with libgme, libvgm, lazyusf2, Highly Complete, OpenMPT, standard audio, 2SF, vgmstream, and Play! PSF modules, plus content-based Nintendo DS WAV payload routes.
- The active product shape is:
  sidebar browser,
  selected-folder playlist,
  bottom transport/progress bar,
  separate Options window,
  renderer-owned playback.

## Major Components

- Main shell, sidebar, and bottom transport UI.
- Selected-folder playlist and column behavior.
- Sidebar browser, search, and root selection.
- Native-helper playback, transport, and timing.
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

- Sister-app behavioral conformance with CocoaSpice: [cocoaspice-spcboy-conformance.md](/Users/john/Downloads/Code/DocMan/Docs/cocoaspice-spcboy-conformance.md)
- Sister-app scanner architecture, policy, and remaining validation: [cocoaspice-spcboy-scanner-investigation.md](/Users/john/Downloads/Code/DocMan/Docs/cocoaspice-spcboy-scanner-investigation.md)
- Main shell and runtime: [gui-main-shell.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-main-shell.md), [build-runtime-bundle.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/build-runtime-bundle.md)
- Sidebar and root ownership: [gui-sidebar-browser.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-sidebar-browser.md), [gui-sidebar-search.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-sidebar-search.md), [library-root-selection.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/library-root-selection.md), [library-browser-database.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/library-browser-database.md)
- Library scan and archive lifecycle: [library-scan-lifecycle.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/library-scan-lifecycle.md)
- Playlist ownership and display: [gui-playlist-core.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-playlist-core.md), [gui-playlist-columns.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/gui-playlist-columns.md)
- Playback streaming, transport, and timing: [audio-playback-streaming.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/audio-playback-streaming.md), [audio-playback-transport.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/audio-playback-transport.md), [audio-playback-timing.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/audio-playback-timing.md)
- Shared playback lifecycle and transition ownership: [playback-coordinator.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/playback-coordinator.md)
- Renderer state and persistence: [app-state-persistence.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/app-state-persistence.md)

## Local Rules

- Launch through `./launch.sh`.
- `./launch.sh` stages a fresh launch bundle on every run.
- Format admission and decoder selection are owned by the shared backend registry. Route playback work through the Playback and Audio Playback Streaming notes rather than duplicating its extension list here.
- Persisted settings live in renderer `localStorage`.
- Metadata and scan intake route through the backend registry; native-session families use the native buffered transport, while OpenMPT and standard audio use the renderer-PCM chunk scheduler.
- Nintendo DS `SWAV` and headerless raw `_NN.wav` files are admitted by the standard `.wav` scanner entry and retain their special decoder kind through archive scans and the database.
- Human subsystem notes describe only what users can see and do.
- Agent subsystem notes describe only current engineering constraints and ownership facts.

## Human Docs

- `Docs/` is the human-side folder.
- `Docs/` is not default intake.
