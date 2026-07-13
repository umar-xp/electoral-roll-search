"""
Test configuration — controls which tests are collected.

Integration tests (requiring Tesseract/PDFs) are skipped unless
the INTEGRATION_TESTS environment variable is set.
"""
import os
import sys
from pathlib import Path

# Add lib/ and scripts/ directories to sys.path for imports
LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(SCRIPTS_DIR))

# Skip integration tests unless explicitly enabled
collect_ignore = []
if not os.environ.get("INTEGRATION_TESTS"):
    collect_ignore.extend([
        "test_comprehensive.py",
        "test_fixes.py",
        "test_improvements.py",
    ])
