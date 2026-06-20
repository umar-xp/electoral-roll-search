# District Expansion Plan

This plan describes how to onboard the remaining districts under Schema 2.0
without reintroducing Schema 1.0 structures.

Recommended rollout order:

1. SHIVAMOGGA
2. BAGALKOT
3. BANGALORE RURAL
4. BANGALORE URBAN
5. BBMP

## Common Approach

Use the same controlled process for each district:

1. Prepare or isolate the district source data in a staging SQLite database.
2. Run OCR ingestion into that isolated SQLite database.
3. Generate Schema 2.0 JSON shards into a staging output directory.
4. Verify district-level and AC-level counts.
5. Promote only the staged district files into `data/districts/`.
6. Regenerate the published `master_index.json` from a cumulative SQLite that
   contains all released districts.
7. Rebuild search indexes against the updated published dataset.
8. Run validation and targeted tests before release.

Current generator note:

- `generate_json_index.py` currently generates from the entire supplied SQLite
  database, not from a `--district` flag.
- For district-by-district rollout, use a staging SQLite database that contains
  only the target district or target promotion files from a staging output.
- District-isolated generation outputs must never replace the published
  `data/master_index.json`.
- The published `data/master_index.json` must always be generated from a
  cumulative SQLite containing all released districts.

## Reference Implementation

- Mysore is the reference implementation for Schema 2.0 rollout.
- Future districts must conform to the Mysore-generated artifact pattern:
  - lightweight `master_index.json`
  - district index files under `data/districts/<district_code>/index.json`
  - AC index files under `data/districts/<district_code>/<ac_num>_index.json`
  - part files under `data/districts/<district_code>/<ac_num>/part_<part_num>.json`

## End-To-End Flows

Development flow:

```text
Raw PDFs
→ OCR
→ QC
→ SQLite
→ JSON generation
→ Validation
→ Search index build
→ Deployment
```

Production flow:

```text
All released districts
→ cumulative SQLite
→ master_index.json
→ search index rebuild
→ deployment
```

## Release Rule

- Never publish a district-isolated `master_index.json`.
- Always promote district JSON shards separately from the published master
  manifest.
- Always regenerate the published `master_index.json` from cumulative released
  data before rebuilding search indexes and deploying.

## Exact Release Workflow

1. Ingest raw PDFs for the target district into an isolated staging SQLite.
2. Run quality-control review on the staging SQLite output.
3. Generate district JSON shards into a staging output directory.
4. Validate the staging output.
5. Compare district totals, AC totals, and part counts against staging source.
6. Copy only `tmp/schema2/<DISTRICT>/districts/<DISTRICT>/` into
   `data/districts/`.
7. Regenerate `data/master_index.json` from the cumulative SQLite containing
   all currently released districts.
8. Rebuild search indexes from the published `data/` directory.
9. Run validation, Python tests, and targeted Playwright verification.
10. Deploy only after all checks pass.

## Standard Commands

OCR ingestion into isolated SQLite:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\pdfs\<DISTRICT> --db .\tmp\<DISTRICT>.sqlite --district <DISTRICT> --dpi 300 --workers 4
```

OCR/QC status check:

```bash
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\<DISTRICT>.sqlite
```

District generation from isolated SQLite:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/<DISTRICT>.sqlite --out tmp/schema2/<DISTRICT>
```

Dataset validation after promotion:

```bash
python packages/data-pipeline/scripts/validate_data.py data
```

Python regression checks:

```bash
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

Frontend smoke checks:

```bash
npx playwright test tests/e2e/search.spec.ts --project=chromium -g "master_index.json loads and populates districts|selecting district loads AC dropdown|global search searches across all districts"
```

Search index rebuild after promotion:

```bash
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

Published master manifest regeneration from cumulative SQLite:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
```

## SHIVAMOGGA

Expected pipeline steps:

1. Prepare `tmp/SHIVAMOGGA.sqlite` from the repaired OCR source for SHIVAMOGGA.
2. Ingest SHIVAMOGGA PDFs into that isolated staging SQLite.
3. Generate Schema 2.0 output into `tmp/schema2/SHIVAMOGGA`.
4. Compare district totals, AC totals, and part counts against source records.
5. Promote only `data/districts/SHIVAMOGGA/`.
6. Regenerate the published `data/master_index.json` from cumulative released
   SQLite data.
7. Rebuild search indexes and rerun validation/tests.

Commands:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\pdfs\SHIVAMOGGA --db .\tmp\SHIVAMOGGA.sqlite --district SHIVAMOGGA --dpi 300 --workers 4
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\SHIVAMOGGA.sqlite
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/SHIVAMOGGA.sqlite --out tmp/schema2/SHIVAMOGGA
Copy-Item -Recurse -Force .\tmp\schema2\SHIVAMOGGA\districts\SHIVAMOGGA .\data\districts\
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

Validation commands:

```bash
python packages/data-pipeline/scripts/validate_data.py data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

Estimated risks:

- Medium: first non-Mysore district promoted under the finalized 2.0 contract.
- Medium: Kannada OCR quality may affect search-token quality.
- Low: routing risk, because `district_code` is already standardized.

Rollback strategy:

- Revert the promoted `data/districts/SHIVAMOGGA/` directory and the published
  `data/master_index.json` to the previous release commit.
- Rebuild search indexes from the restored dataset.

## BAGALKOT

Expected pipeline steps:

1. Prepare `tmp/BAGALKOT.sqlite`.
2. Ingest BAGALKOT PDFs into isolated staging SQLite.
3. Generate Schema 2.0 shards into staging.
4. Verify district summary counts and AC summaries.
5. Promote district files only.
6. Regenerate published `master_index.json` from cumulative SQLite.
7. Refresh search indexes.
8. Run validation and focused frontend checks.

Commands:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\pdfs\BAGALKOT --db .\tmp\BAGALKOT.sqlite --district BAGALKOT --dpi 300 --workers 4
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\BAGALKOT.sqlite
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BAGALKOT.sqlite --out tmp/schema2/BAGALKOT
Copy-Item -Recurse -Force .\tmp\schema2\BAGALKOT\districts\BAGALKOT .\data\districts\
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

Validation commands:

```bash
python packages/data-pipeline/scripts/validate_data.py data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

Estimated risks:

- Medium: district already exists in published data, so replacement must keep
  counts and file layout stable.
- Low: AC summary naming is already normalized.

Rollback strategy:

- Restore the prior `data/districts/BAGALKOT/` and `data/master_index.json`.
- Rebuild search indexes to match the restored state.

## BANGALORE RURAL

Expected pipeline steps:

1. Prepare `tmp/BANGALORE_RURAL.sqlite`.
2. Ingest BANGALORE RURAL PDFs into isolated staging SQLite.
3. Generate staging shards and compare totals.
4. Promote updated district files only.
5. Regenerate published `master_index.json` from cumulative SQLite.
6. Rebuild search indexes.
7. Run validation and frontend smoke tests.

Commands:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\pdfs\BANGALORE_RURAL --db .\tmp\BANGALORE_RURAL.sqlite --district BANGALORE_RURAL --dpi 300 --workers 6
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\BANGALORE_RURAL.sqlite
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BANGALORE_RURAL.sqlite --out tmp/schema2/BANGALORE_RURAL
Copy-Item -Recurse -Force .\tmp\schema2\BANGALORE_RURAL\districts\BANGALORE_RURAL .\data\districts\
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

Validation commands:

```bash
python packages/data-pipeline/scripts/validate_data.py data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

Estimated risks:

- Medium: larger district means more search-index churn.
- Medium: higher chance of count mismatches if staging promotion is incomplete.

Rollback strategy:

- Revert district files and `master_index.json` to the previous release commit.
- Rebuild search indexes from the reverted dataset.

## BANGALORE URBAN

Expected pipeline steps:

1. Prepare `tmp/BANGALORE_URBAN.sqlite`.
2. Ingest BANGALORE URBAN PDFs into isolated staging SQLite.
3. Generate staging output and verify AC/part counts.
4. Promote district files only.
5. Regenerate published `master_index.json` from cumulative SQLite.
6. Rebuild search indexes and validate.

Commands:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\pdfs\BANGALORE_URBAN --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 --workers 6
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\BANGALORE_URBAN.sqlite
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BANGALORE_URBAN.sqlite --out tmp/schema2/BANGALORE_URBAN
Copy-Item -Recurse -Force .\tmp\schema2\BANGALORE_URBAN\districts\BANGALORE_URBAN .\data\districts\
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

Validation commands:

```bash
python packages/data-pipeline/scripts/validate_data.py data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

Estimated risks:

- Medium to high: large AC shards increase search-index rebuild time.
- Medium: more likely to expose stale assumptions in downstream tooling if
  counts drift.

Rollback strategy:

- Restore previous district files and `master_index.json`.
- Rebuild search indexes from the restored commit.

## BBMP

Expected pipeline steps:

1. Prepare `tmp/BBMP.sqlite`.
2. Ingest BBMP PDFs into isolated staging SQLite.
3. Generate staging Schema 2.0 shards.
4. Validate counts carefully because BBMP is large and search-heavy.
5. Promote district files only.
6. Regenerate published `master_index.json` from cumulative SQLite.
7. Refresh indexes.
8. Run validation, Python tests, and frontend smoke checks.

Commands:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\pdfs\BBMP --db .\tmp\BBMP.sqlite --district BBMP --dpi 300 --workers 8
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\BBMP.sqlite
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BBMP.sqlite --out tmp/schema2/BBMP
Copy-Item -Recurse -Force .\tmp\schema2\BBMP\districts\BBMP .\data\districts\
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

Validation commands:

```bash
python packages/data-pipeline/scripts/validate_data.py data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

Estimated risks:

- High: largest district in the rollout order.
- High: search-index size and browser search behavior need the closest watch.
- Medium: deployment timing matters because index rebuilds will be heavier.

Rollback strategy:

- Revert BBMP files and `master_index.json` to the previous release commit.
- Rebuild search indexes immediately after rollback.

## Release Gate For Every District

Promote a district only when all of the following are true:

- Generated files validate under Schema 2.0.
- District and AC counts match the staging source.
- Search indexes rebuild successfully.
- Targeted Python tests pass.
- Targeted Playwright search flow checks pass.
- No Schema 1.0 structures are reintroduced.
