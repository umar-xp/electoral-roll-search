"""
ingest_rolls.py — PDF → Structured OCR → SQLite
=================================================
Author: Mohammed Shoaib U

Processes electoral roll PDFs using the ultimate multi-pass OCR pipeline,
transliterates names, and stores results in a SQLite database.

Supports parallel processing using multiprocessing for batch operations.

Usage:
    python scripts/ingest_rolls.py --pdf A1160043.pdf
    python scripts/ingest_rolls.py --dir ./pdfs/ --db ./data/rolls.sqlite
    python scripts/ingest_rolls.py --pdf A1160043.pdf --pages 1,2,3
    python scripts/ingest_rolls.py --dir ./data/MYSORE/ --workers 4
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

# Add project root and lib to path
SCRIPT_DIR = Path(__file__).resolve().parent          # scripts/
DATA_PIPELINE = SCRIPT_DIR.parent                     # packages/data-pipeline/
PROJECT_ROOT = DATA_PIPELINE.parent.parent            # electoral-roll-search/
LIB_DIR = DATA_PIPELINE / "lib"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(DATA_PIPELINE))

from transliteration import transliterate_name, transliterate_pair, map_relation_type, map_gender, normalize_house_number
from config.logging_config import get_logger

logger = get_logger(__name__)


def create_db(db_path: str) -> sqlite3.Connection:
    """Create SQLite database with schema."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS voters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            search_tokens TEXT,
            confidence REAL,
            data_quality INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_voters_pdf ON voters(pdf_file)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_voters_district_ac ON voters(district, ac_num, part_num)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_voters_name ON voters(voter_name_en)
    """)
    conn.commit()
    return conn


def parse_pdf_filename(pdf_name: str) -> dict:
    """Extract district/AC/part info from electoral roll PDF filename.
    
    Typical format: A{AC_NUM}{PART_NUM:04d}.pdf
    Example: A1160043.pdf → AC 116, Part 43
    """
    stem = Path(pdf_name).stem  # e.g., "A1160043"
    match = re.match(r'^A(\d{3})(\d{4})$', stem)
    if match:
        ac_num = int(match.group(1))
        part_num = int(match.group(2))
        return {"ac_num": ac_num, "part_num": part_num}
    return {"ac_num": 0, "part_num": 0}


def get_completed_pdfs(db_path: str) -> set:
    """Get set of PDF filenames already fully ingested in the DB."""
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.execute("SELECT DISTINCT pdf_file FROM voters")
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


def process_pdf(pdf_path: str, conn: sqlite3.Connection, pages: list = None, 
                district: str = "", dpi: int = 300):
    """Process a single PDF through the OCR pipeline and store in DB."""
    # Import OCR pipeline from project root (detect_table_ultimate.py lives there)
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    from detect_table_ultimate import process_page
    
    pdf_name = Path(pdf_path).name
    info = parse_pdf_filename(pdf_name)
    ac_num = info["ac_num"]
    part_num = info["part_num"]
    
    # Determine pages to process (skip page 0 = cover, last page = summary)
    total_pages = get_page_count(pdf_path)
    if pages is None:
        # Process all voter pages (1 to second-to-last)
        pages = list(range(1, total_pages - 1))
    
    print(f"\n{'='*60}")
    print(f"INGESTING: {pdf_name}")
    print(f"  AC: {ac_num} | Part: {part_num} | Pages: {len(pages)} | Total PDF pages: {total_pages}")
    print(f"{'='*60}")
    
    total_voters = 0
    total_time = 0
    
    # Change to project root for PDF access
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
            
            # Skip pages that returned empty (non-voter pages)
            if not voters:
                print(f"  Page {page_num+1}: SKIPPED (non-voter page) | {elapsed:.1f}s")
                continue
            
            # Process and insert each voter
            rows = []
            for v in voters:
                voter_name_kn = v.get("voter_name", "")
                relative_name_kn = v.get("relative_name", "")
                
                # Transliterate
                voter_en, relative_en, urdu_origin, search_tokens, corrected, failed = \
                    transliterate_pair(voter_name_kn, relative_name_kn)
                
                # Map relation and gender
                relation = map_relation_type(v.get("relation", ""))
                gender = map_gender(v.get("gender", ""))
                
                # Parse age
                age_str = v.get("age", "")
                age = int(age_str) if age_str and age_str.isdigit() else None
                
                # Calculate average confidence
                conf_vals = [c for c in v.get("conf", {}).values() if c > 0]
                avg_conf = round(sum(conf_vals) / len(conf_vals), 1) if conf_vals else 0
                
                # Data quality score (1 = good, 0 = has issues)
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
            
            # Bulk insert
            conn.executemany("""
                INSERT INTO voters (
                    pdf_file, district, ac_num, part_num, page_num,
                    serial_no, house_no,
                    voter_name_kn, voter_name_en,
                    relative_name_kn, relative_name_en,
                    relation_type, gender, age, voter_id,
                    name_origin, search_tokens, confidence, data_quality
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, rows)
            conn.commit()
            
            valid_count = sum(1 for v in voters if v.get("valid", True))
            total_voters += len(voters)
            print(f"  Page {page_num+1}: {len(voters)} voters ({valid_count} valid) | {elapsed:.1f}s")
    finally:
        os.chdir(original_cwd)
    
    print(f"\n  TOTAL: {total_voters} voters ingested in {total_time:.1f}s")
    return total_voters


