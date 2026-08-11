#include "libvgm_bridge.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

static const char* text(const char* value) { return value ? value : ""; }

static void json(const char* value) {
    std::fputc('"', stdout);
    for (const unsigned char* cursor = reinterpret_cast<const unsigned char*>(text(value)); *cursor; ++cursor) {
        if (*cursor == '\\' || *cursor == '"') std::fputc('\\', stdout);
        if (*cursor == '\n') { std::fputs("\\n", stdout); continue; }
        if (*cursor == '\r') { std::fputs("\\r", stdout); continue; }
        std::fputc(*cursor, stdout);
    }
    std::fputc('"', stdout);
}

static int fail(char* error) {
    std::fprintf(stderr, "%s\n", text(error));
    libvgm_error_message_free(error);
    return 1;
}

static int inspect(const char* path) {
    libvgm_metadata_t metadata{};
    int32_t trackCount = 0;
    char* error = nullptr;
    const int32_t status = libvgm_inspect_file(path, &metadata, &trackCount, &error);
    if (status != 0) return fail(error);
    std::printf("{\"song\":"); json(metadata.title);
    std::printf(",\"game\":"); json(metadata.game);
    std::printf(",\"author\":"); json(metadata.artist);
    std::printf(",\"system\":"); json(metadata.system);
    std::printf(",\"comment\":"); json(metadata.comment);
    std::printf(",\"play_length\":%d,\"track_count\":%d}\n", metadata.play_length_ms, trackCount);
    libvgm_metadata_clear(&metadata);
    return 0;
}

static int decodeRaw(const char* path, int32_t startMs, int32_t playMs, int32_t fadeMs) {
    char* error = nullptr;
    libvgm_player_handle_t handle = libvgm_player_create(path, 44100, 0, &error);
    if (!handle) return fail(error);
    if (libvgm_player_configure(handle, playMs / 1000, fadeMs / 1000, false, &error) != 0) {
        libvgm_player_destroy(handle);
        return fail(error);
    }
    if (startMs > 0 && libvgm_player_seek_milliseconds(handle, startMs, &error) != 0) {
        libvgm_player_destroy(handle);
        return fail(error);
    }
    const int32_t frameLimit = std::max(1, static_cast<int32_t>((std::max(1, playMs) / 1000.0) * 44100));
    std::vector<int16_t> samples(4096 * 2);
    int32_t renderedTotal = 0;
    while (renderedTotal < frameLimit && !libvgm_player_track_ended(handle)) {
        int32_t rendered = 0;
        const int32_t requested = std::min<int32_t>(4096, frameLimit - renderedTotal);
        if (libvgm_player_render_s16(handle, requested, samples.data(), &rendered, &error) != 0) {
            libvgm_player_destroy(handle);
            return fail(error);
        }
        if (rendered <= 0) break;
        std::fwrite(samples.data(), sizeof(int16_t) * 2, static_cast<size_t>(rendered), stdout);
        renderedTotal += rendered;
    }
    libvgm_player_destroy(handle);
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 3 && std::strcmp(argv[1], "inspect") == 0) return inspect(argv[2]);
    if (argc >= 6 && std::strcmp(argv[1], "decode-raw") == 0) {
        return decodeRaw(argv[2], std::atoi(argv[3]), std::atoi(argv[4]), std::atoi(argv[5]));
    }
    std::fprintf(stderr, "usage: libvgm-tool inspect <path>\n");
    std::fprintf(stderr, "   or: libvgm-tool decode-raw <path> <start-ms> <play-ms> <fade-ms>\n");
    return 1;
}
