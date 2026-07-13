# Debug Session: request-ui-schema-mismatch
- **Status**: [OPEN]
- **Issue**: Request submit page still shows the info banner after success, and admin page errors with missing `search_requests.kannada_roll_validated`
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-request-ui-schema-mismatch.ndjson

## Reproduction Steps
1. Open `http://localhost:8080/dist/request-assisted.html?v=20260625-2`
2. Submit a valid request and observe the confirmation state
3. Open `http://localhost:8080/dist/request-admin.html?v=20260625-2`
4. Sign in and observe the missing-column error

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The request form succeeds, but the info banner is not cleared/hidden when confirmation mode is shown | High | Low | Pending |
| B | The admin page is querying `kannada_roll_validated` before the updated Supabase migration finished successfully | High | Low | Pending |
| C | The SQL script stopped at the function return-type error, so later `alter table` / RPC additions never applied | High | Low | Pending |
| D | The admin page is loading stale JS that expects newer columns than the database has | Med | Low | Pending |
| E | The order is created before the final UI state reset happens, so success and stale status text coexist in the same DOM | High | Low | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
