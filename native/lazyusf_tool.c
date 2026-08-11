#include "lazyusf_bridge.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *text(const char *value) { return value ? value : ""; }

static void print_json(const char *value) {
  fputc('"', stdout);
  for (const unsigned char *cursor = (const unsigned char *)text(value); *cursor; cursor += 1) {
    if (*cursor == '\\' || *cursor == '"') fputc('\\', stdout);
    if (*cursor == '\n') { fputs("\\n", stdout); continue; }
    if (*cursor == '\r') { fputs("\\r", stdout); continue; }
    fputc(*cursor, stdout);
  }
  fputc('"', stdout);
}

static int fail(char *error) {
  fprintf(stderr, "%s\n", text(error));
  lazyusf_error_message_free(error);
  return 1;
}

static int open_player(const char *path, lazyusf_player_handle_t *out) {
  char *error = NULL;
  *out = lazyusf_player_create(path, 44100, &error);
  if (!*out) return fail(error);
  return 0;
}

static int inspect(const char *path) {
  lazyusf_player_handle_t player = NULL;
  if (open_player(path, &player) != 0) return 1;

  lazyusf_metadata_t metadata = {0};
  char *error = NULL;
  if (lazyusf_player_read_metadata(player, &metadata, &error) != 0) {
    lazyusf_player_destroy(player);
    return fail(error);
  }

  printf("{\"song\":"); print_json(metadata.title);
  printf(",\"game\":"); print_json(metadata.game);
  printf(",\"author\":"); print_json(metadata.artist);
  printf(",\"system\":"); print_json(metadata.system);
  printf(",\"comment\":"); print_json(metadata.comment);
  printf(",\"play_length\":%d,\"fade_length\":%d}\n", metadata.play_length_ms, metadata.fade_length_ms);

  lazyusf_metadata_clear(&metadata);
  lazyusf_player_destroy(player);
  return 0;
}

static int decode_raw(const char *path, int32_t start_ms, int32_t play_ms) {
  lazyusf_player_handle_t player = NULL;
  if (open_player(path, &player) != 0) return 1;

  char *error = NULL;
  if (start_ms > 0 && lazyusf_player_seek_milliseconds(player, start_ms, &error) != 0) {
    lazyusf_player_destroy(player);
    return fail(error);
  }

  const int32_t frame_limit = (int32_t)(((int64_t)(play_ms > 0 ? play_ms : 1) * 44100) / 1000);
  int16_t samples[4096 * 2];
  int32_t rendered_total = 0;
  while (rendered_total < frame_limit) {
    const int32_t requested = frame_limit - rendered_total > 4096 ? 4096 : frame_limit - rendered_total;
    int32_t rendered = 0;
    if (lazyusf_player_render_s16(player, requested, samples, &rendered, &error) != 0) {
      lazyusf_player_destroy(player);
      return fail(error);
    }
    if (rendered <= 0) break;
    fwrite(samples, sizeof(int16_t) * 2, (size_t)rendered, stdout);
    rendered_total += rendered;
  }

  lazyusf_player_destroy(player);
  return ferror(stdout) ? 1 : 0;
}

int main(int argc, char **argv) {
  if (argc >= 3 && strcmp(argv[1], "inspect") == 0) return inspect(argv[2]);
  if (argc >= 5 && strcmp(argv[1], "decode-raw") == 0) {
    return decode_raw(argv[2], atoi(argv[3]), atoi(argv[4]));
  }
  fprintf(stderr, "usage: lazyusf-tool inspect <path>\n");
  fprintf(stderr, "   or: lazyusf-tool decode-raw <path> <start-ms> <play-ms>\n");
  return 1;
}
