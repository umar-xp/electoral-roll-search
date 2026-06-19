"""Quick test of improved OCR pipeline on 3 pages.

Author: Mohammed Shoaib U
Description: Fast validation script that processes 3 pages from a single
    PDF to verify pipeline improvements without running full extraction.

Requires: Tesseract OCR, test PDF files in project root.
Mark: integration (skipped in CI)
"""
import pytest
pytestmark = pytest.mark.integration

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'lib'))
import detect_table_ultimate as d  # noqa: E402
import time

pdf_path = 'A1160043.pdf'
print(f'PDF: {pdf_path}')

start = time.time()
all_voters = []
for pn in range(2, 5):  # pages 3-5 (0-indexed)
    voters, headers, boundaries = d.process_page(pdf_path, pn)
    all_voters.extend(voters)
    print(f'  Page {pn+1}: {len(voters)} voters')

elapsed = time.time() - start
print(f'\nTotal: {len(all_voters)} voters in {elapsed:.1f}s')

# Quality stats
vid_count = sum(1 for v in all_voters if v.get('voter_id'))
age_count = sum(1 for v in all_voters if v.get('age') and v['age'].isdigit() and int(v['age']) >= 18)
sn_count = sum(1 for v in all_voters if v.get('serial_no') and v['serial_no'].isdigit())
vid_repaired = sum(1 for v in all_voters if v.get('vid_repaired'))
sn_repaired = sum(1 for v in all_voters if v.get('serial_repaired'))

print(f'Serial numbers valid: {sn_count}/{len(all_voters)} ({100*sn_count/max(1,len(all_voters)):.1f}%)')
print(f'  - Serials repaired: {sn_repaired}')
print(f'Voter IDs captured: {vid_count}/{len(all_voters)} ({100*vid_count/max(1,len(all_voters)):.1f}%)')
print(f'  - IDs repaired via re-OCR: {vid_repaired}')
print(f'Ages valid: {age_count}/{len(all_voters)} ({100*age_count/max(1,len(all_voters)):.1f}%)')

# Serial continuity check
serial_numbers = [int(v['serial_no']) for v in all_voters if v.get('serial_no', '').isdigit()]
if serial_numbers:
    expected = list(range(serial_numbers[0], serial_numbers[0] + len(serial_numbers)))
    matches = sum(1 for a, b in zip(serial_numbers, expected) if a == b)
    print(f'Serial continuity: {matches}/{len(serial_numbers)} ({100*matches/len(serial_numbers):.1f}%)')

# Show sample voters
print('\n--- Sample voters ---')
for v in all_voters[:8]:
    name = v.get('voter_name', '?')
    if len(name) > 25:
        name = name[:25] + '...'
    print(f"  SN={v.get('serial_no','?'):>4} Name={name:<28} Age={v.get('age','?'):>3} VID={v.get('voter_id','?'):>6} G={v.get('gender','?')}")

# Show voter IDs specifically
print('\n--- Voter ID samples ---')
for v in all_voters[:15]:
    vid = v.get('voter_id', '')
    raw_vid = v.get('raw', {}).get('voter_id', '')
    repaired = 'R' if v.get('vid_repaired') else ' '
    print(f"  [{repaired}] raw='{raw_vid}' -> clean='{vid}'")
