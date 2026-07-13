"""Cross-verify extracted names against PDF source"""
import sys
sys.path.insert(0, 'packages/data-pipeline/lib')

import fitz  # PyMuPDF
import sqlite3

conn = sqlite3.connect('data/rolls.sqlite')
cur = conn.cursor()

# Pick 5 records with known part/page to verify against PDF
test_cases = [
    # (part_num, page_num, serial_no) - we'll look these up and check against PDF text
    (32, 18, 704),   # Chamegauda
    (78, 7, 245),    # Nagaraju
    (139, 6, 181),   # Chamdramma
    (104, 10, 390),  # Bi.parashivamurti
    (117, 13, 521),  # Jayamma
]

print('=== PDF CROSS-VERIFICATION ===')
print()

for part, page, serial in test_cases:
    # Get the DB record
    cur.execute('''SELECT voter_name_kn, voter_name_en, voter_id, age, gender, pdf_file 
        FROM voters WHERE ac_num=112 AND part_num=? AND page_num=? AND serial_no=?''',
        (part, page, serial))
    row = cur.fetchone()
    if not row:
        print(f'Part {part}, Page {page}, Serial {serial}: NOT FOUND IN DB')
        continue
    
    name_kn, name_en, vid, age, gender, pdf_file = row
    pdf_path = f'data/MYSORE/AC 112 - Bannur/{pdf_file}'
    
    print(f'Record: {name_kn} ({name_en}) | VID: {vid} | Age: {age} | Gender: {gender}')
    print(f'  Source: {pdf_file}, Page {page}')
    
    # Open PDF and extract text from the specific page
    try:
        doc = fitz.open(pdf_path)
        # PDF pages are 0-indexed, but we store 1-indexed page numbers
        # The first 2 pages are usually cover/summary, so actual data starts at page index 2
        # page_num in DB is relative to data pages
        page_idx = page + 1  # +1 for cover page offset (0-indexed)
        if page_idx < len(doc):
            pdf_page = doc[page_idx]
            text = pdf_page.get_text()
            
            # Check if the Kannada name appears in the page text
            if name_kn and name_kn in text:
                print(f'  ✓ Kannada name FOUND in PDF page')
            elif name_kn:
                # Try adjacent pages
                found_nearby = False
                for offset in [-1, 1, -2, 2]:
                    try_idx = page_idx + offset
                    if 0 <= try_idx < len(doc):
                        nearby_text = doc[try_idx].get_text()
                        if name_kn in nearby_text:
                            print(f'  ~ Kannada name found on nearby page (offset {offset})')
                            found_nearby = True
                            break
                if not found_nearby:
                    print(f'  ✗ Kannada name NOT found (may be OCR-extracted, not in text layer)')
            
            # Check voter ID
            if vid and str(vid) in text:
                print(f'  ✓ Voter ID FOUND in PDF page')
            elif vid:
                print(f'  ? Voter ID not in text layer (normal for scanned PDFs)')
        else:
            print(f'  ! Page index {page_idx} out of range (doc has {len(doc)} pages)')
        doc.close()
    except Exception as e:
        print(f'  ERROR: {e}')
    print()

conn.close()
