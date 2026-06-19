# Electoral Roll Search — Karnataka 2002

> Bilingual (Kannada + English) search engine for **7,008,618 voter records** from Karnataka's 2002 electoral rolls across **6 districts, 51 assembly constituencies**.

**Live**: [votersearch2002.com](https://votersearch2002.com)  
**Author**: Mohammed Shoaib U  
**Version**: 5.0.0  
**License**: ISC

---

## What Is This?

A free community tool that lets anyone search historical 2002 Karnataka electoral rolls by name — in English or Kannada. The original voter lists exist only as scanned PDFs on government websites. This project OCRs those PDFs and makes them instantly searchable with no server required.

**Use case**: Citizens verifying their family's 2002 voting records for the ECI SIR (Special Intensive Revision) enumeration process.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **OCR Engine** | Tesseract 5.4 (kan+eng) | Extract text from scanned PDFs |
| **Image Processing** | OpenCV + PyMuPDF | PDF rendering, row detection, preprocessing |
| **Data Pipeline** | Python 3.11+ | Multi-pass OCR, repair, transliteration |
| **Storage** | SQLite → JSON shards | Pipeline checkpointing → frontend consumption |
| **Frontend** | Vanilla JS (ES2020) | Search UI, phonetic matching, scoring |
| **Search Algorithm** | Inverted index + fuzzy matching | Levenshtein + phonetic normalization |
| **Hosting** | Netlify CDN | Static file serving, auto-SSL, global CDN |
| **Build** | esbuild | JS minification (100x faster than webpack) |
| **Testing** | Vitest + Pytest + Playwright | 92+ unit tests + E2E |
| **Types** | TypeScript (type-checking only) | Type safety without transpilation |
| **CI/CD** | GitHub Actions + Netlify auto-deploy | Auto-test, auto-deploy on push |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DATA PIPELINE (Offline, One-Time)                        │
│                                                                             │
│  Scanned PDF ──→ 300 DPI Image ──→ Row Detection ──→ Tesseract OCR         │
│     (11K)         (PyMuPDF)        (OpenCV morph)    (kan+eng, PSM 6)      │
│                                                                             │
│  ──→ Column Assignment ──→ 4-Pass Repair ──→ Transliteration ──→ SQLite    │
│      (x-position zones)   (re-OCR + seq.)   (Kannada→English)   (7M rows) │
│                                                                             │
│  ──→ JSON Shards (5,025 files) ──→ Inverted Search Index                   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ git push → Netlify CDN
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Client-Side, Zero Server)                      │
│                                                                             │
│  User types name ──→ Fetch JSON parts (LRU cached) ──→ Score voters        │
│                      (50-200KB each, on-demand)        (phonetic + Lev.)   │
│                                                                             │
│  ──→ Rank results ──→ Display (Kannada primary, English secondary)         │
│      (quality-aware)   (accessible, bilingual, mobile-first)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Live Data (June 2026)

| District | Voters | Assembly Constituencies | Status |
|----------|--------|------------------------|--------|
| Bagalkot | 784,485 | 7 | ✅ Live |
| Bangalore Rural | 1,379,890 | 9 | ✅ Live |
| Bangalore Urban | 1,120,429 | 4 | ✅ Live |
| BBMP | 1,225,426 | 12 | ✅ Live |
| Mysore | 1,421,982 | 11 | ✅ Live |
| Shivamogga | 1,076,406 | 8 | ✅ Live |
| **Total** | **7,008,618** | **51** | |

---

## Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.11+ | Data pipeline, OCR, tests |
| Tesseract OCR | 5.4+ | Optical character recognition |
| Tesseract traineddata | `kan` + `eng` | Language models for Kannada and English |
| Node.js | 18+ | Frontend build, JS/TS tests |
| npm | 9+ | Package management |

### Installation

```powershell
# 1. Clone
git clone --depth 1 https://github.com/user/electoral-roll-search.git
cd electoral-roll-search

# 2. Python dependencies
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r packages/data-pipeline/requirements.txt

# 3. Configure Tesseract
copy .env.example .env
# Edit .env → set your Tesseract paths

# 4. Node.js dependencies
npm install

# 5. Run all tests (should pass 92+)
npm test
```

### Configuration (.env)

```ini
TESSERACT_CMD=C:\Users\you\AppData\Local\Programs\Tesseract-OCR\tesseract.exe
TESSDATA_PREFIX=C:\Users\you\AppData\Local\Programs\Tesseract-OCR\tessdata
LOG_LEVEL=INFO
OCR_USE_BEST=false
```

---

## Project Structure

