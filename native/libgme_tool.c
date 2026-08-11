#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <strings.h>
#include <time.h>

#include "audio_engine.h"
#include "native_decoder.h"
#include "libvgm_decoder.h"
#include "highlycomplete_decoder.h"
#include "twosf_decoder.h"
#include "twosf_bridge.h"
#include "libvgm_decoder.h"
#include "vgmstream_decoder.h"
#include "vgmstream_bridge.h"
#include "play_psf_decoder.h"
#include "play_psf_bridge.h"
#include "highlycomplete_bridge.h"

#include <gme/gme.h>
#include "lazyusf_bridge.h"

#define SAMPLE_RATE 44100
#define CHANNEL_COUNT 2
#define AUDIO_ENGINE_CALLBACK_FRAMES 512
#define AUDIO_ENGINE_RING_BUFFER_FRAMES 32768
#define NATIVE_PLAYER_PREROLL_FRAMES 8192
#define NATIVE_PLAYER_HIGH_WATER_FRAMES 24576
#define NATIVE_PLAYER_DECODE_CHUNK_FRAMES 4096
#define NATIVE_PLAYER_REFILL_POLL_MS 25
#define EQUALIZER_BAND_COUNT 10
#define TRANSPORT_DECLICK_MS 10

static Music_Emu* session_emu = NULL;
static AudioEngine* native_audio_engine = NULL;

typedef enum NativePlayerTransportState {
  NATIVE_PLAYER_STOPPED = 0,
  NATIVE_PLAYER_PAUSED = 1,
  NATIVE_PLAYER_PLAYING = 2,
  NATIVE_PLAYER_ENDED = 3
} NativePlayerTransportState;

typedef struct NativePlayer {
  pthread_mutex_t mutex;
  pthread_cond_t cond;
  pthread_t thread;
  int runtime_ready;
  int thread_started;
  int shutdown_requested;
  NativeDecoder* decoder;
  char* track_path;
  int start_ms;
  int play_ms;
  int fade_ms;
  int speed_numerator;
  int speed_denominator;
  float volume;
  int equalizer_enabled;
  float equalizer_gains[EQUALIZER_BAND_COUNT];
  uint64_t decoded_frames;
  uint64_t nonzero_samples;
  int track_loaded;
  int decode_error;
  int reached_end;
  NativePlayerTransportState transport_state;
} NativePlayer;

static NativePlayer native_player = {0};

static int fail_gme(gme_err_t error);
static int start_track(Music_Emu* emu, int track_index);

typedef struct {
  NativeDecoder base;
  Music_Emu* emu;
} GmeDecoder;

typedef struct {
  NativeDecoder base;
  lazyusf_player_handle_t player;
  int play_ms;
  int fade_ms;
} LazyUsfDecoder;

static int gme_decoder_configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
  GmeDecoder* gme = (GmeDecoder*)decoder;
  if (play_ms > 0 && fade_ms >= 0) {
    gme_set_fade_msecs(gme->emu, play_ms, fade_ms);
  }
  return 0;
}

static int gme_decoder_set_tempo(NativeDecoder* decoder, int numerator, int denominator) {
  if (!decoder || numerator <= 0 || denominator <= 0) return 1;
  GmeDecoder* gme = (GmeDecoder*)decoder;
  gme_set_tempo(gme->emu, (double)numerator / (double)denominator);
  return 0;
}

static int gme_decoder_seek(NativeDecoder* decoder, int milliseconds) {
  GmeDecoder* gme = (GmeDecoder*)decoder;
  return fail_gme(gme_seek(gme->emu, milliseconds));
}

static int gme_decoder_render_s16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
  GmeDecoder* gme = (GmeDecoder*)decoder;
  gme_err_t error = gme_play(gme->emu, requested_frames * CHANNEL_COUNT, samples);
  if (error) return fail_gme(error);
  if (rendered_frames) *rendered_frames = requested_frames;
  return 0;
}

static int gme_decoder_track_ended(NativeDecoder* decoder) {
  GmeDecoder* gme = (GmeDecoder*)decoder;
  return gme_track_ended(gme->emu) != 0;
}

static uint64_t gme_decoder_played_frames(NativeDecoder* decoder) {
  (void)decoder;
  return 0;
}

static void gme_decoder_destroy(NativeDecoder* decoder) {
  GmeDecoder* gme = (GmeDecoder*)decoder;
  if (gme->emu) gme_delete(gme->emu);
  free(gme);
}

static const NativeDecoderVTable gme_decoder_vtable = {
  gme_decoder_destroy,
  gme_decoder_configure,
  gme_decoder_seek,
  gme_decoder_render_s16,
  gme_decoder_track_ended,
  gme_decoder_played_frames
};

static int lazyusf_decoder_configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
  LazyUsfDecoder* lazyusf = (LazyUsfDecoder*)decoder;
  lazyusf->play_ms = play_ms;
  lazyusf->fade_ms = fade_ms;
  return 0;
}

static int lazyusf_decoder_seek(NativeDecoder* decoder, int milliseconds) {
  LazyUsfDecoder* lazyusf = (LazyUsfDecoder*)decoder;
  char* error = NULL;
  const int result = lazyusf_player_seek_milliseconds(lazyusf->player, milliseconds, &error);
  if (result != 0 && error) {
    fprintf(stderr, "%s\n", error);
    lazyusf_error_message_free(error);
  }
  return result;
}

static int lazyusf_decoder_render_s16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
  LazyUsfDecoder* lazyusf = (LazyUsfDecoder*)decoder;
  char* error = NULL;
  const int result = lazyusf_player_render_s16(lazyusf->player, requested_frames, samples, rendered_frames, &error);
  if (result != 0 && error) {
    fprintf(stderr, "%s\n", error);
    lazyusf_error_message_free(error);
  }
  return result;
}

static int lazyusf_decoder_track_ended(NativeDecoder* decoder) {
  (void)decoder;
  return 0;
}

static uint64_t lazyusf_decoder_played_frames(NativeDecoder* decoder) {
  LazyUsfDecoder* lazyusf = (LazyUsfDecoder*)decoder;
  return (uint64_t)lazyusf_player_played_frames(lazyusf->player);
}

static void lazyusf_decoder_destroy(NativeDecoder* decoder) {
  LazyUsfDecoder* lazyusf = (LazyUsfDecoder*)decoder;
  if (lazyusf->player) lazyusf_player_destroy(lazyusf->player);
  free(lazyusf);
}

static const NativeDecoderVTable lazyusf_decoder_vtable = {
  lazyusf_decoder_destroy,
  lazyusf_decoder_configure,
  lazyusf_decoder_seek,
  lazyusf_decoder_render_s16,
  lazyusf_decoder_track_ended,
  lazyusf_decoder_played_frames
};

static NativeDecoder* native_decoder_create(const char* file_path, int track_index) {
  const char* extension = strrchr(file_path, '.');
  const int is_play_psf = extension && (
    !strcasecmp(extension, ".psf") || !strcasecmp(extension, ".minipsf") ||
    !strcasecmp(extension, ".psf2") || !strcasecmp(extension, ".minipsf2")
  );
  if (is_play_psf) {
    return native_play_psf_decoder_create(file_path, track_index);
  }
  const int is_libvgm = extension && (
    !strcasecmp(extension, ".gym") ||
    !strcasecmp(extension, ".s98") ||
    !strcasecmp(extension, ".vgm") ||
    !strcasecmp(extension, ".vgz")
  );
  const int is_highlycomplete = extension && (!strcasecmp(extension, ".gsf") || !strcasecmp(extension, ".minigsf"));
  if (is_highlycomplete) {
    return native_highlycomplete_decoder_create(file_path, track_index);
  }
  const int is_twosf = extension && (!strcasecmp(extension, ".2sf") || !strcasecmp(extension, ".mini2sf"));
  if (is_twosf) {
    return native_twosf_decoder_create(file_path, track_index);
  }
  const int is_vgmstream = extension && (
    !strcasecmp(extension, ".aa3") || !strcasecmp(extension, ".adx") || !strcasecmp(extension, ".ads") || !strcasecmp(extension, ".aifc") || !strcasecmp(extension, ".adpcm") ||
    !strcasecmp(extension, ".at3") || !strcasecmp(extension, ".aus") || !strcasecmp(extension, ".bnk") || !strcasecmp(extension, ".fsb") ||
    !strcasecmp(extension, ".genh") || !strcasecmp(extension, ".int") || !strcasecmp(extension, ".mib") || !strcasecmp(extension, ".msf") ||
    !strcasecmp(extension, ".mtaf") || !strcasecmp(extension, ".ogg") || !strcasecmp(extension, ".rws") || !strcasecmp(extension, ".ss2") ||
    !strcasecmp(extension, ".stream") || !strcasecmp(extension, ".svag") || !strcasecmp(extension, ".vag") || !strcasecmp(extension, ".xa") ||
    !strcasecmp(extension, ".hd") || !strcasecmp(extension, ".hbd") || !strcasecmp(extension, ".iecs") || !strcasecmp(extension, ".txtp"));
  if (is_vgmstream) {
    return native_vgmstream_decoder_create(file_path, track_index);
  }
  const int is_lazyusf = extension && (!strcasecmp(extension, ".usf") || !strcasecmp(extension, ".miniusf"));
  if (is_libvgm) {
    return native_libvgm_decoder_create(file_path, track_index);
  }
  if (is_lazyusf) {
    if (track_index != 0) return NULL;
    LazyUsfDecoder* decoder = (LazyUsfDecoder*)calloc(1, sizeof(*decoder));
    if (!decoder) return NULL;
    char* error = NULL;
    decoder->player = lazyusf_player_create(file_path, SAMPLE_RATE, &error);
    if (!decoder->player) {
      if (error) { fprintf(stderr, "%s\n", error); lazyusf_error_message_free(error); }
      free(decoder);
      return NULL;
    }
    decoder->base.vtable = &lazyusf_decoder_vtable;
    decoder->base.backend_id = "lazyusf";
    return (NativeDecoder*)decoder;
  }

  GmeDecoder* decoder = (GmeDecoder*)calloc(1, sizeof(*decoder));
  if (!decoder) return NULL;
  gme_err_t error = gme_open_file(file_path, &decoder->emu, SAMPLE_RATE);
  if (error) {
    fprintf(stderr, "%s\n", error);
    free(decoder);
    return NULL;
  }
  gme_set_autoload_playback_limit(decoder->emu, 0);
  gme_ignore_silence(decoder->emu, 1);
  if (start_track(decoder->emu, track_index) != 0) {
    gme_delete(decoder->emu);
    free(decoder);
    return NULL;
  }
  decoder->base.vtable = &gme_decoder_vtable;
  decoder->base.backend_id = "libgme";
  return (NativeDecoder*)decoder;
}

