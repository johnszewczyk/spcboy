#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* libvgm_player_handle_t;

typedef struct {
    char* title;
    char* game;
    char* system;
    char* artist;
    char* comment;
    int32_t intro_length_ms;
    int32_t loop_length_ms;
    int32_t play_length_ms;
    int32_t fade_length_ms;
    int32_t track_count;
} libvgm_metadata_t;

libvgm_player_handle_t libvgm_player_create(
    const char* path,
    int32_t sample_rate,
    int32_t track_index,
    char** error_message
);
void libvgm_player_destroy(libvgm_player_handle_t handle);

int32_t libvgm_player_configure(
    libvgm_player_handle_t handle,
    int32_t loop_seconds,
    int32_t fade_seconds,
    bool uses_native_ending,
    char** error_message
);
int32_t libvgm_player_set_playback_speed(
    libvgm_player_handle_t handle,
    int32_t numerator,
    int32_t denominator,
    char** error_message
);
int32_t libvgm_player_read_metadata(
    libvgm_player_handle_t handle,
    libvgm_metadata_t* metadata,
    char** error_message
);
int32_t libvgm_player_seek_milliseconds(
    libvgm_player_handle_t handle,
    int32_t milliseconds,
    char** error_message
);
int32_t libvgm_player_render_s16(
    libvgm_player_handle_t handle,
    int32_t requested_frames,
    int16_t* interleaved_samples,
    int32_t* rendered_frames,
    char** error_message
);
int32_t libvgm_player_track_ended(libvgm_player_handle_t handle);
int32_t libvgm_player_played_frames(libvgm_player_handle_t handle);

int32_t libvgm_inspect_file(
    const char* path,
    libvgm_metadata_t* metadata,
    int32_t* track_count,
    char** error_message
);

void libvgm_metadata_clear(libvgm_metadata_t* metadata);
void libvgm_error_message_free(char* error_message);

#ifdef __cplusplus
}
#endif
