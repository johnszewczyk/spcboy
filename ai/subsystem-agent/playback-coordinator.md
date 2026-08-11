# Playback Coordinator

## Scope

- Shared renderer ownership of track transitions, timing, progress, and playback lifecycle across native-session and renderer-PCM backends.

## Ownership

- `web/app-playback.js` remains the coordinator entry point while the backend-specific decoders stay behind their existing preload APIs.
- `electron/playback-core.js` owns format-to-backend selection only; it must not own renderer timing or UI state.
- `electron/playback-core.js` declares each backend's playback mode and helper identity; native IPC and renderer routing consume that capability instead of duplicating format-specific decisions.
- `electron/playback-core.js` is the single backend capability registry. Preload exposes its data-only renderer view and `web/playback-backends.js` builds the renderer lookup from that view.
- Native helpers own decoding and device/session mechanics, not track selection or progress-slider policy.
- The native decoder contract is worker-owned; decoder adapters must not be called from the Core Audio callback.

## Invariants

- One active playback transition may mutate the native or Web Audio session at a time.
- Every transition carries a track identity and generation; stale completions must not start, pause, seek, or report state for another track.
- Progress is measured from the active output clock and clamped to the active track duration.
- Native and Web Audio backends use the same coordinator clamp for elapsed position updates.
- Backend selection is based on the materialized playable path, including archive members.
- Long Play changes duration policy only; it must not change backend selection.
- Renderer-PCM backends currently include OpenMPT `.xm` and standard audio containers; their chunk decoder is selected by the materialized playable extension.

## Lifecycle

- A transition resolves the playable path, opens the selected backend session, starts output, and then publishes state for that same track.
- Stop and replacement invalidate the prior generation before releasing its audio resources.
- Seek replaces or repositions the active session through the same serialized transition path.

## Failure Boundaries

- Decoder failures leave playback stopped and must not resurrect a previous track.
- Empty or invalid PCM is a backend failure, not a valid silent session.
- UI progress updates must not drive decoder work faster than the coordinator's clock.

## Files

- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [electron/playback-core.js](/Users/john/Downloads/Code/SPCBoy/electron/playback-core.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [native/libgme_tool.c](/Users/john/Downloads/Code/SPCBoy/native/libgme_tool.c)
- [native/native_decoder.h](/Users/john/Downloads/Code/SPCBoy/native/native_decoder.h)
- [native/libvgm_tool.cpp](/Users/john/Downloads/Code/SPCBoy/native/libvgm_tool.cpp)
