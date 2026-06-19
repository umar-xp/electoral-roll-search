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
            "serial_no": "42",
            "voter_name": "ಮೊಹಮ್ಮದ್ ಶೋಯೆಬ್",
            "age": 35,
            "gender": "M",
            "voter_id": "123456",
        }
        errors = validate_voter_record(record)
        assert errors == []

    def test_missing_serial(self):
        record = {"voter_name": "ಮೊಹಮ್ಮದ್"}
        errors = validate_voter_record(record)
        assert any(e.field == "serial_no" for e in errors)

    def test_non_numeric_serial(self):
        record = {"serial_no": "abc", "voter_name": "ಟೆಸ್ಟ್"}
        errors = validate_voter_record(record)
        assert any(e.field == "serial_no" for e in errors)

    def test_missing_name_with_voter_id(self):
        """voter_id alone is a valid identifier."""
        record = {"serial_no": "1", "voter_id": "123456"}
        errors = validate_voter_record(record)
        assert not any(e.field == "voter_name" for e in errors)

    def test_age_out_of_range(self):
        record = {"serial_no": "1", "voter_name": "ಟೆಸ್ಟ್", "age": 150}
        errors = validate_voter_record(record)
        assert any(e.field == "age" for e in errors)

    def test_valid_age_boundaries(self):
        for age in [18, 65, 120]:
            record = {"serial_no": "1", "voter_name": "ಟೆಸ್ಟ್", "age": age}
            errors = validate_voter_record(record)
            assert not any(e.field == "age" for e in errors)

    def test_invalid_gender(self):
        record = {"serial_no": "1", "voter_name": "ಟೆಸ್ಟ್", "gender": "X"}
        errors = validate_voter_record(record)
        assert any(e.field == "gender" for e in errors)

    def test_valid_genders(self):
        for g in ["M", "F", "ಗಂ", "ಹೆಂ", ""]:
            record = {"serial_no": "1", "voter_name": "ಟೆಸ್ಟ್", "gender": g}
            errors = validate_voter_record(record)
            assert not any(e.field == "gender" for e in errors)

    def test_invalid_voter_id(self):
        record = {"serial_no": "1", "voter_name": "ಟೆಸ್ಟ್", "voter_id": "abc"}
        errors = validate_voter_record(record)
        assert any(e.field == "voter_id" for e in errors)


class TestPartFileValidation:
    def test_valid_part_file(self):
        data = {
            "voters": [
                {"serial_no": "1", "voter_name": "ಟೆಸ್ಟ್ ಹೆಸರು"},
                {"serial_no": "2", "voter_name": "ಇನ್ನೊಂದು ಹೆಸರು"},
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
            "districts": {
                "BAGALKOT": {"status": "live", "voter_count": 100000, "ac_count": 7}
            }
        }
        errors = validate_master_index(data)
        assert errors == []

    def test_missing_districts(self):
        errors = validate_master_index({})
        assert any(e.field == "districts" for e in errors)

    def test_missing_status(self):
        data = {"districts": {"TEST": {"voter_count": 100}}}
        errors = validate_master_index(data)
        assert any("status" in e.field for e in errors)


class TestDistrictIndexValidation:
    def test_valid_district_index(self):
        data = {
            "acs": [
                {"ac_num": 210, "part_count": 150}
            ]
        }
        errors = validate_district_index(data)
        assert errors == []

    def test_missing_acs(self):
        errors = validate_district_index({})
        assert any(e.field == "acs" for e in errors)
