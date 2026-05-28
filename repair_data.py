import csv
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

REL_TYPE_PAT = re.compile(
    r"ತಂದೆ\.?|ತಂಡೆ\.?|ಗಂಡ|ತಾಯಿ|ಹೆಂಡತಿ|"
    r"\bnod\b|\bnom\b|\bdod\b|\bdora\b|"
    r"\bDO\b|\bdo\b",
    re.IGNORECASE,
)

REL_TYPE_MAP = {
    "ತಂದೆ": "F",
    "ತಂಡೆ": "F",
    "dod": "F",
    "dora": "F",
    "do": "F",
    "nod": "F",
    "nom": "F",
    "ಗಂಡ": "H",
    "ತಾಯಿ": "M",
    "tayi": "M",
    "ಹೆಂಡತಿ": "W",
}

MALE_TOKENS = {
    "ಗಂ",
    "ಗಂo",
    "ಗಣ",
    "go",
    "gam",
    "gana",
    "ga0",
    "ro",
    "rio",
}
FEMALE_TOKENS = {
    "ಹೆಂ",
    "ಹೆo",
    "hem",
    "he0",
    "bo",
}

GENDER_PAT = re.compile(
    r"ಗಂ|ಗಂo|ಗಣ|\bgo\b|\bGam\b|\bGana\b|"
    r"\bGa0\b|\bga0\b|\brio\b|\bro\b|"
    r"ಹೆಂ|ಹೆo|\bHeM\b|\bhem\b|\bhe0\b|"
    r"\bHe0\b|\bBo\b",
    re.IGNORECASE,
)

STRIP_START = re.compile(r"^[\|\s]*(ed\s+|oF\s+|Bb\s+|oF\s+Bb\s+)*", re.IGNORECASE)

REL_NORM = {
    "FATHER": "F",
    "MOTHER": "M",
    "HUSBAND": "H",
    "WIFE": "W",
    "F": "F",
    "M": "M",
    "H": "H",
    "W": "W",
}

FEMALE_NAME_ENDINGS = [
    "ಅಮ್ಮ",
    "ಬಾಯಿ",
    "ಬೇಗಂ",
    "ಬಾನು",
    "ದೇವಿ",
    "ಲಕ್ಷ್ಮಿ",
    "ವತಿ",
    "ಗೌರಿ",
    "ರಾಣಿ",
    "ಸುಮ",
    "amma",
    "avva",
    "bai",
    "begum",
    "banu",
    "devi",
    "lakshmi",
    "vathi",
    "kumari",
]


def normalise_ocr(text: str) -> str:
    """
    Replace Kannada digit zero ೦ (U+0CE6)
    with Kannada anusvara ಂ (U+0C82).
    These look identical but OCR confuses them.
    """
    return (text or "").replace("\u0CE6", "\u0C82")


def resolve_gender(token: str | None) -> str | None:
    if not token:
        return None
    t = token.lower().strip()
    if t in MALE_TOKENS or ("ಗಂ" in token) or ("ಗಣ" in token):
        return "M"
    if t in FEMALE_TOKENS or ("ಹೆಂ" in token) or ("ಹೆo" in token):
        return "F"
    return None


def normalize_rel_type(rt: str | None) -> str | None:
    if not rt:
        return None
    key = rt.upper().strip()
    return REL_NORM.get(key, rt.strip())


def infer_gender(rel_type: str | None, name_kn: str | None, existing: str | None) -> str | None:
    if existing in ("M", "F"):
        return existing
    rt = (rel_type or "").upper().strip()
    if rt in ("H", "HUSBAND"):
        return "F"
    if rt in ("W", "WIFE"):
        return "M"
    name = (name_kn or "").lower().strip()
    for e in FEMALE_NAME_ENDINGS:
        if name.endswith(e.lower()):
            return "F"
    return "M"


def detect_row_type(row: dict) -> str:
    has_rel = bool((row.get("rel_name_kn") or "").strip())
    has_type = bool((row.get("rel_type") or "").strip())
    if not has_rel and not has_type:
        return "A"
    return "B" if (has_rel or has_type) else "C"


