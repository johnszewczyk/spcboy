const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { detectSpecialWav, NDS_RAW_PCM22_MIN_BYTES } = require("../electron/special-audio");

test("recognizes Nintendo DS SWAV payloads regardless of filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-special-audio-"));
  try {
    const filePath = path.join(root, "sound.wav");
    await fs.writeFile(filePath, Buffer.concat([Buffer.from("SWAV"), Buffer.alloc(128)]));
    assert.deepEqual(await detectSpecialWav(filePath), { kind: "nds-swav", system: "Nintendo DS" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recognizes large headerless Nintendo DS raw PCM WAV names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-special-audio-"));
  try {
    const filePath = path.join(root, "track_01.wav");
    await fs.writeFile(filePath, Buffer.alloc(NDS_RAW_PCM22_MIN_BYTES + 100));
    assert.deepEqual(await detectSpecialWav(filePath), {
      kind: "nds-raw-pcm22",
      system: "Nintendo DS",
      sampleRate: 22050,
      frameCount: NDS_RAW_PCM22_MIN_BYTES + 100
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("does not guess ordinary WAV files as raw Nintendo DS PCM", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-special-audio-"));
  try {
    const filePath = path.join(root, "track_01.wav");
    await fs.writeFile(filePath, Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(NDS_RAW_PCM22_MIN_BYTES)]));
    assert.equal(await detectSpecialWav(filePath), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
