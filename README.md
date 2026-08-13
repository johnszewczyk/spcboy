# SPCBoy

SPCBoy is a macOS player for game-music libraries: browse folders or a game-and-console database, preview a game in the playlist, and play it directly from ordinary files or supported archives.

It is built for large collections. SPCBoy reads a catalog produced by the shared native MediaScanner, archive playback uses bounded disposable materialization, and search is one consistent temporary view across Folders and Database modes.

Playback includes Native Long Play, repeat and shuffle controls, faded skips, a 10-band EQ, decoder-specific play speed, and a small theme system for the interface. Overlapping decoder support can be routed in Options.

## Included software

| Group | Software | Used for |
| --- | --- | --- |
| **UI & core** | [Electron](https://github.com/electron/electron) | macOS application shell and isolated renderer |
|  | [Lucide](https://github.com/lucide-icons/lucide) | Interface icons |
|  | [SQLite](https://sqlite.org/) | Persistent library and scan index |
| **Playback** | [libgme](https://github.com/libgme/game-music-emu) | Sequenced game music, including SPC and NSF-family playback |
|  | [libvgm](https://github.com/ValleyBell/libvgm) | VGM, VGZ, GYM, and S98 playback |
|  | [vgmstream](https://github.com/vgmstream/vgmstream) | Streamed game audio, including PlayStation, PS2/PS3, and PSP sources |
|  | [lazyusf2](https://gitlab.com/kode54/lazyusf2) | Nintendo 64 USF playback |
|  | [mGBA / Highly Complete](https://github.com/mgba-emu/mgba) | Game Boy Advance GSF playback |
|  | [2sf2wav / DeSmuME](https://bitbucket.org/ahigerd/2sf2wav) | Nintendo DS 2SF playback |
|  | [Play!](https://github.com/jpd002/Play-) | PlayStation PSF and PSF2 playback |
|  | [libopenmpt](https://lib.openmpt.org/libopenmpt/) and [FFmpeg](https://ffmpeg.org/) | Module and standard-audio playback |
| **Library & archives** | [libarchive](https://libarchive.org/), [7-Zip](https://www.7-zip.org/), and [Zstandard](https://github.com/facebook/zstd) | Archive listing and disposable materialization |

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for licenses and attribution.

## Get started

1. Run `./launch.sh`.
2. SPCBoy opens the CocoaSpice catalog at `~/Library/Application Support/CocoaSpice/Library.sqlite` in SQLite query-only mode. To use another canonical catalog, choose it in **Options → Database → Library Database** and restart SPCBoy.
3. Library roots and catalog controls are read-only in SPCBoy. Use the standalone MediaScanner app or CLI to add roots, scan, rebuild, cancel, and resume. The former JavaScript catalog scanner is not part of SPCBoy.
4. Select a final sidebar item to preview it; double-click it or press Return to play.

For local development: `npm test` and `npm run check`.

SPCBoy is released under the [GNU GPL v3](LICENSE).
