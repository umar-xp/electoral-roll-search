"""
Tests for the OCR pipeline configuration and column zone calibration.
Does NOT require Tesseract installed — tests only logic and structure.
"""
import os
import sys
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


class TestDetectTableStructure:
    """Test structural properties of the OCR pipeline module."""
    
    def test_module_imports_without_tesseract(self):
        """Module should import even if Tesseract isn't at the configured path."""
        # Just verify the config module loads cleanly
        sys.path.insert(0, str(PROJECT_ROOT / "packages" / "data-pipeline"))
        from config.settings import ocr_settings
        assert ocr_settings.COLUMN_ZONES is not None
    
    def test_column_zones_cover_full_page_width(self):
        """Column zones should span from 0 to ~2475px at 300 DPI."""
        sys.path.insert(0, str(PROJECT_ROOT / "packages" / "data-pipeline"))
        from config.settings import ocr_settings
        
        zones = ocr_settings.COLUMN_ZONES
        first_start = zones[0][1]
        last_end = zones[-1][2]
        
        assert first_start == 0, "First zone should start at x=0"
        assert last_end >= 2400, f"Last zone ends at {last_end}, should cover page width"
    
    def test_column_zones_ordered_left_to_right(self):
        """Zones should be ordered from left to right."""
        sys.path.insert(0, str(PROJECT_ROOT / "packages" / "data-pipeline"))
        from config.settings import ocr_settings
        
        zones = ocr_settings.COLUMN_ZONES
        for i in range(len(zones) - 1):
            _, _, end = zones[i]
            _, start_next, _ = zones[i + 1]
            assert start_next >= end, f"Zone {zones[i][0]} (end={end}) should come before {zones[i+1][0]} (start={start_next})"


class TestIngestRollsStructure:
    """Test ingest_rolls.py parsing logic (no PDF dependency)."""
    
    def test_pdf_filename_parsing_standard(self):
        """Standard electoral roll filenames should parse correctly."""
        sys.path.insert(0, str(PROJECT_ROOT / "packages" / "data-pipeline" / "scripts"))
        from ingest_rolls import parse_pdf_filename
        
        result = parse_pdf_filename("A1160043.pdf")
        assert result["ac_num"] == 116
        assert result["part_num"] == 43
    
    def test_pdf_filename_parsing_edge_cases(self):
        """Edge case filenames should not crash."""
        sys.path.insert(0, str(PROJECT_ROOT / "packages" / "data-pipeline" / "scripts"))
        from ingest_rolls import parse_pdf_filename
        
        # Non-matching format
        result = parse_pdf_filename("random.pdf")
        assert result["ac_num"] == 0
        assert result["part_num"] == 0
    
    def test_pdf_filename_parsing_boundaries(self):
        """Boundary AC/part numbers should parse correctly."""
        sys.path.insert(0, str(PROJECT_ROOT / "packages" / "data-pipeline" / "scripts"))
        from ingest_rolls import parse_pdf_filename
        
        # First AC, first part
        result = parse_pdf_filename("A0010001.pdf")
        assert result["ac_num"] == 1
        assert result["part_num"] == 1
        
        # High AC, high part
        result = parse_pdf_filename("A2160227.pdf")
        assert result["ac_num"] == 216
        assert result["part_num"] == 227


class TestDataIntegrity:
    """Test that generated data files have valid structure."""
    
    def test_master_index_schema(self):
        """master_index.json should have required fields."""
        master_path = PROJECT_ROOT / "data" / "master_index.json"
        if not master_path.exists():
            pytest.skip("data/master_index.json not found")
        
        with open(master_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        assert "schema_version" in data
        assert data["schema_version"] == "2.0"
        assert "stats" in data
        assert "districts" in data
        assert isinstance(data["districts"], list)
        assert data["stats"]["total_voters"] > 0
        assert data["stats"]["district_count"] > 0
        assert data["stats"]["district_count"] == len(data["districts"])

        district = data["districts"][0]
        assert "district_code" in district
        assert "display_name" in district
        assert "status" in district
        assert "voter_count" in district
        assert "ac_count" in district
        assert "acs" not in district
    
    def test_voter_record_schema(self):
        """Voter part files should have valid record structure."""
        # Find any part file
        part_files = list((PROJECT_ROOT / "data" / "districts").rglob("part_*.json"))
        if not part_files:
            pytest.skip("No part files found in data/districts/")
        
        with open(part_files[0], "r", encoding="utf-8") as f:
            data = json.load(f)
        
        assert "voters" in data or isinstance(data, list)
        voters = data.get("voters", data) if isinstance(data, dict) else data
        
        if voters:
            voter = voters[0]
            # Required fields
            assert "sn" in voter, "Missing serial number"
            assert "vn" in voter or "vk" in voter, "Missing voter name"
            assert "g" in voter, "Missing gender"
            assert "a" in voter, "Missing age"
            
            # Type checks
            assert isinstance(voter["sn"], int), "Serial number should be int"
            assert voter["a"] is None or isinstance(voter["a"], int), "Age should be int or null"
            assert voter["g"] in ("M", "F", None, ""), f"Invalid gender: {voter['g']}"
    
    def test_voter_ages_valid_range(self):
        """All voter ages should be between 18 and 120."""
        part_files = list((PROJECT_ROOT / "data" / "districts").rglob("part_1.json"))
        if not part_files:
            pytest.skip("No part files found")
        
        # Check first part file only (for speed)
        with open(part_files[0], "r", encoding="utf-8") as f:
            data = json.load(f)
        
        voters = data.get("voters", data) if isinstance(data, dict) else data
        for voter in voters:
            age = voter.get("a")
            if age is not None and age != 0:
                assert 18 <= age <= 120, f"Invalid age {age} for voter sn={voter.get('sn')}"
