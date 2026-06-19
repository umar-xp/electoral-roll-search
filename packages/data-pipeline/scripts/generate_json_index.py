"""
generate_json_index.py — SQLite → Tiered JSON Index
=====================================================
Author: Mohammed Shoaib U

Generates the JSON files used by the web frontend:
  - data/master_index.json (district list)
  - data/districts/{DISTRICT}/index.json (AC list per district)
  - data/districts/{DISTRICT}/{AC}_index.json (part list per AC)
  - data/districts/{DISTRICT}/{AC}/part_{PART}.json (voter data)

Output format matches existing schema used by apps/web/index.html.

Usage:
    python scripts/generate_json_index.py --db data/rolls.sqlite --out data/
    python scripts/generate_json_index.py --db data/rolls_test.sqlite --out data_test/
"""

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

# Characters that indicate OCR garbage in a name field
_GARBAGE_CHARS = re.compile(r'[!@#$%^&*()=+\[\]{}<>\\|;:"\',?/~`]')


def _is_garbage_name(name: str) -> bool:
    """Return True if name has 3+ special characters (OCR garbage)."""
    if not name:
        return False
    return len(_GARBAGE_CHARS.findall(name)) >= 3


def generate_json_index(db_path: str, output_dir: str):
    """Generate tiered JSON files from SQLite."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    
    # Get all data grouped by district > AC > part
    districts = {}
    rows = conn.execute("""
        SELECT district, ac_num, part_num, page_num,
               serial_no, house_no, 
               voter_name_kn, voter_name_en,
               relative_name_kn, relative_name_en,
               relation_type, gender, age, voter_id,
               relation_type, gender, age, voter_id,
               name_origin, search_tokens, data_quality, confidence
        FROM voters
        WHERE confidence >= 55
          AND voter_name_kn != '' AND voter_name_kn IS NOT NULL
          AND LENGTH(voter_name_kn) >= 3
        ORDER BY district, ac_num, part_num, serial_no
    """).fetchall()
    conn.close()
    
    if not rows:
        print("No data found.")
        return
    
    # Build nested structure
    for row in rows:
        d = row['district'] or "UNKNOWN"
        ac = row['ac_num']
        part = row['part_num']
        
        if d not in districts:
            districts[d] = {}
        if ac not in districts[d]:
            districts[d][ac] = {}
        if part not in districts[d][ac]:
            districts[d][ac][part] = []
        
        # Parse search tokens from JSON string
        try:
            search_tokens = json.loads(row['search_tokens']) if row['search_tokens'] else []
        except (json.JSONDecodeError, TypeError):
            search_tokens = []
        
        # Determine data quality — downgrade if name is garbage
        dq = row['data_quality']
        voter_name_kn = row['voter_name_kn'] or ""
        voter_name_en = row['voter_name_en'] or ""
        if _is_garbage_name(voter_name_kn) or _is_garbage_name(voter_name_en):
            dq = 0
        
        # Build voter tokens (split voter_name_en into words, strip punctuation)
        vt = [re.sub(r'[^a-zA-Z\u200C\u200D]', '', t) for t in voter_name_en.split()]
        vt = [t for t in vt if len(t) >= 3]
        rnt = [re.sub(r'[^a-zA-Z\u200C\u200D]', '', t) for t in (row['relative_name_en'] or '').split()]
        rnt = [t for t in rnt if len(t) >= 3]
        
        voter = {
            "sn": row['serial_no'],
            "psn": str(row['serial_no']) if row['serial_no'] else "",
            "vn": voter_name_en,
            "vk": voter_name_kn,
            "rn": row['relative_name_en'] or "",
            "rk": row['relative_name_kn'] or "",
            "rt": row['relation_type'] or "",
            "g": row['gender'] or "",
            "a": row['age'],
            "hn": row['house_no'] or "",
            "id": row['voter_id'] if row['voter_id'] else None,
            "pn": part,
            "dq": dq,
            "cf": round(row['confidence'], 0) if row['confidence'] else None,
            "vt": vt,
            "rnt": rnt
        }
        districts[d][ac][part].append(voter)
    
    # Write files
    total_files = 0
    master_districts = []
    
    for district, acs in sorted(districts.items()):
        district_dir = out / "districts" / district
        district_dir.mkdir(parents=True, exist_ok=True)
        
        district_total = 0
        ac_list = []
        
        for ac_num, parts in sorted(acs.items()):
            ac_dir = district_dir / str(ac_num)
            ac_dir.mkdir(parents=True, exist_ok=True)
            
            ac_total = 0
            part_list = []
            
            for part_num, voters in sorted(parts.items()):
                # Write part file
                part_data = {
                    "meta": {
                        "district": district,
                        "ac_num": ac_num,
                        "ac_name": f"AC-{ac_num}",
                        "part_num": part_num,
                        "voter_count": len(voters)
                    },
                    "voters": voters
                }
                
                part_path = ac_dir / f"part_{part_num}.json"
                with open(part_path, 'w', encoding='utf-8') as f:
                    json.dump(part_data, f, ensure_ascii=False, separators=(',', ':'))
                total_files += 1
                ac_total += len(voters)
                part_list.append({"part_num": part_num, "voter_count": len(voters)})
            
            # Write AC index
            ac_index = {
                "district": district,
                "ac_num": ac_num,
                "ac_name": f"AC-{ac_num}",
                "ac_name_kn": f"AC-{ac_num}",
                "total_voters": ac_total,
                "parts": part_list
            }
            
            ac_index_path = district_dir / f"{ac_num}_index.json"
            with open(ac_index_path, 'w', encoding='utf-8') as f:
                json.dump(ac_index, f, ensure_ascii=False, separators=(',', ':'))
            total_files += 1
            
            district_total += ac_total
            ac_list.append({
                "ac_num": ac_num,
                "ac_name": f"AC-{ac_num}",
                "total_voters": ac_total,
                "parts_count": len(parts)
            })
        
        # Write district index
        district_index = {
            "district": district,
            "total_voters": district_total,
            "acs": ac_list
        }
        
        district_index_path = district_dir / "index.json"
        with open(district_index_path, 'w', encoding='utf-8') as f:
            json.dump(district_index, f, ensure_ascii=False, separators=(',', ':'))
        total_files += 1
        
        master_districts.append({
            "name": district,
            "total_voters": district_total,
            "ac_count": len(acs)
        })
    
    # Write master index
    master_index = {
        "state": "KARNATAKA",
        "total_voters": sum(d["total_voters"] for d in master_districts),
        "districts": master_districts
    }
    
    master_path = out / "master_index.json"
    with open(master_path, 'w', encoding='utf-8') as f:
        json.dump(master_index, f, ensure_ascii=False, indent=2)
    total_files += 1
    
    print(f"Generated {total_files} JSON files in {out}/")
    print(f"  Districts: {len(master_districts)}")
    print(f"  Total voters: {master_index['total_voters']}")
    for d in master_districts:
        print(f"    {d['name']}: {d['total_voters']} voters, {d['ac_count']} ACs")


def main():
    parser = argparse.ArgumentParser(description="Generate JSON index from SQLite")
    parser.add_argument("--db", type=str, default="data/rolls.sqlite", help="SQLite database path")
    parser.add_argument("--out", type=str, default="data/", help="Output directory for JSON files")
    args = parser.parse_args()
    
    if not Path(args.db).exists():
        print(f"Error: Database not found: {args.db}")
        sys.exit(1)
    
    generate_json_index(args.db, args.out)


if __name__ == "__main__":
    main()
