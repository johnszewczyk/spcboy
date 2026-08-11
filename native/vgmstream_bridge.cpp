#include "vgmstream_bridge.h"

extern "C" {
#include "libvgmstream.h"
}

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {
struct VgmPlayer {
  std::string path;
  int32_t sample_rate = 44100;
  int32_t source_sample_rate = 44100;
  int32_t source_channels = 2;
  int32_t track_index = 1;
  bool long_play = false;
  libvgmstream_t* decoder = nullptr;
  libstreamfile_t* streamfile = nullptr;
  std::vector<int16_t> source_samples;
  double source_position = 0.0;
  bool source_ended = false;
};

char* copyString(const char* value) {
  if (value == nullptr || *value == '\0') return nullptr;
  const size_t length = std::strlen(value);
  auto* result = static_cast<char*>(std::malloc(length + 1));
  if (result != nullptr) std::memcpy(result, value, length + 1);
  return result;
}

void setError(char** target, const char* message) {
  if (target != nullptr) *target = copyString(message ? message : "vgmstream decoder failure.");
}

void resetResampler(VgmPlayer* player);

void closeDecoder(VgmPlayer* player) {
  if (player->decoder != nullptr) libvgmstream_free(player->decoder);
  if (player->streamfile != nullptr) libstreamfile_close(player->streamfile);
  player->decoder = nullptr;
  player->streamfile = nullptr;
  resetResampler(player);
}

void resetResampler(VgmPlayer* player) {
  player->source_samples.clear();
  player->source_position = 0.0;
  player->source_ended = false;
}

size_t sourceFrameCount(const VgmPlayer* player) {
  return player->source_samples.size() / 2;
}

bool appendSourceFrames(VgmPlayer* player, int minimum_frames, char** error) {
  while (static_cast<int>(sourceFrameCount(player)) < minimum_frames && !player->source_ended) {
    const int missing_frames = minimum_frames - static_cast<int>(sourceFrameCount(player));
    const int request_frames = std::max(2048, missing_frames);
    std::vector<int16_t> decoded(static_cast<size_t>(request_frames) * static_cast<size_t>(player->source_channels));
    if (libvgmstream_fill(player->decoder, decoded.data(), request_frames) < 0 || player->decoder->decoder == nullptr) {
      setError(error, "vgmstream failed to render source PCM.");
      return false;
    }

    const int rendered_frames = std::max(0, player->decoder->decoder->buf_samples);
    for (int frame = 0; frame < rendered_frames; frame += 1) {
      const size_t source_index = static_cast<size_t>(frame) * static_cast<size_t>(player->source_channels);
      const int16_t left = decoded[source_index];
      const int16_t right = player->source_channels > 1 ? decoded[source_index + 1] : left;
      player->source_samples.push_back(left);
      player->source_samples.push_back(right);
    }
    player->source_ended = player->decoder->decoder->done;
    if (rendered_frames == 0 && !player->source_ended) {
      setError(error, "vgmstream returned no source PCM before end of track.");
      return false;
    }
  }
  return true;
}

int16_t interpolateSample(int16_t lower, int16_t upper, double amount) {
  const double value = static_cast<double>(lower) + (static_cast<double>(upper) - static_cast<double>(lower)) * amount;
  const long rounded = std::lround(value);
  return static_cast<int16_t>(std::clamp(rounded, static_cast<long>(-32768), static_cast<long>(32767)));
}

int32_t renderResampled(VgmPlayer* player, int32_t requested, int16_t* samples, char** error) {
  const double source_frames_per_output_frame = static_cast<double>(player->source_sample_rate) / static_cast<double>(player->sample_rate);
  int32_t rendered = 0;
  while (rendered < requested) {
    const size_t frame_count = sourceFrameCount(player);
    const size_t lower_index = static_cast<size_t>(std::floor(player->source_position));
    if (lower_index >= frame_count || (lower_index + 1 >= frame_count && !player->source_ended)) {
      const int minimum_frames = lower_index > static_cast<size_t>(INT32_MAX - 2) ? INT32_MAX : static_cast<int>(lower_index + 2);
      if (!appendSourceFrames(player, minimum_frames, error)) return -1;
    }

    const size_t available_frames = sourceFrameCount(player);
    const size_t index = static_cast<size_t>(std::floor(player->source_position));
    if (index >= available_frames) break;
    const size_t upper_index = std::min(index + 1, available_frames - 1);
    const double interpolation = player->source_position - static_cast<double>(index);
    samples[rendered * 2] = interpolateSample(player->source_samples[index * 2], player->source_samples[upper_index * 2], interpolation);
    samples[rendered * 2 + 1] = interpolateSample(player->source_samples[index * 2 + 1], player->source_samples[upper_index * 2 + 1], interpolation);
    player->source_position += source_frames_per_output_frame;
    rendered += 1;
  }

  const size_t discard_frames = player->source_position > 1.0
    ? static_cast<size_t>(std::floor(player->source_position)) - 1
    : 0;
  if (discard_frames > 0) {
    player->source_samples.erase(player->source_samples.begin(), player->source_samples.begin() + static_cast<std::ptrdiff_t>(discard_frames * 2));
    player->source_position -= static_cast<double>(discard_frames);
  }
  return rendered;
}

bool openDecoder(VgmPlayer* player, char** error) {
  closeDecoder(player);
  player->decoder = libvgmstream_init();
  player->streamfile = libstreamfile_open_from_stdio(player->path.c_str());
  if (player->decoder == nullptr || player->streamfile == nullptr) { setError(error, "Could not open vgmstream input."); return false; }
  libvgmstream_config_t config{};
  config.allow_play_forever = player->long_play;
  config.play_forever = player->long_play;
  config.force_loop = player->long_play;
  config.ignore_loop = false;
  config.auto_downmix_channels = 2;
  config.force_sfmt = LIBVGMSTREAM_SFMT_PCM16;
  libvgmstream_setup(player->decoder, &config);
  if (libvgmstream_open_stream(player->decoder, player->streamfile, player->track_index) < 0 || player->decoder->format == nullptr) {
    setError(error, "vgmstream could not recognize the file or selected subsong.");
    closeDecoder(player);
    return false;
  }
  player->source_sample_rate = player->decoder->format->sample_rate;
  player->source_channels = std::max(1, player->decoder->format->channels);
  resetResampler(player);
  if (player->source_sample_rate <= 0) {
    setError(error, "vgmstream reported an invalid source sample rate.");
    closeDecoder(player);
    return false;
  }
  return true;
}

void readMetadata(const VgmPlayer* player, vgmstream_metadata_t* metadata) {
  std::memset(metadata, 0, sizeof(*metadata));
  const auto* format = player->decoder->format;
  metadata->title = copyString(format->stream_name);
  metadata->system = copyString(format->meta_name);
  metadata->comment = copyString(format->codec_name);
  metadata->sample_rate = format->sample_rate;
  metadata->channel_count = format->channels;
  metadata->track_index = format->subsong_index;
  metadata->track_count = std::max(1, format->subsong_count);
  metadata->play_length_frames = format->play_samples;
  metadata->loop_length_frames = format->loop_end > format->loop_start ? format->loop_end - format->loop_start : 0;
  metadata->looped = format->loop_flag;
}
}

