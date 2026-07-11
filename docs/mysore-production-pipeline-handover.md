# Mysore Production Pipeline Handover

## Purpose

This handover documents:

- where the currently deployed Mysore dataset on `schema-v2-migration` came from
- which scripts and files produced the checked-in Mysore JSON hierarchy
- how the current production pipeline differs from the project's older pipeline
- the recommended production-safe pipeline for future districts, especially `BANGALORE_URBAN`
- the current production-branch and deployment assumptions provided in the June 2026 status update
- the living operational workflow to use for future district expansion

This audit is based on the current tree plus tracked git history only. It does not start district generation.

## Project Status Update (June 2026)

The following operator-provided status is now treated as the current working assumption for this handover and district-expansion planning:

- the live website has been switched to `schema-v2-migration`
- production is loading the Schema 2.0 implementation
- Mysore is visible and searchable on the live site
- `schema-v2-migration` is now the active production branch
- approved pushes to `schema-v2-migration` are treated as production-facing changes

This handover therefore treats:

- `schema-v2-migration` as the canonical production branch
- JSON as the authoritative production data format
- deployment artifacts as frontend files plus JSON shard data only

### Deployment artifact decision

For production deployment:

- JSON is the official production data format
- do not deploy SQLite databases
- do not deploy Parquet files
- keep SQLite limited to staging, OCR processing, validation support, and cumulative offline generation inputs
- keep Parquet limited to historical artifacts or offline analysis only

## Living Document Scope

This document is the living technical handover for the active production workflow and should be updated whenever any of the following change:

- deployment branch
- deployment target or hosting path
- OCR ingestion process
- JSON schema or directory contract
- validation gate
- district promotion workflow
- recovery or rollback procedures
- branch strategy for production releases

## Executive Summary

- The currently deployed Mysore dataset on `schema-v2-migration` is the Schema 2.0 JSON tree committed in `edc4fe1` (`feat: schema 2.0 migration and mysore pilot baseline`).
- The current deployed Mysore JSON matches the active `SQLite -> JSON` generator in `packages/data-pipeline/scripts/generate_json_index.py`.
- The current deployed Mysore JSON is not sourced from the older Parquet snapshot described by the historical `metadata.json`.
- The strongest evidence is a count mismatch:
  - current published `data/master_index.json` shows `MYSORE` with `1,792,223` voters
  - historical `metadata.json` records `MYSORE.parquet` with `1,421,982` voters
- The current production path is:
  - raw PDFs
  - OCR + repair + transliteration
  - SQLite `voters` table
  - Schema 2.0 JSON generation
  - district promotion
  - published `master_index.json` regeneration from cumulative SQLite
  - frontend deployment
- For future districts, the safest path is to keep Mysore as the reference implementation and continue using the isolated `SQLite -> staged JSON -> promote district -> regenerate published master` workflow.

## Current Mysore Artifact Lineage

### Checked-in production artifacts

The currently deployed Mysore tree on `schema-v2-migration` consists of:

- `data/master_index.json`
- `data/districts/MYSORE/index.json`
- `data/districts/MYSORE/*_index.json`
- `data/districts/MYSORE/<AC>/part_<PART>.json`

Observed current published values:

- `data/master_index.json`
  - `schema_version = 2.0`
  - `district_code = MYSORE`
  - `voter_count = 1792223`
  - `ac_count = 11`
- `data/districts/MYSORE/index.json`
  - `total_voters = 1792223`
  - `11` AC summaries
- filesystem counts under `data/districts/MYSORE`
  - `11` AC directories
  - `11` AC index files
  - `2162` `part_*.json` files

### Commit history for current Mysore release

Relevant history for the checked-in Mysore artifacts:

- `edc4fe1` `feat: schema 2.0 migration and mysore pilot baseline`
  - rewrote `data/master_index.json` to Schema 2.0
  - rewrote `data/districts/MYSORE/index.json` with normalized AC summary fields
  - updated generator, validators, frontend, and tests around the Mysore pilot baseline
- `4c62f7d9` `Integrate database search updates from contributor zip`
  - earlier Mysore JSON existed here in an older contract
  - `data/master_index.json` used the older lightweight object without `schema_version`
  - `data/districts/MYSORE/index.json` used `total_voters` and `parts_count` at the AC summary level

