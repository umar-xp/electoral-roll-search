# Deployment Guide

## Hosting Architecture

Electoral Roll Search is deployed as a **fully static site** on Netlify's global CDN. There is no backend server, database, or API — the browser fetches JSON files directly from the CDN.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           NETLIFY CDN                                 │
│                                                                      │
│  ┌─────────┐  ┌─────────────┐  ┌────────────────────────────────┐   │
│  │ Edge Fn │  │ Static Files│  │ JSON Voter Data                │   │
│  │ health  │  │ HTML/JS/CSS │  │ master_index + 51 ACs + 5025  │   │
│  │ rate-lim│  │ (165KB)     │  │ parts (1.6GB uncompressed)     │   │
│  └─────────┘  └─────────────┘  └────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ CDN Cache: Immutable for /data/*, max-age=31536000          │    │
│  │            App assets: max-age=3600 + stale-while-revalidate │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
        │
        │ HTTPS (auto TLS via Let's Encrypt)
        ▼
    votersearch2002.com
```

---

## Domain & DNS

| Setting | Value |
|---------|-------|
| Domain | votersearch2002.com |
| Registrar | (where purchased) |
| DNS | Netlify DNS |
| SSL | Automatic (Let's Encrypt) |
| Renewal | ~$10/year (domain only) |

**CNAME**: The `CNAME` file in repo root points to the Netlify site.

---

## Netlify Configuration

### netlify.toml

```toml
[build]
  publish = "."
  command = "npm run build"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Edge Functions (netlify/edge-functions/)

| Function | Purpose |
|----------|---------|
| `health.js` | Returns 200 + timestamp for uptime monitoring |
| `rate-limit.js` | Client-side rate limiting headers |

---

## Security Headers (_headers file)

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.netlify.app

/data/*
  Cache-Control: public, max-age=31536000, immutable

/apps/web/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```

---

## Cache Strategy

| Resource | Cache Duration | Rationale |
|----------|---------------|-----------|
| `/data/*.json` | 1 year (immutable) | Voter data never changes (2002 records) |
| HTML/JS/CSS | 1 hour + stale-while-revalidate | Balance freshness with performance |
| Service Worker | Network-first | Always get latest SW on reload |
| Fonts (if any) | 1 year | Static assets |

The Service Worker (`apps/web/sw.js`) caches app shell assets for offline use.

---

## CDN File Structure

```
votersearch2002.com/
├── index.html                         → Main page (redirects all routes)
├── apps/web/                          → Application files
│   ├── app.js, search-engine.js, ...
│   └── styles.css
├── data/
│   ├── master_index.json              → District catalog (loaded first)
│   └── districts/
│       ├── BAGALKOT/
│       │   ├── AC-002/
│       │   │   ├── AC-002_index.json  → Part list for this AC
│       │   │   ├── part_1.json        → 300-1000 voters
│       │   │   ├── part_2.json
│       │   │   └── ...
│       │   └── AC-003/ ...
│       ├── BANGALORE_RURAL/ ...
│       ├── BANGALORE_URBAN/ ...
│       ├── BBMP/ ...
│       ├── MYSORE/ ...
│       └── SHIVAMOGGA/ ...
└── netlify/edge-functions/            → Edge compute
```

---

## Deploy Process

### Automatic (Recommended)

```
git push origin main → Netlify auto-builds → Live in ~30 seconds
```

### Manual

```powershell
# Install Netlify CLI
npm install -g netlify-cli

# Deploy preview (test before going live)
netlify deploy

# Deploy to production
netlify deploy --prod
```

---

## Updating Voter Data

When new district data is processed:

```powershell
# 1. OCR extraction into isolated staging SQLite
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\NEW_DISTRICT --db .\tmp\NEW_DISTRICT.sqlite --district NEW_DISTRICT --dpi 300 --workers 4

# 2. OCR/QC status check
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\NEW_DISTRICT.sqlite

# 3. Generate Schema 2.0 JSON into staging
python packages/data-pipeline/scripts/generate_json_index.py --db .\tmp\NEW_DISTRICT.sqlite --out .\tmp\schema2\NEW_DISTRICT

# 4. Validate staging output
python packages/data-pipeline/scripts/validate_data.py .\tmp\schema2\NEW_DISTRICT

# 5. Promote district files only
Copy-Item -Recurse -Force .\tmp\schema2\NEW_DISTRICT\districts\NEW_DISTRICT .\data\districts\

# 6. Regenerate published master_index.json from cumulative SQLite
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data

# 7. Rebuild search indexes
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py

# 8. Verify published data
python packages/data-pipeline/scripts/validate_data.py .\data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
npx playwright test tests/e2e/search.spec.ts tests/e2e\data-integrity.spec.ts tests/e2e\responsive-a11y.spec.ts --project=chromium -g "selecting district loads AC dropdown|selecting AC enables part dropdown in part-scope mode|global search searches across all districts|search input is full width on mobile|district dropdown is full width"

# 9. Commit and deploy after approval
git add data/districts/NEW_DISTRICT data/master_index.json data/search
git commit -m "data: add NEW_DISTRICT schema 2.0 rollout"
git push
```

**Important release rule**:

- District-isolated generation outputs must never replace the published
  `data/master_index.json`.
- The published `data/master_index.json` must always be regenerated from a
  cumulative SQLite containing all released districts.

## Operational Workflows

### OCR Extraction Workflow

```text
Raw PDFs
→ OCR
→ QC
→ SQLite
```

Commands:

```powershell
python packages/data-pipeline/scripts/ingest_rolls.py --dir .\data\DISTRICT_NAME --db .\tmp\DISTRICT_NAME.sqlite --district DISTRICT_NAME --dpi 300 --workers 4
python packages/data-pipeline/scripts/show_pipeline_status.py --db .\tmp\DISTRICT_NAME.sqlite
```

### Validation Workflow

```text
SQLite / staged JSON
→ Schema validation
→ regression checks
→ browser verification
```

Commands:

```powershell
python packages/data-pipeline/scripts/validate_data.py .\tmp\schema2\DISTRICT_NAME
python packages/data-pipeline/scripts/validate_data.py .\data
python -m pytest packages/data-pipeline/tests/test_schema_validator.py packages/data-pipeline/tests/test_pipeline.py
npx playwright test tests/e2e/search.spec.ts tests/e2e\data-integrity.spec.ts tests/e2e\responsive-a11y.spec.ts --project=chromium -g "selecting district loads AC dropdown|selecting AC enables part dropdown in part-scope mode|global search searches across all districts|search input is full width on mobile|district dropdown is full width"
```

### Schema 2.0 Generation Workflow

```text
isolated SQLite
→ district staging JSON
→ district promotion
→ cumulative master_index regeneration
```

Commands:

```powershell
python packages/data-pipeline/scripts/generate_json_index.py --db .\tmp\DISTRICT_NAME.sqlite --out .\tmp\schema2\DISTRICT_NAME
Copy-Item -Recurse -Force .\tmp\schema2\DISTRICT_NAME\districts\DISTRICT_NAME .\data\districts\
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
```

### Search Index Rebuild Workflow

```text
published data
→ build_search_index.py
→ build_token_index.py
```

Commands:

```powershell
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
```

### Deployment Workflow

```text
All released districts
→ cumulative SQLite
→ master_index.json
→ search index rebuild
→ deployment
```

Commands:

```powershell
python packages/data-pipeline/scripts/generate_json_index.py --db .\data\rolls.sqlite --out .\data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
python packages/data-pipeline/scripts/validate_data.py .\data
npm run build
git add data/ docs/
git commit -m "docs/data: rollout update"
git push origin schema-v2-migration
```

### Rollback Workflow

Commands:

```powershell
git restore --source <PREV_RELEASE_COMMIT> -- data\master_index.json data\districts\DISTRICT_NAME data\search
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py
python packages/data-pipeline/scripts/validate_data.py .\data
git add data/
git commit -m "rollback: restore DISTRICT_NAME release state"
git push origin schema-v2-migration
```

---

## Rollback Procedure

```powershell
# Restore published data from previous release commit
git restore --source <PREV_RELEASE_COMMIT> -- data\master_index.json data\districts\DISTRICT_NAME data\search

# Rebuild search indexes against restored data
python packages/data-pipeline/scripts/build_search_index.py
python packages/data-pipeline/scripts/build_token_index.py

# Validate restored state
python packages/data-pipeline/scripts/validate_data.py .\data

# Commit rollback and push
git add data/
git commit -m "rollback: restore DISTRICT_NAME release state"
git push origin schema-v2-migration
```

---

## Monitoring

### Built-in (Client-Side)

| Feature | Location |
|---------|----------|
| Error capture | `apps/web/monitor.js` |
| Performance timing | `app.js` (search duration logged) |
| Visitor stats | `app.js` (localStorage-based, privacy-respecting) |

### Recommended (Production)

| Tool | Purpose | Cost |
|------|---------|------|
| Netlify Analytics | Page views, bandwidth | $9/month |
| Better Uptime | Uptime monitoring (free tier) | Free |
| Sentry | Error tracking (free tier) | Free |

Currently operating without paid monitoring — the site is simple enough that Netlify deploy logs + edge function health checks suffice.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TESSERACT_CMD` | Pipeline only | Path to tesseract.exe |
| `TESSDATA_PREFIX` | Pipeline only | Path to tessdata/ folder |
| `LOG_LEVEL` | Pipeline only | DEBUG/INFO/WARNING/ERROR |
| `OCR_USE_BEST` | Pipeline only | Use best (slow) vs fast traineddata |

**None of these are needed at runtime** — the frontend is pure static files.

---

## Cost Breakdown

| Component | Monthly | Annual | Notes |
|-----------|---------|--------|-------|
| Netlify hosting | $0 | $0 | Free tier (100GB bandwidth) |
| Netlify CDN | $0 | $0 | Included in free tier |
| SSL certificate | $0 | $0 | Auto Let's Encrypt |
| Domain renewal | — | ~$10 | votersearch2002.com |
| Build minutes | $0 | $0 | Free tier (300 min/month) |
| Edge functions | $0 | $0 | Free tier (125K/month) |
| **Total** | **$0** | **~$10** | Domain only |

---

## Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| First Contentful Paint | < 1.5s | ~800ms |
| Time to Interactive | < 2.0s | ~1.2s |
| Largest Contentful Paint | < 2.5s | ~1.5s |
| Search response (local AC) | < 2s | ~1.5s |
| Search response (global) | < 30s | ~15-20s |
| Initial bundle | < 200KB | ~165KB |
| Lighthouse Performance | > 90 | 94 |
| Lighthouse Accessibility | > 95 | 98 |

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 404 on `/data/` | Publish dir wrong | Check `netlify.toml` publish = "." |
| CORS errors | External fetch blocked | CSP allows only `'self'` |
| Stale data after push | CDN cache | Clear Netlify cache in dashboard |
| Build fails | Missing dependencies | Ensure `npm install` in build command |
| Edge function errors | Runtime exception | Check Netlify function logs |
| Large deploy | Git LFS not set up | Use `git clone --depth 1` |
