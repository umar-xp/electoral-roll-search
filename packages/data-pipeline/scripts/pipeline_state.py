import datetime as dt
import json
import os
import sqlite3
import stat
import time
from pathlib import Path
from typing import Any


_SCRIPT_DIR = Path(__file__).resolve().parent
_PIPELINE_DIR = _SCRIPT_DIR.parent
_REPO_ROOT = _PIPELINE_DIR.parent.parent
_STATE_PATH = _REPO_ROOT / "pipeline_state.json"
_DEFAULT_DB_PATH = _REPO_ROOT / "data" / "rolls.sqlite"
_DEFAULT_PARQUET_DIR = _REPO_ROOT / "parquet_out"
_DEFAULT_JSON_ROOT = _REPO_ROOT / "data"


def _utc_now_z() -> str:
    return dt.datetime.utcnow().replace(tzinfo=dt.UTC).isoformat().replace("+00:00", "Z")


def _iso_z_from_mtime(path: Path) -> str:
    ts = path.stat().st_mtime
    return dt.datetime.fromtimestamp(ts, tz=dt.UTC).isoformat().replace("+00:00", "Z")


def _atomic_write_json(path: Path, data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}.{int(time.time() * 1000)}")

    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise

    try:
        for attempt in range(20):
            try:
                if path.exists():
                    try:
                        os.chmod(path, stat.S_IWRITE)
                    except OSError:
                        pass
                os.replace(tmp, path)
                return
            except PermissionError:
                time.sleep(0.05 * (attempt + 1))
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(x)
    except Exception:
        return default


def _district_key_display(district: str) -> str:
    return (district or "").upper().replace(" ", "_")


def _status_icon(status: str) -> str:
    if status in {"available", "done", "live"}:
        return "✅"
    if status in {"in_progress"}:
        return "🔄"
    if status in {"partial"}:
        return "🟨"
    if status in {"error"}:
        return "❌"
    return "⬜"


def _live_icon(frontend_status: str) -> str:
    if frontend_status == "live":
        return "🟢 YES"
    if frontend_status == "error":
        return "🔴"
    return "🔜"


def load_state() -> dict:
    if _STATE_PATH.exists():
        with _STATE_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)

    state: dict[str, Any] = {
        "schema_version": "1.0",
        "last_updated": _utc_now_z(),
        "source_sqlite": {
            "path": str(_DEFAULT_DB_PATH),
            "size_mb": 0,
            "last_modified": "",
            "total_records": 0,
        },
        "districts": {},
    }

    if _DEFAULT_DB_PATH.exists():
        state["source_sqlite"]["size_mb"] = round(_DEFAULT_DB_PATH.stat().st_size / 1024 / 1024)
        state["source_sqlite"]["last_modified"] = _iso_z_from_mtime(_DEFAULT_DB_PATH)

        try:
            conn = sqlite3.connect(str(_DEFAULT_DB_PATH))
            try:
                total = conn.execute("SELECT COUNT(1) FROM voter_names").fetchone()[0]
                state["source_sqlite"]["total_records"] = _safe_int(total, 0)
                rows = conn.execute("SELECT district, COUNT(1) FROM voter_names GROUP BY district").fetchall()
            finally:
                conn.close()

            for district, cnt in rows:
                d = str(district)
                district_upper = d.upper()
                state["districts"][district_upper] = {
                    "display_name": district_upper,
                    "sqlite": {
                        "status": "available",
                        "row_count": _safe_int(cnt, 0),
                        "extracted_at": _utc_now_z(),
                    },
                    "parquet": {"status": "not_started"},
                    "json": {"status": "not_started"},
                    "frontend_status": "coming_soon",
                    "notes": "",
                }
        except Exception:
            pass

    if _DEFAULT_PARQUET_DIR.exists():
        for p in _DEFAULT_PARQUET_DIR.glob("*.parquet"):
            district_name = p.stem.upper()
            dist = state["districts"].setdefault(
                district_name,
                {
                    "display_name": district_name,
                    "sqlite": {"status": "not_started"},
                    "parquet": {"status": "not_started"},
                    "json": {"status": "not_started"},
                    "frontend_status": "coming_soon",
                    "notes": "",
                },
            )
            dist["parquet"] = {
                "status": "done",
                "path": str(p),
                "size_mb": round(p.stat().st_size / 1024 / 1024, 1),
                "generated_at": _iso_z_from_mtime(p),
            }

    save_state(state)
    return state


def save_state(state: dict) -> None:
    state["last_updated"] = _utc_now_z()
    _atomic_write_json(_STATE_PATH, state)


