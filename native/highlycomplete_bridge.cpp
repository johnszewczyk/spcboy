#include "highlycomplete_bridge.h"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <mgba/core/config.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/vfs.h>

#include "psflib.h"

namespace {

constexpr int kOutputRate = 44100;
constexpr int kChannels = 2;
constexpr int kSourceRate = 32768;
constexpr size_t kCoreAudioChunk = 2048;
constexpr int kEmptyRunLimit = 240;

struct LoaderState {
  std::vector<uint8_t> image;
  int callbacks = 0;
  uint32_t lastOffset = 0;
};

struct TagState {
  std::string title;
  std::string game;
  std::string artist;
  std::string comment;
  int lengthMs = 0;
  int fadeMs = 0;
};

struct Player {
  std::vector<uint8_t> image;
  std::vector<int16_t> sourceSamples;
  double sourcePosition = 0;
  int64_t playedFrames = 0;
  bool ended = false;
  bool romOwnedByCore = false;
  mCore* core = nullptr;
  VFile* rom = nullptr;
  mAVStream stream{};
  int activeRate = kSourceRate;
  TagState tags;
  int callbackCount = 0;
  uint32_t lastOffset = 0;
};

void discardLog(struct mLogger*, int, enum mLogLevel, const char*, va_list) {}

struct mLogger silentLogger = { discardLog, nullptr };

void setError(char** target, const char* message) {
  if (target == nullptr) return;
  size_t length = std::strlen(message ? message : "Highly Complete decoder failure.");
  *target = static_cast<char*>(std::malloc(length + 1));
  if (*target != nullptr) std::memcpy(*target, message ? message : "Highly Complete decoder failure.", length + 1);
}

void audioRateChanged(mAVStream* stream, unsigned rate) {
  auto* player = reinterpret_cast<Player*>(reinterpret_cast<char*>(stream) - offsetof(Player, stream));
  player->activeRate = rate > 0 ? static_cast<int>(rate) : kSourceRate;
}

void* openFile(const char* path) { return std::fopen(path, "rb"); }
size_t readFile(void* buffer, size_t size, size_t count, void* handle) { return std::fread(buffer, size, count, static_cast<FILE*>(handle)); }
int seekFile(void* handle, int64_t offset, int origin) { return std::fseek(static_cast<FILE*>(handle), static_cast<long>(offset), origin); }
int closeFile(void* handle) { return std::fclose(static_cast<FILE*>(handle)); }
long tellFile(void* handle) { return std::ftell(static_cast<FILE*>(handle)); }

const psf_file_callbacks callbacks = {
  "/\\", openFile, readFile, seekFile, closeFile, tellFile
};

int parseTime(const char* value) {
  if (value == nullptr) return 0;
  std::string text(value);
  size_t breakAt = text.find_first_of("\r\n");
  if (breakAt != std::string::npos) text.resize(breakAt);
  double seconds = 0;
  if (std::sscanf(text.c_str(), "%lf", &seconds) == 1) return static_cast<int>(std::lround(seconds * 1000.0));
  int minutes = 0;
  if (std::sscanf(text.c_str(), "%d:%lf", &minutes, &seconds) == 2) return minutes * 60000 + static_cast<int>(std::lround(seconds * 1000.0));
  return 0;
}

int collectTags(void* context, const char* name, const char* value) {
  auto* tags = static_cast<TagState*>(context);
  if (tags == nullptr || name == nullptr || value == nullptr) return 0;
  std::string key(name);
  for (char& character : key) character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
  if (key == "title" && tags->title.empty()) tags->title = value;
  else if ((key == "game" || key == "album") && tags->game.empty()) tags->game = value;
  else if ((key == "artist" || key == "composer") && tags->artist.empty()) tags->artist = value;
  else if (key == "comment" || key == "copyright") {
    if (!tags->comment.empty()) tags->comment += " | ";
    tags->comment += value;
  } else if (key == "length") tags->lengthMs = parseTime(value);
  else if (key == "fade") tags->fadeMs = parseTime(value);
  return 0;
}

uint32_t readLE32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) | (static_cast<uint32_t>(data[1]) << 8U) |
    (static_cast<uint32_t>(data[2]) << 16U) | (static_cast<uint32_t>(data[3]) << 24U);
}

int loadImage(void* context, const uint8_t* exe, size_t exeSize, const uint8_t*, size_t) {
  auto* loader = static_cast<LoaderState*>(context);
  if (loader == nullptr || exe == nullptr || exeSize < 12) return -1;
  loader->callbacks += 1;
  uint32_t offset = readLE32(exe + 4) & 0x01ffffffU;
  uint32_t size = readLE32(exe + 8);
  loader->lastOffset = offset;
  if (size < exeSize - 12) return -1;
  size_t required = static_cast<size_t>(offset) + size;
  if (loader->image.size() < required) loader->image.resize(required, 0);
  std::memcpy(loader->image.data() + offset, exe + 12, size);
  return 0;
}

