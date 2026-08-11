#pragma once

#include <stdint.h>

/* Decoder work is owned by the native playback worker. The realtime audio
 * callback must never call this interface. */
typedef struct NativeDecoder NativeDecoder;

typedef struct NativeDecoderVTable {
  void (*destroy)(NativeDecoder *decoder);
  int (*configure)(NativeDecoder *decoder, int play_ms, int fade_ms);
  int (*seek)(NativeDecoder *decoder, int milliseconds);
  int (*render_s16)(NativeDecoder *decoder, int requested_frames, int16_t *samples, int *rendered_frames);
  int (*track_ended)(NativeDecoder *decoder);
  uint64_t (*played_frames)(NativeDecoder *decoder);
} NativeDecoderVTable;

struct NativeDecoder {
  const NativeDecoderVTable *vtable;
  const char *backend_id;
};

static inline void native_decoder_destroy(NativeDecoder *decoder) {
  if (decoder && decoder->vtable && decoder->vtable->destroy) decoder->vtable->destroy(decoder);
}

static inline int native_decoder_configure(NativeDecoder *decoder, int play_ms, int fade_ms) {
  return decoder && decoder->vtable && decoder->vtable->configure
    ? decoder->vtable->configure(decoder, play_ms, fade_ms) : 1;
}

static inline int native_decoder_seek(NativeDecoder *decoder, int milliseconds) {
  return decoder && decoder->vtable && decoder->vtable->seek
    ? decoder->vtable->seek(decoder, milliseconds) : 1;
}

static inline int native_decoder_render_s16(NativeDecoder *decoder, int requested_frames, int16_t *samples, int *rendered_frames) {
  return decoder && decoder->vtable && decoder->vtable->render_s16
    ? decoder->vtable->render_s16(decoder, requested_frames, samples, rendered_frames) : 1;
}

static inline int native_decoder_track_ended(NativeDecoder *decoder) {
  return decoder && decoder->vtable && decoder->vtable->track_ended
    ? decoder->vtable->track_ended(decoder) : 1;
}

static inline uint64_t native_decoder_played_frames(NativeDecoder *decoder) {
  return decoder && decoder->vtable && decoder->vtable->played_frames
    ? decoder->vtable->played_frames(decoder) : 0;
}
