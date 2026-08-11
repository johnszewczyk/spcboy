# OpenMPT and standard-audio intake

## Scope

CocoaSpice admits OpenMPT `.xm` modules and standard audio containers (`.aif`,
`.aiff`, `.flac`, `.m4a`, `.mp3`, and `.wav`). SPCBoy previously admitted only
the game-music and console-rip registry. This investigation closes that
scanner/playback gap without routing decoder work through the realtime native
audio callback.

## Implementation

SPCBoy now registers two renderer-PCM backends in both the Electron and web
registries:

- `openmpt` for `.xm`, using `openmpt123` for metadata and chunked 44.1 kHz
  signed stereo PCM;
- `standard-audio` for `.aif`, `.aiff`, `.flac`, `.m4a`, `.mp3`, and `.wav`,
  using `ffprobe` for metadata and `ffmpeg` for chunked 44.1 kHz signed stereo
  PCM.

The existing renderer PCM scheduler handles these chunks alongside vgmstream.
Fade is applied once by that scheduler using the chunk's absolute track
position, rather than being passed into every backend decode request. Final
short decoder chunks are zero-padded to the requested timeline so a source EOF
does not create a repeated fade or an indeterminate transition.
Archive discovery uses the same registry, so the new extensions are admitted
from ZIP, 7z, RSN, TZST, and TAR.ZST members as well as direct files. The current implementation expects
`openmpt123`, `ffprobe`, and `ffmpeg` on the launch environment; the command
paths can be overridden with `SPCBOY_OPENMPT123`, `SPCBOY_FFPROBE`, and
`SPCBOY_FFMPEG`.

## Validation

Validation used real files from `/Users/john/Downloads/audio`:

- `Rips - N64/Top Gear Rally/01 - module-01.xm`: OpenMPT reported a 2:56.640
  module; a 1-second seeked decode produced 176,400 bytes of stereo 16-bit
  PCM with nonzero samples.
- `Mr. Norbert/Hardware Recordings/Just Breed - Brad Smith 2012/just_breed_01.flac`:
  ffprobe reported 53.410136 seconds and a 1-second seeked decode produced
  176,400 bytes of nonzero stereo 16-bit PCM.
- Node regression tests cover direct registry admission and concurrent ZIP
  materialization for `.xm`, `.flac`, and `.wav` entries.

The native-session backends remain unchanged; these two formats intentionally
use the existing renderer-PCM scheduling path because their decoded chunks
are produced outside the realtime callback.