static void close_session_emu(void) {
  if (!session_emu) {
    return;
  }

  gme_delete(session_emu);
  session_emu = NULL;
}

static void close_native_audio_engine(void) {
  if (!native_audio_engine) {
    return;
  }

  audio_engine_destroy(native_audio_engine);
  native_audio_engine = NULL;
}

static const char* native_player_transport_state_name(NativePlayerTransportState state) {
  switch (state) {
    case NATIVE_PLAYER_PAUSED:
      return "paused";
    case NATIVE_PLAYER_PLAYING:
      return "playing";
    case NATIVE_PLAYER_ENDED:
      return "ended";
    case NATIVE_PLAYER_STOPPED:
    default:
      return "stopped";
  }
}

static void print_usage(void) {
  fprintf(stderr, "usage: libgme-tool inspect <path>\n");
  fprintf(stderr, "   or: libgme-tool inspect-all <path>\n");
  fprintf(stderr, "   or: libgme-tool decode <path> <track-index> <start-ms> <play-ms> <fade-ms>\n");
  fprintf(stderr, "   or: libgme-tool decode-raw <path> <track-index> <start-ms> <play-ms> <fade-ms>\n");
  fprintf(stderr, "   or: libgme-tool player-load <path> <track-index> <start-ms> <play-ms> <fade-ms> [speed-numerator speed-denominator]\n");
  fprintf(stderr, "   or: libgme-tool player-state\n");
  fprintf(stderr, "   or: libgme-tool serve\n");
}

static int fail_message(const char* message) {
  fprintf(stderr, "%s\n", message);
  return 1;
}

static int fail_gme(gme_err_t error) {
  if (error) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }

  return 0;
}

static void sanitize_message(char* text) {
  if (!text) {
    return;
  }

  for (char* cursor = text; *cursor; cursor += 1) {
    if (*cursor == '\r' || *cursor == '\n' || *cursor == '\t') {
      *cursor = ' ';
    }
  }
}

static const char* safe_text(const char* value) {
  return value ? value : "";
}

static void json_print_escaped_to(FILE* output, const char* value) {
  const unsigned char* cursor = (const unsigned char*) safe_text(value);
  fputc('"', output);

  while (*cursor) {
    switch (*cursor) {
      case '\\':
      case '"':
        fputc('\\', output);
        fputc(*cursor, output);
        break;
      case '\b':
        fputs("\\b", output);
        break;
      case '\f':
        fputs("\\f", output);
        break;
      case '\n':
        fputs("\\n", output);
        break;
      case '\r':
        fputs("\\r", output);
        break;
      case '\t':
        fputs("\\t", output);
        break;
      default:
        if (*cursor < 0x20) {
          fprintf(output, "\\u%04x", *cursor);
        } else {
          fputc(*cursor, output);
        }
        break;
    }

    cursor += 1;
  }

  fputc('"', output);
}

static void json_print_escaped(const char* value) {
  json_print_escaped_to(stdout, value);
}

static int start_track(Music_Emu* emu, int track_index) {
  const int safe_track_index = track_index >= 0 ? track_index : 0;
  const int track_count = gme_track_count(emu);
  if (safe_track_index >= track_count) {
    fprintf(stderr, "track index %d is out of range (count %d)\n", safe_track_index, track_count);
    return 1;
  }

  return fail_gme(gme_start_track(emu, safe_track_index));
}

static int ensure_native_audio_engine(void) {
  if (native_audio_engine) {
    return 0;
  }

  const AudioEngineConfig config = {
    .sample_rate = SAMPLE_RATE,
    .channel_count = CHANNEL_COUNT,
    .bytes_per_sample = sizeof(int16_t),
    .callback_frames = AUDIO_ENGINE_CALLBACK_FRAMES,
    .ring_buffer_frames = AUDIO_ENGINE_RING_BUFFER_FRAMES
  };

  const int result = audio_engine_create(&native_audio_engine, &config);
  if (result == 0) {
    audio_engine_set_volume(native_audio_engine, native_player.volume > 0.0f ? native_player.volume : 1.0f);
    audio_engine_set_equalizer(native_audio_engine, native_player.equalizer_enabled, native_player.equalizer_gains, EQUALIZER_BAND_COUNT);
  }
  return result;
}

static void native_player_reset_loaded_state_locked(void) {
  if (native_player.decoder) {
    native_decoder_destroy(native_player.decoder);
    native_player.decoder = NULL;
  }

  free(native_player.track_path);
  native_player.track_path = NULL;
  native_player.start_ms = 0;
  native_player.play_ms = 0;
  native_player.fade_ms = 0;
  native_player.speed_numerator = 1;
  native_player.speed_denominator = 1;
  native_player.decoded_frames = 0;
  native_player.nonzero_samples = 0;
  native_player.track_loaded = 0;
  native_player.decode_error = 0;
  native_player.reached_end = 0;
  native_player.transport_state = NATIVE_PLAYER_STOPPED;
}

static int ensure_native_player_runtime(void) {
  if (native_player.runtime_ready) {
    return 0;
  }

  if (pthread_mutex_init(&native_player.mutex, NULL) != 0) {
    return 1;
  }

  if (pthread_cond_init(&native_player.cond, NULL) != 0) {
    pthread_mutex_destroy(&native_player.mutex);
    return 1;
  }

  native_player.runtime_ready = 1;
  native_player.transport_state = NATIVE_PLAYER_STOPPED;
  native_player.speed_numerator = 1;
  native_player.speed_denominator = 1;
  return 0;
}

static int current_buffered_frames(void) {
  AudioEngineSnapshot snapshot;
  if (!native_audio_engine || audio_engine_snapshot(native_audio_engine, &snapshot) != 0) {
    return 0;
  }

  return (int) snapshot.buffered_frames;
}

static uint32_t transport_declick_frames(int duration_ms) {
  const int safe_duration_ms = duration_ms > 0 ? duration_ms : TRANSPORT_DECLICK_MS;
  return (uint32_t)(((uint64_t)safe_duration_ms * SAMPLE_RATE) / 1000);
}

static void native_player_timeout_from_now(struct timespec* timeout, long wait_ms) {
  clock_gettime(CLOCK_REALTIME, timeout);
  timeout->tv_nsec += wait_ms * 1000000L;
  timeout->tv_sec += timeout->tv_nsec / 1000000000L;
  timeout->tv_nsec %= 1000000000L;
}

static int prime_native_player_buffer_locked(int target_frames) {
  if (!native_player.decoder || !native_audio_engine) {
    return 1;
  }

  const int safe_target_frames = target_frames > 0 ? target_frames : NATIVE_PLAYER_PREROLL_FRAMES;
  int16_t sample_buffer[NATIVE_PLAYER_DECODE_CHUNK_FRAMES * CHANNEL_COUNT];

  while (!native_player.reached_end && current_buffered_frames() < safe_target_frames) {
    int requested_frames = NATIVE_PLAYER_DECODE_CHUNK_FRAMES;
    if (native_player.play_ms > 0) {
      const uint64_t total_frames = ((uint64_t)(native_player.play_ms + native_player.fade_ms) * SAMPLE_RATE) / 1000;
      if (native_player.decoded_frames >= total_frames) {
        native_player.reached_end = 1;
        break;
      }
      const uint64_t remaining = total_frames - native_player.decoded_frames;
      if (remaining < (uint64_t)requested_frames) requested_frames = (int)remaining;
    }

    int rendered_frames = requested_frames;
    if (native_decoder_render_s16(native_player.decoder, requested_frames, sample_buffer, &rendered_frames) != 0) {
      native_player.decode_error = 1;
      return 1;
    }

    if (rendered_frames <= 0) {
      native_player.reached_end = 1;
      break;
    }
    if (strcmp(native_player.decoder->backend_id, "libgme") != 0 && native_player.fade_ms > 0 && native_player.play_ms > 0) {
      const uint64_t fade_start = ((uint64_t)native_player.play_ms * SAMPLE_RATE) / 1000;
      const uint64_t fade_length = ((uint64_t)native_player.fade_ms * SAMPLE_RATE) / 1000;
      for (int frame = 0; frame < rendered_frames; frame += 1) {
        const uint64_t position = native_player.decoded_frames + (uint64_t)frame;
        if (position >= fade_start && fade_length > 0) {
          const uint64_t remaining = position >= fade_start + fade_length ? 0 : fade_start + fade_length - position;
          sample_buffer[frame * 2] = (int16_t)(((int32_t)sample_buffer[frame * 2] * (int64_t)remaining) / (int64_t)fade_length);
          sample_buffer[frame * 2 + 1] = (int16_t)(((int32_t)sample_buffer[frame * 2 + 1] * (int64_t)remaining) / (int64_t)fade_length);
        }
      }
    }
    const size_t bytes_to_write = (size_t)rendered_frames * CHANNEL_COUNT * sizeof(int16_t);
    for (int sample = 0; sample < rendered_frames * CHANNEL_COUNT; sample += 1) {
      if (sample_buffer[sample] != 0) native_player.nonzero_samples += 1;
    }
    const size_t bytes_written = audio_engine_enqueue_pcm(native_audio_engine, sample_buffer, bytes_to_write);
    if (bytes_written != bytes_to_write) {
      break;
    }
    native_player.decoded_frames += (uint64_t)rendered_frames;

    if (native_decoder_track_ended(native_player.decoder)) {
      native_player.reached_end = 1;
      break;
    }
  }

  return 0;
}

static void* native_player_decode_thread_main(void* unused) {
  (void) unused;

  for (;;) {
    pthread_mutex_lock(&native_player.mutex);
    while (
      !native_player.shutdown_requested &&
      (
        !native_player.track_loaded ||
        native_player.decode_error ||
        native_player.reached_end ||
        current_buffered_frames() >= NATIVE_PLAYER_HIGH_WATER_FRAMES
      )
    ) {
      struct timespec timeout;
      native_player_timeout_from_now(&timeout, NATIVE_PLAYER_REFILL_POLL_MS);
      pthread_cond_timedwait(&native_player.cond, &native_player.mutex, &timeout);
    }

    if (native_player.shutdown_requested) {
      pthread_mutex_unlock(&native_player.mutex);
      break;
    }

    (void) prime_native_player_buffer_locked(NATIVE_PLAYER_HIGH_WATER_FRAMES);
    pthread_mutex_unlock(&native_player.mutex);
  }

  return NULL;
}

