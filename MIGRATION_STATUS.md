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
- `/warehouse` — real, role-gated (`ADMIN_ROLES ∪ WAREHOUSE_ROLES`).
  Read-only view of orders `At Warehouse`; its one action (Notify
  Finance This Is Ready) is visible but disabled, backend-dependent —
  see "What's NOT done yet".
- `/dispatch` — real, role-gated (`ADMIN_ROLES ∪ FINANCE_ROLES`). Real
  writes: Record Payment (cumulative deposit total, not incremental),
  Finalize Dispatch (writes `status = 'Delivered'` +
  `delivered_date`).
- `/production-board` — real, no role gate (matches `production.py`:
  any authenticated user, department filter locked for floor staff via
  `profiles.department`). Real writes: Start Production (writes
  `production_start_date`), Send to Warehouse (its notification step
  is deferred — best-effort/non-blocking in the original too, not a
  regression).
- `/audit-log` — real, admin-only (`ADMIN_ROLES`, matches the
  `is_admin` convention). Read-only: search, dynamically-built status
  filter, CSV export.
- `/archive` (Approved Orders Archive) — **partially migrated, not a
  simple "done":**
  - **Phase 1 — built and real, this is what's live at `/archive`
    right now:** the tabbed table view (Approved / In Production /
    Ready for Collection / Delivered), per-tab CSV export. Fully
    read-only, no write actions.
  - **"Manage Archived Orders" — order-selection panel, built and
    real:** search (order number or customer name) narrowing a
    dropdown of candidates from the same `orders` already fetched for
    the tabs above (no new query), select an order to open its
    operations panel. Real write: Record Balance Payment — same
    cumulative-deposit contract as Dispatch's `recordPayment`
    (`newDepositTotal = deposit + payAmt`, not the raw amount),
    replicated rather than imported into `src/app/archive/actions.ts`
    since importing Dispatch's action would `revalidatePath("/dispatch")`
    and leave Archive's own data stale — same logic, gated to Archive's
    own `ADMIN_ROLES`-only access, revalidates `/archive` instead.
    "Fully Paid" banner when balance is already 0. PDF export reuses
    `PdfPreviewButton` unchanged (same component already proven for
    Production Board / My Order Tracker). Verified against a live
    throwaway insert/pay/delete cycle: balance GH₵300 → payment of
    GH₵300 → `deposit_amount` 200 → 500 confirmed exactly, `total_amount`
    and `status` untouched.
  - **Still not built, not forgotten:** the Master Order Revision edit
    form and Delete Master Order. Held on explicit product decisions
    still needed: the edit form's re-routing side effect (saving
    changes moves an order to `Pending Revision Approval` and re-routes
    it to Authorization Center — a real workflow change, not just a
    data edit) and a safer delete pattern than the original's
    single-click, zero-confirmation delete (agreed direction: a
    type-the-order-number-to-confirm gate before the delete button
    enables — not yet built). A placeholder note is visible in the
    order operations panel where these will go.
- `/shop-floor` (Shop Floor Control) — real, no role gate (matches
  `app.py`: any authenticated user). Read-only: three Gantt-style
  timelines (Production Pipeline across every in-flight order, a
  per-order stage drill-down, whole-shop Machine Utilisation) sharing
  one `GanttChart` component. No write action (Operator Update is not
  built).
- `/authorization` (Authorization Center) — real, admin-only
  (`ADMIN_ROLES`, matches `is_admin`). Search, status filter,
  batch/group rendering by `parent_group_id`, 40-groups-per-page
  pagination, financial matrix + logistics grid + dept-aware spec
  section per line item. Real writes: Approve (`status = 'Approved'`,
  `approved_by` = current user's full name, `approval_date` —
  see "Known gaps" for why that's `approval_date` and not
  `approved_at`) and Reject (`status = 'Rejected'`, `rejection_note`,
  requires a non-empty note). Both guarded with
  `.in('status', ['Pending Approval', 'Pending Revision Approval'])`
  to prevent double-actioning a row someone else already resolved.
  Verified against a live throwaway insert/approve/reject/delete cycle,
  not just typecheck/lint — see git history for the session this
  landed in. Notifications (`notify_order_approved`,
  `notify_needs_scheduling`, `send_departmental_alert`,
  `notify_order_rejected`) are intentionally omitted, same precedent as
  Production Board's `sendToWarehouse` — the backend email endpoints
  are still `NotImplementedError` stubs, and the source itself treats
  every one of these as best-effort/non-blocking.

## Routes still in Streamlit