extern "C" vgmstream_player_handle_t vgmstream_player_create(const char* path, int32_t sample_rate, int32_t track_index, char** error) {
  if (path == nullptr || *path == '\0' || sample_rate <= 0 || track_index <= 0) { setError(error, "vgmstream playback requires a path, positive sample rate, and 1-based subsong."); return nullptr; }
  auto* player = new VgmPlayer();
  player->path = path;
  player->sample_rate = sample_rate;
  player->track_index = track_index;
  if (!openDecoder(player, error)) { delete player; return nullptr; }
  return player;
}

extern "C" void vgmstream_player_destroy(vgmstream_player_handle_t handle) { auto* player = static_cast<VgmPlayer*>(handle); if (player == nullptr) return; closeDecoder(player); delete player; }

extern "C" int32_t vgmstream_player_read_metadata(vgmstream_player_handle_t handle, vgmstream_metadata_t* metadata, char** error) {
  auto* player = static_cast<VgmPlayer*>(handle);
  if (player == nullptr || player->decoder == nullptr || metadata == nullptr) { setError(error, "vgmstream metadata state is invalid."); return 1; }
  readMetadata(player, metadata);
  return 0;
}

extern "C" int32_t vgmstream_player_configure(vgmstream_player_handle_t handle, bool long_play, char** error) {
  auto* player = static_cast<VgmPlayer*>(handle);
  if (player == nullptr) { setError(error, "vgmstream playback state is invalid."); return 1; }
  player->long_play = long_play;
  return openDecoder(player, error) ? 0 : 1;
}

