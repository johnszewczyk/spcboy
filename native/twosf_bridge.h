#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* twosf_player_handle_t;

typedef struct {
  char* title;
  char* game;
  char* system;
  char* artist;
  char* comment;
  int32_t play_length_ms;
  int32_t fade_length_ms;
} twosf_metadata_t;

twosf_player_handle_t twosf_player_create(const char* path, int32_t sample_rate, char** error_message);
twosf_player_handle_t twosf_player_create_unconfigured(const char* path, int32_t sample_rate, char** error_message);
void twosf_player_destroy(twosf_player_handle_t handle);
int32_t twosf_inspect_metadata(const char* path, twosf_metadata_t* metadata, char** error_message);
int32_t twosf_player_read_metadata(twosf_player_handle_t handle, twosf_metadata_t* metadata, char** error_message);
int32_t twosf_player_configure(twosf_player_handle_t handle, int32_t play_length_ms, int32_t fade_length_ms, char** error_message);
int32_t twosf_player_render_s16(twosf_player_handle_t handle, int32_t requested_frames, int16_t* samples, int32_t* rendered_frames, char** error_message);
int32_t twosf_player_seek_milliseconds(twosf_player_handle_t handle, int32_t milliseconds, char** error_message);
int32_t twosf_player_track_ended(twosf_player_handle_t handle);
int32_t twosf_player_played_frames(twosf_player_handle_t handle);
void twosf_metadata_clear(twosf_metadata_t* metadata);

#ifdef __cplusplus
}
#endif
