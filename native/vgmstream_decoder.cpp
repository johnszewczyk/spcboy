#include "vgmstream_decoder.h"

#include "vgmstream_bridge.h"

#include <cstdio>
#include <cstdlib>

namespace {
struct VgmstreamDecoder { NativeDecoder base; vgmstream_player_handle_t player; };

void printError(char* error) {
  if (error == nullptr) return;
  std::fprintf(stderr, "%s\n", error);
  std::free(error);
}

void destroy(NativeDecoder* decoder) {
  auto* vgm = reinterpret_cast<VgmstreamDecoder*>(decoder);
  vgmstream_player_destroy(vgm->player);
  std::free(vgm);
}

int configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
  (void)play_ms;
  (void)fade_ms;
  auto* vgm = reinterpret_cast<VgmstreamDecoder*>(decoder);
  char* error = nullptr;
  const int result = vgmstream_player_configure(vgm->player, false, &error);
  if (result != 0) printError(error);
  return result;
}

int seek(NativeDecoder* decoder, int milliseconds) {
  auto* vgm = reinterpret_cast<VgmstreamDecoder*>(decoder);
  char* error = nullptr;
  const int result = vgmstream_player_seek_milliseconds(vgm->player, milliseconds, &error);
  if (result != 0) printError(error);
  return result;
}

int renderS16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
  auto* vgm = reinterpret_cast<VgmstreamDecoder*>(decoder);
  char* error = nullptr;
  int32_t rendered = 0;
  const int result = vgmstream_player_render_s16(vgm->player, requested_frames, samples, &rendered, &error);
  if (result != 0) {
    printError(error);
    return result;
  }
  if (rendered_frames != nullptr) *rendered_frames = rendered;
  return 0;
}

int trackEnded(NativeDecoder* decoder) { return vgmstream_player_track_ended(reinterpret_cast<VgmstreamDecoder*>(decoder)->player); }
uint64_t playedFrames(NativeDecoder* decoder) { return static_cast<uint64_t>(vgmstream_player_played_frames(reinterpret_cast<VgmstreamDecoder*>(decoder)->player)); }
const NativeDecoderVTable vtable = { destroy, configure, seek, renderS16, trackEnded, playedFrames };
}

extern "C" NativeDecoder* native_vgmstream_decoder_create(const char* path, int track_index) {
  auto* decoder = static_cast<VgmstreamDecoder*>(std::calloc(1, sizeof(VgmstreamDecoder)));
  if (decoder == nullptr) return nullptr;
  char* error = nullptr;
  decoder->player = vgmstream_player_create(path, 44100, track_index + 1, &error);
  if (decoder->player == nullptr) {
    printError(error);
    std::free(decoder);
    return nullptr;
  }
  decoder->base.vtable = &vtable;
  decoder->base.backend_id = "vgmstream";
  return &decoder->base;
}
