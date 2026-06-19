"""
convert_to_parquet.py — SQLite → Parquet
==========================================
Author: Mohammed Shoaib U

Converts the ingested voter data from SQLite into partitioned Parquet files
for efficient analytical queries and downstream JSON generation.

Usage:
    python scripts/convert_to_parquet.py --db data/rolls.sqlite --out data/parquet/
    python scripts/convert_to_parquet.py --db data/rolls_test.sqlite --out data/parquet_test/
"""

import argparse
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


def sqlite_to_parquet(db_path: str, output_dir: str):
    """Convert SQLite voter table to partitioned Parquet files."""
    conn = sqlite3.connect(db_path)
    
    # Read all voters
    df = pd.read_sql_query("SELECT * FROM voters", conn)
    conn.close()
    
    if df.empty:
        print("No data found in database.")
        return
    
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    
    print(f"Converting {len(df)} voters to Parquet...")
    print(f"Districts: {df['district'].nunique()}")
    print(f"ACs: {df['ac_num'].nunique()}")
    print(f"Parts: {df['part_num'].nunique()}")
    
    # Write partitioned by district and AC
    # This enables efficient per-AC queries
    table = pa.Table.from_pandas(df)
    
    # Single consolidated file (good for <1M rows)
    consolidated_path = out / "voters.parquet"
    pq.write_table(table, str(consolidated_path), compression='snappy')
    
    file_size = consolidated_path.stat().st_size
    print(f"\nWritten: {consolidated_path} ({file_size / 1024:.1f} KB)")
    
    # Also write per-AC partitioned files for incremental processing
    for (district, ac_num), group in df.groupby(['district', 'ac_num']):
        district_dir = out / "districts" / (district or "UNKNOWN")
        district_dir.mkdir(parents=True, exist_ok=True)
        
        ac_path = district_dir / f"ac_{ac_num}.parquet"
        ac_table = pa.Table.from_pandas(group.reset_index(drop=True))
        pq.write_table(ac_table, str(ac_path), compression='snappy')
    
    # Summary
    partitioned_files = list(out.rglob("districts/**/*.parquet"))
    print(f"Partitioned files: {len(partitioned_files)}")
    print(f"Output directory: {out}")
    
    # Print schema
    print(f"\nSchema:")
    for field in table.schema:
        print(f"  {field.name}: {field.type}")


def main():
    parser = argparse.ArgumentParser(description="Convert SQLite to Parquet")
    parser.add_argument("--db", type=str, default="data/rolls.sqlite", help="SQLite database path")
    parser.add_argument("--out", type=str, default="data/parquet/", help="Output directory for Parquet files")
    args = parser.parse_args()
    
    if not Path(args.db).exists():
        print(f"Error: Database not found: {args.db}")
        sys.exit(1)
    
    sqlite_to_parquet(args.db, args.out)


if __name__ == "__main__":
    main()
