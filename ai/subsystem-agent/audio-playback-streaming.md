# Audio Playback Streaming

## Scope

- The one bundled playback core and its narrow Electron client.
- Device-output and transport ownership.
- Raw disk subtrack structure, not catalog metadata.

## Ownership and invariants

- `vgmboy-electron-bridge` is SPCBoy's only bundled playback executable. It
  owns every decoder, PCM pipeline, ten-band EQ, timing window, and macOS audio
  endpoint. SPCBoy never invokes a second helper, an installed executable, or a
  renderer PCM fallback.
- The Electron main process owns only bridge lifetime and command framing;
  `web/app-playback.js` owns UI state and asks for transport commands. Neither
  renders PCM or applies a second EQ/gain stage.
- VGMBoy owns the device-bound 10 ms start/pause/stop/replacement envelope and
  the longer queued-skip ramp. The renderer may request a ramp, but must never
  duplicate the envelope locally.
- `electron/playback-core.js` is static admission and control-policy data. It
  cannot choose or implement a format decoder.
- Catalog rows are the sole display metadata authority. For local DiskPath
  browsing, `player-structure` returns only decoder-private subtrack count and
  timing so the UI can make rows; it returns no title, artist, game, console,
  catalog data, or scanner result.
- VGMBoy can consult decoder-private timing while a file is loaded in order to
  enforce natural playback, Long Play, and fades. That is transport behavior,
  not metadata inspection or catalog access.
- Archive materialization remains app-side. It provides a naked playable path
  and retains dependency siblings until VGMBoy closes the active source.
- Status snapshots carry buffered-frame and underrun diagnostics. They are the
  frontend monitoring endpoint; frontend code must not infer underruns from
  display metadata or scan state.

## Files

- [electron/native-audio-tools.js](/Users/john/Downloads/Code/SPCBoy/electron/native-audio-tools.js)
- [electron/native-helper-client.js](/Users/john/Downloads/Code/SPCBoy/electron/native-helper-client.js)
- [electron/playback-core.js](/Users/john/Downloads/Code/SPCBoy/electron/playback-core.js)
- [electron/playlist-track-inspector.js](/Users/john/Downloads/Code/SPCBoy/electron/playlist-track-inspector.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
