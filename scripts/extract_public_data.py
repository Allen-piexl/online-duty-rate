from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


def col_to_num(col: str) -> int:
    out = 0
    for ch in col:
        out = out * 26 + ord(ch) - 64
    return out


def cell_rc(ref: str) -> tuple[int, int]:
    match = re.match(r"([A-Z]+)(\d+)", ref)
    if not match:
        raise ValueError(ref)
    return int(match.group(2)), col_to_num(match.group(1))


def clean_hts(value: str | int | float | None) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return re.sub(r"[^0-9]", "", text)


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join((node.text or "") for node in item.findall(".//a:t", NS))
        for item in root.findall("a:si", NS)
    ]


def read_sheet_paths(zf: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(f"{{{PKG}}}Relationship")
    }
    out = {}
    for sheet in workbook.findall("a:sheets/a:sheet", NS):
        rid = sheet.attrib[f"{{{NS['r']}}}id"]
        target = rid_to_target[rid]
        if not target.startswith("xl/"):
            target = "xl/" + target.lstrip("/")
        out[sheet.attrib["name"]] = target
    return out


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    value = cell.find("a:v", NS)
    if value is None:
        return ""
    if cell.attrib.get("t") == "s":
        try:
            return shared_strings[int(value.text or "0")]
        except (ValueError, IndexError):
            return value.text or ""
    return value.text or ""


def read_sheet_rows(
    zf: zipfile.ZipFile, shared_strings: list[str], target: str
) -> dict[int, dict[int, str]]:
    root = ET.fromstring(zf.read(target))
    rows: dict[int, dict[int, str]] = {}
    for row in root.findall("a:sheetData/a:row", NS):
        row_number = int(row.attrib.get("r", "0"))
        cells: dict[int, str] = {}
        for cell in row.findall("a:c", NS):
            try:
                _, col_number = cell_rc(cell.attrib["r"])
            except (KeyError, ValueError):
                continue
            cells[col_number] = cell_value(cell, shared_strings)
        if cells:
            rows[row_number] = cells
    return rows


def add_if_value(target: dict[str, str], key: str, value: str) -> None:
    if value not in ("", "#N/A"):
        target[key] = value


