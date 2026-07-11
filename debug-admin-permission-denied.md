# Debug Session: admin-permission-denied
- **Status**: [OPEN]
- **Issue**: Admin login succeeds on `request-admin.html` but fetching requests fails with `Permission denied for table search_requests`
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-admin-permission-denied.ndjson

## Reproduction Steps
1. Open `http://localhost:8080/dist/request-admin.html`
2. Sign in with a valid Supabase Auth admin user
3. Observe dashboard fetch failure with `Permission denied for table search_requests`

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The RLS policy on `public.search_requests` does not grant `select` to authenticated users present in `public.request_admins` | High | Low | Pending |
| B | The admin user exists in Supabase Auth but is missing or inactive in `public.request_admins` at query time | Med | Low | Pending |
| C | The admin fetch request is sent without the auth token, so PostgREST treats it as anonymous | Med | Low | Pending |
| D | The SQL setup was applied partially, so table/function exists but one or more policies were not created correctly | High | Med | Pending |
| E | The frontend is hitting the wrong endpoint or schema path for admin reads | Low | Low | Pending |

## Log Evidence
- `request-assisted-common.js` sends admin fetches to `GET /rest/v1/search_requests?...` with `Authorization: Bearer <access_token>`.
- `request-assisted-search.sql` revokes all privileges from `authenticated` on `public.search_requests` and `public.request_admins`.
- The SQL created RLS policies, but did not grant base table privileges back to `authenticated`.

## Verification Conclusion
- Root cause confirmed: PostgREST rejects the admin table read at the PostgreSQL privilege layer before RLS policies are evaluated.
- Why login still works: admin sign-in uses Supabase Auth endpoints, not direct table reads from `public.search_requests`.
- Fix required: grant `select, update` on `public.search_requests` and `select` on `public.request_admins` to `authenticated`.
