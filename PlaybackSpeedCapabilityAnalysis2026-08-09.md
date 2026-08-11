# Playback Speed Capability Analysis — 2026-08-09

## Implemented now

The Play Speed panel has independent persisted controls for the libgme and libvgm routes.

### libgme

- `.spc` — SNES
- `.nsf`, `.nsfe` — NES/Famicom
- `.gbs` — Game Boy
- `.hes` — PC Engine/TurboGrafx-16
- `.kss` — MSX/SMS-family KSS
- `.ay` — ZX Spectrum
- `.sap` — Atari 8-bit

The native helper uses `gme_set_tempo()` before playback starts. Values are exact reduced rational pairs. The input accepts `.5`, `0.2`, `1.25`, and `5/4`; positive numerator and denominator components are allowed up to `1,000,000`.

Real checks performed with archived music:

- Super Castlevania IV SPC: `5/4` reaches the helper as `5/4`.
- Castlevania NES NSF: `.5` reaches the helper as `1/2`.

### libvgm

- `.gym` — Sega Genesis/Mega Drive
- `.s98`
- `.vgm`, `.vgz`

The bridge now passes its exact rational setting through libvgm's `Config.pbSpeed`. A real VGM fixture loaded at `5/4` reports `5/4` in the native playback state.

## Available upstream, but not yet bridged

| Route | Upstream control | What is needed before enabling |
| --- | --- | --- |
| 2SF: `.2sf`, `.mini2sf` | 2sf2wav uses `SetSampleRate(sampleRate / speedFactor)` | Add a speed field to the 2SF bridge and convert seek/timing semantics carefully. Changing emulation rate can affect both CPU timing and output frame accounting. |

## Do not expose as generic playback speed yet

| Route | Reason |
| --- | --- |
| vgmstream | No general playback-speed control is exposed by the current bridge. TXTP `#h` overrides a source sample-rate interpretation for a specific file; it is not a player rate control. A generic feature needs a distinct PCM resampling/time-stretch layer. |
| Standard audio / OpenMPT renderer PCM | Web Audio `playbackRate` is possible, but changes pitch together with speed. Pitch-preserving speed needs a dedicated time-stretch implementation and explicit CPU/latency tests. |
| LazyUSF, Highly Complete, Play! PSF | Their present native bridges do not expose a speed control. Treat as unsupported until each decoder offers a verified route. |

## UI recommendation

Keep the encoder-specific exact-rational settings in Playback Options. If a bottom-toolbar button is added, it should be a contextual enable/disable control for the current track's encoder. It must show unavailable rather than silently doing nothing on unsupported formats.

Avoid a "global works everywhere" label until 2SF and the remaining playback engines are bridged and validated.