void closeCore(Player* player) {
  if (player->core != nullptr) {
    player->core->deinit(player->core);
    player->core = nullptr;
  }
  if (player->rom != nullptr && !player->romOwnedByCore) {
    player->rom->close(player->rom);
  }
  player->rom = nullptr;
  player->romOwnedByCore = false;
  player->sourceSamples.clear();
  player->sourcePosition = 0;
}

bool initializeCore(Player* player, char** error) {
  closeCore(player);
  mLogSetDefaultLogger(&silentLogger);
  mLogSetThreadLogger(&silentLogger);
  player->rom = VFileFromConstMemory(player->image.data(), player->image.size());
  if (player->rom == nullptr) { setError(error, "Highly Complete could not create a ROM view."); return false; }
  player->core = mCoreFindVF(player->rom);
  if (player->core == nullptr) {
    char message[160];
    unsigned entrySignature = player->image.size() > 3 ? player->image[3] : 0;
    unsigned logoSignature = player->image.size() > 0xB2 ? player->image[0xB2] : 0;
    std::snprintf(message, sizeof(message), "Highly Complete could not recognize the GSF payload (image=%zu, callbacks=%d, offset=%x, bytes=%02x%02x%02x%02x, entry=%02x, logo=%02x).", player->image.size(), player->callbackCount, player->lastOffset, player->image.size() > 0 ? player->image[0] : 0, player->image.size() > 1 ? player->image[1] : 0, player->image.size() > 2 ? player->image[2] : 0, player->image.size() > 3 ? player->image[3] : 0, entrySignature, logoSignature);
    setError(error, message);
    return false;
  }
  if (!player->core->init(player->core)) { setError(error, "Highly Complete could not initialize mGBA."); closeCore(player); return false; }
  player->stream.audioRateChanged = audioRateChanged;
  player->core->setAVStream(player->core, &player->stream);
  mCoreInitConfig(player->core, nullptr);
  mCoreOptions options{};
  options.skipBios = true;
  options.useBios = false;
  options.sampleRate = kSourceRate;
  options.volume = 0x100;
  mCoreConfigLoadDefaults(&player->core->config, &options);
  player->core->setAudioBufferSize(player->core, kCoreAudioChunk);
  if (!player->core->loadROM(player->core, player->rom)) { setError(error, "Highly Complete could not load the GSF image."); closeCore(player); return false; }
  player->romOwnedByCore = true;
  player->core->reset(player->core);
  player->activeRate = kSourceRate;
  player->sourcePosition = 0;
  player->playedFrames = 0;
  player->ended = false;
  return true;
}

bool appendSource(Player* player, size_t required) {
  auto* buffer = player->core->getAudioBuffer(player->core);
  int emptyRuns = 0;
  while (player->sourceSamples.size() / kChannels < required && !player->ended) {
    size_t available = mAudioBufferAvailable(buffer);
    if (available > 0) {
      size_t take = std::min(available, kCoreAudioChunk);
      size_t oldSize = player->sourceSamples.size();
      player->sourceSamples.resize(oldSize + take * kChannels);
      mAudioBufferRead(buffer, player->sourceSamples.data() + oldSize, take);
      emptyRuns = 0;
      continue;
    }
    player->core->runFrame(player->core);
    if (mAudioBufferAvailable(buffer) == 0 && ++emptyRuns >= kEmptyRunLimit) player->ended = true;
  }
  return player->sourceSamples.size() / kChannels >= required;
}

int render(Player* player, int requested, int16_t* output, int* rendered, char** error) {
  if (player == nullptr || player->core == nullptr || rendered == nullptr) { setError(error, "Highly Complete render state is invalid."); return 1; }
  *rendered = 0;
  for (int frame = 0; frame < requested; frame += 1) {
    double step = static_cast<double>(player->activeRate) / kOutputRate;
    size_t base = static_cast<size_t>(player->sourcePosition);
    if (!appendSource(player, base + 2)) break;
    size_t available = player->sourceSamples.size() / kChannels;
    if (available == 0) break;
    size_t next = std::min(base + 1, available - 1);
    double fraction = player->sourcePosition - base;
    int left = static_cast<int>(std::lround(player->sourceSamples[base * 2] + (player->sourceSamples[next * 2] - player->sourceSamples[base * 2]) * fraction));
    int right = static_cast<int>(std::lround(player->sourceSamples[base * 2 + 1] + (player->sourceSamples[next * 2 + 1] - player->sourceSamples[base * 2 + 1]) * fraction));
    if (output != nullptr) { output[frame * 2] = static_cast<int16_t>(std::max(-32768, std::min(32767, left))); output[frame * 2 + 1] = static_cast<int16_t>(std::max(-32768, std::min(32767, right))); }
    player->sourcePosition += step;
    player->playedFrames += 1;
    *rendered += 1;
    if (player->sourcePosition >= 2048.0) {
      size_t drop = static_cast<size_t>(player->sourcePosition);
      if (drop >= available) { player->sourceSamples.clear(); player->sourcePosition = 0; }
      else { player->sourceSamples.erase(player->sourceSamples.begin(), player->sourceSamples.begin() + drop * 2); player->sourcePosition -= drop; }
    }
  }
  return 0;
}