def extract_part_serial(source_line: str | None) -> str | None:
    if not (source_line or "").strip():
        return None
    line = str(source_line).strip()
    tokens = line.split()
    if not tokens:
        return None
    first_token = tokens[0]
    if "/" in first_token:
        return None
    if re.fullmatch(r"\d{6,}", first_token or ""):
        return None
    if len(tokens) >= 2 and re.fullmatch(r"\d{5,}", tokens[1] or ""):
        return None
    if len(tokens) >= 2 and not re.search(r"\d", tokens[1]):
        return None
    m = re.match(r"^(\d+)", first_token)
    if not m:
        return None
    return m.group(1)


def parse_source_line(source_line: str | None) -> dict:
    result = {
        "serial_num": None,
        "part_serial_num": None,
        "house_num": None,
        "voter_name_kn": None,
        "relative_type": None,
        "relative_name_kn": None,
        "gender": None,
        "age": None,
        "voter_id": None,
        "confidence": 0.0,
        "parse_method": "unparsed",
    }
    if not (source_line or "").strip():
        return result

    text = normalise_ocr((source_line or "").strip().lstrip("|").strip())

    vid_m = re.search(r"\b(\d{6})\b\s*$", text)
    if vid_m:
        result["voter_id"] = vid_m.group(1)
        text = text[: vid_m.start()].strip()

    tokens = text.split(maxsplit=1)
    if tokens:
        psn = extract_part_serial(text)
        if psn:
            try:
                result["serial_num"] = int(psn)
            except Exception:
                result["serial_num"] = None
            result["part_serial_num"] = psn
            text = tokens[1] if len(tokens) > 1 else ""

    text = text.lstrip("|").strip()
    hn_m = re.match(
        r"^([\w\u0C80-\u0CFF][\w\u0C80-\u0CFF\-\/]*(?:[\-\/][\w\u0C80-\u0CFF]+)*)\s+",
        text,
    )
    if hn_m:
        candidate = hn_m.group(1)
        if re.search(r"\d", candidate):
            result["house_num"] = candidate
            text = text[hn_m.end() :]

    text = STRIP_START.sub("", text).strip()

    gender_matches = list(GENDER_PAT.finditer(text))
    if gender_matches:
        gender_m = gender_matches[-1]
        result["gender"] = resolve_gender(gender_m.group(0))
        after_gender = text[gender_m.end() :].strip()
        age_m = re.search(r"\b(\d{1,3})\b", after_gender)
        if age_m:
            age_val = int(age_m.group(1))
            if 18 <= age_val <= 100:
                result["age"] = age_val
        before_gender = text[: gender_m.start()].strip()
    else:
        age_m = re.search(r"\b(\d{1,3})\s*$", text)
        if age_m:
            age_val = int(age_m.group(1))
            if 18 <= age_val <= 100:
                result["age"] = age_val
                text = text[: age_m.start()].strip()
        before_gender = text.strip()
        result["confidence"] = 0.30
        result["parse_method"] = "no_gender_marker"

    rel_m = REL_TYPE_PAT.search(before_gender)
    if rel_m:
        voter_name = before_gender[: rel_m.start()].strip()
        rel_name = before_gender[rel_m.end() :].strip()

        token = (rel_m.group(0) or "").rstrip(".").strip()
        token_key = token.lower()
        if token in ("ತಂದೆ", "ತಂಡೆ", "ಗಂಡ", "ತಾಯಿ", "ಹೆಂಡತಿ"):
            token_key = token
        result["relative_type"] = REL_TYPE_MAP.get(token_key, "F")

        voter_name = STRIP_START.sub("", voter_name).strip()

        rel_name = re.sub(
            r"\s+(ಗಂ|ಗಣ|ಹೆಂ|go|rio|ro|Ro|Rio|Bo)\s*$",
            "",
            rel_name,
            flags=re.IGNORECASE,
        ).strip()
        rel_name = rel_name.rstrip(",").strip()

        result["voter_name_kn"] = voter_name or None
        result["relative_name_kn"] = rel_name or None

        if gender_matches:
            result["confidence"] = 0.92
            result["parse_method"] = "full_8col"
        else:
            result["confidence"] = 0.70
            result["parse_method"] = "no_gender"
    else:
        voter_name = STRIP_START.sub("", before_gender).strip()
        result["voter_name_kn"] = voter_name or None
        result["confidence"] = 0.30
        result["parse_method"] = "name_only"

    return result


