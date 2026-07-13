"""
show_pipeline_status.py — Pipeline Dashboard
==============================================
Author: Mohammed Shoaib U

Shows current state of the ingestion pipeline: what's been processed,
what's pending, quality metrics, and coverage.

Usage:
    python scripts/show_pipeline_status.py --db data/rolls.sqlite
"""

import argparse
import sqlite3
import sys
from pathlib import Path


def show_status(db_path: str):
    """Print pipeline status dashboard."""
    if not Path(db_path).exists():
        print(f"Database not found: {db_path}")
        print("Run ingest_rolls.py first to create the database.")
        return
    
    conn = sqlite3.connect(db_path)
    
    # Overall stats
    total = conn.execute("SELECT COUNT(1) FROM voters").fetchone()[0]
    valid = conn.execute("SELECT COUNT(1) FROM voters WHERE data_quality=1").fetchone()[0]
    pdf_count = conn.execute("SELECT COUNT(DISTINCT pdf_file) FROM voters").fetchone()[0]
    
    print("=" * 60)
    print("  ELECTORAL ROLL PIPELINE STATUS")
    print("=" * 60)
    print(f"\n  Database:     {db_path}")
    print(f"  Total voters: {total:,}")
    print(f"  Valid (dq=1): {valid:,} ({valid/total*100:.1f}%)" if total else "")
    print(f"  PDFs processed: {pdf_count}")
    
    # Per-district breakdown
    print(f"\n{'─'*60}")
    print(f"  {'DISTRICT':<20} {'VOTERS':>10} {'ACs':>5} {'PARTS':>6} {'VALID%':>7}")
    print(f"{'─'*60}")
    
    district_stats = conn.execute("""
        SELECT district, 
               COUNT(1) as voters,
               COUNT(DISTINCT ac_num) as acs,
               COUNT(DISTINCT part_num) as parts,
               SUM(CASE WHEN data_quality=1 THEN 1 ELSE 0 END) as valid
        FROM voters
        GROUP BY district
        ORDER BY district
    """).fetchall()
    
    for row in district_stats:
        district, voters, acs, parts, valid_count = row
        pct = (valid_count / voters * 100) if voters else 0
        print(f"  {district or 'UNKNOWN':<20} {voters:>10,} {acs:>5} {parts:>6} {pct:>6.1f}%")
    
    # Quality metrics
    print(f"\n{'─'*60}")
    print("  QUALITY METRICS")
    print(f"{'─'*60}")
    
    avg_conf = conn.execute("SELECT AVG(confidence) FROM voters WHERE confidence > 0").fetchone()[0]
    urdu_count = conn.execute("SELECT COUNT(1) FROM voters WHERE name_origin='urdu'").fetchone()[0]
    with_id = conn.execute("SELECT COUNT(1) FROM voters WHERE voter_id != '' AND voter_id IS NOT NULL").fetchone()[0]
    null_age = conn.execute("SELECT COUNT(1) FROM voters WHERE age IS NULL").fetchone()[0]
    
    print(f"  Avg confidence:     {avg_conf:.1f}%" if avg_conf else "  Avg confidence:     N/A")
    print(f"  Voter IDs captured: {with_id:,} ({with_id/total*100:.1f}%)" if total else "")
    print(f"  Missing ages:       {null_age:,} ({null_age/total*100:.1f}%)" if total else "")
    print(f"  Urdu-origin names:  {urdu_count:,} ({urdu_count/total*100:.1f}%)" if total else "")
    
    # Recent activity
    print(f"\n{'─'*60}")
    print("  RECENT PDFS")
    print(f"{'─'*60}")
    
    recent = conn.execute("""
        SELECT pdf_file, COUNT(1) as voters, MIN(created_at) as started
        FROM voters
        GROUP BY pdf_file
        ORDER BY started DESC
        LIMIT 10
    """).fetchall()
    
    for pdf_file, voters, started in recent:
        print(f"  {pdf_file:<20} {voters:>6} voters  {started}")
    
    print(f"\n{'='*60}")
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Show pipeline status")
    parser.add_argument("--db", type=str, default="data/rolls.sqlite", help="SQLite database path")
    args = parser.parse_args()
    show_status(args.db)


if __name__ == "__main__":
    main()
