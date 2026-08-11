#include "twosf_bridge.h"

#include <functional>
namespace std {
template <typename Arg1, typename Arg2, typename Result>
struct binary_function { using first_argument_type = Arg1; using second_argument_type = Arg2; using result_type = Result; };
}

#include "sseqplayer/XSFFile.h"
#include "sseqplayer/XSFPlayer_2SF.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

struct TwoSFPlayer {
  std::string path;
  int32_t sample_rate = 0;
  int32_t play_length_ms = -1;
  int32_t fade_length_ms = -1;
  int32_t played_frames = 0;
  bool ended = false;
  std::unique_ptr<XSFPlayer_2SF> player;
};

char* copyString(const std::string& value) {
  if (value.empty()) return nullptr;
  char* copy = static_cast<char*>(std::malloc(value.size() + 1));
  if (copy != nullptr) std::memcpy(copy, value.c_str(), value.size() + 1);
  return copy;
}

void setError(char** target, const std::string& message) {
  if (target != nullptr) *target = copyString(message);
}

std::string tag(const XSFFile& file, const char* name) {
  return file.GetTagExists(name) ? file.GetTagValue(name) : "";
}

std::string firstTag(const XSFFile& file, const char* first, const char* second) {
  const std::string first_value = tag(file, first);
  return first_value.empty() ? tag(file, second) : first_value;
}

int32_t milliseconds(const std::string& value) {
  if (value.empty()) return 0;
  const size_t separator = value.find(':');
  try {
    if (separator == std::string::npos) return static_cast<int32_t>(std::llround(std::stod(value) * 1000.0));
    return static_cast<int32_t>(std::llround((std::stod(value.substr(0, separator)) * 60.0 + std::stod(value.substr(separator + 1))) * 1000.0));
  } catch (...) {
    return 0;
  }
}

void readMetadata(const XSFFile& file, twosf_metadata_t* metadata) {
  std::memset(metadata, 0, sizeof(*metadata));
  metadata->title = copyString(tag(file, "title"));
  metadata->game = copyString(firstTag(file, "game", "album"));
  metadata->system = copyString("Nintendo DS");
  metadata->artist = copyString(firstTag(file, "artist", "composer"));
  metadata->comment = copyString(firstTag(file, "comment", "copyright"));
  metadata->play_length_ms = milliseconds(tag(file, "length"));
  metadata->fade_length_ms = milliseconds(tag(file, "fade"));
}

bool safeDependency(const std::string& value) {
  if (value.empty() || value[0] == '/' || value[0] == '\\' || value.find(':') != std::string::npos) return false;
  size_t start = 0;
  while (start < value.size()) {
    const size_t end = value.find_first_of("/\\", start);
    if (value.substr(start, end - start) == "..") return false;
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return true;
}

std::string parentDirectory(const std::string& path) {
  const size_t separator = path.find_last_of("/\\");
  return separator == std::string::npos ? "" : path.substr(0, separator + 1);
}

bool validateDependencies(const std::string& path, std::unordered_set<std::string>& visited, int depth, char** error) {
  if (depth > 16) { setError(error, "2SF dependency chain is too deep."); return false; }
  if (!visited.insert(path).second) return true;
  try {
    XSFFile file(path, 4, 8);
    for (int index = 1; index <= 9; ++index) {
      const std::string name = index == 1 ? "_lib" : "_lib" + std::to_string(index);
      if (!file.GetTagExists(name.c_str())) continue;
      const std::string dependency = file.GetTagValue(name.c_str());
      if (!safeDependency(dependency)) { setError(error, "2SF dependency path escapes its set: " + dependency); return false; }
      if (!validateDependencies(parentDirectory(path) + dependency, visited, depth + 1, error)) return false;
    }
    return true;
  } catch (const std::exception& exception) {
    setError(error, exception.what());
    return false;
  }
}

bool recreate(TwoSFPlayer* state, char** error) {
  try {
    std::unordered_set<std::string> dependencies;
    if (!validateDependencies(state->path, dependencies, 0, error)) return false;
    state->player.reset();
    auto player = std::make_unique<XSFPlayer_2SF>(state->path);
    player->SetSampleRate(state->sample_rate);
    if (state->play_length_ms >= 0 && state->fade_length_ms >= 0) player->SetLength(state->play_length_ms, state->fade_length_ms);
    if (!player->Load(-1)) { setError(error, "Could not load 2SF dependency chain: " + state->path); return false; }
    player->SeekTop();
    const int32_t warmup_frames = std::max<int32_t>(1, state->sample_rate / 8);
    std::vector<uint8_t> warmup(static_cast<size_t>(warmup_frames) * 4);
    unsigned ignored = 0;
    player->FillBuffer(warmup, ignored);
    state->player = std::move(player);
    state->played_frames = 0;
    state->ended = false;
    return true;
  } catch (const std::exception& exception) {
    setError(error, exception.what());
    return false;
  }
}

}

