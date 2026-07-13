"""
Tests for the centralized configuration module.
"""
import os
import sys
import pytest
from pathlib import Path

# Add config to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import OCRSettings, PipelineSettings, SearchSettings, ocr_settings, settings


class TestOCRSettings:
    """Test OCR configuration loading."""
    
    def test_tesseract_cmd_not_empty(self):
        """TESSERACT_CMD should resolve to a non-empty string."""
        assert ocr_settings.TESSERACT_CMD
        assert len(ocr_settings.TESSERACT_CMD) > 0
    
    def test_tessdata_dir_not_empty(self):
        """TESSDATA_DIR should resolve to a non-empty string."""
        assert ocr_settings.TESSDATA_DIR
        assert len(ocr_settings.TESSDATA_DIR) > 0
    
    def test_dpi_values_sane(self):
        """DPI values should be reasonable (150-1200)."""
        assert 150 <= ocr_settings.DPI <= 1200
        assert 150 <= ocr_settings.DPI_HIGH <= 1200
        assert ocr_settings.DPI_HIGH > ocr_settings.DPI
    
    def test_column_zones_complete(self):
        """All 8 expected columns should be defined."""
        zone_names = [name for name, _, _ in ocr_settings.COLUMN_ZONES]
        assert len(zone_names) == 8
        assert "serial_no" in zone_names
        assert "voter_name" in zone_names
        assert "voter_id" in zone_names
        assert "age" in zone_names
        assert "gender" in zone_names
    
    def test_column_zones_non_overlapping(self):
        """Column zones should not overlap."""
        sorted_zones = sorted(ocr_settings.COLUMN_ZONES, key=lambda z: z[1])
        for i in range(len(sorted_zones) - 1):
            _, _, end = sorted_zones[i]
            _, start_next, _ = sorted_zones[i + 1]
            assert end <= start_next, f"Zone overlap: {sorted_zones[i]} and {sorted_zones[i+1]}"
    
    def test_column_zones_high_is_2x(self):
        """High-DPI zones should be exactly 2x the standard zones."""
        for (name, x, xend), (name_h, xh, xend_h) in zip(
            ocr_settings.COLUMN_ZONES, ocr_settings.COLUMN_ZONES_HIGH
        ):
            assert name == name_h
            assert xh == x * 2
            assert xend_h == xend * 2
    
    def test_env_override(self, monkeypatch):
        """Environment variables should override defaults."""
        monkeypatch.setenv("TESSERACT_CMD", "/custom/path/tesseract")
        monkeypatch.setenv("TESSDATA_PREFIX", "/custom/tessdata")
        
        fresh = OCRSettings()
        assert fresh.TESSERACT_CMD == "/custom/path/tesseract"
        assert fresh.TESSDATA_DIR == "/custom/tessdata"


class TestPipelineSettings:
    """Test pipeline path configuration."""
    
    def test_project_root_exists(self):
        """PROJECT_ROOT should point to an existing directory."""
        assert settings.PROJECT_ROOT.exists()
    
    def test_lib_dir_exists(self):
        """LIB_DIR should point to an existing directory."""
        assert settings.LIB_DIR.exists()
    
    def test_data_dir_path_sane(self):
        """DATA_DIR path should end with 'data'."""
        assert settings.DATA_DIR.name == "data"


class TestSearchSettings:
    """Test search configuration defaults."""
    
    def test_cache_size_positive(self):
        s = SearchSettings()
        assert s.LRU_CACHE_MAX_SIZE > 0
    
    def test_timeout_reasonable(self):
        s = SearchSettings()
        assert 10000 <= s.SEARCH_TIMEOUT_MS <= 300000
    
    def test_batch_size_positive(self):
        s = SearchSettings()
        assert s.BATCH_SIZE > 0
