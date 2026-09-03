import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { lookup, parseBatchLine, searchTariff, totalAddonRate } from "../src/rules.js";

const data = JSON.parse(await readFile(new URL("../public/data/rules.json", import.meta.url), "utf8"));

function run(name, input, checks) {
  const result = lookup(input, data);
  checks(result);
  console.log(`ok - ${name}`);
}

run("screenshot footwear CN", { country: "CN", hts: "6402.99.3165" }, (r) => {
  assert.equal(r.hts, "6402993165");
  assert.equal(r.tariff.mfnRate, "6%");
  assert.match(r.tariff.description, /Footwear/);
  assert.equal(r.section301, null);
  assert.equal(r.section301FL.chapter99, "99030531");
  assert.equal(r.section232.matched, false);
});

run("screenshot footwear VN", { country: "VN", hts: "6402993165" }, (r) => {
  assert.equal(r.tariff.mfnRate, "6%");
  assert.equal(r.section301, null);
  assert.equal(r.section301FL.chapter99, "99030584");
  assert.ok(r.warnings.some((item) => item.includes("country of origin is not CN")));
});

run("auto part history case with steel flag", {
  country: "CN",
  hts: "8708998180",
  flags: { auto: true, steel: true },
}, (r) => {
  assert.equal(r.tariff.mfnRate, "2.5%");
  assert.equal(r.section301.chapter99, "99038803");
  assert.equal(r.section301.rate, "0.25");
  assert.equal(r.section232.matched, true);
  assert.deepEqual(r.section232.chapter99, ["99038209"]);
  assert.equal(r.section232.rate, 0.25);
  assert.equal(r.section301FL.chapter99, "99030590");
  assert.deepEqual(r.entrySequence, ["99038803", "99030590", "99038209", "8708998180"]);
  assert.equal(totalAddonRate(r), 0.5);
});

run("aluminum sample", {
  country: "CN",
  hts: "7615102015",
  flags: { aluminum: true },
}, (r) => {
  assert.equal(r.tariff.mfnRate, "3.1%");
  assert.equal(r.oga.pga, "FD2");
  assert.equal(r.section232.matched, true);
  assert.deepEqual(r.section232.chapter99, ["99038209"]);
  assert.ok(r.confirmations.some((item) => item.label === "铝A"));
});

run("batch Y columns switch steel result", parseBatchLine("8429521020,CN,,,Y"), (r) => {
  assert.ok(r.confirmations.some((item) => item.label === "钢S"));
  assert.equal(r.flags.S, true);
  assert.ok(r.section232.chapter99.includes("99038209") || r.section232.chapter99.includes("99038202") || r.section232.chapter99.includes("99038210"));
});

run("wood furniture history case does not auto-trigger 232", {
  country: "CN",
  hts: "9403608081",
  flags: { wood: true },
}, (r) => {
  assert.equal(r.tariff.mfnRate, "Free");
  assert.equal(r.section232.matched, false);
  assert.deepEqual(r.section232.chapter99, []);
});

console.log("All rule tests passed.");

const searchRows = searchTariff("footwear", data, 5);
assert.ok(searchRows.length > 0);
assert.ok(searchRows.some((row) => /Footwear/i.test(row.description)));
console.log("ok - tariff search");