static int ensure_native_player_thread(void) {
  if (ensure_native_player_runtime() != 0) {
    return 1;
  }

  if (native_player.thread_started) {
    return 0;
  }

  if (pthread_create(&native_player.thread, NULL, native_player_decode_thread_main, NULL) != 0) {
    return 1;
  }

  native_player.thread_started = 1;
  return 0;
}

static void close_native_player(void) {
  if (!native_player.runtime_ready) {
    close_native_audio_engine();
    return;
  }

  pthread_mutex_lock(&native_player.mutex);
  native_player.shutdown_requested = 1;
  pthread_cond_broadcast(&native_player.cond);
  pthread_mutex_unlock(&native_player.mutex);

  if (native_player.thread_started) {
    pthread_join(native_player.thread, NULL);
  }

  pthread_mutex_lock(&native_player.mutex);
  native_player_reset_loaded_state_locked();
  pthread_mutex_unlock(&native_player.mutex);

  if (native_audio_engine) {
    audio_engine_stop(native_audio_engine);
    audio_engine_clear_buffer(native_audio_engine);
    audio_engine_reset_counters(native_audio_engine);
  }

  close_native_audio_engine();
  pthread_cond_destroy(&native_player.cond);
  pthread_mutex_destroy(&native_player.mutex);
  memset(&native_player, 0, sizeof(native_player));
}

static int native_player_apply_playback_speed(NativeDecoder* decoder, int numerator, int denominator) {
  if (numerator <= 0 || denominator <= 0 || numerator > 1000000 || denominator > 1000000) {
    fprintf(stderr, "custom playback speed must use positive components no larger than 1000000\n");
    return 1;
  }
  if (numerator == denominator) return 0;
  if (!decoder || !decoder->backend_id || strcmp(decoder->backend_id, "libgme") != 0) {
    if (decoder && decoder->backend_id && strcmp(decoder->backend_id, "libvgm") == 0) {
      return native_libvgm_decoder_set_playback_speed(decoder, numerator, denominator);
    }
    fprintf(stderr, "custom playback speed is currently supported for libgme and libvgm tracks only\n");
    return 1;
  }
  return gme_decoder_set_tempo(decoder, numerator, denominator);
}

static int native_player_load_locked(const char* file_path, int track_index, int start_ms, int play_ms, int fade_ms, int speed_numerator, int speed_denominator) {
  // The DeSmuME-derived 2SF core owns process-global DS state. Destroy an
  // existing 2SF decoder before constructing its replacement; reversing this
  // order lets the old destructor tear down the new core.
  if (native_player.decoder && native_player.decoder->backend_id && strcmp(native_player.decoder->backend_id, "twosf") == 0) {
    native_player_reset_loaded_state_locked();
  }
  NativeDecoder* decoder = native_decoder_create(file_path, track_index);
  if (!decoder) return 1;
  if (native_decoder_configure(decoder, play_ms, fade_ms) != 0 ||
      native_player_apply_playback_speed(decoder, speed_numerator, speed_denominator) != 0 ||
      (start_ms > 0 && native_decoder_seek(decoder, start_ms) != 0)) {
    native_decoder_destroy(decoder);
    return 1;
  }

  char* track_path_copy = strdup(file_path);
  if (!track_path_copy) {
    native_decoder_destroy(decoder);
    return 1;
  }

  native_player_reset_loaded_state_locked();
  native_player.decoder = decoder;
  native_player.track_path = track_path_copy;
  native_player.start_ms = start_ms;
  native_player.play_ms = play_ms;
  native_player.fade_ms = fade_ms;
  native_player.speed_numerator = speed_numerator;
  native_player.speed_denominator = speed_denominator;
  native_player.track_loaded = 1;
  native_player.transport_state = NATIVE_PLAYER_PAUSED;
  native_player.decode_error = 0;
  native_player.reached_end = 0;
  native_player.decoded_frames = ((uint64_t)(start_ms > 0 ? start_ms : 0) * SAMPLE_RATE) / 1000;

  audio_engine_clear_buffer(native_audio_engine);
  audio_engine_reset_counters(native_audio_engine);

  return prime_native_player_buffer_locked(NATIVE_PLAYER_PREROLL_FRAMES);
}

static int native_player_seek_locked(int start_ms) {
  if (!native_player.track_loaded || !native_player.decoder) {
    return 1;
  }

  if (native_decoder_seek(native_player.decoder, start_ms) != 0) {
    return 1;
  }
  if (native_decoder_configure(native_player.decoder, native_player.play_ms, native_player.fade_ms) != 0) {
    return 1;
  }

  native_player.start_ms = start_ms;
  native_player.decode_error = 0;
  native_player.reached_end = 0;
  audio_engine_clear_buffer(native_audio_engine);
  audio_engine_reset_counters(native_audio_engine);
  return prime_native_player_buffer_locked(NATIVE_PLAYER_PREROLL_FRAMES);
}

static int native_player_snapshot_to_json(char** json_output) {
  if (!json_output) {
    return 1;
  }

  AudioEngineSnapshot snapshot;
  memset(&snapshot, 0, sizeof(snapshot));
  snapshot.state = AUDIO_ENGINE_STATE_UNINITIALIZED;
  snapshot.sample_rate = SAMPLE_RATE;
  snapshot.channel_count = CHANNEL_COUNT;
  snapshot.callback_frames = AUDIO_ENGINE_CALLBACK_FRAMES;
  snapshot.ring_buffer_frames = AUDIO_ENGINE_RING_BUFFER_FRAMES;

  if (native_audio_engine && audio_engine_snapshot(native_audio_engine, &snapshot) != 0) {
    return 1;
  }

  pthread_mutex_lock(&native_player.mutex);
  const int track_loaded = native_player.track_loaded;
  const int decode_error = native_player.decode_error;
  const int reached_end = native_player.reached_end;
  const int start_ms = native_player.start_ms;
  const int play_ms = native_player.play_ms;
  const int fade_ms = native_player.fade_ms;
  const int speed_numerator = native_player.speed_numerator;
  const int speed_denominator = native_player.speed_denominator;
  const uint64_t nonzero_samples = native_player.nonzero_samples;
  const NativePlayerTransportState transport_state = (
    track_loaded &&
    reached_end &&
    snapshot.buffered_frames == 0 &&
    snapshot.frames_supplied > 0
  )
    ? NATIVE_PLAYER_ENDED
    : native_player.transport_state;
  pthread_mutex_unlock(&native_player.mutex);

  // frames_requested is the hardware playback clock. frames_supplied is the
  // amount removed from the refill ring and can lead or stall the audible
  // position while the buffer is being filled or underruns.
  const long long position_ms = (long long) start_ms + (long long) ((snapshot.frames_requested * 1000ULL) / SAMPLE_RATE);
  const char* transport_state_name = native_player_transport_state_name(transport_state);
  const char* output_state_name = audio_engine_state_name(snapshot.state);
  const int json_length = snprintf(
    NULL,
    0,
    "{\"transport_state\":\"%s\",\"output_state\":\"%s\",\"track_loaded\":%s,\"decode_error\":%s,\"reached_end\":%s,\"sample_rate\":%.0f,\"channel_count\":%u,\"callback_frames\":%u,\"ring_buffer_frames\":%u,\"buffered_frames\":%u,\"callback_count\":%llu,\"underrun_count\":%llu,\"frames_requested\":%llu,\"frames_supplied\":%llu,\"nonzero_samples\":%llu,\"position_ms\":%lld,\"start_ms\":%d,\"play_ms\":%d,\"fade_ms\":%d,\"speed_numerator\":%d,\"speed_denominator\":%d}",
    transport_state_name,
    output_state_name,
    track_loaded ? "true" : "false",
    decode_error ? "true" : "false",
    reached_end ? "true" : "false",
    snapshot.sample_rate,
    snapshot.channel_count,
    snapshot.callback_frames,
    snapshot.ring_buffer_frames,
    snapshot.buffered_frames,
    (unsigned long long) snapshot.callback_count,
    (unsigned long long) snapshot.underrun_count,
    (unsigned long long) snapshot.frames_requested,
    (unsigned long long) snapshot.frames_supplied,
    (unsigned long long) nonzero_samples,
    position_ms,
    start_ms,
    play_ms,
    fade_ms,
    speed_numerator,
    speed_denominator
  );
  if (json_length < 0) {
    return 1;
  }

  char* json = (char*) malloc((size_t) json_length + 1);
  if (!json) {
    return 1;
  }

  snprintf(
    json,
    (size_t) json_length + 1,
    "{\"transport_state\":\"%s\",\"output_state\":\"%s\",\"track_loaded\":%s,\"decode_error\":%s,\"reached_end\":%s,\"sample_rate\":%.0f,\"channel_count\":%u,\"callback_frames\":%u,\"ring_buffer_frames\":%u,\"buffered_frames\":%u,\"callback_count\":%llu,\"underrun_count\":%llu,\"frames_requested\":%llu,\"frames_supplied\":%llu,\"nonzero_samples\":%llu,\"position_ms\":%lld,\"start_ms\":%d,\"play_ms\":%d,\"fade_ms\":%d,\"speed_numerator\":%d,\"speed_denominator\":%d}",
    transport_state_name,
    output_state_name,
    track_loaded ? "true" : "false",
    decode_error ? "true" : "false",
    reached_end ? "true" : "false",
    snapshot.sample_rate,
    snapshot.channel_count,
    snapshot.callback_frames,
    snapshot.ring_buffer_frames,
    snapshot.buffered_frames,
    (unsigned long long) snapshot.callback_count,
    (unsigned long long) snapshot.underrun_count,
    (unsigned long long) snapshot.frames_requested,
    (unsigned long long) snapshot.frames_supplied,
    (unsigned long long) nonzero_samples,
    position_ms,
    start_ms,
    play_ms,
    fade_ms,
    speed_numerator,
    speed_denominator
  );

  *json_output = json;
  return 0;
}

static int is_highlycomplete_path(const char* file_path) {
  const char* extension = strrchr(file_path, '.');
  return extension && (!strcasecmp(extension, ".gsf") || !strcasecmp(extension, ".minigsf"));
}

