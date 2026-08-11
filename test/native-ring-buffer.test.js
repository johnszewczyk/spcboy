const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native PCM ring preserves wrapped SPSC order and drops pre-reset PCM", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "spcboy-ring-test-"));
  const sourcePath = path.join(scratch, "ring-test.c");
  const binaryPath = path.join(scratch, "ring-test");
  const repoRoot = path.join(__dirname, "..");

  try {
    fs.writeFileSync(sourcePath, `
      #include <assert.h>
      #include <stdint.h>
      #include <string.h>
      #include "ring_buffer.h"

      int main(void) {
        PcmRingBuffer buffer = {0};
        const uint8_t initial[] = { 1, 2, 3, 4, 5, 6 };
        const uint8_t wrapped[] = { 7, 8, 9, 10, 11, 12 };
        const uint8_t replacement[] = { 42, 43 };
        uint8_t output[8] = {0};
        const uint8_t expected[] = { 5, 6, 7, 8, 9, 10, 11, 12 };

        assert(pcm_ring_buffer_init(&buffer, 8) == 0);
        assert(pcm_ring_buffer_write(&buffer, initial, sizeof(initial)) == sizeof(initial));
        assert(pcm_ring_buffer_read(&buffer, output, 4) == 4);
        assert(memcmp(output, initial, 4) == 0);
        assert(pcm_ring_buffer_write(&buffer, wrapped, sizeof(wrapped)) == sizeof(wrapped));
        assert(pcm_ring_buffer_read(&buffer, output, sizeof(output)) == sizeof(output));
        assert(memcmp(output, expected, sizeof(expected)) == 0);

        assert(pcm_ring_buffer_write(&buffer, replacement, sizeof(replacement)) == sizeof(replacement));
        pcm_ring_buffer_reset(&buffer);
        assert(pcm_ring_buffer_read(&buffer, output, sizeof(replacement)) == 0);
        pcm_ring_buffer_destroy(&buffer);
        return 0;
      }
    `, "utf8");

    const compile = spawnSync("clang", [
      "-std=c11", "-Wall", "-Wextra",
      "-I", path.join(repoRoot, "native"),
      path.join(repoRoot, "native", "ring_buffer.c"),
      sourcePath,
      "-o", binaryPath
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const run = spawnSync(binaryPath, [], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
