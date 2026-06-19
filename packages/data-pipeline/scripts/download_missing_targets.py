import argparse
import csv
import os
import random
import re
import ssl
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import BinaryIO


@dataclass(frozen=True)
class Target:
    district: str
    ac_num: int
    expected_pdf_count: int | None
    notes: str


def _safe_name(value: str) -> str:
    s = (value or "").strip()
    s = re.sub(r"\s+", " ", s)
    for ch in '<>:"/\\|?*':
        s = s.replace(ch, "_")
    return s.strip()


def _read_targets(csv_path: str) -> list[Target]:
    out: list[Target] = []
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            district = (row.get("district") or "").strip()
            ac_raw = (row.get("ac_num") or "").strip()
            exp_raw = (row.get("expected_pdf_count") or "").strip()
            notes = (row.get("notes") or "").strip()
            if not district or not ac_raw:
                continue
            try:
                ac_num = int(ac_raw)
            except ValueError:
                continue
            expected = None
            if exp_raw:
                try:
                    expected = int(exp_raw)
                except ValueError:
                    expected = None
            out.append(Target(district=district, ac_num=ac_num, expected_pdf_count=expected, notes=notes))
    return out


def _extract_ac_map_from_download_ps1(ps1_path: str) -> dict[tuple[str, int], str]:
    raw = open(ps1_path, "r", encoding="utf-8", errors="replace").read()
    m = re.search(r"\$AcListRaw\s*=\s*@\"([\s\S]*?)\"@", raw)
    if not m:
        raise RuntimeError("Could not locate $AcListRaw here-string in download_rolls.ps1")
    body = m.group(1)
    lines = [ln.strip() for ln in re.split(r"\r\n|\r|\n", body) if ln.strip()]
    header_tokens = {"district", "constituency name", "assembly constituency number"}
    tokens = [ln for ln in lines if ln.lower() not in header_tokens]
    if len(tokens) % 3 != 0:
        raise RuntimeError(f"Expected tokens in triples, got {len(tokens)} tokens")

    ac_map: dict[tuple[str, int], str] = {}
    for i in range(0, len(tokens), 3):
        district = tokens[i].strip()
        constituency = tokens[i + 1].strip()
        ac_code = tokens[i + 2].strip()
        if not re.fullmatch(r"A\d{1,3}", ac_code):
            continue
        ac_num = int(ac_code[1:])
        ac_map[(district.upper(), ac_num)] = constituency
    return ac_map


def _count_existing_pdfs(base_dir: str, district: str, ac_num: int) -> int:
    district_dir = os.path.join(base_dir, _safe_name(district))
    if not os.path.isdir(district_dir):
        return 0
    prefix = f"A{ac_num:03d}"
    rx = re.compile(rf"^{re.escape(prefix)}\d{{4}}\.pdf$", re.IGNORECASE)
    total = 0
    for name in os.listdir(district_dir):
        if not name.startswith(f"AC {ac_num} "):
            continue
        ac_dir = os.path.join(district_dir, name)
        if not os.path.isdir(ac_dir):
            continue
        for fn in os.listdir(ac_dir):
            if rx.match(fn):
                total += 1
    return total


def _build_url(district: str, ac_num: int, part_num: int) -> str:
    district_seg = urllib.parse.quote(district)
    ac_folder_seg = urllib.parse.quote(f"AC {ac_num}")
    filename = f"A{ac_num:03d}{part_num:04d}.pdf"
    return f"https://ceo.karnataka.gov.in/uploads/{district_seg}/{ac_folder_seg}/{filename}"


def _candidate_ac_folders(ac_num: int) -> list[str]:
    out: list[str] = []
    for v in (f"AC {ac_num}", f"AC {ac_num:02d}", f"AC {ac_num:03d}"):
        if v not in out:
            out.append(v)
    return out


def _build_url_with_folder(district: str, ac_folder: str, ac_num: int, part_num: int) -> str:
    district_seg = urllib.parse.quote(district)
    ac_folder_seg = urllib.parse.quote(ac_folder)
    filename = f"A{ac_num:03d}{part_num:04d}.pdf"
    return f"https://ceo.karnataka.gov.in/uploads/{district_seg}/{ac_folder_seg}/{filename}"