static int is_play_psf_path(const char* file_path) {
  const char* extension = strrchr(file_path, '.');
  return extension && (
    !strcasecmp(extension, ".psf") || !strcasecmp(extension, ".minipsf") ||
    !strcasecmp(extension, ".psf2") || !strcasecmp(extension, ".minipsf2")
  );
}

static int is_twosf_path(const char* file_path) {
  const char* extension = strrchr(file_path, '.');
  return extension && (!strcasecmp(extension, ".2sf") || !strcasecmp(extension, ".mini2sf"));
}

static int is_vgmstream_path(const char* file_path) {
  const char* extension = strrchr(file_path, '.');
  if (!extension) return 0;
  const char* supported[] = { ".aa3", ".adx", ".ads", ".aifc", ".adpcm", ".at3", ".aus", ".bnk", ".fsb", ".genh", ".int", ".mib", ".msf", ".mtaf", ".ogg", ".rws", ".ss2", ".stream", ".svag", ".vag", ".xa", ".hd", ".hbd", ".iecs", ".txtp" };
  for (size_t index = 0; index < sizeof(supported) / sizeof(supported[0]); index += 1) if (!strcasecmp(extension, supported[index])) return 1;
  return 0;
}

static int inspect_vgmstream_to_json(const char* file_path, char** json_output) {
  char* error = NULL;
  vgmstream_player_handle_t player = vgmstream_player_create(file_path, SAMPLE_RATE, 1, &error);
  if (!player) { if (error) { fprintf(stderr, "%s\n", error); free(error); } return 1; }
  vgmstream_metadata_t metadata;
  memset(&metadata, 0, sizeof(metadata));
  if (vgmstream_player_read_metadata(player, &metadata, &error) != 0) { if (error) { fprintf(stderr, "%s\n", error); free(error); } vgmstream_player_destroy(player); return 1; }
  FILE* stream = open_memstream(json_output, &(size_t){0});
  if (!stream) { vgmstream_metadata_clear(&metadata); vgmstream_player_destroy(player); return 1; }
  fputs("{\"system\":", stream); json_print_escaped_to(stream, metadata.system);
  fputs(",\"game\":\"\",\"song\":", stream); json_print_escaped_to(stream, metadata.title);
  fputs(",\"author\":\"\",\"comment\":", stream); json_print_escaped_to(stream, metadata.comment);
  fprintf(stream, ",\"sample_rate\":%d,\"length\":%lld,\"intro_length\":0,\"loop_length\":%lld,\"play_length\":%lld,\"fade_length\":0,\"track_count\":%d}", metadata.sample_rate, (long long)(metadata.play_length_frames * 1000 / metadata.sample_rate), (long long)(metadata.loop_length_frames * 1000 / metadata.sample_rate), (long long)(metadata.play_length_frames * 1000 / metadata.sample_rate), metadata.track_count);
  int result = fclose(stream) == 0 ? 0 : 1;
  vgmstream_metadata_clear(&metadata);
  vgmstream_player_destroy(player);
  return result;
}

static int inspect_twosf_to_json(const char* file_path, char** json_output) {
  twosf_metadata_t metadata;
  memset(&metadata, 0, sizeof(metadata));
  char* error = NULL;
  if (twosf_inspect_metadata(file_path, &metadata, &error) != 0) {
    if (error) { fprintf(stderr, "%s\n", error); free(error); }
    return 1;
  }
  FILE* stream = open_memstream(json_output, &(size_t){0});
  if (!stream) { twosf_metadata_clear(&metadata); return 1; }
  fputs("{\"system\":", stream); json_print_escaped_to(stream, metadata.system);
  fputs(",\"game\":", stream); json_print_escaped_to(stream, metadata.game);
  fputs(",\"song\":", stream); json_print_escaped_to(stream, metadata.title);
  fputs(",\"author\":", stream); json_print_escaped_to(stream, metadata.artist);
  fprintf(stream, ",\"length\":%d,\"intro_length\":0,\"loop_length\":0,\"play_length\":%d,\"fade_length\":%d}", metadata.play_length_ms, metadata.play_length_ms, metadata.fade_length_ms);
  int result = fclose(stream) == 0 ? 0 : 1;
  twosf_metadata_clear(&metadata);
  return result;
}

static int inspect_play_psf_to_json(const char* file_path, char** json_output) {
  void* metadata = spcboy_play_psf_metadata_open(file_path);
  if (!metadata) return 1;
  FILE* stream = open_memstream(json_output, &(size_t){0});
  if (!stream) {
    spcboy_play_psf_metadata_close(metadata);
    return 1;
  }
  const int64_t length_ms = spcboy_play_psf_metadata_play_length_frames(metadata) * 1000 / SAMPLE_RATE;
  const int64_t fade_ms = spcboy_play_psf_metadata_fade_length_frames(metadata) * 1000 / SAMPLE_RATE;
  fputs("{\"system\":", stream); json_print_escaped_to(stream, spcboy_play_psf_metadata_system_name(metadata));
  fputs(",\"game\":", stream); json_print_escaped_to(stream, spcboy_play_psf_metadata_tag(metadata, "game"));
  fputs(",\"song\":", stream); json_print_escaped_to(stream, spcboy_play_psf_metadata_tag(metadata, "title"));
  fputs(",\"author\":", stream); json_print_escaped_to(stream, spcboy_play_psf_metadata_tag(metadata, "artist"));
  fputs(",\"comment\":", stream); json_print_escaped_to(stream, spcboy_play_psf_metadata_tag(metadata, "comment"));
  fprintf(stream, ",\"length\":%lld,\"intro_length\":0,\"loop_length\":0,\"play_length\":%lld,\"fade_length\":%lld}",
    (long long)length_ms, (long long)length_ms, (long long)fade_ms);
  const int result = fclose(stream) == 0 ? 0 : 1;
  spcboy_play_psf_metadata_close(metadata);
  return result;
}

static int inspect_highlycomplete_to_json(const char* file_path, char** json_output) {
  highlycomplete_metadata_t metadata;
  memset(&metadata, 0, sizeof(metadata));
  char* error = NULL;
  highlycomplete_player_handle_t player = highlycomplete_player_create(file_path, SAMPLE_RATE, 0, &error);
  if (!player) {
    if (error) { fprintf(stderr, "%s\n", error); free(error); }
    return 1;
  }
  if (highlycomplete_player_read_metadata(player, &metadata, &error) != 0) {
    if (error) { fprintf(stderr, "%s\n", error); free(error); }
    highlycomplete_player_destroy(player);
    return 1;
  }
  FILE* stream = open_memstream(json_output, &(size_t){0});
  if (!stream) {
    highlycomplete_metadata_clear(&metadata);
    highlycomplete_player_destroy(player);
    return 1;
  }
  fputs("{\"system\":", stream); json_print_escaped_to(stream, metadata.system);
  fputs(",\"game\":", stream); json_print_escaped_to(stream, metadata.game);
  fputs(",\"song\":", stream); json_print_escaped_to(stream, metadata.title);
  fputs(",\"author\":", stream); json_print_escaped_to(stream, metadata.artist);
  fprintf(stream, ",\"length\":%d,\"intro_length\":%d,\"loop_length\":%d,\"play_length\":%d,\"fade_length\":%d}", metadata.play_length_ms, metadata.intro_length_ms, metadata.loop_length_ms, metadata.play_length_ms, metadata.fade_length_ms);
  int result = fclose(stream) == 0 ? 0 : 1;
  highlycomplete_metadata_clear(&metadata);
  highlycomplete_player_destroy(player);
  return result;
}

static int inspect_file(const char* file_path) {
  if (is_play_psf_path(file_path)) {
    char* json = NULL;
    int result = inspect_play_psf_to_json(file_path, &json);
    if (result == 0 && json != NULL) { fputs(json, stdout); fputc('\n', stdout); }
    free(json);
    return result;
  }
  if (is_highlycomplete_path(file_path)) {
    char* json = NULL;
    int result = inspect_highlycomplete_to_json(file_path, &json);
    if (result == 0 && json != NULL) { fputs(json, stdout); fputc('\n', stdout); }
    free(json);
    return result;
  }
  if (is_twosf_path(file_path)) {
    char* json = NULL;
    int result = inspect_twosf_to_json(file_path, &json);
    if (result == 0 && json != NULL) { fputs(json, stdout); fputc('\n', stdout); }
    free(json);
    return result;
  }
  if (is_vgmstream_path(file_path)) {
    char* json = NULL;
    int result = inspect_vgmstream_to_json(file_path, &json);
    if (result == 0 && json != NULL) { fputs(json, stdout); fputc('\n', stdout); }
    free(json);
    return result;
  }
  Music_Emu* emu = NULL;
  gme_info_t* info = NULL;
  gme_err_t error = gme_open_file(file_path, &emu, gme_info_only);
  if (fail_gme(error)) {
    return 1;
  }

  error = gme_track_info(emu, &info, 0);
  if (fail_gme(error)) {
    gme_delete(emu);
    return 1;
  }

  fputs("{", stdout);
  fputs("\"system\":", stdout);
  json_print_escaped(info->system);
  fputs(",\"game\":", stdout);
  json_print_escaped(info->game);
  fputs(",\"song\":", stdout);
  json_print_escaped(info->song);
  fputs(",\"author\":", stdout);
  json_print_escaped(info->author);
  fprintf(
    stdout,
    ",\"length\":%d,\"intro_length\":%d,\"loop_length\":%d,\"play_length\":%d,\"fade_length\":%d}\n",
    info->length,
    info->intro_length,
    info->loop_length,
    info->play_length,
    info->fade_length
  );

  gme_free_info(info);
  gme_delete(emu);
  return ferror(stdout) ? fail_message("failed writing inspect output") : 0;
}

