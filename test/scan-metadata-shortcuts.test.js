const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { readSpcMetadata, readVgmMetadata, readPsfMetadataBuffer } = require("../electron/scan-metadata-shortcuts");

test("reads SPC ID666 metadata without a decoder", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scan-shortcut-"));
  try {
    const buffer = Buffer.alloc(0x100);
    buffer.write("SNES-SPC700 Sound File Data", 0, "ascii");
    buffer[0x23] = 0x1a;
    buffer.write("Song", 0x2e, "ascii");
    buffer.write("Game", 0x4e, "ascii");
    buffer.write("Composer", 0xb1, "ascii");
    buffer.write("123", 0xa9, "ascii");
    const filePath = path.join(root, "track.spc");
    await fs.writeFile(filePath, buffer);
    assert.deepEqual(await readSpcMetadata(filePath), {
      title: "Song",
      game: "Game",
      artist: "Composer",
      play_length: 123000,
      fade_length: 0
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reads binary ID666 artist layout and xID6 overrides", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scan-xid6-"));
  try {
    const textItem = (id, value) => {
      const payload = Buffer.from(value, "latin1");
      const item = Buffer.alloc(4 + ((payload.length + 3) & ~3));
      item[0] = id;
      item[1] = 1;
      item.writeUInt16LE(payload.length, 2);
      payload.copy(item, 4);
      return item;
    };
    const ticksItem = (id, milliseconds) => {
      const item = Buffer.alloc(8);
      item[0] = id;
      item[1] = 4;
      item.writeUInt16LE(4, 2);
      item.writeUInt32LE(Math.round(milliseconds * 64), 4);
      return item;
    };
    const payload = Buffer.concat([
      textItem(0x01, "Extended Song"),
      textItem(0x02, "Extended Game"),
      textItem(0x03, "Extended Artist"),
      ticksItem(0x32, 90_000)
    ]);
    const buffer = Buffer.alloc(0x10208 + payload.length);
    buffer.write("SNES-SPC700 Sound File Data", 0, "ascii");
    buffer[0x23] = 0x1a;
    buffer.write("Legacy", 0x2e, "ascii");
    buffer[0xb0] = "B".charCodeAt(0);
    buffer.write("inary Artist", 0xb1, "ascii");
    buffer.write("xid6", 0x10200, "ascii");
    buffer.writeUInt32LE(payload.length, 0x10204);
    payload.copy(buffer, 0x10208);
    const filePath = path.join(root, "track.spc");
    await fs.writeFile(filePath, buffer);
    assert.deepEqual(await readSpcMetadata(filePath), {
      title: "Extended Song",
      game: "Extended Game",
      artist: "Extended Artist",
      play_length: 90_000,
      fade_length: 0
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reads VGM GD3 metadata and timing from plain and gzipped files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spcboy-scan-shortcut-"));
  try {
    const gd3 = Buffer.alloc(0x0c);
    gd3.write("Gd3 ", 0, "ascii");
    gd3.writeUInt32LE(0x100, 4);
    const fields = ["Song", "", "Game", "", "System", "", "Composer", "", "", "", "Comment"];
    const payload = Buffer.concat(fields.map((value) => Buffer.concat([Buffer.from(value, "utf16le"), Buffer.from([0, 0])] )));
    gd3.writeUInt32LE(payload.length, 8);
    const buffer = Buffer.alloc(0x40);
    buffer.write("Vgm ", 0, "ascii");
    buffer.writeUInt32LE(44100, 0x18);
    buffer.writeUInt32LE(0x40 - 0x14, 0x14);
    const vgm = Buffer.concat([buffer, gd3, payload]);
    const plainPath = path.join(root, "track.vgm");
    const gzPath = path.join(root, "track.vgz");
    await fs.writeFile(plainPath, vgm);
    await fs.writeFile(gzPath, zlib.gzipSync(vgm));
    for (const filePath of [plainPath, gzPath]) {
      const metadata = await readVgmMetadata(filePath);
      assert.equal(metadata.song, "Song");
      assert.equal(metadata.game, "Game");
      assert.equal(metadata.author, "Composer");
      assert.equal(metadata.play_length, 1000);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reads PSF-family footer tags without starting a decoder", () => {
  const payload = Buffer.from("[TAG]\ntitle=Track One\ngame=Example Game\nartist=Composer\nsystem=PlayStation\nlength=1:23.500\nfade=0:02.250\n", "utf8");
  const buffer = Buffer.alloc(16 + payload.length);
  buffer.write("PSF2", 0, "ascii");
  buffer.writeUInt32LE(0, 8);
  payload.copy(buffer, 16);
  assert.deepEqual(readPsfMetadataBuffer(buffer), {
    title: "Track One",
    game: "Example Game",
    artist: "Composer",
    system: "PlayStation",
    play_length: 83500,
    fade_length: 2250
  });
});
