# CocoaSpice Audio Controls Parity

## Reference behavior

CocoaSpice uses one shared post-decode equalizer for every playback backend. It exposes ten parametric bands at 31, 62, 125, 250, 500, 1,000, 2,000, 4,000, 8,000, and 16,000 Hz. Each band uses one-octave bandwidth and a gain range of -12 to +12 dB in 0.5 dB steps. The equalizer can be bypassed without discarding the stored gains and has a flat reset action.

Its App Volume control is a separate 0–100% playback gain. It lowers application output only; system volume keys remain macOS-controlled.

## SPCBoy implementation

- Renderer PCM playback uses one shared Web Audio chain of peaking filters followed by an application gain node.
- Native macOS playback applies the same ten-band parametric filter model and volume before PCM enters the native output ring buffer.
- Settings persist in the existing renderer settings store and are broadcast between the main and Options windows.
- Native settings are sent to the helper through `player-audio-config`; no system-volume API is used.
- Native helper builds remain incremental; the audio engine header is included in its source-change check.

## Verification

JavaScript checks and the SPCBoy test suite pass. The native helper was rebuilt successfully after adding the audio processing path.
