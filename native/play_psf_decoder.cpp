#include "play_psf_decoder.h"

#include "play_psf_bridge.h"

#include <cstdlib>

namespace {

struct PlayPsfDecoder {
    NativeDecoder base;
    void* player = nullptr;
};

void destroy(NativeDecoder* decoder) {
    auto* psf = reinterpret_cast<PlayPsfDecoder*>(decoder);
    spcboy_play_psf_close(psf->player);
    std::free(psf);
}

int configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
    auto* psf = reinterpret_cast<PlayPsfDecoder*>(decoder);
    spcboy_play_psf_set_long_play(psf->player, play_ms <= 0 ? 1 : 0);
    (void)fade_ms;
    return 0;
}

int seek(NativeDecoder* decoder, int milliseconds) {
    auto* psf = reinterpret_cast<PlayPsfDecoder*>(decoder);
    return spcboy_play_psf_seek(psf->player, static_cast<int64_t>(milliseconds) * 44100 / 1000);
}

int renderS16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
    auto* psf = reinterpret_cast<PlayPsfDecoder*>(decoder);
    const int32_t rendered = spcboy_play_psf_read(psf->player, samples, requested_frames);
    if(rendered_frames != nullptr) *rendered_frames = rendered > 0 ? rendered : 0;
    return rendered < 0 ? 1 : 0;
}

int trackEnded(NativeDecoder* decoder) {
    auto* psf = reinterpret_cast<PlayPsfDecoder*>(decoder);
    return spcboy_play_psf_finished(psf->player) != 0;
}

uint64_t playedFrames(NativeDecoder* decoder) {
    auto* psf = reinterpret_cast<PlayPsfDecoder*>(decoder);
    return static_cast<uint64_t>(spcboy_play_psf_played_frames(psf->player));
}

const NativeDecoderVTable vtable = { destroy, configure, seek, renderS16, trackEnded, playedFrames };

}

extern "C" NativeDecoder* native_play_psf_decoder_create(const char* path, int track_index) {
    if(track_index != 0) return nullptr;
    auto* decoder = static_cast<PlayPsfDecoder*>(std::calloc(1, sizeof(PlayPsfDecoder)));
    if(decoder == nullptr) return nullptr;
    decoder->player = spcboy_play_psf_open(path);
    if(decoder->player == nullptr) {
        std::free(decoder);
        return nullptr;
    }
    decoder->base.vtable = &vtable;
    decoder->base.backend_id = "playpsf";
    return &decoder->base;
}
