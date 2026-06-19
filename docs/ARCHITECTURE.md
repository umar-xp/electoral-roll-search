# Technical Architecture

## System Overview

Electoral Roll Search is a **fully static** search engine for Karnataka electoral rolls. There is no backend server — all computation happens either in the OCR pipeline (offline, one-time) or in the user's browser (at search time).

**Current Scale**: 128,259 voters | 5 ACs fully processed | 153 PDFs ingested | 33 MB SQLite | 30 MB JSON

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA PIPELINE (Offline)                       │
│                                                                     │
│  Scanned PDF ──→ Image ──→ OCR ──→ Repair ──→ SQLite ──→ JSON      │
│    (153 PDFs)   (300dpi)  (Tess.)  (4-pass)   (33 MB)   (150 parts)│
└─────────────────────────────────────┬───────────────────────────────┘
                                      │ git push
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        NETLIFY CDN (Static Host)                     │
│                                                                     │
│  master_index.json + 6 AC indexes + 150 part files + JS bundle      │
│  Domain: votersearch2002.com                                        │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client-Side)                         │
│                                                                     │
│  VoterSearchEngine → fetch JSON parts → score voters → display      │
│  (Web Worker)        (LRU cached)       (phonetic+Lev)              │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Metrics (as of June 2026)

| Metric | Value |
|--------|-------|
| Total Voters Indexed | 128,259 |
| Constituencies (ACs) Covered | 5 (Mysore District) |
| PDFs Processed | 153 |
| OCR Accuracy (name+age+gender) | 98.2% |
| Data Quality Score ≥ 1 | 99.9% of records |
| JSON Payload (total) | ~30 MB |
| Unit Tests (Vitest) | 84 passing |
| E2E Tests (Playwright) | 91 passing |
| Build Time | < 2 seconds |

### Constituencies Processed

| AC # | Name | Voters | PDFs | Status |
|------|------|--------|------|--------|
| 112 | Bannur | 21,561 | 25 | ✅ Complete |
| 114 | Krishnaraja | 11,613 | 20 | ✅ Complete |
| 117 | Chamundeshwari | 42,096 | 41 | ✅ Complete |
| 123 | Hunsur | 29,542 | 36 | ✅ Complete |
| 124 | Krishnarajanagara | 23,447 | 27 | ✅ Complete |
| 125 | Periyapatna | — | 0/112 | 🔄 Queued |
| 122 | Heggadadevankote | — | 0/129 | 🔄 Queued |
| 116 | Narasimharaja | — | 0/165 | 🔄 Queued |

---

## Data Pipeline Architecture

### Stage 1: PDF Rendering

| Property | Value |
|----------|-------|
| Input | Scanned PDF (A4, ~35 pages per part) |
| Tool | PyMuPDF (fitz) |
| Output | NumPy BGR array (300 DPI, ~2480×3508 px) |
| Why 300 DPI | Below 250, Tesseract accuracy drops significantly for Kannada |

**Page Classification**: Header region (top 200px) is checked for keywords. Pages containing "summary"/"addendum"/"revision" are skipped (saves ~15% processing time).

### Stage 2: Row Detection

| Property | Value |
|----------|-------|
| Method | Morphological operations + horizontal projection profile |
| Output | 35-45 row boundaries per page |

**Algorithm**:
1. Grayscale → binary (OTSU threshold)
2. Morphological close with horizontal kernel (1×50) → detect ruled lines
3. Horizontal projection: sum pixels per row → histogram
4. Find peaks → row boundaries
5. Gaps < 20px merged, gaps > 200px split

### Stage 3: OCR Execution

| Property | Value |
|----------|-------|
| Engine | Tesseract 5.4 |
| Mode | PSM 6, OEM 1 |
| Languages | `kan+eng` (Kannada + English) |
| Output | Word list with (text, confidence, x, y, width) |

**Multi-Pass Strategy** (per cell, when confidence < threshold):

| Pass | Preprocessing | Config |
|------|--------------|--------|
| 1 | OTSU binary, 2× upscale | PSM 6, kan+eng |
| 2 | Adaptive Gaussian, 3× upscale | PSM 7, digit whitelist |
| 3 | CLAHE contrast enhancement | PSM 7, eng only |
| 4 | Inverted image (dark backgrounds) | PSM 7, eng only |

Best confidence result wins.

### Stage 4: Column Assignment

Words are mapped to table columns by their x-center position:

| Column | x_start | x_end | Content |
|--------|---------|-------|---------|
| Serial No | 0 | 250 | Voter serial number |
| Voter Name | 510 | 970 | Full name (Kannada) |
| Relative Name | 970 | 1400 | Father/Husband/Mother |
| Age | 1840 | 2040 | Voter age |
| Voter ID | 2000 | 2500 | EPIC number |

