# Third-Party Licenses

SPCBoy uses external open-source playback libraries. Their copyright and license terms remain applicable.

## libgme

- Purpose: AY, GBS, HES, KSS, NSF, NSFE, SAP, and SPC playback and metadata inspection.
- License: LGPL-2.1-or-later.
- Source: <https://github.com/libgme/game-music-emu>

## libsidplayfp (SIDLite)

- Purpose: Commodore 64 SID playback and metadata inspection.
- License: GPL-2.0-or-later.
- Source: <https://github.com/libsidplayfp/libsidplayfp>
- Note: SPCBoy links the Homebrew `libsidplayfp` build and uses its bundled SIDLite emulation.

## libvgm

- Purpose: VGM, VGZ, GYM, and S98 playback and metadata inspection.
- License: mixed upstream component licenses; see the vendored source notices.
- Source: <https://github.com/ValleyBell/libvgm>

## lazyusf2 and psflib

- Purpose: Nintendo 64 USF and miniUSF playback and metadata inspection.
- License: see the vendored source notices in `vendor/lazyusf2` and `vendor/psflib`.
- Source: <https://github.com/Lazyusf2/lazyusf2>

## mGBA / Highly Complete

- Purpose: Game Boy Advance GSF and miniGSF playback through the vendored GBA core.
- License: MPL-2.0; see `vendor/mgba/LICENSE`.
- Source: <https://github.com/mgba-emu/mgba>

## 2sf2wav

- Purpose: Nintendo DS 2SF and mini2SF playback through the vendored DeSmuME-derived core.
- License: GPL-2.0-or-later; see the vendored source notices in `vendor/2sf2wav`.
- Source: <https://bitbucket.org/ahigerd/2sf2wav>

## libopenmpt

- Purpose: XM module metadata inspection and PCM rendering through the installed `openmpt123` command.
- License: BSD-3-Clause; see the installed libopenmpt distribution notices.
- Source: <https://lib.openmpt.org/libopenmpt/>

## FFmpeg

- Purpose: standard audio metadata inspection and PCM rendering through the installed `ffprobe` and `ffmpeg` commands.
- License: LGPL-2.1-or-later or GPL-2-or-later depending on the configured build; see the installed FFmpeg build configuration.
- Source: <https://ffmpeg.org/>

## vgmstream

- Purpose: streamed game-audio formats including console ADPCM, XA, VAG, ATRAC, and bank/container families.
- License: see `vendor/vgmstream/COPYING` and its codec dependency notices.
- Source: <https://github.com/vgmstream/vgmstream>

## Play!

- Purpose: PlayStation PSF and PlayStation 2 PSF2 playback through the vendored PSF core.
- License: see `vendor/play/License.txt` and the vendored dependency notices.
- Source: <https://github.com/jpd002/Play->

## Electron

- Purpose: macOS application shell and isolated renderer runtime.
- Version: 43.0.0.
- License: MIT.
- Source: <https://github.com/electron/electron>

## Lucide

- Purpose: bundled outline SVG icons for library views and Options navigation.
- License: ISC.
- Source: <https://lucide.dev/> and <https://github.com/lucide-icons/lucide>

## SQLite

- Purpose: persistent library index and scan database through the system `sqlite3` command.
- Version: system runtime; see the installed command.
- License: public domain.
- Source: <https://sqlite.org/>

## Archive tools

- Purpose: archive listing and extraction through `bsdtar`, `unzip`, `7zz`, `zstd`, `lsar`, and `unar`.
- Version: system/runtime installations; see the installed commands.
- Licenses: each tool's own distribution notices.
- Sources: <https://libarchive.org/>, <https://www.7-zip.org/>, <https://github.com/facebook/zstd>

The vendored source trees and their license files remain the authoritative notices for redistributed builds.
