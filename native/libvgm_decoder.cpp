#include "libvgm_decoder.h"

#include "libvgm/libvgm_bridge.h"

#include <cstdio>
#include <cstdlib>

namespace {

struct LibVGMDecoder {
    NativeDecoder base;
    libvgm_player_handle_t player;
};

void printError(char* error) {
    if (error == nullptr) {
        return;
    }
    std::fprintf(stderr, "%s\n", error);
    libvgm_error_message_free(error);
}

void destroy(NativeDecoder* decoder) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    libvgm_player_destroy(libvgm->player);
    std::free(libvgm);
}

int configure(NativeDecoder* decoder, int play_ms, int fade_ms) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    char* error = nullptr;
    const int result = libvgm_player_configure(
        libvgm->player,
        play_ms / 1000,
        fade_ms / 1000,
        false,
        &error
    );
    if (result != 0) {
        printError(error);
    }
    return result;
}

int seek(NativeDecoder* decoder, int milliseconds) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    char* error = nullptr;
    const int result = libvgm_player_seek_milliseconds(libvgm->player, milliseconds, &error);
    if (result != 0) {
        printError(error);
    }
    return result;
}

int renderS16(NativeDecoder* decoder, int requested_frames, int16_t* samples, int* rendered_frames) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    char* error = nullptr;
    int32_t rendered = 0;
    const int result = libvgm_player_render_s16(
        libvgm->player,
        requested_frames,
        samples,
        &rendered,
        &error
    );
    if (result != 0) {
        printError(error);
        return result;
    }
    if (rendered_frames != nullptr) {
        *rendered_frames = rendered;
    }
    return 0;
}

int trackEnded(NativeDecoder* decoder) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    return libvgm_player_track_ended(libvgm->player) != 0;
}

uint64_t playedFrames(NativeDecoder* decoder) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    const int32_t frames = libvgm_player_played_frames(libvgm->player);
    return frames > 0 ? static_cast<uint64_t>(frames) : 0;
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

extern "C" NativeDecoder* native_libvgm_decoder_create(const char* path, int track_index) {
    LibVGMDecoder* decoder = static_cast<LibVGMDecoder*>(std::calloc(1, sizeof(LibVGMDecoder)));
    if (decoder == nullptr) {
        return nullptr;
    }

    char* error = nullptr;
    decoder->player = libvgm_player_create(path, 44100, track_index, &error);
    if (decoder->player == nullptr) {
        printError(error);
        std::free(decoder);
        return nullptr;
    }

    decoder->base.vtable = &vtable;
    decoder->base.backend_id = "libvgm";
    return &decoder->base;
}

extern "C" int native_libvgm_decoder_set_playback_speed(NativeDecoder* decoder, int numerator, int denominator) {
    LibVGMDecoder* libvgm = reinterpret_cast<LibVGMDecoder*>(decoder);
    char* error = nullptr;
    const int result = libvgm_player_set_playback_speed(libvgm ? libvgm->player : nullptr, numerator, denominator, &error);
    if (result != 0) printError(error);
    return result;
}