void copyString(char** destination, const std::string& value) {
  *destination = static_cast<char*>(std::malloc(value.size() + 1));
  if (*destination != nullptr) std::memcpy(*destination, value.c_str(), value.size() + 1);
}

void clearMetadata(highlycomplete_metadata_t* metadata) {
  if (metadata == nullptr) return;
  std::free(metadata->title); std::free(metadata->game); std::free(metadata->system);
  std::free(metadata->artist); std::free(metadata->comment);
  std::memset(metadata, 0, sizeof(*metadata));
}

} // namespace

extern "C" highlycomplete_player_handle_t highlycomplete_player_create(const char* path, int32_t sample_rate, int32_t track_index, char** error) {
  (void)sample_rate;
  if (track_index != 0) { setError(error, "Highly Complete GSF files expose one track."); return nullptr; }
  LoaderState loader;
  TagState tags;
  if (psf_load(path, &callbacks, 0x22, loadImage, &loader, collectTags, &tags, 1) != 0x22) { setError(error, "Highly Complete could not decode this GSF/miniGSF file."); return nullptr; }
  auto* player = new Player();
  player->image = std::move(loader.image);
  player->tags = std::move(tags);
  player->callbackCount = loader.callbacks;
  player->lastOffset = loader.lastOffset;
  if (!initializeCore(player, error)) { delete player; return nullptr; }
  return player;
}

extern "C" void highlycomplete_player_destroy(highlycomplete_player_handle_t handle) {
  auto* player = static_cast<Player*>(handle);
  if (player == nullptr) return;
  closeCore(player);
  delete player;
}

extern "C" int32_t highlycomplete_player_configure(highlycomplete_player_handle_t handle, int32_t, int32_t, bool, char**) { return handle == nullptr ? 1 : 0; }

extern "C" int32_t highlycomplete_player_read_metadata(highlycomplete_player_handle_t handle, highlycomplete_metadata_t* metadata, char** error) {
  auto* player = static_cast<Player*>(handle);
  if (player == nullptr || metadata == nullptr) { setError(error, "Highly Complete metadata state is invalid."); return 1; }
  clearMetadata(metadata);
  copyString(&metadata->title, player->tags.title);
  copyString(&metadata->game, player->tags.game);
  copyString(&metadata->system, "Game Boy Advance");
  copyString(&metadata->artist, player->tags.artist);
  copyString(&metadata->comment, player->tags.comment);
  metadata->play_length_ms = player->tags.lengthMs;
  metadata->fade_length_ms = player->tags.fadeMs;
  metadata->track_count = 1;
  return 0;
}

extern "C" int32_t highlycomplete_player_seek_milliseconds(highlycomplete_player_handle_t handle, int32_t milliseconds, char** error) {
  auto* player = static_cast<Player*>(handle);
  if (player == nullptr) { setError(error, "Highly Complete playback is not initialized."); return 1; }
  if (!initializeCore(player, error)) return 1;
  int target = static_cast<int>((static_cast<int64_t>(std::max(milliseconds, 0)) * kOutputRate) / 1000);
  int rendered = 0;
  while (player->playedFrames < target) { int request = std::min(2048, target - static_cast<int>(player->playedFrames)); if (render(player, request, nullptr, &rendered, error) != 0 || rendered == 0) break; }
  return 0;
}

extern "C" int32_t highlycomplete_player_render_s16(highlycomplete_player_handle_t handle, int32_t requested, int16_t* samples, int32_t* rendered, char** error) { return render(static_cast<Player*>(handle), requested, samples, rendered, error); }
extern "C" int32_t highlycomplete_player_track_ended(highlycomplete_player_handle_t handle) { auto* player = static_cast<Player*>(handle); return player == nullptr || player->ended; }
extern "C" int64_t highlycomplete_player_played_frames(highlycomplete_player_handle_t handle) { auto* player = static_cast<Player*>(handle); return player == nullptr ? 0 : player->playedFrames; }
extern "C" void highlycomplete_metadata_clear(highlycomplete_metadata_t* metadata) { clearMetadata(metadata); }
