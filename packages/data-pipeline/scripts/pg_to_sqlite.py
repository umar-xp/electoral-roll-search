"""
pg_to_sqlite.py — PostgreSQL → SQLite + JSON Index Export
==========================================================
Author: Mohammed Shoaib U

Exports the ingested electoral roll data from PostgreSQL to:
  1. A clean SQLite database (for deployment/backup)
  2. Tiered JSON index files (for the web frontend)

Usage:
    python scripts/pg_to_sqlite.py --out ../../data/
    python scripts/pg_to_sqlite.py --out ../../data/ --sqlite-only
    python scripts/pg_to_sqlite.py --out ../../data/ --json-only
    python scripts/pg_to_sqlite.py --out ../../data/ --district MYSORE --ac 112

Requires:
    pip install psycopg2-binary
"""

import argparse
import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PIPELINE = SCRIPT_DIR.parent
PROJECT_ROOT = DATA_PIPELINE.parent.parent

# Characters that indicate OCR garbage
_GARBAGE_CHARS = re.compile(r'[!@#$%^&*()=+\[\]{}<>\\|;:"\',?/~`]')

PG_DEFAULTS = {
    "host": "localhost",
    "port": 5432,
    "dbname": "electoral_rolls",
    "user": "rolls_admin",
    "password": "rolls_local_2026",
}


def _district_code(name: str) -> str:
    """Return a stable district code for master_index.json."""
    if not name:
        return "UNKNOWN"
    return re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_") or "UNKNOWN"


def _district_display_name(name: str) -> str:
    """Return a readable display name while preserving short acronyms."""
    if not name:
        return "Unknown"

    parts = re.split(r"[_\s]+", name.strip())
    formatted = []
    for part in parts:
        if not part:
            continue
        if part.isupper() and len(part) <= 4:
            formatted.append(part)
        else:
            formatted.append(part.capitalize())
    return " ".join(formatted) or name


