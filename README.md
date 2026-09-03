# Online Duty Rate Lookup

A static browser-based HTS duty lookup tool converted from the internal Excel rate lookup workbook.

## What is included

- HTS normalization
- HTS8 base description, census units, and MFN rate lookup
- Section 301 China lookup
- Section 301 Forced Labor country and HTS-specific lookup
- Section 232 lookup with manual flags for auto parts, truck parts, steel, aluminum, copper, wood, and semiconductors
- OGA/PGA, CPSC, LIC, 301 exclusion, and ADD/CVD links
- Single lookup and batch lookup
- CSV export

## Public data policy

This project intentionally extracts only rule/reference data from `♥DUTY RATE LOOKUP v16.17 Beta 072926 - 232判定.xlsx`.

It does not publish `000 - OTHERS LOOKUP Letitia.xlsx` customer examples, orders, SKUs, product images, or historical client worksheets.

## Regenerate data

From the repository root:

```powershell
python scripts/extract_public_data.py
```

The script expects the original Excel workbook one directory above this project.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## GitHub Pages

This is a static site. Push this folder to a public GitHub repository and enable GitHub Pages from the repository root.

