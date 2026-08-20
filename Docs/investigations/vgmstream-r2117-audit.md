# vgmstream r2117 Long Play Audit

## Root cause

SPCBoy pins `vendor/vgmstream` to the r2117 release. The vgmstream native decoder
`configure()` hardcoded `vgmstream_player_configure(vgm->player, false, ...)` and
ignored the requested `play_ms`, so a track played only to its natural end even when
Long Play set a longer manual duration. The shell (`libgme_tool.c`) stops on
`native_decoder_track_ended` before the `(play_ms + fade_ms)` cap, producing the
early-end behavior. The Play! PSF decoder had the same gap via a never-firing
`play_ms <= 0` convention.

## Fix

The app signals Long Play only through `play_ms` (manual duration). Both native
decoders now derive loop behavior from `play_ms` against the decoder-reported natural
length:

```
long_play = play_ms <= 0 || natural_ms <= 0 || play_ms > natural_ms
```

- vgmstream (`native/vgmstream_decoder.cpp`): `natural_ms` comes from
  `vgmstream_player_read_metadata` (`play_length_frames` / `sample_rate`).
- Play! PSF (`native/play_psf_decoder.cpp`): `natural_ms` comes from
  `spcboy_play_psf_play_length_frames` at 44.1 kHz.

This matches the app's convention that `play_ms` == natural length for a normal
single-pass play and `play_ms` > natural for Long Play. A missing natural length
(`natural_ms <= 0`) also enables `long_play`, matching the renderer, which treats
unknown-length tracks as manual-duration tracks.

## Verification

CLI (via the `libgme-tool serve` protocol the app uses):

- `event/Stream 008.svag` (natural 14,926 ms) with `play_ms=60000, fade_ms=10000`
  loops past the natural end, plays to 60 s, fades, and ends at ~72 s.
- Same track with `play_ms=14926` still ends at its natural length (no regression).
- FF7 `111 Fanfare.minipsf` (tag 41,000 ms) with `play_ms=60000, fade_ms=10000`
  loops past 41 s and ends at ~72 s.
- Silent Hill minipsf still loads and plays.

Live app (debug port, dist bundle binary `9424deff...`, matches repo
`native/libgme-tool`):

- Long Play on: `player-load` received `play_ms=60000, fade_ms=10000`; the vgmstream
  `movie/flash.ss2` track (natural 0:05, non-looping ADS) looped past 60 s.
- Long Play off: `play_ms=5000` (natural); `flash.ss2` ended at its natural window.

## Edge cases (closed)

- **Unknown natural length:** formats reporting `play_samples = 0` previously fell to
  `long_play = false` even when Long Play was requested. The derivation now treats
  `natural_ms <= 0` as long-play, so the requested manual duration stays honored. This
  aligns with the renderer's manual-duration fallback for unknown-length tracks.
- **Internal fade/outro:** investigated adding `config.ignore_fade` under long-play,
  but it is unnecessary: `play_state.c` forces `ignore_fade = false` whenever
  `play_forever` is set, and `render.c` (`play_op_fade`) skips the fade entirely under
  `play_forever`. Only the shell's `(play_ms + fade_ms)` cap and fade apply.

## Format-spread verification

Decoded raw PCM via `decode-raw` (same configure path the app uses) with
`play_ms` = natural and `play_ms` = natural + 60 s:

- SVAG (loop points): single-pass ends at natural; long-play loops to the cap.
- SS2/ADS (no loop points, `force_loop` path): long-play loops well past natural.
- GENH (loop points): long-play loops well past natural.

Note: ADS/SS2 natural-end decoding is a few hundred ms to ~1 s shorter than the
reported `play_samples`; this is a decoder length-reporting quirk, unrelated to
Long Play.

## Renderer timing race (fixed)

On a fresh archive Play Now, the first track's natural length was not hydrated when
`play_ms` was computed (`playTrackNow` computed `playbackBaseSeconds` before
`hydrateTrackMetadata`), so with Long Play off an unhydrated track fell back to the
manual duration. Fixed in `web/app-playback.js`: the playback timing window is
recomputed after metadata hydration and that final window is authoritative for
`play_ms`/fade. Verified live: `movie/flash.ss2` (natural 0:05) now loads with
`play_ms=5000` and ends at its natural window; Long Play on still loads
`play_ms=60000` and loops.