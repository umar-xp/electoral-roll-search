"""
Schema Validation — Ensures data integrity between pipeline output and frontend.

Validates voter records and index files against expected schemas before
they are written to JSON. Prevents malformed data from reaching the frontend.
"""

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class ValidationError:
    field: str
    message: str
    value: object = None


def validate_voter_record(record: dict) -> List[ValidationError]:
    """Validate a single voter record against the expected schema.

    Required fields: serial_no (int-like), voter_name (non-empty string)
    Optional fields: age, gender, voter_id, relative_name, relation, house_no

    Returns:
        List of validation errors (empty list = valid)
    """
    errors = []

    # serial_no: required, numeric string
    sn = record.get("serial_no")
    if sn is None or sn == "":
        errors.append(ValidationError("serial_no", "missing"))
    elif isinstance(sn, str) and not sn.isdigit():
        errors.append(ValidationError("serial_no", "not numeric", sn))

    # voter_name: required, non-empty
    name = record.get("voter_name") or record.get("voter_name_kn") or ""
    if not name or len(name.strip()) < 2:
        # Allow records with voter_id as alternate identifier
        vid = record.get("voter_id", "")
        if not vid:
            errors.append(ValidationError("voter_name", "missing or too short", name))

    # age: optional, 18-120 if present
    age = record.get("age")
    if age is not None and age != "" and age != -1:
        try:
            age_int = int(age)
            if age_int < 18 or age_int > 120:
                errors.append(ValidationError("age", f"out of range (18-120)", age_int))
        except (ValueError, TypeError):
            errors.append(ValidationError("age", "not a valid integer", age))

    # gender: optional, must be known value if present
    gender = record.get("gender", "")
    valid_genders = {"M", "F", "ಗಂ", "ಹೆಂ", ""}
    if gender and gender not in valid_genders:
        errors.append(ValidationError("gender", f"unknown value", gender))

    # voter_id: optional, 5-6 digits if present
    vid = record.get("voter_id", "")
    if vid:
        if not isinstance(vid, str):
            vid = str(vid)
        digits_only = vid.replace(" ", "")
        if not digits_only.isdigit() or len(digits_only) < 4 or len(digits_only) > 7:
            errors.append(ValidationError("voter_id", "invalid format (expected 4-7 digits)", vid))

    return errors


def validate_part_file(data: dict) -> List[ValidationError]:
    """Validate a part JSON file that the frontend will consume.

    Expected structure:
        {
            "voters": [...],
            "meta": {"ac_num": int, "part_num": int, "page_count": int, ...}
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
            if "parts" not in ac and "part_count" not in ac:
                errors.append(ValidationError(f"acs[{i}]", "missing parts or part_count"))

    return errors


def validate_master_index(data: dict) -> List[ValidationError]:
    """Validate the master_index.json file."""
    errors = []

    if not isinstance(data, dict):
        errors.append(ValidationError("root", "must be a dict"))
        return errors

    districts = data.get("districts")
    if districts is None:
        errors.append(ValidationError("districts", "missing"))
    elif not isinstance(districts, dict):
        errors.append(ValidationError("districts", "must be a dict"))
    else:
        for key, district in districts.items():
            if not isinstance(district, dict):
                errors.append(ValidationError(f"districts.{key}", "must be a dict"))
                continue
            if "status" not in district:
                errors.append(ValidationError(f"districts.{key}.status", "missing"))
            if "voter_count" not in district and "ac_count" not in district:
                errors.append(ValidationError(f"districts.{key}", "missing voter_count or ac_count"))

    return errors