def _generated_at() -> str:
    """Return a UTC ISO-8601 timestamp for JSON metadata."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_pg_conn(pg_params=None):
    """Get a PostgreSQL connection."""
    import psycopg2
    params = pg_params or PG_DEFAULTS
    conn = psycopg2.connect(**params)
    return conn


def export_sqlite(pg_params, output_dir, district_filter=None, ac_filter=None):
    """Export PostgreSQL data to a clean SQLite database."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    sqlite_path = out / "rolls.sqlite"

    # Remove old file for clean export
    if sqlite_path.exists():
        sqlite_path.unlink()
    for suffix in ["-wal", "-shm"]:
        p = Path(str(sqlite_path) + suffix)
        if p.exists():
            p.unlink()

    print(f"Exporting to SQLite: {sqlite_path}")

    # Create SQLite DB
    sconn = sqlite3.connect(str(sqlite_path))
    sconn.execute("PRAGMA journal_mode=WAL")
    sconn.execute("PRAGMA synchronous=NORMAL")
    sconn.execute("""
        CREATE TABLE voters (
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
    sconn.execute("CREATE INDEX idx_voters_pdf ON voters(pdf_file)")
    sconn.execute("CREATE INDEX idx_voters_district_ac ON voters(district, ac_num, part_num)")
    sconn.execute("CREATE INDEX idx_voters_name ON voters(voter_name_en)")
    sconn.execute("CREATE INDEX idx_voters_vid ON voters(voter_id)")
    sconn.commit()

    # Read from PostgreSQL
    pgconn = get_pg_conn(pg_params)
    pgcur = pgconn.cursor("export_cursor")
    pgcur.itersize = 5000

    where_clauses = []
    if district_filter:
        where_clauses.append(f"district = '{district_filter}'")
    if ac_filter:
        where_clauses.append(f"ac_num = {ac_filter}")

    where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    pgcur.execute(f"""
        SELECT pdf_file, district, ac_num, part_num, page_num,
               serial_no, house_no, voter_name_kn, voter_name_en,
               relative_name_kn, relative_name_en,
               relation_type, gender, age, voter_id,
               name_origin, search_tokens, confidence, data_quality, created_at
        FROM voters
        {where}
        ORDER BY district, ac_num, part_num, serial_no
    """)

    batch = []
    total = 0
    t0 = time.time()

    for row in pgcur:
        # Convert JSONB search_tokens back to TEXT for SQLite
        search_tokens = row[16]
        if isinstance(search_tokens, dict) or isinstance(search_tokens, list):
            search_tokens = json.dumps(search_tokens, ensure_ascii=False)
        elif search_tokens is None:
            search_tokens = ""

        batch.append((
            row[0], row[1], row[2], row[3], row[4],
            row[5], row[6], row[7], row[8], row[9], row[10],
            row[11], row[12], row[13], row[14], row[15],
            search_tokens, row[17], row[18],
            str(row[19]) if row[19] else None
        ))

        if len(batch) >= 5000:
            sconn.executemany("""
                INSERT INTO voters (
                    pdf_file, district, ac_num, part_num, page_num,
                    serial_no, house_no, voter_name_kn, voter_name_en,
                    relative_name_kn, relative_name_en,
                    relation_type, gender, age, voter_id,
                    name_origin, search_tokens, confidence, data_quality, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, batch)
            sconn.commit()
            total += len(batch)
            batch = []
            print(f"  Exported {total:,} rows...", end="\r")

    if batch:
        sconn.executemany("""
            INSERT INTO voters (
                pdf_file, district, ac_num, part_num, page_num,
                serial_no, house_no, voter_name_kn, voter_name_en,
                relative_name_kn, relative_name_en,
                relation_type, gender, age, voter_id,
                name_origin, search_tokens, confidence, data_quality, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, batch)
        sconn.commit()
        total += len(batch)

    pgcur.close()
    pgconn.close()

    # Final checkpoint to merge WAL into main DB file
    sconn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    integrity = sconn.execute("PRAGMA integrity_check").fetchone()[0]
    sconn.close()

    elapsed = time.time() - t0
    size_mb = sqlite_path.stat().st_size / (1024 * 1024)
    print(f"\n  ✅ SQLite export: {total:,} rows in {elapsed:.1f}s ({size_mb:.1f} MB)")
    print(f"  Integrity: {integrity}")
    return str(sqlite_path)


def export_json_index(pg_params, output_dir, district_filter=None, ac_filter=None):
    """Export tiered JSON index from PostgreSQL for the web frontend."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    pgconn = get_pg_conn(pg_params)
    pgcur = pgconn.cursor()

    where_clauses = ["confidence >= 55", "voter_name_kn != ''", "voter_name_kn IS NOT NULL", "LENGTH(voter_name_kn) >= 3"]
    if district_filter:
        where_clauses.append(f"district = '{district_filter}'")
    if ac_filter:
        where_clauses.append(f"ac_num = {ac_filter}")

    where = "WHERE " + " AND ".join(where_clauses)

    print("Loading data from PostgreSQL for JSON export...")
    pgcur.execute(f"""
        SELECT district, ac_num, part_num, page_num,
               serial_no, house_no,
               voter_name_kn, voter_name_en,
               relative_name_kn, relative_name_en,
               relation_type, gender, age, voter_id,
               name_origin, search_tokens, data_quality, confidence
        FROM voters
        {where}
        ORDER BY district, ac_num, part_num, serial_no
    """)
    rows = pgcur.fetchall()
    pgconn.close()

    if not rows:
        print("No data found matching filters.")
        return

    print(f"  {len(rows):,} qualifying rows")

    # Build nested structure: district → AC → part → voters
    districts = {}
    for row in rows:
        d = row[0] or "UNKNOWN"
        ac = row[1]
        part = row[2]

        if d not in districts:
            districts[d] = {}
        if ac not in districts[d]:
            districts[d][ac] = {}
        if part not in districts[d][ac]:
            districts[d][ac][part] = []

        search_tokens = row[15]
        if isinstance(search_tokens, str):
            try:
                search_tokens = json.loads(search_tokens)
            except (json.JSONDecodeError, TypeError):
                search_tokens = []
        elif search_tokens is None:
            search_tokens = []

        voter = {
            "sn": row[4],
            "hn": row[5] or "",
            "nk": row[6] or "",
            "ne": row[7] or "",
            "rk": row[8] or "",
            "re": row[9] or "",
            "rel": row[10] or "",
            "g": row[11] or "",
            "age": row[12],
            "vid": row[13] or "",
            "st": search_tokens,
        }

        # Only include name_origin if urdu
        if row[14] == 'urdu':
            voter["origin"] = "urdu"

        districts[d][ac][part].append(voter)

    # Write master_index.json
    total_voters = len(rows)
    district_summaries = []
    for d_name in sorted(districts.keys()):
        d_acs = districts[d_name]
        d_voters = sum(len(voters) for ac in d_acs.values() for voters in ac.values())
        district_summaries.append({
            "district_code": _district_code(d_name),
            "name": d_name,
            "display_name": _district_display_name(d_name),
            "status": "live",
            "voter_count": d_voters,
            "ac_count": len(d_acs)
        })

    master = {
        "schema_version": "2.0",
        "generated_at": _generated_at(),
        "state": "KARNATAKA",
        "stats": {
            "total_voters": total_voters,
            "district_count": len(district_summaries)
        },
        "districts": district_summaries
    }
    master_path = out / "master_index.json"
    with open(master_path, 'w', encoding='utf-8') as f:
        json.dump(master, f, ensure_ascii=False, indent=2)
    print(f"  Written: {master_path}")

    # Write per-district and per-AC files
    for d_name, d_acs in districts.items():
        d_dir = out / "districts" / d_name
        d_dir.mkdir(parents=True, exist_ok=True)

        # District index
        ac_summaries = []
        for ac_num in sorted(d_acs.keys()):
            ac_parts = d_acs[ac_num]
            ac_voters = sum(len(v) for v in ac_parts.values())
            ac_summaries.append({
                "ac_num": ac_num,
                "ac_name": f"AC-{ac_num}",
                "voter_count": ac_voters,
                "part_count": len(ac_parts)
            })

        dist_index = {
            "district": d_name,
            "total_voters": sum(a["voter_count"] for a in ac_summaries),
            "acs": ac_summaries
        }
        dist_index_path = d_dir / "index.json"
        with open(dist_index_path, 'w', encoding='utf-8') as f:
            json.dump(dist_index, f, ensure_ascii=False, indent=2)
        print(f"  Written: {dist_index_path}")

        # Per-AC index and part files
        for ac_num in sorted(d_acs.keys()):
            ac_parts = d_acs[ac_num]
            ac_dir = d_dir / str(ac_num)
            ac_dir.mkdir(parents=True, exist_ok=True)

            parts_summary = []
            for part_num in sorted(ac_parts.keys()):
                voters = ac_parts[part_num]
                parts_summary.append({
                    "part_num": part_num,
                    "voter_count": len(voters)
                })

                # Write part file
                part_path = ac_dir / f"part_{part_num}.json"
                with open(part_path, 'w', encoding='utf-8') as f:
                    json.dump(voters, f, ensure_ascii=False)

            # AC index
            ac_index = {
                "district": d_name,
                "ac_num": ac_num,
                "ac_name": f"AC-{ac_num}",
                "ac_name_kn": f"AC-{ac_num}",
                "total_voters": sum(p["voter_count"] for p in parts_summary),
                "parts": parts_summary
            }
            ac_index_path = d_dir / f"{ac_num}_index.json"
            with open(ac_index_path, 'w', encoding='utf-8') as f:
                json.dump(ac_index, f, ensure_ascii=False, indent=2)
            print(f"  Written: {ac_index_path} ({len(parts_summary)} parts)")

    print(f"\n  ✅ JSON export complete: {total_voters:,} voters")


def main():
    parser = argparse.ArgumentParser(description="Export PostgreSQL electoral data to SQLite + JSON")
    parser.add_argument("--out", type=str, default="../../data/", help="Output directory")
    parser.add_argument("--sqlite-only", action="store_true", help="Only export SQLite")
    parser.add_argument("--json-only", action="store_true", help="Only export JSON index")
    parser.add_argument("--district", type=str, help="Filter by district")
    parser.add_argument("--ac", type=int, help="Filter by AC number")
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

    # Test connection
    try:
        conn = get_pg_conn(pg_params)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM voters")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT pdf_file) FROM voters")
        pdfs = cur.fetchone()[0]
        conn.close()
        print(f"PostgreSQL: {total:,} voters from {pdfs} PDFs")
    except Exception as e:
        print(f"❌ Cannot connect to PostgreSQL: {e}")
        sys.exit(1)

    t0 = time.time()

    if not args.json_only:
        export_sqlite(pg_params, args.out, args.district, args.ac)

    if not args.sqlite_only:
        export_json_index(pg_params, args.out, args.district, args.ac)

    print(f"\n{'='*60}")
    print(f"EXPORT COMPLETE in {time.time() - t0:.1f}s")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
