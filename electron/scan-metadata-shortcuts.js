const zlib = require("zlib");

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
    let buffer = await require("fs").promises.readFile(filePath);
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = zlib.gunzipSync(buffer);
    return readVgmMetadataBuffer(buffer);
  } catch {
    return null;
  }
}

async function readSpcMetadata(filePath) {
  try {
    const buffer = await require("fs").promises.readFile(filePath);
    const magic = "SNES-SPC700 Sound File Data";
    if (buffer.length < 0x100 || buffer.toString("ascii", 0, magic.length) !== magic || buffer[0x23] !== 0x1a) return null;
    const playLengthSeconds = Number.parseInt(readFixedText(buffer, 0xa9, 3), 10) || 0;
    const fadeLength = Number.parseInt(readFixedText(buffer, 0xac, 5), 10) || 0;
    return {
      title: readFixedText(buffer, 0x2e, 32),
      game: readFixedText(buffer, 0x4e, 32),
      artist: readFixedText(buffer, 0xb1, 32),
      play_length: playLengthSeconds * 1000,
      fade_length: fadeLength
    };
  } catch {
    return null;
  }
}

module.exports = { readSpcMetadata, readVgmMetadata, readVgmMetadataBuffer, readPsfMetadata, readPsfMetadataBuffer, parsePsfTime };
