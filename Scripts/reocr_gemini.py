"""
Gemini Vision Re-OCR — Fix Garbage Records
============================================
Sends PDF page images to Gemini Vision API to re-extract voter data
for records with garbage characters (OCR failures from Tesseract).

Targets ~65K records with garbage chars in names.

Usage:
    python scripts/reocr_gemini.py --dry-run          # Preview what would be fixed
    python scripts/reocr_gemini.py --limit=50         # Process 50 pages only
    python scripts/reocr_gemini.py --apply            # Apply fixes to DB
    python scripts/reocr_gemini.py --apply --ac=112   # Only Bannur

Requires:
    pip install google-genai Pillow PyMuPDF
    Set GEMINI_API_KEY environment variable
"""

import sqlite3
import re
import os
import sys
import json
import time
import fitz  # PyMuPDF
from pathlib import Path
from collections import defaultdict
from io import BytesIO

# --- Config ---
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "rolls.sqlite")
PDF_BASE = os.path.join(os.path.dirname(__file__), "..", "pdfs", "MYSORE")

GARBAGE_PATTERN = re.compile(r'[!@#$%^&*()=+\[\]{}<>\\|~`]')
MIN_GARBAGE_HITS = 2  # At least 2 garbage chars to qualify

# Gemini rate limits (free tier: 15 RPM, paid: 360 RPM)
REQUESTS_PER_MINUTE = 14  # Stay under limit
BATCH_DELAY = 60 / REQUESTS_PER_MINUTE

# AC number to folder name mapping
AC_FOLDERS = {
    112: "AC 112 - Bannur",
    113: "AC 113 - T.Narasipura",
    114: "AC 114 - Krishnaraja",
    115: "AC 115 - Chamaraja",
    116: "AC 116 - Narasimharaja",
    117: "AC 117 - Chamundeshwari",
    118: "AC 118 - Nanjangud",
    122: "AC 122 - Heggadadevankote",
    123: "AC 123 - Hunsur",
    124: "AC 124 - Krishnarajanagara",
    125: "AC 125 - Periyapatna",
}

EXTRACTION_PROMPT = """You are analyzing a page from an Indian electoral roll (voter list) PDF from Karnataka.
This is a structured table with voter information in Kannada and English.

For each voter entry visible on this page, extract the following fields:
- serial_no: The serial number (integer)
- house_no: House number (string, may contain letters)
- voter_name_kn: Voter's name in Kannada script
- voter_name_en: Voter's name transliterated/translated to English
- relative_name_kn: Father's/Husband's/Mother's name in Kannada
- relative_name_en: Father's/Husband's/Mother's name in English  
- relation_type: "F" for Father, "H" for Husband, "M" for Mother, "O" for Other
- gender: "M" for Male, "F" for Female
- age: Age as integer
- voter_id: EPIC voter ID (alphanumeric, usually starts with letters like WPR, BLR etc followed by digits)

Return a JSON array of objects. Only include entries where you can clearly read the data.
If a field is unclear, use empty string "" for text or null for numbers.
Do NOT guess or hallucinate — only extract what is actually visible.

Example output format:
[
  {"serial_no": 1, "house_no": "42", "voter_name_kn": "ರಾಮಯ್ಯ", "voter_name_en": "Ramaiah", "relative_name_kn": "ಕೃಷ್ಣಪ್ಪ", "relative_name_en": "Krishnappa", "relation_type": "F", "gender": "M", "age": 45, "voter_id": "WPR1234567"},
  ...
]"""


