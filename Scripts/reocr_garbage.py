"""
Re-OCR garbage pages at higher quality and update the database.
Uses 400 DPI + kan_best+eng_best for much better results than the original pipeline.
"""
import sqlite3
import re
import os
import sys
from pathlib import Path

# Setup paths for project imports
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_PIPELINE = PROJECT_ROOT / "packages" / "data-pipeline"
LIB_DIR = DATA_PIPELINE / "lib"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(DATA_PIPELINE))

import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io
from collections import defaultdict
import time

# Configure Tesseract path from centralized settings
from config.settings import ocr_settings
pytesseract.pytesseract.tesseract_cmd = ocr_settings.TESSERACT_CMD
os.environ["TESSDATA_PREFIX"] = ocr_settings.TESSDATA_DIR

DEFAULT_DB_PATH = "data/rolls.sqlite"
GARBAGE_CHARS = re.compile(r'[!@#$%^&*()=+\[\]{}<>\\|;:"\',?/~`]')

# Relation keywords in Kannada
RELATIONS = {
    'ತಂದೆ': 'F',   # Father
    'ಗಂಡ': 'H',    # Husband
    'ತಾಯಿ': 'M',   # Mother
}

# Gender keywords
GENDER_MAP = {
    'ಗಂ': 'M',     # Male (ಗಂಡಸು)
    'ಗರಿ': 'M',    # Male variant
    'ಹೆಂ': 'F',    # Female (ಹೆಂಗಸು)
    'no': 'M',     # OCR sometimes reads ಗಂ as 'no'
}


