"""Verify by re-running OCR on a specific page and comparing with DB"""
import sys
from pathlib import Path

# Match the import setup from ingest_rolls.py
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_PIPELINE = PROJECT_ROOT / "packages" / "data-pipeline"
LIB_DIR = DATA_PIPELINE / "lib"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(DATA_PIPELINE))

import sqlite3
from detect_table_ultimate import process_page

conn = sqlite3.connect('data/rolls.sqlite')
cur = conn.cursor()

# Verify Part 32, Page 5
pdf_path = 'data/MYSORE/AC 112 - Bannur/A1120032.pdf'
page_num = 5

print(f'=== RE-OCR VERIFICATION: A1120032.pdf, Page {page_num} ===')
print()

# Re-run OCR on this page
try:
    voters, headers, boundaries = process_page(pdf_path, page_num)
    print(f'OCR extracted {len(voters)} voters from this page')
    print()
    
    # Get DB records for this page
    cur.execute('''SELECT serial_no, voter_name_kn, voter_name_en, voter_id, age, gender 
        FROM voters WHERE ac_num=112 AND part_num=32 AND page_num=?
        ORDER BY serial_no''', (page_num + 1,))
    db_records = cur.fetchall()
    
    print(f'DB has {len(db_records)} records for this page')
    print()
    
    # Show first 5 from DB
    print('--- DB Records (first 5) ---')
    for row in db_records[:5]:
        print(f'  Serial {row[0]}: {row[1]} ({row[2]}) | VID: {row[3]} | Age: {row[4]} | {row[5]}')
    
    print()
    print('--- OCR Output (first 5) ---')
    for v in voters[:5]:
        name = v.get('name', v.get('voter_name', ''))
        vid = v.get('voter_id', v.get('epic_no', ''))
        age = v.get('age', '')
        gender = v.get('gender', '')
        serial = v.get('serial_no', v.get('sl_no', ''))
        print(f'  Serial {serial}: {name} | VID: {vid} | Age: {age} | {gender}')
    
    # Match rate
    print()
    print('--- Match Analysis ---')
    ocr_names = set()
    for v in voters:
        name = v.get('name', v.get('voter_name', ''))
        if name:
            ocr_names.add(name.strip())
    
    db_names = set()
    for row in db_records:
        if row[1]:
            db_names.add(row[1].strip())
    
    overlap = ocr_names & db_names
    print(f'  OCR names: {len(ocr_names)}')
    print(f'  DB names: {len(db_names)}')
    print(f'  Exact matches: {len(overlap)}')
    if db_names:
        print(f'  Match rate: {len(overlap)/len(db_names)*100:.1f}%')

except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()

conn.close()
