const PERCENT_CODES = {
  "99039405": 0.25,
  "99037408": 0.25,
  "99038202": 0.5,
  "99038209": 0.25,
  "99037601": 0.1,
  "99037602": 0.25,
  "99037603": 0.25,
  "99037901": 0.25,
};

export function normalizeHts(input) {
  return String(input || "").replace(/\D/g, "");
}

export function parseRate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (!text || /free/i.test(text)) return 0;
  if (text.includes("%")) {
    const number = Number.parseFloat(text.replace("%", ""));
    return Number.isFinite(number) ? number / 100 : null;
  }
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

export function formatRate(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = typeof value === "number" ? value : parseRate(value);
  if (numeric === null) return String(value);
  if (numeric === 0) return "0%";
  return `${(numeric * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "#N/A";
}

function addUnique(target, value) {
  if (!hasText(value)) return;
  const parts = String(value).split("/").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (!target.includes(part)) target.push(part);
  }
}

function chooseMetalCode(rule, flagName, flags) {
  const material = String(rule.materials || "");
  const metalCode = rule.metal;
  if (!hasText(metalCode) || !material.includes(flagName)) return "";
  const chapter = Number.parseInt(String(rule.hts || "").slice(0, 2), 10);
  const defaultExemption = chapter >= 72 && chapter <= 76 ? "99038201" : "99038203";
  if (flags.auto && rule.auto === "99039405") return defaultExemption;
  if (flags.truck && rule.truck === "99037408") return defaultExemption;
  return flags[flagName] ? metalCode : defaultExemption;
}

export function lookup(input, data) {
  const country = String(input.country || "CN").trim().toUpperCase();
  const hts = normalizeHts(input.hts);
  const hts8 = hts.slice(0, 8);
  const flags = {
    auto: Boolean(input.flags?.auto),
    truck: Boolean(input.flags?.truck),
    S: Boolean(input.flags?.steel),
    A: Boolean(input.flags?.aluminum),
    C: Boolean(input.flags?.copper),
    wood: Boolean(input.flags?.wood),
    semiconductor: Boolean(input.flags?.semiconductor),
  };

  const tariff = data.tariff[hts8] || null;
  const oga = data.oga[hts] || null;
  const cpsc = data.cpsc[hts] || null;
  const rule232 = data.section232[hts] ? { ...data.section232[hts], hts } : null;
  const baseRate = tariff ? parseRate(tariff.mfnRate) : null;

  const result232 = evaluate232(rule232, flags, baseRate);
  const specialFl = data.section301FL.specialHts[hts] || null;
  const countryFl = data.section301FL.countries[country] || null;
  const resultFl = evaluate301Fl(specialFl, countryFl, result232);
  const result301 = country === "CN" && data.section301[hts] ? data.section301[hts] : null;
  const exclusions = data.section301Exclusions[hts] || [];
  const lic = {
    aluminum: data.lic.aluminum.includes(hts),
    steel: data.lic.steel.includes(hts),
  };

  return {
    country,
    inputHts: input.hts || "",
    hts,
    hts8,
    descriptionInput: input.description || "",
    materialInput: input.material || "",
    flags,
    tariff,
    baseRate,
    oga,
    cpsc,
    section301: result301,
    section301FL: resultFl,
    section232: result232,
    exclusions,
    lic,
    addUrl: hts ? `https://www.netchb.com/app/resources/completeTariffInfo.do?tariffNo=${hts}` : "",
    warnings: buildWarnings(hts, tariff, result232, country),
  };
}

