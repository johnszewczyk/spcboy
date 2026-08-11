# SPCBoy Phase 1 Playback Contract Investigation

## Scope

This report records the current SPCBoy playback boundaries before decoder-core implementation. CocoaSpice is used as a reference for contracts and ownership; no CocoaSpice code is copied into SPCBoy by this investigation.

## Evidence examined

- `electron/playback-core.js`
- `electron/main.js`
- `electron/preload.js`
- `web/playback-backends.js`
- `web/app-playback.js`
- `native/libgme_tool.c`
- `native/libvgm_tool.cpp`
- `native/libvgm/libvgm_bridge.h`
- `native/lazyusf/lazyusf_bridge.h`
- CocoaSpice `PlaybackDecoderRouting.swift`
- CocoaSpice `GMEFormatSupport.swift`
- CocoaSpice `PlaybackEngine.swift`
- CocoaSpice agent notes for backend routing, format support, and streaming

## Current authoritative-looking registry

`electron/playback-core.js` registers three modules:

| Module | Extensions | Declared role |
| --- | --- | --- |
| `libgme` | `.ay`, `.gbs`, `.hes`, `.kss`, `.nsf`, `.nsfe`, `.sap`, `.spc` | Native helper playback |
| `libvgm` | `.gym`, `.s98`, `.vgm`, `.vgz` | Native session playback |
| `lazyusf` | `.usf`, `.miniusf` | Native helper playback |

`electron/main.js` derives the library extension allowlist from this registry. Archive entry admission also uses the same derived set. This is the correct direction, but the registry is not yet the single runtime routing authority.

## Actual runtime paths

### Inspection

`inspectTrack()` selects an inspector by registry backend ID:

- libgme invokes `libgme-tool inspect`.
- libvgm invokes `libvgm-tool inspect`.
- lazyusf2 invokes `lazyusf-tool inspect`.

libgme files additionally support `inspect-all` and become multiple playlist variants. Non-libgme files are currently treated as one track even when a future backend may expose subtracks.

### Renderer PCM playback

`web/app-playback.js` still contains the previous renderer PCM implementation, but the backend capability now routes libvgm through the native session. The renderer path remains isolated for fallback or diagnostic use while native validation is completed.

The Electron handler dispatches `decode-track-pcm` to libvgm, lazyusf2, or libgme according to the registry. This is a useful diagnostic/export-style path, but it is not the shared live playback contract.

### Native playback

The native playback IPC handlers in `electron/main.js` call functions named `*WithLibGme`, and `playlist:playback-session-open` also calls `openPlaybackSessionWithLibGme`. The native helper binary is `libgme-tool`.

Inside `native/libgme_tool.c`, the native player has either a `Music_Emu` or a lazyusf2 handle. It owns the decode worker, ring-buffer priming/refill, Core Audio output, seek, transport state, and diagnostics. lazyusf2 is therefore present in the native helper, but as a conditional branch inside a libgme-named player rather than as a decoder module behind a shared contract.

The native-playback load path now creates a libvgm decoder adapter through the shared worker contract.

### libvgm native components

SPCBoy already contains a substantial libvgm bridge and helper:

- `native/libvgm/libvgm_bridge.h` exposes create, configure, metadata, seek, render, end, position, and inspection functions.
- `native/libvgm_tool.cpp` exposes `inspect` and `decode-raw` commands.
- `scripts/build-libvgm-helper.sh` builds `native/libvgm-tool`.

These APIs are close to the desired decoder contract, but they are not connected to the native Core Audio session.

## Contract split

SPCBoy currently has two live playback architectures:

```text
libgme / lazyusf2 -> libgme-tool -> decode worker -> ring buffer -> Core Audio
libgme / lazyusf2 / libvgm -> libgme-tool -> decode worker -> ring buffer -> Core Audio
```

The split creates separate ownership for:

- buffering and underrun handling;
- position and completion clocks;
- seek and replacement generation handling;
- end/fade semantics;
- backend diagnostics;
- output-device behavior.

This is the principal Phase 1 risk. Adding another backend to the current arrangement would add another renderer or helper-specific branch instead of strengthening the playback core.

## Comparison with CocoaSpice

CocoaSpice’s relevant boundary is an app-owned decoder abstraction with backend routing above it and one shared streamed PCM output path below it. The decoder supplies metadata, seek, timing, and PCM; the playback engine owns queueing, output, position, completion, and transition invalidation.

SPCBoy already has the native output half of that model, including a realtime-safe ring buffer and worker thread. The missing boundary is a decoder-neutral native session contract and a registry-driven native helper route.

