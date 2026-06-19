# Contributing Guide

## Quick Start

```powershell
git clone --depth 1 https://github.com/user/electoral-roll-search.git
cd electoral-roll-search
npm install
pip install -r packages/data-pipeline/requirements.txt
copy .env.example .env   # Edit with your Tesseract paths
npm test                 # Must pass 92+ tests
```

---

## Code Standards

### Python (Data Pipeline)

- **Version**: Python 3.11+ required
- **Tests**: `packages/data-pipeline/tests/` — use pytest
- **Config**: `config/settings.py` (frozen dataclass, no magic strings)
- **Column zones**: `settings.COLUMN_ZONES` (not hardcoded elsewhere)
- **Logging**: `from config.logging_config import get_logger`
- **Style**: PEP 8 (enforced by CI)

### JavaScript / TypeScript (Frontend)

- **Target**: ES2020+ (no transpilation — modern browsers only)
- **TypeScript**: Type-checking only (`tsc --noEmit`), no compilation step
- **ESLint**: Security rules enforced — `no-eval`, `no-new-func`, `no-implied-eval`
- **XSS**: All user-facing text escaped via `escapeHtml()` from `search-utils.js`
- **Web Worker**: Must handle `cancel` messages gracefully
- **DOM**: No `innerHTML` with unescaped user input — use `_esc()` helper

### CSS

- **Methodology**: Utility-driven, no CSS framework
- **Dark mode**: `@media (prefers-color-scheme: dark)` overrides
- **Accessibility**: `@media (prefers-reduced-motion: reduce)` + `(forced-colors: active)`
- **Responsive**: Mobile-first (480px → 600px → 900px breakpoints)

### Commit Messages

```
feat: add fuzzy voter ID matching
fix: lower OCR confidence threshold to 40%
test: add Kannada numeral conversion tests
docs: update architecture diagram
chore: clean up debug files
data: update BAGALKOT voter records
```

---

## Running Tests

```powershell
# All tests
npm test

# Individual suites
npm run test:unit           # 49 Vitest tests (TypeScript)
npm run test:js             # 43 JS frontend tests
npm run test:integration    # Integration tests
npm run test:e2e            # Playwright browser tests
npm run test:py             # 80 Python pipeline tests
npm run lint                # ESLint + TypeScript checking
```

All tests must pass before merging to `main`.

---

## Branch Workflow

```
main ← always deployable (auto-deploys to Netlify)
  └── feature/your-feature ← work here, PR to main
```

---

## Adding Pipeline Improvements

1. Make changes in `packages/data-pipeline/lib/`
2. Add tests in `packages/data-pipeline/tests/`
3. Verify: `python -m pytest -v`
4. If changing OCR/cleaning logic, re-run on a sample PDF to validate accuracy
5. Update `docs/ARCHITECTURE.md` if the pipeline flow changes

---

## Adding Frontend Features

1. Edit files in `apps/web/`
2. If adding types: edit in `src/`, run `npm run typecheck`
3. Add tests in `tests/test_frontend.js` or `src/*.test.ts`
4. Verify: `npm test`
5. Lint: `npm run lint`
6. Build: `npm run build`

---

## Processing a New District

```powershell
# 1. Obtain PDFs from ceo.karnataka.gov.in
#    Filenames must match: A{AC_NUM}0{PART_NUM}.pdf (e.g., A1140001.pdf)

# 2. Run the pipeline
python packages/data-pipeline/scripts/ingest_rolls.py \
  --root ./new_pdfs --db ./data/rolls.sqlite --dpi 300

# 3. Generate JSON for frontend
python packages/data-pipeline/scripts/generate_json_index.py --district DISTRICT_NAME

# 4. Build search index
npm run build:index

# 5. Verify
python packages/data-pipeline/scripts/show_pipeline_status.py

# 6. Build and deploy
npm run build
git add data/
git commit -m "data: add DISTRICT_NAME"
git push
```

---

## Key Conventions

| Convention | Reason |
|-----------|--------|
| Short JSON keys (`sn`, `vn`, `vk`, `rn`, `rk`, `a`, `g`, `id`, `vt`, `rnt`) | Saves bandwidth (JSON is ~40% smaller) |
| Column zones are 300 DPI | If PDF resolution changes, update `config/settings.py` |
| No runtime dependencies in frontend | Search is self-contained vanilla JS |
| Tests must not require Tesseract | Pipeline tests mock OCR calls |
| `.env` is never committed | Machine-specific paths only |
| `_esc()` for all dynamic HTML | XSS prevention |
| `dq` field on voter records | 0 = low quality OCR, 1 = good quality |
| Pre-computed `vt`/`rnt` tokens | Avoids runtime tokenization (faster search) |

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| No React/Vue/Angular | Zero bundle overhead, instant load, no hydration |
| No REST API | No server to maintain, no cost, works offline |
| SQLite for pipeline | Crash-recoverable checkpoints without a DB server |
| LRU cache (300 parts) | Bounds memory at ~36MB while keeping searches fast |
| Web Worker for search | UI never freezes, even scanning 7M records |
| Inverted index (optional) | O(1) token lookup when index is pre-built |
| Default scope = entire AC | Users don't know their part number from 2002 |
| Phonetic normalization | OCR text has transliteration variants; fuzzy search is essential |

---

## File Size Budget

| Asset | Size | When Loaded |
|-------|------|-------------|
| `index.html` | ~15KB | Page load |
| `styles.css` | ~25KB | Page load |
| `app.js` | ~95KB | Page load |
| `search-utils.js` | ~8KB | Page load |
| `search-engine.js` | ~12KB | Page load |
| `master_index.json` | ~5KB | Page load |
| AC index | 1-3KB | On district/AC select |
| Part JSON | 50-200KB | On search (per part) |
| **Total initial load** | **~165KB** | Before first search |