export function evaluate232(rule, flags, baseRate) {
  if (!rule) {
    return { matched: false, chapter99: [], rate: 0, rule: null, details: [] };
  }

  const chapter99 = [];
  const details = [];
  if (hasText(rule.auto)) {
    const code = flags.auto ? "99039405" : "99039406";
    addUnique(chapter99, code);
    details.push(flags.auto ? "Auto parts flag selected." : "Auto parts range matched; exemption code selected because flag is off.");
  }
  if (hasText(rule.truck)) {
    const code = flags.truck ? "99037408" : "99037411";
    addUnique(chapter99, code);
    details.push(flags.truck ? "Truck parts flag selected." : "Truck parts range matched; exemption code selected because flag is off.");
  }

  const steel = chooseMetalCode(rule, "S", flags);
  const aluminum = chooseMetalCode(rule, "A", flags);
  const copper = chooseMetalCode(rule, "C", flags);
  const preferred = [steel, aluminum, copper].find((code) => ["99038202", "99038209", "99038210"].includes(code));
  addUnique(chapter99, preferred || steel || aluminum || copper);

  if (hasText(rule.wood)) {
    let code = rule.wood;
    if (code === "99037603" && !flags.wood) code = "99037604";
    addUnique(chapter99, code);
    details.push(flags.wood ? "Wood flag selected." : "Wood range matched; exemption handling may apply.");
  }
  if (hasText(rule.semiconductor)) {
    let code = rule.semiconductor;
    if ((flags.auto && rule.auto === "99039405") || (flags.truck && rule.truck === "99037408")) {
      code = "99037907";
    } else if (!flags.semiconductor) {
      code = "99037909";
    }
    addUnique(chapter99, code);
    details.push(flags.semiconductor ? "Semiconductor flag selected." : "Semiconductor range matched; exemption handling may apply.");
  }

  const rate = chapter99.reduce((max, code) => {
    if (code === "99038210") {
      const calculated = Math.max(0, 0.15 - (baseRate ?? 0));
      return Math.max(max, calculated);
    }
    return Math.max(max, PERCENT_CODES[code] ?? 0);
  }, 0);

  return { matched: true, chapter99, rate, rule, details };
}

function evaluate301Fl(specialFl, countryFl, result232) {
  if (specialFl && hasText(specialFl.chapter99)) {
    return {
      chapter99: specialFl.chapter99,
      rate: parseRate(specialFl.rate),
      source: "HTS-specific exclusion/list",
      note: "",
    };
  }
  if (result232.rate > 0) {
    return {
      chapter99: "99030590",
      rate: 0,
      source: "232 exclusion rule",
      note: "Excel logic switches 301FL to 99030590 when 232 additional duty applies.",
    };
  }
  if (!countryFl) {
    return { chapter99: "", rate: null, source: "No country mapping", note: "" };
  }
  return {
    chapter99: countryFl.chapter99,
    rate: parseRate(countryFl.rate),
    source: countryFl.country,
    note: "",
  };
}

function buildWarnings(hts, tariff, result232, country) {
  const warnings = [];
  if (!hts) warnings.push("Enter an HTS code.");
  if (hts && hts.length !== 10) warnings.push("Most rule lookups require a 10-digit HTS.");
  if (hts && !tariff) warnings.push("No HTS8 base tariff match found.");
  if (country !== "CN") warnings.push("China Section 301 is hidden because country of origin is not CN.");
  if (result232.matched && result232.chapter99.length === 0) warnings.push("232 rule matched, but no chapter 99 result was selected.");
  return warnings;
}

export function parseBatchLine(line) {
  const [hts = "", country = "CN", flagText = ""] = line.split(",").map((part) => part.trim());
  const flagsRaw = flagText.toLowerCase();
  return {
    hts,
    country,
    flags: {
      auto: /auto|汽配/.test(flagsRaw),
      truck: /truck|卡配/.test(flagsRaw),
      steel: /steel|钢/.test(flagsRaw),
      aluminum: /aluminum|al|铝/.test(flagsRaw),
      copper: /copper|cu|铜/.test(flagsRaw),
      wood: /wood|木/.test(flagsRaw),
      semiconductor: /semi|chip|半导体/.test(flagsRaw),
    },
  };
}

