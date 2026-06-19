"""
Fix garbage records by re-examining source PDF pages.
Step 1: Identify all garbage records and their source pages.
Step 2: Render those pages to images for inspection.
Step 3: Re-OCR with enhanced settings.
"""
import sqlite3
import re
import os
import sys
from collections import defaultdict

DB_PATH = "data/rolls.sqlite"
GARBAGE_CHARS = re.compile(r'[!@#$%^&*()=+\[\]{}<>\\|;:"\',?/~`]')

def get_garbage_records():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    cursor = conn.execute('''
        SELECT id, pdf_file, page_num, serial_no, voter_name_kn, voter_name_en, 
               age, gender, ac_num, part_num, house_no, relative_name_kn, voter_id
        FROM voters
    ''')
    
    garbage = []
    for row in cursor.fetchall():
        r = dict(row)
        kn = r['voter_name_kn'] or ''
        en = r['voter_name_en'] or ''
        hits = len(GARBAGE_CHARS.findall(kn)) + len(GARBAGE_CHARS.findall(en))
        # Flag as garbage if: 3+ special chars OR empty name
        if hits >= 3 or kn.strip() == '':
            garbage.append(r)
    
    conn.close()
    return garbage

def find_pdf_path(pdf_file, ac_num):
    """Find the full path to a PDF file."""
    base = "data/MYSORE"
    for d in os.listdir(base):
        if d.startswith(f"AC {ac_num}"):
            path = os.path.join(base, d, pdf_file)
            if os.path.exists(path):
                return path
    return None

def render_page_to_image(pdf_path, page_num, output_path, dpi=300):
    """Render a specific page of a PDF to an image."""
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    # page_num in DB is 1-based
    page = doc[page_num - 1]
    mat = fitz.Matrix(dpi/72, dpi/72)
    pix = page.get_pixmap(matrix=mat)
    pix.save(output_path)
    doc.close()
    return output_path

if __name__ == "__main__":
    garbage = get_garbage_records()
    print(f"Total garbage records: {len(garbage)}")
    
    # Group by PDF+page
    pages = defaultdict(list)
    for g in garbage:
        key = (g['pdf_file'], g['page_num'], g['ac_num'])
        pages[key].append(g)
    
    print(f"Unique pages to re-examine: {len(pages)}")
    
    # Show distribution
    sizes = sorted([len(v) for v in pages.values()], reverse=True)
    print(f"Records per page: max={sizes[0]}, median={sizes[len(sizes)//2]}, min={sizes[-1]}")
    print()
    
    # Show top pages with most garbage
    print("Top pages with most garbage records:")
    for (pdf, pg, ac), records in sorted(pages.items(), key=lambda x: -len(x[1]))[:15]:
        pdf_path = find_pdf_path(pdf, ac)
        exists = "✓" if pdf_path else "✗"
        print(f"  {exists} {pdf} page {pg} (AC {ac}): {len(records)} records")
        for r in records[:3]:
            print(f"      serial={r['serial_no']} name=\"{r['voter_name_kn'][:40]}\" age={r['age']}")
    
    # Render first few pages as test
    if "--render" in sys.argv:
        os.makedirs("scripts/garbage_pages", exist_ok=True)
        count = 0
        for (pdf, pg, ac), records in sorted(pages.items(), key=lambda x: -len(x[1]))[:5]:
            pdf_path = find_pdf_path(pdf, ac)
            if pdf_path:
                out = f"scripts/garbage_pages/{pdf}_page{pg}.png"
                render_page_to_image(pdf_path, pg, out)
                print(f"Rendered: {out}")
                count += 1
        print(f"\nRendered {count} pages to scripts/garbage_pages/")