def main() -> None:
    project_dir = Path(__file__).resolve().parents[1]
    source_dir = project_dir.parent
    workbook = next(source_dir.glob("*DUTY RATE LOOKUP*.xlsx"))
    out_dir = project_dir / "public" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(workbook) as zf:
        shared_strings = read_shared_strings(zf)
        paths = read_sheet_paths(zf)
        section_301 = next(name for name in paths if "301" in name and name not in {"301FL", "301exclu"})
        section_232 = next(name for name in paths if "232" in name)

        tariff_rows = read_sheet_rows(zf, shared_strings, paths["Tariff Database"])
        oga_rows = read_sheet_rows(zf, shared_strings, paths["OGA"])
        cpsc_rows = read_sheet_rows(zf, shared_strings, paths["CPSC"])
        lic_rows = read_sheet_rows(zf, shared_strings, paths["LIC"])
        fl_rows = read_sheet_rows(zf, shared_strings, paths["301FL"])
        s301_rows = read_sheet_rows(zf, shared_strings, paths[section_301])
        s232_rows = read_sheet_rows(zf, shared_strings, paths[section_232])
        excl_rows = read_sheet_rows(zf, shared_strings, paths["301exclu"])

    tariff = {}
    for row in tariff_rows.values():
        hts8 = clean_hts(row.get(1))
        if len(hts8) == 8:
            tariff[hts8] = {
                "description": row.get(2, ""),
                "quantity1": row.get(3, ""),
                "quantity2": row.get(4, ""),
                "wtoBinding": row.get(5, ""),
                "mfnRate": row.get(6, ""),
            }

    oga = {}
    for row in oga_rows.values():
        hts = clean_hts(row.get(1))
        if len(hts) == 10:
            item: dict[str, str] = {}
            add_if_value(item, "pga", row.get(2, ""))
            add_if_value(item, "effectiveDateSerial", row.get(3, ""))
            add_if_value(item, "expirationDateSerial", row.get(4, ""))
            add_if_value(item, "cpsc", row.get(5, ""))
            if item:
                oga[hts] = item

    cpsc = {}
    for row in cpsc_rows.values():
        hts = clean_hts(row.get(1))
        if len(hts) == 10:
            cpsc[hts] = {
                "oga": row.get(2, ""),
                "exclusion": row.get(3, ""),
                "flag": row.get(4, ""),
            }

    lic_aluminum: set[str] = set()
    lic_steel: set[str] = set()
    for row in lic_rows.values():
        al = clean_hts(row.get(1))
        steel = clean_hts(row.get(2))
        if len(al) == 10:
            lic_aluminum.add(al)
        if len(steel) == 10:
            lic_steel.add(steel)

    country_fl = {}
    for row_number in range(2, 10):
        row = fl_rows.get(row_number, {})
        code = row.get(8, "")
        if code:
            country_fl[code] = {
                "country": row.get(7, ""),
                "chapter99": row.get(9, ""),
                "rate": row.get(10, ""),
            }

    special_fl = {}
    fl_notes = []
    for row_number, row in fl_rows.items():
        if row_number <= 9:
            if row.get(2) and row.get(3):
                fl_notes.append(
                    {
                        "label": row.get(2, ""),
                        "chapter99": row.get(3, ""),
                        "rate": row.get(4, ""),
                        "note": row.get(5, ""),
                    }
                )
            continue
        hts = clean_hts(row.get(2))
        if len(hts) == 10:
            special_fl[hts] = {
                "chapter99": row.get(3, ""),
                "rate": row.get(4, ""),
            }

    s301 = {}
    for row in s301_rows.values():
        hts = clean_hts(row.get(1))
        if len(hts) == 10:
            s301[hts] = {
                "chapter99": row.get(2, ""),
                "rate": row.get(3, ""),
                "fullExclusion": row.get(6, ""),
                "exclusion": row.get(7, ""),
            }

    s232 = {}
    for row in s232_rows.values():
        hts = clean_hts(row.get(2))
        if len(hts) == 10:
            s232[hts] = {
                "original": row.get(3, ""),
                "rate": row.get(4, ""),
                "materials": row.get(5, ""),
                "auto": row.get(6, ""),
                "truck": row.get(7, ""),
                "metal": row.get(8, ""),
                "wood": row.get(9, ""),
                "semiconductor": row.get(10, ""),
            }

    exclusions = {}
    for row in excl_rows.values():
        hts = clean_hts(row.get(2))
        if len(hts) == 10:
            entry = {
                "full": row.get(3, ""),
                "partial": row.get(4, ""),
                "description": row.get(6, ""),
            }
            exclusions.setdefault(hts, []).append(entry)

    data = {
        "meta": {
            "sourceWorkbook": workbook.name,
            "generatedFrom": "public rule sheets only",
            "version": "v16.17 Beta 072926 - 232判定",
        },
        "tariff": tariff,
        "oga": oga,
        "cpsc": cpsc,
        "lic": {
            "aluminum": sorted(lic_aluminum),
            "steel": sorted(lic_steel),
        },
        "section301": s301,
        "section301FL": {
            "countries": country_fl,
            "specialHts": special_fl,
            "notes": fl_notes,
        },
        "section232": s232,
        "section301Exclusions": exclusions,
    }

    target = out_dir / "rules.json"
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    summary = {
        "tariff": len(tariff),
        "oga": len(oga),
        "cpsc": len(cpsc),
        "lic_aluminum": len(lic_aluminum),
        "lic_steel": len(lic_steel),
        "section301": len(s301),
        "section301FL_special": len(special_fl),
        "section232": len(s232),
        "section301Exclusions": len(exclusions),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

