# Migration Status

Strangler-fig migration of the Streamlit ERP app to Next.js + Supabase.
The Streamlit app stays live and untouched — routes move over one at a
time. See `README.md` for the file layout and `DEPLOYMENT.md` for the
hosting/keys setup.

## Routes migrated

- `/login` — real Supabase Auth (email/password), not a mock.
- `/command-center` — real Supabase queries for every KPI, not mock data.
- `/my-orders` (My Order Tracker) — real Supabase data (the signed-in
  user's own `job_orders`, plus related `jobs` rows for the pipeline
  banner), not mock data. See "Data layer (My Order Tracker)" below.

## Routes still in Streamlit

Raise Job Order, Authorization Center, Warehouse, Dispatch, Production
Board, Shop Floor Control, Archive, Audit Log.

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
are what Command Center and My Order Tracker read; `job_pipeline_status`
hasn't been inspected/used yet).

- `job_orders` filtered to `status in ('Approved', 'In Production', 'At
  Warehouse')` → activeOrders, contractValue, depositCollected,
  outstandingBalance (computed as contractValue − depositCollected),
  and the press/garment split (ports `_is_garment()` from app.py — see
  "Shared infrastructure" below for where that now lives).
- `job_orders` filtered to `status = 'Pending'` → pendingApprovals,
  feeding `AppShell`'s sidebar badge.
- `jobs` filtered to `finish_time >= now-72h OR finish_time IS NULL` →
  bookRunsQueue (`ups = 1`) and packagingSkillets (`ups > 1`), both
  counted as distinct `tracking_id`.

Exact logic lives in `src/app/command-center/page.tsx` — this file is
the source of truth, not this doc.

## Data layer (My Order Tracker)

Ports `app.py`'s "My Order Tracker" route (`get_all_db_job_orders_by_user()`
+ `get_jobs_by_order_numbers()` + `_pipeline_summary()`) against the same
`job_orders`/`jobs` tables Command Center reads.

