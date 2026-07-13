"""
Schema Validation — Ensures data integrity between pipeline output and frontend.

Validates voter records and index files against expected schemas before
they are written to JSON. Prevents malformed data from reaching the frontend.
"""

from dataclasses import dataclass
from typing import List


@dataclass
class ValidationError:
    field: str
    message: str
    value: object = None


def validate_voter_record(record: dict) -> List[ValidationError]:
    """Validate a single Schema 2.0 voter record."""
    errors = []

    # sn: required, numeric int-like
    sn = record.get("sn")
    if sn is None or sn == "":
        errors.append(ValidationError("sn", "missing"))
    elif isinstance(sn, str) and not sn.isdigit():
        errors.append(ValidationError("sn", "not numeric", sn))
    elif not isinstance(sn, (int, str)):
        errors.append(ValidationError("sn", "must be int or numeric string", sn))

    # At least one name should be present
    name = record.get("vk") or record.get("vn") or ""
    if not name or len(name.strip()) < 2:
        vid = record.get("id", "")
        if not vid:
            errors.append(ValidationError("vk|vn", "missing or too short", name))

    # a: required, int or null
    if "a" not in record:
        errors.append(ValidationError("a", "missing"))
    age = record.get("a")
    if age is not None:
        try:
            age_int = int(age)
            if age_int < 18 or age_int > 120:
                errors.append(ValidationError("a", "out of range (18-120)", age_int))
        except (ValueError, TypeError):
            errors.append(ValidationError("a", "not a valid integer", age))

    # gender: optional, must be known value if present
    gender = record.get("g", "")
    valid_genders = {"M", "F", "ಗಂ", "ಹೆಂ", ""}
    if gender and gender not in valid_genders:
        errors.append(ValidationError("g", "unknown value", gender))

    # id: optional, 4-7 digits if present
    vid = record.get("id", "")
    if vid:
        if not isinstance(vid, str):
            vid = str(vid)
        digits_only = vid.replace(" ", "")
        if not digits_only.isdigit() or len(digits_only) < 4 or len(digits_only) > 7:
            errors.append(ValidationError("id", "invalid format (expected 4-7 digits)", vid))

    return errors


def validate_part_file(data: dict) -> List[ValidationError]:
    """Validate a part JSON file that the frontend will consume.

    Expected structure:
        {
            "voters": [...],
            "meta": {"ac_num": int, "part_num": int, ...}
        }
    """
    errors = []

    if not isinstance(data, dict):
        errors.append(ValidationError("root", "must be a dict"))
        return errors

    # Must have voters array
    voters = data.get("voters")
    if voters is None:
        errors.append(ValidationError("voters", "missing"))
    elif not isinstance(voters, list):
        errors.append(ValidationError("voters", "must be a list"))
    else:
        # Validate first N records as a sample (don't validate all 7M in CI)
        sample_size = min(len(voters), 50)
        for i in range(sample_size):
            record_errors = validate_voter_record(voters[i])
            for err in record_errors:
                errors.append(ValidationError(
                    f"voters[{i}].{err.field}", err.message, err.value
                ))

    # Meta is optional but if present, validate it
    meta = data.get("meta")
    if meta is not None:
        if not isinstance(meta, dict):
            errors.append(ValidationError("meta", "must be a dict"))
        else:
            if "ac_num" in meta and not isinstance(meta["ac_num"], int):
                errors.append(ValidationError("meta.ac_num", "must be int"))
            if "part_num" in meta and not isinstance(meta["part_num"], int):
                errors.append(ValidationError("meta.part_num", "must be int"))

    return errors


def validate_district_index(data: dict) -> List[ValidationError]:
    """Validate a district index.json file."""
    errors = []

    if not isinstance(data, dict):
        errors.append(ValidationError("root", "must be a dict"))
        return errors

    if "district" not in data:
        errors.append(ValidationError("district", "missing"))
    if "total_voters" not in data:
        errors.append(ValidationError("total_voters", "missing"))

    # Should have acs list
    acs = data.get("acs")
    if acs is None:
        errors.append(ValidationError("acs", "missing"))
    elif not isinstance(acs, list):
        errors.append(ValidationError("acs", "must be a list"))
    else:
        for i, ac in enumerate(acs):
            if not isinstance(ac, dict):
                errors.append(ValidationError(f"acs[{i}]", "must be a dict"))
                continue
            if "ac_num" not in ac:
                errors.append(ValidationError(f"acs[{i}].ac_num", "missing"))
            if "ac_name" not in ac:
                errors.append(ValidationError(f"acs[{i}].ac_name", "missing"))
            if "parts_count" not in ac and "part_count" not in ac:
                errors.append(ValidationError(f"acs[{i}]", "missing parts_count or part_count"))
            if "total_voters" not in ac and "voter_count" not in ac:
                errors.append(ValidationError(f"acs[{i}]", "missing total_voters or voter_count"))

    return errors


def validate_master_index(data: dict) -> List[ValidationError]:
    """Validate the master_index.json file."""
    errors = []

    if not isinstance(data, dict):
        errors.append(ValidationError("root", "must be a dict"))
        return errors

    for field in ("schema_version", "generated_at", "state", "stats", "districts"):
        if field not in data:
            errors.append(ValidationError(field, "missing"))

    stats = data.get("stats")
    if stats is not None:
        if not isinstance(stats, dict):
            errors.append(ValidationError("stats", "must be a dict"))
        else:
            if "total_voters" not in stats:
                errors.append(ValidationError("stats.total_voters", "missing"))
            if "district_count" not in stats:
                errors.append(ValidationError("stats.district_count", "missing"))

    districts = data.get("districts")
    if districts is None:
        errors.append(ValidationError("districts", "missing"))
    elif not isinstance(districts, list):
        errors.append(ValidationError("districts", "must be a list"))
    else:
        for i, district in enumerate(districts):
            if not isinstance(district, dict):
                errors.append(ValidationError(f"districts[{i}]", "must be a dict"))
                continue
            required_fields = ("district_code", "name", "display_name", "status", "voter_count", "ac_count")
            for field in required_fields:
                if field not in district:
                    errors.append(ValidationError(f"districts[{i}].{field}", "missing"))

    return errors