def _resolve_ac_folder(district: str, ac_num: int, timeout_sec: int) -> str:
    candidate_parts = [1, 2, 3, 4, 5, 10, 20, 50, 100]
    for ac_folder in _candidate_ac_folders(ac_num):
        for part in candidate_parts:
            url = _build_url_with_folder(district, ac_folder, ac_num, part)
            status, _ = _http_status_head(url, timeout_sec=min(10, timeout_sec))
            if status == 200:
                return ac_folder
    return f"AC {ac_num}"



def _copy_stream(src: BinaryIO, dst: BinaryIO, chunk_size: int = 1024 * 256) -> None:
    while True:
        b = src.read(chunk_size)
        if not b:
            return
        dst.write(b)


def _http_status_head(url: str, timeout_sec: int) -> tuple[int | None, str | None]:
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec, context=ctx) as resp:
            status = getattr(resp, "status", None)
            if status is None:
                return None, None
            return int(status), None
    except urllib.error.HTTPError as e:
        return int(e.code), None
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def _download_pdf(url: str, dest_path: str, timeout_sec: int, retries: int = 3) -> tuple[bool, int | None, str | None]:
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ctx = ssl.create_default_context()

    status, head_err = _http_status_head(url, timeout_sec=min(30, timeout_sec))
    if status == 404:
        return False, 404, None
    if status is not None and status != 200:
        return False, status, None
    if head_err:
        return False, None, head_err

    last_err: str | None = None
    last_status: int | None = None

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        try:
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            tmp = dest_path + ".part"
            with urllib.request.urlopen(req, timeout=timeout_sec, context=ctx) as resp:
                status2 = getattr(resp, "status", None)
                if status2 is not None and int(status2) != 200:
                    last_status = int(status2)
                    if last_status == 404:
                        return False, 404, None
                    last_err = None
                    raise RuntimeError(f"HTTP {last_status}")

                with open(tmp, "wb") as f:
                    first = resp.read(4)
                    if first != b"%PDF":
                        last_status = 200
                        last_err = "Non-PDF content (missing %PDF header)"
                        raise RuntimeError(last_err)
                    f.write(first)
                    _copy_stream(resp, f)

            os.replace(tmp, dest_path)
            return True, 200, None
        except urllib.error.HTTPError as e:
            last_status = int(e.code)
            last_err = str(e)
            if last_status == 404:
                return False, 404, None
        except Exception as e:
            last_status = last_status
            last_err = f"{type(e).__name__}: {e}"
        finally:
            try:
                if os.path.exists(dest_path + ".part"):
                    os.remove(dest_path + ".part")
            except Exception:
                pass

        if attempt < retries:
            time.sleep(1.0 + (attempt * 0.5))

    return False, last_status, last_err


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base-dir", default=".")
    p.add_argument("--targets-csv", default="missing_ac_targets.csv")
    p.add_argument("--audit-out", default="missing_ac_audit.csv")
    p.add_argument("--timeout-sec", type=int, default=120)
    p.add_argument("--max-part-cap", type=int, default=0)
    p.add_argument("--min-sleep-ms", type=int, default=50)
    p.add_argument("--max-sleep-ms", type=int, default=150)
    p.add_argument("--stop-misses", type=int, default=600)
    p.add_argument("--nohit-stop-misses", type=int, default=600)
    p.add_argument("--max-part-default", type=int, default=2500)
    p.add_argument("--extra-max-part", type=int, default=400)
    p.add_argument("--only", action="append", default=[])
    args = p.parse_args()

    base_dir = os.path.abspath(args.base_dir)
    targets = _read_targets(os.path.join(base_dir, args.targets_csv))
    if not targets:
        raise RuntimeError("No targets in missing_ac_targets.csv")

    ac_map = _extract_ac_map_from_download_ps1(os.path.join(base_dir, "download_rolls.ps1"))

    audit_rows: list[dict[str, object]] = []
    timeout_sec = int(args.timeout_sec)
    min_sleep_ms = int(args.min_sleep_ms)
    max_sleep_ms = int(args.max_sleep_ms)
    stop_misses = int(args.stop_misses)
    nohit_stop_misses = int(args.nohit_stop_misses)
    max_part_default = int(args.max_part_default)
    extra_max_part = int(args.extra_max_part)
    max_part_cap = int(args.max_part_cap or 0)

    only: set[tuple[str, int]] = set()
    for v in args.only:
        raw = (v or "").strip()
        if not raw:
            continue
        if ":" in raw:
            d, a = raw.split(":", 1)
        elif "," in raw:
            d, a = raw.split(",", 1)
        else:
            continue
        d = d.strip()
        a = a.strip()
        if not d or not a:
            continue
        try:
            ac_num = int(a)
        except ValueError:
            continue
        only.add((d.upper(), ac_num))

    if only:
        targets = [t for t in targets if (t.district.upper(), t.ac_num) in only]

    def write_audit_partial() -> None:
        audit_path = os.path.join(base_dir, args.audit_out)
        with open(audit_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "district",
                    "ac_num",
                    "local_pdf_count_before",
                    "local_pdf_count_after",
                    "downloaded_new",
                    "expected_pdf_count",
                    "still_missing_vs_expected",
                    "status",
                    "notes",
                ],
            )
            w.writeheader()
            for row in audit_rows:
                w.writerow(row)

    for idx, t in enumerate(targets, start=1):
        constituency = ac_map.get((t.district.upper(), t.ac_num), f"AC {t.ac_num}")
        district_dir = os.path.join(base_dir, _safe_name(t.district))
        ac_dir = os.path.join(district_dir, _safe_name(f"AC {t.ac_num} - {constituency}"))

        before = _count_existing_pdfs(base_dir, t.district, t.ac_num)
        if t.expected_pdf_count is not None:
            max_part = max(1, t.expected_pdf_count + extra_max_part)
        else:
            max_part = max_part_default
        if max_part_cap > 0:
            max_part = min(max_part, max_part_cap)

        skip_download = False
        if t.expected_pdf_count is not None and before >= t.expected_pdf_count:
            skip_download = True

        print(
            f"[{idx}/{len(targets)}] START district={t.district} ac={t.ac_num} before={before} expected={t.expected_pdf_count or ''} max_part={max_part}",
            flush=True,
        )

        misses = 0
        downloaded_any = False
        downloaded_new = 0

        effective_stop_misses = stop_misses
        effective_nohit_stop_misses = nohit_stop_misses
        if t.expected_pdf_count is not None:
            effective_stop_misses = min(effective_stop_misses, max(30, extra_max_part // 2))
            effective_nohit_stop_misses = min(effective_nohit_stop_misses, max(30, extra_max_part // 2))

        if not skip_download:
            ac_folder = _resolve_ac_folder(t.district, t.ac_num, timeout_sec=timeout_sec)
            for part in range(1, max_part + 1):
                filename = f"A{t.ac_num:03d}{part:04d}.pdf"
                dest_path = os.path.join(ac_dir, filename)
                if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
                    misses = 0
                    downloaded_any = True
                    continue

                url = _build_url_with_folder(t.district, ac_folder, t.ac_num, part)
                ok, status, err = _download_pdf(url, dest_path, timeout_sec)
                if ok:
                    downloaded_any = True
                    downloaded_new += 1
                    misses = 0
                    if downloaded_new <= 3 or downloaded_new % 50 == 0:
                        print(f"  HIT ac={t.ac_num} part={part:04d} total_new={downloaded_new}", flush=True)
                else:
                    misses += 1
                    if status == 404:
                        if (not downloaded_any and misses >= effective_nohit_stop_misses) or (
                            downloaded_any and misses >= effective_stop_misses
                        ):
                            break
                    else:
                        if (not downloaded_any and misses >= effective_nohit_stop_misses) or (
                            downloaded_any and misses >= effective_stop_misses
                        ):
                            break

                time.sleep(random.randint(min_sleep_ms, max_sleep_ms) / 1000.0)

        after = _count_existing_pdfs(base_dir, t.district, t.ac_num)
        still_missing = None
        if t.expected_pdf_count is not None:
            still_missing = max(0, t.expected_pdf_count - after)

        if skip_download:
            status = "ALREADY_AT_EXPECTED"
        else:
            status = "DOWNLOADED" if downloaded_new > 0 else ("NO_PDFS_FOUND" if after == 0 else "NO_NEW_PDFS")
        print(
            f"[{idx}/{len(targets)}] DONE district={t.district} ac={t.ac_num} after={after} new={downloaded_new} status={status}",
            flush=True,
        )

        audit_rows.append(
            {
                "district": t.district,
                "ac_num": t.ac_num,
                "local_pdf_count_before": before,
                "local_pdf_count_after": after,
                "downloaded_new": downloaded_new,
                "expected_pdf_count": t.expected_pdf_count,
                "still_missing_vs_expected": still_missing,
                "status": status,
                "notes": t.notes,
            }
        )
        write_audit_partial()

    audit_path = os.path.join(base_dir, args.audit_out)
    print(audit_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
