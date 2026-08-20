# Media Intake Lifecycle

## Scope

- Boundary between shared catalog scanning and SPCBoy-owned playlist intake.
- Playback archive materialization, loose multi-track expansion, and transient
  playlist metadata.

## Ownership

- The sibling MediaScanner package owns every catalog scan and write. SPCBoy
  contains no JavaScript catalog scanner, staging database, checkpoint writer,
  root mutation service, or host fallback.
- `media-scanner-client.js` invokes the staged Swift executable only for its
  versioned process contract, including catalog validation.
- `media-source-discovery.js` discovers paths selected for the current playlist;
  it does not index a library.
- `playlist-archive-discovery.js` and `archive-resolver.js` list/materialize
  selected archive content for playback.
- `playlist-track-inspector.js` expands selected multi-track sources and obtains
  transient playlist metadata.
- `bounded-work.js` provides cancellation-aware playlist-operation limits.

## Invariants

- Playlist discovery and inspection never write the shared catalog.
- Selecting a file does not scan its siblings; selecting an archive expands
  only that archive; selecting a folder walks only for that playlist request.
- NSF, GBS, and other libgme containers expand to their native child tracks
  before the playlist is presented.
- One archive materialization session is shared across the selected archive's
  playlist hydration and is released after use.
- Required decoder/enumeration failures are visible. Playlist intake does not
  fabricate a generic single-track result.
- Cancellation reaches bounded work and active helper/archive processes.
- Durable archive cache is SPCBoy-owned playback state and is separate from
  MediaScanner scratch space and catalog persistence.
- A tar.zst archive is decompressed once per session and the raw TAR is reused
  (bounded cache) for every member extraction, regardless of format; per-member
  re-decompression would charge the whole archive against the cache quota on
  every extraction.

## Failure Boundaries

- Archive paths and dependencies are validated before materialization.
- Cache mutation is serialized against active playback leases.
- Abandoned disposable playlist scratch is recovered at launch.
- A playlist inspection failure affects that requested item only and cannot
  alter catalog rows or scan checkpoints.

## Files

- [media-scanner-client.js](/Users/john/Downloads/Code/SPCBoy/electron/media-scanner-client.js)
- [media-source-discovery.js](/Users/john/Downloads/Code/SPCBoy/electron/media-source-discovery.js)
- [playlist-archive-discovery.js](/Users/john/Downloads/Code/SPCBoy/electron/playlist-archive-discovery.js)
- [playlist-track-inspector.js](/Users/john/Downloads/Code/SPCBoy/electron/playlist-track-inspector.js)
- [direct-metadata-readers.js](/Users/john/Downloads/Code/SPCBoy/electron/direct-metadata-readers.js)
- [bounded-work.js](/Users/john/Downloads/Code/SPCBoy/electron/bounded-work.js)
- [archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
