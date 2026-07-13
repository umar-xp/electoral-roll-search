"""Test script for validating OCR pipeline fixes.
Author: Mohammed Shoaib U

Requires: Tesseract OCR, test PDF files in project root.
Mark: integration (skipped in CI)
"""
import pytest
pytestmark = pytest.mark.integration

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'lib'))
from detect_table_ultimate import process_page

# Test the pages that still classify as 'voter' but had failures
test_pages = [
    ('A1160043.pdf', 31),  # DB pg 32 - 25 failures before
    ('A1160043.pdf', 24),  # DB pg 25 - 4 failures before
    ('A1160043.pdf', 25),  # DB pg 26 - 3 failures before
    ('A1160043.pdf', 30),  # DB pg 31 - 2 failures before (garbled)
    ('A1160061.pdf', 16),  # DB pg 17 - 4 failures (revision page masquerading as voter)
    ('A1160150.pdf', 10),  # DB pg 11 - 1 failure
]

for pdf, page_idx in test_pages:
    voters, headers, boundaries = process_page(pdf, page_idx)
    valid = sum(1 for v in voters if v.get('valid'))
    invalid = sum(1 for v in voters if not v.get('valid'))
    print(f'\n{pdf} page {page_idx} (DB pg {page_idx+1}): {len(voters)} voters, {valid} valid, {invalid} invalid')
    for v in voters:
        if not v.get('valid'):
            sn = v.get("serial_no", "")
            name = v.get("voter_name", "")[:30]
            issues = v.get("issues", [])
            conf = v.get("conf", {})
            avg_c = sum(c for c in conf.values() if c > 0) / max(len([c for c in conf.values() if c > 0]), 1)
            print(f'  FAIL: sn={sn} name="{name}" avg_conf={avg_c:.0f} issues={issues}')
