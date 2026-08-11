#include "audio_engine.h"

#include "ring_buffer.h"

#include <AudioToolbox/AudioToolbox.h>
#include <AudioUnit/AudioUnit.h>
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define AUDIO_ENGINE_BAND_COUNT 10

typedef struct AudioBiquad {
  float b0, b1, b2, a1, a2;
  float x1[2], x2[2], y1[2], y2[2];
} AudioBiquad;

struct AudioEngine {
  AudioComponentInstance output_unit;
  AudioStreamBasicDescription stream_format;
  PcmRingBuffer ring_buffer;
  _Atomic int state;
  _Atomic uint64_t callback_count;
  _Atomic uint64_t underrun_count;
  _Atomic uint64_t frames_requested;
  _Atomic uint64_t frames_supplied;
  _Atomic float transport_gain;
  _Atomic float transport_gain_target;
  _Atomic uint32_t transport_ramp_frames;
  uint32_t bytes_per_frame;
  uint32_t callback_frames;
  uint32_t ring_buffer_frames;
  pthread_mutex_t processing_mutex;
  float volume;
  int equalizer_enabled;
  AudioBiquad equalizer[AUDIO_ENGINE_BAND_COUNT];
};

static const float audio_engine_band_frequencies[AUDIO_ENGINE_BAND_COUNT] = {
  31.0f, 62.0f, 125.0f, 250.0f, 500.0f, 1000.0f, 2000.0f, 4000.0f, 8000.0f, 16000.0f
};

static float audio_engine_clamp(float value, float low, float high) {
  return value < low ? low : (value > high ? high : value);
}

static void audio_engine_configure_biquad(AudioBiquad* band, float frequency, float gain_db, double sample_rate) {
  const float omega = (float)(2.0 * M_PI * frequency / sample_rate);
  const float sine = sinf(omega);
  const float cosine = cosf(omega);
  const float alpha = sine * sinhf(logf(2.0f) * 0.5f * omega / (sine > 0.000001f ? sine : 0.000001f));
  const float amplitude = powf(10.0f, gain_db / 40.0f);
  const float a0 = 1.0f + alpha / amplitude;
  band->b0 = (1.0f + alpha * amplitude) / a0;
  band->b1 = (-2.0f * cosine) / a0;
  band->b2 = (1.0f - alpha * amplitude) / a0;
  band->a1 = (-2.0f * cosine) / a0;
  band->a2 = (1.0f - alpha / amplitude) / a0;
}

static float audio_engine_process_sample(AudioBiquad* band, float sample, int channel) {
  const float output = band->b0 * sample + band->b1 * band->x1[channel] + band->b2 * band->x2[channel]
    - band->a1 * band->y1[channel] - band->a2 * band->y2[channel];
  band->x2[channel] = band->x1[channel];
  band->x1[channel] = sample;
  band->y2[channel] = band->y1[channel];
  band->y1[channel] = output;
  return output;
}

static OSStatus audio_engine_render_callback(
  void* in_ref_con,
  AudioUnitRenderActionFlags* io_action_flags,
  const AudioTimeStamp* in_time_stamp,
  UInt32 in_bus_number,
  UInt32 in_number_frames,
  AudioBufferList* io_data
) {
  (void) io_action_flags;
  (void) in_time_stamp;
  (void) in_bus_number;

  AudioEngine* engine = (AudioEngine*) in_ref_con;
  if (!engine || !io_data || io_data->mNumberBuffers == 0) {
    return noErr;
  }

  AudioBuffer* output_buffer = &io_data->mBuffers[0];
  const uint32_t requested_bytes = in_number_frames * engine->bytes_per_frame;
  if (!output_buffer->mData || output_buffer->mDataByteSize < requested_bytes) {
    return noErr;
  }

  atomic_fetch_add_explicit(&engine->callback_count, 1, memory_order_relaxed);
  atomic_fetch_add_explicit(&engine->frames_requested, in_number_frames, memory_order_relaxed);
  const size_t actual_bytes = pcm_ring_buffer_read(&engine->ring_buffer, output_buffer->mData, requested_bytes);
  const uint32_t supplied_frames = (uint32_t) (actual_bytes / engine->bytes_per_frame);
  atomic_fetch_add_explicit(&engine->frames_supplied, supplied_frames, memory_order_relaxed);

  if (actual_bytes < requested_bytes) {
    memset((unsigned char*) output_buffer->mData + actual_bytes, 0, requested_bytes - actual_bytes);
    atomic_fetch_add_explicit(&engine->underrun_count, 1, memory_order_relaxed);
  }

  // This envelope is applied at the actual device boundary, after the
  // producer's EQ/volume work. That makes pause, stop, and replacement
  // transitions click-free without touching a song's decoded attack.
  float gain = atomic_load_explicit(&engine->transport_gain, memory_order_acquire);
  const float target_gain = atomic_load_explicit(&engine->transport_gain_target, memory_order_acquire);
  uint32_t remaining_frames = atomic_load_explicit(&engine->transport_ramp_frames, memory_order_acquire);
  int16_t* samples = (int16_t*)output_buffer->mData;
  for (UInt32 frame = 0; frame < in_number_frames; frame += 1) {
    if (remaining_frames > 0) {
      gain += (target_gain - gain) / (float)remaining_frames;
      remaining_frames -= 1;
    } else {
      gain = target_gain;
    }
    const size_t sample = (size_t)frame * engine->stream_format.mChannelsPerFrame;
    for (UInt32 channel = 0; channel < engine->stream_format.mChannelsPerFrame; channel += 1) {
      samples[sample + channel] = (int16_t)lrintf(audio_engine_clamp((float)samples[sample + channel] * gain, -32768.0f, 32767.0f));
    }
  }
  atomic_store_explicit(&engine->transport_gain, gain, memory_order_release);
  atomic_store_explicit(&engine->transport_ramp_frames, remaining_frames, memory_order_release);

  output_buffer->mDataByteSize = requested_bytes;
  return noErr;
}

