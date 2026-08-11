#pragma once

#include "native_decoder.h"

#ifdef __cplusplus
extern "C" {
#endif

NativeDecoder* native_libvgm_decoder_create(const char* path, int track_index);
int native_libvgm_decoder_set_playback_speed(NativeDecoder* decoder, int numerator, int denominator);

#ifdef __cplusplus
}
#endif