extern "C" int32_t vgmstream_player_render_s16(vgmstream_player_handle_t handle, int32_t requested, int16_t* samples, int32_t* rendered, char** error) {
  auto* player = static_cast<VgmPlayer*>(handle);
  if (player == nullptr || player->decoder == nullptr || samples == nullptr || requested < 0) { setError(error, "Invalid vgmstream render request."); return 1; }
  int32_t rendered_frames = 0;
  if (player->source_sample_rate == player->sample_rate && player->source_channels == 2) {
    const int result = libvgmstream_fill(player->decoder, samples, requested);
    if (result < 0) { setError(error, "vgmstream failed to render PCM."); return 1; }
    rendered_frames = player->decoder->decoder != nullptr ? player->decoder->decoder->buf_samples : 0;
  } else {
    rendered_frames = renderResampled(player, requested, samples, error);
    if (rendered_frames < 0) return 1;
  }
  if (rendered != nullptr) *rendered = rendered_frames;
  return 0;
}

extern "C" int32_t vgmstream_player_seek_milliseconds(vgmstream_player_handle_t handle, int32_t milliseconds, char** error) {
  auto* player = static_cast<VgmPlayer*>(handle);
  if (player == nullptr || player->decoder == nullptr || milliseconds < 0) { setError(error, "Invalid vgmstream seek request."); return 1; }
  const int64_t sample = static_cast<int64_t>(milliseconds) * player->source_sample_rate / 1000;
  libvgmstream_seek(player->decoder, sample);
  resetResampler(player);
  return 0;
}

extern "C" int32_t vgmstream_player_track_ended(vgmstream_player_handle_t handle) {
  auto* player = static_cast<VgmPlayer*>(handle);
  if (player == nullptr || player->decoder == nullptr || player->decoder->decoder == nullptr) return 1;
  if (player->source_sample_rate == player->sample_rate && player->source_channels == 2) return player->decoder->decoder->done;
  return player->source_ended && player->source_position >= static_cast<double>(sourceFrameCount(player));
}
extern "C" int64_t vgmstream_player_played_frames(vgmstream_player_handle_t handle) {
  auto* player = static_cast<VgmPlayer*>(handle);
  if (player == nullptr || player->decoder == nullptr || player->source_sample_rate <= 0) return 0;
  if (player->source_sample_rate != player->sample_rate || player->source_channels != 2) {
    return static_cast<int64_t>(player->source_position * static_cast<double>(player->sample_rate) / static_cast<double>(player->source_sample_rate));
  }
  const int64_t source_position = libvgmstream_get_play_position(player->decoder);
  return (source_position * player->sample_rate) / player->source_sample_rate;
}
extern "C" void vgmstream_metadata_clear(vgmstream_metadata_t* metadata) { if (metadata == nullptr) return; std::free(metadata->title); std::free(metadata->system); std::free(metadata->comment); std::memset(metadata, 0, sizeof(*metadata)); }
