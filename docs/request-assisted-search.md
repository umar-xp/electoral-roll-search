# Request Assisted Search

## Overview

This module adds a manual-help workflow for citizens who cannot find their 2002 Karnataka voter record on their own.

Static pages:

- `apps/web/request-assisted.html` — public request form
- `apps/web/request-status.html` — public status lookup
- `apps/web/request-admin.html` — admin login and dashboard

Supporting client files:

- `apps/web/request-assisted-config.js`
- `apps/web/request-assisted-common.js`
- `apps/web/request-assisted-form.js`
- `apps/web/request-assisted-status.js`
- `apps/web/request-assisted-admin.js`
- `apps/web/request-assisted.css`

Supabase setup:

- `supabase/request-assisted-search.sql`

## Setup Steps

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/request-assisted-search.sql`.
3. Create at least one Supabase Auth user for an administrator.
4. Insert that user into `public.request_admins`.
5. Replace the placeholders in `apps/web/request-assisted-config.js`.

## Add An Admin

After creating a Supabase Auth user, insert the user into `request_admins`:

```sql
insert into public.request_admins (user_id, email, display_name)
values ('<AUTH_USER_UUID>', 'admin@example.com', 'Primary Admin');
```

## Client Configuration

Update `apps/web/request-assisted-config.js`:

```js
window.REQUEST_ASSISTED_CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR_PROJECT_ID.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  storageBucket: 'request-assist-uploads',
  orderPrefix: 'VSR',
  volunteerOptions: ['Volunteer A', 'Volunteer B', 'Volunteer C'],
  siteName: 'Karnataka 2002 Voter List Search',
});
```

## Notes

- The public request form inserts through a Supabase RPC so validation and order ID generation happen in the database.
- The public status page only reads limited status information through a Supabase RPC.
- The admin dashboard requires Supabase Auth login and reads/writes `search_requests` directly through RLS-protected REST endpoints.
- Uploaded images are stored in Supabase Storage bucket `request-assist-uploads`.
