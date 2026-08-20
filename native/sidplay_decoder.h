#pragma once

#include "native_decoder.h"

#ifdef __cplusplus
extern "C" {
#endif

NativeDecoder* native_sid_decoder_create(const char* path, int track_index);

#ifdef __cplusplus
}
#endif
