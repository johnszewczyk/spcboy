#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* sid_player_handle_t;

typedef struct {
  char* title;
  char* game;
  char* system;
  char* artist;
  char* comment;
  int32_t play_length_ms;
  int32_t fade_length_ms;
} sid_metadata_t;

sid_player_handle_t sid_player_create(const char* path, int32_t sample_rate, char** error_message);
void sid_player_destroy(sid_player_handle_t handle);
int32_t sid_inspect_metadata(const char* path, sid_metadata_t* metadata, char** error_message);
int32_t sid_player_read_metadata(sid_player_handle_t handle, sid_metadata_t* metadata, char** error_message);
int32_t sid_player_configure(sid_player_handle_t handle, int32_t play_length_ms, int32_t fade_length_ms, char** error_message);
int32_t sid_player_render_s16(sid_player_handle_t handle, int32_t requested_frames, int16_t* samples, int32_t* rendered_frames, char** error_message);
int32_t sid_player_seek_milliseconds(sid_player_handle_t handle, int32_t milliseconds, char** error_message);
int32_t sid_player_track_ended(sid_player_handle_t handle);
int32_t sid_player_played_frames(sid_player_handle_t handle);
void sid_metadata_clear(sid_metadata_t* metadata);

#ifdef __cplusplus
}
#endif
