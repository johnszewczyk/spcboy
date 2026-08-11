# SPCBoy

`SPCBoy` is an Electron desktop app for browsing extracted game-music folders and playing one selected folder at a time.
The live UI is pure Electron plus web tech, with game formats decoded by a local native helper and rendered PCM formats decoded in short chunks before playback through the macOS audio engine.

SPCBoy is released under the [GNU GPL version 3](LICENSE). The project incorporates and invokes third-party audio, archive, database, and application-runtime software under each component's own license; see [Third-Party Licenses](THIRD_PARTY_LICENSES.md).

## Current Layout

- Left pane: recursive folder sidebar with search
- Right pane: selected-folder playlist
- Bottom bar: progress slider at left, elapsed/total readout and previous/play-pause/next at right
- Options window: independent Sidebar/Playlist font size, font color, and monospace controls; item spacing, sidebar width, and playback timing controls

## Current File Support

- `.ay`
- `.gbs`
- `.gym`
- `.s98`
- `.hes`
- `.kss`
- `.nsf`
- `.nsfe`
- `.sap`
- `.spc`
- `.vgm`
- `.vgz`
- `.usf`
- `.miniusf`
- `.gsf`
- `.minigsf`
- `.xm`
- `.aif`
- `.aiff`
- `.flac`
- `.m4a`
- `.mp3`
- `.wav`
- `.2sf`
- `.mini2sf`
- `.psf`
- `.minipsf`
- `.psf2`
- `.minipsf2`
- vgmstream families: `.aa3`, `.adx`, `.ads`, `.aifc`, `.at3`, `.aus`, `.bnk`, `.fsb`, `.genh`, `.int`, `.mib`, `.msf`, `.mtaf`, `.ogg`, `.rws`, `.ss2`, `.stream`, `.svag`, `.vag`, `.xa`, `.hd`, `.hbd`, `.iecs`, `.txtp`

Playback is routed through the backend registry, so the same supported formats can appear in the library and be decoded by the app's playback path. GSF and miniGSF use the mGBA-backed Highly Complete bridge; dependency files such as `.gsflib` are materialized with their selected track when needed.
2SF and mini2SF use the DeSmuME-derived 2sf2wav bridge; complete archive dependency sets include `.2sflib` members.
vgmstream families use the native vgmstream bridge with FFmpeg/Vorbis codec support; `.txtp` and bank/container files retain sibling-file dependencies during archive materialization.
PSF and PSF2 use the native Play! bridge; `.psflib` and `.psf2lib` siblings are materialized as complete dependency families.
XM modules use libopenmpt through `openmpt123`; standard audio containers use `ffprobe`/`ffmpeg`. These renderer-PCM backends use the same chunk scheduler as vgmstream.
Nintendo DS `SWAV` payloads stored in `.wav` files are detected by their `SWAV` signature and routed through vgmstream. Headerless signed 8-bit mono Nintendo DS PCM files named `_NN.wav` and at least 64 KiB are detected by their filename, size, and non-RIFF payload signature, then decoded at 22,050 Hz.

Supported audio files may also be stored inside ZIP, 7z, RSN, TZST, and TAR.ZST archives; archive entries are indexed and extracted to a temporary cache only when played. ZIP extraction prefers macOS `bsdtar` and falls back to `7zz`, while TZST/TAR.ZST extraction explicitly decompresses with `zstd` before using `bsdtar`, and RSN is the SNES Music convention for a RAR archive containing SPC files.

## Run

Launch with the Electron bootstrap flow:

```bash
./launch.sh
```

Run Electron directly:

```bash
npm start
```

Syntax-check the active JS files:

```bash
npm run check
```

## Notes

- `./launch.sh` installs Electron dependencies if needed, incrementally builds the required native helpers, builds `dist/SPCBoy.app` with the active Electron main process, preload, renderer, and native helpers, then opens that macOS application. Unchanged vendored dependencies are skipped, and `SPCBOY_FORCE_NATIVE_REBUILD=1` forces a native rebuild.
- repeated Library scans reuse unchanged indexed sources when their file fingerprint and archive listing remain unchanged
- Database Games are root-scoped. Same-title/same-console items from separate library paths remain separate and load only the selected root's indexed tracks; older databases populate this index once at startup without rescanning audio.
- renderer-PCM support requires `openmpt123`, `ffprobe`, and `ffmpeg` on `PATH` (override with `SPCBOY_OPENMPT123`, `SPCBOY_FFPROBE`, and `SPCBOY_FFMPEG`)
- default library root comes from `SPCBOY_LIBRARY_ROOT` or a sibling `spcsets_extracted` directory
- playback uses a persistent native session that streams small PCM chunks rather than pre-rendering a whole track
- Playback Options accepts an exact decimal (`1.25`) or fraction (`5/4`) between 1/4× and 4× for libgme (SPC, NSF/NSFE, GBS, HES, KSS, AY, SAP) and libvgm (GYM, S98, VGM, VGZ); all other routes remain at 1×
- Chromium Media Session metadata/transport handlers are published so macOS and Chromium can treat SPCBoy as an active player when possible

## Included Software

SPCBoy includes source from the following projects, or uses the named tools from the local runtime. Their licenses and notices remain authoritative; this list is a convenient source map, not a replacement for [Third-Party Licenses](THIRD_PARTY_LICENSES.md).

| Software | Role in SPCBoy | Source |
| --- | --- | --- |
| Electron | macOS app shell and isolated renderer runtime | [electron/electron](https://github.com/electron/electron) |
| libgme | SPC and other sequenced game-music playback | [libgme/game-music-emu](https://github.com/libgme/game-music-emu) |
| libvgm | VGM, VGZ, GYM, and S98 playback | [ValleyBell/libvgm](https://github.com/ValleyBell/libvgm) |
| lazyusf2 and psflib | Nintendo 64 USF playback support | [kode54/lazyusf2](https://gitlab.com/kode54/lazyusf2) |
| mGBA / Highly Complete | Game Boy Advance GSF playback | [mgba-emu/mgba](https://github.com/mgba-emu/mgba) |
| 2sf2wav / DeSmuME | Nintendo DS 2SF playback | [2sf2wav source](https://bitbucket.org/ahigerd/2sf2wav) |
| vgmstream | Streamed game-audio formats | [vgmstream/vgmstream](https://github.com/vgmstream/vgmstream) |
| Play! | PlayStation PSF and PSF2 playback support | [jpd002/Play-](https://github.com/jpd002/Play-) |
| libopenmpt | XM decoding through `openmpt123` | [libopenmpt](https://lib.openmpt.org/libopenmpt/) |
| FFmpeg | Standard-audio decoding through `ffmpeg` and `ffprobe` | [FFmpeg](https://ffmpeg.org/) |
| SQLite | Persistent library index | [SQLite](https://sqlite.org/) |
| libarchive, 7-Zip, and Zstandard | Archive listing and materialization | [libarchive](https://libarchive.org/), [7-Zip](https://www.7-zip.org/), [Zstandard](https://github.com/facebook/zstd) |
