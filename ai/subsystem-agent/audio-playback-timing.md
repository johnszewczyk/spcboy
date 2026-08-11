# Audio Playback Timing

## Scope

- Manual play-time behavior.
- SPC force-length behavior.
- Fade behavior.
- Helper-inspected duration rules.

## Ownership and Invariants

- `Time` is the active user-facing timing control.
- Playback time is persisted and normalized in 30-second increments.
- Current timing range is 30 seconds to 15 minutes.
- SPC timing controls include a force-length checkbox and a fade checkbox with adjustable fade seconds.
- Total displayed duration uses helper-inspected play length when available, otherwise manual play time, plus fixed fade when enabled.
- Fixed fade time is currently 6 seconds.
- Playback speed is stored as a reduced positive rational, accepts up to six decimal places or explicit fractions, and is clamped to 1/4× through 4×.
- libgme speed applies to `.spc`, `.nsf`, `.nsfe`, `.gbs`, `.hes`, `.kss`, `.ay`, and `.sap`; libvgm speed applies to `.gym`, `.s98`, `.vgm`, and `.vgz`. Renderer time/display and the native player's `play_ms` use rational integer millisecond scaling, and both helpers receive the same numerator/denominator as their native tempo control.
- A speed edit persists and broadcasts immediately, but only restarts active playback when that encoder is enabled and owns the active track. Toggling an encoder may restart that encoder's active track once to apply or remove tempo.
- Fade remains output-time duration, while the pre-fade SPC content duration scales with tempo.

## Critical Engineering Notes

- Keep timing behavior separate from shell layout and playlist behavior.
- Keep timing persistence aligned with renderer settings state.
- If timing semantics change, update helper notes and renderer timing notes together.
- Do not expose native tempo merely because a backend shares a helper; each extension needs seek, duration, and PCM compatibility evidence first.

## Files

- [web/app-core.js](/Users/john/Downloads/Code/SPCBoy/web/app-core.js)
- [web/app-playback.js](/Users/john/Downloads/Code/SPCBoy/web/app-playback.js)
- [web/app-ui.js](/Users/john/Downloads/Code/SPCBoy/web/app-ui.js)
