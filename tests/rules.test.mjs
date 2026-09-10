import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractCustomerHtsCandidates } from "../src/customer-import.js";
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
  assert.ok(r.confirmations.some((item) => item.label === "Aluminum"));
});

run("batch Y columns switch steel result", parseBatchLine("8429521020,CN,,,Y"), (r) => {
  assert.ok(r.confirmations.some((item) => item.label === "Steel"));
  assert.equal(r.flags.S, true);
  assert.ok(r.section232.chapter99.includes("99038209") || r.section232.chapter99.includes("99038202") || r.section232.chapter99.includes("99038210"));
});

run("empty steel flag keeps exemption before Y", parseBatchLine("8429521020,CN"), (r) => {
  assert.ok(r.confirmations.some((item) => item.label === "Steel"));
  assert.equal(r.flags.S, false);
  assert.ok(r.section232.chapter99.includes("99038203") || r.section232.chapter99.includes("99038201"));
  assert.equal(r.section232.rate, 0);
});

run("simple HTS line defaults inside app layer compatible parser", { hts: "3926909989", country: "CN" }, (r) => {
  assert.equal(r.hts, "3926909989");
  assert.equal(r.tariff.mfnRate, "5.3%");
  assert.equal(r.section301FL.chapter99, "99030531");
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

const searchRows = searchTariff("footwear", data, 5);
assert.ok(searchRows.length > 0);
assert.ok(searchRows.some((row) => /Footwear/i.test(row.description)));
console.log("ok - tariff search");

const fixtureData = {
  tariff: {
    "39249056": { description: "Household articles", mfnRate: "3.4%" },
    "84672100": { description: "Drills", mfnRate: "1.7%" },
  },
  section301: {},
  section232: {},
  oga: {},
  cpsc: {},
};

const bilingualHeaderCandidates = extractCustomerHtsCandidates([
  {
    name: "Invoice",
    rows: [
      ["Description", "HS code\n\u6d77\u5173\u7f16\u7801", "Amount"],
      ["Bottle", "3924.90.5650", "10"],
      ["Date", "20260807", ""],
      ["Total", "", "10"],
    ],
  },
], fixtureData);
assert.equal(bilingualHeaderCandidates[0].hts, "3924905650");
assert.equal(bilingualHeaderCandidates[0].selected, true);
assert.ok(!bilingualHeaderCandidates.some((item) => item.hts === "20260807" && item.selected));
console.log("ok - customer import bilingual header");

const looseCandidates = extractCustomerHtsCandidates([
  {
    name: "packingList",
    rows: [
      ["B/L", "4055267729", "Container"],
      ["Item", "8467210010", "Drill"],
    ],
  },
], fixtureData);
assert.ok(looseCandidates.some((item) => item.hts === "8467210010"));
assert.ok(!looseCandidates.find((item) => item.hts === "4055267729")?.selected);
console.log("ok - customer import loose candidates");

const chapter99Candidates = extractCustomerHtsCandidates([
  {
    name: "IV",
    rows: [
      ["HS CODE", "Extra"],
      ["8467210010", "99030531"],
    ],
  },
], fixtureData);
assert.equal(chapter99Candidates.find((item) => item.hts === "99030531")?.selected, false);
assert.equal(chapter99Candidates.find((item) => item.hts === "8467210010")?.selected, true);
console.log("ok - customer import chapter 99 handling");

console.log("All tests passed.");
