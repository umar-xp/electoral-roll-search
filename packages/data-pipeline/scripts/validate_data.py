"""
Data Schema Validation — validates JSON shard structure before deployment.

Usage:
    python -m packages.data-pipeline.scripts.validate_data --data-dir ./data

Validates:
    - master_index.json schema
    - District index files
    - Part files (voter records)
"""

import json
import sys
from pathlib import Path
from typing import List, Tuple


REQUIRED_MASTER_KEYS = {"schema_version", "generated_at", "state", "stats", "districts"}
REQUIRED_MASTER_STATS_KEYS = {"total_voters", "district_count"}
REQUIRED_MASTER_DISTRICT_KEYS = {"district_code", "name", "display_name", "status", "voter_count", "ac_count"}
REQUIRED_DISTRICT_INDEX_KEYS = {"district", "total_voters", "acs"}
REQUIRED_DISTRICT_AC_KEYS = {"ac_num", "ac_name"}
REQUIRED_AC_INDEX_KEYS = {"district", "ac_num", "ac_name", "ac_name_kn", "total_voters", "parts"}
REQUIRED_PART_SUMMARY_KEYS = {"part_num", "voter_count"}


def validate_master_index(data_dir: Path) -> List[str]:
    """Validate master_index.json structure."""
    errors = []
    master_path = data_dir / "master_index.json"

    if not master_path.exists():
        return [f"MISSING: {master_path}"]

    try:
        with open(master_path, "r", encoding="utf-8") as f:
            master = json.load(f)
    except json.JSONDecodeError as e:
        return [f"INVALID JSON in {master_path}: {e}"]

    missing = REQUIRED_MASTER_KEYS - set(master.keys())
    if missing:
        errors.append(f"master_index.json missing keys: {missing}")

    stats = master.get("stats")
    if stats is None:
        errors.append("master_index.json missing stats")
    elif not isinstance(stats, dict):
        errors.append("master_index.json stats is not an object")
    else:
        missing_stats = REQUIRED_MASTER_STATS_KEYS - set(stats.keys())
        if missing_stats:
            errors.append(f"master_index.json stats missing keys: {missing_stats}")

    districts = master.get("districts")
    if districts is None:
        errors.append("master_index.json missing districts")
    elif not isinstance(districts, list):
        errors.append("master_index.json districts must be a list")
    else:
        for i, dist in enumerate(districts):
            if not isinstance(dist, dict):
                errors.append(f"District at index {i} is not a dict")
                continue
            missing_d = REQUIRED_MASTER_DISTRICT_KEYS - set(dist.keys())
            if missing_d:
                errors.append(f"District '{dist.get('district_code', i)}' missing keys: {missing_d}")

        if isinstance(stats, dict):
            if stats.get("district_count") != len(districts):
                errors.append(
                    f"master_index.json stats.district_count={stats.get('district_count')} "
                    f"does not match actual districts={len(districts)}"
                )
            total_voters = sum(
                dist.get("voter_count", 0)
                for dist in districts
                if isinstance(dist, dict) and isinstance(dist.get("voter_count"), int)
            )
            if stats.get("total_voters") != total_voters:
                errors.append(
                    f"master_index.json stats.total_voters={stats.get('total_voters')} "
                    f"does not match district total={total_voters}"
                )

    return errors


def validate_district_index_file(index_path: Path) -> List[str]:
    """Validate a district-level index.json file."""
    errors = []

    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return [f"INVALID JSON: {index_path}: {e}"]

    missing = REQUIRED_DISTRICT_INDEX_KEYS - set(data.keys())
    if missing:
        errors.append(f"{index_path} missing keys: {missing}")

    acs = data.get("acs")
    if not isinstance(acs, list):
        errors.append(f"{index_path} field 'acs' must be a list")
        return errors

    for i, ac in enumerate(acs):
        if not isinstance(ac, dict):
            errors.append(f"{index_path} acs[{i}] is not a dict")
            continue
        missing_ac = REQUIRED_DISTRICT_AC_KEYS - set(ac.keys())
        if missing_ac:
            errors.append(f"{index_path} acs[{i}] missing keys: {missing_ac}")
        if "total_voters" not in ac and "voter_count" not in ac:
            errors.append(f"{index_path} acs[{i}] missing total_voters or voter_count")
        if "parts_count" not in ac and "part_count" not in ac:
            errors.append(f"{index_path} acs[{i}] missing parts_count or part_count")

    return errors


