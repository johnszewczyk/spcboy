#include "lazyusf_bridge.h"

#include "psflib.h"
#include "usf/usf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

typedef struct {
    unsigned char *state;
    int32_t sample_rate;
    int32_t played_frames;
    int32_t play_length_ms;
    int32_t fade_length_ms;
    int enable_compare;
    int enable_fifo_full;
    char *title;
    char *game;
    char *system;
    char *artist;
    char *comment;
    char error[256];
} lazyusf_player_t;

static void *stdio_fopen(const char *path) { return fopen(path, "rb"); }
static size_t stdio_fread(void *p, size_t size, size_t count, void *file) { return fread(p, size, count, (FILE *)file); }
static int stdio_fseek(void *file, int64_t offset, int whence) { return fseek((FILE *)file, (long)offset, whence); }
static int stdio_fclose(void *file) { return fclose((FILE *)file); }
static long stdio_ftell(void *file) { return ftell((FILE *)file); }

static const psf_file_callbacks file_callbacks = {
    "\\/:",
    stdio_fopen,
    stdio_fread,
    stdio_fseek,
    stdio_fclose,
    stdio_ftell
};

static char *copy_string(const char *value) {
    if (!value || !*value) return NULL;
    size_t length = strlen(value) + 1;
    char *copy = (char *)malloc(length);
    if (copy) memcpy(copy, value, length);
    return copy;
}

static int parse_time_ms(const char *input) {
    if (!input || !*input) return 0;
    int minutes = 0;
    double seconds = 0;
    if (sscanf(input, "%d:%lf", &minutes, &seconds) == 2)
        return (minutes * 60 * 1000) + (int)(seconds * 1000.0);
    if (sscanf(input, "%lf", &seconds) == 1)
        return (int)(seconds * 1000.0);
    return 0;
}

static void set_string(char **destination, const char *value) {
    free(*destination);
    *destination = copy_string(value);
}

static int load_callback(void *context, const uint8_t *exe, size_t exe_size, const uint8_t *reserved, size_t reserved_size) {
    lazyusf_player_t *player = (lazyusf_player_t *)context;
    if (exe && exe_size > 0) {
        snprintf(player->error, sizeof(player->error), "USF executable sections are not supported.");
        return -1;
    }
    return usf_upload_section(player->state, reserved, reserved_size);
}

static int info_callback(void *context, const char *name, const char *value) {
    lazyusf_player_t *player = (lazyusf_player_t *)context;
    if (strcasecmp(name, "title") == 0) set_string(&player->title, value);
    else if (strcasecmp(name, "game") == 0 || strcasecmp(name, "album") == 0) set_string(&player->game, value);
    else if (strcasecmp(name, "system") == 0) set_string(&player->system, value);
    else if (strcasecmp(name, "artist") == 0 || strcasecmp(name, "composer") == 0) set_string(&player->artist, value);
    else if (strcasecmp(name, "comment") == 0) set_string(&player->comment, value);
    else if (strcasecmp(name, "length") == 0) player->play_length_ms = parse_time_ms(value);
    else if (strcasecmp(name, "fade") == 0) player->fade_length_ms = parse_time_ms(value);
    else if (strcasecmp(name, "_enablecompare") == 0) player->enable_compare = 1;
    else if (strcasecmp(name, "_enablefifofull") == 0) player->enable_fifo_full = 1;
    return 0;
}

static void set_error(char **error_message, const char *message) {
    if (!error_message) return;
    *error_message = copy_string(message ? message : "USF decoder failure.");
}