def main():
    parser = argparse.ArgumentParser(description="Ingest electoral roll PDFs into SQLite")
    parser.add_argument("--pdf", type=str, help="Single PDF file to process")
    parser.add_argument("--dir", type=str, help="Directory of PDFs to process")
    parser.add_argument("--db", type=str, default="data/rolls.sqlite", help="SQLite database path")
    parser.add_argument("--pages", type=str, help="Comma-separated page numbers (0-indexed)")
    parser.add_argument("--district", type=str, default="", help="District name")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--workers", type=int, default=1, help="Number of parallel workers (default: 1)")
    args = parser.parse_args()
    
    # Create DB
    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = create_db(str(db_path))
    
    # Parse pages
    pages = None
    if args.pages:
        pages = [int(x) for x in args.pages.split(",")]
    
    pdfs = []
    if args.pdf:
        pdfs.append(args.pdf)
    elif args.dir:
        pdf_dir = Path(args.dir)
        # Recursively find all PDFs (handles nested AC directories)
        pdfs = sorted([str(f) for f in pdf_dir.rglob("*.pdf")])
    else:
        # Default: process all PDFs in project root
        pdfs = sorted([str(f) for f in PROJECT_ROOT.glob("A*.pdf")])
    
    if not pdfs:
        print("No PDFs found to process.")
        return
    
    print(f"Found {len(pdfs)} PDF(s) to process")
    print(f"Database: {db_path}")
    print(f"Workers: {args.workers}")
    
    # Checkpoint: skip already-completed PDFs
    done_pdfs = get_completed_pdfs(str(db_path))
    pending_pdfs = [p for p in pdfs if Path(p).name not in done_pdfs]
    skipped = len(pdfs) - len(pending_pdfs)
    if skipped > 0:
        print(f"Checkpoint: {skipped} PDF(s) already done, {len(pending_pdfs)} remaining")
    
    if not pending_pdfs:
        print("All PDFs already processed. Nothing to do.")
        conn.close()
        return
    
    grand_total = 0
    t_start = time.time()
    
    if args.workers > 1:
        # Close the main connection before parallel processing
        conn.close()
        grand_total = process_pdfs_parallel(
            pending_pdfs, str(db_path), pages=pages, 
            district=args.district, workers=args.workers
        )
    else:
        for pdf_path in pending_pdfs:
            count = process_pdf(pdf_path, conn, pages=pages, district=args.district)
            grand_total += count
        conn.close()
    
    elapsed = time.time() - t_start
    
    # Final integrity check and WAL checkpoint
    print(f"\n  Running integrity check...")
    check_conn = sqlite3.connect(str(db_path))
    check_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    integrity = check_conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity == "ok":
        print(f"  ✅ Database integrity: OK")
    else:
        print(f"  ❌ Database integrity FAILED: {integrity[:200]}")
    check_conn.close()
    
    print(f"\n{'='*60}")
    print(f"INGEST COMPLETE")
    print(f"  PDFs processed: {len(pending_pdfs)}")
    print(f"  PDFs skipped:   {skipped}")
    print(f"  Total voters:   {grand_total}")
    print(f"  Total time:     {elapsed:.1f}s")
    print(f"  Throughput:     {grand_total / elapsed:.1f} voters/sec" if elapsed > 0 else "")
    print(f"  Database:       {db_path}")
    print(f"{'='*60}")


def _process_single_pdf_worker(args_tuple):
    """Worker function for parallel processing. Runs in a separate process.
    
    Each worker writes to its own temporary SQLite file to avoid corruption
    from concurrent writes. Files are merged into the main DB after completion.
    """
    pdf_path, tmp_db_path, pages, district = args_tuple
    
    # Each worker writes to its own isolated temp DB — no shared file access
    conn = create_db(tmp_db_path)
    try:
        count = process_pdf(pdf_path, conn, pages=pages, district=district)
        conn.close()
        return pdf_path, count, None
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return pdf_path, 0, str(e)


