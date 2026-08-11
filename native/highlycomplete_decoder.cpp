#include "highlycomplete_decoder.h"

#include "highlycomplete_bridge.h"

#include <cstdio>
#include <cstdlib>

namespace {

struct HighlyCompleteDecoder {
  NativeDecoder base;
  highlycomplete_player_handle_t player;
};

void printError(char* error) {
  if (error == nullptr) return;
  std::fprintf(stderr, "%s\n", error);
  std::free(error);
}

void destroy(NativeDecoder* decoder) {
  auto* highlyComplete = reinterpret_cast<HighlyCompleteDecoder*>(decoder);
  highlycomplete_player_destroy(highlyComplete->player);
  std::free(highlyComplete);
}

int configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
  auto* highlyComplete = reinterpret_cast<HighlyCompleteDecoder*>(decoder);
  char* error = nullptr;
  int result = highlycomplete_player_configure(highlyComplete->player, play_ms / 1000, fade_ms / 1000, false, &error);
  if (result != 0) printError(error);
  return result;
}

int seek(NativeDecoder* decoder, int milliseconds) {
  auto* highlyComplete = reinterpret_cast<HighlyCompleteDecoder*>(decoder);
  char* error = nullptr;
  int result = highlycomplete_player_seek_milliseconds(highlyComplete->player, milliseconds, &error);
  if (result != 0) printError(error);
  return result;
}

int renderS16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
  auto* highlyComplete = reinterpret_cast<HighlyCompleteDecoder*>(decoder);
  char* error = nullptr;
  int32_t rendered = 0;
  int result = highlycomplete_player_render_s16(highlyComplete->player, requested_frames, samples, &rendered, &error);
  if (result != 0) {
    printError(error);
    return result;
  }
  if (rendered_frames != nullptr) *rendered_frames = rendered;
  return 0;
}

int trackEnded(NativeDecoder* decoder) {
  auto* highlyComplete = reinterpret_cast<HighlyCompleteDecoder*>(decoder);
  return highlycomplete_player_track_ended(highlyComplete->player) != 0;
}

uint64_t playedFrames(NativeDecoder* decoder) {
  auto* highlyComplete = reinterpret_cast<HighlyCompleteDecoder*>(decoder);
  return static_cast<uint64_t>(highlycomplete_player_played_frames(highlyComplete->player));
}

const NativeDecoderVTable vtable = {
  destroy,
  configure,
  seek,
  renderS16,
  trackEnded,
  playedFrames
};

} // namespace

extern "C" NativeDecoder* native_highlycomplete_decoder_create(const char* path, int track_index) {
  auto* decoder = static_cast<HighlyCompleteDecoder*>(std::calloc(1, sizeof(HighlyCompleteDecoder)));
  if (decoder == nullptr) return nullptr;

  char* error = nullptr;
  decoder->player = highlycomplete_player_create(path, 44100, track_index, &error);
  if (decoder->player == nullptr) {
    printError(error);
    std::free(decoder);
    return nullptr;
  }

  decoder->base.vtable = &vtable;
  decoder->base.backend_id = "highlycomplete";
  return &decoder->base;
}