static int audio_engine_prepare_output(AudioEngine* engine, const AudioEngineConfig* config) {
  if (engine->output_unit) {
    return 0;
  }

  AudioComponentDescription description;
  memset(&description, 0, sizeof(description));
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_DefaultOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;

  AudioComponent component = AudioComponentFindNext(NULL, &description);
  if (!component) {
    return 1;
  }

  if (AudioComponentInstanceNew(component, &engine->output_unit) != noErr) {
    return 1;
  }

  AURenderCallbackStruct callback;
  callback.inputProc = audio_engine_render_callback;
  callback.inputProcRefCon = engine;
  if (
    AudioUnitSetProperty(
      engine->output_unit,
      kAudioUnitProperty_SetRenderCallback,
      kAudioUnitScope_Input,
      0,
      &callback,
      sizeof(callback)
    ) != noErr
  ) {
    return 1;
  }

  memset(&engine->stream_format, 0, sizeof(engine->stream_format));
  engine->stream_format.mSampleRate = config->sample_rate;
  engine->stream_format.mFormatID = kAudioFormatLinearPCM;
  engine->stream_format.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  engine->stream_format.mFramesPerPacket = 1;
  engine->stream_format.mChannelsPerFrame = config->channel_count;
  engine->stream_format.mBitsPerChannel = config->bytes_per_sample * 8;
  engine->stream_format.mBytesPerFrame = config->channel_count * config->bytes_per_sample;
  engine->stream_format.mBytesPerPacket = engine->stream_format.mBytesPerFrame;

  if (
    AudioUnitSetProperty(
      engine->output_unit,
      kAudioUnitProperty_StreamFormat,
      kAudioUnitScope_Input,
      0,
      &engine->stream_format,
      sizeof(engine->stream_format)
    ) != noErr
  ) {
    return 1;
  }

  if (AudioUnitInitialize(engine->output_unit) != noErr) {
    return 1;
  }

  return 0;
}

int audio_engine_create(AudioEngine** engine_out, const AudioEngineConfig* config) {
  if (!engine_out || !config || config->sample_rate <= 0 || config->channel_count == 0 || config->bytes_per_sample == 0) {
    return 1;
  }

  AudioEngine* engine = (AudioEngine*) calloc(1, sizeof(AudioEngine));
  if (!engine) {
    return 1;
  }

  engine->bytes_per_frame = config->channel_count * config->bytes_per_sample;
  engine->callback_frames = config->callback_frames;
  engine->ring_buffer_frames = config->ring_buffer_frames;
  engine->volume = 1.0f;
  engine->equalizer_enabled = 0;
  for (size_t index = 0; index < AUDIO_ENGINE_BAND_COUNT; index += 1) {
    audio_engine_configure_biquad(&engine->equalizer[index], audio_engine_band_frequencies[index], 0.0f, config->sample_rate);
  }
  atomic_init(&engine->state, AUDIO_ENGINE_STATE_UNINITIALIZED);
  atomic_init(&engine->callback_count, 0);
  atomic_init(&engine->underrun_count, 0);
  atomic_init(&engine->frames_requested, 0);
  atomic_init(&engine->frames_supplied, 0);
  atomic_init(&engine->transport_gain, 1.0f);
  atomic_init(&engine->transport_gain_target, 1.0f);
  atomic_init(&engine->transport_ramp_frames, 0);
  memset(&engine->stream_format, 0, sizeof(engine->stream_format));
  engine->stream_format.mSampleRate = config->sample_rate;
  engine->stream_format.mChannelsPerFrame = config->channel_count;
  engine->stream_format.mBitsPerChannel = config->bytes_per_sample * 8;
  engine->stream_format.mBytesPerFrame = config->channel_count * config->bytes_per_sample;
  engine->stream_format.mBytesPerPacket = engine->stream_format.mBytesPerFrame;

  if (
    pcm_ring_buffer_init(
      &engine->ring_buffer,
      (size_t) engine->ring_buffer_frames * engine->bytes_per_frame
    ) != 0
  ) {
    free(engine);
    return 1;
  }

  if (pthread_mutex_init(&engine->processing_mutex, NULL) != 0) {
    pcm_ring_buffer_destroy(&engine->ring_buffer);
    free(engine);
    return 1;
  }

  atomic_store_explicit(&engine->state, AUDIO_ENGINE_STATE_STOPPED, memory_order_release);
  *engine_out = engine;
  return 0;
}

