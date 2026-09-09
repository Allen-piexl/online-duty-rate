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

This project intentionally extracts only rule/reference data from the latest `*DUTY RATE LOOKUP*.xlsx` workbook.

It does not publish `000 - OTHERS LOOKUP Letitia.xlsx` customer examples, orders, SKUs, product images, or historical client worksheets.

## Update Data From A New Workbook

For local updates, put the newest workbook one directory above this project or in `data-source/`, then run:

```powershell
npm run extract
npm test
```

The extractor automatically uses the highest-version matching workbook, such as `v16.18 Beta 090326`, and writes:

- `public/data/rules.json`
- `public/data/summary.json`

For online updates, open the Data Update section in the site and upload the newest workbook to `data-source/` on GitHub. The `Update duty data` GitHub Actions workflow will regenerate the public JSON files, run tests, and commit the generated data.

Only upload rule/reference workbooks. Do not upload customer order workbooks or files containing client data.

## Regenerate Data

From the repository root:

```powershell
python scripts/extract_public_data.py
```

The script looks in `data-source/` and the parent directory for the latest `*DUTY RATE LOOKUP*.xlsx` workbook.

## Run Locally

Open `index.html` directly in a browser, or serve the folder:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## GitHub Pages

This is a static site. Push this folder to a public GitHub repository and enable GitHub Pages from the repository root.