### Why the current Mysore deployment is not coming from the old Parquet flow

The repository still contains legacy metadata from the old Parquet-based workflow:

- `metadata.json`
  - records `MYSORE.parquet`
  - records `total_voters = 1421982`
  - records generation timestamp `2026-05-28`

That cannot be the source of the currently deployed Mysore JSON because the checked-in published Schema 2.0 files use:

- `MYSORE total_voters = 1792223`
- `generated_at = 2026-06-20T07:23:20.636608Z`

Conclusion:

- the current deployed Mysore JSON on `schema-v2-migration` was generated after the old Parquet snapshot
- it reflects a newer SQLite-backed generation pass committed in `edc4fe1`

## Exact Current Production Pipeline

### Active generation chain

The active checked-in production pipeline for Mysore is:

1. Raw district PDFs are processed by `packages/data-pipeline/scripts/ingest_rolls.py`
2. `ingest_rolls.py` calls `process_page()` from `packages/data-pipeline/lib/detect_table_ultimate.py`
3. `detect_table_ultimate.py` performs:
   - full-row OCR
   - targeted re-OCR
   - sequential repair
   - cross-field repair
4. `ingest_rolls.py` transliterates names and writes rows into SQLite table `voters`
5. `packages/data-pipeline/scripts/generate_json_index.py` reads the SQLite `voters` table and writes:
   - `data/master_index.json`
   - `data/districts/MYSORE/index.json`
   - `data/districts/MYSORE/*_index.json`
   - `data/districts/MYSORE/<AC>/part_<PART>.json`
6. The website serves those static JSON files directly

### Current pipeline classification

Based on the checked-in active scripts, the current production Mysore pipeline is:

- `OCR -> repair/transliteration -> SQLite -> JSON`

More precisely:

- not `OCR -> SQLite -> Parquet -> JSON`
- not `OCR -> SQLite -> correction -> JSON` as a separate tracked production stage
- yes `OCR -> multi-pass repair -> transliteration -> SQLite -> JSON`

The repair step is embedded inside the OCR/extraction pipeline before rows are written to SQLite.

## Scripts Used To Produce The Current Mysore JSON Tree

### Directly used for current checked-in Mysore data

- `packages/data-pipeline/scripts/ingest_rolls.py`
  - main entry for PDF ingestion
  - creates and fills the SQLite `voters` table
- `packages/data-pipeline/lib/detect_table_ultimate.py`
  - actual multi-pass OCR and repair engine used by `ingest_rolls.py`
- `packages/data-pipeline/scripts/generate_json_index.py`
  - generates all published Mysore JSON files from SQLite
- `packages/data-pipeline/scripts/validate_data.py`
  - validates the output contract expected by the site

### Used after promotion for operational release completeness

- `packages/data-pipeline/scripts/build_search_index.py`
- `packages/data-pipeline/scripts/build_token_index.py`

These are part of the documented rollout workflow, but the currently checked-out app can fall back without them because `app.js` initializes `IndexedSearchEngine` opportunistically and falls back to `VoterSearchEngine` if the index is absent.

### Present in repo but not evidenced as the source of current deployed Mysore JSON

- `packages/data-pipeline/scripts/convert_to_parquet.py`
  - historical Parquet export utility
  - not required by the current checked-in Schema 2.0 Mysore release path
- `packages/data-pipeline/scripts/pg_to_sqlite.py`
  - PostgreSQL export path that can emit SQLite + JSON
  - useful if PostgreSQL becomes the source of truth
  - not evidenced as the source of the currently checked-in Mysore deployment on this branch
- `repair_data.py` and `packages/data-pipeline/scripts/repair_data.py`
  - older repair tooling built around `voter_names` / `voter_names_clean`
  - not aligned with the active `voters`-table production path used by `ingest_rolls.py`

## Exact Output Mapping

### `data/districts/MYSORE/index.json`

Produced by:

- `packages/data-pipeline/scripts/generate_json_index.py`

Source query shape:

- grouped from SQLite table `voters`
- aggregated at district level

Fields generated:

- `district`
- `total_voters`
- `acs[]`
  - `ac_num`
  - `ac_name`
  - `voter_count`
  - `part_count`

### `data/districts/MYSORE/*_index.json`

Produced by:

- `packages/data-pipeline/scripts/generate_json_index.py`

Source query shape:

- grouped from SQLite table `voters`
- aggregated at AC level

Fields generated:

- `district`
- `ac_num`
- `ac_name`
- `ac_name_kn`
- `total_voters`
- `parts[]`
  - `part_num`
  - `voter_count`

### `data/districts/MYSORE/<AC>/part_<PART>.json`

Produced by:

- `packages/data-pipeline/scripts/generate_json_index.py`

Source query shape:

- per-part grouped voter rows from SQLite table `voters`

Fields generated:

- `meta`
  - `district`
  - `ac_num`
  - `ac_name`
  - `part_num`
  - `voter_count`
- `voters[]`
  - `sn`
  - `psn`
  - `vn`
  - `vk`
  - `rn`
  - `rk`
  - `rt`
  - `g`
  - `a`
  - `hn`
  - `id`
  - `pn`
  - `dq`
  - `cf`
  - `vt`
  - `rnt`

## Intermediate Files In The Current Production Flow

### Required intermediates

For the current production-safe workflow, the key intermediate files are:

- raw district PDFs under `.\data\<DISTRICT>` (for example: `.\data\MYSORE` or `.\data\BANGALORE_URBAN`)
- isolated staging SQLite file such as `.\tmp\MYSORE.sqlite`
- staged Schema 2.0 JSON output such as `.\tmp\schema2\MYSORE\`

### Published outputs

Published outputs are:

- `data/districts/<DISTRICT>/...`
- `data/master_index.json`

### Historical or legacy intermediates not required by current production path

- `metadata.json`
- `pipeline_state.json`
- `packages/data-pipeline/pipeline_state.json`
- Parquet outputs such as `MYSORE.parquet`

These files describe or support older workflows but are not required for the currently deployed Schema 2.0 Mysore website path.

## Historical Pipeline Versus Current Pipeline

### Historical tracked pipeline

The initial tracked pipeline in repo history was Parquet-centered:

1. OCR into SQLite
2. convert SQLite to Parquet
3. generate district JSON from Parquet-oriented workflow
4. maintain `metadata.json` and `pipeline_state.json`

Evidence:

- initial README in `76a09fa5` explicitly says the repository produces district-wise Parquet outputs
- old README instructs:
  - ingest into SQLite
  - convert SQLite to Parquet
  - generate JSON indexes after Parquet
- legacy `metadata.json` still records district `.parquet` artifacts and counts

### Current deployed `schema-v2-migration` pipeline

The current branch has moved to a SQLite-centered Schema 2.0 production flow:

1. OCR into isolated SQLite
2. generate staged Schema 2.0 JSON directly from SQLite
3. promote district files only
4. regenerate published `master_index.json` from cumulative SQLite
5. validate
6. deploy static files

Evidence:

- current `README.md`
- current `docs/DEPLOYMENT.md`
- current `docs/district-expansion-plan.md`
- current `generate_json_index.py`
- current `validate_data.py`
- current `data/master_index.json`

### Practical difference

Historical model:

- Parquet was treated as a major intermediate product
- `metadata.json` and `pipeline_state.json` tracked release progress
- older JSON contracts used fields like:
  - `total_voters`
  - `parts_count`
  - keyed or lighter master-index shapes

Current model:

- SQLite is the authoritative release input for JSON generation
- Schema 2.0 JSON is the deployment contract
- `master_index.json` is lightweight and regenerated from cumulative SQLite
- district and AC summaries use the current normalized field names expected by the branch

### Why SQLite was previously used

SQLite was previously useful because it provided:

- a checkpointed store during OCR extraction
- resumable ingestion by `pdf_file`
- structured aggregation by district, AC, and part
- quality review and validation queries before JSON publication
- a convenient cumulative source for regenerating published manifests

### Why Parquet was previously used

Parquet was previously used because it offered:

- compact analytical storage
- efficient partitioned offline queries
- metadata-friendly district snapshots
- a convenient export format during the earlier contributor workflow

### Why JSON is now sufficient for production

JSON is now sufficient for production because:

- the live frontend fetches JSON directly
- district, AC, and part JSON files already match the website's runtime contract
- the production site is static and does not query SQLite or Parquet at runtime
- shipping only JSON reduces ambiguity about which artifact is authoritative

### Performance implications

- SQLite remains useful offline for OCR ingestion, resumability, aggregation, and validation
- Parquet can still be efficient for offline analytics, but it is no longer needed for production publishing
- JSON remains the correct deployment format because the browser consumes it directly
- optional search indexes improve search speed, but the site remains functionally compatible with the JSON shard hierarchy alone

### Storage implications

- staging SQLite is smaller and easier to query than raw OCR logs for operational review
- Parquet is efficient for bulk archival analytics, but adds an extra artifact family to maintain
- JSON increases the number of deployed files, but keeps the production system simple and transparent

### Deployment implications

- a JSON-only deploy path reduces release complexity
- it avoids a second conversion layer between generation and runtime
- it makes validation and rollback file-oriented and easier to reason about

### Search-performance implications

- direct JSON shard loading remains the compatibility-critical path
- generated search indexes are still recommended for faster lookup and better scaling
- future districts should preserve the current JSON layout so both fallback search and indexed search remain compatible

### Recommended long-term architecture

Long term, the safest architecture is:

- OCR and repair into isolated staging SQLite
- validate and inspect staging SQLite
- generate Schema 2.0 JSON from staging SQLite
- promote district JSON only
- regenerate published `master_index.json` from cumulative offline SQLite
- optionally rebuild browser search indexes from published JSON
- deploy frontend plus JSON only

## Current Website Compatibility Requirements

### What the deployed site actually reads

The current checked-in frontend reads:

- `data/master_index.json`
- `data/districts/<district_code>/index.json`
- `data/districts/<district_code>/<ac_num>_index.json`
- `data/districts/<district_code>/<ac_num>/part_<part_num>.json`

Required compatibility rules for future districts:

- `master_index.json` must remain Schema 2.0 with:
  - `schema_version`
  - `generated_at`
  - `state`
  - `stats.total_voters`
  - `stats.district_count`
  - `districts[]`
- each district object must include:
  - `district_code`
  - `name`
  - `display_name`
  - `status`
  - `voter_count`
  - `ac_count`
- district folders must be located under:
  - `data/districts/<DISTRICT_CODE>/`
- district index files must contain:
  - `district`
  - `total_voters`
  - `acs[]`
- AC summaries must keep:
  - `voter_count`
  - `part_count`
- AC index files must contain:
  - `parts[]`
  - each part with `part_num` and `voter_count`
- part files must contain:
  - `voters[]`
  - age field `a` present as integer or `null`

### Search-index compatibility

- `apps/web/indexed-search.js` still exists and is loaded by `index.html`
- however `app.js` wraps it in a try/catch and explicitly falls back when the index is unavailable
- the repo currently has no checked-in `data/search/` or `data/search_index/` artifacts

Implication:

- future district outputs remain website-compatible as long as the JSON shard hierarchy and Schema 2.0 fields stay correct
- rebuilding search indexes remains recommended for performance and future-proofing
- but the JSON shard hierarchy is the compatibility-critical contract today

## Bangalore Urban: Exact Recommended Production Commands

Do not start generation until the staging source PDFs are ready and the operator confirms the isolated output path.

### 1. OCR into isolated staging SQLite

```powershell
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\BANGALORE_URBAN --db .\tmp\BANGALORE_URBAN.sqlite --district BANGALORE_URBAN --dpi 300 --workers 6
```

### 2. Inspect OCR/QC status

```powershell
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\BANGALORE_URBAN.sqlite
```

### 3. Generate Schema 2.0 JSON into staging

```powershell
python packages/data-pipeline/scripts/generate_json_index.py --db .\tmp\BANGALORE_URBAN.sqlite --out .\tmp\schema2\BANGALORE_URBAN
```

### 4. Validate staged output

```powershell
python packages/data-pipeline/scripts/validate_data.py .\tmp\schema2\BANGALORE_URBAN
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
```

### 5. Promote district files only

```powershell
Copy-Item -Recurse -Force .\tmp\schema2\BANGALORE_URBAN\districts\BANGALORE_URBAN .\data\districts\
```

### 6. Regenerate the published master manifest from cumulative SQLite

```powershell
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
```

### 7. Rebuild optional search artifacts

```powershell
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