static int inspect_file_to_json(const char* file_path, char** json_output) {
  if (is_play_psf_path(file_path)) return inspect_play_psf_to_json(file_path, json_output);
  if (is_highlycomplete_path(file_path)) return inspect_highlycomplete_to_json(file_path, json_output);
  if (is_twosf_path(file_path)) return inspect_twosf_to_json(file_path, json_output);
  if (is_vgmstream_path(file_path)) return inspect_vgmstream_to_json(file_path, json_output);
  Music_Emu* emu = NULL;
  gme_info_t* info = NULL;
  int result = 1;
  char* json = NULL;
  gme_err_t error = gme_open_file(file_path, &emu, gme_info_only);
  if (error) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }

  error = gme_track_info(emu, &info, 0);
  if (error) {
    fprintf(stderr, "%s\n", error);
    gme_delete(emu);
    return 1;
  }

  FILE* stream = open_memstream(&json, &(size_t){0});
  if (!stream) {
    gme_free_info(info);
    gme_delete(emu);
    return fail_message("failed to allocate inspect output buffer");
  }

  fputs("{", stream);
  fputs("\"system\":", stream);
  {
    FILE* previous_stdout = stdout;
    stdout = stream;
    json_print_escaped(info->system);
    fputs(",\"game\":", stdout);
    json_print_escaped(info->game);
    fputs(",\"song\":", stdout);
    json_print_escaped(info->song);
    fputs(",\"author\":", stdout);
    json_print_escaped(info->author);
    fprintf(
      stdout,
      ",\"length\":%d,\"intro_length\":%d,\"loop_length\":%d,\"play_length\":%d,\"fade_length\":%d}",
      info->length,
      info->intro_length,
      info->loop_length,
      info->play_length,
      info->fade_length
    );
    stdout = previous_stdout;
  }

  if (fclose(stream) != 0 || !json) {
    free(json);
    json = NULL;
    goto cleanup;
  }

  *json_output = json;
  json = NULL;
  result = 0;

cleanup:
  free(json);
  gme_free_info(info);
  gme_delete(emu);
  return result;
}

static int inspect_vgmstream_all_to_json(const char* file_path, char** json_output) {
  char* error = NULL;
  vgmstream_player_handle_t first = vgmstream_player_create(file_path, SAMPLE_RATE, 1, &error);
  if (!first) { free(error); return 1; }
  vgmstream_metadata_t first_metadata;
  memset(&first_metadata, 0, sizeof(first_metadata));
  if (vgmstream_player_read_metadata(first, &first_metadata, &error) != 0) { free(error); vgmstream_player_destroy(first); return 1; }
  const int track_count = first_metadata.track_count > 0 ? first_metadata.track_count : 1;
  FILE* stream = open_memstream(json_output, &(size_t){0});
  if (!stream) { vgmstream_metadata_clear(&first_metadata); vgmstream_player_destroy(first); return 1; }
  fprintf(stream, "{\"track_count\":%d,\"tracks\":[", track_count);
  for (int index = 1; index <= track_count; index += 1) {
    vgmstream_player_handle_t player = index == 1 ? first : vgmstream_player_create(file_path, SAMPLE_RATE, index, &error);
    vgmstream_metadata_t metadata;
    memset(&metadata, 0, sizeof(metadata));
    if (!player || vgmstream_player_read_metadata(player, &metadata, &error) != 0) {
      if (player && player != first) vgmstream_player_destroy(player);
      fclose(stream); vgmstream_metadata_clear(&first_metadata); vgmstream_player_destroy(first); free(error); return 1;
    }
    if (index > 1) vgmstream_player_destroy(player);
    if (index > 1) fputc(',', stream);
    fputs("{\"system\":", stream); json_print_escaped_to(stream, metadata.system);
    fputs(",\"game\":\"\",\"song\":", stream); json_print_escaped_to(stream, metadata.title);
    fputs(",\"author\":\"\",\"comment\":", stream); json_print_escaped_to(stream, metadata.comment);
    fprintf(stream, ",\"sample_rate\":%d,\"length\":%lld,\"intro_length\":0,\"loop_length\":%lld,\"play_length\":%lld,\"fade_length\":0}", metadata.sample_rate, (long long)(metadata.play_length_frames * 1000 / metadata.sample_rate), (long long)(metadata.loop_length_frames * 1000 / metadata.sample_rate), (long long)(metadata.play_length_frames * 1000 / metadata.sample_rate));
    vgmstream_metadata_clear(&metadata);
  }
  fputs("]}", stream);
  int result = fclose(stream) == 0 ? 0 : 1;
  vgmstream_metadata_clear(&first_metadata);
  vgmstream_player_destroy(first);
  return result;
}

static void write_track_info_json(FILE* stream, gme_info_t* info) {
  fputs("{\"system\":", stream);
  json_print_escaped_to(stream, info->system);
  fputs(",\"game\":", stream);
  json_print_escaped_to(stream, info->game);
  fputs(",\"song\":", stream);
  json_print_escaped_to(stream, info->song);
  fputs(",\"author\":", stream);
  json_print_escaped_to(stream, info->author);
  fprintf(
    stream,
    ",\"length\":%d,\"intro_length\":%d,\"loop_length\":%d,\"play_length\":%d,\"fade_length\":%d}",
    info->length,
    info->intro_length,
    info->loop_length,
    info->play_length,
    info->fade_length
  );
}

static int inspect_file_all_to_json(const char* file_path, char** json_output) {
  if (is_play_psf_path(file_path)) {
    char* track = NULL;
    if (inspect_play_psf_to_json(file_path, &track) != 0 || !track) { free(track); return 1; }
    FILE* stream = open_memstream(json_output, &(size_t){0});
    if (!stream) { free(track); return 1; }
    fprintf(stream, "{\"track_count\":1,\"tracks\":[%s]}", track);
    free(track);
    return fclose(stream) == 0 ? 0 : 1;
  }
  if (is_twosf_path(file_path)) {
    char* track = NULL;
    if (inspect_twosf_to_json(file_path, &track) != 0 || !track) { free(track); return 1; }
    FILE* stream = open_memstream(json_output, &(size_t){0});
    if (!stream) { free(track); return 1; }
    fprintf(stream, "{\"track_count\":1,\"tracks\":[%s]}", track);
    free(track);
    return fclose(stream) == 0 ? 0 : 1;
  }
  Music_Emu* emu = NULL;
  char* json = NULL;
  size_t json_length = 0;
  gme_err_t error = gme_open_file(file_path, &emu, gme_info_only);
  if (error) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }

  const int track_count = gme_track_count(emu) > 0 ? gme_track_count(emu) : 1;
  FILE* stream = open_memstream(&json, &json_length);
  if (!stream) {
    gme_delete(emu);
    return fail_message("failed to allocate inspect output buffer");
  }

  fprintf(stream, "{\"track_count\":%d,\"tracks\":[", track_count);
  for (int track_index = 0; track_index < track_count; track_index += 1) {
    gme_info_t* info = NULL;
    error = gme_track_info(emu, &info, track_index);
    if (error || !info) {
      if (info) gme_free_info(info);
      fclose(stream);
      free(json);
      gme_delete(emu);
      if (error) fprintf(stderr, "%s\n", error);
      return 1;
    }

    if (track_index > 0) fputc(',', stream);
    write_track_info_json(stream, info);
    gme_free_info(info);
  }
  fputs("]}", stream);

  if (fclose(stream) != 0 || !json) {
    free(json);
    gme_delete(emu);
    return 1;
  }

  *json_output = json;
  gme_delete(emu);
  return 0;
}

static void write_le16(uint8_t* destination, uint16_t value) {
  destination[0] = (uint8_t) (value & 0xff);
  destination[1] = (uint8_t) ((value >> 8) & 0xff);
}

static void write_le32(uint8_t* destination, uint32_t value) {
  destination[0] = (uint8_t) (value & 0xff);
  destination[1] = (uint8_t) ((value >> 8) & 0xff);
  destination[2] = (uint8_t) ((value >> 16) & 0xff);
  destination[3] = (uint8_t) ((value >> 24) & 0xff);
}

static int write_wav_header(uint32_t pcm_byte_length) {
  uint8_t header[44];
  const uint32_t byte_rate = SAMPLE_RATE * CHANNEL_COUNT * sizeof(int16_t);
  const uint16_t block_align = CHANNEL_COUNT * sizeof(int16_t);

  memcpy(header + 0, "RIFF", 4);
  write_le32(header + 4, 36 + pcm_byte_length);
  memcpy(header + 8, "WAVEfmt ", 8);
  write_le32(header + 16, 16);
  write_le16(header + 20, 1);
  write_le16(header + 22, CHANNEL_COUNT);
  write_le32(header + 24, SAMPLE_RATE);
  write_le32(header + 28, byte_rate);
  write_le16(header + 32, block_align);
  write_le16(header + 34, 16);
  memcpy(header + 36, "data", 4);
  write_le32(header + 40, pcm_byte_length);

  return fwrite(header, 1, sizeof(header), stdout) == sizeof(header) ? 0 : 1;
}

static int is_native_pcm_path(const char* file_path) {
  return is_highlycomplete_path(file_path) || is_twosf_path(file_path) || is_vgmstream_path(file_path) || is_play_psf_path(file_path);
}

static void apply_native_fade(int16_t* samples, int frame_count, int start_ms, int play_ms, int fade_ms) {
  if (!samples || frame_count <= 0 || play_ms <= 0 || fade_ms <= 0) return;
  const int64_t start_frame = (int64_t)start_ms * SAMPLE_RATE / 1000;
  const int64_t fade_start = (int64_t)play_ms * SAMPLE_RATE / 1000;
  const int64_t fade_length = (int64_t)fade_ms * SAMPLE_RATE / 1000;
  for (int frame = 0; frame < frame_count; frame += 1) {
    const int64_t position = start_frame + frame;
    if (position < fade_start) continue;
    const int64_t remaining = position >= fade_start + fade_length ? 0 : fade_start + fade_length - position;
    samples[frame * 2] = (int16_t)(((int32_t)samples[frame * 2] * remaining) / fade_length);
    samples[frame * 2 + 1] = (int16_t)(((int32_t)samples[frame * 2 + 1] * remaining) / fade_length);
  }
}