lazyusf_player_handle_t lazyusf_player_create(const char *path, int32_t sample_rate, char **error_message) {
    lazyusf_player_t *player = (lazyusf_player_t *)calloc(1, sizeof(*player));
    if (!player) { set_error(error_message, "Could not allocate USF decoder state."); return NULL; }
    player->state = (unsigned char *)malloc(usf_get_state_size());
    if (!player->state) { free(player); set_error(error_message, "Could not allocate USF emulator state."); return NULL; }
    usf_clear(player->state);
    if (psf_load(path, &file_callbacks, 0x21, load_callback, player, info_callback, player, 1) <= 0) {
        set_error(error_message, player->error[0] ? player->error : "Could not load USF file.");
        lazyusf_player_destroy(player);
        return NULL;
    }
    usf_set_compare(player->state, player->enable_compare);
    usf_set_fifo_full(player->state, player->enable_fifo_full);
    usf_set_hle_audio(player->state, 1);
    player->sample_rate = sample_rate;
    return player;
}

void lazyusf_player_destroy(lazyusf_player_handle_t handle) {
    lazyusf_player_t *player = (lazyusf_player_t *)handle;
    if (!player) return;
    if (player->state) { usf_shutdown(player->state); free(player->state); }
    free(player->title); free(player->game); free(player->system); free(player->artist); free(player->comment);
    free(player);
}

int32_t lazyusf_player_read_metadata(lazyusf_player_handle_t handle, lazyusf_metadata_t *metadata, char **error_message) {
    lazyusf_player_t *player = (lazyusf_player_t *)handle;
    if (!player || !metadata) { set_error(error_message, "USF decoder is not initialized."); return -1; }
    memset(metadata, 0, sizeof(*metadata));
    metadata->title = copy_string(player->title);
    metadata->game = copy_string(player->game);
    metadata->system = copy_string(player->system ? player->system : "Nintendo 64");
    metadata->artist = copy_string(player->artist);
    metadata->comment = copy_string(player->comment);
    metadata->play_length_ms = player->play_length_ms;
    metadata->fade_length_ms = player->fade_length_ms;
    return 0;
}

int32_t lazyusf_player_render_s16(lazyusf_player_handle_t handle, int32_t requested_frames, int16_t *samples, int32_t *rendered_frames, char **error_message) {
    lazyusf_player_t *player = (lazyusf_player_t *)handle;
    if (!player || requested_frames < 0) { set_error(error_message, "USF decoder is not initialized."); return -1; }
    int32_t actual_rate = 0;
    const char *error = usf_render_resampled(player->state, samples, (size_t)requested_frames, player->sample_rate);
    if (error) { set_error(error_message, error); return -1; }
    if (rendered_frames) *rendered_frames = requested_frames;
    player->played_frames += requested_frames;
    (void)actual_rate;
    return 0;
}

int32_t lazyusf_player_seek_milliseconds(lazyusf_player_handle_t handle, int32_t milliseconds, char **error_message) {
    lazyusf_player_t *player = (lazyusf_player_t *)handle;
    if (!player || milliseconds < 0) { set_error(error_message, "Invalid USF seek request."); return -1; }
    usf_restart(player->state);
    player->played_frames = 0;
    int32_t frames = (int32_t)(((int64_t)milliseconds * player->sample_rate) / 1000);
    while (frames > 0) {
        int32_t chunk = frames > 4096 ? 4096 : frames;
        if (lazyusf_player_render_s16(player, chunk, NULL, NULL, error_message) != 0) return -1;
        frames -= chunk;
    }
    player->played_frames = (int32_t)(((int64_t)milliseconds * player->sample_rate) / 1000);
    return 0;
}

int32_t lazyusf_player_played_frames(lazyusf_player_handle_t handle) {
    lazyusf_player_t *player = (lazyusf_player_t *)handle;
    return player ? player->played_frames : 0;
}

void lazyusf_metadata_clear(lazyusf_metadata_t *metadata) {
    if (!metadata) return;
    free(metadata->title); free(metadata->game); free(metadata->system); free(metadata->artist); free(metadata->comment);
    memset(metadata, 0, sizeof(*metadata));
}

void lazyusf_error_message_free(char *error_message) { free(error_message); }
