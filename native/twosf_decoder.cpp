#include "twosf_decoder.h"

#include "twosf_bridge.h"

#include <cstdio>
#include <cstdlib>

namespace {

struct TwoSFDecoder {
  NativeDecoder base;
  twosf_player_handle_t player;
};

void printError(char* error) {
  if (error == nullptr) return;
  std::fprintf(stderr, "%s\n", error);
  std::free(error);
}

void destroy(NativeDecoder* decoder) {
  auto* twoSF = reinterpret_cast<TwoSFDecoder*>(decoder);
  twosf_player_destroy(twoSF->player);
  std::free(twoSF);
}

int configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
  auto* twoSF = reinterpret_cast<TwoSFDecoder*>(decoder);
  char* error = nullptr;
  int result = twosf_player_configure(twoSF->player, play_ms, fade_ms, &error);
  if (result != 0) printError(error);
  return result;
}

int seek(NativeDecoder* decoder, int milliseconds) {
  auto* twoSF = reinterpret_cast<TwoSFDecoder*>(decoder);
  char* error = nullptr;
  int result = twosf_player_seek_milliseconds(twoSF->player, milliseconds, &error);
  if (result != 0) printError(error);
  return result;
}

int renderS16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
  auto* twoSF = reinterpret_cast<TwoSFDecoder*>(decoder);
  char* error = nullptr;
  int32_t rendered = 0;
  int result = twosf_player_render_s16(twoSF->player, requested_frames, samples, &rendered, &error);
  if (result != 0) {
    printError(error);
    return result;
  }
  if (rendered_frames != nullptr) *rendered_frames = rendered;
  return 0;
}

int trackEnded(NativeDecoder* decoder) {
  auto* twoSF = reinterpret_cast<TwoSFDecoder*>(decoder);
  return twosf_player_track_ended(twoSF->player) != 0;
}

uint64_t playedFrames(NativeDecoder* decoder) {
  auto* twoSF = reinterpret_cast<TwoSFDecoder*>(decoder);
  return static_cast<uint64_t>(twosf_player_played_frames(twoSF->player));
}

const NativeDecoderVTable vtable = { destroy, configure, seek, renderS16, trackEnded, playedFrames };

}

extern "C" NativeDecoder* native_twosf_decoder_create(const char* path, int track_index) {
  if (track_index != 0) return nullptr;
  auto* decoder = static_cast<TwoSFDecoder*>(std::calloc(1, sizeof(TwoSFDecoder)));
  if (decoder == nullptr) return nullptr;
  char* error = nullptr;
  // The shared native worker configures timing immediately after creation.
  // Defer the first core load so configuration does not destroy and recreate
  // a live DeSmuME instance; some valid mini2SF sets crash during that cycle.
  decoder->player = twosf_player_create_unconfigured(path, 44100, &error);
  if (decoder->player == nullptr) {
    printError(error);
    std::free(decoder);
    return nullptr;
  }
  decoder->base.vtable = &vtable;
  decoder->base.backend_id = "twosf";
  return &decoder->base;
}
