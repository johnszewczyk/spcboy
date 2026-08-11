#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* vgmstream_player_handle_t;

typedef struct {
  char* title;
  char* system;
  char* comment;
  int32_t sample_rate;
  int32_t channel_count;
  int32_t track_index;
  int32_t track_count;
  int64_t play_length_frames;
  int64_t loop_length_frames;
  bool looped;
} vgmstream_metadata_t;

vgmstream_player_handle_t vgmstream_player_create(const char* path, int32_t sample_rate, int32_t track_index, char** error_message);
void vgmstream_player_destroy(vgmstream_player_handle_t handle);
int32_t vgmstream_player_read_metadata(vgmstream_player_handle_t handle, vgmstream_metadata_t* metadata, char** error_message);
int32_t vgmstream_player_configure(vgmstream_player_handle_t handle, bool long_play, char** error_message);
int32_t vgmstream_player_render_s16(vgmstream_player_handle_t handle, int32_t requested_frames, int16_t* samples, int32_t* rendered_frames, char** error_message);
int32_t vgmstream_player_seek_milliseconds(vgmstream_player_handle_t handle, int32_t milliseconds, char** error_message);
int32_t vgmstream_player_track_ended(vgmstream_player_handle_t handle);
int64_t vgmstream_player_played_frames(vgmstream_player_handle_t handle);
void vgmstream_metadata_clear(vgmstream_metadata_t* metadata);

#ifdef __cplusplus
}
#endif
