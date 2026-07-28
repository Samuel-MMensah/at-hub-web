# Migration Status

Strangler-fig migration of the Streamlit ERP app to Next.js + Supabase.
The Streamlit app stays live and untouched — routes move over one at a
time. See `README.md` for the file layout and `DEPLOYMENT.md` for the
hosting/keys setup.

## Routes migrated

- `/login` — real Supabase Auth (email/password), not a mock.
- `/command-center` — real Supabase queries for every KPI, not mock data.

## Routes still in Streamlit

Raise Job Order, Authorization Center, Warehouse, Dispatch, Production
Board, Shop Floor Control, My Order Tracker, Archive, Audit Log.

## Auth

- `src/proxy.ts` — runs on every request, refreshes the Supabase session
  cookie, redirects unauthenticated users to `/login` and authenticated
  users away from `/login`. Named `proxy` (not `middleware`) per this
  Next.js version's renamed convention.
- `src/lib/auth.ts` — `requireUser()`: reads the session via the server
  Supabase client, redirects to `/login` if absent, looks up
  `full_name`/`role`/`department` from `profiles` matched on
  `id = auth.uid()` (falls back to `role: "Front Desk"` /
  `department: "NONE"` and logs the error rather than crashing the page
  if that lookup fails). `profiles`' `SELECT` RLS policy is
  `roles: {public}`, `qual: true` — verified via `pg_policies`, not
  assumed — so this lookup isn't silently blocked by RLS.
- `src/app/login/` — sign-in form (`page.tsx`, `useActionState`) and
  `login()`/`logout()` server actions (`actions.ts`).
- `AppShell`'s `userName`/`userRole`/`role` props come from
  `requireUser()` now, not hardcoded values.

## Data layer (Command Center)

Same Supabase project the Streamlit app already uses. Confirmed tables:
`job_orders`, `jobs`, `job_pipeline_status`, `profiles` (the first two
are what Command Center reads; `job_pipeline_status` hasn't been
inspected/used yet).

- `job_orders` filtered to `status in ('Approved', 'In Production', 'At
  Warehouse')` → activeOrders, contractValue, depositCollected,
  outstandingBalance (computed as contractValue − depositCollected),
  and the press/garment split (ports `_is_garment()` from app.py).
- `job_orders` filtered to `status = 'Pending'` → pendingApprovals,
  feeding `AppShell`'s sidebar badge.
- `jobs` filtered to `finish_time >= now-72h OR finish_time IS NULL` →
  bookRunsQueue (`ups = 1`) and packagingSkillets (`ups > 1`), both
  counted as distinct `tracking_id`.

Exact logic lives in `src/app/command-center/page.tsx` — this file is
the source of truth, not this doc.

## What's NOT done yet

- No RLS policies written yet. `nav-config.ts`'s `roles` arrays are the
  intended source of truth to translate into Postgres RLS — right now,
  access control is enforced by the app (session check + client-side nav
  gating), not by the database.
- PDF generation and email sending are stubs in `backend/app/main.py`
  (`NotImplementedError`), with docstrings pointing at the app.py line
  ranges still to port.
- Every route besides `/login` and `/command-center` is still Streamlit.

## Rules to keep following

- The existing Streamlit app is never touched by this migration — it
  keeps running unchanged until each module is fully cut over.
- Reuse the same Supabase project the Streamlit app already uses (same
  `job_orders`, `profiles`, same Auth users) — never create a second one.
- Real secrets only ever go into `.env.local` / `backend/.env` (both
  git-ignored) or the hosting dashboard's env-variable panel — never
  into a committed file.
- `SUPABASE_SERVICE_ROLE_KEY` belongs only in the backend service
  (Render) — never in the Next.js app, never in a `NEXT_PUBLIC_*` var.
- Don't guess at business logic (status values, KPI filters, table
  columns) — confirm against the real schema/data or ask, rather than
  assume. Wrong assumptions here misrepresent real financial/ops data.

## Next up

- Write the RLS policies `nav-config.ts` implies, so access control
  doesn't rest solely on the app layer.
- Migrate the next Streamlit module. Raise Job Order has no upstream
  dependency; Authorization Center depends on Raise Job Order existing
  first (it approves what that flow creates).
