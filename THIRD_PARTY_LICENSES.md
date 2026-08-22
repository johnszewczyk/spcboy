# Third-Party Licenses

SPCBoy's bundled `vgmboy-electron-bridge` is its only decoder and audio-output
component. The complete decoder dependency list, exact versions, and upstream
licenses are maintained with that bundled core in
[`../VGMBoy/README.md`](../VGMBoy/README.md). SPCBoy does not link, invoke, or
ship a second decoder, metadata reader, PCM renderer, or format-specific helper.

## VGMBoy

- Purpose: bundled format routing, decoder integration, timing, EQ, and macOS audio output.
- Source: <https://github.com/johnszewczyk/VGMBoy>
- Upstream decoder licenses: see VGMBoy's exhaustive **Active decoder plugins** table and the vendored source notices it identifies.

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
