"""
Overnight Batch Ingestion — All remaining Mysore ACs
=====================================================
Processes constituencies sequentially after Hunsur completes.
The checkpoint system in ingest_rolls.py will skip already-processed PDFs.

Queue order (smallest first to get quick wins):
1. AC 124 - Krishnarajanagara (27 PDFs)
2. AC 117 - Chamundeshwari (41 PDFs)  
3. AC 125 - Periyapatna (112 PDFs)
4. AC 122 - Heggadadevankote (129 PDFs)
5. AC 116 - Narasimharaja (165 PDFs)
"""

import subprocess
import sys
import time
from datetime import datetime
DB_PATH = "data/rolls.sqlite"
DISTRICT = "MYSORE"
WORKERS = 10

# Queue: directories to process (Hunsur should already be running separately)
QUEUE = [
    "pdfs/MYSORE/AC 124 - Krishnarajanagara",
    "pdfs/MYSORE/AC 117 - Chamundeshwari",
    "pdfs/MYSORE/AC 125 - Periyapatna",
    "pdfs/MYSORE/AC 122 - Heggadadevankote",
    "pdfs/MYSORE/AC 116 - Narasimharaja",
]

def run_ingestion(directory):
    """Run the ingestion pipeline for a single directory."""
    ac_name = directory.split(" - ")[-1] if " - " in directory else directory
    print(f"\n{'='*60}")
    print(f"  STARTING: {ac_name}")
    print(f"  Directory: {directory}")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")
    
    cmd = [
        sys.executable,
        "packages/data-pipeline/scripts/ingest_rolls.py",
        "--dir", directory,
        "--db", DB_PATH,
        "--district", DISTRICT,
        "--workers", str(WORKERS),
    ]
    
    start = time.time()
    result = subprocess.run(cmd, capture_output=False)
    elapsed = time.time() - start
    
    minutes = elapsed / 60
    status = "SUCCESS" if result.returncode == 0 else f"FAILED (exit code {result.returncode})"
    
    print(f"\n{'='*60}")
    print(f"  FINISHED: {ac_name} — {status}")
    print(f"  Duration: {minutes:.1f} minutes")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")
    
    return result.returncode == 0


def main():
    print(f"╔{'═'*58}╗")
    print(f"║  OVERNIGHT BATCH INGESTION — MYSORE DISTRICT             ║")
    print(f"║  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}                        ║")
    print(f"║  Queue: {len(QUEUE)} constituencies, ~474 PDFs               ║")
    print(f"╚{'═'*58}╝")
    
    results = []
    total_start = time.time()
    
    for i, directory in enumerate(QUEUE, 1):
        print(f"\n[{i}/{len(QUEUE)}] ", end="")
        success = run_ingestion(directory)
        results.append((directory, success))
    
    # Final summary
    total_elapsed = (time.time() - total_start) / 60
    print(f"\n\n{'='*60}")
    print(f"  BATCH COMPLETE — Total time: {total_elapsed:.1f} minutes")
    print(f"  Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")
    print(f"\nResults:")
    for directory, success in results:
        name = directory.split(" - ")[-1] if " - " in directory else directory
        icon = "✓" if success else "✗"
        print(f"  {icon} {name}")
    
    failed = sum(1 for _, s in results if not s)
    if failed:
        print(f"\n  WARNING: {failed} failed. Check logs above.")
        sys.exit(1)
    else:
        print(f"\n  All {len(QUEUE)} constituencies completed successfully!")


if __name__ == "__main__":
    main()
