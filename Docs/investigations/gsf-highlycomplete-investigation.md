# GSF / Highly Complete Investigation

## Scope

This report tracks the next decoder family after libgme, libvgm, and lazyusf2: GSF and miniGSF through an mGBA-backed Highly Complete bridge.

## Current dependency state

- The former app-local mGBA and PSFLib copies were consolidated into VGMBoy's shared `vendor/` garden.
- VGMBoy builds the Highly Complete bridge and exposes it through the same playback-core boundary used by CocoaSpice and SPCBoy.
- SPCBoy does not own an mGBA source tree, build step, bridge, or format-specific native helper.

## Dependency verification

On 2026-07-29, the mGBA build completed successfully and produced:

```text
.build/mgba/libmgba.a
```

The build emits upstream initializer-string warnings from `src/gba/overrides.c`; they do not stop the static library build and are not SPCBoy bridge diagnostics.

## CocoaSpice reference boundary

CocoaSpice separates the GSF backend into:

- a C-compatible bridge API for create, configure, metadata, seek, render, end, and destruction;
- psflib callbacks that reconstruct the GBA ROM image from GSF executable sections and collect tags;
- a headless mGBA core configured for GBA audio;
- a resampling layer from the GBA core's native audio rate to SPCBoy's 44.1 kHz output rate;
- serialized backend lifecycle because mGBA core state is not assumed reentrant.

SPCBoy will preserve the contract shape but implement its own bridge in `native/`, without importing CocoaSpice source paths or Swift ownership code.

## Required SPCBoy work

1. Add a local `highlycomplete_bridge.h`/`.cpp` with the native decoder-facing operations.
2. Reconstruct GSF/miniGSF payloads through the existing `vendor/psflib` callbacks.
3. Initialize mGBA with GBA-only, BIOS-free configuration and a silent logger.
4. Drain mGBA's audio buffer on the decoder worker and resample to 44.1 kHz.
5. Add a Highly Complete adapter to `native_decoder.h`.
6. Serialize Highly Complete calls at the worker/backend boundary.
7. Add `.gsf` and `.minigsf` to the registry only after inspection and non-silent PCM validation pass.
8. Preserve complete archive materialization for miniGSF library dependencies.

## Registration gate

The registration gate is now satisfied:

- inspect valid metadata;
- reject malformed PSF payloads clearly;
- render non-empty PCM;
- seek by rebuilding the mGBA core;
- destroy the core without leaking the ROM view or audio buffer;
- pass the same native-session smoke checks used for VGM.

The representative local file `020 Level Clear.minigsf` from the Iridion II complete set now produces native metadata (`Game Boy Advance`, `Iridion II`, `Level Clear`, 25.680 seconds) and non-silent PCM through the unified helper. Archive resolver materialization includes `.gsf`, `.minigsf`, and `.gsflib` dependencies in one cache root.
