import csv
import os
from collections import defaultdict
from dataclasses import dataclass

import ingest_rolls as ir


@dataclass(frozen=True)
class DistrictTotals:
    district: str
    total_pdfs: int
    total_acs: int
    min_pdfs_per_ac: int
    max_pdfs_per_ac: int


def main() -> int:
    root_dir = os.path.abspath(".")
    pdfs = ir.find_pdfs(root_dir, min_age_seconds=0)

    counts_by_district_ac: dict[tuple[str, int], int] = defaultdict(int)
    for p in pdfs:
        counts_by_district_ac[(p.district, int(p.ac_num))] += 1

    ac_csv_path = os.path.join(root_dir, "ac_pdf_counts_all.csv")
    with open(ac_csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["district", "ac_num", "pdf_count"])
        for (district, ac_num), pdf_count in sorted(
            counts_by_district_ac.items(), key=lambda x: (x[0][0], x[0][1])
        ):
            w.writerow([district, ac_num, pdf_count])

    by_district: dict[str, list[int]] = defaultdict(list)
    for (district, _ac), pdf_count in counts_by_district_ac.items():
        by_district[district].append(int(pdf_count))

    totals: list[DistrictTotals] = []
    for district, ac_counts in by_district.items():
        totals.append(
            DistrictTotals(
                district=district,
                total_pdfs=int(sum(ac_counts)),
                total_acs=int(len(ac_counts)),
                min_pdfs_per_ac=int(min(ac_counts)),
                max_pdfs_per_ac=int(max(ac_counts)),
            )
        )

    totals_csv_path = os.path.join(root_dir, "district_pdf_totals.csv")
    with open(totals_csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["district", "total_pdfs", "total_acs", "min_pdfs_per_ac", "max_pdfs_per_ac"])
        for t in sorted(totals, key=lambda x: x.district):
            w.writerow([t.district, t.total_pdfs, t.total_acs, t.min_pdfs_per_ac, t.max_pdfs_per_ac])

    print(ac_csv_path)
    print(totals_csv_path)
    print(f"TOTAL_PDFS {len(pdfs)}")
    print(f"TOTAL_DISTRICTS {len(totals)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

