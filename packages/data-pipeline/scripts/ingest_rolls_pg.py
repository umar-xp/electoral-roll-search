"""
ingest_rolls_pg.py — PDF → Structured OCR → PostgreSQL
========================================================
Author: Mohammed Shoaib U

Same as ingest_rolls.py but writes to PostgreSQL for corruption-free
concurrent ingestion. PostgreSQL handles multiple writers properly via MVCC.

After ingestion is complete, use `pg_to_sqlite.py` to export to SQLite
for the lightweight frontend deployment.

Usage:
    python scripts/ingest_rolls_pg.py --dir ../../pdfs/MYSORE --district MYSORE --workers 8
    python scripts/ingest_rolls_pg.py --dir "../../pdfs/MYSORE/AC 112 - Bannur" --district MYSORE --workers 4
    python scripts/ingest_rolls_pg.py --pdf ../../pdfs/MYSORE/A1120001.pdf --district MYSORE

Requires:
    pip install psycopg2-binary
    Docker running with: docker compose up -d
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

# Add project root and lib to path
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PIPELINE = SCRIPT_DIR.parent
PROJECT_ROOT = DATA_PIPELINE.parent.parent
LIB_DIR = DATA_PIPELINE / "lib"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(DATA_PIPELINE))

from transliteration import transliterate_name, transliterate_pair, map_relation_type, map_gender, normalize_house_number
from config.logging_config import get_logger

logger = get_logger(__name__)

# Default PostgreSQL connection parameters
PG_DEFAULTS = {
    "host": "localhost",
    "port": 5432,
    "dbname": "electoral_rolls",
    "user": "rolls_admin",
    "password": "rolls_local_2026",
}


def get_pg_conn(pg_params=None):
    """Get a PostgreSQL connection."""
    import psycopg2
    params = pg_params or PG_DEFAULTS
    conn = psycopg2.connect(**params)
    conn.autocommit = False
    return conn


def ensure_schema(pg_params=None):
    """Ensure the voters table exists."""
    conn = get_pg_conn(pg_params)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS voters (
            id BIGSERIAL PRIMARY KEY,
            pdf_file TEXT NOT NULL,
            district TEXT,
            ac_num INTEGER,
            part_num INTEGER,
            page_num INTEGER,
            serial_no INTEGER,
            house_no TEXT,
            voter_name_kn TEXT,
            voter_name_en TEXT,
            relative_name_kn TEXT,
            relative_name_en TEXT,
            relation_type TEXT,
            gender TEXT,
            age INTEGER,
            voter_id TEXT,
            name_origin TEXT DEFAULT '',
            search_tokens JSONB,
            confidence REAL,
            data_quality INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_voters_pdf ON voters(pdf_file)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_voters_district_ac_part ON voters(district, ac_num, part_num)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_voters_name_en ON voters(voter_name_en)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_voters_voter_id ON voters(voter_id)")
    conn.commit()
    conn.close()


def parse_pdf_filename(pdf_name: str) -> dict:
    """Extract AC/part info from electoral roll PDF filename."""
    stem = Path(pdf_name).stem
    match = re.match(r'^A(\d{3})(\d{4})$', stem)
    if match:
        return {"ac_num": int(match.group(1)), "part_num": int(match.group(2))}
    return {"ac_num": 0, "part_num": 0}


def get_completed_pdfs(pg_params=None) -> set:
    """Get set of PDF filenames already ingested."""
    try:
        conn = get_pg_conn(pg_params)
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT pdf_file FROM voters")
        done = {row[0] for row in cur.fetchall()}
        conn.close()
        return done
    except Exception:
        return set()


def get_page_count(pdf_path: str) -> int:
    """Get number of pages in PDF."""
    import fitz
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count


def process_pdf(pdf_path: str, pg_params=None, pages=None, district=""):
    """Process a single PDF and insert into PostgreSQL."""
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    from detect_table_ultimate import process_page

    pdf_name = Path(pdf_path).name
    info = parse_pdf_filename(pdf_name)
    ac_num = info["ac_num"]
    part_num = info["part_num"]

    total_pages = get_page_count(pdf_path)
    if pages is None:
        pages = list(range(1, total_pages - 1))

    print(f"\n{'='*60}")
    print(f"INGESTING: {pdf_name}")
    print(f"  AC: {ac_num} | Part: {part_num} | Pages: {len(pages)} | Total PDF pages: {total_pages}")
    print(f"{'='*60}")

    conn = get_pg_conn(pg_params)
    cur = conn.cursor()
    total_voters = 0
    total_time = 0

    original_cwd = os.getcwd()
    os.chdir(str(PROJECT_ROOT))

    try:
        for page_num in pages:
            t0 = time.time()

            try:
                voters, headers, boundaries = process_page(pdf_path, page_num)
            except Exception as e:
                print(f"  Page {page_num+1}: ERROR - {e}")
                continue

            elapsed = time.time() - t0
            total_time += elapsed

            if not voters:
                print(f"  Page {page_num+1}: SKIPPED (non-voter page) | {elapsed:.1f}s")
                continue

            rows = []
            for v in voters:
                voter_name_kn = v.get("voter_name", "")
                relative_name_kn = v.get("relative_name", "")

                voter_en, relative_en, urdu_origin, search_tokens, corrected, failed = \
                    transliterate_pair(voter_name_kn, relative_name_kn)

                relation = map_relation_type(v.get("relation", ""))
                gender = map_gender(v.get("gender", ""))

                age_str = v.get("age", "")
                age = int(age_str) if age_str and age_str.isdigit() else None

                conf_vals = [c for c in v.get("conf", {}).values() if c > 0]
                avg_conf = round(sum(conf_vals) / len(conf_vals), 1) if conf_vals else 0

                dq = 1 if v.get("valid", True) else 0
                serial = v.get("serial_no", "")
                serial_int = int(serial) if serial and serial.isdigit() else None

                rows.append((
                    pdf_name, district, ac_num, part_num, page_num + 1,
                    serial_int, normalize_house_number(v.get("house_no", "")),
                    voter_name_kn, voter_en,
                    relative_name_kn, relative_en,
                    relation, gender, age, v.get("voter_id", ""),
                    'urdu' if urdu_origin else '',
                    json.dumps(search_tokens, ensure_ascii=False),
                    avg_conf, dq
                ))

            # Bulk insert with execute_values for performance
            from psycopg2.extras import execute_values
            execute_values(cur, """
                INSERT INTO voters (
                    pdf_file, district, ac_num, part_num, page_num,
                    serial_no, house_no,
                    voter_name_kn, voter_name_en,
                    relative_name_kn, relative_name_en,
                    relation_type, gender, age, voter_id,
                    name_origin, search_tokens, confidence, data_quality
                ) VALUES %s
            """, rows, template="""(
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s
            )""", page_size=500)
            conn.commit()

            valid_count = sum(1 for v in voters if v.get("valid", True))
            total_voters += len(voters)
            print(f"  Page {page_num+1}: {len(voters)} voters ({valid_count} valid) | {elapsed:.1f}s")
    finally:
        os.chdir(original_cwd)

    conn.close()
    print(f"\n  TOTAL: {total_voters} voters ingested in {total_time:.1f}s")
    return total_voters


def _worker(args_tuple):
    """Worker function for parallel processing."""
    pdf_path, pg_params, pages, district = args_tuple
    try:
        count = process_pdf(pdf_path, pg_params=pg_params, pages=pages, district=district)
        return pdf_path, count, None
    except Exception as e:
        return pdf_path, 0, str(e)


def main():
    parser = argparse.ArgumentParser(description="Ingest electoral roll PDFs into PostgreSQL")
    parser.add_argument("--pdf", type=str, help="Single PDF file to process")
    parser.add_argument("--dir", type=str, help="Directory of PDFs to process")
    parser.add_argument("--pages", type=str, help="Comma-separated page numbers (0-indexed)")
    parser.add_argument("--district", type=str, default="", help="District name")
    parser.add_argument("--workers", type=int, default=1, help="Number of parallel workers")
    parser.add_argument("--pg-host", type=str, default="localhost")
    parser.add_argument("--pg-port", type=int, default=5432)
    parser.add_argument("--pg-db", type=str, default="electoral_rolls")
    parser.add_argument("--pg-user", type=str, default="rolls_admin")
    parser.add_argument("--pg-password", type=str, default="rolls_local_2026")
    args = parser.parse_args()

    pg_params = {
        "host": args.pg_host,
        "port": args.pg_port,
        "dbname": args.pg_db,
        "user": args.pg_user,
        "password": args.pg_password,
    }

    # Ensure schema exists
    print("Connecting to PostgreSQL...")
    try:
        ensure_schema(pg_params)
        print("  ✅ Connected. Schema ready.")
    except Exception as e:
        print(f"  ❌ Cannot connect to PostgreSQL: {e}")
        print(f"     Make sure Docker is running: docker compose up -d")
        sys.exit(1)

    # Parse pages
    pages = None
    if args.pages:
        pages = [int(x) for x in args.pages.split(",")]

    # Collect PDFs
    pdfs = []
    if args.pdf:
        pdfs.append(args.pdf)
    elif args.dir:
        pdf_dir = Path(args.dir)
        pdfs = sorted([str(f) for f in pdf_dir.rglob("*.pdf")])
    else:
        pdfs = sorted([str(f) for f in PROJECT_ROOT.glob("A*.pdf")])

    if not pdfs:
        print("No PDFs found to process.")
        return

    print(f"Found {len(pdfs)} PDF(s) to process")
    print(f"Workers: {args.workers}")

    # Checkpoint: skip already-completed PDFs
    done_pdfs = get_completed_pdfs(pg_params)
    pending_pdfs = [p for p in pdfs if Path(p).name not in done_pdfs]
    skipped = len(pdfs) - len(pending_pdfs)
    if skipped > 0:
        print(f"Checkpoint: {skipped} PDF(s) already done, {len(pending_pdfs)} remaining")

    if not pending_pdfs:
        print("All PDFs already processed. Nothing to do.")
        return

    grand_total = 0
    t_start = time.time()

    if args.workers > 1:
        work_items = [(pdf, pg_params, pages, args.district) for pdf in pending_pdfs]
        completed = 0
        errors = []

        print(f"\nStarting parallel processing with {args.workers} workers...")
        print(f"{'='*60}")

        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(_worker, item): item[0]
                for item in work_items
            }
            for future in as_completed(futures):
                pdf_path = futures[future]
                pdf_name = Path(pdf_path).name
                completed += 1
                try:
                    _, count, error = future.result()
                    if error:
                        errors.append((pdf_name, error))
                        print(f"  [{completed}/{len(pending_pdfs)}] FAILED: {pdf_name} — {error}")
                    else:
                        grand_total += count
                        print(f"  [{completed}/{len(pending_pdfs)}] Done: {pdf_name} — {count} voters")
                except Exception as e:
                    errors.append((pdf_name, str(e)))
                    print(f"  [{completed}/{len(pending_pdfs)}] ERROR: {pdf_name} — {e}")

        if errors:
            print(f"\n  ERRORS ({len(errors)}):")
            for name, err in errors[:10]:
                print(f"    {name}: {err}")
    else:
        for pdf_path in pending_pdfs:
            count = process_pdf(pdf_path, pg_params=pg_params, pages=pages, district=args.district)
            grand_total += count

    elapsed = time.time() - t_start

    # Final stats from DB
    conn = get_pg_conn(pg_params)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM voters")
    total_in_db = cur.fetchone()[0]
    cur.execute("SELECT COUNT(DISTINCT pdf_file) FROM voters")
    total_pdfs_in_db = cur.fetchone()[0]
    conn.close()

    print(f"\n{'='*60}")
    print(f"INGEST COMPLETE")
    print(f"  PDFs processed: {len(pending_pdfs)}")
    print(f"  PDFs skipped:   {skipped}")
    print(f"  Voters added:   {grand_total}")
    print(f"  Total in DB:    {total_in_db}")
    print(f"  Total PDFs:     {total_pdfs_in_db}")
    print(f"  Total time:     {elapsed:.1f}s")
    if elapsed > 0:
        print(f"  Throughput:     {grand_total / elapsed:.1f} voters/sec")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
