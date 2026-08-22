# SPCBoy Decoder-Module Expansion Report

## Task

Extend SPCBoy's native playback system to support the decoder families already integrated in CocoaSpice:

- `libvgm`: VGM, VGZ, GYM, and S98.
- Highly Complete: GSF and miniGSF through the mGBA-backed bridge.

This is a handoff for a focused implementation task. It is not a changelog and does not describe work already completed.

## Current SPCBoy State

SPCBoy is an Electron desktop app with a native helper-owned playback runtime.

### Current playback path

```text
Renderer UI
  -> Electron preload IPC
  -> electron/main.js
  -> native/libgme-tool
  -> libgme decoder
  -> native audio engine + PCM ring buffer
  -> Core Audio output unit
```

The current native helper owns the active playback session, decoder thread, output priming, ring-buffer refill, output state, underrun telemetry, and frame-based position.

Important existing files:

- `native/libgme_tool.c`
- `native/audio_engine.h`
- `native/audio_engine_macos.c`
- `native/ring_buffer.c`
- `electron/main.js`
- `electron/preload.js`
- `web/app-playback.js`
- `scripts/build-libgme-helper.sh`
- `scripts/build-libvgm-helper.sh`

### Current format registration

`electron/playback-core.js` currently defines static backend modules for `libgme` and `libvgm`, but the active playback helper is still `libgme-tool`. The module declaration and actual native playback path are therefore not yet one unified registry.

The current supported list includes libgme and some libvgm extensions in the app rules, but `libvgm` is not yet fully wired through inspection, playback, and renderer state.

## CocoaSpice Reference

CocoaSpice provides the target application-level model:

- `AudioTrackDecoder` for decoder playback.
- `AudioFileInspector` for metadata and track discovery.
- `PlaybackDecoderFactory` for decoder construction.
- A static module registry mapping extensions to backend ownership.
- Centralized `PlaybackTimingPolicy`.
- One app-owned PCM contract for all decoder families.

Relevant CocoaSpice files:

- `Sources/CocoaSpice/App/PlaybackDecoderRouting.swift`
- `Sources/CocoaSpice/App/GMEFormatSupport.swift`
- `Sources/CocoaSpice/App/PlaybackTimingPolicy.swift`
- `Sources/CLibVGM/libvgm_bridge.cpp`
- `Sources/CHighlyComplete/highlycomplete_bridge.cpp`
- `Sources/CLazyUSF/lazyusf_bridge.c`

SPCBoy should adopt the decoder-module boundaries and metadata conventions, while retaining its stronger native audio output core.

## Target Architecture

The native helper should become a decoder-neutral playback service:

```text
Renderer
  -> IPC playback commands and immutable snapshots
  -> Native playback session
  -> Decoder module registry
  -> Decoder bridge
  -> PCM decode worker
  -> Realtime-safe ring buffer
  -> Core Audio output
```

### Native decoder module contract

Create one native-owned contract shared by libgme, libvgm, and Highly Complete:

- `moduleForPathExtension(pathExtension)`.
- `inspectFile(path)`.
- `createDecoder(path, sampleRate, trackIndex)`.
- `readMetadata()`.
- `configurePlayback(loopSeconds, fadeSeconds, nativeEnding)`.
- `seek(milliseconds)`.
- `renderS16(frameCount, outputBuffer)`.
- `playedFrames()`.
- `trackEnded()`.
- `destroy()`.

The contract may be C or C-compatible C++, but the playback session must not call backend-specific functions directly.

### Module registry

The registry should be the only format allowlist used by:

- Library scanning.
- Metadata inspection.
- Playlist import validation.
- Playback loading.
- Native helper diagnostics.

Initial entries:

```text
libgme:
  ay gbs hes kss nsf nsfe sap spc

libvgm:
  gym s98 vgm vgz

Highly Complete:
  gsf minigsf
```

The registry should carry backend id, display name, extensions, capabilities, and license/source metadata for the About dialog.

## libvgm Integration

SPCBoy already contains a substantial `native/libvgm/libvgm_bridge.cpp` and header. The next agent should reuse that bridge instead of inventing another libvgm wrapper.

Required work:

1. Move or adapt the bridge behind the shared native decoder contract.
2. Add libvgm to the active helper build and link path.
3. Add libvgm inspection to the native helper protocol.
4. Add libvgm playback sessions to the same native decode worker.
5. Preserve `trackCount`, metadata, play length, loop length, and fade length.
6. Add VGM-family seek and end behavior to the shared session.
7. Remove duplicated libvgm-only routing from renderer code.

The existing bridge already exposes most of the required operations:

- `libvgm_player_create`
- `libvgm_player_destroy`
- `libvgm_player_configure`
- `libvgm_player_read_metadata`
- `libvgm_player_seek_milliseconds`
- `libvgm_player_render_s16`
- `libvgm_player_track_ended`
- `libvgm_player_played_frames`
- `libvgm_inspect_file`

## Highly Complete Integration

Highly Complete is the GBA PSF-family backend used by CocoaSpice through a local bridge backed by mGBA and PSF support.

Required work:

1. Add the mGBA source/build dependency to SPCBoy's native build.
2. Add the required PSF library source and notices.
3. Port or recreate the CocoaSpice `CHighlyComplete` bridge as an SPCBoy native backend.
4. Expose GSF and miniGSF in the shared module registry.
5. Implement metadata inspection and single-track behavior.
6. Implement the shared PCM render contract.
7. Preserve Highly Complete's serialized lifecycle if the underlying core is not reentrant.
8. Add backend-specific failure messages for missing native core, invalid PSF data, and unsupported GBA state.

