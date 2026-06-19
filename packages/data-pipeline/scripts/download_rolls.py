import argparse
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


AC_LIST_RAW = r"""
District 
 Constituency Name 
 Assembly Constituency Number 
 BAGALKOT 
 Jamkhandi 
 A210 
 BAGALKOT 
 Bilgi 
 A211 
 BAGALKOT 
 Mudhol 
 A212 
 BAGALKOT 
 Bagalkot 
 A213 
 BAGALKOT 
 Badami 
 A214 
 BAGALKOT 
 Gulegud 
 A215 
 BAGALKOT 
 Hungund 
 A216 
 BANGALORE RURAL 
 Kanakapura 
 A091 
 BANGALORE RURAL 
 Sathanur 
 A092 
 BANGALORE RURAL 
 Channapatna 
 A093 
 BANGALORE RURAL 
 Ramanagar 
 A094 
 BANGALORE RURAL 
 Magadi 
 A095 
 BANGALORE RURAL 
 Nelamangala 
 A096 
 BANGALORE RURAL 
 Doddaballapur 
 A097 
 BANGALORE RURAL 
 Devanahalli 
 A098 
 BANGALORE RURAL 
 Hosakote 
 A099 
 BANGALORE URBAN 
 Yelahanka 
 A088 
 BANGALORE URBAN 
 Uttarahalli 
 A089 
 BANGALORE URBAN 
 Varthur 
 A090 
 BANGALORE URBAN 
 Anekal 
 A100 
 BBMP 
 Malleshwaram 
 A076 
 BBMP 
 Rajaji Nagar 
 A077 
 BBMP 
 Gandhi Nagar 
 A078 
 BBMP 
 Chickpet 
 A079 
 BBMP 
 Binnypet 
 A080 
 BBMP 
 Chamrajpet 
 A081 
 BBMP 
 Basavanagudi 
 A082 
 BBMP 
 Jayanagar 
 A083 
 BBMP 
 Shanti Nagar 
 A084 
 BBMP 
 Shivajinagar 
 A085 
 BBMP 
 Bharathinagar 
 A086 
 BBMP 
 Jayamahal 
 A087 
 BELGAUM 
 Ramdurg 
 A192 
 BELGAUM 
 Saundatti 
 A193 
 BELGAUM 
 Bailhongal 
 A194 
 BELGAUM 
 Kittur 
 A195 
 BELGAUM 
 Khanapur 
 A196 
 BELGAUM 
 Belgaum 
 A197 
 BELGAUM 
 Uchagaon 
 A198 
 BELGAUM 
 Bagewadi 
 A199 
 BELGAUM 
 Gokak 
 A200 
 BELGAUM 
 Arabhavi 
 A201 
 BELGAUM 
 Hukkeri 
 A202 
 BELGAUM 
 Sankeshwar 
 A203 
 BELGAUM 
 Nippani 
 A204 
 BELGAUM 
 Sadalga 
 A205 
 BELGAUM 
 Chikkodi 
 A206 
 BELGAUM 
 Raibag 
 A207 
 BELGAUM 
 Kagwad 
 A208 
 BELGAUM 
 Athani 
 A209 
 BELLARY 
 Siruguppa 
 A031 
 BELLARY 
 Kurugodu 
 A032 
 BELLARY 
 Bellary 
 A033 
 BELLARY 
 Hospet 
 A034 
 BELLARY 
 Sandur 
 A035 
 BELLARY 
 Kudligi 
 A036 
 BELLARY 
 Kottur 
 A037 
 BELLARY 
 Hadagali 
 A038 
 BIDAR 
 Aurad 
 A001 
 BIDAR 
 Bhalki 
 A002 
 BIDAR 
 Hulsoor 
 A003 
 BIDAR 
 Bidar 
 A004 
 BIDAR 
 Humnabad 
 A005 
 BIDAR 
 Basavakalyan 
 A006 
 BIJAPURA 
 Muddebihal 
 A217 
 BIJAPURA 
 Huvina Hipparagi 
 A218 
 BIJAPURA 
 Basavana Bagevadi 
 A219 
 BIJAPURA 
 Tikota 
 A220 
 BIJAPURA 
 Bijapur 
 A221 
 BIJAPURA 
 Ballolli 
 A222 
 BIJAPURA 
 Indi 
 A223 
 BIJAPURA 
 Sindagi 
 A224 
 CHAMARAJANAGAR 
 Hanur 
 A110 
 CHAMARAJANAGAR 
 Kollegal 
 A111 
 CHAMARAJANAGAR 
 Santhemarahalli 
 A119 
 CHAMARAJANAGAR 
 Chamarajanagar 
 A120 
 CHAMARAJANAGAR 
 Gundlupet 
 A121 
 CHIKKAMAGALURU 
 Sringeri 
 A152 
 CHIKKAMAGALURU 
 Mudigere 
 A153 
 CHIKKAMAGALURU 
 Chikmagalur 
 A154 
 CHIKKAMAGALURU 
 Birur 
 A155 
 CHIKKAMAGALURU 
 Kadur 
 A156 
 CHIKKAMAGALURU 
 Tarikere 
 A157 
 CHITRADURGA 
 Bharamasagara 
 A043 
 CHITRADURGA 
 Chitradurga 
 A044 
 CHITRADURGA 
 Molakalmuru 
 A046 
 CHITRADURGA 
 Challakere 
 A047 
 CHITRADURGA 
 Hiriyur 
 A048 
 CHITRADURGA 
 Holalkere 
 A049 
 CHITRADURGA 
 Hosadurga 
 A050 
 DAKSHINA KANNADA 
 Sullia 
 A137 
 DAKSHINA KANNADA 
 Puttur 
 A138 
 DAKSHINA KANNADA 
 Vittla 
 A139 
 DAKSHINA KANNADA 
 Belthangady 
 A140 
 DAKSHINA KANNADA 
 Bantval 
 A141 
 DAKSHINA KANNADA 
 Mangalore 
 A142 
 DAKSHINA KANNADA 
 Ullal 
 A143 
 DAKSHINA KANNADA 
 Surathkal 
 A144 
 DAKSHINA KANNADA 
 Moodabidri 
 A151 
 DAVANGERE 
 Harapanahalli 
 A039 
 DAVANGERE 
 Harihar 
 A040 
 DAVANGERE 
 Davanagere 
 A041 
 DAVANGERE 
 Mayakonda 
 A042 
 DAVANGERE 
 Jagalur 
 A045 
 DAVANGERE 
 Channagiri 
 A158 
 DAVANGERE 
 Honnali 
 A161 
 DHARWAD 
 Dharwad Rural 
 A174 
 DHARWAD 
 Dharwad 
 A175 
 DHARWAD 
 Hubli 
 A176 
 DHARWAD 
 Hubli Rural 
 A177 
 DHARWAD 
 Kalghatgi 
 A178 
 DHARWAD 
 Kundgol 
 A179 
 DHARWAD 
 Navalgund 
 A191 
 GADAG 
 Shirahatti 
 A186 
 GADAG 
 Mundargi 
 A187 
 GADAG 
 Gadag 
 A188 
 GADAG 
 Ron 
 A189 
 GADAG 
 Nargund 
 A190 
 GULBARGA 
 Chincholi 
 A007 
 GULBARGA 
 Kamalapur 
 A008 
 GULBARGA 
 Aland 
 A009 
 GULBARGA 
 Gulbarga 
 A010 
 GULBARGA 
 Shahabad 
 A011 
 GULBARGA 
 Afzalpur 
 A012 
 GULBARGA 
 Chittapur 
 A013 
 GULBARGA 
 Sedam 
 A014 
 GULBARGA 
 Jevargi 
 A015 
 GULBARGA 
 Gurmitkal 
 A016 
 GULBARGA 
 Yadgir 
 A017 
 GULBARGA 
 Shahapur 
 A018 
 GULBARGA 
 Shorapur 
 A019 
 HASSAN 
 Belur 
 A129 
 HASSAN 
 Arsikere 
 A130 
 HASSAN 
 Gandasi 
 A131 
 HASSAN 
 Shravanabelagola 
 A132 
 HASSAN 
 Holenarasipur 
 A133 
 HASSAN 
 Arkalgud 
 A134 
 HASSAN 
 Hassan 
 A135 
 HASSAN 
 Sakleshpur 
 A136 
 HAVERI 
 Shiggaon 
 A180 
 HAVERI 
 Hangal 
 A181 
 HAVERI 
 Hirekerur 
 A182 
 HAVERI 
 Ranibennur 
 A183 
 HAVERI 
 Byadgi 
 A184 
 HAVERI 
 Haveri 
 A185 
 KODAGU 
 Virajpet 
 A126 
 KODAGU 
 Madikeri 
 A127 
 KODAGU 
 Somwarpet 
 A128 
 KOLAR 
 Gauribidanur 
 A064 
 KOLAR 
 Chikballapur 
 A065 
 KOLAR 
 Sidlaghatta 
 A066 
 KOLAR 
 Bagepalli 
 A067 
 KOLAR 
 Chintamani 
 A068 
 KOLAR 
 Srinivasapur 
 A069 
 KOLAR 
 Mulbagal 
 A070 
 KOLAR 
 Kolar Gold Field 
 A071 
 KOLAR 
 Bethamangala 
 A072 
 KOLAR 
 Kolar 
 A073 
 KOLAR 
 Vemagal 
 A074 
 KOLAR 
 Malur 
 A075 
 KOPPAL 
 Kushtagi 
 A026 
 KOPPAL 
 Yelburga 
 A027 
 KOPPAL 
 Kanakagiri 
 A028 
 KOPPAL 
 Gangawati 
 A029 
 KOPPAL 
 Koppal 
 A030 
 MANDYA 
 Nagamangala 
 A101 
 MANDYA 
 Maddur 
 A102 
 MANDYA 
 Kiragaval 
 A103 
 MANDYA 
 Malavalli 
 A104 
 MANDYA 
 Mandya 
 A105 
 MANDYA 
 Keragodu 
 A106 
 MANDYA 
 Shrirangapattana 
 A107 
 MANDYA 
 Pandavapura 
 A108 
 MANDYA 
 Krishnarajpete 
 A109 
 MYSORE 
 Bannur 
 A112 
 MYSORE 
 T. Narasipur 
 A113 
 MYSORE 
 Krishnaraja 
 A114 
 MYSORE 
 Chamaraja 
 A115 
 MYSORE 
 Narasimharaja 
 A116 
 MYSORE 
 Chamundeshwari 
 A117 
 MYSORE 
 Nanjangud 
 A118 
 MYSORE 
 Heggadadevankote 
 A122 
 MYSORE 
 Hunsur 
 A123 
 MYSORE 
 Krishnarajanagara 
 A124 
 MYSORE 
 Periyapatna 
 A125 
 RAICHUR 
 Devadurga 
 A020 
 RAICHUR 
 Raichur 
 A021 
 RAICHUR 
 Kalmala 
 A022 
 RAICHUR 
 Manvi 
 A023 
 RAICHUR 
 Lingsugur 
 A024 
 RAICHUR 
 Sindhanur 
 A025 
 SHIVAMOGGA 
 Holehonnur 
 A159 
 SHIVAMOGGA 
 Bhadravati 
 A160 
 SHIVAMOGGA 
 Shimoga 
 A162 
 SHIVAMOGGA 
 Tirthahalli 
 A163 
 SHIVAMOGGA 
 Hosanagar 
 A164 
 SHIVAMOGGA 
 Sagar 
 A165 
 SHIVAMOGGA 
 Sorab 
 A166 
 SHIVAMOGGA 
 Shikaripura 
 A167 
 TUMKUR 
 Pavagada 
 A051 
 TUMKUR 
 Sira 
 A052 
 TUMKUR 
 Kalambella 
 A053 
 TUMKUR 
 Bellavi 
 A054 
 TUMKUR 
 Madhugiri 
 A055 
 TUMKUR 
 Koratagere 
 A056 
 TUMKUR 
 Tumkur 
 A057 
 TUMKUR 
 Kunigal 
 A058 
 TUMKUR 
 Huliyurdurga 
 A059 
 TUMKUR 
 Gubbi 
 A060 
 TUMKUR 
 Turuvekere 
 A061 
 TUMKUR 
 Tiptur 
 A062 
 TUMKUR 
 Chikkanayakanahalli 
 A063 
 UDUPI 
 Kapu 
 A145 
 UDUPI 
 Udupi 
 A146 
 UDUPI 
 Brahmavar 
 A147 
 UDUPI 
 Kundapura 
 A148 
 UDUPI 
 Byndoor 
 A149 
 UDUPI 
 Karkala 
 A150 
 UTTAR KANNADA 
 Sirsi 
 A168 
 UTTAR KANNADA 
 Bhatkal 
 A169 
 UTTAR KANNADA 
 Kumta 
 A170 
 UTTAR KANNADA 
 Ankola 
 A171 
 UTTAR KANNADA 
 Karwar 
 A172 
 UTTAR KANNADA 
 Haliyal 
 A173 
""".strip()


