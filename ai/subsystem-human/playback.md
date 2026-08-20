# Playback

## Formats

- Playback: `.ay`, `.gbs`, `.hes`, `.kss`, `.nsf`, `.nsfe`, `.sap`, `.sid`, and `.spc` files use libgme; `.gym`, `.s98`, `.vgm`, and `.vgz` files use libvgm; `.usf` and `.miniusf` files use lazyusf2; `.gsf` and `.minigsf` use Highly Complete; `.2sf` and `.mini2sf` use 2SF; console-rip formats use vgmstream; and PSF/PSF2 files use Play!. Commodore 64 `.sid` files decode through the bundled SIDLite player.
- Playback: tracker modules (`.669`, `.dmf`, `.far`, `.it`, `.mod`, `.mptm`, `.mtm`, `.okt`, `.ptm`, `.s3m`, `.stm`, `.ult`, `.xm`) use OpenMPT; `.aif`, `.aiff`, `.flac`, `.m4a`, `.mp3`, `.ogg`, and `.wav` files use standard audio decoding.
- Playback: PlayStation 2 includes PSF2/minipsf2 plus vgmstream families such as `.ads`, `.adp`, `.adx`, `.aus`, `.ss2`, `.svag`, and `.xmd`; PSP includes `.at3` and `.rws`; PlayStation 3 includes `.msf`, `.txtp`, `.hd`/`.hbd`, Bink audio (`.bik`, `.bk2`, `.bika`, `.ps3`), and `.xvag`. These archive members are scanned and played through the same vgmstream route as loose files.
- Playback: Nintendo DS `SWAV` payloads stored in `.wav` files route through vgmstream, while headerless signed 8-bit mono `_NN.wav` payloads at 22,050 Hz use the raw PCM route; both are recognized from file contents during scanning and playback.

## Controls

- Controls: previous, play-pause, next, Long Play loop glyph, Repeat, and progress seeking. Active Long Play and Repeat glyphs use the configured accent color.
- Controls: double-click and Enter activate tracks.
- Controls: keyboard shortcuts and Media Session transport when supported.

## Timing

- Time: playlist rows retain decoder-reported duration; Now Playing shows Long Play duration plus fade when enabled.
- Long Play: manual duration and fade controls apply to every supported format.
- Timing: with Long Play off, a track plays its decoder-reported natural duration, including the first track played after selecting a folder or archive.
- Playback Speed: libgme supports SPC, NSF/NSFE, GBS, HES, KSS, AY, and SAP; libvgm supports GYM, S98, VGM, and VGZ. Each encoder has an independent enable setting and accepts a reduced exact decimal or fraction.
- Playback Speed: a speed change applies only while its compatible encoder owns the active track. Source-rate conversion for streamed formats remains playback correction, not a generic speed or pitch control.
- Playback: native-session formats use streamed native output with seeking; OpenMPT and standard audio use chunked renderer PCM with seeking.
- Playback: vgmstream source rates are resampled to the native 44.1 kHz stereo output, including 3DO SNDS streams that otherwise play at the wrong speed.
- Transport: pause, stop, and track replacement use a 10 ms output de-click envelope. The envelope is too short to alter a track's musical attack; it only removes the discontinuity at the output boundary.
- Queued Skips: the current live track fades through the configured fade duration, then the requested adjacent track starts. It never reloads a tail of the current track to manufacture that fade.

## Files

- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [native/libgme_tool.c](/Users/john/Downloads/Code/SPCBoy/native/libgme_tool.c)
- [web/playback-speed.js](/Users/john/Downloads/Code/SPCBoy/web/playback-speed.js)