The first implementation should not attempt to reproduce CocoaSpice’s entire format matrix. It should unify the three formats SPCBoy already claims to support, preserve the existing native output invariants, and make renderer PCM a deliberate separate capability rather than an accidental second playback core.

## Recommended Phase 1 boundary

1. Keep `electron/playback-core.js` as the extension registry and add explicit capabilities/backend metadata rather than more extension checks.
2. Define a native decoder contract covering create, inspect, configure timing, seek, render signed 16-bit PCM, end state, played frames, and destroy.
3. Move the current libgme and lazyusf2 branches behind that contract without changing their decoding behavior.
4. Add libvgm as a third decoder implementation behind the same native decode worker and ring buffer.
5. Make the native playback IPC route select the backend from the materialized playable path.
6. Preserve renderer-owned Web Audio only as a temporary or explicitly declared backend capability; do not let ordinary transport code branch on decoder identity.
7. Add contract-level tests for registry routing, native backend selection, generation-safe replacement, seek, end/drain, and invalid PCM.

## Explicit non-goals for Phase 1

- GSF/miniGSF or Highly Complete integration.
- CocoaSpice’s broader streamed-audio, tracker, 2SF, PSF, or vgmstream matrix.
- UI redesign.
- Replacing the existing Core Audio ring buffer.
- Full-track pre-rendering.
- Copying CocoaSpice’s Swift interfaces into Electron/native code.

## Baseline verification

On 2026-07-29:

- `npm test` passed: 3 tests.
- `npm run check` passed for all active JavaScript entry points.

These tests validate extension registration only. They do not prove that every registered backend can inspect, decode, seek, complete, or play through the same output path.

## Implementation gate

The next code change should begin with the native decoder contract and backend-selection seam. It should be kept small enough that libgme playback remains behaviorally unchanged while the new seam is tested. Only after that seam is proven should libvgm be moved from renderer Web Audio into the native playback core.

## Phase 1 implementation slice completed

The first seam is now implemented:

- The backend registry declares `playbackMode` and helper identity.
- Renderer PCM selection consumes `playbackMode` rather than checking for the libvgm ID directly.
- Native playback IPC validates that the requested path belongs to a native-session backend before loading it.
- Registry tests now cover playback-mode completeness and native-session routing.

The renderer PCM path remains in source as an isolated fallback, but registered libvgm playback now selects the native session.

## Native contract implementation

`native/native_decoder.h` now defines the C-compatible worker contract for decoder destruction, timing configuration, seek, signed 16-bit rendering, end detection, and played-frame reporting. `native/libgme_tool.c` contains adapters for libgme and lazyusf2 and the native player stores one `NativeDecoder` instead of separate emulator handles.

The Core Audio callback and ring buffer are unchanged. All adapter calls remain on the decode worker or command path, preserving the realtime boundary. The helper rebuild completed successfully with the contract enabled.

## libvgm migration evidence

The existing `native/libvgm/libvgm_bridge.cpp` is now linked into the unified `native/libgme-tool` helper through `native/libvgm_decoder.cpp`. VGM-family extensions use the native-session capability and therefore enter the same worker, ring buffer, Core Audio, seek, and end/drain path as libgme and lazyusf2.

Representative smoke test on 2026-07-29:

- Input: local Pit Fighter `.vgz` sample.
- Native command: `player-load` through `libgme-tool serve`.
- Result: `transport_state=paused`, `output_state=primed`, `buffered_frames=8192`, `decode_error=false`.
- The native snapshot reported nonzero PCM samples (`nonzero_samples=16008` immediately after load and higher during worker refill), allowing decoder PCM validation when Core Audio cannot start in a headless environment.
- A direct native `player-play` attempt returned `failed to start native audio engine`; this is an output-device limitation of the command environment, not a decoder failure. The session remained primed with no decode error.

The old renderer PCM functions and standalone `libvgm-tool` remain available for fallback and inspection. They are no longer selected by the active backend capability for live VGM playback.

## Current status update

The original Phase 1 baseline in this report is historical. The active
registry now also includes Highly Complete, OpenMPT, standard audio, 2SF,
vgmstream, and Play! PSF. Native-session backends use the shared native
buffered transport; OpenMPT `.xm` and standard audio use the explicitly
declared renderer-PCM chunk scheduler. ZIP, 7z, RSN, TZST, and TAR.ZST archive
members use the same scanner registry and archive resolver. Current JavaScript
regression coverage is 10 passing tests.