def _clean_lines(raw: str) -> list[str]:
    lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        lines.append(stripped)
    return lines


def parse_ac_list(raw: str) -> list[dict]:
    lines = _clean_lines(raw)
    header_tokens = {"district", "constituency name", "assembly constituency number"}
    filtered = []
    for line in lines:
        if line.lower() in header_tokens:
            continue
        filtered.append(line)

    if len(filtered) % 3 != 0:
        raise ValueError(
            f"Expected rows of 3 fields (district, constituency, AC code). Got {len(filtered)} tokens."
        )

    entries = []
    for i in range(0, len(filtered), 3):
        district = filtered[i].strip()
        constituency = filtered[i + 1].strip()
        ac_code = filtered[i + 2].strip()
        if not re.fullmatch(r"A\d{1,3}", ac_code):
            raise ValueError(f"Unexpected AC code format: {ac_code!r}")
        ac_num = int(ac_code[1:])
        if ac_num <= 0:
            raise ValueError(f"Invalid AC number: {ac_code!r}")
        entries.append(
            {"district": district, "constituency": constituency, "ac_num": ac_num, "ac_code": ac_code}
        )
    return entries


def safe_path_segment(value: str) -> str:
    value = value.strip()
    value = re.sub(r'[<>:"/\\|?*]+', "_", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def build_pdf_url(district: str, ac_num: int, part_num: int) -> str:
    district_seg = urllib.parse.quote(district, safe="")
    ac_folder_seg = urllib.parse.quote(f"AC {ac_num}", safe="")
    filename = f"A{ac_num:03d}{part_num:04d}.pdf"
    return f"https://ceo.karnataka.gov.in/uploads/{district_seg}/{ac_folder_seg}/{filename}"


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def download_file(url: str, dest_path: str, timeout_s: int, retries: int) -> tuple[bool, int | None]:
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        return True, 200

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/pdf,*/*;q=0.8",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    last_status = None

    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                last_status = getattr(resp, "status", None)
                tmp_path = dest_path + ".part"
                ensure_dir(os.path.dirname(dest_path))
                with open(tmp_path, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
                os.replace(tmp_path, dest_path)
                return True, last_status
        except urllib.error.HTTPError as e:
            last_status = e.code
            if e.code == 404:
                return False, 404
            if e.code in {403, 429, 500, 502, 503, 504}:
                backoff = min(60.0, (2**attempt) + random.random())
                time.sleep(backoff)
                continue
            return False, e.code
        except urllib.error.URLError:
            backoff = min(60.0, (2**attempt) + random.random())
            time.sleep(backoff)
            continue
        except TimeoutError:
            backoff = min(60.0, (2**attempt) + random.random())
            time.sleep(backoff)
            continue

    return False, last_status


def iter_entries(entries: list[dict], district_filter: str | None, ac_filter: int | None) -> list[dict]:
    selected = []
    for e in entries:
        if district_filter and e["district"].lower() != district_filter.lower():
            continue
        if ac_filter and e["ac_num"] != ac_filter:
            continue
        selected.append(e)
    return selected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-dir", default=os.getcwd())
    parser.add_argument("--district", default=None)
    parser.add_argument("--ac", type=int, default=None)
    parser.add_argument("--start-part", type=int, default=1)
    parser.add_argument("--max-part", type=int, default=2000)
    parser.add_argument("--stop-misses", type=int, default=10)
    parser.add_argument("--min-sleep", type=float, default=0.2)
    parser.add_argument("--max-sleep", type=float, default=0.8)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    if args.start_part <= 0:
        raise ValueError("--start-part must be >= 1")
    if args.max_part < args.start_part:
        raise ValueError("--max-part must be >= --start-part")
    if args.stop_misses <= 0:
        raise ValueError("--stop-misses must be >= 1")
    if args.min_sleep < 0 or args.max_sleep < 0 or args.max_sleep < args.min_sleep:
        raise ValueError("--min-sleep/--max-sleep must be >=0 and max>=min")

    entries = parse_ac_list(AC_LIST_RAW)
    entries = iter_entries(entries, args.district, args.ac)

    if not entries:
        print("No matching entries found for the provided filters.", file=sys.stderr)
        return 2

    base_dir = os.path.abspath(args.base_dir)
    ensure_dir(base_dir)

    for entry in entries:
        district = entry["district"]
        constituency = entry["constituency"]
        ac_num = entry["ac_num"]

        district_dir = os.path.join(base_dir, safe_path_segment(district))
        ac_dir_name = safe_path_segment(f"AC {ac_num} - {constituency}")
        ac_dir = os.path.join(district_dir, ac_dir_name)
        ensure_dir(ac_dir)

        print(f"\n=== {district} / AC {ac_num} ({constituency}) ===")
        misses = 0
        downloaded_any = False

        for part in range(args.start_part, args.max_part + 1):
            url = build_pdf_url(district=district, ac_num=ac_num, part_num=part)
            filename = f"A{ac_num:03d}{part:04d}.pdf"
            dest_path = os.path.join(ac_dir, filename)

            ok, status = download_file(
                url=url, dest_path=dest_path, timeout_s=args.timeout, retries=args.retries
            )
            if ok:
                downloaded_any = True
                misses = 0
                print(f"OK  {filename}")
            else:
                if status == 404:
                    misses += 1
                    if downloaded_any and misses >= args.stop_misses:
                        print(f"STOP after {misses} consecutive 404s (last tried part {part}).")
                        break
                else:
                    misses += 1
                    print(f"ERR {filename} (HTTP {status})")
                    if downloaded_any and misses >= args.stop_misses:
                        print(f"STOP after {misses} consecutive errors (last tried part {part}).")
                        break

            if args.max_sleep > 0:
                time.sleep(random.uniform(args.min_sleep, args.max_sleep))

        if not downloaded_any:
            print("No PDFs downloaded for this AC (either no parts found or blocked).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
