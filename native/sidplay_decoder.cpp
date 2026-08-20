#include "sidplay_decoder.h"

#include "sidplay_bridge.h"

#include <cstdio>
#include <cstdlib>

namespace {

struct SidDecoder {
  NativeDecoder base;
  sid_player_handle_t player;
};

void printError(char* error) {
  if (error == nullptr) return;
  std::fprintf(stderr, "%s\n", error);
  std::free(error);
}

void destroy(NativeDecoder* decoder) {
  auto* sid = reinterpret_cast<SidDecoder*>(decoder);
  sid_player_destroy(sid->player);
  std::free(sid);
}

int configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
  auto* sid = reinterpret_cast<SidDecoder*>(decoder);
  char* error = nullptr;
  int result = sid_player_configure(sid->player, play_ms, fade_ms, &error);
  if (result != 0) printError(error);
  return result;
}

int seek(NativeDecoder* decoder, int milliseconds) {
  auto* sid = reinterpret_cast<SidDecoder*>(decoder);
  char* error = nullptr;
  int result = sid_player_seek_milliseconds(sid->player, milliseconds, &error);
  if (result != 0) printError(error);
  return result;
}

int renderS16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
  auto* sid = reinterpret_cast<SidDecoder*>(decoder);
  char* error = nullptr;
  int32_t rendered = 0;
  int result = sid_player_render_s16(sid->player, requested_frames, samples, &rendered, &error);
  if (result != 0) {
    printError(error);
    return result;
  }
  if (rendered_frames != nullptr) *rendered_frames = rendered;
  return 0;
}

int trackEnded(NativeDecoder* decoder) {
  auto* sid = reinterpret_cast<SidDecoder*>(decoder);
  return sid_player_track_ended(sid->player) != 0;
}

uint64_t playedFrames(NativeDecoder* decoder) {
  auto* sid = reinterpret_cast<SidDecoder*>(decoder);
  return static_cast<uint64_t>(sid_player_played_frames(sid->player));
}

const NativeDecoderVTable vtable = { destroy, configure, seek, renderS16, trackEnded, playedFrames };

}

extern "C" NativeDecoder* native_sid_decoder_create(const char* path, int track_index) {
  if (track_index != 0) return nullptr;
  auto* decoder = static_cast<SidDecoder*>(std::calloc(1, sizeof(SidDecoder)));
  if (decoder == nullptr) return nullptr;
  char* error = nullptr;
  decoder->player = sid_player_create(path, 44100, &error);
  if (decoder->player == nullptr) {
    printError(error);
    std::free(decoder);
    return nullptr;
  }
  decoder->base.vtable = &vtable;
  decoder->base.backend_id = "sid";
  return &decoder->base;
}
