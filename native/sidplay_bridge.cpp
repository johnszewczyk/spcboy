#include "sidplay_bridge.h"

#include <sidplayfp/SidConfig.h>
#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidTune.h>
#include <sidplayfp/SidTuneInfo.h>
#include <sidplayfp/builders/sidlite.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr int32_t kSampleRate = 44100;
constexpr uint32_t kCpuClockPAL = 985248;
constexpr uint32_t kCpuClockNTSC = 1022727;
constexpr uint32_t kRenderFramesChunk = 4096;

struct SidPlayer {
  SidTune* tune;
  SIDLiteBuilder* sidBuilder;
  sidplayfp player;
  bool loaded;
  uint32_t cpuClock;
  int32_t sampleRate;
  int32_t playLengthMs;
  int32_t fadeLengthMs;
  uint64_t playedFrames;
  std::vector<short> overflow;
  size_t overflowConsumed;
};

char* dupString(const char* value) {
  if (value == nullptr) return nullptr;
  size_t length = std::strlen(value);
  char* copy = static_cast<char*>(std::malloc(length + 1));
  if (copy == nullptr) return nullptr;
  std::memcpy(copy, value, length + 1);
  return copy;
}

void setError(char** error_message, const std::string& message) {
  if (error_message == nullptr) return;
  if (*error_message != nullptr) std::free(*error_message);
  *error_message = dupString(message.c_str());
}

std::string lastError(sidplayfp& player) {
  const char* message = player.error();
  return message != nullptr ? message : "SID playback error";
}

uint32_t cpuClockForTune(const SidTuneInfo* info) {
  if (info != nullptr && info->clockSpeed() == SidTuneInfo::CLOCK_NTSC) {
    return kCpuClockNTSC;
  }
  return kCpuClockPAL;
}

SidPlayer* createPlayer(const char* path, int32_t sample_rate, char** error_message) {
  SidPlayer* player = new (std::nothrow) SidPlayer();
  if (player == nullptr) {
    setError(error_message, "Out of memory creating SID player");
    return nullptr;
  }
  player->sampleRate = sample_rate > 0 ? sample_rate : kSampleRate;
  player->tune = new (std::nothrow) SidTune(path);
  if (player->tune == nullptr || !player->tune->getStatus()) {
    setError(error_message, std::string("Unable to load SID tune: ") + (path != nullptr ? path : ""));
    delete player->tune;
    delete player;
    return nullptr;
  }
  player->cpuClock = cpuClockForTune(player->tune->getInfo());

  SidConfig config;
  config.frequency = player->sampleRate;
  config.samplingMethod = SidConfig::RESAMPLE_INTERPOLATE;
  config.defaultC64Model = SidConfig::PAL;
  config.forceC64Model = false;
  config.defaultSidModel = SidConfig::MOS6581;
  config.forceSidModel = false;
  player->sidBuilder = new (std::nothrow) SIDLiteBuilder("sidlite");
  if (player->sidBuilder == nullptr) {
    setError(error_message, "Out of memory creating SID emulator");
    delete player->tune;
    delete player;
    return nullptr;
  }
  config.sidEmulation = player->sidBuilder;
  if (!player->player.config(config)) {
    setError(error_message, lastError(player->player));
    delete player->sidBuilder;
    delete player->tune;
    delete player;
    return nullptr;
  }
  if (!player->player.load(player->tune)) {
    setError(error_message, lastError(player->player));
    delete player->sidBuilder;
    delete player->tune;
    delete player;
    return nullptr;
  }
  player->loaded = true;
  return player;
}

}  // namespace

extern "C" sid_player_handle_t sid_player_create(const char* path, int32_t sample_rate, char** error_message) {
  if (path == nullptr) {
    setError(error_message, "SID path is required");
    return nullptr;
  }
  return createPlayer(path, sample_rate, error_message);
}

extern "C" void sid_player_destroy(sid_player_handle_t handle) {
  if (handle == nullptr) return;
  SidPlayer* player = static_cast<SidPlayer*>(handle);
  if (player->sidBuilder != nullptr) delete player->sidBuilder;
  if (player->tune != nullptr) delete player->tune;
  delete player;
}

extern "C" int32_t sid_inspect_metadata(const char* path, sid_metadata_t* metadata, char** error_message) {
  if (path == nullptr || metadata == nullptr) return 1;
  SidPlayer* player = createPlayer(path, kSampleRate, error_message);
  if (player == nullptr) return 1;
  int32_t result = sid_player_read_metadata(player, metadata, error_message);
  sid_player_destroy(player);
  return result;
}