- `job_orders` filtered to `created_by = <the signed-in user's email>`
  (from `requireUser()`'s `user.email`) — **not** `id`/`auth.uid()`.
  This is a different join convention than the `profiles` lookup
  *on purpose*: `job_orders.created_by` stores the raiser's email as a
  string (confirmed against `get_all_db_job_orders_by_user()`'s real
  source), while `profiles.id` is a FK to `auth.users.id`. Each table
  is ported as it actually behaves — this is not an inconsistency to
  unify.
- Sort order on the base fetch: `created_at` ascending (oldest first),
  matching `.order('created_at', desc=False)` exactly. The cards
  themselves still render newest-first, because the render layer
  re-sorts descending before grouping (see batch grouping below) — that
  re-sort is in the original source too, not a deviation.
- 5 KPI cards, computed from the full (unfiltered) order set: Total
  Raised (count), Awaiting Decision (`status` in `('Pending Approval',
  'Pending Revision Approval')` — not just `'Pending'`), Approved
  (`status = 'Approved'`), Rejected / Returned (`status = 'Rejected'`),
  Total Contract Value (`sum(total_amount)`, null as 0).
- Personal analytics strip: My Approval Rate (approved ÷ total), My Avg
  Order Value (`sum(total_amount)` ÷ count), Avg Days to Approval.
- **Avg Days to Approval uses `approved_at`, not `updated_at`.** This is
  a deliberate deviation from the literal `app.py` source, not a bug
  carried over: the source references `updated_at`, which does not
  exist on `job_orders` (verified twice via live `information_schema`
  queries this session). `approved_at` does exist and is what the
  metric is actually meant to measure — averaged over `Approved` orders
  where `approved_at` is not null, `—` if none qualify.
- Search (customer name / order no / description, case-insensitive
  substring) + status filter, combined as AND. Tab counts (All /
  Pending / Approved / Rejected) are recomputed from the filtered set,
  not the unfiltered total.
- Batch/group-submission grouping by `parent_group_id` — **ported in
  full, not deferred**: groups sorted `created_at` descending within
  each tab, batch header banner (line-item count, customer, ref, status
  summary, batch value), "Line Item N of M" + REVISED badge per item.
- Pipeline banner for `In Production` orders — **ported in full**
  (`_pipeline_summary()`/`get_jobs_by_order_numbers()`'s real source
  was provided and used): current machine, next machine, ETA from
  `jobs.finish_time`/`revised_finish`. Falls back to the source's own
  generic "detailed schedule not available" message when there's no
  schedule data. See "Known gaps" for the unverified timezone-parsing
  caveat on the underlying date values.
- PDF export — visible, disabled, labeled "coming soon." Backend's
  `/pdf/manifest` is still a `NotImplementedError` stub, so this isn't
  wired to it (avoids a button that would just error on click).
- Modify & Resubmit — **omitted entirely this pass**. The original
  hands off to Raise Job Order, which doesn't exist yet in this app;
  this is a noted follow-up once that route is built, not a silently
  dropped feature.

Exact logic lives in `src/app/my-orders/page.tsx` and
`src/app/my-orders/order-tracker-client.tsx` — these files are the
source of truth, not this doc.

## Shared infrastructure

- `isGarment()` (ports `_is_garment()` from app.py) lives in
  `src/lib/is-garment.ts`, shared by Command Center and My Order
  Tracker. Was duplicated locally in Command Center before My Order
  Tracker was built; extracted as a refactor, not a behavior change.
- `MetricCard` (`src/components/ui/metric-card.tsx`) has an optional
  `borderColor` prop, defaulting to `accentColor` when omitted
  (backward compatible with every existing call site). Added because
  My Order Tracker's KPI cards use a different shade for the border
  than the value text on 4 of 5 cards, and the component previously
  only supported one color driving both.
- `parseTimestamptz()` lives in `src/lib/parse-timestamptz.ts` — shared
  rather than local to My Order Tracker, since Production Board and
  Shop Floor Control will need the same `jobs.finish_time`/
  `revised_finish` parsing. See "Known gaps" for its
  unverified-against-real-data caveat.

## What's NOT done yet

- No RLS policies written yet. `nav-config.ts`'s `roles` arrays are the
  intended source of truth to translate into Postgres RLS — right now,
  access control is enforced by the app (session check + client-side nav
  gating), not by the database.
- PDF generation and email sending are stubs in `backend/app/main.py`
  (`NotImplementedError`), with docstrings pointing at the app.py line
  ranges still to port. My Order Tracker's PDF button is disabled
  pending this.
- Modify & Resubmit (My Order Tracker → Raise Job Order handoff) is
  omitted until Raise Job Order exists.
- Every route besides `/login`, `/command-center`, and `/my-orders` is
  still Streamlit.

## Known gaps

- `parseTimestamptz()` (`src/lib/parse-timestamptz.ts`, shared — not
  local to one route, since Production Board and Shop Floor Control
  will need the same `finish_time`/`revised_finish` handling; currently
  only called from My Order Tracker's pipeline banner) has a
  UTC-forcing fallback for values that arrive without a timezone offset
  — but this is **unverified against real data**. `jobs` was empty for
  the entire session this was built in, so no live row was ever
  inspected; the fallback is based only on `timestamptz`'s documented
  Postgres/PostgREST behavior, not an observed value.
  Once `jobs` has real rows with a non-null `finish_time`/
  `revised_finish`, load a Production Board or Shop Floor Control page
  (or query directly) and confirm `parseTimestamptz`'s `console.error`
  did **not** fire. If it does fire — i.e. a real row is missing a
  timezone offset — that means the `timestamptz` column type is being
  violated somewhere upstream (e.g. the insert path writing a naive
  string). That's worth escalating and fixing at the source, not
  silently working around again in this function.

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