def get_garbage_records(ac_filter=None):
    """Get records with garbage characters in names."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    query = """
        SELECT id, pdf_file, ac_num, part_num, page_num, serial_no,
               voter_name_kn, voter_name_en, relative_name_kn, relative_name_en,
               voter_id, confidence, data_quality
        FROM voters 
        WHERE data_quality != 2
    """
    if ac_filter:
        query += f" AND ac_num = {int(ac_filter)}"
    
    cursor = conn.execute(query)
    garbage = []
    
    for row in cursor:
        r = dict(row)
        en = r['voter_name_en'] or ''
        kn = r['voter_name_kn'] or ''
        rel_en = r['relative_name_en'] or ''
        
        hits = len(GARBAGE_PATTERN.findall(en)) + len(GARBAGE_PATTERN.findall(kn))
        hits += len(GARBAGE_PATTERN.findall(rel_en))
        
        if hits >= MIN_GARBAGE_HITS or en.strip() == '' or len(en) <= 2:
            garbage.append(r)
    
    conn.close()
    return garbage


def find_pdf_path(pdf_file, ac_num):
    """Find PDF file path."""
    folder = AC_FOLDERS.get(ac_num)
    if not folder:
        return None
    path = os.path.join(PDF_BASE, folder, pdf_file)
    if os.path.exists(path):
        return path
    return None


def render_page_image(pdf_path, page_num, dpi=300):
    """Render a PDF page to PNG bytes."""
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]  # 1-based
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes('png')
    doc.close()
    return img_bytes


def call_gemini(image_bytes, prompt):
    """Call Gemini Vision API with an image and prompt."""
    from google import genai
    
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")
    
    client = genai.Client(api_key=api_key)
    
    # Upload image as inline data
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": __import__('base64').b64encode(image_bytes).decode()
                        }
                    }
                ]
            }
        ],
        config={
            "temperature": 0.1,
            "max_output_tokens": 8192,
        }
    )
    
    return response.text


def parse_gemini_response(response_text):
    """Parse JSON array from Gemini response."""
    # Strip markdown code fences if present
    text = response_text.strip()
    if text.startswith('```'):
        lines = text.split('\n')
        # Remove first and last lines (fences)
        lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        text = '\n'.join(lines)
    
    try:
        records = json.loads(text)
        if isinstance(records, list):
            return records
    except json.JSONDecodeError:
        # Try to find JSON array in the response
        match = re.search(r'\[[\s\S]*\]', text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    
    return []


def match_and_build_fixes(gemini_records, garbage_records):
    """Match Gemini results to garbage DB records by serial number."""
    fixes = []
    
    # Index gemini results by serial_no
    gemini_by_serial = {}
    for gr in gemini_records:
        sn = gr.get('serial_no')
        if sn is not None:
            gemini_by_serial[int(sn)] = gr
    
    for db_rec in garbage_records:
        sn = db_rec['serial_no']
        if sn and sn in gemini_by_serial:
            g = gemini_by_serial[sn]
            
            # Validate: new name should be clean (no garbage)
            new_name_en = g.get('voter_name_en', '')
            new_name_kn = g.get('voter_name_kn', '')
            
            if not new_name_en or len(new_name_en) < 2:
                continue
            
            # Check if the new name is actually cleaner
            old_garbage = len(GARBAGE_PATTERN.findall(db_rec['voter_name_en'] or ''))
            new_garbage = len(GARBAGE_PATTERN.findall(new_name_en))
            
            if new_garbage >= old_garbage:
                continue  # New version isn't better
            
            fix = {
                'id': db_rec['id'],
                'voter_name_kn': new_name_kn or db_rec['voter_name_kn'],
                'voter_name_en': new_name_en,
                'relative_name_kn': g.get('relative_name_kn', '') or db_rec['relative_name_kn'] or '',
                'relative_name_en': g.get('relative_name_en', '') or db_rec['relative_name_en'] or '',
                'relation_type': g.get('relation_type', '') or '',
                'gender': g.get('gender', '') or '',
                'age': g.get('age'),
                'house_no': g.get('house_no', '') or '',
                'voter_id': g.get('voter_id', '') or '',
            }
            fixes.append(fix)
    
    return fixes


def apply_fixes(fixes):
    """Write fixes to database."""
    conn = sqlite3.connect(DB_PATH)
    updated = 0
    
    for fix in fixes:
        conn.execute('''
            UPDATE voters SET
                voter_name_kn = ?,
                voter_name_en = ?,
                relative_name_kn = CASE WHEN ? != '' THEN ? ELSE relative_name_kn END,
                relative_name_en = CASE WHEN ? != '' THEN ? ELSE relative_name_en END,
                relation_type = CASE WHEN ? != '' THEN ? ELSE relation_type END,
                gender = CASE WHEN ? != '' THEN ? ELSE gender END,
                age = CASE WHEN ? IS NOT NULL THEN ? ELSE age END,
                house_no = CASE WHEN ? != '' THEN ? ELSE house_no END,
                voter_id = CASE WHEN ? != '' THEN ? ELSE voter_id END,
                data_quality = 2,
                confidence = 95.0
            WHERE id = ?
        ''', (
            fix['voter_name_kn'],
            fix['voter_name_en'],
            fix['relative_name_kn'], fix['relative_name_kn'],
            fix['relative_name_en'], fix['relative_name_en'],
            fix['relation_type'], fix['relation_type'],
            fix['gender'], fix['gender'],
            fix['age'], fix['age'],
            fix['house_no'], fix['house_no'],
            fix['voter_id'], fix['voter_id'],
            fix['id'],
        ))
        updated += 1
        
        if updated % 50 == 0:
            conn.commit()
    
    conn.commit()
    conn.close()
    return updated


def build_search_tokens(name_en, relative_en):
    """Build search tokens for updated records."""
    tokens = []
    for name in [name_en, relative_en]:
        if name:
            parts = re.split(r'[\s.]+', name)
            tokens.extend([p for p in parts if len(p) >= 2])
    return json.dumps(tokens)


def main():
    args = sys.argv[1:]
    dry_run = '--dry-run' in args
    apply = '--apply' in args
    
    # Try to load .env file manually
    env_path = Path(__file__).resolve().parent.parent / '.env'
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip() and not line.startswith('#') and '=' in line:
                    k, v = line.strip().split('=', 1)
                    v = v.strip().strip("'").strip('"')
                    os.environ[k.strip()] = v

    # Parse --limit
    limit = None
    for arg in args:
        if arg.startswith('--limit='):
            limit = int(arg.split('=')[1])
    
    # Parse --ac
    ac_filter = None
    for arg in args:
        if arg.startswith('--ac='):
            ac_filter = int(arg.split('=')[1])
    
    print("=" * 60)
    print("GEMINI VISION RE-OCR — GARBAGE RECORD FIXER")
    print("=" * 60)
    
    # Check API key
    if not dry_run and not os.environ.get('GEMINI_API_KEY'):
        print("\nERROR: Set GEMINI_API_KEY environment variable in your shell or .env file.")
        print("  Example in .env: GEMINI_API_KEY=your_key")
        sys.exit(1)
    
    # Get garbage records
    print("\nFinding garbage records...")
    garbage = get_garbage_records(ac_filter)
    print(f"Total garbage records: {len(garbage):,}")
    
    # Group by (pdf_file, page_num)
    pages = defaultdict(list)
    for rec in garbage:
        if rec['pdf_file'] and rec['page_num'] and rec['serial_no']:
            key = (rec['pdf_file'], rec['page_num'], rec['ac_num'])
            pages[key].append(rec)
    
    print(f"Unique pages to process: {len(pages):,}")
    print(f"Average garbage records per page: {len(garbage)/max(len(pages),1):.1f}")
    
    if limit:
        page_items = sorted(pages.items())[:limit]
        print(f"Limited to {limit} pages")
    else:
        page_items = sorted(pages.items())
    
    # Estimate cost
    est_pages = len(page_items)
    est_cost = est_pages * 0.0003  # ~$0.0003 per image with Flash
    est_time = est_pages * BATCH_DELAY / 60
    print(f"\nEstimated API cost: ~${est_cost:.2f}")
    print(f"Estimated time: ~{est_time:.0f} minutes")
    
    if dry_run:
        print("\n--- DRY RUN MODE ---")
        print(f"Would process {est_pages} pages")
        print(f"Sample pages:")
        for (pdf_file, page_num, ac_num), recs in page_items[:10]:
            print(f"  {pdf_file} page {page_num} ({len(recs)} garbage records)")
        return
    
    # Process pages
    all_fixes = []
    processed = 0
    errors = 0
    skipped = 0
    start_time = time.time()
    
    print(f"\nProcessing {len(page_items)} pages...")
    print("-" * 60)
    
    for i, ((pdf_file, page_num, ac_num), records) in enumerate(page_items):
        pdf_path = find_pdf_path(pdf_file, ac_num)
        if not pdf_path:
            skipped += 1
            continue
        
        try:
            # Render page
            img_bytes = render_page_image(pdf_path, page_num, dpi=300)
            
            # Call Gemini
            response_text = call_gemini(img_bytes, EXTRACTION_PROMPT)
            
            # Parse response
            gemini_records = parse_gemini_response(response_text)
            
            if gemini_records:
                # Match to garbage records
                fixes = match_and_build_fixes(gemini_records, records)
                all_fixes.extend(fixes)
            
            processed += 1
            
            # Progress
            if processed % 10 == 0:
                elapsed = time.time() - start_time
                rate = processed / elapsed * 60
                remaining = (len(page_items) - i) / rate if rate > 0 else 0
                print(f"  [{processed}/{len(page_items)}] "
                      f"{len(all_fixes)} fixes | "
                      f"{rate:.0f} pages/min | "
                      f"~{remaining:.0f} min left")
            
            # Rate limiting
            time.sleep(BATCH_DELAY)
            
        except Exception as e:
            errors += 1
            if errors <= 20:
                print(f"  ERROR [{pdf_file} p{page_num}]: {e}")
            if "429" in str(e) or "quota" in str(e).lower():
                print("  Rate limited! Waiting 60s...")
                time.sleep(60)
    
    # Summary
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Pages processed: {processed}")
    print(f"Pages skipped (no PDF): {skipped}")
    print(f"Errors: {errors}")
    print(f"Fixes found: {len(all_fixes):,}")
    print(f"Time: {elapsed/60:.1f} minutes")
    
    if all_fixes:
        print(f"\nSample fixes:")
        for fix in all_fixes[:15]:
            print(f"  ID {fix['id']}: \"{fix['voter_name_en']}\" "
                  f"rel:\"{fix['relative_name_en']}\" "
                  f"VID:{fix['voter_id']} age:{fix['age']}")
    
    if apply and all_fixes:
        print(f"\nApplying {len(all_fixes)} fixes to database...")
        updated = apply_fixes(all_fixes)
        print(f"Updated {updated} records! (data_quality set to 2)")
    elif all_fixes and not apply:
        print(f"\nRun with --apply to write {len(all_fixes)} fixes to the database.")
    
    # Save fixes to JSON for review
    output_file = os.path.join(os.path.dirname(__file__), "..", "data", "gemini_fixes.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_fixes, f, ensure_ascii=False, indent=2)
    print(f"Fixes saved to: {output_file}")


if __name__ == "__main__":
    main()
