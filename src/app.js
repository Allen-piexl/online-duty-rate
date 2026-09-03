import { formatRate, lookup, parseBatchLine, searchTariff, totalAddonRate } from "./rules.js";

const state = {
  data: null,
  lastResult: null,
  batchRows: [],
  batchInputs: [],
};

const el = {
  dataStatus: document.querySelector("#dataStatus"),
  country: document.querySelector("#country"),
  hts: document.querySelector("#hts"),
  description: document.querySelector("#description"),
  material: document.querySelector("#material"),
  flags: {
    auto: document.querySelector("#flagAuto"),
    truck: document.querySelector("#flagTruck"),
    steel: document.querySelector("#flagSteel"),
    aluminum: document.querySelector("#flagAluminum"),
    copper: document.querySelector("#flagCopper"),
    wood: document.querySelector("#flagWood"),
    semiconductor: document.querySelector("#flagSemiconductor"),
  },
  result: document.querySelector("#result"),
  batchInput: document.querySelector("#batchInput"),
  batchTableBody: document.querySelector("#batchTable tbody"),
  compareTableBody: document.querySelector("#compareTable tbody"),
  searchInput: document.querySelector("#searchInput"),
  searchTableBody: document.querySelector("#searchTable tbody"),
};

async function init() {
  const response = await fetch("public/data/rules.json");
  state.data = await response.json();
  const summary = await fetch("public/data/summary.json").then((item) => item.json());
  el.dataStatus.textContent = `${summary.tariff.toLocaleString()} HTS base rows, ${summary.section232.toLocaleString()} 232 rows`;
  bindEvents();
  runLookup();
}

function bindEvents() {
  document.querySelector("#lookupButton").addEventListener("click", runLookup);
  document.querySelector("#clearButton").addEventListener("click", clearForm);
  document.querySelector("#sampleButton").addEventListener("click", loadSample);
  document.querySelector("#copyButton").addEventListener("click", copyResult);
  document.querySelector("#batchButton").addEventListener("click", runBatch);
  document.querySelector("#exportButton").addEventListener("click", exportCsv);
  document.querySelector("#compareButton").addEventListener("click", runCompare);
  document.querySelector("#searchButton").addEventListener("click", runSearch);
  el.searchInput.addEventListener("input", runSearch);
  for (const input of [el.country, el.hts, el.description, el.material, ...Object.values(el.flags)]) {
    input.addEventListener("input", runLookup);
  }
}

function readInput() {
  return {
    country: el.country.value,
    hts: el.hts.value,
    description: el.description.value,
    material: el.material.value,
    flags: Object.fromEntries(Object.entries(el.flags).map(([key, input]) => [key, input.checked])),
  };
}

function runLookup() {
  if (!state.data) return;
  state.lastResult = lookup(readInput(), state.data);
  renderResult(state.lastResult);
  runCompare();
}

