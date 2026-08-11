#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void * lazyusf_player_handle_t;

typedef struct {
    char *title;
    char *game;
    char *system;
    char *artist;
    char *comment;
    int32_t play_length_ms;
    int32_t fade_length_ms;
} lazyusf_metadata_t;

lazyusf_player_handle_t lazyusf_player_create(const char *path, int32_t sample_rate, char **error_message);
void lazyusf_player_destroy(lazyusf_player_handle_t handle);
int32_t lazyusf_player_read_metadata(lazyusf_player_handle_t handle, lazyusf_metadata_t *metadata, char **error_message);
int32_t lazyusf_player_render_s16(lazyusf_player_handle_t handle, int32_t requested_frames, int16_t *samples, int32_t *rendered_frames, char **error_message);
int32_t lazyusf_player_seek_milliseconds(lazyusf_player_handle_t handle, int32_t milliseconds, char **error_message);
int32_t lazyusf_player_played_frames(lazyusf_player_handle_t handle);
void lazyusf_metadata_clear(lazyusf_metadata_t *metadata);
void lazyusf_error_message_free(char *error_message);

#ifdef __cplusplus
}
#endif
