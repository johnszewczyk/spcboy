# Audio Playback Transport

## Scope

- Previous, play-pause, and next controls.
- Progress-slider seek behavior.
- Electron shortcuts and Media Session transport.

## Ownership and Invariants

- Bottom-bar transport exposes previous, play-pause, and next.
- Double-clicking a playlist row starts playback.
- `Enter` plays the selected row.
- Focused-window `F7`, `F8`, and `F9` are handled in both the renderer and Electron.
- Electron shortcuts map to previous, play-pause, and next.
- Media Session handlers advertise play, pause, next, and previous when supported.
- The progress slider rebuilds playback from the requested offset.
- Native playback telemetry is broadcast to both the main renderer and the separate Options renderer. The Options renderer must retain and display snapshots even when it has no local playlist track.
- Transport requests are valid only for the current visible playlist. A stale track ID must be dropped rather than falling back to the previous playlist's `currentTrackInfo`; asynchronous database-view loads are generation-guarded before replacing the visible playlist.
- Queued Skips are a temporary transition, not a seek: the first skip applies the configured output fade to the live current track and advances by the requested delta only after that fade ends. A second skip ends the already-live source with the short de-click envelope and advances immediately. Never reload or seek a tail solely to create a queued-skip fade. Long Play affects only the ordinary duration calculation.

## Critical Engineering Notes

- Keep transport behavior aligned across renderer controls, Electron shortcuts, and Media Session.
- Keep progress-slider seeking aligned with helper playback state.
- If helper transport commands change, update the renderer and Electron bridge together.

## Files

- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [web/app.js](/Users/john/Downloads/Code/SPCBoy/web/app.js)
