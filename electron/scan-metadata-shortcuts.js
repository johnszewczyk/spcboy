const zlib = require("zlib");
const { promisify } = require("util");
const gunzipAsync = promisify(zlib.gunzip);
const MAX_VGM_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_VGM_OUTPUT_BYTES = 256 * 1024 * 1024;

function readFixedText(buffer, offset, length, encoding = "latin1") {
  if (offset < 0 || offset + length > buffer.length) return "";
  const end = buffer.indexOf(0, offset);
  const sliceEnd = end >= offset && end < offset + length ? end : offset + length;
  return buffer.toString(encoding, offset, sliceEnd).replace(/[\u0000\u001a]+$/g, "").trim();
}

function readLE32(buffer, offset) {
  return offset >= 0 && offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;
}

function parsePsfTime(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
  if (!match) return 0;
  const fraction = Number(`0.${match[3] || "0"}`);
  return Math.round((Number(match[1]) * 60 + Number(match[2]) + fraction) * 1000);
}

function readPsfMetadataBuffer(buffer) {
  if (buffer.length < 16 || buffer.toString("ascii", 0, 3) !== "PSF") return null;
  const reservedSize = readLE32(buffer, 8);
  if (reservedSize === null || reservedSize > buffer.length - 16) return null;
  const tagOffset = 16 + reservedSize;
  const tagStart = buffer.indexOf(Buffer.from("[TAG]", "ascii"), tagOffset);
  if (tagStart < 0) return null;
  const lines = buffer.toString("utf8", tagStart + 5).split(/\r?\n/);
  const tags = {};
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key && !(key in tags)) tags[key] = value;
  }
  return {
    title: tags.title || "",
    game: tags.game || tags.album || "",
    artist: tags.artist || tags.author || "",
    system: tags.system || "",
    play_length: parsePsfTime(tags.length),
    fade_length: parsePsfTime(tags.fade)
  };
}

async function readPsfMetadata(filePath) {
  let handle = null;
  try {
    const fileSystem = require("fs").promises;
    handle = await fileSystem.open(filePath, "r");
    const header = Buffer.alloc(16);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (headerRead.bytesRead !== header.length || header.toString("ascii", 0, 3) !== "PSF") return null;
    const reservedSize = readLE32(header, 4);
    const executableSize = readLE32(header, 8);
    if (reservedSize === null || executableSize === null) return null;
    const tagOffset = 16 + reservedSize + executableSize;
    const stat = await handle.stat();
    if (tagOffset + 5 > stat.size) return null;
    const footer = Buffer.alloc(Math.min(stat.size - tagOffset, 1024 * 1024));
    const footerRead = await handle.read(footer, 0, footer.length, tagOffset);
    const tagStart = footer.indexOf(Buffer.from("[TAG]", "ascii"));
    if (tagStart < 0 || footerRead.bytesRead < tagStart + 5) return null;
    const tags = {};
    for (const line of footer.toString("utf8", tagStart + 5, footerRead.bytesRead).split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key && !(key in tags)) tags[key] = value;
    }
    return {
      title: tags.title || "",
      game: tags.game || tags.album || "",
      artist: tags.artist || tags.author || "",
      system: tags.system || "",
      play_length: parsePsfTime(tags.length),
      fade_length: parsePsfTime(tags.fade)
    };
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function readVgmUtf16(buffer, offset, end) {
  const values = [];
  for (let cursor = offset; cursor + 1 < end; cursor += 2) {
    const value = buffer.readUInt16LE(cursor);
    if (value === 0) break;
    values.push(value);
  }
  return String.fromCharCode(...values).trim();
}

function readVgmMetadataBuffer(buffer) {
  if (buffer.length < 0x40 || buffer.toString("ascii", 0, 4) !== "Vgm ") return null;
  const gd3RelativeOffset = readLE32(buffer, 0x14);
  if (!gd3RelativeOffset) return null;
  const gd3Offset = 0x14 + gd3RelativeOffset;
  if (gd3Offset < 0 || gd3Offset + 0x0c > buffer.length || buffer.toString("ascii", gd3Offset, gd3Offset + 4) !== "Gd3 ") return null;
  const version = readLE32(buffer, gd3Offset + 4);
  const payloadLength = readLE32(buffer, gd3Offset + 8);
  const payloadStart = gd3Offset + 0x0c;
  const payloadEnd = payloadStart + payloadLength;
  if (version === null || version < 0x100 || version >= 0x200 || payloadLength === null || payloadEnd > buffer.length) return null;

  const fields = [];
  let cursor = payloadStart;
  for (let index = 0; index < 11; index += 1) {
    const start = cursor;
    while (cursor + 1 < payloadEnd && buffer.readUInt16LE(cursor) !== 0) cursor += 2;
    if (cursor + 1 >= payloadEnd) return null;
    fields.push(readVgmUtf16(buffer, start, payloadEnd));
    cursor += 2;
  }

  const totalSamples = readLE32(buffer, 0x18) || 0;
  const loopSamples = readLE32(buffer, 0x20) || 0;
  const loopOffset = readLE32(buffer, 0x1c) || 0;
  const hasLoop = loopOffset !== 0 && loopSamples > 0 && loopSamples <= totalSamples;
  const milliseconds = (samples) => Math.floor((samples * 1000) / 44100);
  return {
    song: fields[0],
    game: fields[2],
    system: fields[4],
    author: fields[6],
    comment: [fields[10], fields[8], fields[9]].filter(Boolean).join(" • "),
    intro_length: hasLoop ? milliseconds(totalSamples - loopSamples) : 0,
    loop_length: hasLoop ? milliseconds(loopSamples) : 0,
    play_length: milliseconds(totalSamples),
    fade_length: 0
  };
}

async function readVgmMetadata(filePath) {
  try {
    const fileSystem = require("fs").promises;
    const stat = await fileSystem.stat(filePath);
    if (stat.size > MAX_VGM_INPUT_BYTES) return null;
    let buffer = await fileSystem.readFile(filePath);
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      buffer = await gunzipAsync(buffer, { maxOutputLength: MAX_VGM_OUTPUT_BYTES });
    }
    return readVgmMetadataBuffer(buffer);
  } catch {
    return null;
  }
}