Production Layout Builder, Raise Job Order.

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
- PDF export — **real**, via the shared `PdfPreviewButton` (see "Shared
  infrastructure"). No longer disabled/"coming soon" — `POST
  /pdf/manifest` is live. See "Backend service — PDF manifest
  generation" below.
- Modify & Resubmit — **omitted entirely this pass**. The original
  hands off to Raise Job Order, which doesn't exist yet in this app;
  this is a noted follow-up once that route is built, not a silently
  dropped feature.

Exact logic lives in `src/app/my-orders/page.tsx` and
`src/app/my-orders/order-tracker-client.tsx` — these files are the
source of truth, not this doc.

## Backend service — PDF manifest generation

`backend/app/pdf.py` is a real port of `generate_pdf_manifest`,
`generate_garment_pdf_manifest`, and `dispatch_pdf_manifest` from
`app.py` — same reportlab layout, tables, and styles, not a rewrite.
`POST /pdf/manifest` (`backend/app/main.py`) is live: takes
`{"order_id": <job_orders.id>}`, fetches the row itself via the
service-role client (doesn't trust a caller-supplied data blob, since
this is meant to reflect DB truth), and returns the PDF bytes.

- **Auth is the standard every future backend endpoint must follow from
  day one.** `require_user()` (`backend/app/auth.py`) verifies a
  `Authorization: Bearer <token>` header via the **anon-key** client's
  `auth.get_user(token)` — not service-role — before the route body
  runs; no valid session means `401`, not a PDF. Any authenticated user
  passes, no role check, matching `job_orders`' existing RLS posture
  (`roles: {authenticated}, qual: true` — deliberately broad, not
  role-restricted; see "Rules to keep following"). **This was initially
  built without any auth check at all** — caught and fixed only because
  it was flagged before this went anywhere near a deployed/public
  backend, not after. Email sending and every other future endpoint
  need `require_user()` wired in from the start, not bolted on later
  once something's already reachable.
- **CORS gotcha worth remembering:** `Content-Disposition` isn't on the
  browser's default CORS-safelisted response headers. Without
  `expose_headers=["Content-Disposition"]` on the CORS middleware,
  `fetch()`'s `Response.headers.get("Content-Disposition")` silently
  returns `null` cross-origin — invisible to same-origin `curl` testing,
  only surfaces with a real cross-origin browser request (or a `curl`
  test that specifically simulates the CORS preflight + `Origin`
  header). Any future endpoint that needs a browser to read a custom
  response header cross-origin will hit this same class of bug.
- **Cedi glyph fix:** both PDF generators now use literal `"GHC"` text
  for Total/Deposit/Balance labels. The source itself was inconsistent
  — `generate_pdf_manifest` already used `"GHC"`; only
  `generate_garment_pdf_manifest` embedded the literal `₵` character,
  which reportlab's default Helvetica (no Cedi glyph) renders as a
  broken box in both this port and the original. Confirmed via a real
  generated PDF before and after the fix.

Exact logic lives in `backend/app/pdf.py`, `backend/app/main.py`, and
`backend/app/auth.py` — these files are the source of truth, not this
doc.

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
- `PdfPreviewButton` (`src/components/ui/pdf-preview-button.tsx`) —
  fetches the PDF as a blob (with the `Authorization: Bearer` token from
  `supabase.auth.getSession()`), renders it in an `<iframe>` modal with
  a real Download button. Used by Production Board, My Order Tracker,
  and now Archive's "Manage Archived Orders" panel — unchanged, no
  Archive-specific modifications needed.

## What's NOT done yet

- No RLS policies written yet. `nav-config.ts`'s `roles` arrays are the
  intended source of truth to translate into Postgres RLS — right now,
  access control is enforced by the app (session check + client-side nav
  gating), not by the database.
- Email sending is still a stub in `backend/app/main.py`
  (`NotImplementedError`) — PDF generation is done (see "Backend
  service — PDF manifest generation"), email is not.
- Modify & Resubmit (My Order Tracker → Raise Job Order handoff) is
  omitted until Raise Job Order exists.
- Archive's Master Order Revision edit form and Delete Master Order —
  see "Routes migrated" for why they're held, not just missing. (Record
  Balance Payment and PDF export, the other two pieces of "Manage
  Archived Orders", are done.)
- Production Layout Builder and Raise Job Order are still Streamlit.
- Authorization Center's four approve/reject notifications
  (`notify_order_approved`, `notify_needs_scheduling`,
  `send_departmental_alert`, `notify_order_rejected`) — deferred until
  `backend/app/main.py`'s email endpoints exist. See "Routes migrated".

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
- **PDF signature line looks wrong when `approved_by` holds an email
  instead of a name** — e.g. "E. — enoch.obeng@appointedtime.com.gh"
  instead of a name-shaped signature. `_build_sig()`'s initials logic
  (split on spaces) collapses an email to one letter. This is the
  ported logic working exactly as designed against real data —
  `approved_by` is genuinely stored as an email for these orders (every
  approval before Authorization Center existed went through the old
  Streamlit route, which only had `st.session_state['user_email']` to
  work with). **Fixed going forward, not retroactively**: Authorization
  Center's `approveOrder()` now writes `requireUser().fullName` (a real
  `profiles.full_name`, confirmed live — a real test approval recorded
  `"Samuel Mensah"`, not an email), so new approvals get a proper
  signature. Historical rows keep whatever they already have.
- **`approval_date` and `approved_at` are two separate real columns —
  only `approval_date` is ever written.** Confirmed live twice: all 6
  sampled pre-existing `Approved` rows have `approval_date` populated
  (a lifecycle-style TEXT column, `"YYYY-MM-DD HH:MM:SS UTC"`, same
  shape as `production_start_date`/`ready_date`/`delivered_date`) and
  `approved_at` null on every one; a fresh test approval through
  Authorization Center reproduced the same split. `approved_at` is a
  real column but nothing — old route or new — has ever written to it.
  My Order Tracker's "Avg Days to Approval" metric originally read
  `approved_at` and was therefore silently dead (always "—") since it
  shipped; fixed in this session to read `approval_date` via the new
  `parseLifecycleTimestamp()` helper (`src/lib/lifecycle-timestamp.ts`)
  instead.

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
- **Every backend endpoint needs `require_user()` (`backend/app/auth.py`)
  from day one, not bolted on after the fact.** `POST /pdf/manifest`
  was initially built with no auth check at all — anyone who could
  reach the backend could have generated any order's PDF by guessing
  `order_id`. Caught and fixed only because it was flagged before this
  went anywhere near a deployed/public backend, not after. Email
  sending and every future endpoint start with the auth check, not end
  with it.
- **Reference `.py` source pulled in for porting (`app.py`, `rbac.py`,
  `warehouse.py`-style files) goes in the repo root only, never inside
  `backend/`.** A same-named `app.py` dropped inside `backend/` once
  silently shadowed the real `backend/app/` package (an implicit
  namespace package at the time — now hardened with `__init__.py`, but
  that's defense in depth, not a reason to get casual about where these
  files land) — `import app` resolved to the reference file instead of
  the FastAPI app, breaking any fresh backend restart with no visible
  symptom until it happened.

## Open design question — Die Cutter to Folder Gluer scheduling

Scoped entirely to Production Layout Builder / Raise Job Order's
scheduling engine, which is last in the build sequence per existing
project ordering (see "Next up"). **Documentation only — nothing here
has been implemented.** Capturing it now, before that route is built,
so the decision isn't lost or re-derived from scratch later.

**Current code** (`app.py`'s `_next_working_day_start()`, cited as
lines 1271-1284 — *not independently re-verified against source for
this entry, since `app.py` isn't present in the repo right now; taken
as given from the person who reported it*): every downstream stage,
including Die Cutter after any press stage *and* Folder Gluer after Die
Cutter, starts the next calendar working day after the upstream stage's
**start** time. One uniform rule applied to every transition.

**Real business rule** (confirmed directly by the business owner, not
assumed):

- **Printing → Die Cutter:** next working day after printing starts
  (sheets need to dry overnight). This **matches** the current code —
  no change needed for this leg.
- **Die Cutter → Folder Gluer:** 3 hours after Die Cutter's actual
  start time (enough cut stock accumulates to begin folding), **same
  day** — not next-day. This **contradicts** the current code, which
  currently applies the same next-day rule to this leg too.

**Confirmed specifics for the 3-hour rule:**

- Measured from Die Cutter's actual start time — the same reference
  point the existing next-day rule already uses elsewhere in the
  codebase.
- If the 3-hour mark falls outside working hours (before 8am, after
  5pm) or on a weekend, snap forward to the next working-shift start —
  reuse the existing `apply_calendar_bounds()` logic. No new mechanism
  needed for this part.

**Still open, blocking — does the 3-hour rule apply to:**

  (a) every job that goes through Die Cutter → Folder Gluer, regardless
      of job type, or
  (b) only "skillet"/packaging jobs specifically (`ups > 1` — a
      **different** classification axis than `isGarment()`/PRESS-vs-
      GARMENT)

This determines whether the eventual fix is a one-line change to the
existing offset rule, or requires the scheduling function to branch on
`ups` at the moment it computes this specific transition. **Not
resolved — do not implement either version until this is answered
explicitly.**

## Next up

- Write the RLS policies `nav-config.ts` implies, so access control
  doesn't rest solely on the app layer.
- Migrate the next Streamlit module: Raise Job Order (no upstream
  dependency) or Production Layout Builder.
- Port `send_departmental_alert` + the `notify_*` functions into
  `backend/app/email.py` so Authorization Center's approve/reject
  notifications (currently omitted, see "What's NOT done yet") can be
  wired up instead of skipped.
