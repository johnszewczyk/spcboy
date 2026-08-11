#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* highlycomplete_player_handle_t;

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
} highlycomplete_metadata_t;

highlycomplete_player_handle_t highlycomplete_player_create(const char* path, int32_t sample_rate, int32_t track_index, char** error_message);
void highlycomplete_player_destroy(highlycomplete_player_handle_t handle);
int32_t highlycomplete_player_configure(highlycomplete_player_handle_t handle, int32_t loop_seconds, int32_t fade_seconds, bool uses_native_ending, char** error_message);
int32_t highlycomplete_player_read_metadata(highlycomplete_player_handle_t handle, highlycomplete_metadata_t* metadata, char** error_message);
int32_t highlycomplete_player_seek_milliseconds(highlycomplete_player_handle_t handle, int32_t milliseconds, char** error_message);
int32_t highlycomplete_player_render_s16(highlycomplete_player_handle_t handle, int32_t requested_frames, int16_t* samples, int32_t* rendered_frames, char** error_message);
int32_t highlycomplete_player_track_ended(highlycomplete_player_handle_t handle);
int64_t highlycomplete_player_played_frames(highlycomplete_player_handle_t handle);
void highlycomplete_metadata_clear(highlycomplete_metadata_t* metadata);

#ifdef __cplusplus
}
#endif