Zones calibrated for Karnataka 2002 PDF layout at 300 DPI. Defined in `config/settings.py`.

### Stage 5: Field Cleaning

| Field | Cleaning Logic |
|-------|---------------|
| Serial | Strip non-digits, fix l→1/O→0, validate 1-9999 |
| Age | Extract digits, validate 18-120, Kannada numerals ೦-೯→0-9 |
| Voter ID | Misread map (l→1, S→5, B→8, G→6), normalize 5-6 digits |
| Gender | Normalize to ಗಂ (male) or ಹೆಂ (female) |
| Name | Remove English OCR artifacts, strip trailing junk |

### Stage 6: 4-Pass Repair

| Pass | Strategy | What It Fixes |
|------|----------|---------------|
| **1** | Initial OCR + column + cleaning | Baseline extraction |
| **2** | Re-OCR cells with confidence < 40% | Blurry/low-quality cells |
| **3** | Sequential monotonic constraint | Serial number digit errors |
| **4** | Cross-field repair (age neighbors, dual-VID) | Edge cases |

**Serial Repair Algorithm**:
```
1. Find first valid serial + row position
2. Expected serial for row i = first_serial + (i - first_row)
3. If |actual - expected| > 2: replace with expected
4. Result: 99.8% accuracy (from ~92% raw OCR)
```

### Stage 7: Transliteration

| Property | Value |
|----------|-------|
| Input | Kannada name (ಮೊಹಮ್ಮದ ಶರೀಫ್) |
| Library | indic_transliteration + 150 custom corrections |
| Output | English name (Mohammed Sharif) + search tokens |

**Custom Corrections** (examples):
- Muslim names: 100+ patterns (Khan, Begum, Ahmad variants)
- General Karnataka: 50+ patterns (Reddy, Rao, Gowda variants)
- Diacritics stripped for search-friendliness

### Stage 8: SQLite Storage

```sql
CREATE TABLE voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pdf_file TEXT,
    district TEXT,
    ac_num INTEGER,
    part_num INTEGER,
    page_num INTEGER,
    serial_no TEXT,
    house_no TEXT,
    voter_name_kn TEXT,    -- Original Kannada name
    voter_name_en TEXT,    -- Transliterated English name
    relative_name_kn TEXT,
    relative_name_en TEXT,
    relation_type TEXT,    -- F(father)/M(mother)/H(husband)/W(wife)
    gender TEXT,           -- M/F
    age INTEGER,
    voter_id TEXT,         -- EPIC number (partial in many cases)
    name_origin TEXT,      -- Transliteration source
    search_tokens TEXT,    -- Pre-computed search tokens (JSON array)
    confidence REAL,       -- OCR confidence score
    data_quality INTEGER,  -- 0=low, 1=good
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Indexes for fast lookup
CREATE INDEX idx_voters_ac ON voters(ac_num);
CREATE INDEX idx_voters_pdf ON voters(pdf_file);
CREATE INDEX idx_voters_district ON voters(district);
```

**Database Configuration:**
- WAL mode for concurrent read/write during ingestion
- Checkpoint resume: `get_completed_pdfs()` skips already-processed files
- Parallel processing: `ProcessPoolExecutor` with configurable workers (default: 4)

**Pipeline Orchestrator** (`ingest_rolls.py`):
```bash
# Single PDF
python scripts/ingest_rolls.py --pdf A1160043.pdf --db data/rolls.sqlite

# Batch directory (with parallel workers + auto-resume)
python scripts/ingest_rolls.py --dir ./data/MYSORE/AC\ 112\ -\ Bannur \
    --db data/rolls.sqlite --district MYSORE --workers 4
```

### Stage 9: JSON Index Generation

**3-Level Hierarchy** (optimized for incremental loading):

```
Level 1: master_index.json (2KB)
  → State-level summary + district list
  → Loaded once on page load

Level 2: {district}/index.json + {AC}_index.json (1-3KB each, 6 files)
  → All parts in an AC + voter counts per part
  → Loaded when user selects a district/AC

Level 3: {district}/{AC}/part_{N}.json (50-200KB each, 150 files)
  → 300-1000 voter records per file
  → Loaded on-demand during search
```

**Generated via**: `python packages/data-pipeline/scripts/generate_json_index.py --db data/rolls.sqlite --out data/`

