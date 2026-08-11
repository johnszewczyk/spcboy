# Playback

## Formats

- Playback: `.ay`, `.gbs`, `.hes`, `.kss`, `.nsf`, `.nsfe`, `.sap`, and `.spc` files use libgme; `.gym`, `.s98`, `.vgm`, and `.vgz` files use libvgm; `.usf` and `.miniusf` files use lazyusf2; `.gsf` and `.minigsf` use Highly Complete; `.2sf` and `.mini2sf` use 2SF; console-rip formats use vgmstream; and PSF/PSF2 files use Play!.
- Playback: `.xm` files use OpenMPT; `.aif`, `.aiff`, `.flac`, `.m4a`, `.mp3`, and `.wav` files use standard audio decoding.
- Playback: Nintendo DS `SWAV` payloads stored in `.wav` files route through vgmstream, while headerless signed 8-bit mono `_NN.wav` payloads at 22,050 Hz use the raw PCM route; both are recognized from file contents during scanning and playback.

## Controls

- Controls: previous, play-pause, next, Long Play loop glyph, and progress seeking.
- Controls: double-click and Enter activate tracks.
- Controls: keyboard shortcuts and Media Session transport when supported.

## Timing

- Time: playlist rows retain decoder-reported duration; Now Playing shows Long Play duration plus fade when enabled.
- Long Play: manual duration and fade controls apply to every supported format.
- Playback Speed: SPC uses libgme tempo with an exact stored numerator/denominator; decimal input is reduced to that fraction. Speed changes SPC music timing while preserving the fixed output sample rate, so a 5/4 SPC duration is four-fifths of its normal play duration before any fade.
- Playback Speed: it is intentionally unavailable for every non-SPC route. vgmstream does not play sequenced SPC files and SPCBoy does not present source-rate override/resampling as a generic playback-speed control.
- Playback: native-session formats use streamed native output with seeking; OpenMPT and standard audio use chunked renderer PCM with seeking.
- Playback: vgmstream source rates are resampled to the native 44.1 kHz stereo output, including 3DO SNDS streams that otherwise play at the wrong speed.
- Transport: pause, stop, and track replacement use a 10 ms output de-click envelope. The envelope is too short to alter a track's musical attack; it only removes the discontinuity at the output boundary.
- Queued Skips: the current live track fades through the configured fade duration, then the requested adjacent track starts. It never reloads a tail of the current track to manufacture that fade.

## Files

- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [native/libgme_tool.c](/Users/john/Downloads/Code/SPCBoy/native/libgme_tool.c)
- [web/playback-speed.js](/Users/john/Downloads/Code/SPCBoy/web/playback-speed.js)
