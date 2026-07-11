# Debug Session: request-assist-submit
- **Status**: [OPEN]
- **Issue**: Request Assist submit shows `Cannot read properties of undefined (reading 'forEach')` / `undefined is not an object (evaluating 'labels.forEach')`
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-request-assist-submit.ndjson

## Reproduction Steps
1. Open `http://localhost:8080/dist/request-assisted.html`
2. Fill the required applicant details
3. Upload the required primary voter ID images
4. Click submit
5. Observe frontend error banner instead of successful order creation

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Browser is executing a stale cached `request-assisted-common.js` | High | Low | Confirmed |
| B | Another `forEach` in the submit path is still receiving `undefined` | Med | Low | Rejected |
| C | Request Assist page is loading mixed old/new modules from cache or service worker | High | Med | Confirmed |
| D | `ensureRequiredFiles()` is reached with an unexpected non-array argument | Med | Low | Rejected |
| E | Frontend fails before any Supabase RPC/storage request is attempted | High | Low | Rejected |

## Log Evidence
- `common module loaded` and `form module loaded` were received from the fresh build during Playwright submit.
- `ensureRequiredFiles invoked` showed `filesType=array`, `filesLength=2`, `labelsType=undefined`.
- `resolved required file entries` showed `entriesType=array`, `entriesLength=2`, first entry label `Primary voter ID front image`.
- Playwright submit created `VSR-000002` and `VSR-000003`.
- RPC lookup for `VSR-000003` with mobile `9986013992` returned status `NEW`.

## Verification Conclusion
- Pre-fix symptom: user browser still showed stale `labels.forEach` crash even after helper logic was corrected.
- Evidence: current fresh runtime does not crash and successfully submits to Supabase; therefore the old error was coming from stale cached Request Assist assets.
- Fix applied: cache-busted Request Assist HTML asset URLs and module imports using `?v=20260625-1`.
- Post-fix proof: fresh Playwright run loaded `request-assisted-config.js?v=20260625-1` and `request-assisted-form.js?v=20260625-1`, submitted successfully, and generated `VSR-000003`.