def _table_columns(cur: sqlite3.Cursor, table: str) -> list[str]:
    rows = cur.execute(f"PRAGMA table_info({table})").fetchall()
    return [r[1] for r in rows]


def repair_district(db_path: str, district: str, dry_run: bool = False) -> None:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    read_cur = con.cursor()
    write_cur = con.cursor()

    extra_cols = [
        ("dq", "INTEGER DEFAULT 1"),
        ("age", "INTEGER DEFAULT -1"),
        ("gender", "TEXT"),
        ("voter_id", "TEXT"),
        ("serial_num", "INTEGER"),
        ("part_serial_num", "TEXT"),
        ("repair_type", "TEXT"),
        ("parse_method", "TEXT"),
        ("repair_confidence", "REAL"),
    ]

    if not dry_run:
        exists = write_cur.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='voter_names_clean' LIMIT 1"
        ).fetchone()
        if not exists:
            write_cur.execute("CREATE TABLE voter_names_clean AS SELECT * FROM voter_names WHERE 1=0;")

        existing_cols = set(_table_columns(write_cur, "voter_names_clean"))
        for name, ddl in extra_cols:
            if name in existing_cols:
                continue
            write_cur.execute(f"ALTER TABLE voter_names_clean ADD COLUMN {name} {ddl}")
            existing_cols.add(name)
        con.commit()

    voter_cols = _table_columns(write_cur, "voter_names")
    clean_cols = voter_cols + [c[0] for c in extra_cols]

    if not dry_run:
        write_cur.execute("DELETE FROM voter_names_clean WHERE district = ?", (district,))
        con.commit()

    read_cur.execute(
        """
        SELECT *
        FROM voter_names
        WHERE district = ?
        ORDER BY ac_num, part_num, page_num, id
        """,
        (district,),
    )

    stats = {
        "total": 0,
        "full_parse": 0,
        "partial_parse": 0,
        "age_found": 0,
        "gender_found": 0,
        "unparsed": 0,
    }
    unparsed_rows: list[dict] = []
    sample_rows: list[dict] = []

    batch: list[dict] = []
    while True:
        raw_rows = read_cur.fetchmany(5000)
        if not raw_rows:
            break
        for rr in raw_rows:
            row = dict(rr)
            stats["total"] += 1
            row["name_kn"] = normalise_ocr(row.get("name_kn") or "")
            row["rel_name_kn"] = normalise_ocr(row.get("rel_name_kn") or "")
            row["source_line"] = normalise_ocr(row.get("source_line") or "")

            row_type = detect_row_type(row)
            sl = parse_source_line(row.get("source_line") or "")
            row["dq"] = 1 if (float(sl.get("confidence") or 0.0) >= 0.70) else 0

            age_val = sl.get("age") if isinstance(sl.get("age"), int) else None
            gender_val = sl.get("gender") if isinstance(sl.get("gender"), str) else None

            if sl["confidence"] >= 0.70:
                stats["full_parse"] += 1
                if sl.get("voter_name_kn"):
                    row["name_kn"] = sl["voter_name_kn"]
                if sl.get("relative_type"):
                    row["rel_type"] = sl["relative_type"]
                if sl.get("relative_name_kn"):
                    row["rel_name_kn"] = sl["relative_name_kn"]
                if sl.get("house_num"):
                    house = str(sl["house_num"]).strip()
                    row["house_no_raw"] = house
                    row["house_no_norm"] = re.sub(r"\s+", "", house)
                row["name_en"] = None
                row["rel_name_en"] = None
            else:
                stats["partial_parse"] += 1
                row["rel_type"] = normalize_rel_type(row.get("rel_type")) or row.get("rel_type")
                row["name_en"] = None
                row["rel_name_en"] = None
                if row_type == "A":
                    stats["unparsed"] += 1
                    unparsed_rows.append(dict(row))

            row["rel_type"] = normalize_rel_type(row.get("rel_type")) or row.get("rel_type")
            row["age"] = age_val if (age_val is not None and age_val > 0) else -1
            if row["age"] > 0:
                stats["age_found"] += 1

            row["gender"] = infer_gender(row.get("rel_type"), row.get("name_kn"), gender_val)
            if row.get("gender"):
                stats["gender_found"] += 1

            row["voter_id"] = sl.get("voter_id")
            row["serial_num"] = sl.get("serial_num")
            row["part_serial_num"] = sl.get("part_serial_num")
            row["repair_type"] = row_type
            row["parse_method"] = sl.get("parse_method")
            row["repair_confidence"] = float(sl.get("confidence") or 0.0)

            if len(sample_rows) < 10:
                sample_rows.append(dict(row))

            batch.append(row)
            if not dry_run and len(batch) >= 5000:
                ph = ",".join(["?" for _ in clean_cols])
                write_cur.executemany(
                    f"INSERT INTO voter_names_clean ({','.join(clean_cols)}) VALUES ({ph})",
                    [tuple(r.get(c) for c in clean_cols) for r in batch],
                )
                con.commit()
                batch.clear()

    if not dry_run and batch:
        ph = ",".join(["?" for _ in clean_cols])
        write_cur.executemany(
            f"INSERT INTO voter_names_clean ({','.join(clean_cols)}) VALUES ({ph})",
            [tuple(r.get(c) for c in clean_cols) for r in batch],
        )
        con.commit()

    con.close()

    repo_root = Path(__file__).resolve().parent
    audit_dir = repo_root / "audit_reports"
    audit_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    if unparsed_rows and not dry_run:
        path = audit_dir / f"{district}_unparsed_{ts}.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(unparsed_rows[0].keys()))
            w.writeheader()
            w.writerows(unparsed_rows)
        print(f"Unparsed saved: {path}")

    t = max(1, int(stats["total"]))
    pfx = "[DRY RUN] " if dry_run else ""
    print(f"\n{pfx}REPAIR SUMMARY — {district}")
    print("─" * 52)
    print(f"Total rows:             {stats['total']:>8,}")
    print(
        f"Full parse (>=0.70):    {stats['full_parse']:>8,}  ({stats['full_parse'] / t * 100:.1f}%)"
    )
    print(
        f"Partial (<0.70):        {stats['partial_parse']:>8,}  ({stats['partial_parse'] / t * 100:.1f}%)"
    )
    print(f"Age recovered:          {stats['age_found']:>8,}  ({stats['age_found'] / t * 100:.1f}%)")
    print(
        f"Gender found/inferred:  {stats['gender_found']:>8,}  ({stats['gender_found'] / t * 100:.1f}%)"
    )
    print(f"Unparsed (manual):      {stats['unparsed']:>8,}  ({stats['unparsed'] / t * 100:.1f}%)")
    print("─" * 52)

    if dry_run:
        print("\nSAMPLE — first 10 rows:")
        print(f"{'name_kn':<22} {'rt':>3} {'rel_name':<20} {'g':>2} {'age':>4} {'conf':>5} {'method'}")
        print("─" * 75)
        for r in sample_rows:
            print(
                f"{str(r.get('name_kn', ''))[:21]:<22} "
                f"{str(r.get('rel_type', r.get('rel_type', '?'))):>3} "
                f"{str(r.get('rel_name_kn', ''))[:19]:<20} "
                f"{str(r.get('gender', '?')):>2} "
                f"{str(r.get('age', '?')):>4} "
                f"{str(r.get('repair_confidence', 0.0))[:5]:>5} "
                f"{str(r.get('parse_method', ''))}"
            )


def _load_pipeline_state(repo_root: Path) -> dict:
    path = repo_root / "pipeline_state.json"
    if not path.exists():
        return {}
    try:
        import json

        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def main() -> int:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--district")
    p.add_argument("--all", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--db", default=None)
    args = p.parse_args()

    repo_root = Path(__file__).resolve().parent
    db_path = args.db or str(repo_root / "data" / "rolls.sqlite")

    if args.dry_run:
        print("DRY RUN — no DB writes\n")

    if args.all:
        state = _load_pipeline_state(repo_root)
        districts = (state.get("districts") or {}).items() if isinstance(state, dict) else []
        for d, v in districts:
            parquet = (v or {}).get("parquet") if isinstance(v, dict) else None
            status = (parquet or {}).get("status") if isinstance(parquet, dict) else None
            if status == "done":
                repair_district(db_path, d, dry_run=bool(args.dry_run))
        return 0

    if args.district:
        repair_district(db_path, args.district, dry_run=bool(args.dry_run))
        return 0

    print("Use --district NAME or --all")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
