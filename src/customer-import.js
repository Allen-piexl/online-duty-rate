const HEADER_PATTERNS = [
  /\bhs\s*code\b/i,
  /\bh\.?\s*s\.?\s*code\b/i,
  /\bhts(?:us)?\b/i,
  /\bcustoms?\s*code\b/i,
  /\btariff\s*code\b/i,
  /\bcommodity\s*code\b/i,
  /\u6d77\u5173\u7f16\u7801/,
  /\u7f8e\u56fd\u7a0e\u53f7/,
  /\u5546\u54c1\u7f16\u7801/,
  /\u7a0e\u53f7/,
];

const STOP_ROW_PATTERN = /\b(total|grand\s*total|subtotal|declaration|i\s+declare)\b|\u5408\u8ba1|\u603b\u8ba1|\u58f0\u660e/i;
const INVOICE_SHEET_PATTERN = /\b(invoice|commercial|iv)\b|\u53d1\u7968|\u6e05\u5173/i;
const PACKING_SHEET_PATTERN = /\b(packing|pack\s*list|pl)\b|\u88c5\u7bb1/i;
const HTS_PATTERN = /(?:\d[\s.\-_/]*){8,10}/g;

export async function parseCustomerWorkbookFile(file, data, xlsx = globalThis.XLSX) {
  if (!xlsx?.read || !xlsx?.utils?.sheet_to_json) {
    throw new Error("Excel parser is not loaded yet. Refresh and try again.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: "array", cellDates: false, raw: false });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: xlsx.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }),
  }));
  return extractCustomerHtsCandidates(sheets, data, { fileName: file.name });
}

export function extractCustomerHtsCandidates(sheets, data, options = {}) {
  const byCode = new Map();
  for (const sheet of sheets) {
    const sheetName = String(sheet.name || "Sheet");
    const rows = normalizeRows(sheet.rows);
    if (!rows.length) continue;
    const sheetScore = scoreSheetName(sheetName);
    const headers = findHeaders(rows);

    for (const header of headers) {
      scanUnderHeader({ rows, sheetName, sheetScore, header, byCode, data, fileName: options.fileName || "" });
    }

    scanLooseCells({
      rows,
      sheetName,
      sheetScore,
      byCode,
      data,
      fileName: options.fileName || "",
      hasHeaders: headers.length > 0,
    });
  }

  return [...byCode.values()]
    .map((item) => ({
      ...item,
      selected: item.kind === "base" && item.score >= 65,
      warnings: [...new Set(item.warnings)],
      sources: item.sources.slice(0, 4),
    }))
    .sort((a, b) => b.score - a.score || a.hts.localeCompare(b.hts));
}

function normalizeRows(rows) {
  return (rows || []).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
}

function findHeaders(rows) {
  const headers = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (!value) return;
      if (isHeaderText(value)) {
        headers.push({ row: rowIndex, col: colIndex, label: value });
      }
    });
  });
  return headers;
}

function isHeaderText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return HEADER_PATTERNS.some((pattern) => pattern.test(text));
}

function scanUnderHeader({ rows, sheetName, sheetScore, header, byCode, data, fileName }) {
  const stopAt = Math.min(rows.length, header.row + 120);
  for (let rowIndex = header.row + 1; rowIndex < stopAt; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (rowIndex > header.row + 1 && isStopRow(row) && !rowHasHts(row)) break;
    for (let colIndex = Math.max(0, header.col - 1); colIndex <= header.col + 1; colIndex += 1) {
      const value = row[colIndex];
      if (!value) continue;
      const columnDistance = Math.abs(colIndex - header.col);
      const baseScore = columnDistance === 0 ? 48 : 34;
      addCodesFromCell({
        value,
        rows,
        rowIndex,
        colIndex,
        sheetName,
        sheetScore,
        baseScore,
        context: "header",
        header,
        byCode,
        data,
        fileName,
      });
    }
  }
}

