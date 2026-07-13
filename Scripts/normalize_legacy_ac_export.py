#!/usr/bin/env python3
"""
Normalize a legacy AC JSON export into the current Schema 2.0 shard layout.

Example:
    python scripts/normalize_legacy_ac_export.py ^
      --source-district-dir "data/districts/BANGALORE URBAN" ^
      --district-code BANGALORE_URBAN ^
      --ac 88 ^
      --out tmp/yelahanka_schema2
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


WORD_TOKEN_RE = re.compile(r"[^A-Za-z\u200C\u200D]+")


def clean_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_age(value):
    text = clean_text(value)
    if not text:
        return None
    digits = re.sub(r"\D+", "", text)
    if not digits:
        return None
    try:
        age = int(digits)
    except ValueError:
        return None
    return age if 18 <= age <= 120 else None


def normalize_voter_id(value):
    text = clean_text(value)
    if not text:
        return None
    return text or None


def tokenize(text: str) -> list[str]:
    tokens = []
    for token in WORD_TOKEN_RE.split(clean_text(text)):
        if len(token) >= 3:
            tokens.append(token)
    return tokens


def normalize_gender(value):
    text = clean_text(value).upper()
    if text in {"M", "F"}:
        return text
    if text.startswith("MALE"):
        return "M"
    if text.startswith("FEMALE"):
        return "F"
    return ""


def normalize_record(record: dict, part_num: int) -> dict:
    sn = record.get("sn")
    psn = clean_text(record.get("psn")) or (str(sn) if sn not in (None, "") else "")
    vn = clean_text(record.get("ne"))
    vk = clean_text(record.get("nk"))
    rn = clean_text(record.get("re"))
    rk = clean_text(record.get("rk"))

    return {
        "sn": sn,
        "psn": psn,
        "vn": vn,
        "vk": vk,
        "rn": rn,
        "rk": rk,
        "rt": clean_text(record.get("rel")),
        "g": normalize_gender(record.get("g")),
        "a": normalize_age(record.get("age")),
        "hn": clean_text(record.get("hn")),
        "id": normalize_voter_id(record.get("vid")),
        "pn": part_num,
        "dq": 1 if (vn or vk) else 0,
        "cf": None,
        "vt": tokenize(vn),
        "rnt": tokenize(rn),
    }


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload, *, indent=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))


def build_ac(source_district_dir: Path, output_district_dir: Path, district_code: str, ac_num: int):
    legacy_index_path = source_district_dir / f"{ac_num}_index.json"
    legacy_index = load_json(legacy_index_path)
    ac_name = clean_text(legacy_index.get("ac_name")) or f"AC-{ac_num}"
    ac_name_kn = clean_text(legacy_index.get("ac_name_kn")) or ac_name

    legacy_part_dir = source_district_dir / str(ac_num)
    output_part_dir = output_district_dir / str(ac_num)

    total_voters = 0
    parts = []
    for part_info in legacy_index.get("parts", []):
        part_num = int(part_info["part_num"])
        legacy_part_path = legacy_part_dir / f"part_{part_num}.json"
        raw_records = load_json(legacy_part_path)
        if not isinstance(raw_records, list):
            raise ValueError(f"{legacy_part_path} is not a legacy part array")

        voters = [normalize_record(record, part_num) for record in raw_records]
        part_payload = {
            "meta": {
                "district": district_code,
                "ac_num": ac_num,
                "ac_name": ac_name,
                "part_num": part_num,
                "voter_count": len(voters),
            },
            "voters": voters,
        }
        write_json(output_part_dir / f"part_{part_num}.json", part_payload)
        total_voters += len(voters)
        parts.append({"part_num": part_num, "voter_count": len(voters)})

    ac_index = {
        "district": district_code,
        "ac_num": ac_num,
        "ac_name": ac_name,
        "ac_name_kn": ac_name_kn,
        "total_voters": total_voters,
        "parts": parts,
    }
    write_json(output_district_dir / f"{ac_num}_index.json", ac_index)

    return {
        "ac_num": ac_num,
        "ac_name": ac_name,
        "voter_count": total_voters,
        "part_count": len(parts),
    }


def main():
    parser = argparse.ArgumentParser(description="Normalize a legacy AC export into Schema 2.0 shard layout")
    parser.add_argument("--source-district-dir", required=True, help="Legacy district directory, e.g. data/districts/BANGALORE URBAN")
    parser.add_argument("--district-code", required=True, help="Output district code/path, e.g. BANGALORE_URBAN")
    parser.add_argument("--ac", required=True, nargs="+", type=int, help="AC number(s) to normalize")
    parser.add_argument("--out", required=True, help="Output root directory")
    args = parser.parse_args()

    source_district_dir = Path(args.source_district_dir)
    output_root = Path(args.out)
    output_district_dir = output_root / "districts" / args.district_code

    ac_summaries = []
    for ac_num in sorted(set(args.ac)):
        ac_summaries.append(build_ac(source_district_dir, output_district_dir, args.district_code, ac_num))

    district_total = sum(ac["voter_count"] for ac in ac_summaries)
    district_index = {
        "district": args.district_code,
        "total_voters": district_total,
        "acs": ac_summaries,
    }
    write_json(output_district_dir / "index.json", district_index)

    master_index = {
        "schema_version": "2.0",
        "generated_at": "legacy-normalized",
        "state": "KARNATAKA",
        "stats": {
            "total_voters": district_total,
            "district_count": 1,
        },
        "districts": [
            {
                "district_code": args.district_code,
                "name": args.district_code,
                "display_name": args.district_code.replace("_", " ").title(),
                "status": "staged",
                "voter_count": district_total,
                "ac_count": len(ac_summaries),
            }
        ],
    }
    write_json(output_root / "master_index.json", master_index, indent=2)

    print(f"Normalized district {args.district_code} -> {output_root}")
    print(f"  ACs: {len(ac_summaries)}")
    print(f"  Total voters: {district_total}")


if __name__ == "__main__":
    main()
