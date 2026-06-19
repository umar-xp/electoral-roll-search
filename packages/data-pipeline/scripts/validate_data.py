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


REQUIRED_MASTER_KEYS = {"schema_version", "generated_at", "stats", "districts"}
REQUIRED_DISTRICT_KEYS = {"display_name", "status", "voter_count", "ac_count", "acs"}
REQUIRED_AC_KEYS = {"ac_num", "voter_count", "part_count"}
REQUIRED_VOTER_KEYS = {"vk"}  # At minimum, Kannada name must exist


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

    if "districts" in master:
        for key, dist in master["districts"].items():
            if not isinstance(dist, dict):
                errors.append(f"District '{key}' is not a dict")
                continue
            missing_d = REQUIRED_DISTRICT_KEYS - set(dist.keys())
            if missing_d:
                errors.append(f"District '{key}' missing keys: {missing_d}")

            for ac in dist.get("acs", []):
                missing_ac = REQUIRED_AC_KEYS - set(ac.keys())
                if missing_ac:
                    errors.append(f"District '{key}' AC missing keys: {missing_ac}")

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
            try:
                with open(dist_index, "r", encoding="utf-8") as f:
                    json.load(f)
                files_checked += 1
            except json.JSONDecodeError as e:
                all_errors.append(f"INVALID JSON: {dist_index}: {e}")

        # Check AC index files
        for ac_index in sorted(district_dir.glob("*_index.json")):
            try:
                with open(ac_index, "r", encoding="utf-8") as f:
                    ac_data = json.load(f)
                files_checked += 1

                if "parts" not in ac_data:
                    all_errors.append(f"Missing 'parts' in {ac_index}")
            except json.JSONDecodeError as e:
                all_errors.append(f"INVALID JSON: {ac_index}: {e}")

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
