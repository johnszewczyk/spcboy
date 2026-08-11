#include "ring_buffer.h"

#include <stdlib.h>
#include <string.h>

int pcm_ring_buffer_init(PcmRingBuffer* buffer, size_t capacity_bytes) {
  if (!buffer || capacity_bytes == 0) {
    return 1;
  }

  buffer->data = (unsigned char*) calloc(capacity_bytes, sizeof(unsigned char));
  if (!buffer->data) {
    return 1;
  }

  buffer->capacity_bytes = capacity_bytes;
  atomic_init(&buffer->read_index, 0);
  atomic_init(&buffer->write_index, 0);
  return 0;
}

void pcm_ring_buffer_destroy(PcmRingBuffer* buffer) {
  if (!buffer) {
    return;
  }

  free(buffer->data);
  buffer->data = NULL;
  buffer->capacity_bytes = 0;
  atomic_store_explicit(&buffer->read_index, 0, memory_order_relaxed);
  atomic_store_explicit(&buffer->write_index, 0, memory_order_relaxed);
}

void pcm_ring_buffer_reset(PcmRingBuffer* buffer) {
  if (!buffer) {
    return;
  }

  const uint64_t write_index = atomic_load_explicit(&buffer->write_index, memory_order_relaxed);
  atomic_store_explicit(&buffer->read_index, write_index, memory_order_release);
}

size_t pcm_ring_buffer_available_to_read(const PcmRingBuffer* buffer) {
  if (!buffer || !buffer->data) {
    return 0;
  }

  const uint64_t write_index = atomic_load_explicit(&buffer->write_index, memory_order_acquire);
  const uint64_t read_index = atomic_load_explicit(&buffer->read_index, memory_order_acquire);
  const uint64_t available = write_index - read_index;
  return available > buffer->capacity_bytes ? 0 : (size_t) available;
}

size_t pcm_ring_buffer_available_to_write(const PcmRingBuffer* buffer) {
  if (!buffer || !buffer->data) {
    return 0;
  }

  const size_t readable = pcm_ring_buffer_available_to_read(buffer);
  return buffer->capacity_bytes - readable;
}

static void pcm_ring_buffer_copy_in(PcmRingBuffer* buffer, uint64_t write_index, const unsigned char* source, size_t byte_count) {
  const size_t write_offset = (size_t) (write_index % buffer->capacity_bytes);
  size_t first_chunk = byte_count;
  if (write_offset + first_chunk > buffer->capacity_bytes) {
    first_chunk = buffer->capacity_bytes - write_offset;
  }

  memcpy(buffer->data + write_offset, source, first_chunk);

  const size_t remaining = byte_count - first_chunk;
  if (remaining > 0) {
    memcpy(buffer->data, source + first_chunk, remaining);
  }
}

static void pcm_ring_buffer_copy_out(const PcmRingBuffer* buffer, uint64_t read_index, unsigned char* destination, size_t byte_count) {
  const size_t read_offset = (size_t) (read_index % buffer->capacity_bytes);
  size_t first_chunk = byte_count;
  if (read_offset + first_chunk > buffer->capacity_bytes) {
    first_chunk = buffer->capacity_bytes - read_offset;
  }

  memcpy(destination, buffer->data + read_offset, first_chunk);

  const size_t remaining = byte_count - first_chunk;
  if (remaining > 0) {
    memcpy(destination + first_chunk, buffer->data, remaining);
  }
}

size_t pcm_ring_buffer_write(PcmRingBuffer* buffer, const void* source, size_t byte_count) {
  if (!buffer || !buffer->data || !source || byte_count == 0) {
    return 0;
  }

  const uint64_t write_index = atomic_load_explicit(&buffer->write_index, memory_order_relaxed);
  const uint64_t read_index = atomic_load_explicit(&buffer->read_index, memory_order_acquire);
  const uint64_t used_bytes = write_index - read_index;
  if (used_bytes > buffer->capacity_bytes) {
    return 0;
  }
  const size_t writable = buffer->capacity_bytes - (size_t) used_bytes;
  const size_t actual_count = byte_count < writable ? byte_count : writable;
  if (actual_count == 0) {
    return 0;
  }

  pcm_ring_buffer_copy_in(buffer, write_index, (const unsigned char*) source, actual_count);
  atomic_store_explicit(&buffer->write_index, write_index + actual_count, memory_order_release);
  return actual_count;
}

size_t pcm_ring_buffer_read(PcmRingBuffer* buffer, void* destination, size_t byte_count) {
  if (!buffer || !buffer->data || !destination || byte_count == 0) {
    return 0;
  }

  const uint64_t read_index = atomic_load_explicit(&buffer->read_index, memory_order_relaxed);
  const uint64_t write_index = atomic_load_explicit(&buffer->write_index, memory_order_acquire);
  const uint64_t available_bytes = write_index - read_index;
  if (available_bytes > buffer->capacity_bytes) {
    return 0;
  }
  const size_t readable = (size_t) available_bytes;
  const size_t actual_count = byte_count < readable ? byte_count : readable;
  if (actual_count == 0) {
    return 0;
  }

  pcm_ring_buffer_copy_out(buffer, read_index, (unsigned char*) destination, actual_count);

  /* A reset discards pre-transition PCM by moving the reader to the writer.
   * Do not allow a callback that began before that reset to republish its old
   * read index after the new track has been queued. */
  uint64_t expected_read_index = read_index;
  if (!atomic_compare_exchange_strong_explicit(
        &buffer->read_index,
        &expected_read_index,
        read_index + actual_count,
        memory_order_release,
        memory_order_relaxed
      )) {
    return 0;
  }
  return actual_count;
}
