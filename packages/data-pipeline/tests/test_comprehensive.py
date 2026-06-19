"""Comprehensive accuracy test across all 3 test PDFs.

Author: Mohammed Shoaib U
Description: Runs the OCR pipeline on all 3 test PDFs and reports
    detailed accuracy metrics including serial continuity, voter ID
    capture rate, age validity, and name presence.

Requires: Tesseract OCR, test PDF files in project root.
Mark: integration (skipped in CI)
"""
import pytest
pytestmark = pytest.mark.integration

import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent.parent / 'lib'))

import detect_table_ultimate as d  # noqa: E402
import fitz
import time
import json

pdfs = ['A1160043.pdf', 'A1160061.pdf', 'A1160150.pdf']

overall_stats = {
    'total_voters': 0,
    'serial_valid': 0,
    'serial_repaired': 0,
    'vid_captured': 0,
    'vid_repaired': 0,
    'age_valid': 0,
    'age_repaired': 0,
    'name_present': 0,
    'gender_valid': 0,
    'serial_continuous': 0,
    'serial_total_for_continuity': 0,
    'total_pages': 0,
    'total_time': 0,
}

for pdf_path in pdfs:
    doc = fitz.open(pdf_path)
    num_pages = len(doc)
    doc.close()
    
    print(f"\n{'='*60}")
    print(f"PDF: {pdf_path} ({num_pages} pages)")
    print(f"{'='*60}")
    
    pdf_voters = []
    start = time.time()
    
    # Process all pages
    for pn in range(num_pages):
        voters, headers, boundaries = d.process_page(pdf_path, pn)
        if voters:
            pdf_voters.extend(voters)
            overall_stats['total_pages'] += 1
    
    elapsed = time.time() - start
    overall_stats['total_time'] += elapsed
    
    n = len(pdf_voters)
    overall_stats['total_voters'] += n
    
    if n == 0:
        print("  No voters extracted!")
        continue
    
    # Stats for this PDF
    sn_valid = sum(1 for v in pdf_voters if v.get('serial_no', '').isdigit())
    sn_repaired = sum(1 for v in pdf_voters if v.get('serial_repaired'))
    vid_cap = sum(1 for v in pdf_voters if v.get('voter_id'))
    vid_rep = sum(1 for v in pdf_voters if v.get('vid_repaired'))
    age_valid = sum(1 for v in pdf_voters if v.get('age', '').isdigit() and 18 <= int(v['age']) <= 120)
    age_rep = sum(1 for v in pdf_voters if v.get('age_repaired'))
    name_present = sum(1 for v in pdf_voters if v.get('voter_name') and len(v['voter_name']) >= 2)
    gender_valid = sum(1 for v in pdf_voters if v.get('gender') in ('ಗಂ', 'ಹೆಂ'))
    
    overall_stats['serial_valid'] += sn_valid
    overall_stats['serial_repaired'] += sn_repaired
    overall_stats['vid_captured'] += vid_cap
    overall_stats['vid_repaired'] += vid_rep
    overall_stats['age_valid'] += age_valid
    overall_stats['age_repaired'] += age_rep
    overall_stats['name_present'] += name_present
    overall_stats['gender_valid'] += gender_valid
    
    # Serial continuity (per page — restart each page)
    # Actually check full PDF continuity
    serial_numbers = [int(v['serial_no']) for v in pdf_voters if v.get('serial_no', '').isdigit()]
    if serial_numbers:
        # Check page-by-page continuity  
        page_start = 0
        continuous = 0
        total_check = 0
        # Simple: just check if sorted serials form a sequence within each "run"
        for i in range(1, len(serial_numbers)):
            total_check += 1
            if serial_numbers[i] == serial_numbers[i-1] + 1:
                continuous += 1
        overall_stats['serial_continuous'] += continuous
        overall_stats['serial_total_for_continuity'] += total_check
    
    # Average confidence
    all_confs = []
    for v in pdf_voters:
        conf_dict = v.get('conf', {})
        for key in ('voter_name', 'relative_name', 'age', 'voter_id'):
            c = conf_dict.get(key, 0)
            if c > 0:
                all_confs.append(c)
    avg_conf = sum(all_confs) / len(all_confs) if all_confs else 0
    
    print(f"  Voters: {n} | Time: {elapsed:.1f}s ({elapsed/max(1,n):.2f}s/voter)")
    print(f"  Serials valid: {sn_valid}/{n} ({100*sn_valid/n:.1f}%) | Repaired: {sn_repaired}")
    print(f"  Voter IDs: {vid_cap}/{n} ({100*vid_cap/n:.1f}%) | Repaired: {vid_rep}")
    print(f"  Ages valid: {age_valid}/{n} ({100*age_valid/n:.1f}%) | Repaired: {age_rep}")
    print(f"  Names present: {name_present}/{n} ({100*name_present/n:.1f}%)")
    print(f"  Gender valid: {gender_valid}/{n} ({100*gender_valid/n:.1f}%)")
    print(f"  Avg confidence: {avg_conf:.1f}")
    
    # Serial continuity for this PDF
    if serial_numbers and len(serial_numbers) > 1:
        cont_count = sum(1 for i in range(1, len(serial_numbers)) if serial_numbers[i] == serial_numbers[i-1] + 1)
        print(f"  Serial continuity: {cont_count}/{len(serial_numbers)-1} ({100*cont_count/(len(serial_numbers)-1):.1f}%)")

# Overall summary
print(f"\n{'='*60}")
print(f"OVERALL SUMMARY")
print(f"{'='*60}")
n = overall_stats['total_voters']
print(f"Total voters: {n}")
print(f"Total pages processed: {overall_stats['total_pages']}")
print(f"Total time: {overall_stats['total_time']:.1f}s ({overall_stats['total_time']/max(1,n):.2f}s/voter)")
print(f"")
print(f"Serial numbers valid: {overall_stats['serial_valid']}/{n} ({100*overall_stats['serial_valid']/max(1,n):.1f}%)")
print(f"  Repaired: {overall_stats['serial_repaired']}")
print(f"Voter IDs captured: {overall_stats['vid_captured']}/{n} ({100*overall_stats['vid_captured']/max(1,n):.1f}%)")
print(f"  Repaired: {overall_stats['vid_repaired']}")
print(f"Ages valid (18-120): {overall_stats['age_valid']}/{n} ({100*overall_stats['age_valid']/max(1,n):.1f}%)")
print(f"  Repaired: {overall_stats['age_repaired']}")
print(f"Names present: {overall_stats['name_present']}/{n} ({100*overall_stats['name_present']/max(1,n):.1f}%)")
print(f"Gender valid: {overall_stats['gender_valid']}/{n} ({100*overall_stats['gender_valid']/max(1,n):.1f}%)")
sc = overall_stats['serial_continuous']
st = overall_stats['serial_total_for_continuity']
print(f"Serial continuity: {sc}/{st} ({100*sc/max(1,st):.1f}%)")