static int decode_native_file_to_pcm(
  const char* file_path,
  int track_index,
  int start_ms,
  int play_ms,
  int fade_ms,
  uint8_t** pcm_output,
  size_t* pcm_length
) {
  NativeDecoder* decoder = native_decoder_create(file_path, track_index);
  if (!decoder) return 1;
  if (native_decoder_configure(decoder, play_ms, fade_ms) != 0 ||
      (start_ms > 0 && native_decoder_seek(decoder, start_ms) != 0)) {
    native_decoder_destroy(decoder);
    return 1;
  }
  const int total_ms = play_ms > 0 && fade_ms >= 0 ? play_ms + fade_ms : 0;
  const int remaining_ms = total_ms > start_ms ? total_ms - start_ms : 0;
  const int frame_count = remaining_ms > 0
    ? (int)(((int64_t)remaining_ms * SAMPLE_RATE + 999) / 1000)
    : 1;
  const size_t byte_capacity = (size_t)frame_count * CHANNEL_COUNT * sizeof(int16_t);
  int16_t* samples = (int16_t*)calloc(1, byte_capacity);
  if (!samples) {
    native_decoder_destroy(decoder);
    return fail_message("failed to allocate native decode buffer");
  }
  int rendered_total = 0;
  while (rendered_total < frame_count) {
    int rendered = 0;
    const int requested = frame_count - rendered_total;
    if (native_decoder_render_s16(decoder, requested, samples + rendered_total * CHANNEL_COUNT, &rendered) != 0) {
      free(samples);
      native_decoder_destroy(decoder);
      return 1;
    }
    if (rendered <= 0) break;
    rendered_total += rendered;
    if (native_decoder_track_ended(decoder)) break;
  }
  native_decoder_destroy(decoder);
  if (rendered_total <= 0) {
    free(samples);
    return 1;
  }
  apply_native_fade(samples, rendered_total, start_ms, play_ms, fade_ms);
  *pcm_output = (uint8_t*)samples;
  *pcm_length = (size_t)rendered_total * CHANNEL_COUNT * sizeof(int16_t);
  return 0;
}

static int decode_file(const char* file_path, int track_index, int start_ms, int play_ms, int fade_ms) {
  if (is_native_pcm_path(file_path)) {
    uint8_t* pcm = NULL;
    size_t pcm_length = 0;
    if (decode_native_file_to_pcm(file_path, track_index, start_ms, play_ms, fade_ms, &pcm, &pcm_length) != 0) return 1;
    const int result = write_wav_header((uint32_t)pcm_length) == 0 && fwrite(pcm, 1, pcm_length, stdout) == pcm_length ? 0 : 1;
    free(pcm);
    return result;
  }
  Music_Emu* emu = NULL;
  gme_err_t error = gme_open_file(file_path, &emu, SAMPLE_RATE);
  if (fail_gme(error)) {
    return 1;
  }

  gme_set_autoload_playback_limit(emu, 0);
  gme_ignore_silence(emu, 1);

  if (start_track(emu, track_index) != 0) {
    gme_delete(emu);
    return 1;
  }

  if (play_ms > 0 && fade_ms >= 0) {
    gme_set_fade_msecs(emu, play_ms, fade_ms);
  }

  if (start_ms > 0) {
    error = gme_seek(emu, start_ms);
    if (fail_gme(error)) {
      gme_delete(emu);
      return 1;
    }
  }

  const int total_ms = play_ms > 0 && fade_ms >= 0 ? play_ms + fade_ms : 0;
  const int remaining_ms = total_ms > start_ms ? total_ms - start_ms : 0;
  const int frame_count = remaining_ms > 0
    ? (int) (((int64_t) remaining_ms * SAMPLE_RATE + 999) / 1000)
    : 1;
  const uint32_t sample_count = (uint32_t) frame_count * CHANNEL_COUNT;
  const uint32_t pcm_byte_length = sample_count * sizeof(int16_t);
  int16_t* sample_buffer = (int16_t*) malloc(pcm_byte_length);
  if (!sample_buffer) {
    gme_delete(emu);
    return fail_message("failed to allocate decode buffer");
  }

  error = gme_play(emu, (int) sample_count, sample_buffer);
  if (fail_gme(error)) {
    free(sample_buffer);
    gme_delete(emu);
    return 1;
  }

  if (write_wav_header(pcm_byte_length) != 0) {
    free(sample_buffer);
    gme_delete(emu);
    return fail_message("failed writing wav header");
  }

  if (fwrite(sample_buffer, sizeof(int16_t), sample_count, stdout) != sample_count) {
    free(sample_buffer);
    gme_delete(emu);
    return fail_message("failed writing wav samples");
  }

  free(sample_buffer);
  gme_delete(emu);
  return ferror(stdout) ? fail_message("decode stream write failed") : 0;
}

static int decode_file_to_wav(
  const char* file_path,
  int track_index,
  int start_ms,
  int play_ms,
  int fade_ms,
  uint8_t** wav_output,
  size_t* wav_length
) {
  if (is_native_pcm_path(file_path)) {
    uint8_t* native_pcm = NULL;
    size_t native_pcm_length = 0;
    if (decode_native_file_to_pcm(file_path, track_index, start_ms, play_ms, fade_ms, &native_pcm, &native_pcm_length) != 0) return 1;
    const size_t total_byte_length = native_pcm_length + 44;
    uint8_t* wav_buffer = (uint8_t*)malloc(total_byte_length);
    if (!wav_buffer) { free(native_pcm); return fail_message("failed to allocate native wav buffer"); }
    memcpy(wav_buffer + 0, "RIFF", 4);
    write_le32(wav_buffer + 4, 36 + (uint32_t)native_pcm_length);
    memcpy(wav_buffer + 8, "WAVEfmt ", 8);
    write_le32(wav_buffer + 16, 16);
    write_le16(wav_buffer + 20, 1);
    write_le16(wav_buffer + 22, CHANNEL_COUNT);
    write_le32(wav_buffer + 24, SAMPLE_RATE);
    write_le32(wav_buffer + 28, SAMPLE_RATE * CHANNEL_COUNT * sizeof(int16_t));
    write_le16(wav_buffer + 32, CHANNEL_COUNT * sizeof(int16_t));
    write_le16(wav_buffer + 34, 16);
    memcpy(wav_buffer + 36, "data", 4);
    write_le32(wav_buffer + 40, (uint32_t)native_pcm_length);
    memcpy(wav_buffer + 44, native_pcm, native_pcm_length);
    free(native_pcm);
    *wav_output = wav_buffer;
    *wav_length = total_byte_length;
    return 0;
  }
  Music_Emu* emu = NULL;
  int16_t* sample_buffer = NULL;
  uint8_t* wav_buffer = NULL;
  gme_err_t error = gme_open_file(file_path, &emu, SAMPLE_RATE);
  if (error) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }

  gme_set_autoload_playback_limit(emu, 0);
  gme_ignore_silence(emu, 1);

  if (start_track(emu, track_index) != 0) {
    gme_delete(emu);
    return 1;
  }

  if (play_ms > 0 && fade_ms >= 0) {
    gme_set_fade_msecs(emu, play_ms, fade_ms);
  }

  if (start_ms > 0) {
    error = gme_seek(emu, start_ms);
    if (error) {
      fprintf(stderr, "%s\n", error);
      gme_delete(emu);
      return 1;
    }
  }

  const int total_ms = play_ms > 0 && fade_ms >= 0 ? play_ms + fade_ms : 0;
  const int remaining_ms = total_ms > start_ms ? total_ms - start_ms : 0;
  const int frame_count = remaining_ms > 0
    ? (int) (((int64_t) remaining_ms * SAMPLE_RATE + 999) / 1000)
    : 1;
  const uint32_t sample_count = (uint32_t) frame_count * CHANNEL_COUNT;
  const uint32_t pcm_byte_length = sample_count * sizeof(int16_t);
  const size_t total_byte_length = (size_t) pcm_byte_length + 44;
  sample_buffer = (int16_t*) malloc(pcm_byte_length);
  wav_buffer = (uint8_t*) malloc(total_byte_length);
  if (!sample_buffer || !wav_buffer) {
    free(sample_buffer);
    free(wav_buffer);
    gme_delete(emu);
    return fail_message("failed to allocate decode buffer");
  }

  error = gme_play(emu, (int) sample_count, sample_buffer);
  if (error) {
    fprintf(stderr, "%s\n", error);
    free(sample_buffer);
    free(wav_buffer);
    gme_delete(emu);
    return 1;
  }

  memcpy(wav_buffer + 0, "RIFF", 4);
  write_le32(wav_buffer + 4, 36 + pcm_byte_length);
  memcpy(wav_buffer + 8, "WAVEfmt ", 8);
  write_le32(wav_buffer + 16, 16);
  write_le16(wav_buffer + 20, 1);
  write_le16(wav_buffer + 22, CHANNEL_COUNT);
  write_le32(wav_buffer + 24, SAMPLE_RATE);
  write_le32(wav_buffer + 28, SAMPLE_RATE * CHANNEL_COUNT * sizeof(int16_t));
  write_le16(wav_buffer + 32, CHANNEL_COUNT * sizeof(int16_t));
  write_le16(wav_buffer + 34, 16);
  memcpy(wav_buffer + 36, "data", 4);
  write_le32(wav_buffer + 40, pcm_byte_length);
  memcpy(wav_buffer + 44, sample_buffer, pcm_byte_length);

  *wav_output = wav_buffer;
  *wav_length = total_byte_length;
  free(sample_buffer);
  gme_delete(emu);
  return 0;
}

static int decode_file_to_pcm(
  const char* file_path,
  int track_index,
  int start_ms,
  int play_ms,
  int fade_ms,
  uint8_t** pcm_output,
  size_t* pcm_length
) {
  if (is_native_pcm_path(file_path)) {
    return decode_native_file_to_pcm(file_path, track_index, start_ms, play_ms, fade_ms, pcm_output, pcm_length);
  }
  Music_Emu* emu = NULL;
  int16_t* sample_buffer = NULL;
  gme_err_t error = gme_open_file(file_path, &emu, SAMPLE_RATE);
  if (error) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }

  gme_set_autoload_playback_limit(emu, 0);
  gme_ignore_silence(emu, 1);

  if (start_track(emu, track_index) != 0) {
    gme_delete(emu);
    return 1;
  }

  if (play_ms > 0 && fade_ms >= 0) {
    gme_set_fade_msecs(emu, play_ms, fade_ms);
  }

  if (start_ms > 0) {
    error = gme_seek(emu, start_ms);
    if (error) {
      fprintf(stderr, "%s\n", error);
      gme_delete(emu);
      return 1;
    }
  }

  const int total_ms = play_ms > 0 && fade_ms >= 0 ? play_ms + fade_ms : 0;
  const int remaining_ms = total_ms > start_ms ? total_ms - start_ms : 0;
  const int frame_count = remaining_ms > 0
    ? (int) (((int64_t) remaining_ms * SAMPLE_RATE + 999) / 1000)
    : 1;
  const uint32_t sample_count = (uint32_t) frame_count * CHANNEL_COUNT;
  const uint32_t pcm_byte_length = sample_count * sizeof(int16_t);

  sample_buffer = (int16_t*) malloc(pcm_byte_length);
  if (!sample_buffer) {
    gme_delete(emu);
    return fail_message("failed to allocate decode buffer");
  }

  error = gme_play(emu, (int) sample_count, sample_buffer);
  if (error) {
    fprintf(stderr, "%s\n", error);
    free(sample_buffer);
    gme_delete(emu);
    return 1;
  }

  *pcm_output = (uint8_t*) sample_buffer;
  *pcm_length = pcm_byte_length;
  gme_delete(emu);
  return 0;
}

