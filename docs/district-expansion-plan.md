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
2. Generate Schema 2.0 JSON shards into a staging output directory.
3. Verify district-level and AC-level counts.
4. Promote the district files into `data/`.
5. Rebuild search indexes against the updated published dataset.
6. Run validation and targeted tests before release.

Current generator note:

- `generate_json_index.py` currently generates from the entire supplied SQLite
  database, not from a `--district` flag.
- For district-by-district rollout, use a staging SQLite database that contains
  only the target district or target promotion files from a staging output.

## Standard Commands

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

## SHIVAMOGGA

Expected pipeline steps:

1. Prepare `tmp/SHIVAMOGGA.sqlite` from the repaired OCR source for SHIVAMOGGA.
2. Generate Schema 2.0 output into `tmp/schema2/SHIVAMOGGA`.
3. Compare district totals, AC totals, and part counts against source records.
4. Promote:
   - `data/districts/SHIVAMOGGA/`
   - updated `data/master_index.json`
5. Rebuild search indexes and rerun validation/tests.

Regeneration commands:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/SHIVAMOGGA.sqlite --out tmp/schema2/SHIVAMOGGA
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

- Revert the promoted `data/districts/SHIVAMOGGA/` directory and related
  `data/master_index.json` change to the previous commit.
- Rebuild search indexes from the restored dataset.

## BAGALKOT

Expected pipeline steps:

1. Prepare `tmp/BAGALKOT.sqlite`.
2. Generate Schema 2.0 shards into staging.
3. Verify district summary counts and AC summaries.
4. Promote district files and refresh search indexes.
5. Run validation and focused frontend checks.

Regeneration commands:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BAGALKOT.sqlite --out tmp/schema2/BAGALKOT
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
2. Generate staging shards and compare totals.
3. Promote updated district files.
4. Rebuild search indexes.
5. Run validation and frontend smoke tests.

Regeneration commands:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BANGALORE_RURAL.sqlite --out tmp/schema2/BANGALORE_RURAL
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
2. Generate staging output and verify AC/part counts.
3. Promote district files.
4. Rebuild search indexes and validate.

Regeneration commands:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BANGALORE_URBAN.sqlite --out tmp/schema2/BANGALORE_URBAN
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
2. Generate staging Schema 2.0 shards.
3. Validate counts carefully because BBMP is large and search-heavy.
4. Promote district files and refresh indexes.
5. Run validation, Python tests, and frontend smoke checks.

Regeneration commands:

```bash
python packages/data-pipeline/scripts/generate_json_index.py --db tmp/BBMP.sqlite --out tmp/schema2/BBMP
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
