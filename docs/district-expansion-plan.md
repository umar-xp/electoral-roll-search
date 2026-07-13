# District Expansion Plan

This plan describes how to onboard the remaining districts under Schema 2.0
without reintroducing Schema 1.0 structures.

## Production Status Update

Use the following June 2026 operating assumptions for all future district work:

- `schema-v2-migration` is the active production branch
- approved pushes to `schema-v2-migration` are production-facing
- JSON is the official production data format
- SQLite and Parquet are not production deployment artifacts
- new district outputs must be deployable as JSON without extra conversion steps

This means:

- SQLite remains allowed for OCR ingestion, resumability, quality review, and cumulative offline generation
- Parquet is no longer part of the recommended production release path
- the deployed website contract is the JSON hierarchy under `data/`

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
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\<DISTRICT> --db .\tmp\<DISTRICT>.sqlite --district <DISTRICT> --dpi 300 --workers 4
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
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\SHIVAMOGGA --db .\tmp\SHIVAMOGGA.sqlite --district SHIVAMOGGA --dpi 300 --workers 4
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
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BAGALKOT --db .\tmp\BAGALKOT.sqlite --district BAGALKOT --dpi 300 --workers 4
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
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BANGALORE_RURAL --db .\tmp\BANGALORE_RURAL.sqlite --district BANGALORE_RURAL --dpi 300 --workers 6
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
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BANGALORE_URBAN --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 --workers 6
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

### Bangalore Urban Execution Commands

#### A. OCR extraction commands

Full extraction command:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BANGALORE_URBAN --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 --workers 6
```

Four-worker overnight-safe command:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BANGALORE_URBAN --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 --workers 4
```

Resume command after interruption:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BANGALORE_URBAN --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 --workers 4
```

Single-part rerun command:

```bash
python packages/data-pipeline/scripts/ingest_rolls.py --pdf .\data\BANGALORE_URBAN\<PDF_FILE>.pdf --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300
```

Failed-part rerun command:

```bash
Get-Content .\tmp\BANGALORE_URBAN_failed.txt | ForEach-Object { python packages/data-pipeline/scripts/ingest_rolls.py --pdf $_ --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 }
```

#### B. Monitoring commands

Progress check command:

```bash
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\BANGALORE_URBAN.sqlite
```

Worker status command:

```bash
Get-Process python | Sort-Object CPU -Descending | Select-Object -First 12 Id, ProcessName, CPU, StartTime
```

Records generated count:

```bash
python -c "import sqlite3; conn=sqlite3.connect(r'.\tmp\BANGALORE_URBAN.sqlite'); cur=conn.cursor(); print('voters=', cur.execute('select count(*) from voters').fetchone()[0]); print('pdfs_done=', cur.execute('select count(distinct pdf_file) from voters').fetchone()[0]); conn.close()"
```

ETA estimation command:

```bash
powershell -NoProfile -Command "$startedAt=Get-Date '2026-06-20 20:00'; $total=(Get-ChildItem .\data\BANGALORE_URBAN -Filter *.pdf -Recurse).Count; $done=(python -c \"import sqlite3; c=sqlite3.connect(r'.\tmp\BANGALORE_URBAN.sqlite'); cur=c.cursor(); print(cur.execute('select count(distinct pdf_file) from voters').fetchone()[0]); c.close()\" | Select-Object -Last 1); $elapsed=((Get-Date)-$startedAt).TotalHours; if([double]$done -gt 0){$rate=[double]$done/$elapsed; $remaining=$total-[double]$done; $eta=$remaining/$rate; Write-Host ('done={0}/{1} rate={2:N2} pdf/hr eta_hours={3:N2}' -f $done,$total,$rate,$eta)} else {Write-Host ('done=0/{0} eta_hours=unknown' -f $total)}"
```

#### C. Validation commands

JSON validation:

```bash
python packages/data-pipeline/scripts/validate_data.py .\tmp\schema2\BANGALORE_URBAN
python packages/data-pipeline/scripts/validate_data.py .\data
```

Duplicate voter detection:

```bash
python -c "import sqlite3; conn=sqlite3.connect(r'.\tmp\BANGALORE_URBAN.sqlite'); cur=conn.cursor(); q=\"select ac_num, part_num, serial_no, count(*) from voters group by ac_num, part_num, serial_no having count(*) > 1 limit 20\"; rows=cur.execute(q).fetchall(); print(rows if rows else 'no duplicate serial tuples'); conn.close()"
```

Missing field checks:

```bash
python -c "import json, pathlib; root=pathlib.Path(r'.\tmp\schema2\BANGALORE_URBAN\districts\BANGALORE_URBAN'); bad=[]; 
for p in root.rglob('part_*.json'):
 d=json.loads(p.read_text(encoding='utf-8')); 
 for i,v in enumerate(d.get('voters',[]),1):
  req=['sn','psn','vn','g','a','pn']; 
  miss=[k for k in req if k not in v]; 
  if miss: bad.append((str(p), i, miss)); 
  if len(bad)>=20: break
 if len(bad)>=20: break
print(bad if bad else 'no missing required fields in sampled scan')"
```

AC and part consistency checks:

```bash
python -c "import json, pathlib; root=pathlib.Path(r'.\tmp\schema2\BANGALORE_URBAN\districts\BANGALORE_URBAN'); idx=json.loads((root/'index.json').read_text(encoding='utf-8')); problems=[]; 
for ac in idx.get('acs',[]): 
 n=str(ac['ac_num']); ac_file=root/f'{n}_index.json'; 
 if not ac_file.exists(): problems.append((n,'missing ac index')); continue
 ac_idx=json.loads(ac_file.read_text(encoding='utf-8')); part_dir=root/n; file_count=len(list(part_dir.glob('part_*.json'))) if part_dir.exists() else 0; expected=len(ac_idx.get('parts',[])); 
 if file_count!=expected: problems.append((n, expected, file_count))
print(problems if problems else 'ac/part consistency OK')"
```

#### D. Git commands

Commit commands:

```bash
git checkout schema-v2-migration
git pull --ff-only origin schema-v2-migration
git add data/districts/BANGALORE_URBAN data/master_index.json data/search docs/
git commit -m "data: add BANGALORE_URBAN schema 2.0 rollout"
```

Push command:

```bash
git push origin schema-v2-migration
```

Verification commands:

```bash
git status --short
git log --oneline -n 3
python packages/data-pipeline/scripts/validate_data.py .\data
npm run build
```

#### E. Operational runbook

Recommended overnight workflow:

1. start with the four-worker command
2. write stdout and stderr to a log file
3. checkpoint the start time
4. run the progress and records-count commands every 2 hours
5. keep failed PDF paths in `.\tmp\BANGALORE_URBAN_failed.txt`

Recommended pause/restart workflow:

1. stop active workers cleanly
2. run `show_pipeline_status.py` against the same staging SQLite
3. rerun the same directory ingestion command
4. rerun only failed PDFs if the failed list is non-empty

Recommended machine-restart recovery:

1. confirm `.\tmp\BANGALORE_URBAN.sqlite` still exists
2. reactivate the environment
3. run the progress command
4. rerun the resume command
5. regenerate staged JSON only after all intended PDFs are complete

### Status reporting cadence

During long Bangalore Urban runs, provide a summary every 2 hours containing:

- PDFs completed
- PDFs remaining
- voter rows extracted
- failed PDF count
- estimated completion time

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
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BBMP --db .\tmp\BBMP.sqlite --district BBMP --dpi 300 --workers 8
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