function renderResult(result) {
  if (!result.hts) {
    el.result.className = "result-empty";
    el.result.textContent = "Enter an HTS code to start.";
    return;
  }
  el.result.className = "result-grid";
  el.result.innerHTML = `
    ${card("Normalized HTS", result.hts, [`HTS8: ${result.hts8}`])}
    ${card("Base Tariff", result.tariff?.mfnRate || "No match", [
      result.tariff?.description || "",
      [result.tariff?.quantity1, result.tariff?.quantity2].filter(Boolean).join(" / "),
    ])}
    ${card("Section 301 China", result.section301 ? result.section301.chapter99 : "None", [
      result.section301 ? formatRate(result.section301.rate) : result.country === "CN" ? "No matching China 301 row." : "Hidden for non-CN origin.",
    ])}
    ${card("301 Forced Labor", result.section301FL.chapter99 || "None", [
      formatRate(result.section301FL.rate),
      result.section301FL.source,
      result.section301FL.note,
    ])}
    ${card("Section 232", result.section232.chapter99.length ? result.section232.chapter99.join(" / ") : "None", [
      result.section232.matched ? `Rule: ${result.section232.rule.original || ""}` : "No 232 rule match.",
      result.section232.matched ? `Rate: ${formatRate(result.section232.rate)}` : "",
      ...result.section232.details,
    ])}
    ${card("Need Confirm", result.confirmations.length ? result.confirmations.map((item) => item.label).join(" / ") : "None", [
      result.confirmations.length ? "If confirmed, enter Y/check the matching flag; the 232 result will switch automatically." : "",
      ...result.confirmations.map((item) => `${item.label}: ${item.reason}`),
    ])}
    ${card("OGA / CPSC", result.oga?.pga || result.cpsc?.flag || "None", [
      result.cpsc?.flag ? `CPSC: ${result.cpsc.flag}` : "",
      result.oga?.effectiveDateSerial ? `Effective serial: ${result.oga.effectiveDateSerial}` : "",
    ])}
    ${card("LIC", result.lic.aluminum || result.lic.steel ? [result.lic.aluminum ? "Aluminum" : "", result.lic.steel ? "Steel" : ""].filter(Boolean).join(" / ") : "None", [])}
    ${card("301 Exclusion", result.exclusions.length ? `${result.exclusions.length} match(es)` : "None", result.exclusions.slice(0, 2).map((item) => item.description || item.full || item.partial))}
    ${card("ADD / CVD", `<a href="${result.addUrl}" target="_blank" rel="noreferrer">Open NetCHB lookup</a>`, [])}
    ${card("Entry Sequence", result.entrySequence.join(" / ") || "None", ["Chapter 99 order: 301, 301FL, 232, then Chapter 1-97 HTS."])}
    ${result.warnings.length ? `<div class="wide warning"><strong>Warnings</strong><ul>${result.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
  `;
}

function card(title, value, details) {
  const detailHtml = details.filter(Boolean).map((item) => `<p>${escapeHtml(String(item))}</p>`).join("");
  const safeValue = String(value).includes("<a ") ? value : escapeHtml(String(value));
  return `<article class="card"><h3>${escapeHtml(title)}</h3><div class="value">${safeValue}</div>${detailHtml}</article>`;
}

function clearForm() {
  el.country.value = "CN";
  el.hts.value = "";
  el.description.value = "";
  el.material.value = "";
  Object.values(el.flags).forEach((input) => {
    input.checked = false;
  });
  runLookup();
}

function loadSample() {
  el.country.value = "CN";
  el.hts.value = "8708998180";
  el.description.value = "Auto parts";
  el.material.value = "Alloy / metal";
  el.flags.auto.checked = true;
  el.flags.steel.checked = true;
  runLookup();
}

async function copyResult() {
  if (!state.lastResult) return;
  const r = state.lastResult;
  const text = [
    `Country: ${r.country}`,
    `HTS: ${r.hts}`,
    `Description: ${r.tariff?.description || ""}`,
    `MFN: ${r.tariff?.mfnRate || ""}`,
    `301: ${r.section301?.chapter99 || ""} ${formatRate(r.section301?.rate)}`,
    `301FL: ${r.section301FL.chapter99 || ""} ${formatRate(r.section301FL.rate)}`,
    `232: ${r.section232.chapter99.join(" / ")} ${formatRate(r.section232.rate)}`,
    `OGA: ${r.oga?.pga || ""}`,
    `LIC: ${r.lic.aluminum ? "AL " : ""}${r.lic.steel ? "STEEL" : ""}`,
  ].join("\n");
  await navigator.clipboard.writeText(text);
}

function runBatch() {
  const lines = el.batchInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  state.batchInputs = lines.map((line) => parseBatchLine(line));
  state.batchRows = state.batchInputs.map((input) => lookup(input, state.data));
  renderBatch();
}

function runCompare() {
  if (!state.data || !el.hts.value.trim()) {
    el.compareTableBody.innerHTML = "";
    return;
  }
  const countries = Object.keys(state.data.section301FL.countries);
  const baseInput = readInput();
  const rows = countries.map((country) => lookup({ ...baseInput, country }, state.data));
  el.compareTableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.country)}</td>
      <td>${escapeHtml(row.tariff?.mfnRate || "")}</td>
      <td>${escapeHtml(row.section301 ? `${row.section301.chapter99} ${formatRate(row.section301.rate)}` : "")}</td>
      <td>${escapeHtml(`${row.section301FL.chapter99 || ""} ${formatRate(row.section301FL.rate)}`)}</td>
      <td>${escapeHtml(`${row.section232.chapter99.join(" / ")} ${formatRate(row.section232.rate)}`)}</td>
      <td>${escapeHtml(formatRate(totalAddonRate(row)))}</td>
    </tr>
  `).join("");
}

