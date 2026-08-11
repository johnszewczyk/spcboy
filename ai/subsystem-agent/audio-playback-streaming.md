# Audio Playback Streaming

## Scope

- Helper-owned native playback output.
- Streamed PCM flow.
- Seek rebuild behavior.

## Ownership and Invariants

- Playback uses the local native helper for native-session backends and the renderer PCM scheduler for explicitly declared renderer-PCM backends.
- `electron/playback-core.js` defines backend ownership for libgme, libvgm, lazyusf2, Highly Complete, OpenMPT, standard audio, 2SF, vgmstream, and Play! PSF.
- The libvgm helper supports metadata inspection and raw PCM rendering, and its bridge is now attached to the native decoder contract.
- VGM-family tracks use the native buffered transport with background refill and native seek handling.
- OpenMPT `.xm` and standard audio tracks use chunked renderer PCM with backend-specific seeked decode commands.
- Nintendo DS payload WAVs use chunked renderer PCM: `SWAV` files are temporarily aliased to `.adpcm` for vgmstream, while recognized headerless `_NN.wav` files are decoded as signed 8-bit mono at 22,050 Hz and converted to the fixed 44.1 kHz stereo output.
- Renderer-PCM fade is applied once after decode from absolute track position; backend chunk requests do not apply the global fade independently.
- GSF and miniGSF use the mGBA-backed Highly Complete bridge, with psflib dependency resolution and native-rate audio resampled to the helper's 44.1 kHz output.
- 2SF and mini2SF use the DeSmuME-derived 2sf2wav bridge, with complete dependency validation and native 44.1 kHz PCM output.
- vgmstream families use the native vgmstream bridge; FFmpeg/Vorbis are codec dependencies and the active scanner list includes bank/container forms whose sibling files must remain available. PS2 `.xmd`/`.adp`, PSP ATRAC3 `.at3`, and PS3 Bink `.bika` have been verified by inspection and PCM decode from the local corpus; their extension admission must remain aligned between the backend registry and `libgme-tool` native route.
- vgmstream source PCM is normalized to the helper's fixed 44.1 kHz stereo output. This source-rate conversion is required for formats such as 3DO SNDS streams that commonly decode at 22,050 Hz; direct source-frame copying makes those tracks play too fast.
- PSF and PSF2 use the native Play! bridge; `.psflib` and `.psf2lib` siblings are kept as complete dependency families during archive playback materialization.
- Native-session tracks treat the helper as the playback authority; renderer-PCM tracks treat the coordinator's scheduled decoded chunks as the playback authority.
- `native/native_decoder.h` defines the worker-owned decoder contract for create-time backend state, timing configuration, seek, signed 16-bit rendering, end detection, played-frame reporting, and destruction.
- libgme and lazyusf2 are adapted behind that contract in `native/libgme_tool.c`; the realtime audio callback remains isolated from all decoder calls.
- libgme and libvgm playback may pass their separately configured reduced tempo rationals to the native player. The helper applies the selected backend's supported rate control before loading/priming output; its native snapshot reports the active numerator and denominator. No other native decoder consumes this field.
- libvgm and Highly Complete are also adapted behind that contract; the realtime audio callback remains isolated from all decoder calls.
- Playback starts by priming the helper ring buffer before output begins.
- Seeking rebuilds playback from the requested time offset.
- Long Play timing is renderer-owned for the Now Playing readout and passed to native or renderer playback; playlist metadata keeps the decoder-reported duration.
- Native playback state includes buffered-frame and underrun diagnostics.
- The renderer closes the native playback runtime when playback stops, terminating its refill thread and state broadcast until the next native track starts.
- Renderer-PCM playback takes the main-process active-playback guard before archive materialization, the same guard used by native playback. This keeps `Clear Cache` from deleting a renderer decode path between chunks.
- Native playback snapshots include a worker-side nonzero PCM sample count so decoder output can be distinguished from an empty/silent render before the audio device consumes frames.
- The audio callback never waits for EQ/filter processing or a PCM ring lock. Producer-side filtering uses a separate processing lock, while a C11-atomic single-producer/single-consumer ring carries PCM to the callback. A reset invalidates an in-flight reader so pre-transition PCM cannot reappear after seek or track replacement.
- `audio_engine_macos.c` owns the final output transport envelope separately from user volume and EQ. It ramps native output at the Core Audio boundary; renderer-PCM uses an equivalent master transport gain. Ten milliseconds is the de-click envelope for pause, stop, replacement, and fresh output, not a song fade.
- Native helper/runtime ownership persists across ordinary renderer transitions. Track replacement stops and clears the decoder/ring only after the output has reached silence; it does not close and recreate the helper/audio runtime each time.
- `electron/native-audio-tools.js` owns the native/external helper command surface and format-specific aliases. Its `native-helper-client.js` dependency owns framing, helper lifetime, and coalesced native-state requests; `electron/main.js` only supplies IPC and window integration.

## Critical Engineering Notes

- Treat the helper-owned native playback engine as the active playback contract.
- Keep helper state and renderer playback state aligned.
- Any latency work must preserve seek correctness and current timing behavior.
- Do not turn vgmstream's source-rate conversion into a transport-speed option. It is required to restore correct pitch/rate for decoded streams and is not a sequenced-format tempo API.

## Files

- [native/libgme_tool.c](/Users/john/Downloads/Code/SPCBoy/native/libgme_tool.c)
- [native/native_decoder.h](/Users/john/Downloads/Code/SPCBoy/native/native_decoder.h)
- [native/play_psf_bridge.cpp](/Users/john/Downloads/Code/SPCBoy/native/play_psf_bridge.cpp)
- [Docs/investigations/play-psf-investigation.md](/Users/john/Downloads/Code/SPCBoy/Docs/investigations/play-psf-investigation.md)
- [native/libvgm_tool.cpp](/Users/john/Downloads/Code/SPCBoy/native/libvgm_tool.cpp)
- [native/lazyusf_tool.c](/Users/john/Downloads/Code/SPCBoy/native/lazyusf_tool.c)
- [electron/playback-core.js](/Users/john/Downloads/Code/SPCBoy/electron/playback-core.js)
- [electron/special-audio.js](/Users/john/Downloads/Code/SPCBoy/electron/special-audio.js)
- [native/libvgm_tool.cpp](/Users/john/Downloads/Code/SPCBoy/native/libvgm_tool.cpp)
- [native/audio_engine_macos.c](/Users/john/Downloads/Code/SPCBoy/native/audio_engine_macos.c)
- [native/ring_buffer.c](/Users/john/Downloads/Code/SPCBoy/native/ring_buffer.c)
- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/native-audio-tools.js](/Users/john/Downloads/Code/SPCBoy/electron/native-audio-tools.js)
- [electron/native-helper-client.js](/Users/john/Downloads/Code/SPCBoy/electron/native-helper-client.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