### 8. Validate published data

```powershell
python packages/data-pipeline/scripts/validate_data.py .\data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
npx playwright test tests/e2e/search.spec.ts --project=chromium -g "master_index.json loads and populates districts|selecting district loads AC dropdown|global search searches across all districts"
```

### 9. Build frontend for deployment verification

```powershell
npm run build
```

## Branch Strategy Going Forward

Based on the June 2026 status update, use the following branch rules unless explicitly changed later:

- commit and push future district work to `schema-v2-migration`
- do not treat `main` as the active development target
- treat `schema-v2-migration` as the production branch
- assume any approved push to `schema-v2-migration` can become part of the live site after deployment completes

## Production Deployment Architecture

Under the current working assumption, production consists of:

- branch: `schema-v2-migration`
- deployable assets:
  - frontend files under `apps/web/`
  - published JSON under `data/`
- authoritative runtime data source:
  - JSON only

Operational consequence:

- staging SQLite may still be created during OCR and generation
- but deployment should ship JSON outputs, not SQLite or Parquet artifacts

## District Expansion Workflow

For every future district, including `BANGALORE_URBAN`, follow this exact sequence:

1. analyze the source PDFs and target district directory layout
2. ingest into an isolated staging SQLite
3. monitor progress and resume until all target PDFs are processed
4. generate staged Schema 2.0 JSON
5. validate staged JSON and run consistency checks
6. promote district files only
7. regenerate published `master_index.json` from cumulative SQLite
8. rebuild search indexes if required for performance
9. validate published data and run browser smoke tests
10. commit and push to `schema-v2-migration` only after approval