extern "C" int32_t sid_player_read_metadata(sid_player_handle_t handle, sid_metadata_t* metadata, char** error_message) {
  if (handle == nullptr || metadata == nullptr) return 1;
  SidPlayer* player = static_cast<SidPlayer*>(handle);
  if (!player->loaded || player->tune == nullptr) {
    setError(error_message, "SID tune is not loaded");
    return 1;
  }
  const SidTuneInfo* info = player->tune->getInfo();
  if (info == nullptr) {
    setError(error_message, "SID tune metadata is unavailable");
    return 1;
  }
  sid_metadata_clear(metadata);
  metadata->title = dupString(info->numberOfInfoStrings() > 0 ? info->infoString(0) : nullptr);
  metadata->artist = dupString(info->numberOfInfoStrings() > 1 ? info->infoString(1) : nullptr);
  metadata->comment = dupString(info->numberOfInfoStrings() > 2 ? info->infoString(2) : nullptr);
  metadata->system = dupString("Commodore 64");
  metadata->game = dupString("");
  metadata->play_length_ms = 0;
  metadata->fade_length_ms = 0;
  return 0;
}

extern "C" int32_t sid_player_configure(sid_player_handle_t handle, int32_t play_length_ms, int32_t fade_length_ms, char** error_message) {
  (void)error_message;
  if (handle == nullptr) return 1;
  SidPlayer* player = static_cast<SidPlayer*>(handle);
  player->playLengthMs = std::max<int32_t>(0, play_length_ms);
  player->fadeLengthMs = std::max<int32_t>(0, fade_length_ms);
  return 0;
}

extern "C" int32_t sid_player_render_s16(sid_player_handle_t handle, int32_t requested_frames, int16_t* samples, int32_t* rendered_frames, char** error_message) {
  if (handle == nullptr || samples == nullptr) return 1;
  SidPlayer* player = static_cast<SidPlayer*>(handle);
  int32_t rendered = 0;
  while (rendered < requested_frames) {
    if (player->overflowConsumed < player->overflow.size()) {
      int32_t take = static_cast<int32_t>(std::min<size_t>(
        player->overflow.size() - player->overflowConsumed,
        static_cast<size_t>(requested_frames - rendered)));
      for (int32_t i = 0; i < take; ++i) {
        short sample = player->overflow[player->overflowConsumed + i];
        samples[(rendered + i) * 2] = sample;
        samples[(rendered + i) * 2 + 1] = sample;
      }
      player->overflowConsumed += take;
      rendered += take;
      continue;
    }

    uint32_t cycles = static_cast<uint32_t>(
      (static_cast<uint64_t>(kRenderFramesChunk) * player->cpuClock) / player->sampleRate);
    short* monoBuffer = nullptr;
    player->player.buffers(&monoBuffer);
    int produced = player->player.play(cycles);
    if (produced <= 0) {
      if (produced < 0) setError(error_message, lastError(player->player));
      break;
    }
    player->overflow.assign(monoBuffer, monoBuffer + produced);
    player->overflowConsumed = 0;
  }
  player->playedFrames += rendered;
  if (rendered_frames != nullptr) *rendered_frames = rendered;
  return 0;
}

extern "C" int32_t sid_player_seek_milliseconds(sid_player_handle_t handle, int32_t milliseconds, char** error_message) {
  if (handle == nullptr) return 1;
  SidPlayer* player = static_cast<SidPlayer*>(handle);
  player->overflow.clear();
  player->overflowConsumed = 0;
  if (!player->player.reset()) {
    setError(error_message, lastError(player->player));
    return 1;
  }
  if (milliseconds > 0) {
    uint64_t frames = (static_cast<uint64_t>(milliseconds) * player->sampleRate) / 1000;
    uint32_t cycles = static_cast<uint32_t>((frames * player->cpuClock) / player->sampleRate);
    short* monoBuffer = nullptr;
    player->player.buffers(&monoBuffer);
    int produced = player->player.play(cycles);
    if (produced < 0) {
      setError(error_message, lastError(player->player));
      return 1;
    }
  }
  player->playedFrames = static_cast<uint64_t>(milliseconds) * player->sampleRate / 1000;
  return 0;
}

extern "C" int32_t sid_player_track_ended(sid_player_handle_t handle) {
  if (handle == nullptr) return 1;
  SidPlayer* player = static_cast<SidPlayer*>(handle);
  if (player->playLengthMs <= 0) return 0;
  uint64_t limitFrames = static_cast<uint64_t>(player->playLengthMs) * player->sampleRate / 1000;
  return player->playedFrames >= limitFrames ? 1 : 0;
}

extern "C" int32_t sid_player_played_frames(sid_player_handle_t handle) {
  if (handle == nullptr) return 0;
  return static_cast<int32_t>(static_cast<SidPlayer*>(handle)->playedFrames);
}

extern "C" void sid_metadata_clear(sid_metadata_t* metadata) {
  if (metadata == nullptr) return;
  std::free(metadata->title); metadata->title = nullptr;
  std::free(metadata->game); metadata->game = nullptr;
  std::free(metadata->system); metadata->system = nullptr;
  std::free(metadata->artist); metadata->artist = nullptr;
  std::free(metadata->comment); metadata->comment = nullptr;
  metadata->play_length_ms = 0;
  metadata->fade_length_ms = 0;
}
