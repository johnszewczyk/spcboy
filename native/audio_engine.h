#ifndef SPCBOY_AUDIO_ENGINE_H
#define SPCBOY_AUDIO_ENGINE_H

#include <stddef.h>
#include <stdint.h>

typedef struct AudioEngine AudioEngine;

typedef enum AudioEngineState {
  AUDIO_ENGINE_STATE_UNINITIALIZED = 0,
  AUDIO_ENGINE_STATE_STOPPED = 1,
  AUDIO_ENGINE_STATE_PRIMED = 2,
  AUDIO_ENGINE_STATE_RUNNING = 3
} AudioEngineState;

typedef struct AudioEngineConfig {
  double sample_rate;
  uint32_t channel_count;
  uint32_t bytes_per_sample;
  uint32_t callback_frames;
  uint32_t ring_buffer_frames;
} AudioEngineConfig;

typedef struct AudioEngineSnapshot {
  AudioEngineState state;
  uint64_t callback_count;
  uint64_t underrun_count;
  uint64_t frames_requested;
  uint64_t frames_supplied;
  uint32_t buffered_frames;
  uint32_t ring_buffer_frames;
  uint32_t callback_frames;
  double sample_rate;
  uint32_t channel_count;
} AudioEngineSnapshot;

int audio_engine_create(AudioEngine** engine_out, const AudioEngineConfig* config);
void audio_engine_destroy(AudioEngine* engine);
int audio_engine_start(AudioEngine* engine);
int audio_engine_stop(AudioEngine* engine);
void audio_engine_clear_buffer(AudioEngine* engine);
void audio_engine_reset_counters(AudioEngine* engine);
void audio_engine_set_volume(AudioEngine* engine, float volume);
void audio_engine_set_transport_gain(AudioEngine* engine, float gain);
void audio_engine_ramp_transport_gain(AudioEngine* engine, float gain, uint32_t frame_count);
void audio_engine_set_equalizer(AudioEngine* engine, int enabled, const float* gains, size_t gain_count);
size_t audio_engine_enqueue_pcm(AudioEngine* engine, int16_t* samples, size_t byte_count);
int audio_engine_snapshot(const AudioEngine* engine, AudioEngineSnapshot* snapshot_out);
const char* audio_engine_state_name(AudioEngineState state);

#endif