def validate_ac_index_file(index_path: Path) -> List[str]:
    """Validate an AC-level *_index.json file."""
    errors = []

    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return [f"INVALID JSON: {index_path}: {e}"]

    missing = REQUIRED_AC_INDEX_KEYS - set(data.keys())
    if missing:
        errors.append(f"{index_path} missing keys: {missing}")

    parts = data.get("parts")
    if not isinstance(parts, list):
        errors.append(f"{index_path} field 'parts' must be a list")
        return errors

    for i, part in enumerate(parts):
        if not isinstance(part, dict):
            errors.append(f"{index_path} parts[{i}] is not a dict")
            continue
        missing_part = REQUIRED_PART_SUMMARY_KEYS - set(part.keys())
        if missing_part:
            errors.append(f"{index_path} parts[{i}] missing keys: {missing_part}")

    return errors


def validate_part_file(part_path: Path) -> List[str]:
    """Validate a single part JSON file."""
    errors = []

    try:
        with open(part_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return [f"INVALID JSON: {part_path}: {e}"]

    if "voters" not in data:
        return [f"Missing 'voters' key in {part_path}"]

    voters = data["voters"]
    if not isinstance(voters, list):
        return [f"'voters' is not a list in {part_path}"]

    for i, voter in enumerate(voters):
        if not isinstance(voter, dict):
            errors.append(f"{part_path} voter[{i}]: not a dict")
            continue
        if "a" not in voter:
            errors.append(f"{part_path} voter[{i}]: missing age field 'a'")
        elif voter["a"] is not None and not isinstance(voter["a"], int):
            errors.append(f"{part_path} voter[{i}]: age field 'a' must be int or null")
        if not voter.get("vk") and not voter.get("vn"):
            errors.append(f"{part_path} voter[{i}]: missing both vk and vn (name)")

    return errors


def validate_data_dir(data_dir: Path, sample_parts: int = 5) -> Tuple[int, List[str]]:
    """
    Validate the entire data directory structure.

    Args:
        data_dir: Path to data/ directory
        sample_parts: Number of part files to validate per AC (for speed)

    Returns:
        Tuple of (total_files_checked, errors_list)
    """
    all_errors = []
    files_checked = 0

    # Validate master index
    all_errors.extend(validate_master_index(data_dir))
    files_checked += 1

    # Validate district directories
    districts_dir = data_dir / "districts"
    if not districts_dir.exists():
        all_errors.append(f"MISSING: {districts_dir}")
        return files_checked, all_errors

    for district_dir in sorted(districts_dir.iterdir()):
        if not district_dir.is_dir():
            continue

        # Check district index
        dist_index = district_dir / "index.json"
        if dist_index.exists():
            all_errors.extend(validate_district_index_file(dist_index))
            files_checked += 1

        # Check AC index files
        for ac_index in sorted(district_dir.glob("*_index.json")):
            all_errors.extend(validate_ac_index_file(ac_index))
            files_checked += 1

        # Sample-validate part files
        for ac_dir in sorted(district_dir.iterdir()):
            if not ac_dir.is_dir():
                continue
            parts = sorted(ac_dir.glob("part_*.json"))
            for part_path in parts[:sample_parts]:
                errs = validate_part_file(part_path)
                all_errors.extend(errs)
                files_checked += 1

    return files_checked, all_errors


def main():
    data_dir = Path("./data")

    if len(sys.argv) > 1:
        data_dir = Path(sys.argv[1])

    if not data_dir.exists():
        print(f"ERROR: Data directory not found: {data_dir}")
        sys.exit(1)

    print(f"Validating data in: {data_dir}")
    files_checked, errors = validate_data_dir(data_dir)

    print(f"\nFiles checked: {files_checked}")

    if errors:
        print(f"\n{'='*60}")
        print(f"ERRORS FOUND: {len(errors)}")
        print(f"{'='*60}")
        for err in errors[:50]:
            print(f"  - {err}")
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more")
        sys.exit(1)
    else:
        print("\n✅ All data files valid.")
        sys.exit(0)


if __name__ == "__main__":
    main()
