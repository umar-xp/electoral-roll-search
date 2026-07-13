# Schema 2.0

Schema 2.0 is the canonical persisted data contract for electoral roll search.
It replaces the older Schema 1.0 keyed-district master index with a lightweight
array-based master index and explicit district routing via `district_code`.

## Design Goals

- Keep `master_index.json` lightweight.
- Use `district_code` as the canonical district identifier for routing,
  lookups, and fetch paths.
- Treat `name` and `display_name` as presentation fields only.
- Keep district metadata in district index files.
- Keep AC metadata in AC index files.
- Preserve voter records in compact JSON form suitable for frontend loading and
  search indexing.

## Canonical Rules

- `schema_version` must be `"2.0"` in generated data artifacts.
- `districts` in `master_index.json` is an array, not a keyed object.
- `master_index.json` must not embed AC lists.
- District routes and fetch paths must use `district_code`.
- District index AC summaries use `voter_count` and `part_count`.
- Voter age field `a` must always exist and may be either:
  - integer
  - null

## master_index.json

Purpose: top-level manifest for the currently published dataset.

Example:

```json
{
  "schema_version": "2.0",
  "generated_at": "2026-06-20T07:23:20.636608Z",
  "state": "KARNATAKA",
  "stats": {
    "total_voters": 1792223,
    "district_count": 1
  },
  "districts": [
    {
      "district_code": "MYSORE",
      "name": "MYSORE",
      "display_name": "Mysore",
      "status": "live",
      "voter_count": 1792223,
      "ac_count": 11
    }
  ]
}
```

Fields:

- `schema_version`: string. Must be `"2.0"`.
- `generated_at`: string. UTC timestamp for the generation run.
- `state`: string. State identifier for the published dataset.
- `stats`: object. Aggregate dataset counts.
- `stats.total_voters`: integer. Sum of district voter totals.
- `stats.district_count`: integer. Number of district entries in `districts`.
- `districts`: array. List of published districts.
- `districts[].district_code`: string. Canonical district identifier used in
  routes, lookups, and file paths such as `data/districts/<district_code>/`.
- `districts[].name`: string. Source/system district name. Presentation only.
- `districts[].display_name`: string. UI-friendly district label.
- `districts[].status`: string. Publication status such as `live`.
- `districts[].voter_count`: integer. Total voters in the district.
- `districts[].ac_count`: integer. Number of ACs in the district.

Notes:

- `district_code` is the only identifier that should be used for fetch paths.
- `name` and `display_name` must not be used as route keys.
- AC metadata is intentionally excluded from `master_index.json`.

## District Index Schema

Path:

```text
data/districts/<district_code>/index.json
```

Purpose: district-level AC summary manifest used after district selection.

Example:

```json
{
  "district": "MYSORE",
  "total_voters": 1792223,
  "acs": [
    {
      "ac_num": 112,
      "ac_name": "AC-112",
      "voter_count": 136865,
      "part_count": 158
    }
  ]
}
```

Fields:

- `district`: string. District directory key. In current data this matches the
  district code used in the path.
- `total_voters`: integer. Total voters across all ACs in the district.
- `acs`: array. Summary list of assembly constituencies in the district.
- `acs[].ac_num`: integer. AC number.
- `acs[].ac_name`: string. AC label.
- `acs[].voter_count`: integer. Total voters in the AC.
- `acs[].part_count`: integer. Number of part files in the AC.

Canonical naming:

- Use `voter_count`, not `total_voters`, for AC summaries.
- Use `part_count`, not `parts_count`, for AC summaries.

## AC Index Schema

Path:

```text
data/districts/<district_code>/<ac_num>_index.json
```

Purpose: AC-level part manifest used after AC selection.

Example:

```json
{
  "district": "MYSORE",
  "ac_num": 112,
  "ac_name": "AC-112",
  "ac_name_kn": "AC-112",
  "total_voters": 136865,
  "parts": [
    {
      "part_num": 1,
      "voter_count": 897
    }
  ]
}
```

Fields:

- `district`: string. District directory key.
- `ac_num`: integer. AC number.
- `ac_name`: string. Primary AC name/label.
- `ac_name_kn`: string. Kannada AC label.
- `total_voters`: integer. Total voters in the AC.
- `parts`: array. List of part summaries.
- `parts[].part_num`: integer. Part number.
- `parts[].voter_count`: integer. Voter count in the part.

## Part File Schema

Path:

```text
data/districts/<district_code>/<ac_num>/part_<part_num>.json
```

Purpose: compact voter payload loaded by the frontend for search and results.

Example:

```json
{
  "meta": {
    "district": "MYSORE",
    "ac_num": 112,
    "ac_name": "AC-112",
    "part_num": 1,
    "voter_count": 897
  },
  "voters": [
    {
      "sn": 1,
      "psn": "1",
      "vn": "Siddegauda",
      "vk": "ಸಿದ್ದೇಗೌಡ",
      "rn": "Mallegiddegauda",
      "rk": "ಮಲ್ಲೇಗಿಡ್ಡೇಗೌಡ",
      "rt": "F",
      "g": "M",
      "a": 77,
      "hn": "1",
      "id": "389",
      "pn": 1,
      "dq": 2,
      "cf": 95.0,
      "vt": ["Siddegauda"],
      "rnt": ["Mallegiddegauda"]
    }
  ]
}
```

Fields:

- `meta`: object. Summary for the part payload.
- `meta.district`: string. District directory key.
- `meta.ac_num`: integer. AC number.
- `meta.ac_name`: string. AC label.
- `meta.part_num`: integer. Part number.
- `meta.voter_count`: integer. Number of voters in the file.
- `voters`: array. Voter records for the part.

## Voter Record Schema

Generator output always includes the compact voter keys listed below. Validation
enforces a stricter minimum on `sn`, `a`, and name presence.

Fields:

- `sn`: required. Integer serial number within the part.
- `psn`: required in generated output. String form of the serial number.
- `vn`: generated output field. English voter name; may be an empty string.
- `vk`: generated output field. Kannada voter name; may be an empty string.
- `rn`: generated output field. English relative name; may be an empty string.
- `rk`: generated output field. Kannada relative name; may be an empty string.
- `rt`: generated output field. Relation type code; may be an empty string.
- `g`: generated output field. Gender code such as `M`, `F`, or empty string.
- `a`: required. Age; must exist and may be integer or null.
- `hn`: generated output field. House number; may be an empty string.
- `id`: generated output field. Voter ID; may be a string or null.
- `pn`: generated output field. Part number.
- `dq`: generated output field. Data quality classification.
- `cf`: generated output field. Confidence score; may be numeric or null.
- `vt`: generated output field. English name search tokens as an array.
- `rnt`: generated output field. Relative-name search tokens as an array.

Required validation rules:

- `sn` must exist and be int-like.
- `a` must exist and be `int | null`.
- At least one of `vk` or `vn` should be usable, unless `id` is present.
- `g`, if present, must be a known gender code.
- `id`, if present, must be a 4-7 digit identifier.

Nullable fields:

- `a`
- `id`
- `cf`

Presentation and search helper fields:

- `name` and `display_name` are presentation fields at the district level.
- `vn`, `vk`, `rn`, `rk`, `vt`, and `rnt` support bilingual and relative-name
  search flows.

## Migration Notes

Schema 1.0 used a keyed-district structure in `master_index.json` and relied on
compatibility assumptions that mixed routing identity with presentation fields.
That created several problems:

- `master_index.json` was harder to evolve safely.
- Consumers had to special-case object-vs-array district shapes.
- Route and fetch logic could drift toward `name` instead of a stable ID.
- AC summary payloads used inconsistent field names across district indexes.

Schema 2.0 replaces Schema 1.0 to address those issues:

- `master_index.json` is now a lightweight manifest.
- Districts are persisted as an array.
- `district_code` is the canonical routing identifier.
- District index AC summaries use normalized `voter_count` and `part_count`.
- Voter age `a` is explicitly required and nullable.

The result is a smaller, clearer, and more stable contract for generators,
validators, frontend consumers, and search-index builders.