static int open_session(
  const char* file_path,
  int track_index,
  int start_ms,
  int play_ms,
  int fade_ms
) {
  Music_Emu* emu = NULL;
  gme_err_t error = gme_open_file(file_path, &emu, SAMPLE_RATE);
  if (error) {
    fprintf(stderr, "%s\n", error);
    return 1;
  }

  gme_set_autoload_playback_limit(emu, 0);
  gme_ignore_silence(emu, 1);

  if (start_track(emu, track_index) != 0) {
    gme_delete(emu);
    return 1;
  }

  if (play_ms > 0 && fade_ms >= 0) {
    gme_set_fade_msecs(emu, play_ms, fade_ms);
  }

  if (start_ms > 0) {
    error = gme_seek(emu, start_ms);
    if (error) {
      fprintf(stderr, "%s\n", error);
      gme_delete(emu);
      return 1;
    }
  }

  close_session_emu();
  session_emu = emu;
  return 0;
}

static int read_session_pcm(int frame_count, uint8_t** pcm_output, size_t* pcm_length) {
  if (!session_emu) {
    return fail_message("no active session");
  }

  const int safe_frame_count = frame_count > 0 ? frame_count : 1;
  const uint32_t sample_count = (uint32_t) safe_frame_count * CHANNEL_COUNT;
  const uint32_t pcm_byte_length = sample_count * sizeof(int16_t);
  int16_t* sample_buffer = (int16_t*) malloc(pcm_byte_length);
  if (!sample_buffer) {
    return fail_message("failed to allocate session decode buffer");
  }

  gme_err_t error = gme_play(session_emu, (int) sample_count, sample_buffer);
  if (error) {
    fprintf(stderr, "%s\n", error);
    free(sample_buffer);
    return 1;
  }

  *pcm_output = (uint8_t*) sample_buffer;
  *pcm_length = pcm_byte_length;
  return 0;
}