**Compact Record Format**:
```json
{
  "sn": 142,             // serial number
  "psn": "142",          // page serial number
  "vn": "Mohammed",      // voter name (English)
  "vk": "ಮೊಹಮ್ಮದ",       // voter name (Kannada)
  "rn": "Kariappa",      // relative name (English)
  "rk": "ಕಾರಿಅಪ್ಪ",      // relative name (Kannada)
  "rt": "F",             // relation type (F/M/H/W)
  "a": 45,              // age
  "g": "M",             // gender
  "hn": "123",           // house number
  "id": "234567",        // voter EPIC ID
  "pn": 7,              // part number
  "dq": 1,              // data quality (0=low, 1=good)
  "vt": ["Mohammed"],    // search tokens (pre-computed)
  "rnt": ["Kariappa"]    // relative search tokens
}
```

---

## Frontend Architecture

### Search Engine

```javascript
const engine = new VoterSearchEngine();
await engine.init();  // Loads master_index.json

const results = await engine.globalSearch({
  voterName: "Ramesh",
  relName: "Kumar",
  age: "45",
  signal: abortController.signal,
  onProgress: (searched, total, found) => { ... }
});
```

### Search Algorithm

```
User Query
    │
    ├── Voter ID provided?
    │   └── Exact match → score 1.0
    │
    ├── Hard Filters (instant rejection):
    │   ├── Gender mismatch → reject
    │   ├── Relation type mismatch → reject
    │   └── Age difference > 2 → reject
    │
    └── Name Scoring (token-by-token):
        ├── Exact token match → 1.0
        ├── Phonetic normalized match → 0.9
        ├── Levenshtein ≤ 1 → 0.8
        ├── Levenshtein ≤ 2 → 0.6
        ├── Prefix match (≥4 chars) → 0.5
        └── No match → reject

Final Score = nameScore × 0.7 + relativeScore × 0.3
Quality penalty: dq=0 records capped at score 0.55 (appear last)
Threshold: score < 0.55 → not shown
```

### Performance Design

| Technique | Purpose | Impact |
|-----------|---------|--------|
| Web Worker | Off-main-thread search | UI responsive during 7M scans |
| LRU Cache (300 parts) | Avoid re-fetching | ~36MB max memory |
| Request Deduplication | Reuse in-flight promises | No duplicate fetches |
| Progressive Loading | Stream results | User sees results immediately |
| AbortController | Cancel stale searches | New search aborts old |
| Early Stop (Global) | 500+ results cap | Prevents full dataset scan |
| Inverted Index | O(1) token lookup | Sub-second search on indexed data |

### Error Handling

| Layer | Strategy |
|-------|----------|
| Fetch failures | 2 retries, exponential backoff (500ms, 1s) |
| Fetch timeout | AbortController @ 10s per request |
| Worker crash | Auto fallback to main-thread search |
| Invalid data | `isValidVoterRecord()` guard |
| Search timeout | 60s hard limit on global search |
| JS errors | `window.onerror` → monitor.js |

---

## Technology Choices & Rationale

| Choice | Why | Alternatives Considered |
|--------|-----|------------------------|
| Tesseract 5.4 | Best free Kannada OCR (84% conf) | EasyOCR (27-42%), Google Vision (costly) |
| PyMuPDF | Fast PDF→image, no subprocess | pdf2image (needs Poppler) |
| SQLite | Zero-config, perfect for checkpoints | PostgreSQL (overkill) |
| Static JSON | CDN-cacheable, no server | REST API (adds latency, cost) |
| Web Worker | UI stays responsive | SharedArrayBuffer (compat issues) |
| Levenshtein+Phonetic | Handles OCR errors in search | Elasticsearch (needs server) |
| Netlify | Free, auto-SSL, CDN, deploy-on-push | Vercel, S3+CloudFront |
| esbuild | 100x faster than webpack | webpack (overkill for 4 files) |
| Vanilla JS | Zero runtime dependencies | React (adds 40KB+ bundle) |
| TypeScript (check-only) | Type safety without build step | Full TS compilation |

---

## Security Architecture

| Layer | Control |
|-------|---------|
| Transport | HTTPS via Netlify (automatic TLS) |
| CSP | `script-src 'self'` — no external execution |
| XSS | `escapeHtml()` on all user input |
| Framing | `X-Frame-Options: DENY` |
| MIME | `X-Content-Type-Options: nosniff` |
| Referrer | `strict-origin-when-cross-origin` |
| Permissions | Camera, mic, geolocation disabled |
| Code Quality | ESLint: no-eval, no-new-func |
| Secrets | .env excluded from git |
| Dependencies | Minimal (esbuild + eslint dev only) |

---

## CI/CD Pipeline