void audio_engine_destroy(AudioEngine* engine) {
  if (!engine) {
    return;
  }

  if (engine->output_unit) {
    AudioOutputUnitStop(engine->output_unit);
    AudioUnitUninitialize(engine->output_unit);
    AudioComponentInstanceDispose(engine->output_unit);
  }

  pthread_mutex_destroy(&engine->processing_mutex);
  pcm_ring_buffer_destroy(&engine->ring_buffer);
  free(engine);
}

int audio_engine_start(AudioEngine* engine) {
  if (!engine) {
    return 1;
  }

  if (atomic_load_explicit(&engine->state, memory_order_acquire) == AUDIO_ENGINE_STATE_RUNNING) {
    return 0;
  }

  const AudioEngineConfig config = {
    .sample_rate = engine->stream_format.mSampleRate,
    .channel_count = engine->stream_format.mChannelsPerFrame,
    .bytes_per_sample = engine->stream_format.mBitsPerChannel / 8,
    .callback_frames = engine->callback_frames,
    .ring_buffer_frames = engine->ring_buffer_frames
  };
  if (audio_engine_prepare_output(engine, &config) != 0) {
    return 1;
  }

  if (AudioOutputUnitStart(engine->output_unit) != noErr) {
    return 1;
  }

  atomic_store_explicit(&engine->state, AUDIO_ENGINE_STATE_RUNNING, memory_order_release);
  return 0;
}

int audio_engine_stop(AudioEngine* engine) {
  if (!engine) {
    return 1;
  }

  if (atomic_load_explicit(&engine->state, memory_order_acquire) != AUDIO_ENGINE_STATE_RUNNING) {
    atomic_store_explicit(&engine->state, AUDIO_ENGINE_STATE_STOPPED, memory_order_release);
    return 0;
  }

  if (AudioOutputUnitStop(engine->output_unit) != noErr) {
    return 1;
  }

  atomic_store_explicit(&engine->state, AUDIO_ENGINE_STATE_STOPPED, memory_order_release);
  return 0;
}

void audio_engine_clear_buffer(AudioEngine* engine) {
  if (!engine) {
    return;
  }

  pcm_ring_buffer_reset(&engine->ring_buffer);
}

void audio_engine_reset_counters(AudioEngine* engine) {
  if (!engine) {
    return;
  }

  atomic_store_explicit(&engine->callback_count, 0, memory_order_release);
  atomic_store_explicit(&engine->underrun_count, 0, memory_order_release);
  atomic_store_explicit(&engine->frames_requested, 0, memory_order_release);
  atomic_store_explicit(&engine->frames_supplied, 0, memory_order_release);
}

void audio_engine_set_volume(AudioEngine* engine, float volume) {
  if (!engine) return;
  pthread_mutex_lock(&engine->processing_mutex);
  engine->volume = audio_engine_clamp(volume, 0.0f, 1.0f);
  pthread_mutex_unlock(&engine->processing_mutex);
}

void audio_engine_set_transport_gain(AudioEngine* engine, float gain) {
  if (!engine) return;
  const float safe_gain = audio_engine_clamp(gain, 0.0f, 1.0f);
  atomic_store_explicit(&engine->transport_gain, safe_gain, memory_order_release);
  atomic_store_explicit(&engine->transport_gain_target, safe_gain, memory_order_release);
  atomic_store_explicit(&engine->transport_ramp_frames, 0, memory_order_release);
}

