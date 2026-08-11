#ifndef SPCBOY_RING_BUFFER_H
#define SPCBOY_RING_BUFFER_H

#include <stddef.h>
#include <stdint.h>
#include <stdatomic.h>

typedef struct PcmRingBuffer {
  unsigned char* data;
  size_t capacity_bytes;
  /*
   * The decode worker is the sole producer and the Core Audio callback is
   * the sole consumer. Monotonic indices keep that realtime path lock-free.
   * `reset` may race the reader during a track transition; `read` detects
   * that race with a compare-and-swap and reports no stale audio.
   */
  _Atomic uint64_t read_index;
  _Atomic uint64_t write_index;
} PcmRingBuffer;

int pcm_ring_buffer_init(PcmRingBuffer* buffer, size_t capacity_bytes);
void pcm_ring_buffer_destroy(PcmRingBuffer* buffer);
void pcm_ring_buffer_reset(PcmRingBuffer* buffer);
size_t pcm_ring_buffer_available_to_read(const PcmRingBuffer* buffer);
size_t pcm_ring_buffer_available_to_write(const PcmRingBuffer* buffer);
size_t pcm_ring_buffer_write(PcmRingBuffer* buffer, const void* source, size_t byte_count);
size_t pcm_ring_buffer_read(PcmRingBuffer* buffer, void* destination, size_t byte_count);

#endif