static int serve_forever(void) {
  char* line = NULL;
  size_t capacity = 0;

  while (getline(&line, &capacity, stdin) != -1) {
    char* newline = strchr(line, '\n');
    if (newline) {
      *newline = '\0';
    }

    char* request_id = strtok(line, "\t");
    char* command = strtok(NULL, "\t");
    if (!request_id || !command) {
      fprintf(stdout, "ERR\t0\tinvalid request\n");
      fflush(stdout);
      continue;
    }

    if (strcmp(command, "inspect") == 0) {
      char* file_path = strtok(NULL, "");
      char* json = NULL;
      if (!file_path) {
        fprintf(stdout, "ERR\t%s\tmissing path\n", request_id);
        fflush(stdout);
        continue;
      }

      if (inspect_file_to_json(file_path, &json) != 0) {
        char message[256];
        strncpy(message, "inspect failed", sizeof(message) - 1);
        message[sizeof(message) - 1] = '\0';
        sanitize_message(message);
        fprintf(stdout, "ERR\t%s\t%s\n", request_id, message);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "inspect-all") == 0) {
      char* file_path = strtok(NULL, "");
      char* json = NULL;
      if (!file_path) {
        fprintf(stdout, "ERR\t%s\tmissing path\n", request_id);
        fflush(stdout);
        continue;
      }

      if (inspect_file_all_to_json(file_path, &json) != 0) {
        fprintf(stdout, "ERR\t%s\tinspect-all failed\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "decode") == 0 || strcmp(command, "decode-raw") == 0) {
      char* file_path = strtok(NULL, "\t");
      char* track_index_text = strtok(NULL, "\t");
      char* start_ms_text = strtok(NULL, "\t");
      char* play_ms_text = strtok(NULL, "\t");
      char* fade_ms_text = strtok(NULL, "\t");
      uint8_t* payload = NULL;
      size_t payload_length = 0;

      if (!file_path || !track_index_text || !start_ms_text || !play_ms_text || !fade_ms_text) {
        fprintf(stdout, "ERR\t%s\tmissing decode args\n", request_id);
        fflush(stdout);
        continue;
      }

      const int use_raw_pcm = strcmp(command, "decode-raw") == 0;
      const int decode_result = use_raw_pcm
        ? decode_file_to_pcm(file_path, atoi(track_index_text), atoi(start_ms_text), atoi(play_ms_text), atoi(fade_ms_text), &payload, &payload_length)
        : decode_file_to_wav(file_path, atoi(track_index_text), atoi(start_ms_text), atoi(play_ms_text), atoi(fade_ms_text), &payload, &payload_length);

      if (decode_result != 0) {
        char message[256];
        strncpy(message, "decode failed", sizeof(message) - 1);
        message[sizeof(message) - 1] = '\0';
        sanitize_message(message);
        fprintf(stdout, "ERR\t%s\t%s\n", request_id, message);
        fflush(stdout);
        free(payload);
        continue;
      }

      fprintf(stdout, "OK\t%s\tbinary\t%zu\n", request_id, payload_length);
      fwrite(payload, 1, payload_length, stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(payload);
      continue;
    }

    if (strcmp(command, "player-init") == 0 || strcmp(command, "player-state") == 0) {
      char* json = NULL;
      if (strcmp(command, "player-init") == 0) {
        (void) ensure_native_player_thread();
      }

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native audio engine state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-audio-config") == 0) {
      char* volume_text = strtok(NULL, "\t");
      char* enabled_text = strtok(NULL, "\t");
      if (!volume_text || !enabled_text) {
        fprintf(stdout, "ERR\t%s\tmissing player-audio-config args\n", request_id);
        fflush(stdout);
        continue;
      }
      native_player.volume = (float)atof(volume_text);
      if (native_player.volume < 0.0f) native_player.volume = 0.0f;
      if (native_player.volume > 1.0f) native_player.volume = 1.0f;
      native_player.equalizer_enabled = atoi(enabled_text) != 0;
      for (int index = 0; index < EQUALIZER_BAND_COUNT; index += 1) {
        char* gain_text = strtok(NULL, "\t");
        native_player.equalizer_gains[index] = gain_text ? (float)atof(gain_text) : 0.0f;
        if (native_player.equalizer_gains[index] < -12.0f) native_player.equalizer_gains[index] = -12.0f;
        if (native_player.equalizer_gains[index] > 12.0f) native_player.equalizer_gains[index] = 12.0f;
      }
      if (ensure_native_audio_engine() == 0) {
        audio_engine_set_volume(native_audio_engine, native_player.volume);
        audio_engine_set_equalizer(native_audio_engine, native_player.equalizer_enabled, native_player.equalizer_gains, EQUALIZER_BAND_COUNT);
      }
      fprintf(stdout, "OK\t%s\tjson\t2\n{}\n", request_id);
      fflush(stdout);
      continue;
    }

    if (strcmp(command, "player-load") == 0) {
      char* file_path = strtok(NULL, "\t");
      char* track_index_text = strtok(NULL, "\t");
      char* start_ms_text = strtok(NULL, "\t");
      char* play_ms_text = strtok(NULL, "\t");
      char* fade_ms_text = strtok(NULL, "\t");
      char* speed_numerator_text = strtok(NULL, "\t");
      char* speed_denominator_text = strtok(NULL, "\t");
      char* json = NULL;

      if (!file_path || !track_index_text || !start_ms_text || !play_ms_text || !fade_ms_text) {
        fprintf(stdout, "ERR\t%s\tmissing player-load args\n", request_id);
        fflush(stdout);
        continue;
      }

      if (ensure_native_audio_engine() != 0 || ensure_native_player_thread() != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to initialize native playback runtime\n", request_id);
        fflush(stdout);
        continue;
      }

      pthread_mutex_lock(&native_player.mutex);
      if (native_player_load_locked(
        file_path,
        atoi(track_index_text),
        atoi(start_ms_text),
        atoi(play_ms_text),
        atoi(fade_ms_text),
        speed_numerator_text ? atoi(speed_numerator_text) : 1,
        speed_denominator_text ? atoi(speed_denominator_text) : 1
      ) != 0) {
        pthread_mutex_unlock(&native_player.mutex);
        fprintf(stdout, "ERR\t%s\tfailed to load native playback track\n", request_id);
        fflush(stdout);
        continue;
      }
      pthread_cond_broadcast(&native_player.cond);
      pthread_mutex_unlock(&native_player.mutex);

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native playback state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-play") == 0) {
      char* json = NULL;
      if (ensure_native_audio_engine() != 0 || ensure_native_player_thread() != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to initialize native playback runtime\n", request_id);
        fflush(stdout);
        continue;
      }

      pthread_mutex_lock(&native_player.mutex);
      if (!native_player.track_loaded) {
        pthread_mutex_unlock(&native_player.mutex);
        fprintf(stdout, "ERR\t%s\tno native playback track loaded\n", request_id);
        fflush(stdout);
        continue;
      }
      pthread_cond_broadcast(&native_player.cond);
      pthread_mutex_unlock(&native_player.mutex);

      // Start new output at silence and restore it over ten milliseconds.
      // This is a de-click envelope, not a musical fade, so it preserves the
      // audible attack while avoiding a discontinuity at the device boundary.
      audio_engine_set_transport_gain(native_audio_engine, 0.0f);
      if (audio_engine_start(native_audio_engine) != 0) {
        pthread_mutex_lock(&native_player.mutex);
        if (native_player.track_loaded) {
          native_player.transport_state = NATIVE_PLAYER_PAUSED;
        }
        pthread_mutex_unlock(&native_player.mutex);
        fprintf(stdout, "ERR\t%s\tfailed to start native audio engine\n", request_id);
        fflush(stdout);
        continue;
      }

      pthread_mutex_lock(&native_player.mutex);
      native_player.transport_state = NATIVE_PLAYER_PLAYING;
      pthread_mutex_unlock(&native_player.mutex);

      audio_engine_ramp_transport_gain(native_audio_engine, 1.0f, transport_declick_frames(TRANSPORT_DECLICK_MS));

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native playback state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-pause") == 0) {
      char* json = NULL;
      if (native_audio_engine) {
        if (audio_engine_stop(native_audio_engine) != 0) {
          fprintf(stdout, "ERR\t%s\tfailed to pause native audio engine\n", request_id);
          fflush(stdout);
          continue;
        }
      }

      pthread_mutex_lock(&native_player.mutex);
      if (native_player.track_loaded && native_player.transport_state == NATIVE_PLAYER_PLAYING) {
        native_player.transport_state = NATIVE_PLAYER_PAUSED;
      }
      pthread_mutex_unlock(&native_player.mutex);

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native playback state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-ramp-gain") == 0) {
      char* gain_text = strtok(NULL, "\t");
      char* duration_ms_text = strtok(NULL, "\t");
      if (!gain_text || !duration_ms_text || !native_audio_engine) {
        fprintf(stdout, "ERR\t%s\tnative playback runtime unavailable\n", request_id);
        fflush(stdout);
        continue;
      }
      float gain = (float)atof(gain_text);
      if (gain < 0.0f) gain = 0.0f;
      if (gain > 1.0f) gain = 1.0f;
      audio_engine_ramp_transport_gain(native_audio_engine, gain, transport_declick_frames(atoi(duration_ms_text)));
      fprintf(stdout, "OK\t%s\tjson\t2\n{}\n", request_id);
      fflush(stdout);
      continue;
    }

    if (strcmp(command, "player-stop") == 0) {
      char* json = NULL;
      pthread_mutex_lock(&native_player.mutex);
      if (native_audio_engine) {
        if (audio_engine_stop(native_audio_engine) != 0) {
          pthread_mutex_unlock(&native_player.mutex);
          fprintf(stdout, "ERR\t%s\tfailed to stop native audio engine\n", request_id);
          fflush(stdout);
          continue;
        }
        audio_engine_clear_buffer(native_audio_engine);
        audio_engine_reset_counters(native_audio_engine);
      }
      native_player_reset_loaded_state_locked();
      pthread_mutex_unlock(&native_player.mutex);

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native playback state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-unload") == 0) {
      char* json = NULL;
      pthread_mutex_lock(&native_player.mutex);
      // A replacement is already at zero transport gain. Keep the Core Audio
      // unit running through the silent prime so the next track does not pay
      // an output-device close/reopen transition.
      if (native_audio_engine) {
        audio_engine_clear_buffer(native_audio_engine);
        audio_engine_reset_counters(native_audio_engine);
      }
      native_player_reset_loaded_state_locked();
      pthread_mutex_unlock(&native_player.mutex);

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native playback state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }
      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-seek") == 0) {
      char* start_ms_text = strtok(NULL, "\t");
      char* json = NULL;
      if (!start_ms_text) {
        fprintf(stdout, "ERR\t%s\tmissing player-seek args\n", request_id);
        fflush(stdout);
        continue;
      }

      if (!native_audio_engine) {
        fprintf(stdout, "ERR\t%s\tnative playback runtime unavailable\n", request_id);
        fflush(stdout);
        continue;
      }

      pthread_mutex_lock(&native_player.mutex);
      const int should_resume = native_player.transport_state == NATIVE_PLAYER_PLAYING;
      pthread_mutex_unlock(&native_player.mutex);
      if (native_audio_engine && audio_engine_stop(native_audio_engine) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to stop native audio engine for seek\n", request_id);
        fflush(stdout);
        continue;
      }

      pthread_mutex_lock(&native_player.mutex);
      if (native_player_seek_locked(atoi(start_ms_text)) != 0) {
        pthread_mutex_unlock(&native_player.mutex);
        fprintf(stdout, "ERR\t%s\tfailed to seek native playback track\n", request_id);
        fflush(stdout);
        continue;
      }
      pthread_cond_broadcast(&native_player.cond);
      pthread_mutex_unlock(&native_player.mutex);

      if (should_resume && audio_engine_start(native_audio_engine) == 0) {
        pthread_mutex_lock(&native_player.mutex);
        native_player.transport_state = NATIVE_PLAYER_PLAYING;
        pthread_mutex_unlock(&native_player.mutex);
      } else if (should_resume) {
        pthread_mutex_lock(&native_player.mutex);
        native_player.transport_state = NATIVE_PLAYER_PAUSED;
        pthread_mutex_unlock(&native_player.mutex);
      }

      if (native_player_snapshot_to_json(&json) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read native playback state\n", request_id);
        fflush(stdout);
        free(json);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(json));
      fwrite(json, 1, strlen(json), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(json);
      continue;
    }

    if (strcmp(command, "player-close") == 0) {
      const char* ok = "ok";
      close_native_player();
      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(ok));
      fwrite(ok, 1, strlen(ok), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      continue;
    }

    if (strcmp(command, "session-open") == 0) {
      char* file_path = strtok(NULL, "\t");
      char* track_index_text = strtok(NULL, "\t");
      char* start_ms_text = strtok(NULL, "\t");
      char* play_ms_text = strtok(NULL, "\t");
      char* fade_ms_text = strtok(NULL, "\t");
      const char* ok = "ok";

      if (!file_path || !track_index_text || !start_ms_text || !play_ms_text || !fade_ms_text) {
        fprintf(stdout, "ERR\t%s\tmissing session-open args\n", request_id);
        fflush(stdout);
        continue;
      }

      if (open_session(file_path, atoi(track_index_text), atoi(start_ms_text), atoi(play_ms_text), atoi(fade_ms_text)) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to open session\n", request_id);
        fflush(stdout);
        continue;
      }

      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(ok));
      fwrite(ok, 1, strlen(ok), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      continue;
    }

    if (strcmp(command, "session-read") == 0) {
      char* frame_count_text = strtok(NULL, "\t");
      uint8_t* payload = NULL;
      size_t payload_length = 0;

      if (!frame_count_text) {
        fprintf(stdout, "ERR\t%s\tmissing session-read args\n", request_id);
        fflush(stdout);
        continue;
      }

      if (read_session_pcm(atoi(frame_count_text), &payload, &payload_length) != 0) {
        fprintf(stdout, "ERR\t%s\tfailed to read session\n", request_id);
        fflush(stdout);
        free(payload);
        continue;
      }

      fprintf(stdout, "OK\t%s\tbinary\t%zu\n", request_id, payload_length);
      fwrite(payload, 1, payload_length, stdout);
      fputc('\n', stdout);
      fflush(stdout);
      free(payload);
      continue;
    }

    if (strcmp(command, "session-close") == 0) {
      const char* ok = "ok";
      close_session_emu();
      fprintf(stdout, "OK\t%s\tjson\t%zu\n", request_id, strlen(ok));
      fwrite(ok, 1, strlen(ok), stdout);
      fputc('\n', stdout);
      fflush(stdout);
      continue;
    }

    fprintf(stdout, "ERR\t%s\tunknown command\n", request_id);
    fflush(stdout);
  }

  free(line);
  close_session_emu();
  close_native_player();
  return 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    print_usage();
    return 1;
  }

  if (strcmp(argv[1], "serve") == 0) {
    return serve_forever();
  }

  if (strcmp(argv[1], "player-load") == 0) {
    char* json = NULL;
    if (argc < 7) {
      print_usage();
      return 1;
    }

    if (ensure_native_audio_engine() != 0 || ensure_native_player_thread() != 0) {
      return fail_message("failed to initialize native playback runtime");
    }

    pthread_mutex_lock(&native_player.mutex);
    const int load_result = native_player_load_locked(
      argv[2],
      atoi(argv[3]),
      atoi(argv[4]),
      atoi(argv[5]),
      atoi(argv[6]),
      argc > 7 ? atoi(argv[7]) : 1,
      argc > 8 ? atoi(argv[8]) : 1
    );
    pthread_cond_broadcast(&native_player.cond);
    pthread_mutex_unlock(&native_player.mutex);
    if (load_result != 0) {
      close_native_player();
      return fail_message("failed to load native playback track");
    }

    if (native_player_snapshot_to_json(&json) != 0) {
      close_native_player();
      return fail_message("failed to read native playback state");
    }

    fputs(json, stdout);
    fputc('\n', stdout);
    free(json);
    const int write_result = ferror(stdout) ? fail_message("failed writing native playback state") : 0;
    // The one-shot diagnostic must join the refill thread before process exit;
    // otherwise a still-decoding native track can race C runtime teardown.
    close_native_player();
    return write_result;
  }

  if (strcmp(argv[1], "player-state") == 0) {
    char* json = NULL;
    if (native_player_snapshot_to_json(&json) != 0) {
      return fail_message("failed to read native playback state");
    }

    fputs(json, stdout);
    fputc('\n', stdout);
    free(json);
    return ferror(stdout) ? fail_message("failed writing native audio engine state") : 0;
  }

  if (argc < 3) {
    print_usage();
    return 1;
  }

  if (strcmp(argv[1], "inspect") == 0) {
    return inspect_file(argv[2]);
  }

  if (strcmp(argv[1], "inspect-all") == 0) {
    char* json = NULL;
    const int result = is_vgmstream_path(argv[2]) ? inspect_vgmstream_all_to_json(argv[2], &json) : inspect_file_all_to_json(argv[2], &json);
    if (result != 0) {
      return 1;
    }
    fputs(json, stdout);
    fputc('\n', stdout);
    free(json);
    return ferror(stdout) ? fail_message("failed writing inspect output") : 0;
  }

  if (strcmp(argv[1], "decode") == 0) {
    if (argc < 7) {
      print_usage();
      return 1;
    }

    return decode_file(
      argv[2],
      atoi(argv[3]),
      atoi(argv[4]),
      atoi(argv[5]),
      atoi(argv[6])
    );
  }

  if (strcmp(argv[1], "decode-raw") == 0) {
    uint8_t* pcm = NULL;
    size_t pcm_length = 0;
    if (argc < 7) {
      print_usage();
      return 1;
    }

    if (decode_file_to_pcm(
      argv[2],
      atoi(argv[3]),
      atoi(argv[4]),
      atoi(argv[5]),
      atoi(argv[6]),
      &pcm,
      &pcm_length
    ) != 0) {
      free(pcm);
      return 1;
    }

    if (fwrite(pcm, 1, pcm_length, stdout) != pcm_length) {
      free(pcm);
      return fail_message("failed writing pcm samples");
    }

    free(pcm);
    return ferror(stdout) ? fail_message("decode pcm stream write failed") : 0;
  }

  print_usage();
  return 1;
}
