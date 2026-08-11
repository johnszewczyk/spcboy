const fs = require("fs").promises;
const path = require("path");

const NDS_RAW_PCM22_MIN_BYTES = 64 * 1024;
const NDS_RAW_PCM22_RATE = 22050;

function isNdsRawPcm22Name(sourceName) {
  return /_[0-9]{2}\.wav$/i.test(path.basename(String(sourceName || "")));
}

async function detectSpecialWav(filePath, sourceName = filePath) {
  if (path.extname(filePath).toLowerCase() !== ".wav") return null;

  const stat = await fs.stat(filePath);
  const handle = await fs.open(filePath, "r");
  const signature = Buffer.alloc(4);
  try {
    await handle.read(signature, 0, signature.length, 0);
  } finally {
    await handle.close();
  }

  if (signature.equals(Buffer.from("SWAV"))) {
    return { kind: "nds-swav", system: "Nintendo DS" };
  }

  if (
    stat.size >= NDS_RAW_PCM22_MIN_BYTES &&
    isNdsRawPcm22Name(sourceName) &&
    !signature.equals(Buffer.from("RIFF")) &&
    !signature.equals(Buffer.from("SWAV"))
  ) {
    return {
      kind: "nds-raw-pcm22",
      system: "Nintendo DS",
      sampleRate: NDS_RAW_PCM22_RATE,
      frameCount: stat.size
    };
  }

  return null;
}

module.exports = {
  NDS_RAW_PCM22_MIN_BYTES,
  NDS_RAW_PCM22_RATE,
  detectSpecialWav,
  isNdsRawPcm22Name
};
