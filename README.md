# Digitization and Bilingual Search Tool for 2002 Karnataka Electoral Rolls

This repository digitizes Karnataka electoral rolls PDFs, extracts voter names, and produces district-wise Parquet outputs with Kannada + English fields for fast bilingual search. Transliteration is designed to be context-aware (especially for Muslim names) and can be validated against a manually curated Shivajinagar reference sample.

## Monorepo Layout

- `apps/web/` — placeholder for the Next.js/Tailwind frontend (currently contains a preliminary `index.html`)
- `packages/data-pipeline/`
  - `scripts/` — ingestion + ETL scripts
  - `lib/` — transliteration + correction logic
  - `config/` — OCR experiment configs (easyocr/tesseract)
  - `samples/` — reference datasets (e.g., Shivajinagar bilingual sample)
- `data/` — local-only data (PDFs + `rolls.sqlite`)

## Data Pipeline

Install dependencies:

```powershell
py -m pip install -r packages/data-pipeline/requirements.txt
```

Ingest PDFs into SQLite (defaults to `data/`):

```powershell
py packages/data-pipeline/scripts/ingest_rolls.py --root .\data --db .\data\rolls.sqlite
```

Convert SQLite → Parquet (writes to `parquet_out/` and updates `metadata.json`):

```powershell
py packages/data-pipeline/scripts/convert_to_parquet.py --db .\data\rolls.sqlite --out-dir .\parquet_out
```

Generate tiered JSON indexes from Parquet (writes under `data/districts/` and `data/master_index.json`):

```powershell
py packages/data-pipeline/scripts/generate_json_index.py --district BBMP
py packages/data-pipeline/scripts/generate_json_index.py --pending
py packages/data-pipeline/scripts/generate_json_index.py --all
```

View pipeline state dashboard:

```powershell
py packages/data-pipeline/scripts/show_pipeline_status.py
```

State file:

- `pipeline_state.json` (repo root) is created/updated automatically and tracks per-district SQLite/Parquet/JSON status and live/coming-soon frontend status.

Run transliteration tests (uses `packages/data-pipeline/samples/shivajinagar_voter_sample.csv` if present):

```powershell
py -m pytest -q
```

## Adding a New District (Step-by-Step)

1. Convert SQLite → Parquet:

```powershell
py packages/data-pipeline/scripts/convert_to_parquet.py --district BELGAUM
```

2. Generate JSON index:

```powershell
py packages/data-pipeline/scripts/generate_json_index.py --district BELGAUM
```

3. Verify status:

```powershell
py packages/data-pipeline/scripts/show_pipeline_status.py
```

4. Commit and deploy:

```powershell
git add data/ pipeline_state.json
git commit -m "Add BELGAUM electoral data"
git push
```

## Current Status

```powershell
py packages/data-pipeline/scripts/show_pipeline_status.py
```