extern "C" twosf_player_handle_t twosf_player_create(const char* path, int32_t sample_rate, char** error) {
  if (path == nullptr || *path == '\0' || sample_rate <= 0) { setError(error, "2SF playback requires a path and positive sample rate."); return nullptr; }
  auto state = std::make_unique<TwoSFPlayer>();
  state->path = path;
  state->sample_rate = sample_rate;
  if (!recreate(state.get(), error)) return nullptr;
  return state.release();
}

extern "C" twosf_player_handle_t twosf_player_create_unconfigured(const char* path, int32_t sample_rate, char** error) {
  if (path == nullptr || *path == '\0' || sample_rate <= 0) { setError(error, "2SF playback requires a path and positive sample rate."); return nullptr; }
  auto state = std::make_unique<TwoSFPlayer>();
  state->path = path;
  state->sample_rate = sample_rate;
  return state.release();
}

extern "C" void twosf_player_destroy(twosf_player_handle_t handle) { delete static_cast<TwoSFPlayer*>(handle); }

extern "C" int32_t twosf_inspect_metadata(const char* path, twosf_metadata_t* metadata, char** error) {
  if (path == nullptr || metadata == nullptr) { setError(error, "2SF metadata inspection requires a file path."); return -1; }
  try { XSFFile file(path, 4, 8); readMetadata(file, metadata); return 0; }
  catch (const std::exception& exception) { setError(error, exception.what()); return -1; }
}

extern "C" int32_t twosf_player_read_metadata(twosf_player_handle_t handle, twosf_metadata_t* metadata, char** error) {
  auto* state = static_cast<TwoSFPlayer*>(handle);
  if (state == nullptr || state->player == nullptr || metadata == nullptr) { setError(error, "2SF decoder is not initialized."); return -1; }
  readMetadata(*state->player->GetXSFFile(), metadata);
  return 0;
}

extern "C" int32_t twosf_player_configure(twosf_player_handle_t handle, int32_t play_length_ms, int32_t fade_length_ms, char** error) {
  auto* state = static_cast<TwoSFPlayer*>(handle);
  if (state == nullptr || play_length_ms < 0 || fade_length_ms < 0) { setError(error, "Invalid 2SF playback configuration."); return -1; }
  state->play_length_ms = play_length_ms;
  state->fade_length_ms = fade_length_ms;
  return recreate(state, error) ? 0 : -1;
}

extern "C" int32_t twosf_player_render_s16(twosf_player_handle_t handle, int32_t requested, int16_t* samples, int32_t* rendered, char** error) {
  auto* state = static_cast<TwoSFPlayer*>(handle);
  if (state == nullptr || state->player == nullptr || requested < 0 || samples == nullptr) { setError(error, "Invalid 2SF render request."); return -1; }
  std::vector<uint8_t> bytes(static_cast<size_t>(requested) * 4);
  unsigned frames = 0;
  try { state->ended = state->player->FillBuffer(bytes, frames); }
  catch (const std::exception& exception) { setError(error, exception.what()); return -1; }
  const int32_t actual = static_cast<int32_t>(std::min<size_t>(frames, static_cast<size_t>(requested)));
  if (actual > 0) std::memcpy(samples, bytes.data(), static_cast<size_t>(actual) * 4);
  if (rendered != nullptr) *rendered = actual;
  state->played_frames += actual;
  return 0;
}

extern "C" int32_t twosf_player_seek_milliseconds(twosf_player_handle_t handle, int32_t milliseconds_to_seek, char** error) {
  auto* state = static_cast<TwoSFPlayer*>(handle);
  if (state == nullptr || milliseconds_to_seek < 0 || !recreate(state, error)) return -1;
  int64_t remaining = static_cast<int64_t>(milliseconds_to_seek) * state->sample_rate / 1000;
  std::vector<int16_t> discard(4096 * 2);
  while (remaining > 0) {
    const int32_t request = static_cast<int32_t>(std::min<int64_t>(remaining, 4096));
    int32_t rendered = 0;
    if (twosf_player_render_s16(state, request, discard.data(), &rendered, error) != 0 || rendered == 0) break;
    remaining -= rendered;
  }
  return 0;
}

extern "C" int32_t twosf_player_track_ended(twosf_player_handle_t handle) { auto* state = static_cast<TwoSFPlayer*>(handle); return state != nullptr && state->ended ? 1 : 0; }
extern "C" int32_t twosf_player_played_frames(twosf_player_handle_t handle) { auto* state = static_cast<TwoSFPlayer*>(handle); return state == nullptr ? 0 : state->played_frames; }
extern "C" void twosf_metadata_clear(twosf_metadata_t* metadata) { if (metadata == nullptr) return; std::free(metadata->title); std::free(metadata->game); std::free(metadata->system); std::free(metadata->artist); std::free(metadata->comment); std::memset(metadata, 0, sizeof(*metadata)); }
