"""
Centralized Configuration for Electoral Roll OCR Pipeline
==========================================================

All configuration values live here. Machine-specific paths are loaded
from environment variables or .env file. No more hard-coded paths.

Usage:
    from config.settings import settings
    
    pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
    os.environ["TESSDATA_PREFIX"] = settings.TESSDATA_DIR
"""

import os
import platform
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Tuple

# Load .env file if python-dotenv is installed
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
    load_dotenv(_env_path)
except ImportError:
    pass


@dataclass(frozen=True)
class OCRSettings:
    """OCR engine configuration."""
    
    # Tesseract paths (from environment or platform defaults)
    TESSERACT_CMD: str = field(default_factory=lambda: os.getenv(
        "TESSERACT_CMD",
        _default_tesseract_cmd()
    ))
    TESSDATA_DIR: str = field(default_factory=lambda: os.getenv(
        "TESSDATA_PREFIX",
        _default_tessdata_dir()
    ))
    
    # Use tessdata_best models if available (higher accuracy, slower)
    USE_BEST_MODELS: bool = field(default_factory=lambda: os.getenv(
        "OCR_USE_BEST", "true"
    ).lower() in ("true", "1", "yes"))
    
    # Rendering DPI
    DPI: int = 300
    DPI_HIGH: int = 600
    
    @property
    def LANG(self) -> str:
        """Get the language string for Tesseract based on available models."""
        tessdata_path = Path(self.TESSDATA_DIR) if self.TESSDATA_DIR else None
        if self.USE_BEST_MODELS and tessdata_path:
            kan_best = tessdata_path / "kan_best.traineddata"
            eng_best = tessdata_path / "eng_best.traineddata"
            if kan_best.exists() and eng_best.exists():
                return "kan_best+eng_best"
            elif kan_best.exists():
                return "kan_best+eng"
        return "kan+eng"
    
    # Column zones at 300 DPI (name, x_start, x_end in pixels)
    # Calibrated from Karnataka electoral roll PDF layout
    COLUMN_ZONES: List[Tuple[str, int, int]] = field(default_factory=lambda: [
        ("serial_no",       0,   250),
        ("house_no",      250,   520),
        ("voter_name",    520,   960),
        ("relation",      960,  1160),
        ("relative_name", 1160, 1700),
        ("gender",        1700, 1860),
        ("age",           1860, 2020),
        ("voter_id",      2020, 2475),
    ])
    
    @property
    def COLUMN_ZONES_HIGH(self) -> List[Tuple[str, int, int]]:
        """Column zones at 600 DPI (2x multiplier)."""
        return [(name, x * 2, xend * 2) for name, x, xend in self.COLUMN_ZONES]


@dataclass(frozen=True)
class PipelineSettings:
    """Data pipeline configuration."""
    
    PROJECT_ROOT: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent.parent)
    
    @property
    def DATA_DIR(self) -> Path:
        return self.PROJECT_ROOT / "data"
    
    @property
    def OUTPUT_DIR(self) -> Path:
        path = self.PROJECT_ROOT / "ocr_benchmark" / "table_detection"
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    @property
    def DB_PATH(self) -> Path:
        return self.PROJECT_ROOT / "data" / "rolls.sqlite"
    
    @property
    def LIB_DIR(self) -> Path:
        return self.PROJECT_ROOT / "packages" / "data-pipeline" / "lib"


@dataclass(frozen=True)
class SearchSettings:
    """Frontend search defaults."""
    
    LRU_CACHE_MAX_SIZE: int = 200
    SEARCH_TIMEOUT_MS: int = 60000
    WORKER_THRESHOLD: int = 5000
    BATCH_SIZE: int = 5
    MAX_RESULTS: int = 200


def _ensure_tesseract_on_path():
    """Add Tesseract directory to PATH if not already present (Windows)."""
    if platform.system() != "Windows":
        return
    tesseract_dir = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR"
    if tesseract_dir.exists():
        path_dirs = os.environ.get("PATH", "").split(os.pathsep)
        tesseract_str = str(tesseract_dir)
        if tesseract_str not in path_dirs:
            os.environ["PATH"] = tesseract_str + os.pathsep + os.environ.get("PATH", "")


def _default_tesseract_cmd() -> str:
    """Platform-specific default Tesseract path."""
    if platform.system() == "Windows":
        _ensure_tesseract_on_path()
        candidates = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe",
            Path("C:/Program Files/Tesseract-OCR/tesseract.exe"),
            Path("C:/Program Files (x86)/Tesseract-OCR/tesseract.exe"),
        ]
        for p in candidates:
            if p.exists():
                return str(p)
        return "tesseract"  # Fallback: assume on PATH
    elif platform.system() == "Darwin":
        return "/opt/homebrew/bin/tesseract"
    else:
        return "tesseract"  # Linux: usually on PATH


def _default_tessdata_dir() -> str:
    """Platform-specific default tessdata path."""
    if platform.system() == "Windows":
        candidates = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tessdata",
            Path("C:/Program Files/Tesseract-OCR/tessdata"),
        ]
        for p in candidates:
            if p.exists():
                return str(p)
        return ""
    elif platform.system() == "Darwin":
        return "/opt/homebrew/share/tessdata"
    else:
        return "/usr/share/tesseract-ocr/5/tessdata"


# Singleton instances
settings = PipelineSettings()
ocr_settings = OCRSettings()
search_settings = SearchSettings()