def _merge_worker_db(main_db_path: str, worker_db_path: str):
    """Merge a worker's temp DB into the main database (single-threaded, safe)."""
    conn = sqlite3.connect(main_db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"ATTACH DATABASE ? AS worker", (worker_db_path,))
    conn.execute("""
        INSERT INTO main.voters (
            pdf_file, district, ac_num, part_num, page_num,
            serial_no, house_no, voter_name_kn, voter_name_en,
            relative_name_kn, relative_name_en,
            relation_type, gender, age, voter_id,
            name_origin, search_tokens, confidence, data_quality, created_at
        )
        SELECT pdf_file, district, ac_num, part_num, page_num,
               serial_no, house_no, voter_name_kn, voter_name_en,
               relative_name_kn, relative_name_en,
               relation_type, gender, age, voter_id,
               name_origin, search_tokens, confidence, data_quality, created_at
        FROM worker.voters
    """)
    conn.execute("DETACH DATABASE worker")
    conn.commit()
    conn.close()
    # Remove temp file
    try:
        os.remove(worker_db_path)
        # Also remove WAL/SHM files if they exist
        for suffix in ['-wal', '-shm']:
            wal_path = worker_db_path + suffix
            if os.path.exists(wal_path):
                os.remove(wal_path)
    except OSError:
        pass


def process_pdfs_parallel(pdfs, db_path, pages=None, district="", workers=4):
    """Process multiple PDFs in parallel using ProcessPoolExecutor.
    
    Each worker writes to its own temporary SQLite file to prevent corruption.
    After all workers finish, results are merged into the main DB sequentially.
    This avoids the SQLite concurrent-write corruption issue on Windows.
    
    Args:
        pdfs: List of PDF file paths
        db_path: Path to SQLite database
        pages: Optional list of specific pages to process
        district: District name
        workers: Number of parallel worker processes
    
    Returns:
        Total number of voters extracted
    """
    # Create temp directory for worker DBs
    import tempfile
    tmp_dir = tempfile.mkdtemp(prefix="rolls_ingest_")
    
    # Each PDF gets its own temp DB file
    work_items = []
    for i, pdf in enumerate(pdfs):
        tmp_db = os.path.join(tmp_dir, f"worker_{i:04d}.sqlite")
        work_items.append((pdf, tmp_db, pages, district))
    
    total_voters = 0
    completed = 0
    errors = []
    successful_dbs = []
    
    print(f"\nStarting parallel processing with {workers} workers...")
    print(f"  Temp directory: {tmp_dir}")
    print(f"{'='*60}")
    
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_process_single_pdf_worker, item): (item[0], item[1])
            for item in work_items
        }
        
        for future in as_completed(futures):
            pdf_path, tmp_db = futures[future]
            pdf_name = Path(pdf_path).name
            completed += 1
            
            try:
                _, count, error = future.result()
                if error:
                    errors.append((pdf_name, error))
                    print(f"  [{completed}/{len(pdfs)}] FAILED: {pdf_name} — {error}")
                else:
                    total_voters += count
                    successful_dbs.append(tmp_db)
                    print(f"  [{completed}/{len(pdfs)}] Done: {pdf_name} — {count} voters")
            except Exception as e:
                errors.append((pdf_name, str(e)))
                print(f"  [{completed}/{len(pdfs)}] ERROR: {pdf_name} — {e}")
    
    # Merge phase: single-threaded merge into main DB (safe, no corruption)
    if successful_dbs:
        print(f"\n  Merging {len(successful_dbs)} worker databases into main DB...")
        merge_start = time.time()
        # Ensure main DB exists with schema
        main_conn = create_db(db_path)
        main_conn.close()
        
        for i, worker_db in enumerate(successful_dbs):
            try:
                _merge_worker_db(db_path, worker_db)
            except Exception as e:
                print(f"    Merge error for worker DB {i}: {e}")
            if (i + 1) % 20 == 0:
                print(f"    Merged {i+1}/{len(successful_dbs)}...")
        
        print(f"  Merge complete in {time.time() - merge_start:.1f}s")
    
    # Cleanup temp directory
    try:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
    except Exception:
        pass
    
    if errors:
        print(f"\n  ERRORS ({len(errors)}):")
        for name, err in errors[:10]:
            print(f"    {name}: {err}")
    
    return total_voters


if __name__ == "__main__":
    main()