void audio_engine_ramp_transport_gain(AudioEngine* engine, float gain, uint32_t frame_count) {
  if (!engine) return;
  const float safe_gain = audio_engine_clamp(gain, 0.0f, 1.0f);
  if (frame_count == 0) {
    audio_engine_set_transport_gain(engine, safe_gain);
    return;
  }
  atomic_store_explicit(&engine->transport_gain_target, safe_gain, memory_order_release);
  atomic_store_explicit(&engine->transport_ramp_frames, frame_count, memory_order_release);
}

void audio_engine_set_equalizer(AudioEngine* engine, int enabled, const float* gains, size_t gain_count) {
  if (!engine) return;
  pthread_mutex_lock(&engine->processing_mutex);
  engine->equalizer_enabled = enabled != 0;
  for (size_t index = 0; index < AUDIO_ENGINE_BAND_COUNT; index += 1) {
    const float gain = gains && index < gain_count ? audio_engine_clamp(gains[index], -12.0f, 12.0f) : 0.0f;
    audio_engine_configure_biquad(&engine->equalizer[index], audio_engine_band_frequencies[index], gain, engine->stream_format.mSampleRate);
    memset(engine->equalizer[index].x1, 0, sizeof(engine->equalizer[index].x1));
    memset(engine->equalizer[index].x2, 0, sizeof(engine->equalizer[index].x2));
    memset(engine->equalizer[index].y1, 0, sizeof(engine->equalizer[index].y1));
    memset(engine->equalizer[index].y2, 0, sizeof(engine->equalizer[index].y2));
  }
  pthread_mutex_unlock(&engine->processing_mutex);
}

size_t audio_engine_enqueue_pcm(AudioEngine* engine, int16_t* samples, size_t byte_count) {
  if (!engine || !samples) {
    return 0;
  }

  pthread_mutex_lock(&engine->processing_mutex);
  const size_t sample_count = byte_count / sizeof(int16_t);
  for (size_t frame = 0; frame + 1 < sample_count; frame += 2) {
    float left = (float)samples[frame] / 32768.0f;
    float right = (float)samples[frame + 1] / 32768.0f;
    if (engine->equalizer_enabled) {
      for (size_t band = 0; band < AUDIO_ENGINE_BAND_COUNT; band += 1) {
        left = audio_engine_process_sample(&engine->equalizer[band], left, 0);
        right = audio_engine_process_sample(&engine->equalizer[band], right, 1);
      }
    }
    left *= engine->volume;
    right *= engine->volume;
    samples[frame] = (int16_t)lrintf(audio_engine_clamp(left, -1.0f, 1.0f) * 32767.0f);
    samples[frame + 1] = (int16_t)lrintf(audio_engine_clamp(right, -1.0f, 1.0f) * 32767.0f);
  }
  pthread_mutex_unlock(&engine->processing_mutex);

  const size_t written = pcm_ring_buffer_write(&engine->ring_buffer, samples, byte_count);
  if (written > 0 && atomic_load_explicit(&engine->state, memory_order_acquire) == AUDIO_ENGINE_STATE_STOPPED) {
    atomic_store_explicit(&engine->state, AUDIO_ENGINE_STATE_PRIMED, memory_order_release);
  }
  return written;
}

int audio_engine_snapshot(const AudioEngine* engine, AudioEngineSnapshot* snapshot_out) {
  if (!engine || !snapshot_out) {
    return 1;
  }

  snapshot_out->state = (AudioEngineState) atomic_load_explicit(&engine->state, memory_order_acquire);
  snapshot_out->callback_count = atomic_load_explicit(&engine->callback_count, memory_order_acquire);
  snapshot_out->underrun_count = atomic_load_explicit(&engine->underrun_count, memory_order_acquire);
  snapshot_out->frames_requested = atomic_load_explicit(&engine->frames_requested, memory_order_acquire);
  snapshot_out->frames_supplied = atomic_load_explicit(&engine->frames_supplied, memory_order_acquire);
  snapshot_out->buffered_frames = (uint32_t) (pcm_ring_buffer_available_to_read(&engine->ring_buffer) / engine->bytes_per_frame);
  snapshot_out->ring_buffer_frames = engine->ring_buffer_frames;
  snapshot_out->callback_frames = engine->callback_frames;
  snapshot_out->sample_rate = engine->stream_format.mSampleRate;
  snapshot_out->channel_count = engine->stream_format.mChannelsPerFrame;
  return 0;
}

const char* audio_engine_state_name(AudioEngineState state) {
  switch (state) {
    case AUDIO_ENGINE_STATE_STOPPED:
      return "stopped";
    case AUDIO_ENGINE_STATE_PRIMED:
      return "primed";
    case AUDIO_ENGINE_STATE_RUNNING:
      return "running";
    case AUDIO_ENGINE_STATE_UNINITIALIZED:
    default:
      return "uninitialized";
  }
}