async function readSpcMetadata(filePath) {
  try {
    const buffer = await require("fs").promises.readFile(filePath);
    const magic = "SNES-SPC700 Sound File Data";
    if (buffer.length < 0x100 || buffer.toString("ascii", 0, magic.length) !== magic) return null;

    let legacy = null;
    if (buffer[0x23] === 0x1a) {
      const date = buffer.subarray(0x9e, 0xa9);
      const textFade = buffer.subarray(0xac, 0xb1);
      const containsTextDate = [...date].every((value) => value === 0 || value === 0x20 || (value >= 0x2f && value <= 0x39))
        && [...date].some((value) => value >= 0x2f && value <= 0x39);
      const containsTextFade = [...textFade].every((value) => value === 0 || value === 0x20 || (value >= 0x30 && value <= 0x39))
        && [...textFade].some((value) => value >= 0x30 && value <= 0x39);
      const binaryLayout = !containsTextDate && !containsTextFade && buffer[0xb0] > 0 && buffer[0xb0] <= 0x7f;
      legacy = {
        title: readFixedText(buffer, 0x2e, 32),
        game: readFixedText(buffer, 0x4e, 32),
        artist: readFixedText(buffer, binaryLayout ? 0xb0 : 0xb1, 32),
        comment: readFixedText(buffer, 0x7e, 32),
        play_length: (Number.parseInt(readFixedText(buffer, 0xa9, 3), 10) || 0) * 1000,
        fade_length: binaryLayout ? buffer.readUInt32LE(0xac) : Number.parseInt(readFixedText(buffer, 0xac, 5), 10) || 0
      };
    }

    let extended = null;
    const extendedOffset = 0x10200;
    if (buffer.length >= extendedOffset + 8 && buffer.toString("ascii", extendedOffset, extendedOffset + 4) === "xid6") {
      const payloadLength = buffer.readUInt32LE(extendedOffset + 4);
      const payloadStart = extendedOffset + 8;
      const payloadEnd = payloadStart + payloadLength;
      if (payloadEnd <= buffer.length) {
        extended = {};
        let offset = payloadStart;
        while (offset + 4 <= payloadEnd) {
          const itemId = buffer[offset];
          const type = buffer[offset + 1];
          const storedLength = buffer.readUInt16LE(offset + 2);
          offset += 4;
          let payload = Buffer.alloc(0);
          if (type === 1 || type === 4) {
            if (offset + storedLength > payloadEnd) {
              extended = null;
              break;
            }
            payload = buffer.subarray(offset, offset + storedLength);
            offset += (storedLength + 3) & ~3;
            if (offset > payloadEnd) {
              extended = null;
              break;
            }
          } else if (type !== 0) {
            extended = null;
            break;
          }
          const textValue = () => payload.toString("latin1").replace(/\0.*$/s, "").trim();
          const ticks = () => payload.length === 4 ? Math.floor(payload.readUInt32LE(0) * 1000 / 64000) : 0;
          if (itemId === 0x01 && type === 1) extended.title = textValue();
          if (itemId === 0x02 && type === 1) extended.game = textValue();
          if (itemId === 0x03 && type === 1) extended.artist = textValue();
          if (itemId === 0x07 && type === 1) extended.comment = textValue();
          if (itemId === 0x30 && type === 4) extended.intro_length = ticks();
          if (itemId === 0x31 && type === 4) extended.loop_length = ticks();
          if (itemId === 0x32 && type === 4) extended.play_length = ticks();
          if (itemId === 0x33 && type === 4) extended.fade_length = ticks();
        }
      }
    }
    if (!legacy && !extended) return null;
    return {
      title: extended?.title || legacy?.title || "",
      game: extended?.game || legacy?.game || "",
      artist: extended?.artist || legacy?.artist || "",
      play_length: extended?.play_length || legacy?.play_length || 0,
      fade_length: extended?.fade_length || legacy?.fade_length || 0
    };
  } catch {
    return null;
  }
}

module.exports = { readSpcMetadata, readVgmMetadata, readVgmMetadataBuffer, readPsfMetadata, readPsfMetadataBuffer, parsePsfTime };
