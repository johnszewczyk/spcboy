const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function speedApi() {
  const source = fs.readFileSync(path.join(__dirname, "..", "web", "playback-speed.js"), "utf8");
  const window = {};
  vm.runInNewContext(source, { window });
  return window.SPCBoyPlaybackSpeed;
}

test("playback speed stores decimals and fractions as reduced exact rationals", () => {
  const speed = speedApi();
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse("1.25"))), { numerator: 5, denominator: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse(".5"))), { numerator: 1, denominator: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse("15/12"))), { numerator: 5, denominator: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse("1/8"))), { numerator: 1, denominator: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse("0.333333"))), { numerator: 333333, denominator: 1000000 });
  assert.equal(speed.format({ numerator: 5, denominator: 4 }), "1.25");
  assert.equal(speed.format({ numerator: 1, denominator: 3 }), "1/3");
});

test("playback speed rejects unsafe ranges and scales milliseconds without float drift", () => {
  const speed = speedApi();
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse("0.2"))), { numerator: 1, denominator: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(speed.parse("4.01"))), { numerator: 401, denominator: 100 });
  assert.equal(speed.parse("1.0000001"), null);
  assert.equal(speed.parse("1000001/1000001"), null);
  assert.equal(speed.scaleMilliseconds(150000, { numerator: 5, denominator: 4 }), 120000);
  assert.equal(speed.scaleMilliseconds(150000, { numerator: 3, denominator: 2 }), 100000);
});