def get_garbage_records(db_path: str, district: str | None = None, ac_nums: list[int] | None = None):
    """Get all records that are garbage (1+ special chars, empty/short names, or relative name garbage).
    Skips data_quality=2 (already successfully fixed).
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    sql = '''
        SELECT id, pdf_file, page_num, serial_no, voter_name_kn, voter_name_en,
               age, gender, ac_num, part_num, house_no, relative_name_kn, relative_name_en, voter_id
        FROM voters
        WHERE data_quality != 2
    '''
    params: list[object] = []
    if district:
        sql += " AND district = ?"
        params.append(district)
    if ac_nums:
        placeholders = ",".join(["?"] * len(ac_nums))
        sql += f" AND ac_num IN ({placeholders})"
        params.extend(ac_nums)
    cursor = conn.execute(sql, params)
    garbage = []
    for row in cursor.fetchall():
        r = dict(row)
        kn = r['voter_name_kn'] or ''
        en = r['voter_name_en'] or ''
        rel_kn = r['relative_name_kn'] or ''
        rel_en = r['relative_name_en'] or ''
        
        # Count garbage characters in voter name and relative name (both Kannada and English)
        hits = len(GARBAGE_CHARS.findall(kn)) + len(GARBAGE_CHARS.findall(en))
        hits += len(GARBAGE_CHARS.findall(rel_kn)) + len(GARBAGE_CHARS.findall(rel_en))
        
        # Qualify if there is any garbage hit, empty names, or short English name (<=2 chars)
        if hits >= 1 or not kn.strip() or not en.strip() or len(en.strip()) <= 2:
            garbage.append(r)
    conn.close()
    return garbage


def find_pdf_path(pdf_file: str, ac_num: int, raw_root: str, district: str):
    """Find the full path to a PDF file."""
    base = os.path.join(raw_root, district)
    if not os.path.isdir(base):
        return None

    direct = os.path.join(base, pdf_file)
    if os.path.exists(direct):
        return direct

    try:
        for d in os.listdir(base):
            if d.startswith(f"AC {ac_num}"):
                path = os.path.join(base, d, pdf_file)
                if os.path.exists(path):
                    return path
    except Exception:
        return None
    return None


def ocr_page(pdf_path, page_num, dpi=400):
    """Re-OCR a specific page at high DPI with best models."""
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]  # page_num is 1-based
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img_data = pix.tobytes('png')
    img = Image.open(io.BytesIO(img_data))
    doc.close()

    text = pytesseract.image_to_string(
        img, lang=ocr_settings.LANG,
        config='--psm 6 --dpi 400'
    )
    return text


def parse_voter_line(line):
    """
    Parse a single OCR line into voter data.
    Format: serial house_no name relation relative_name gender age [voter_id]
    Example: 616 102 ಟಿ.ಎಂ.ಪ್ರಶಾಂತ್‌ಕುಮಾರ್‌ ತಂದೆ ಮಂಚೇಗೌಡ ಗಂ 23
    """
    line = line.strip()
    if not line:
        return None

    # Must start with a serial number
    m = re.match(r'^(\d+)\.?\s+', line)
    if not m:
        return None

    serial = int(m.group(1))
    rest = line[m.end():]

    # Next is house number (digits, possibly with -letter or -digit suffix)
    m2 = re.match(r'([\d][\d\-/A-Za-z]*)\s+', rest)
    if not m2:
        return None

    house_no = m2.group(1)
    rest = rest[m2.end():]

    # Now find the relation keyword to split name and relative
    relation_type = None
    voter_name = None
    relative_name = None

    for rel_kn, rel_code in RELATIONS.items():
        idx = rest.find(rel_kn)
        if idx > 0:
            voter_name = rest[:idx].strip()
            after_rel = rest[idx + len(rel_kn):].strip()
            relation_type = rel_code

            # After relative name comes gender and age
            # Find gender marker
            gender = None
            age = None
            voter_id = None

            for g_kn, g_code in GENDER_MAP.items():
                g_idx = after_rel.rfind(g_kn)
                if g_idx > 0:
                    relative_name = after_rel[:g_idx].strip()
                    after_gender = after_rel[g_idx + len(g_kn):].strip()
                    gender = g_code

                    # Extract age and optional voter_id
                    nums = re.findall(r'\d+', after_gender)
                    if nums:
                        age = int(nums[0]) if int(nums[0]) < 150 else None
                        if len(nums) > 1:
                            voter_id = nums[1]
                    break

            if relative_name is None:
                # Try to split by last number pattern
                parts = re.split(r'\s+(\d+)\s*$', after_rel)
                if len(parts) > 1:
                    relative_name = parts[0].strip()
                else:
                    relative_name = after_rel.strip()

            break

    if voter_name is None:
        return None

    # Clean up: remove zero-width chars and extra spaces
    voter_name = re.sub(r'[\u200c\u200d]', '', voter_name).strip()
    if relative_name:
        relative_name = re.sub(r'[\u200c\u200d]', '', relative_name).strip()

    return {
        'serial': serial,
        'house_no': house_no,
        'voter_name_kn': voter_name,
        'relative_name_kn': relative_name or '',
        'relation_type': relation_type or '',
        'gender': gender or '',
        'age': age,
        'voter_id': voter_id,
    }


def transliterate_kn(kannada_name):
    """Transliterate Kannada name to English."""
    if not kannada_name:
        return ''
    try:
        from transliteration import transliterate_name
        res = transliterate_name(kannada_name)
        if hasattr(res, 'en'):
            return res.en
        elif isinstance(res, dict):
            return res.get('en', '')
        else:
            return str(res)
    except Exception as e:
        print(f"Error in transliterate_kn: {e}")
        return ''


def process_page(pdf_path, page_num, garbage_records):
    """Re-OCR a page and match results to garbage records."""
    text = ocr_page(pdf_path, page_num)
    lines = text.strip().split('\n')

    # Parse all voter lines from the page
    parsed = {}
    for line in lines:
        result = parse_voter_line(line)
        if result:
            parsed[result['serial']] = result

    # Match garbage records by serial number
    fixes = []
    for rec in garbage_records:
        serial = rec['serial_no']
        if serial and serial in parsed:
            p = parsed[serial]
            # Only update if we got a real name (3+ Kannada chars)
            kannada_chars = re.findall(r'[\u0C80-\u0CFF]', p['voter_name_kn'])
            if len(kannada_chars) >= 3:
                # Transliterate to English
                voter_name_en = transliterate_kn(p['voter_name_kn'])
                relative_name_en = transliterate_kn(p['relative_name_kn']) if p['relative_name_kn'] else ''
                fixes.append({
                    'id': rec['id'],
                    'voter_name_kn': p['voter_name_kn'],
                    'voter_name_en': voter_name_en,
                    'relative_name_kn': p['relative_name_kn'],
                    'relative_name_en': relative_name_en,
                    'relation_type': p['relation_type'],
                    'gender': p['gender'],
                    'age': p['age'],
                    'house_no': p['house_no'],
                })

    return fixes, parsed


def main():
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--district", required=True)
    p.add_argument("--raw-root", default="data")
    p.add_argument("--db", default=DEFAULT_DB_PATH)
    p.add_argument("--ac", default=None, help="Comma-separated AC numbers to limit (optional)")
    p.add_argument("--workers", type=int, default=12)
    p.add_argument("--limit", type=int, default=None, help="Limit number of pages to re-OCR (optional)")
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()

    ac_nums = None
    if args.ac:
        ac_nums = [int(x.strip()) for x in args.ac.split(",") if x.strip()]

    print("=" * 60)
    print("RE-OCR GARBAGE RECORDS FIXER")
    print("=" * 60)
    sys.stdout.flush()

    # Get garbage records
    garbage = get_garbage_records(args.db, district=args.district, ac_nums=ac_nums)
    print(f"Total garbage records: {len(garbage)}")
    sys.stdout.flush()

    # Only process records that have serial numbers (matchable)
    garbage_with_serial = [g for g in garbage if g['serial_no'] is not None]
    print(f"Records with serial numbers (matchable): {len(garbage_with_serial)}")
    sys.stdout.flush()

    # Group by (pdf_file, page_num, ac_num)
    pages = defaultdict(list)
    for g in garbage_with_serial:
        if g['pdf_file'] and g['page_num']:
            key = (g['pdf_file'], g['page_num'], g['ac_num'])
            pages[key].append(g)

    print(f"Pages to re-OCR: {len(pages)}")
    sys.stdout.flush()

    page_items = sorted(pages.items())
    if args.limit:
        page_items = page_items[:args.limit]
        print(f"Limited to first {args.limit} pages")
    print()
    sys.stdout.flush()

    # Process pages
    all_fixes = []
    processed = 0
    errors = 0
    start = time.time()

    # Prepare work items
    work_items = []
    for (pdf_file, page_num, ac_num), records in page_items:
        pdf_path = find_pdf_path(pdf_file, ac_num, raw_root=args.raw_root, district=args.district)
        if pdf_path:
            work_items.append((pdf_path, page_num, records))
        else:
            errors += 1

    print(f"Processing {len(work_items)} pages using {args.workers} parallel workers...")
    sys.stdout.flush()

    from concurrent.futures import ProcessPoolExecutor, as_completed

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(process_page, pdf_path, page_num, records): (pdf_path, page_num)
            for pdf_path, page_num, records in work_items
        }

        for future in as_completed(futures):
            pdf_path, page_num = futures[future]
            try:
                fixes, parsed = future.result()
                all_fixes.extend(fixes)
                processed += 1

                if processed % 50 == 0 or processed == len(work_items):
                    elapsed = time.time() - start
                    rate = processed / elapsed
                    remaining = (len(work_items) - processed) / rate
                    print(f"  [{processed}/{len(work_items)}] {len(all_fixes)} fixes "
                          f"({elapsed:.0f}s, ~{remaining/60:.0f}min left)", flush=True)

            except Exception as e:
                errors += 1
                if errors <= 20:
                    print(f"  ERROR: {os.path.basename(pdf_path)} page {page_num}: {e}", flush=True)

    elapsed = time.time() - start
    print()
    print(f"Processed {processed} pages in {elapsed:.1f}s")
    print(f"Errors: {errors}")
    print(f"Fixes found: {len(all_fixes)}")

    if not all_fixes:
        print("No fixes found. Exiting.")
        return

    # Show sample fixes
    print()
    print("Sample fixes:")
    for fix in all_fixes[:20]:
        print(f"  ID {fix['id']}: name='{fix['voter_name_kn']}' "
              f"rel='{fix['relative_name_kn']}' age={fix['age']} gender={fix['gender']}")

    # Apply fixes to database
    if args.apply:
        print()
        print("Applying fixes to database...")
        conn = sqlite3.connect(args.db)
        updated = 0
        for fix in all_fixes:
            conn.execute('''
                UPDATE voters SET
                    voter_name_kn = ?,
                    voter_name_en = CASE WHEN ? != '' THEN ? ELSE voter_name_en END,
                    relative_name_kn = CASE WHEN ? != '' THEN ? ELSE relative_name_kn END,
                    relative_name_en = CASE WHEN ? != '' THEN ? ELSE relative_name_en END,
                    relation_type = CASE WHEN ? != '' THEN ? ELSE relation_type END,
                    gender = CASE WHEN ? != '' THEN ? ELSE gender END,
                    age = CASE WHEN ? IS NOT NULL THEN ? ELSE age END,
                    house_no = CASE WHEN ? != '' THEN ? ELSE house_no END,
                    data_quality = 2
                WHERE id = ?
            ''', (
                fix['voter_name_kn'],
                fix['voter_name_en'], fix['voter_name_en'],
                fix['relative_name_kn'], fix['relative_name_kn'],
                fix['relative_name_en'], fix['relative_name_en'],
                fix['relation_type'], fix['relation_type'],
                fix['gender'], fix['gender'],
                fix['age'], fix['age'],
                fix['house_no'], fix['house_no'],
                fix['id'],
            ))
            updated += 1
            # Commit every 10 records so progress isn't lost if killed
            if updated % 10 == 0:
                conn.commit()

        conn.commit()
        conn.close()
        print(f"Updated {updated} records in database!")
    else:
        print()
        print("Run with --apply to write fixes to the database.")


if __name__ == "__main__":
    main()