function scanLooseCells({ rows, sheetName, sheetScore, byCode, data, fileName, hasHeaders }) {
  rows.forEach((row, rowIndex) => {
    if (isStopRow(row) && !rowHasHts(row)) return;
    row.forEach((value, colIndex) => {
      if (!value) return;
      addCodesFromCell({
        value,
        rows,
        rowIndex,
        colIndex,
        sheetName,
        sheetScore,
        baseScore: hasHeaders ? 7 : 14,
        context: "loose",
        header: null,
        byCode,
        data,
        fileName,
      });
    });
  });
}

function addCodesFromCell({ value, rows, rowIndex, colIndex, sheetName, sheetScore, baseScore, context, header, byCode, data, fileName }) {
  for (const raw of extractHtsLikeCodes(value)) {
    const hts = normalizeHts(raw);
    if (hts.length !== 8 && hts.length !== 10) continue;
    const hts8 = hts.slice(0, 8);
    const kind = hts.startsWith("99") ? "chapter99" : "base";
    const hasTariff = Boolean(data?.tariff?.[hts8]);
    const hasRule = Boolean(data?.section301?.[hts] || data?.section232?.[hts] || data?.oga?.[hts] || data?.cpsc?.[hts]);
    const rowText = (rows[rowIndex] || []).join(" ");
    const warnings = [];
    let score = baseScore + sheetScore;

    if (hts.length === 10) score += 10;
    if (hasTariff) score += 32;
    if (hasRule) score += 10;
    if (context === "header" && header?.label) score += 8;
    if (kind === "chapter99") {
      score -= 28;
      warnings.push("Chapter 99 code, not a product HTS.");
    }
    if (isDateLike(hts)) {
      score -= 55;
      warnings.push("Looks like a date.");
    }
    if (!hasTariff && context !== "header") {
      score -= 24;
      warnings.push("No base tariff match.");
    }
    if (looksLikeReferenceNumber(rowText, hts) && context !== "header") {
      score -= 30;
      warnings.push("Looks like an order, invoice, container, or bill number.");
    }

    score = Math.max(0, Math.min(100, score));
    const source = {
      fileName,
      sheetName,
      cell: cellAddress(rowIndex, colIndex),
      value: String(value),
      reason: context === "header" ? `Under ${header.label}` : "Loose numeric match",
    };
    upsertCandidate(byCode, {
      hts,
      hts8,
      kind,
      score,
      hasTariff,
      source,
      warnings,
    });
  }
}

function upsertCandidate(byCode, candidate) {
  const existing = byCode.get(candidate.hts);
  if (!existing) {
    byCode.set(candidate.hts, { ...candidate, sources: [candidate.source] });
    return;
  }
  existing.sources.push(candidate.source);
  existing.warnings.push(...candidate.warnings);
  existing.hasTariff = existing.hasTariff || candidate.hasTariff;
  if (candidate.score > existing.score) {
    existing.score = candidate.score;
    existing.kind = candidate.kind;
    existing.source = candidate.source;
  }
}

function extractHtsLikeCodes(value) {
  const text = String(value || "");
  return text.match(HTS_PATTERN) || [];
}

function normalizeHts(value) {
  return String(value || "").replace(/\D/g, "");
}

function scoreSheetName(name) {
  if (INVOICE_SHEET_PATTERN.test(name)) return 10;
  if (PACKING_SHEET_PATTERN.test(name)) return -8;
  return 0;
}

function isStopRow(row) {
  return STOP_ROW_PATTERN.test((row || []).join(" "));
}

function rowHasHts(row) {
  return (row || []).some((cell) => extractHtsLikeCodes(cell).some((code) => {
    const normalized = normalizeHts(code);
    return normalized.length === 8 || normalized.length === 10;
  }));
}

function isDateLike(hts) {
  const value = hts.slice(0, 8);
  if (!/^(19|20)\d{6}$/.test(value)) return false;
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function looksLikeReferenceNumber(rowText, hts) {
  if (hts.length < 10) return false;
  return /\b(inv|invoice|po|so|order|container|cntr|b\/l|bill|booking|ref|no\.?)\b/i.test(rowText);
}

function cellAddress(rowIndex, colIndex) {
  let col = "";
  let n = colIndex + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${rowIndex + 1}`;
}
