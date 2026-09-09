# Source Workbooks

Upload the latest `*DUTY RATE LOOKUP*.xlsx` workbook here when the duty rules change.

GitHub Actions will run `scripts/extract_public_data.py`, update `public/data/rules.json` and `public/data/summary.json`, run tests, and commit the generated data.

Only upload the rule/reference workbook. Do not upload customer order files, SKU lists, commercial invoices, or client examples.