```
electoral-roll-search/
├── apps/web/                          # Frontend (static site)
│   ├── index.html                     #   Main search page (bilingual)
│   ├── app.js                         #   Application logic (~3200 lines)
│   ├── search-engine.js               #   VoterSearchEngine class
│   ├── indexed-search.js              #   Inverted index (O(1) lookups)
│   ├── search-worker.js               #   Web Worker (off-thread search)
│   ├── search-utils.js                #   Phonetics, Levenshtein, escaping
│   ├── data-fetcher.js                #   HTTP fetch with retry + dedup
│   ├── ui-renderer.js                 #   DOM rendering (cards, banners)
│   ├── state.js                       #   Application state management
│   ├── monitor.js                     #   Error & performance capture
│   ├── styles.css                     #   CSS (responsive, dark mode, a11y)
│   ├── sw.js                          #   Service worker (offline caching)
│   └── token-synonyms.json            #   Search token expansion
│
├── packages/data-pipeline/            # Python OCR pipeline
│   ├── config/settings.py             #   Centralized config (dataclass)
│   ├── lib/
│   │   ├── pdf_renderer.py            #   PDF → 300 DPI image
│   │   ├── row_detector.py            #   Row boundary detection
│   │   ├── ocr_engine.py              #   Tesseract multi-pass OCR
│   │   ├── column_assigner.py         #   Column zone mapping
│   │   ├── field_cleaners.py          #   Post-OCR normalization
│   │   ├── repair_passes.py           #   4-pass repair engine
│   │   ├── transliteration.py         #   Kannada → English
│   │   ├── ensemble_ocr.py            #   Multi-engine strategies
│   │   ├── pipeline_orchestrator.py   #   Checkpointed runner
│   │   └── schema_validator.py        #   Schema validation
│   ├── scripts/
│   │   ├── ingest_rolls.py            #   PDF → SQLite (main entry)
│   │   ├── generate_json_index.py     #   SQLite → JSON shards
│   │   └── generate_search_index.py   #   Build inverted index
│   └── tests/                         #   80 pytest tests
│
├── src/                               # TypeScript modules (type-checked)
│   ├── config.ts, search-utils.ts     #   Core logic with types
│   ├── lru-cache.ts                   #   Generic LRU implementation
│   └── types.ts                       #   Shared interfaces
│
├── data/                              # Live voter data (JSON shards)
│   ├── master_index.json              #   District catalog (5KB)
│   └── districts/{DIST}/{AC}/         #   part_N.json files
│
├── tests/                             # Integration + E2E tests
├── docs/                              # Technical documentation
├── netlify/edge-functions/            #   Health check, rate limiting
├── _headers                           #   Security + cache headers
├── netlify.toml                       #   Netlify build config
└── package.json                       #   Project manifest (v5.0.0)
```

---

## Running the Pipeline

### Full Pipeline (PDF → Searchable Website)

```powershell
# Step 1: Ingest PDFs into SQLite
python packages/data-pipeline/scripts/ingest_rolls.py --root .\pdfs --db .\data\rolls.sqlite --dpi 300

# Step 2: Generate JSON indexes for frontend
python packages/data-pipeline/scripts/generate_json_index.py --all

# Step 3: Build inverted search index
npm run build:index

# Step 4: Build minified frontend
npm run build

# Step 5: Deploy (auto on git push to main)
git add . && git commit -m "Update data" && git push
```

### Adding a New District

```powershell
python packages/data-pipeline/scripts/ingest_rolls.py --district NEW_DISTRICT --dpi 300
python packages/data-pipeline/scripts/generate_json_index.py --district NEW_DISTRICT
python packages/data-pipeline/scripts/show_pipeline_status.py
npm run build && git push
```

---

## Testing

```powershell
npm test                    # Full suite (49 Vitest + 43 JS + integration)
npm run test:unit           # Vitest only (49 tests)
npm run test:js             # Frontend JS tests (43 tests)
npm run test:e2e            # Playwright E2E browser tests
npm run test:py             # Python pipeline tests (80 tests)
npm run lint                # ESLint + TypeScript type checking
```

---

## Data Quality

| Metric | Accuracy | Method |
|--------|----------|--------|
| Serial numbers | **99.8%** | Sequential monotonic constraint repair |
| Ages (18-120) | **98.7%** | Re-OCR + range validation |
| Names present | **99.4%** | Kannada + English transliteration |
| Gender valid | **98.7%** | Normalized ಗಂ/ಹೆಂ detection |
| Voter IDs | **31.3%** | Source limit: 69% of cells blank in PDF |
| OCR confidence | **84.4%** | Tesseract @ 300 DPI + multi-pass |

---

## Frontend Features

- **Bilingual UI** — English + Kannada labels
- **Phonetic Search** — Handles variants (Mohammed/Mohamed/Mohd)
- **Fuzzy Matching** — Levenshtein ≤ 2 tolerance
- **Progressive Results** — Appear as data loads
- **Global Search** — All 51 ACs without selecting a district
- **Dark Mode** — Auto via system preference
- **Mobile-First** — Responsive down to 320px
- **Accessible** — ARIA, skip-link, focus-visible, reduced-motion
- **Offline** — Service Worker caches assets
- **PDF Upload** — On-device OCR for any Karnataka PDF
- **Inline Validation** — Contextual error messages
- **Enter-key Search** — Works from any input field
- **Quality Ranking** — Clean records ranked above OCR-noisy ones

---

## Security

- **XSS**: `escapeHtml()` on all dynamic content
- **CSP**: `script-src 'self'` (no external scripts)
- **Framing**: `X-Frame-Options: DENY`
- **MIME**: `X-Content-Type-Options: nosniff`
- **Linting**: `no-eval`, `no-new-func`, `no-implied-eval`
- **Zero runtime dependencies** in frontend

---

## Deployment

| Setting | Value |
|---------|-------|
| Host | Netlify CDN (global) |
| Domain | votersearch2002.com |
| SSL | Auto (Let's Encrypt) |
| Build | `npm run build` |
| Deploy | Push to `main` → auto-deploy |
| Cost | **~$10/year** (domain only) |

---

## Known Limitations

1. **Voter ID capture 31%** — Source PDFs have ~69% blank EPIC cells
2. **English names have OCR artifacts** — Kannada name is more accurate
3. **Repo size ~1.6GB** — JSON in git history; use `git clone --depth 1`

---

## Credits

- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) — Apache 2.0
- [PyMuPDF](https://pymupdf.readthedocs.io/) — AGPL/Commercial
- [OpenCV](https://opencv.org/) — Apache 2.0
- [indic-transliteration](https://github.com/indic-transliteration/indic_transliteration) — MIT
- [esbuild](https://esbuild.github.io/) — MIT
- [Vitest](https://vitest.dev/) — MIT
- [Netlify](https://netlify.com/) — Free tier
- Source data: CEO Karnataka electoral rolls (public records)