function runSearch() {
  if (!state.data) return;
  const rows = searchTariff(el.searchInput.value, state.data, 30);
  el.searchTableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.hts8)}</td>
      <td>${escapeHtml(row.description)}</td>
      <td>${escapeHtml(row.mfnRate)}</td>
      <td>${escapeHtml([row.quantity1, row.quantity2].filter(Boolean).join(" / "))}</td>
      <td><button type="button" data-hts="${escapeHtml(row.hts8)}">Use</button></td>
    </tr>
  `).join("");
  el.searchTableBody.querySelectorAll("button[data-hts]").forEach((button) => {
    button.addEventListener("click", () => {
      el.hts.value = button.dataset.hts;
      runLookup();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function renderBatch() {
  el.batchTableBody.innerHTML = state.batchRows.map((row, index) => `
    <tr>
      <td>${escapeHtml(row.hts)}</td>
      <td>${escapeHtml(row.confirmations.map((item) => item.label).join(" / "))}</td>
      <td>${flagInput(index, "auto", row.flags.auto)}</td>
      <td>${flagInput(index, "truck", row.flags.truck)}</td>
      <td>${flagInput(index, "steel", row.flags.S)}</td>
      <td>${flagInput(index, "aluminum", row.flags.A)}</td>
      <td>${flagInput(index, "copper", row.flags.C)}</td>
      <td>${flagInput(index, "wood", row.flags.wood)}</td>
      <td>${flagInput(index, "semiconductor", row.flags.semiconductor)}</td>
      <td>${escapeHtml(row.tariff?.mfnRate || "")}</td>
      <td>${escapeHtml(row.section301 ? `${row.section301.chapter99} ${formatRate(row.section301.rate)}` : "")}</td>
      <td>${escapeHtml(`${row.section301FL.chapter99 || ""} ${formatRate(row.section301FL.rate)}`)}</td>
      <td>${escapeHtml(`${row.section232.chapter99.join(" / ")} ${formatRate(row.section232.rate)}`)}</td>
      <td>${escapeHtml(row.oga?.pga || row.cpsc?.flag || "")}</td>
      <td>${escapeHtml([row.lic.aluminum ? "AL" : "", row.lic.steel ? "STEEL" : ""].filter(Boolean).join(" / "))}</td>
      <td>${escapeHtml(row.tariff?.description || "")}</td>
    </tr>
  `).join("");
  el.batchTableBody.querySelectorAll("input[data-row][data-flag]").forEach((input) => {
    input.addEventListener("input", updateBatchFlag);
  });
}

function exportCsv() {
  if (!state.batchRows.length) runBatch();
  const headers = ["HTS", "Need Confirm", "汽配", "卡配", "钢S", "铝A", "铜C", "木", "半导体", "MFN", "301", "301FL", "232", "OGA", "LIC", "Description"];
  const rows = state.batchRows.map((row) => [
    row.hts,
    row.confirmations.map((item) => item.label).join(" / "),
    row.flags.auto ? "Y" : "",
    row.flags.truck ? "Y" : "",
    row.flags.S ? "Y" : "",
    row.flags.A ? "Y" : "",
    row.flags.C ? "Y" : "",
    row.flags.wood ? "Y" : "",
    row.flags.semiconductor ? "Y" : "",
    row.tariff?.mfnRate || "",
    row.section301 ? `${row.section301.chapter99} ${formatRate(row.section301.rate)}` : "",
    `${row.section301FL.chapter99 || ""} ${formatRate(row.section301FL.rate)}`,
    `${row.section232.chapter99.join(" / ")} ${formatRate(row.section232.rate)}`,
    row.oga?.pga || row.cpsc?.flag || "",
    [row.lic.aluminum ? "AL" : "", row.lic.steel ? "STEEL" : ""].filter(Boolean).join(" / "),
    row.tariff?.description || "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "duty-rate-lookup.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function flagInput(row, flag, value) {
  return `<input class="flag-input" data-row="${row}" data-flag="${flag}" value="${value ? "Y" : ""}" maxlength="1" aria-label="${flag} Y flag" />`;
}

function updateBatchFlag(event) {
  const input = event.currentTarget;
  const row = Number(input.dataset.row);
  const flag = input.dataset.flag;
  const value = /^y$/i.test(input.value.trim());
  input.value = value ? "Y" : "";
  if (!state.batchInputs[row]) return;
  state.batchInputs[row].flags[flag] = value;
  state.batchRows[row] = lookup(state.batchInputs[row], state.data);
  renderBatch();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

init().catch((error) => {
  console.error(error);
  el.dataStatus.textContent = "Failed to load data";
  el.result.textContent = error.message;
});
