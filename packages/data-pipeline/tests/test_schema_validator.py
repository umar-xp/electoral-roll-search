"""Tests for the schema validation module."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.schema_validator import (
    validate_voter_record,
    validate_part_file,
    validate_master_index,
    validate_district_index,
)


class TestVoterRecordValidation:
    def test_valid_record(self):
        record = {
            "sn": 42,
            "vk": "ಮೊಹಮ್ಮದ್ ಶೋಯೆಬ್",
            "a": 35,
            "g": "M",
            "id": "123456",
        }
        errors = validate_voter_record(record)
        assert errors == []

    def test_missing_serial(self):
        record = {"vk": "ಮೊಹಮ್ಮದ್", "a": 30}
        errors = validate_voter_record(record)
        assert any(e.field == "sn" for e in errors)

    def test_non_numeric_serial(self):
        record = {"sn": "abc", "vk": "ಟೆಸ್ಟ್", "a": 30}
        errors = validate_voter_record(record)
        assert any(e.field == "sn" for e in errors)

    def test_missing_name_with_voter_id(self):
        """id alone is a valid identifier."""
        record = {"sn": 1, "a": 35, "id": "123456"}
        errors = validate_voter_record(record)
        assert not any(e.field == "vk|vn" for e in errors)

    def test_age_out_of_range(self):
        record = {"sn": 1, "vk": "ಟೆಸ್ಟ್", "a": 150}
        errors = validate_voter_record(record)
        assert any(e.field == "a" for e in errors)

    def test_valid_age_boundaries(self):
        for age in [18, 65, 120]:
            record = {"sn": 1, "vk": "ಟೆಸ್ಟ್", "a": age}
            errors = validate_voter_record(record)
            assert not any(e.field == "a" for e in errors)

    def test_null_age_allowed(self):
        record = {"sn": 1, "vk": "ಟೆಸ್ಟ್", "a": None}
        errors = validate_voter_record(record)
        assert errors == []

    def test_invalid_gender(self):
        record = {"sn": 1, "vk": "ಟೆಸ್ಟ್", "a": 30, "g": "X"}
        errors = validate_voter_record(record)
        assert any(e.field == "g" for e in errors)

    def test_valid_genders(self):
        for g in ["M", "F", "ಗಂ", "ಹೆಂ", ""]:
            record = {"sn": 1, "vk": "ಟೆಸ್ಟ್", "a": 30, "g": g}
            errors = validate_voter_record(record)
            assert not any(e.field == "g" for e in errors)

    def test_invalid_voter_id(self):
        record = {"sn": 1, "vk": "ಟೆಸ್ಟ್", "a": 30, "id": "abc"}
        errors = validate_voter_record(record)
        assert any(e.field == "id" for e in errors)


class TestPartFileValidation:
    def test_valid_part_file(self):
        data = {
            "voters": [
                {"sn": 1, "vk": "ಟೆಸ್ಟ್ ಹೆಸರು", "a": 30, "g": "M"},
                {"sn": 2, "vn": "Another Name", "a": None, "g": "F"},
            ],
            "meta": {"ac_num": 210, "part_num": 1},
        }
        errors = validate_part_file(data)
        assert errors == []

    def test_missing_voters(self):
        data = {"meta": {"ac_num": 210}}
        errors = validate_part_file(data)
        assert any(e.field == "voters" for e in errors)

    def test_non_dict_root(self):
        errors = validate_part_file([])
        assert any(e.field == "root" for e in errors)


class TestMasterIndexValidation:
    def test_valid_master_index(self):
        data = {
            "schema_version": "2.0",
            "generated_at": "2026-06-20T00:00:00Z",
            "state": "KARNATAKA",
            "stats": {"total_voters": 100000, "district_count": 1},
            "districts": [
                {
                    "district_code": "BAGALKOT",
                    "name": "BAGALKOT",
                    "display_name": "Bagalkot",
                    "status": "live",
                    "voter_count": 100000,
                    "ac_count": 7,
                }
            ],
        }
        errors = validate_master_index(data)
        assert errors == []

    def test_missing_districts(self):
        errors = validate_master_index({})
        assert any(e.field == "districts" for e in errors)

    def test_missing_status(self):
        data = {
            "schema_version": "2.0",
            "generated_at": "2026-06-20T00:00:00Z",
            "state": "KARNATAKA",
            "stats": {"total_voters": 100, "district_count": 1},
            "districts": [{"district_code": "TEST", "name": "TEST", "display_name": "Test", "voter_count": 100, "ac_count": 1}],
        }
        errors = validate_master_index(data)
        assert any("status" in e.field for e in errors)


class TestDistrictIndexValidation:
    def test_valid_district_index(self):
        data = {
            "district": "BAGALKOT",
            "total_voters": 100000,
            "acs": [
                {"ac_num": 210, "ac_name": "AC-210", "total_voters": 14000, "parts_count": 150}
            ]
        }
        errors = validate_district_index(data)
        assert errors == []

    def test_missing_acs(self):
        errors = validate_district_index({})
        assert any(e.field == "acs" for e in errors)