```
Push/PR to main
    │
    ├── Unit Tests (Vitest × 84)
    │   └── Search utils, LRU cache, config, UI DOM utilities
    │
    ├── E2E Tests (Playwright × 91)
    │   ├── search.spec.ts (core search flows)
    │   ├── search-assessment.spec.ts (real data validation)
    │   ├── data-integrity.spec.ts (JSON data + API endpoints)
    │   ├── interactions.spec.ts (feedback, filters, pagination, keyboard)
    │   └── responsive-a11y.spec.ts (mobile, tablet, ARIA, performance)
    │
    ├── Type Checking (tsc --noEmit)
    │   └── TypeScript structural validation
    │
    ├── Linting (ESLint)
    │   └── Security rules: no-eval, no-new-func
    │
    └── Build Verification (esbuild)
        └── Ensures minified bundle compiles

On success → Netlify auto-deploys from main
```

### Test Coverage

| Category | Coverage | Notes |
|----------|----------|-------|
| Statements | 99.4% | Excludes main.ts (browser entry, tested via E2E) |
| Branches | 91.9% | Edge cases for error handling |
| Functions | 100% | All exported functions tested |
| Lines | 99.4% | Near-complete coverage |

---

## Deployment Architecture

```
GitHub (main branch)
    │
    │ webhook on push
    ▼
Netlify Build
    ├── npm ci
    ├── npm run build (esbuild → dist/)
    └── Publish: . (root directory)
         ├── index.html
         ├── dist/ (bundled JS/CSS)
         ├── data/master_index.json
         ├── data/districts/MYSORE/index.json
         ├── data/districts/MYSORE/{AC}/part_*.json
         └── _headers, robots.txt, CNAME
    │
    ▼
Netlify CDN (votersearch2002.com)
    ├── Edge Functions: rate-limit (data/*), health (/health)
    ├── Auto HTTPS + HTTP/2
    └── Brotli compression
```

### File Sizes (Production)

| Asset | Size | Notes |
|-------|------|-------|
| index.html | ~8 KB | Single page app |
| JS bundle | ~45 KB | esbuild minified |
| CSS | ~12 KB | Single stylesheet |
| JSON data (total) | ~30 MB | 150 part files, loaded on-demand |
| master_index.json | ~2 KB | Loaded on init |
| Per-part JSON | 50-200 KB | Fetched as needed |

---

## Data Quality Report

| Metric | Value | Assessment |
|--------|-------|------------|
| Records with name + age + gender | 98.2% | ✅ Excellent |
| Data quality = 1 (high confidence) | 99.9% | ✅ Excellent |
| Gender distribution | 50.2% M / 48.6% F | ✅ Normal |
| Age range | 18-120 (avg 38.4) | ✅ Valid |
| Invalid ages (<18 or >120) | 0 | ✅ Perfect |
| Has voter ID | 47.8% | ⚠️ OCR limitation on scanned PDFs |
| Garbage records (special chars) | 0.96% | ⚠️ Minor noise, mostly AC 114 |
| Names missing | 0.3% | ✅ Very low |

---

## Project Structure

```
electoral-roll-search/
├── index.html                  # Main SPA entry point
├── src/                        # TypeScript source
│   ├── main.ts                 # Browser entry point
│   ├── config.ts               # App configuration
│   ├── search-utils.ts         # Phonetic matching, scoring
│   ├── lru-cache.ts            # LRU cache implementation
│   ├── ui.ts                   # DOM utilities
│   └── types.ts                # TypeScript interfaces
├── apps/web/                   # Runtime application modules
│   ├── search-engine.js        # VoterSearchEngine class
│   ├── search-worker.js        # Web Worker for off-thread search
│   ├── indexed-search.js       # Inverted index search
│   ├── data-fetcher.js         # JSON fetcher with LRU + dedup
│   ├── ui-renderer.js          # Results rendering
│   ├── state.js                # Application state management
│   ├── monitor.js              # Error tracking
│   └── sw.js                   # Service Worker (offline support)
├── packages/data-pipeline/     # OCR ingestion pipeline
│   ├── scripts/
│   │   ├── ingest_rolls.py     # Main ingestion orchestrator
│   │   └── generate_json_index.py  # SQLite → JSON export
│   ├── lib/
│   │   ├── detect_table_ultimate.py  # Multi-pass OCR engine
│   │   └── transliteration.py       # Kannada → English
│   └── config/
│       ├── settings.py         # OCR parameters, column zones
│       └── logging_config.py   # Structured logging
├── data/
│   ├── rolls.sqlite            # Master voter database (33 MB)
│   ├── master_index.json       # State-level index
│   └── districts/MYSORE/       # Per-AC JSON part files
├── scripts/                    # Utility scripts
│   ├── build.js                # esbuild configuration
│   ├── batch_ingest_overnight.py  # Multi-AC batch runner
│   └── verify_bannur.py        # Data quality audit
├── tests/e2e/                  # Playwright E2E tests (5 spec files)
├── netlify.toml                # Netlify deployment config
├── vitest.config.ts            # Unit test configuration
└── playwright.config.ts        # E2E test configuration
```