The bridge must remain isolated from the ring buffer and Core Audio callback. All mGBA calls belong on the decoder worker, never on the realtime output thread.

## Build and Packaging

Update the existing runtime flow rather than adding a second launch system:

- `scripts/build-libgme-helper.sh` should become part of a unified native helper build or remain a backend-specific sub-build invoked by it.
- `scripts/build-libvgm-helper.sh` must produce the static libvgm backend for the active architecture.
- Add a corresponding mGBA/Highly Complete build step.
- `launch.sh` must stage all required native components into the fresh launch bundle.
- `electron/main.js` must resolve the staged helper/backend paths, not repository-relative development paths.
- `npm run check` should continue to validate all active JavaScript entry points.

The launch bundle must fail clearly if a required backend library is absent. Do not silently downgrade a registered format to libgme or another decoder.

## IPC Contract

Keep the renderer/backend boundary small and backend-neutral.

### Commands

- `nativePlaybackInit`
- `nativePlaybackLoad(trackPath, startMs, playMs, fadeMs, trackIndex)`
- `nativePlaybackPlay`
- `nativePlaybackPause`
- `nativePlaybackStop`
- `nativePlaybackSeek(startMs)`
- `nativePlaybackState`
- `nativePlaybackClose`

### Snapshot fields

Retain the current diagnostics and add backend identity:

- `backend_id`
- `backend_display_name`
- `transport_state`
- `output_state`
- `track_loaded`
- `decode_error`
- `reached_end`
- `sample_rate`
- `channel_count`
- `buffered_frames`
- `ring_buffer_frames`
- `callback_frames`
- `frames_requested`
- `frames_supplied`
- `underrun_count`
- `position_ms`
- `track_count`

The renderer should display or log backend identity, but should not branch on decoder-specific behavior for ordinary transport operations.

## Timing Rules

Keep timing policy in the native session or one shared app-level policy, not separately in each renderer branch.

- Use inspected play length when available.
- Use the shared manual duration when no native duration is available.
- Apply fade consistently across libgme, libvgm, and Highly Complete.
- Do not assume every backend has identical native ending semantics.
- End a track only after decoder end and buffered PCM drain agree.
- Derive active position from output frames supplied, not renderer wall-clock polling.

## Threading and Realtime Invariants

The Core Audio callback must:

- Never call libgme, libvgm, mGBA, or PSF code.
- Never allocate.
- Never block on a mutex.
- Consume only from the realtime-safe PCM ring buffer.
- Output silence on underrun and increment telemetry.

The decoder worker must:

- Own all backend calls.
- Refill toward a high-water mark.
- Stop on generation replacement.
- Exit before decoder destruction.
- Clear the ring buffer on stop, seek, route change, and replacement.

## Licensing

SPCBoy already documents libgme and libvgm in `THIRD_PARTY_LICENSES.md`.

The new task must add:

- mGBA license and source notices.
- PSF library license and source notices.
- Highly Complete attribution and license details.
- Any additional mGBA third-party notices required by the bundled build.
- About-dialog entries for all decoder modules.

Do not copy CocoaSpice's license wording without verifying the exact source and license status of each dependency.

## Implementation Phases

### Phase 1: Registry and contracts

- Define the shared native decoder contract.
- Make the module registry authoritative for scanning, inspection, and routing.
- Preserve current libgme behavior.
- Add backend identity to native snapshots.

### Phase 2: libvgm

- Integrate the existing bridge into the shared contract.
- Build and link libvgm in the native helper.
- Add inspection, playback, seek, end, and metadata tests.
- Verify VGM, VGZ, GYM, and S98.

### Phase 3: Highly Complete

- Add mGBA and PSF dependencies.
- Port the bridge and lifecycle gate.
- Add GSF and miniGSF inspection/playback.
- Verify failure handling and memory cleanup.

### Phase 4: Renderer simplification

- Remove backend-specific renderer assumptions.
- Make playlist timing and metadata use the native module contract.
- Keep transport commands identical across all backends.
- Update user-facing format documentation and About information.

### Phase 5: Runtime validation

- Exercise the full native audio acceptance matrix.
- Test output route changes, seek, pause/resume, completion, rapid replacement, and shutdown for every backend.
- Verify launch bundle contents and clean-machine startup behavior.

## Acceptance Tests

### Format and metadata

- Every registry extension is discoverable by the library scanner.
- Every registered extension can be inspected by the native helper.
- Metadata reaches the playlist with consistent title, game, artist, system, and duration fields.
- Track counts and track indices remain correct.

### Playback

- Play, pause, resume, stop, previous, next, seek, and completion work for each backend.
- Rapid track replacement cannot play stale PCM.
- Native ending and fixed-duration ending both drain correctly.
- Fade behavior is consistent.
- Output-device changes preserve state and position.
- AAC/export paths remain independent of live output.

### Diagnostics

- Backend identity is included in native snapshots.
- Underrun count remains meaningful for all backends.
- Decode errors include backend context.
- Missing backend libraries fail loudly during build or launch.

### Documentation

- `README.md` lists all supported formats.
- `THIRD_PARTY_LICENSES.md` lists all bundled dependencies.
- About dialog lists module names, purposes, licenses, and sources.
- Playback and runtime subsystem notes match the actual native helper architecture.

## Definition of Done

SPCBoy has one native, decoder-neutral playback service with a single authoritative module registry. libgme, libvgm, and Highly Complete all use the same PCM, metadata, timing, transport, and diagnostics contracts. The Core Audio output remains native and realtime-safe, and the renderer no longer needs decoder-specific playback branches.
