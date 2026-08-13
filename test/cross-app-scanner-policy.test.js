const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { routeForPath } = require("../electron/playback-core");

const contract = JSON.parse(fs.readFileSync(
  path.join(__dirname, "cross-app-scanner-policy-v1.json"),
  "utf8"
));

test("scanner registry matches the shared structural and metadata policy", () => {
  assert.equal(contract.contract, "cocoaspice-spcboy-scanner-policy");
  assert.equal(contract.version, 1);
  for (const item of contract.cases) {
    const route = routeForPath(`fixture.${item.extension}`);
    assert.equal(route?.structurePolicy.replaceAll("-", "").toLowerCase(), item.structurePolicy.toLowerCase());
    assert.equal(route?.metadataPolicy.replaceAll("-", "").toLowerCase(), item.metadataPolicy.toLowerCase());
  }
});