## Recovery Procedures

### Resume after interruption

- rerun the same `ingest_rolls.py --dir ... --db ... --district ...` command
- `ingest_rolls.py` skips PDFs already present in the SQLite `voters` table by `pdf_file`

### Machine restart recovery

- reactivate the Python environment
- confirm the staging SQLite still exists
- run `show_pipeline_status.py` against the staging SQLite
- rerun the same district ingestion command
- continue only after confirming records are still being appended for missing PDFs

### Single-PDF recovery

- rerun a specific PDF with `--pdf <path-to-pdf>`
- keep the same staging SQLite and district name
- use this for one failed part or one interrupted file

## Validation Workflow

Before any district commit:

- validate staged JSON
- validate published JSON after promotion
- check for duplicates
- check for missing required fields
- compare AC and part counts between staged source and generated output
- run Python regression tests
- run targeted browser checks

## Git Workflow

For approved district promotions:

1. review staged and published JSON diffs
2. stage only the intended district data and any regenerated published manifests or search artifacts
3. commit to `schema-v2-migration`
4. push `schema-v2-migration`
5. verify the production deployment after cache refresh

## Status Reporting

During long-running district ingestion, report at least every 2 hours:

- parts completed
- parts remaining
- records generated
- failed PDFs or failed reruns
- estimated completion time

Recommended status summary format:

- district
- started_at
- PDFs completed / total PDFs
- voters extracted so far
- failed PDF list
- estimated hours remaining

## Recommendation For All Future Districts

Use this as the standard production pipeline:

1. Keep raw PDFs and district staging isolated
2. Ingest each district into its own staging SQLite
3. Generate district JSON from staging SQLite directly
4. Validate staged JSON before any promotion
5. Promote only the district directory into `data/districts/`
6. Regenerate the published `master_index.json` from the cumulative release SQLite
7. Rebuild search indexes
8. Validate published data and run targeted browser checks
9. Deploy only after the published dataset passes validation

### Do

- treat Mysore Schema 2.0 output as the reference artifact shape
- keep `district_code` equal to the directory key used in URLs
- keep age field `a` present in every voter record
- keep district and AC summary field names aligned with current frontend expectations
- regenerate `data/master_index.json` from cumulative SQLite only

### Do not

- do not reuse the old Parquet-first process as the production release path
- do not publish a district-isolated `master_index.json`
- do not rely on legacy `metadata.json` or `pipeline_state.json` as release truth
- do not introduce new field names that the current site does not read

## Final Recommendation

For `BANGALORE_URBAN` and every future district, the production-safe path is:

- `OCR -> multi-pass repair/transliteration -> isolated SQLite -> staged Schema 2.0 JSON -> district promotion -> published master regeneration from cumulative SQLite -> validation -> deploy`

That path preserves compatibility with the currently deployed website contract on `votersearch2002.com` and matches the active Schema 2.0 implementation now checked into `schema-v2-migration`.