def _ensure_district(state: dict, district: str) -> dict:
    district_upper = str(district).upper()
    districts = state.setdefault("districts", {})
    d = districts.get(district_upper)
    if not d:
        d = {
            "display_name": district_upper,
            "sqlite": {"status": "not_started"},
            "parquet": {"status": "not_started"},
            "json": {"status": "not_started"},
            "frontend_status": "coming_soon",
            "notes": "",
        }
        districts[district_upper] = d
    return d


def update_sqlite_status(district: str, status: str, **kwargs: Any) -> None:
    state = load_state()
    d = _ensure_district(state, district)
    d.setdefault("sqlite", {})
    d["sqlite"]["status"] = status
    d["sqlite"].update(kwargs)
    save_state(state)


def update_parquet_status(district: str, status: str, **kwargs: Any) -> None:
    state = load_state()
    d = _ensure_district(state, district)
    d.setdefault("parquet", {})
    d["parquet"]["status"] = status
    d["parquet"].update(kwargs)
    save_state(state)


def update_json_status(district: str, ac_num: int | None, part_num: int | None, status: str, **kwargs: Any) -> None:
    state = load_state()
    d = _ensure_district(state, district)
    j = d.setdefault("json", {"status": "not_started"})
    j.setdefault("acs", {})

    if ac_num is None:
        j["status"] = status
        j.update(kwargs)
        save_state(state)
        return

    ac_key = str(int(ac_num))
    ac = j["acs"].setdefault(ac_key, {"ac_index_status": "not_started", "parts": {}, "total_voters": 0})

    if part_num is None:
        ac["ac_index_status"] = status
        ac.update(kwargs)
    else:
        part_key = str(int(part_num))
        part = ac["parts"].setdefault(part_key, {"status": "not_started"})
        part["status"] = status
        part.update(kwargs)

    if status == "error":
        j["status"] = "error"
    elif j.get("status") in {"not_started", "done"}:
        j["status"] = "in_progress"
    save_state(state)


def mark_district_live(district: str) -> None:
    state = load_state()
    d = _ensure_district(state, district)
    d["frontend_status"] = "live"
    save_state(state)


def get_pending_districts() -> list[str]:
    state = load_state()
    out: list[str] = []
    for district, info in (state.get("districts") or {}).items():
        pq = (info.get("parquet") or {}).get("status", "not_started")
        js = (info.get("json") or {}).get("status", "not_started")
        if pq == "done" and js != "done":
            out.append(district)
    return sorted(out)


def get_all_live_districts() -> list[str]:
    state = load_state()
    out: list[str] = []
    for district, info in (state.get("districts") or {}).items():
        if info.get("frontend_status") == "live":
            out.append(district)
    return sorted(out)


def print_dashboard() -> None:
    state = load_state()
    districts = state.get("districts") or {}

    header = (
        "╔══════════════════╦═════════╦═════════╦════════╦════════╗\n"
        "║ District         ║ SQLite  ║ Parquet ║ JSON   ║ Live?  ║\n"
        "╠══════════════════╬═════════╬═════════╬════════╬════════╣"
    )
    print(header)

    total_live_voters = 0
    live_districts = 0

    for district in sorted(districts.keys()):
        info = districts[district] or {}
        sqlite_status = (info.get("sqlite") or {}).get("status", "not_started")
        parquet = info.get("parquet") or {}
        parquet_status = parquet.get("status", "not_started")
        parquet_size = parquet.get("size_mb")
        json_status = (info.get("json") or {}).get("status", "not_started")
        frontend_status = info.get("frontend_status", "coming_soon")

        pq_cell = _status_icon(parquet_status)
        if parquet_status == "done" and parquet_size is not None:
            pq_cell = f"{pq_cell} {parquet_size}MB"

        js_cell = _status_icon(json_status)
        if json_status == "done":
            acs = (info.get("json") or {}).get("acs") or {}
            if acs:
                js_cell = f"{js_cell} {len(acs)} ACs"

        live_cell = _live_icon(frontend_status)
        sqlite_cell = _status_icon(sqlite_status)

        disp = _district_key_display(district)[:16].ljust(16)
        sqlite_cell = sqlite_cell.ljust(7)
        pq_cell = pq_cell.ljust(7)
        js_cell = js_cell.ljust(6)
        live_cell = live_cell.ljust(6)

        print(f"║ {disp} ║ {sqlite_cell} ║ {pq_cell} ║ {js_cell} ║ {live_cell} ║")

        if frontend_status == "live":
            live_districts += 1
            total_live_voters += _safe_int(parquet.get("row_count"), 0)

    footer = "╚══════════════════╩═════════╩═════════╩════════╩════════╝"
    print(footer)
    print(f"Total live voters: {total_live_voters:,} across {live_districts} districts")
