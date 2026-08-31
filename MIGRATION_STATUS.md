# Migration Status

Strangler-fig migration of the Streamlit ERP app to Next.js + Supabase.
The Streamlit app stays live and untouched — routes move over one at a
time. See `README.md` for the file layout and `DEPLOYMENT.md` for the
hosting/keys setup.

## Routes migrated

- `/login` — real Supabase Auth (email/password), not a mock.
- `/reset-password` — new, didn't exist before this migration touched
  it. Completes a Supabase recovery-link flow client-side (session
  established via `?code=` exchange, then `updateUser({password})`).
  See "Guest accounts / staff onboarding" below for why it was needed
  and how it works.
- `/command-center` — real Supabase queries for every KPI, not mock data.
  Also fires the overdue-collection-alert side effect on every load —
  see "Backend service — overdue collection alert" below. Includes a
  Departmental Performance section (three donuts + a stat table, Press
  vs Garment) using a deliberately broader status scope than the rest
  of the page — see "Data layer (Command Center)" below. No role gate,
  same as every other Command Center KPI.
- `/my-orders` (My Order Tracker) — real Supabase data (the signed-in
  user's own `job_orders`, plus related `jobs` rows for the pipeline
  banner), not mock data. See "Data layer (My Order Tracker)" below.
- `/warehouse` — real, role-gated (`ADMIN_ROLES ∪ WAREHOUSE_ROLES`).
  Its one action, Notify Finance This Is Ready, is now real — built
  from scratch (`warehouse/actions.ts` didn't exist before; the button
  was permanently disabled). Writes `warehouse_notified_finance = true`
  via an atomic guarded UPDATE, then attempts email #7
  (`notify_ready_for_finance`) best-effort. See "Backend service —
  deferred notifications". **Now a 4-tab page** (Receiving — this
  original content, unchanged — plus Stock Balance, Material Receipts,
  Material Issuance) — see "Materials Inventory Management" below for
  the full subsystem writeup. The three new tabs' content is also still
  independently reachable at their own standalone URLs
  (`/warehouse-inventory/stock-balance`, `.../material-receipts`,
  `.../material-issuances`) — Warehouse's tabs are a second entry point
  to the same routes/components, not a replacement.
- `/dispatch` — real, role-gated (`ADMIN_ROLES ∪ FINANCE_ROLES`). Real
  writes: Record Payment (cumulative deposit total, not incremental),
  Finalize Dispatch (writes `status = 'Delivered'` +
  `delivered_date`).
- `/production-board` — real, no role gate (matches `production.py`:
  any authenticated user, department filter locked for floor staff via
  `profiles.department`). Real writes: Start Production (writes
  `production_start_date`), Send to Warehouse (writes `status = 'At
  Warehouse'` and now also fires email #6, `notify_sent_to_warehouse`,
  best-effort — see "Backend service — deferred notifications").
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
  - **Master Order Revision, Delete Master Order, Reopen Order — built
    and real**, closing out this section. Faithful port of
    app.py:5150-5235 except where explicitly deviated (below).
    - **Master Order Revision**: edits `qty_to_print`, `total_amount`,
      `deposit_amount`, `type_of_print` (always this column — never
      `print_type`, even though the garment branch of the category
      dropdown's *initial* value falls back to `print_type` for
      display, matching the source's own read/write split exactly) and
      — the real, intentional part — always sets
      `status = "Pending Revision Approval"` on save, re-routing the
      order out of every Archive tab and into Authorization Center's
      pending queue. Category dropdown branches on `isGarment()`:
      `["DTF", "Flexi Screen Print", "UV-DTF", "SAV", "Embroidery"]` for
      garment, `["OFFSET", "DIGITAL PRESS", "PACKAGING"]` otherwise,
      appending the order's current value if it isn't already in that
      list so it never silently disappears. Warning banner text ported
      verbatim, not paraphrased. Verified live: a test order's fields
      updated exactly as submitted, `status` flipped, the row vanished
      from Archive's own status set and appeared in Authorization
      Center's pending-queue query (both confirmed at the DB level and
      visually in the running app) — `reviseOrder` revalidates both
      `/archive` and `/authorization`.
    - **Delete Master Order**: hard `.delete().eq('id', ...)`, matching
      the source's actual behavior — but gated behind a
      type-the-exact-order-number-to-confirm modal, a **deliberate
      deviation from source** (which deletes with zero confirmation),
      same category of change as this same session's double-submit
      guard on Shop Floor's Operator Update. Re-validated server-side
      too (fetches the row's real `job_order_no` and compares against
      what was typed before deleting — a stale client reference
      shouldn't be enough). Verified live: the confirm button stayed
      disabled on a mismatched string, enabled only on an exact match,
      and the row was confirmed actually gone from the database
      afterward.
    - **Reopen Order**: shown only when `status === 'Delivered'`,
      reverts to `At Warehouse` — same status-only write as
      Production Board's `sendToWarehouse` (no `warehouse_date`
      attempt; already confirmed live in an earlier task that column
      doesn't exist). Verified live: `status` reverted, `total_amount`
      and `deposit_amount` both confirmed untouched.
- `/shop-floor` (Shop Floor Control) — real, no role gate (matches
  `app.py`: any authenticated user). Three Gantt-style timelines
  (Production Pipeline across every in-flight order, a per-order stage
  drill-down, whole-shop Machine Utilisation) sharing one `GanttChart`
  component. Real write: Operator Update (`src/app/shop-floor/actions.ts`),
  a faithful port of `update_stage_status()` (app.py:1437-1492) — the
  highest-risk write in the app. Sets a stage's `stage_status`
  (In Progress / Delayed / On Hold / Complete — never reverts to
  Scheduled); Delayed/Complete always supply a `revised_finish`
  (combining the picked date with the operator's current wall-clock
  time, labeled UTC without converting — the source's own quirk,
  ported as-is); Complete also writes `actual_finish`. If the shift
  against the stage's own `planned_finish` baseline is ≥ 60 seconds,
  every downstream (`sequence_no >` this stage's) sibling that isn't
  already Complete gets its `revised_finish` shifted by the same delta
  (and `revised_start` too, if currently Scheduled); a positive delta
  (pushed later) also flips those siblings to Delayed, a negative delta
  (pulled earlier) shifts dates only. Verified against a live synthetic
  3-stage test order, not just typecheck/lint: delaying stage 1 by
  ~94 hours shifted both downstream siblings' `revised_finish` and
  `revised_start` by that exact delta (to the millisecond) and flipped
  both to Delayed. Negative-delta path (a stage marked Complete with a
  finish time *before* its planned_finish) verified separately on a
  second synthetic order: pulling stage 1 back by ~98 hours shifted both
  siblings' `revised_finish`/`revised_start` backward by that exact
  delta and left their `stage_status` completely untouched (one stayed
  Scheduled, one stayed On Hold) — confirming Delayed is only ever
  applied on a push, never a pull. See git history for the session
  this landed in.
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
  landed in. Approve now fires emails #2/#3/#4 (`notify_order_approved`,
  `notify_needs_scheduling`, `send_departmental_alert`) as three
  INDEPENDENT best-effort attempts (a failure in one can't block the
  others — a real bug in the source's own single try-block, not
  reproduced here); Reject fires email #5 (`notify_order_rejected`).
  See "Backend service — deferred notifications".
- `/production-layout` (Production Layout Builder) — real, admin-only
  (`ADMIN_ROLES`, matches `is_admin`). Order selector limited to
  `status = 'Approved'` orders, form fields matching app.py's Job
  Identification / Production Dimensions / Printing Presses / Finishing
  Machines sections exactly, `_estimate_working_days()` pre-flight
  sanity check (>30 working days requires an explicit override
  checkbox). Real write: **the full scheduling engine**, ported to
  `src/app/production-layout/scheduling.ts` as a pure,
  framework-agnostic module —
  `apply_calendar_bounds`/`_next_working_day_start`/
  `get_machine_next_available_time`/`calculate_production_time`/
  `add_multi_part_job` (app.py:1261-1436), wired up in
  `src/app/production-layout/actions.ts`'s `commitProductionPlan`,
  which then mirrors `update_order_lifecycle_status(id, 'In Production')`
  the same way Production Board's `startProduction` already does.
  - **Deliberate deviation from source** (the one place this port
    intentionally does not match app.py): the Die Cutter → Folder
    Gluer transition uses `dieCutterToFolderGluerStart()` — 3 hours
    after Die Cutter's actual start, same day, snapped forward via
    `apply_calendar_bounds` if that lands outside 8am-5pm or a
    weekend — instead of the source's literal
    `_next_working_day_start()` call there. This is the resolved
    product decision from "Resolved design decision — Die Cutter to
    Folder Gluer scheduling" below, now actually implemented rather
    than just documented. Printing → Die Cutter is unchanged.
  - **Verified before ever touching a real order or the database**:
    `scripts/verify-scheduling.ts`, a standalone, hand-verifiable test
    harness (no UI, no database) covering `applyCalendarBounds`
    directly (before-hours/after-hours/weekend snaps), multi-day
    rollovers including an exact-17:00-boundary edge case, a
    Friday-into-weekend rollover, machine-backlog override, and the
    Die Cutter → Folder Gluer deviation itself side-by-side against
    what the old rule would have produced. Every case was independently
    hand-computed and confirmed against the script's real terminal
    output (re-run live, not reused from an earlier paste) before any
    wiring happened. A second script, `scripts/trace-real-payload.ts`,
    traced one real Approved order's exact numbers through the engine
    as an additional check.
  - **End-to-end verified live** on one synthetic Approved order
    (SM102-CX FOUR COLOUR → Die Cutter → Folder Gluer, no existing
    machine backlog): every resulting `jobs` row's `start_time`/
    `finish_time` matched independent hand computation exactly,
    including the critical proof that Folder Gluer started the SAME
    day as Die Cutter (3 hours later), not the next calendar day.
    `job_orders.status` confirmed flipped to `'In Production'`,
    `contract_value` split evenly across all 3 stages, single
    `tracking_id` shared across the whole job. Test order and its
    `jobs` rows deleted and confirmed gone afterward.
- `/raise-order` (Raise Job Order) — **all five phases, real, complete.**
  No role gate (matches app.py: any authenticated user, same as
  Production Board/Shop Floor Control — unlike Authorization
  Center/Archive/Production Layout Builder's `is_admin` gate).
  - **Phase 1 — New Press cart, built**: item form (every field from
    `add_cart_item_form`, app.py:3531-3624), add/edit-in-place/remove
    cart state, running total/deposit sums, an outstanding-balance
    indicator, and shared client name/phone that persists across cart
    items the way `cart_client_name`/`cart_client_phone` do in the
    source.
  - **Phase 2 — New Garment cart, built**: same state-management
    pattern, mirrored, with `add_garment_cart_item_form`'s own field set
    (app.py:3900-4210) — entirely separate cart state from Press
    (`garment_cart_items`/`garment_cart_client_name`/
    `garment_cart_client_phone` in the source, matched here by a
    second, independent set of React state, not a shared one). A single
    Department dropdown (`app.py:3454-3467`, `["PRESS","GARMENT"]`)
    gates which cart renders — the source's actual switching mechanism,
    not a route split invented for this port. Deliberate inconsistencies
    between the two forms were verified against source and preserved,
    not unified: Garment's Material Source option order is reversed
    (Company first, not Customer first); Garment's Delivery Mode uses
    "Customer Pick-up" where Press uses "Client Pickup"; Garment's Print
    Size/Finished Size are fixed dropdowns where Press's equivalents are
    free text (and therefore not run through `sanitizeString`, unlike
    Press's); Garment's edit-mode button/banner carry extra
    💾/✏️ emoji Press's don't; `print_type`/`type_of_print` and
    `finished_print_size`/`yardage` are each written twice with the same
    value on a Garment item; `material_description_rows` (a
    newline-split breakdown for a future PDF consumer) exists only
    in-memory, matching the source's own "Python-only; remove before
    Supabase insert" comment — never meant to reach the database
    directly, Phase 3 or otherwise.
  - **Phase 3 — real batch submit, built, for both departments**:
    `src/app/raise-order/actions.ts`'s `submitBatch()`, one shared
    Server Action for both carts (their cart items are already
    job_orders-row-shaped by Phase 1/2, so the same action serves both).
    Attachments & Terms section added to both carts (LPO/sample file
    upload, Sample Attached/With, 30-Day Credit Terms checkbox, Sales
    Rep dropdown — exact `SALES_REP_EMAILS` name list, verified fresh
    from source rather than assumed (`SALES_REP_NAMES` in
    `raise-order-client.tsx`, shared by both Press and Garment forms —
    confirmed the only such list in the codebase before adding to it
    rather than creating a second one; **"Elizabeth Addo Obeng" added
    post-launch**, not part of the original source list) — Payment
    Terms Notes shown only
    when the batch has an outstanding balance). `parent_group_id`
    generated client-side per this task's explicit instruction (opaque
    batch identifier, not scheduling-critical — threaded through both
    the storage upload path and the DB column so they can't drift
    apart), `PG-`/`GPG-` prefix per department matching source exactly.
    File uploads go through a new, reusable `uploadBatchFile()` helper
    to the `job-attachments` Storage bucket (confirmed live to already
    exist, public) — an upload failure warns but never blocks
    submission, matching the source's own "order will still submit
    without it" posture exactly. Now also fires email #1
    (`notify_new_order_submitted`) best-effort after a successful
    insert — passes every inserted row's id, not a client-built
    payload; the backend re-fetches and sums `total_amount` across the
    whole batch itself, matching source's own `_notif['total_amount']
    = sum(...)` exactly. See "Backend service — deferred
    notifications". (Not wired into `resubmitOrder` — out of this
    task's explicit scope; source does fire it there too, a real,
    known gap, not an oversight.)
    - **`job_order_no` generation — verified live before writing any
      insert logic**: `job_orders.job_order_no` has a real Postgres
      `DEFAULT` — `'P' || lpad(floor(random()*1000000)::text, 6, '0')`
      — confirmed directly via the PostgREST OpenAPI schema and two
      throwaway inserts that omitted the column entirely. The source's
      `AT-`/`GT-` random fallback is purely an error-path safety net
      for an empty insert response, not expected normal behavior — live
      testing never exercised it; every row got a real `P######` value.
    - **Deliberate deviation from source, not a faithful port**: one
      bulk `insert([...rows]).select()` call per batch, replacing the
      source's per-item loop (`for item in cart_items:
      supabase.table('job_orders').insert(item).execute()`), which can
      leave a partial batch inserted if a later item fails. Verified
      live, twice: a 2-row array with mismatched keys was rejected by
      PostgREST before reaching Postgres at all (`PGRST102`); a 2-row
      array with matching keys and a genuine `NOT NULL` violation on
      the second row was rejected by Postgres itself (`23502`) — in
      both cases confirmed **zero rows persisted**, including the
      otherwise-valid first row. No partial-batch cleanup logic is
      needed as a result — either the whole batch lands or none of it
      does.
    - **End-to-end verified live**, in two passes: a single-item batch
      (confirmed every shared field — `created_by` by email, `order_date`,
      joined `payment_terms`, `sales_rep` stored by name, both file URLs
      correctly null when nothing was attached) and a 3-item batch
      (confirmed all three rows share one `parent_group_id` while each
      gets its own distinct DB-generated `job_order_no`, and item-specific
      fields vary correctly per row). Both test batches deleted and
      confirmed gone afterward.
    - **Cross-route handoff verified live**: a test order raised through
      this route was confirmed to actually show up correctly in My Order
      Tracker (own-orders read) and Authorization Center (pending-queue
      read) — proving the write side and the two existing read sides
      genuinely connect, not just each independently correct in
      isolation. `PdfPreviewButton` on the post-submit confirmation panel
      was confirmed to render a real PDF for a freshly created order
      (not just that the component mounts) — the manifest generator
      received enough real data from a brand-new order to succeed.
      **Caveat**: this pass only exercised a single-item "batch" (1 row
      landed, not the 2 items the check called for), so the multi-item
      batch-header grouping UI in My Order Tracker/Authorization Center
      specifically (`isMulti = group.length > 1`) wasn't visually
      re-confirmed here — the underlying data-layer grouping mechanics
      (shared `parent_group_id`, distinct `job_order_no` per item) were
      already thoroughly verified separately in the 3-item batch test
      above. Accepted as sufficient rather than re-run.
  - **Phases 4-5 — Resubmit Press and Resubmit Garment, built**:
    single-order forms (no cart), pre-filled from the original rejected
    order, one shared `resubmitOrder()` Server Action (`actions.ts`)
    serving both departments since a resubmit item is already
    job_orders-row-shaped, mirroring `resubmit_press_form`/
    `resubmit_garment_form` (app.py:2829-3421) — read fresh rather than
    assumed symmetric with either each other or the Phase 1-3 New-cart
    forms, and several real differences were found and preserved rather
    than unified: neither resubmit form collects a Sales Rep at all
    (unlike the New-cart batch submit, and not carried over from the
    original order either); the payment-terms-notes field is
    pre-filled by parsing the original's `payment_terms` string (split
    on the first "|", or the whole string if it wasn't just a bare
    "30-Day Credit Terms" flag); each department's own Delivery Mode
    label ("Client Pickup" for Press, "Customer Pick-up" for Garment)
    is consistent between its own New-cart and Resubmit forms — it's
    Press-vs-Garment that differs, not New-cart-vs-Resubmit within one
    department (an earlier session's comment claimed the opposite
    before the resubmit forms had actually been read; corrected here).
    - **CRITICAL, verified live, not just asserted**: this creates a
      NEW `job_orders` row via INSERT — the original rejected row is
      never updated, stays exactly as-is permanently. Also verified:
      the fresh `RPPG-`/`RGPG-{timestamp}` id (no random suffix, unlike
      the New-cart batch's `PG-`/`GPG-{timestamp}-{random}` — a
      genuinely different format, not assumed to match) is used ONLY
      for the file-upload storage path when the original order had no
      `parent_group_id` — it is `never` written to the
      `parent_group_id` column in that case, matching
      `if _rp_orig_pgid: rp_payload["parent_group_id"] = _rp_orig_pgid`
      exactly. When the original DID have a `parent_group_id`, the new
      row reuses it verbatim.
    - **Hand-off from My Order Tracker wired up**: rejected `OrderCard`s
      now have a real "🔄 Modify & Resubmit" link to
      `/raise-order?resubmit={id}` (`order-tracker-client.tsx`) — the
      gap Phase 1 deliberately left open for exactly this. `page.tsx`
      fetches that one order fresh server-side (`select("*")`,
      re-verifying it's actually `Rejected` and actually
      `created_by === user.email` — never trusting the id alone) rather
      than accepting anything from the client.
    - **End-to-end verified live**: a synthetic Pending Approval order
      was rejected via Authorization Center's own already-proven reject
      action, then resubmitted via this new form with a live edit.
      Confirmed after: the original row's `status` stayed `Rejected`
      with its `rejection_note` intact and every other field
      byte-for-byte unchanged; a new row existed with a real
      DB-generated `job_order_no`, `status = 'Pending Approval'`, the
      SAME `parent_group_id` as the original, `sales_rep` correctly
      null, and the live-edited field (`type_of_print`) correctly
      reflecting the correction. Both rows deleted and confirmed gone
      afterward.

## Routes still in Streamlit

None — every route now has at least a Phase 1 built in Next.js.

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
  **`requireUser()`'s own lookup works regardless of this policy's real
  shape**, because it always filters `id = auth.uid()` — a caller can
  read its own row under either a genuinely public policy or a
  self-scoped one. Don't take this as evidence the policy is broadly
  readable; see the correction directly below, which contradicts that.
- **CORRECTION (2026-08-04), second time this exact policy has caused
  confusion — read this before trusting anything above it or assuming
  `profiles` is broadly readable.** Re-verified live with real,
  disposable sessions (Front Desk / Admin / Finance roles), not the
  `pg_policies` catalog text: an **unfiltered** `select * from profiles`
  through each of those sessions returned **exactly 1 row — the
  caller's own** — not all rows. Whatever `pg_policies` showed at the
  time the note above was written, the actual, current, empirically-
  tested behavior is a **self-scoped SELECT policy** (`auth.uid() =
  id`), not `qual: true`/broadly public, for every role tested,
  including Admin. This was discovered building `get_sales_reps()`
  (see `src/lib/sales-reps.ts` / the clients-subsystem sales-rep task):
  a direct `.from("profiles")` query for `is_sales_rep = true` rows
  silently returned an empty list for every real caller except when
  querying their own row. Fixed with a narrow `SECURITY DEFINER` RPC
  (`get_sales_reps()`, same pattern as `current_user_role()` below) —
  `profiles`' RLS itself was deliberately left untouched, per this
  project's own standing decision to defer that policy change
  separately. **Any future code that needs to read `profiles` rows
  other than the caller's own must go through a similar `SECURITY
  DEFINER` function, or re-verify live with a real non-owning session
  first — do not trust a "public"/"qual: true" description of this
  policy from anywhere in this document without re-checking.**
- `src/app/login/` — sign-in form (`page.tsx`, `useActionState`) and
  `login()`/`logout()` server actions (`actions.ts`).
- `AppShell`'s `userName`/`userRole`/`role` props come from
  `requireUser()` now, not hardcoded values.

## Data layer (Command Center)

Same Supabase project the Streamlit app already uses. Confirmed tables:
`job_orders`, `jobs`, `job_pipeline_status`, `profiles` (the first two
are what Command Center and My Order Tracker read; `job_pipeline_status`
is read by Shop Floor Control's Production Pipeline visualization —
`src/app/shop-floor/page.tsx` — not by Command Center itself).

- `job_orders` filtered to `status in ('Approved', 'In Production', 'At
  Warehouse')` → activeOrders, contractValue, depositCollected,
  outstandingBalance (computed as contractValue − depositCollected),
  and the press/garment split (ports `_is_garment()` from app.py — see
  "Shared infrastructure" below for where that now lives).
- `job_orders` filtered to `status in ('Pending Approval', 'Pending
  Revision Approval')` → pendingApprovals, feeding `AppShell`'s sidebar
  badge. (This doc bullet previously said `status = 'Pending'`, stale
  since the real pendingApprovals bug fix — see "Known gaps" — the code
  itself has used `PENDING_STATUSES` correctly since then; only this
  sentence was out of date.)
- `jobs` filtered to `finish_time >= now-72h OR finish_time IS NULL` →
  bookRunsQueue (`ups = 1`) and packagingSkillets (`ups > 1`), both
  counted as distinct `tracking_id`.
- **Departmental Performance section** — a SEPARATE query, deliberately
  NOT reusing the `activeOrders` fetch above: `job_orders` filtered to
  the same 5-status set Archive uses (`Approved`, `In Production`, `At
  Warehouse`, `Ready for Collection`, `Delivered` — replicated from
  `src/app/archive/page.tsx`'s `ARCHIVE_STATUSES`, which isn't exported,
  so not literally shared, just identical). This is intentionally
  broader than the 3-status KPI cards above — it represents total
  historical actuals for reporting (including completed/delivered
  orders), not "current active work." Per department (via `isGarment()`,
  not reimplemented): Revenue (`sum(total_amount)`), Jobs
  (`count(distinct job_order_no)`), Collections (`sum(deposit_amount)`
  — already the cumulative collected-to-date figure, kept current by
  every Record Payment action across Dispatch/Archive, not just an
  initial deposit), Outstanding (computed as Revenue − Collections, not
  queried). Rendered as three donuts (Revenue/Jobs/Collections, Press
  vs Garment, same `#0369a1`/`#d97706` colors as the KPI cards) plus a
  stat table, reusing `CapacityCharts`' existing donut technique
  (`charts.tsx`) rather than a new one. **No role gate** — same open
  access as the rest of Command Center, not admin-restricted.
  - **Verified live before and after building**: the 5-status query's
    total revenue (GH₵787,682.00 across 33 rows: 11 Press + 22 Garment)
    is a strict superset of the 3-status KPI's Total Contract Value
    (GH₵776,710.00, 21 rows) — the ~GH₵11k difference is fully
    explained by 12 additional `Delivered` rows (0 `Ready for
    Collection` rows exist in live data currently), not a bug. Per-
    department figures (Press: revenue GH₵727,470.00, collections
    GH₵4,950.00, outstanding GH₵722,520.00, 11 jobs; Garment: revenue
    GH₵60,212.00, collections GH₵39,260.00, outstanding GH₵20,952.00,
    22 jobs) independently recomputed outside the component and
    confirmed to match exactly.
  - A caption is rendered directly under the section on the page
    itself (not just documented here) explaining the scope difference
    from the Active Orders totals above — the same class of confusion
    this project hit once already between Audit Log and Command
    Center, addressed proactively this time rather than after the fact.

Exact logic lives in `src/app/command-center/page.tsx` and
`src/app/command-center/charts.tsx` (`DepartmentalPerformanceCharts`)
— these files are the source of truth, not this doc.

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
- **Avg Days to Approval uses `approval_date`, not `updated_at` and not
  `approved_at`.** This is a deliberate deviation from the literal
  `app.py` source, not a bug carried over: the source references
  `updated_at`, which does not exist on `job_orders` (verified twice
  via live `information_schema` queries this session). `approved_at`
  does exist as a column but is dead — confirmed live during
  Authorization Center testing that no write path (including
  `approveOrder`) ever populates it. `approval_date` is the column
  that actually carries the approval timestamp (via
  `formatLifecycleTimestamp`/`parseLifecycleTimestamp`, see "Shared
  infrastructure") — averaged over `Approved` orders where
  `approval_date` is not null, `—` if none qualify. This metric was
  found dead mid-session (reading the wrong column, always `—`) and
  fixed; see `order-tracker-client.tsx`'s comment at the filter site.
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
- Modify & Resubmit — **real**, a "🔄 Modify & Resubmit" link on every
  Rejected order's card to `/raise-order?resubmit={id}` — see Raise Job
  Order's own Phases 4-5 entry under "Routes migrated" for how the
  hand-off and the resubmit forms work.

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
- **Filename now includes the customer name, sanitized.** Was
  `Manifest_{job_order_no}.pdf` / `GarmentManifest_{job_order_no}.pdf`;
  now `Manifest_{sanitized_customer_name}_{job_order_no}.pdf` (filename
  construction itself lives in `backend/app/main.py`, not `pdf.py` —
  `pdf.py` only builds the PDF byte buffer). New helper
  `sanitize_customer_name_for_filename()` (`backend/app/pdf.py`) strips
  anything not alphanumeric/space/hyphen, collapses whitespace to
  underscores, truncates to 40 chars, falls back to `"Customer"` if the
  name is missing or sanitizes to nothing. Tested against 6 real live
  customer names with real punctuation (e.g. `"ZOOMLION GHANA
  LTD(TINA)"` → `ZOOMLION_GHANA_LTDTINA`), not just a clean synthetic
  name, plus `None`/empty/all-punctuation/truncation edge cases.
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

## Backend service — overdue collection alert

New feature, not part of any prior route's original migration scope —
`notify_collection_due` (app.py:588) and its Command Center trigger
loop (app.py:2614-2647) had never been ported before this. Scoped
deliberately narrow: only the OVERDUE branch (`days_remaining < 0 AND
balance > 0`), not the sibling "due in N days" reminder or
`notify_warehouse_aging` — neither was requested.

- **Real persistent dedup, fixing a genuine bug in the source.**
  app.py's dedup is `st.session_state`-keyed (`notif_coll_{id}`) —
  scoped to one browser tab, reset on every refresh or new session, so
  in the real deployed system the same overdue order re-triggers an
  email every time anyone reloads Command Center. This is not
  preserved. Instead: a real column, `job_orders.overdue_alert_sent`
  (`boolean NOT NULL DEFAULT false`), and an atomic claim-then-send —
  `handle_overdue_alert()` in `backend/app/email.py` issues
  `UPDATE job_orders SET overdue_alert_sent = true WHERE id = ? AND
  overdue_alert_sent = false`, and only sends if that update actually
  affected a row. Two people loading Command Center at the same instant
  can't both win: the loser's conditional UPDATE matches zero rows.
  Verified live via a standalone script
  (`backend/scripts/verify_overdue_alert.py`) — first call claims and
  persists the flag, a second and third call (simulating a reload and a
  simultaneous second viewer) both correctly no-op.
- **Wiring**: Command Center's `getKpis()` (`src/app/command-center/
  page.tsx`) — a Server Component — only *identifies* candidates from
  data it already fetches (pure read, no write). Each candidate id is
  POSTed to a new backend endpoint, `POST /email/collection-overdue`,
  which owns both the atomic claim and the actual send. The claim/send
  logic deliberately does **not** live in the Server Component itself —
  routed through the backend the same way PDF generation is, so a
  database write is never a side effect of rendering a page.
- **One-time backfill at launch, not a repeatable pattern.** The moment
  this feature went live, 4 real pre-existing orders already qualified
  as overdue (P035726, P898397, P257368, P259000) — they'd been sitting
  overdue before the feature existed to alert on them. Left as-is, the
  very first Command Center load after deploy would have dumped 4
  alert emails on staff simultaneously for orders that, in some cases,
  had already been overdue for days — a backlog dump, not the "alert
  the moment it happens" behavior the feature is actually for. So
  before the feature went live for real, these 4 were manually marked
  `overdue_alert_sent = true` via a direct one-time update (verified:
  exactly 4 rows affected, confirmed independently that no other row in
  the table has the flag set). This is **only correct as a one-time
  launch action** — every order that goes overdue from this point
  forward still alerts normally, exactly once, through the real
  claim-then-send path. Don't repeat this backfill pattern for future
  orders; it would suppress alerts that should fire.
- **`_email_shell()` HTML-escapes every interpolated value —
  deliberate deviation from source.** app.py's version builds the
  email HTML via raw f-string interpolation of DB-sourced fields
  (`customer_name`, `job_order_no`, etc.) with no escaping — a customer
  name containing `&`, `<`, or `>` would either break the table markup
  or inject raw HTML into an email a real staff member opens. Caught
  during live verification (a real send, real customer names from the
  live DB were the trigger for checking this at all), fixed by wrapping
  every interpolated value in `html.escape()`. Verified live: a
  synthetic order with `customer_name = "A & B Enterprises <Test>"`
  triggered a real send; the reconstructed HTML showed the literal
  escaped text (`A &amp; B Enterprises &lt;Test&gt;`), confirmed
  visually by the user directly, not just via the reconstruction
  script. **Forward-looking note**: `_email_shell` is the one shared
  HTML letterhead every future `notify_*` port will funnel through
  (approval/rejection notifications, `send_departmental_alert`, etc. —
  see "What's NOT done yet"). Whenever `messaging.py`'s equivalent
  functions are eventually ported, they inherit this fix automatically
  by reusing this same function — but if any future port ever builds
  its own separate HTML string instead of going through
  `_email_shell()`, it needs the same `html.escape()` treatment
  applied independently; confirmed by grep that no such second
  HTML-building function exists anywhere in the codebase yet.
- **Live-send testing surfaced a real config mistake, now fixed.**
  `RESEND_API_KEY` was assumed unset (based on a flawed grep pattern
  that didn't match the `.env` file's actual `KEY = "value"` spacing)
  and was actually live, so the first verification run sent a real
  email to real staff with synthetic test data. Recipient fallback list
  in `_collection_alert_recipients()` was corrected per explicit
  instruction as a result: source's hardcoded fallback (misspelled
  `emmanuel.ametepe@...`, missing `enoch.obeng@...` — present in
  app.py's sibling `_approval_recipients()` but not this function) is
  now `jacqueline.afful@`, `emmanuel.ametefe@`, `enoch.obeng@` — a
  deliberate deviation from the source's fallback list, documented in
  code.
- New config: `NOTIFY_EMAIL_1`/`NOTIFY_EMAIL_2` (`backend/app/
  config.py`, `.env.example`, `render.yaml`) — same two-slot,
  comma-separated-list convention as `_collection_alert_recipients()`
  in source.

Exact logic lives in `backend/app/email.py` (`handle_overdue_alert`,
`notify_collection_overdue`, `_email_shell`, `_collection_alert_recipients`,
`_send_resend_email`), `backend/app/main.py`'s `/email/collection-overdue`
endpoint, and `src/app/command-center/page.tsx`'s `triggerOverdueCollectionAlerts` —
these files are the source of truth, not this doc.

## Backend service — deferred notifications

All seven of app.py's/messaging.py's deferred `notify_*` functions are
now ported, wired into their real triggers, and live-tested. Endpoints
are grouped by TRIGGER EVENT, not one-per-function (5 endpoints for 7
functions — `approveOrder` fans out to 3 in one call) — matches how the
frontend actually fires them: one Server Action per business event, not
the frontend orchestrating multiple calls per action.

| # | Function | Trigger | Endpoint |
|---|---|---|---|
| 1 | `notify_new_order_submitted` | Raise Job Order batch submit | `POST /email/order-submitted` |
| 2 | `notify_order_approved` | Authorization Center approve | `POST /email/order-approved` (1 of 3) |
| 3 | `notify_needs_scheduling` | Authorization Center approve | `POST /email/order-approved` (2 of 3) |
| 4 | `send_departmental_alert` | Authorization Center approve | `POST /email/order-approved` (3 of 3) |
| 5 | `notify_order_rejected` | Authorization Center reject | `POST /email/order-rejected` |
| 6 | `notify_sent_to_warehouse` | Production Board send-to-warehouse | `POST /email/sent-to-warehouse` |
| 7 | `notify_ready_for_finance` | Warehouse notify-finance | `POST /email/ready-for-finance` |

- **Independent fan-out, not source's coupled one.** app.py:4888-4890
  fires emails #2/#3/#4 inside a single `try` block — an exception in
  the first silently skips the other two. `handle_order_approved`
  (`backend/app/email.py`) wraps each in its own `try/except` and
  reports each result separately (`order_approved_sent`,
  `needs_scheduling_sent`, `departmental_alert_sent`) — a real bug
  fixed, not reproduced.
- **`send_departmental_alert` reuses `_email_shell`, not a second
  `_alert_shell`.** `messaging.py`'s own template is nearly identical
  in shape but duplicates the HTML (by that module's own
  can't-import-from-app.py design). Since this port lives in the same
  file as `_email_shell`, and `_email_shell` now carries a
  load-bearing escaping contract, forking a second template would mean
  maintaining that contract in two places. Two accepted consequences:
  the "Open Appointed Time Hub" link (`APP_URL`) is folded into
  `footer` instead of a dedicated slot; minor CSS values (19px vs 18px
  heading, etc.) aren't preserved pixel-for-pixel.
- **`_job_detail_rows` — verified identical to `messaging.py`'s own
  copy before reusing, not duplicated.** Diffed line-by-line: only
  difference was quote style and docstring wording, not behavior.
- **`_department_recipients` has NO hardcoded fallback**, unlike every
  other recipient helper here — an unconfigured `DEPT_EMAILS_PRESS` /
  `DEPT_EMAILS_GARMENT` makes it log a warning and send nothing, by
  design (matches source: "a silent send-to-nobody is worse than a
  visible False").
- **A real, shipped bug found and fixed via a later test-coverage
  audit, not the original test pass**: `_email_shell`'s `rows` values
  are unconditionally `html.escape()`'d — no opt-out. Two conditional
  rows embedded a raw `<a href>` tag as a row *value*
  (`notify_new_order_submitted`'s LPO link, `send_departmental_alert`'s
  Sample Photo link) — both would have rendered as visible escaped
  text, not clickable links. Neither was caught by the original live
  tests because neither test's synthetic order happened to populate
  that field. Fixed: both now use plain URL text (safe by construction,
  most email clients auto-linkify a bare URL anyway). The same audit
  found several other `_job_detail_rows` conditional fields
  (`material_source`, the compound `paper_type`+`gsm` "Paper" row,
  `binding_type`, `laminating_type`, `delivery_mode`,
  `date_of_collection`, and GARMENT's `material_description`/
  `packaging_mode`) had never been exercised with real values either —
  lower risk (plain strings, not embedded markup) but genuinely
  untested code paths; the verification scripts now populate every one
  of these fields and assert on the rendered output.
- **`warehouse/actions.ts` built from scratch**, not a re-wire — no
  `actions.ts` existed for `/warehouse` before this; the "Notify
  Finance This Is Ready" button was permanently disabled. Ported
  `notify_ready_for_finance` split architecturally: the
  `warehouse_notified_finance` DB write happens in the Server Action
  (matching every other status write in this app — never in the
  backend service), gated by an atomic
  `UPDATE ... WHERE status='At Warehouse' AND
  warehouse_notified_finance=false`; the email is only attempted if
  that update actually affected a row, and its own success/failure
  never affects the already-committed DB write (explicit best-effort
  requirement — a failed email must never undo or block a status
  write). Outcome matches source (flag flips on success, once);
  mechanism doesn't (source combines both in one Python function).
- **Live-tested, all seven** — `backend/scripts/
  verify_deferred_notifications.py` (six) and `verify_departmental_alert.py`
  (the seventh, both PRESS and GARMENT variants — the intro text
  genuinely differs) — real synthetic orders, real sends via the live
  `RESEND_API_KEY`, cleaned up after. Re-run in full after the
  test-coverage audit above; all still pass.
- **Configuration status — a Render-side gap, not a code gap.** Six of
  the eight new env vars (`APPROVAL_NOTIFY_EMAILS`, `APPROVAL_CC_EMAILS`,
  `SCHEDULER_NOTIFY_EMAILS`, `WAREHOUSE_NOTIFY_EMAILS`,
  `FINANCE_NOTIFY_EMAILS`, and `APP_URL`) work today via hardcoded
  fallback regardless of whether Render has real values set — which is
  currently true is **unverifiable from this side**: nothing in this
  codebase or its tooling has ever had access to Render's dashboard.
  `DEPT_EMAILS_PRESS`/`DEPT_EMAILS_GARMENT` have no such fallback —
  `send_departmental_alert` sends nothing at all until those two are
  set for real. See "What's NOT done yet" and "Next up".

Exact logic lives in `backend/app/email.py` (all seven `notify_*`
functions, their recipient helpers, `SALES_REP_EMAILS`,
`_job_detail_rows`, the five `handle_*` functions) and `backend/app/
main.py`'s five `/email/*` endpoints — these files are the source of
truth, not this doc.

## Guest accounts / staff onboarding

New, one-time operational work, not a route port — 5 real, permanent
Guest-role Supabase Auth accounts for sales-rep staff, onboarded via a
one-time invite link rather than a shared/typed password. What this
task actually shipped ended up going well beyond the original ask:
proving the onboarding flow surfaced two real infrastructure gaps
(below) that had to be fixed before any real account could be created
safely.

- **The 5 accounts** — all `role: "Guest"`, `department: "NONE"`:

  | Name | Email |
  |---|---|
  | Charles Adoo | charles.adoo@appointedtime.com.gh |
  | Daphne Sarpong | d.sarpong@appointedtime.com.gh |
  | Elizabeth Addo Obeng | ea.obeng@appointedtime.com.gh |
  | Reginald Aidam | reginald.aidam@appointedtime.com.gh |
  | Mabel Ampofo | mabel.ampofo@appointedtime.com.gh |

  These are the app's existing sales reps (`SALES_REP_EMAILS`,
  `backend/app/email.py` — confirmed name+email against that list
  before creating anything, not retyped independently). The access
  granted is deliberate, not generic placeholder login: Guest naturally
  gets exactly Command Center, Production Board, Shop Floor Control,
  and Audit Log (the only four routes with no role gate — confirmed
  against `nav-config.ts` first; every other route already requires a
  role Guest doesn't have), so each rep can see the revenue and job
  performance tied to the business they personally bring in — Command
  Center's KPIs and its Departmental Performance Revenue/Jobs/
  Collections donuts specifically — not admin-level access to anything
  else. No RLS or code change was needed for this; the existing
  no-role-gate routes already produced exactly this access surface.

- **`/reset-password` — discovered missing, built from scratch.** Before
  this task, nothing in this app (grepped: zero matches for
  `updateUser`/`reset-password`/`update-password`/`recovery` anywhere
  in `src/`) could complete a Supabase recovery-link landing — the
  welcome email's "Set Your Password" button would have been a dead
  end. Built client-side, matching Supabase's own documented pattern
  for this flow rather than a Server Action: `src/lib/supabase/client.ts`
  passes no auth options to `createBrowserClient`, so `@supabase/ssr`'s
  real defaults apply — confirmed directly against the installed
  package's source (`node_modules/@supabase/ssr/dist/main/
  createBrowserClient.js`), not assumed: `flowType: "pkce"` and
  `detectSessionInUrl: true` in a browser context. Simply mounting the
  page auto-exchanges the `?code=` param Supabase's `/auth/v1/verify`
  redirect appends, persisting the session into the same cookie storage
  `src/lib/supabase/server.ts` reads — no separate sync step for
  `proxy.ts` or any server-rendered page to see the user as signed in
  afterward. Listens for the `PASSWORD_RECOVERY` auth event (Supabase's
  documented signal for this exact case), with a `getSession()` fallback
  for the race where that event fires before the listener attaches, and
  a 5s timeout to an explicit "invalid or expired" state rather than a
  form that waits forever. On success: `supabase.auth.updateUser({password})`,
  then redirects to `/login`. `proxy.ts` needed one exclusion
  (`RESET_PASSWORD_PATH`, alongside the existing `LOGIN_PATH` check) —
  the very first request here has no session yet (the exchange is
  client-side), so without the exclusion the existing auth gate would
  redirect to `/login` and strip the `?code=` param before this page's
  JS ever ran.

- **Two real Supabase Dashboard settings changed — config, not code.**
  Authentication → URL Configuration's Site URL and Redirect URLs were
  both still `http://localhost:3000` — a live dev leftover, confirmed
  directly by this task's own dry run (the first attempt explicitly
  passed `options.redirect_to` pointing at production and Supabase
  silently substituted `localhost:3000` anyway, no error). Both changed
  to the real production domain (`https://hub.appointedtimeprinting.com`)
  with `/reset-password` added to the redirect allow-list; re-running the
  same dry run afterward confirmed the generated link's `redirect_to`
  now genuinely resolves to production. **This is Dashboard-only
  configuration — the same class of gap as Render's env vars (see
  "What's NOT done yet"): no method on the Auth Admin API can touch it**
  (checked directly against `gotrue`'s `SyncGoTrueAdminAPI` — only
  `create_user`/`delete_user`/`generate_link`/`get_user_by_id`/
  `invite_user_by_email`/`list_users`/`sign_out`/`update_user_by_id`
  exist; nothing for project-level auth config), and this session never
  had a Supabase Management API token either. **Worth a standing
  callout**: any future auth-email flow this app adds (a different
  redirect target, magic-link login, etc.) should check this same
  Dashboard section FIRST — the failure mode here isn't an error, it's
  a silent substitution back to whatever Site URL is currently set, so
  it reads exactly like a code bug until you know where to look.

- **`backend/scripts/create_guest_accounts.py` — reusable
  infrastructure, not a one-off throwaway.** Its core function,
  `provision_guest_account(full_name, email)`, is the one real code
  path both `--dry-run` and `--real` call — the dry run proved exactly
  this function, not a simplified stand-in for it. Reusable for a
  future onboarding batch of the same shape, but **not yet generic**:
  the 5-person list (`GUEST_ACCOUNTS`) is hardcoded in the script, and
  `role: "Guest"` / `department: "NONE"` are hardcoded inside
  `provision_guest_account` itself, not parameters — a future reuse for
  a different batch, or a different role, needs both generalized (a
  CSV/list input for the people, a role/department parameter for the
  function) rather than edited in place.

- **`send_account_welcome()` — an eighth email function, joining the
  system built in "Backend service — deferred notifications" above,**
  not a separate one-off. Reuses `_email_shell()` (same escaping
  contract as the other seven). No dedicated button/link slot exists on
  the shell to reuse — checked first: `send_departmental_alert`'s own
  "Open Appointed Time Hub" button isn't a shell parameter either, it's
  built ad hoc by that caller and folded into its own `footer` argument
  (`_email_shell` has no `link_html` slot at all) — so this function
  follows that same precedent rather than adding a new shell parameter
  for what would still be its only caller. `reset_link` is a
  server-generated, one-time Supabase token (never user-typed) but is
  still run through `html.escape()` regardless, matching how
  `send_departmental_alert` treats `APP_URL` — defensive consistency,
  not because the value is actually attacker-controlled.

- **Verification discipline**: the full flow (`--dry-run`, using
  `delivered@resend.dev` — Resend's own documented always-succeeds test
  address, so the send path is genuinely exercised without depending on
  a real mailbox) was run **twice** — once before the Dashboard fix
  (confirming the exact `localhost` substitution bug live, not just
  suspecting it), once after (confirming the real fix) — before any of
  the 5 real, permanent accounts were touched. Each dry run: real Auth
  user created, `profiles` row confirmed correct, a genuine Resend
  message id returned, the recovery link's structure and `redirect_to`
  inspected directly, then the test account deleted and its absence
  re-confirmed via a fresh query. All 5 real accounts were provisioned
  only after the second dry run passed clean, with no cleanup after (as
  intended — these are permanent) and every welcome email confirmed
  accepted by Resend with a real message id.

Exact logic lives in `backend/app/email.py`'s `send_account_welcome`,
`backend/scripts/create_guest_accounts.py`, and
`src/app/reset-password/page.tsx` — these files are the source of
truth, not this doc.

## Materials Inventory Management

New subsystem, not a 1:1 route port — ported from a real Excel template
(3 sheets: Receipt of Material, Material Issuance, Stock Balance
Report) into a live, database-backed system across 5 phases. Live at
`/warehouse`'s tab bar (Receiving / Stock Balance / Material Receipts /
Material Issuance) and still independently reachable at the original
standalone URLs each tab was built and verified at
(`/warehouse-inventory/stock-balance`, `.../material-receipts`,
`.../material-issuances` — see "Routes migrated" → `/warehouse`).

- **Deliberate improvement over the source, not a faithful port of its
  mechanism**: the original spreadsheet's Stock Balance Report sheet
  used per-row `SUMIF` formulas that could silently break if a range
  got edited. `stock_balance` here is a real Postgres `VIEW` —
  `opening_inventory + SUM(receipts) − SUM(issuances)`, computed live
  on every read via a single `LEFT JOIN` + `COALESCE(...,0)` aggregate
  query, not a stored/cached value that can drift out of sync with the
  transactions behind it.

**Schema**: `material_catalog` (479 real materials imported from the
source file — `id`, `material_description` `UNIQUE`, `section_group`,
`material_category`, `uom`, `opening_inventory`, `unit_cost_ghc`),
`material_receipts` and `material_issuances` (both real transaction
tables, `total_cost` a `GENERATED ALWAYS AS (qty * unit_cost) STORED`
column on each), and the `stock_balance` view joining all three.

- **Two real data-quality issues found and fixed during the 479-row
  import, not silently passed through**: one pre-existing duplicate in
  the source file merged (`SM52 Side belows`, combined stock 10,
  confirmed the two source rows agreed on every other field before
  merging); one encoding bug found and fixed at its actual root
  cause — three GIFT ITEMS rows (`White`/`Blue`/`Black Bluetooth
  Speaker Size:Φ85Mm...`) had their `Φ` character corrupted to
  mojibake (`Î¦`). Traced to the byte level (UTF-8 bytes for `Φ`
  misread as Latin-1, then re-encoded) and confirmed the corruption was
  introduced when the source CSV was saved to a scratchpad file during
  import prep — **not** a defect in the source spreadsheet itself
  (independently confirmed against the user's original file) and
  **not** a bug in the import script (its UTF-8 read/write path was
  proven correct — the corrupted bytes were already in the file before
  the script ever read it). Fixed at the DB row level and in the
  scratchpad file itself, so a future re-run of the same import
  wouldn't reintroduce it.
- **One known anomaly, deliberately preserved, not resolved**:
  `Filter Bag Technorans` has `opening_inventory = -2` in the real
  source data. Imported faithfully as-is rather than silently
  clamped to 0 — `stock_balance.on_hand` for this row is confirmed to
  correctly show negative values, not floored. Left unresolved pending
  a real business answer for what a negative opening balance actually
  means here.

**Access control**: all three base tables are RLS-gated to
`ADMIN_ROLES ∪ WAREHOUSE_ROLES`, enforced through a new
`current_user_role()` SQL function (`SECURITY DEFINER`, reads
`profiles.role` for `auth.uid()`) — built as genuinely reusable
infrastructure for this policy and any future role-gated table, not a
one-off. Role comparison is case-insensitive
(`lower(current_user_role()) IN (...)`), matching this app's real,
mixed-case stored role strings (`'Admin'`, `'md'`, `'fm'`, `'warehouse'`,
etc. — never assumed lowercase).

- **A real incident, worth stating as a lesson and not just a fixed
  bug.** `stock_balance` was originally created `SECURITY DEFINER` (the
  Postgres default for a view), meaning it silently ran as its
  creator and bypassed RLS on the three base tables entirely,
  regardless of who queried it. This was found via **Supabase's own
  linter flagging it**, not by this migration going looking for it.
  Fixed to `SECURITY INVOKER` — but fixing it surfaced a second,
  bigger problem immediately: all three base tables already had RLS
  *enabled* with **zero policies** on them, which meant the
  `SECURITY DEFINER` bypass had been the *only* thing letting real
  logged-in users see any of this data at all. Switching to
  `SECURITY INVOKER` without adding real `SELECT`/`INSERT` policies
  first would have taken the entire Stock Balance page from "working"
  to "empty for every real user" in one deploy. **Every verification
  of Stock Balance up through Phase 2 had used the service-role key**,
  which bypasses RLS by construction — so this gap was invisible to
  every test run up to that point, not just unlucky to miss. From this
  incident forward, every RLS policy in this arc (the three
  `SELECT` policies, plus `material_receipts`/`material_issuances`'
  own `INSERT` policies added in Phases 3-4) was verified with
  **disposable real-session test accounts** (a genuine warehouse-role
  account confirmed to succeed, a genuine finance-role account
  confirmed to get a real Postgres `42501` rejection, not an
  application-level assumption) — created fresh, exercised, and
  deleted every time, never trusted on service-role behavior alone.

**Deliberate enhancements over the original spreadsheet** (each
discussed and approved, not silently introduced): Material Issuance's
Order No. is a real `job_order_no` foreign key to `job_orders`, not
freeform text like the source — enabling real "what materials went
into this job" reporting the original spreadsheet had no way to do.
Material Issuance also gained a `date` column entirely absent from the
original template.

**Verification trail**: every write path — Material Receipts (Phase 3)
and Material Issuance (Phase 4) — was tested end-to-end against real
`on_hand` deltas on a real material (A4 Copy Paper), not just "the
insert succeeded": a receipt of 37 moved `on_hand` 1500 → 1537 → 1500
after cleanup; an issuance of 23 moved it 1500 → 1477 → 1500 — the
sign flip (issuance subtracts) was independently confirmed, not
assumed symmetric with receipts. Material Issuance's `job_order_no` FK
was independently proven to resolve to a real order's customer/order
number via a live join, not just displayed as stored text. Every
disposable test account and every synthetic test row/order created
during this verification was deleted and its absence re-confirmed
afterward.

**Status**: all 5 phases complete and live — Phase 1 (schema + 479-row
import), Phase 2 (Stock Balance), Phase 3 (Material Receipts), Phase 4
(Material Issuance), Phase 5 (wired into `/warehouse` as tabs,
standalone URLs still live). Exact logic lives in
`src/app/warehouse-inventory/` (the three standalone routes),
`src/app/warehouse/warehouse-tabs.tsx` (the tab shell reusing them),
and the `material_catalog`/`material_receipts`/`material_issuances`/
`stock_balance` schema itself — these are the source of truth, not
this doc.

## Approved Orders Archive — Master Order Revision: customer name editing

Added a Customer Name field to the Master Order Revision form
(`src/app/archive/archive-client.tsx`'s `RevisionForm`), alongside the
existing qty/total_amount/deposit_amount/type_of_print fields. The
save path (`reviseOrder`, `src/app/archive/actions.ts`) is
deliberately **not** a plain `job_orders.customer_name` edit — per
confirmed decision, when the order has a real `client_id` it corrects
the **canonical `clients` record**, so the fix applies everywhere that
client is referenced going forward (Sales Rep Dashboard, future
orders raised against that client, Global Search) — not just this one
order.

**Collision handling** — same "warn, don't silently merge" pattern
already established for Raise Job Order's new-client duplicate check
(`raise-order/actions.ts`'s `submitBatch`): a case-insensitive
(`ilike`) lookup against `clients.name` before writing. A match on a
**different** client (`existingClient.id !== current.client_id`)
blocks the whole save outright and surfaces that client's real
name/phone/email in the error — never silently reused or merged. A
match on **the same client** (renaming to its own current name, or
only a case change) is correctly *not* treated as a collision, since
`existingClient.id === current.client_id` in that case — verified
live, not just reasoned about, by renaming a synthetic client and
confirming the save succeeds when the "colliding" match is itself.

**"Don't rewrite history" principle** — same one already established
for `job_invoices.customer_name`: only the order actively being
revised gets its own `job_orders.customer_name` updated. No other
order's historical snapshot is ever touched, even for the same client
— confirmed live by renaming one synthetic order's client and showing
a different, unrelated real order (`P702640`, a different client) was
byte-for-byte unchanged before/after.

**No-`client_id` fallback**: if the order has no linked client record
(pre-dates the client-linkage work, or is otherwise unlinked), only
that order's own `customer_name` is corrected — `clients` is never
touched. Empty names are rejected outright.

**Known gap, found live during this task, flagged not fixed (out of
scope)**: of 66 real `job_orders` rows, exactly one — `P719381`
("ADB", created by bertha.tackie@appointedtime.com.gh) — has no
`client_id`, even though a matching `clients` row (`"ADB"`, id 21)
already exists. Root cause not investigated (not requested); this
order simply exists in the "no `client_id`" fallback state described
above until someone links it deliberately.

**Verification**: synthetic clients/orders, real Admin session, full
cleanup after. Rename propagated to `clients.name` and the order's own
`customer_name` correctly; collision attempt (renaming to a second
synthetic client's exact name) was blocked with the real client's
phone/email in the error, no merge; unlinked-order path updated only
that order, `clients` row count unchanged.

## Sample / No Charge orders, conversion tracking, and the Samples view

One arc, three parts, built in sequence: mark an order as a
sample/no-charge job; link a later real order back to the sample it
converts from; and a dedicated Samples view reporting on all of it.

### Part 1 — Sample / No Charge orders

Raise Job Order (`src/app/raise-order/`) can mark any cart item as a
sample / no-charge job instead of a real paying one — two reasons,
exact strings: **"Awaiting Customer Decision"** and **"Complimentary —
No Charge Expected"**.

**Schema**: `job_orders.is_sample BOOLEAN NOT NULL DEFAULT false` and
`job_orders.sample_reason TEXT` (nullable), guarded by **two** `CHECK`
constraints, not one — confirmed by name via a real rejected insert
for each (the exact constraint name Postgres reports on violation),
not just read from `pg_constraint`:
- `sample_reason_requires_flag`: `sample_reason IS NULL OR is_sample =
  true` — a real paying order can never carry a leftover sample
  reason by mistake. Live-confirmed: inserting `is_sample=false` with
  `sample_reason='Awaiting Customer Decision'` was rejected with
  `violates check constraint "sample_reason_requires_flag"`.
- `sample_reason_valid_values`: `sample_reason IS NULL OR
  sample_reason IN` the two real reason strings above — a sample
  order's reason can't be arbitrary free text, only one of the two UI
  options. Live-confirmed: inserting `is_sample=true` with
  `sample_reason='THIS IS NOT A VALID REASON STRING'` was rejected
  with `violates check constraint "sample_reason_valid_values"`.

(`sample_reason_valid_values` was added beyond what this task
originally specified — a stricter, reasonable addition, not something
this doc's earlier draft had accounted for; caught and corrected here
after a direct challenge rather than left describing only one
constraint.)

**UI**: a "Sample / No Charge" checkbox on both New Press and New
Garment cart forms (`SampleOrderFields`, shared in-file by both carts
the same way `ClientIdentitySection` already is). Checking it removes
the Total Amount/Deposit Amount/Receipt Number inputs from the DOM
entirely — not just blanks them — and requires the reason `<select>`
before the item can be added to the cart.

**Server-side force-to-zero, the real security property**:
`submitBatch` re-forces `total_amount`/`deposit_amount` to exactly `0`
for any `is_sample` item, independent of whatever the client actually
sent — same "never trust a client-supplied value for a money
invariant" posture as every other write action in this app
(`recordInvoicePayment`, Dispatch/Archive's `recordPayment`). This was
verified with a **real bypass attempt**, not just observed UI
behavior: a payload with `is_sample=true` but `total_amount=999999,
deposit_amount=500000` was run through `submitBatch`'s actual
transformation logic and inserted through a real session; the row was
then **independently re-fetched from the database** (not trusted from
the insert response) and confirmed to hold `total_amount=0,
deposit_amount=0` — the malicious values never reached storage.

**Zero other systems needed code changes — confirmed live, not just
assumed from the math**: a full pipeline test (synthetic sample order:
raise → Authorization Center approve → Production Board start
production → send to warehouse → Dispatch Finalize) completed with no
error at any stage, and Dispatch's real disabled-button formula
(`(balance > 0 && !confirm30Day) || notReady`) evaluated to `false` —
auto-unlocked — once the real post-pipeline values were plugged in
(`balance=0`, `notReady=false`), no payment or 30-day-terms
confirmation needed. A parallel normal paid order (`total_amount=1000,
deposit_amount=400`) run through the same pipeline confirmed the
opposite: still correctly balance-gated (`disabled=true` at `balance
=600`), completely unaffected by this feature. Separately confirmed by
reading the code (not modified): Command Center's `contractValue`/
`depositCollected`/`outstandingBalance` are `SUM(job_orders.total_amount)`/
`SUM(deposit_amount)` directly off `job_orders`, so a sample row
contributes exactly `0` automatically; the overdue-collection-alert
candidate filter (`balance > 0 && daysRemaining < 0`) naturally
excludes sample orders the same way; Revenue Analysis reads a wholly
separate table (`job_invoices`) that's only ever populated by a
deliberate Invoice Entry action, so a sample `job_orders` row never
auto-creates a revenue row either way.

**Badge**: `StatusBadge` (`src/components/ui/status-badge.tsx`) gained
a `"sample"` tone (violet — genuinely distinct from every existing
status color: success/warning/danger/idle/accent) and an optional
`title` prop carrying `sample_reason` as a native tooltip. Rendered
next to each page's existing status indicator on Production Board,
Dispatch, Archive (both the table row and the order-detail panel
header), My Order Tracker, and Authorization Center — all five read
`is_sample`/`sample_reason` off the same `job_orders` row their other
fields already come from, no separate query.

### Part 2 — Sample-to-order conversion linkage

`job_orders.converted_from_sample_id BIGINT REFERENCES job_orders(id)`
links a real follow-up order back to the sample it converts from.
**No UNIQUE constraint, deliberately** — one sample can lead to more
than one follow-up over time, so this is not a guaranteed 1:1.

Raise Job Order's cart forms carry a batch-level "Link to a previous
sample?" picker (search-input-above-a-select, same pattern as Invoice
Entry's order picker). Its list is scoped **server-side**
(`raise-order/page.tsx`'s `getLinkableSamples`) to `is_sample = true
AND sample_reason = 'Awaiting Customer Decision'` — Complimentary
samples never convert by definition, so they never reach the picker.
`submitBatch` writes the selected id onto every row of the submission.

**`sample_conversion_status` is the single source of "counts as
converted" — reused everywhere, re-derived nowhere.** The rule: a
sample is converted iff it has at least one linked follow-up whose
status has reached `'Approved'` or beyond (`Approved`, `In
Production`, `At Warehouse`, `Delivered`) — `Pending Approval` and
`Rejected` deliberately excluded. That status set is verified complete
against live data (those four are the only post-approval statuses that
actually exist; `'Ready for Collection'` is an Archive tab label never
written to a real row). The view later gained two columns
(`converted_order_id`/`converted_job_order_no`) so the Samples list
can link to the converting order without any consumer re-implementing
the status set; `is_converted` is derived from the same `LEFT JOIN
LATERAL` that finds that order, so the rule lives in exactly one
expression.

Verified live, not just reasoned about: a sample with a follow-up
still at `Pending Approval` reads **not** converted; approving that
follow-up flips it to converted; and a control sample whose only
follow-up is `Rejected` correctly stays **not** converted.

**FK-blocks-delete finding**: because `converted_from_sample_id` is a
real FK to `job_orders(id)`, a sample that has follow-up orders
pointing at it **cannot be deleted** — Postgres blocks it. So Archive's
"Delete Master Order" refuses to delete a converted sample until its
follow-ups are gone. This is desirable referential integrity, not a
bug — surfaced live when a test-cleanup routine tried to delete parent
samples before their child follow-ups and got blocked, which is
exactly the protection working.

### Part 3 — The Samples view (`/samples`)

New route, gated `ADMIN_ROLES | FINANCE_ROLES` (matching who sees
financial/reporting data elsewhere), with its own nav item.
`src/app/samples/`.

- **List** — every `is_sample` order, one of three real states:
  **"Awaiting Decision"** (convertible, no approved follow-up yet),
  **"Converted"** (per the view above), **"Complimentary — Closed"**
  (Complimentary reason). Converted rows link to the follow-up order.
  Month-grouped via `CollapsibleMonthGroup`, same as every other
  history table here.
- **Trend chart** — Samples Raised vs. Converted per week/month (same
  bucketing/toggle + validated palette as Revenue Analysis's trend).
  A cohort view: each sample is counted in the period it was *raised*,
  and Converted is the subset of that period now converted, so
  Converted is always ≤ Raised within a period.
- **30-day maturity window, as a visible caveat — not a silent gap.**
  The conversion-rate headline figure counts only awaiting-decision
  samples raised **more than 30 days ago**: one raised yesterday
  hasn't had a fair chance to convert, so including it would understate
  the real rate. Complimentary samples are excluded too (they never
  convert). When nothing is mature enough yet, the card shows "—" and
  says why, rather than a misleading 0% — same honesty posture as AR
  Aging's "aged by original invoice date" caption. Verified: a
  hand-computed **1 of 3 mature convertible = 33%** matched the page's
  own computation exactly, and a converted-but-only-5-days-old sample
  was correctly excluded from the rate while still appearing in the
  chart.
- **CSV export**, same `downloadCsv` pattern as every other list/report.

### security_invoker was re-verified TWICE — a view modification demands it

`sample_conversion_status` is created `WITH (security_invoker = true)`
so it runs under the querying user's own `job_orders` RLS, not as its
privileged creator — the lesson `stock_balance` taught this project
once already (a view defaults to `SECURITY DEFINER` and silently
bypasses RLS; see the Materials section).

This property was verified **empirically twice across this arc**: once
at the view's creation, and **again after it was extended via `CREATE
OR REPLACE`** to add the converting-order columns. Both times the same
decisive test: an **anon** (unauthenticated) query against the view
returned `401 permission denied for table job_orders` — *identical* to
a direct `job_orders` query with the same key (a `SECURITY DEFINER`
view would instead have leaked the rows as its creator), and a
disposable Guest session saw exactly what its own direct `job_orders`
query returned, row for row.

The point worth stating plainly: **`CREATE OR REPLACE VIEW` does not
carry forward the reasoning that made the original safe.** The `WITH
(security_invoker = true)` clause has to be re-declared on every
replace, and — given the `stock_balance` precedent — re-*verified*
every time, not assumed to have survived the edit. Confirmed, not
assumed, on both passes.

## Shared infrastructure

- `isGarment()` (ports `_is_garment()` from app.py) lives in
  `src/lib/is-garment.ts`. Was duplicated locally in Command Center
  before My Order Tracker was built; extracted as a refactor, not a
  behavior change. Now imported by five files, not just those original
  two: Command Center, My Order Tracker, Production Board, Archive, and
  Authorization Center.
- `MetricCard` (`src/components/ui/metric-card.tsx`) has an optional
  `borderColor` prop, defaulting to `accentColor` when omitted
  (backward compatible with every existing call site). Added because
  My Order Tracker's KPI cards use a different shade for the border
  than the value text on 4 of 5 cards, and the component previously
  only supported one color driving both.
- `parseTimestamptz()` lives in `src/lib/parse-timestamptz.ts` — shared
  rather than local to My Order Tracker. Now imported by four files:
  My Order Tracker's pipeline banner, Shop Floor Control (both
  `shop-floor-client.tsx` and `actions.ts`), and Production Layout
  Builder's `scheduling.ts` (for `getMachineNextAvailableTime`'s
  backlog lookup). See "Known gaps" for its verification caveat, which
  is narrower than it used to be now that several of these call sites
  have run against real `jobs` rows.
- `PdfPreviewButton` (`src/components/ui/pdf-preview-button.tsx`) —
  fetches the PDF as a blob (with the `Authorization: Bearer` token from
  `supabase.auth.getSession()`), renders it in an `<iframe>` modal with
  a real Download button. Used by Production Board, My Order Tracker,
  Archive's "Manage Archived Orders" panel, and now Raise Job Order's
  post-submit confirmation panel (both departments) — unchanged, no
  route-specific modifications needed.
- Supabase Storage file uploads — genuinely new infrastructure, no
  prior route wrote to Storage. `uploadBatchFile()` (local to
  `src/app/raise-order/actions.ts` for now, only one caller) uploads to
  the `job-attachments` bucket (now **private**, with a 10 MB cap and a
  PDF/JPG/PNG allowlist — see "Security hardening pass") after
  magic-byte validation, and returns the raw object **path** (consumers
  sign a fresh URL at use-time), or a non-fatal warning string on
  failure — never throws, matching the source's graceful-degradation
  posture for LPO/sample attachments exactly.

## Security hardening pass — review, job_orders RLS, storage, and one deferred CVE

One diagnostic security review — disposable accounts, real sessions,
non-destructive probes against live data, **not** automated scanning of
production — surfaced five findings. Three became fixes and one a
deliberate deferral (the fifth came back clean). Every fix was verified
the same way its exposure was proven: run through a real user session,
then **independently re-read from the database/storage** to confirm the
actual state (never trusting an API's own success response), then all
test data and accounts cleaned up. One arc, four parts.

### Part 1 — The review (five tests, real numbers)

1. **Login rate limiting — flagged, not fixed.** 20 consecutive
   wrong-password attempts on a disposable account: no `429`, no
   lockout, and the correct password still logged in immediately
   afterwards. There is no account throttling/lockout at the auth layer
   (Supabase-side). Reported; no fix requested this pass — still open.
2. **`job_orders` RLS — CRITICAL, fixed (Part 2).** A disposable
   **Guest** session could read every order (80 orders, 50 distinct
   customers, **GH₵1,662,322.65** of contract value visible), **INSERT**
   a new order (`201`), and **UPDATE** an existing one — a probe row's
   `customer_name` was actually changed to `"HACKED BY GUEST"`, confirmed
   by an independent service-role re-fetch, not just the `200`. DELETE
   was already blocked. Confirmed live data exposure *and* tampering.
3. **`job-attachments` storage — fixed (Part 3).** The bucket was
   `public: true` (any file readable by anonymous GET), with **no** MIME
   validation (`malware.exe` and `.txt` uploaded fine) and **no** size
   cap (a 15 MB file uploaded fine).
4. **`npm audit` — deferred (Part 4).** 6 high advisories; the runtime
   one is `sharp`.
5. **Logout — clean, no fix needed.** After `signOut()`, the old access
   token returned `401` and the old refresh token was rejected — the
   session is genuinely invalidated server-side, not just cleared
   client-side.

### Part 2 — `job_orders` RLS (Option A: role allowlists)

**Audit first (never guess the write pattern).** Every Server Action
that writes `job_orders` already runs on the **caller's own session**
(the `@/lib/supabase/server` anon client + cookie) — the service-role
key is never used in the Next.js app — so RLS was already in the request
path; it was simply too permissive to enforce anything. The real
application-layer gates, per action:
- **INSERT**: `raise-order` `submitBatch`/`resubmitOrder` —
  `requireUser()` only (page-gated to `ADMIN ∪ RAISE_ORDER`).
- **UPDATE**: `authorization` (ADMIN), **`production-board`
  `startProduction`/`sendToWarehouse` — `requireUser()` only, ANY
  authenticated user** (ported "any authenticated" floor posture, held
  by `Production_Press`/`Production_Garment`), `production-layout`
  (ADMIN), `dispatch` (ADMIN ∪ FINANCE), `archive` (ADMIN), `warehouse`
  (ADMIN ∪ WAREHOUSE).
- **DELETE**: `archive` `deleteMasterOrder` (ADMIN).

**The design tension.** Postgres RLS is *row*-level, not *column*-level:
it can allow/deny a whole UPDATE by who-you-are and by row values, but
it **cannot** say "this role may change `status` but not
`customer_name`." Production floor staff legitimately change exactly one
thing (`status`), yet the exploit was a Guest changing `customer_name`.
So a plain RLS allowlist can close the Guest hole but can't give
per-column least-privilege — that would need a column-guard trigger
(**Option B**, offered and deliberately deferred).

**Applied (Option A) — SELECT deliberately left open** (Command Center /
Production Board / Shop Floor read company-wide, an accepted tradeoff):
- `INSERT` allowlist: `admin, manager, supervisor, md, fm, front desk,
  operations`.
- `UPDATE` allowlist: the above **∪** `finance, warehouse, scheduler,
  production_press, production_garment` — i.e. every real writer role,
  **excluding Guest**.
- `DELETE` allowlist: `admin, manager, supervisor, md, fm`.
All keyed on `lower(current_user_role())`; policies rebuilt from a
clean drop so nothing permissive lingers.

**Verified both directions, real status codes:**
- Guest UPDATE `customer_name` → `HTTP 200, Content-Range */0, 0 rows`;
  re-fetch shows the value **unchanged** (vs. `"HACKED BY GUEST"`
  pre-fix). RLS blocks an excluded UPDATE by making the row
  invisible-for-update — a 200-with-0-rows, *not* a 403 — so "blocked"
  is proven by the row count **and** the untouched re-fetch, not the
  status alone.
- Guest UPDATE `status` (production-board path) → same 200/`*/0`,
  unchanged. This is the **one deliberate behavior change**: a Guest can
  no longer transition an order's status (a security improvement, not a
  regression — Guests aren't floor staff).
- Guest INSERT → `HTTP 403` (`42501: new row violates row-level security
  policy`).
- Legit paths all still work: Front Desk INSERT `201`; admin approve
  `200/1 row`; Production_Press start + send-to-warehouse `200/1` each;
  finance dispatch deposit + finalize `200/1` each; admin delete
  `204`, row gone.

**Residual (accepted):** coarse granularity — a *trusted* writer role
(e.g. Production_Press hitting PostgREST directly) could still change
any column, since RLS can't restrict columns. This does not re-open the
Guest hole; closing it fully is Option B's column-guard trigger, left as
optional hardening.

### Part 3 — `job-attachments`: private bucket, real upload validation, signed-URL lifecycle

**Bucket config** (via the Storage admin API, before→after verified):
`public: true → false`, `file_size_limit: null → 10485760` (10 MB),
`allowed_mime_types: null → ["application/pdf","image/jpeg","image/png"]`.

**App-layer validation** (`raise-order` `uploadBatchFile`): a real
content check by **magic bytes** (`sniffAllowedMime` — `%PDF`,
`FFD8FF`, PNG signature), not the forgeable declared `Content-Type`,
plus a 10 MB size check. Rejections stay non-fatal (the order still
submits without the attachment), matching the source's
graceful-degradation contract.

**Original findings reproduced — now closed** (raw storage, disposable
Front Desk session): `malware.exe` (`application/octet-stream`) →
`HTTP 400, 415 invalid_mime_type`; `.txt` → `400`; a 15 MB file declared
`application/pdf` (so only size can reject) → `400, 413 EntityTooLarge`;
legit PDF and JPG → `200`. Anonymous public GET of an uploaded file →
`400` (no longer public). Admin-session signed read → `200`, real
`%PDF` bytes.

**Honest boundary:** the bucket's `allowed_mime_types` checks the
declared `Content-Type` *header*, not the bytes — an EXE uploaded
*directly to storage* with a forged `application/pdf` header returns
`200` (the bucket accepts it). The app's magic-byte sniff closes that
for the app's own upload path; a determined authenticated user hitting
storage directly with a spoofed header could still land a mislabeled
(inert) file. Fully closing that is a storage-RLS/upload-proxy job, not
done here.

**Signed-URL lifecycle — the durable fix, not a stored expiring URL.**
Privatizing the bucket meant `getPublicUrl` no longer resolves, so the
columns' meaning changed: **`lpo_file_url`/`sample_file_url` now store
the raw object PATH**, and every consumer mints a **fresh signed URL at
use-time** (1-hour TTL — only has to outlive a click):
- **Approval email** (`backend/app/email.py`): new `_sign_attachment_fields()`
  signs the path at send time inside `handle_order_submitted` (LPO) and
  `handle_order_approved` → `send_departmental_alert` (Sample). Legacy
  full-URL values pass through; an unsignable value is dropped to `None`
  so the email omits the row rather than printing a dead link.
- **Archive detail view** — a **new display consumer**: Archive never
  previously read these columns (the page query didn't even select
  them). Added `getAttachmentSignedUrl` (admin-gated Server Action) and
  a `📎 Attachments` section that signs on click. Verified live: stored
  value is a raw path; admin-session sign → `200` real `%PDF`; a second
  call mints a different token, also resolving (fresh-each-time).

**Backfill of historical rows** (census reported before touching
anything): of 83 `job_orders`, **18 rows** carried an attachment —
16 `lpo_file_url`, 3 `sample_file_url`, **19 values total** (id 182 has
both). All 19 were legacy public URLs, all path-recoverable, and all 19
underlying objects confirmed present. An idempotent service-role script
rewrote all 19 to raw paths (`204` each); a direct re-read confirmed
**every value is now a path** (no `http://`, no `://`). Spot-checks
through Archive's signing path pulled **real** content — id 153 (shared
batch) PNG 54,736 B; id 182 LPO JPEG 129,022 B; id 182 Sample JPEG
115,651 B; id 73 PDF 59,223 B — all `HTTP 200`. These files had been
dead since the bucket went private; the backfill + fresh-signing makes
all 18 orders' attachments viewable again.

### Part 4 — Deferred dependency risk: `sharp` / libvips CVEs

`npm audit`'s runtime finding is **`sharp`**
(GHSA-f88m-g3jw-g9cj — libvips CVE-2026-33327/33328/35590/35591),
investigated and **deliberately deferred**, not forgotten:
- Installed `sharp` **0.34.5**; vulnerable range **`<0.35.0`**, so the
  fix strictly needs **`>=0.35.0`**. The highest `0.34.x` published is
  `0.34.5` — **no patch-level fix exists in the `0.34.x` line**.
- `sharp` is **not** a direct dependency — only `next`'s
  `optionalDependencies`. **`next@16.2.12`** (our pin) declares
  `sharp: "^0.34.5"` (`<0.35.0`), which **forbids** `0.35.x`;
  **`next@16.3.0`** relaxes it to `"^0.35.3"`. So an **isolated
  `npm update sharp` is impossible**: it respects Next's `^0.34.5`
  ceiling and no-ops. Forcing `0.35.x` via an override would contradict
  Next 16.2.12's declared constraint (built/tested against 0.34.x) — an
  unvetted mismatch we won't ship. The only real fix is bumping Next
  (16.3.0, a non-major minor), which belongs to a planned Next.js
  upgrade, not a same-day patch (heed `AGENTS.md`: this is a modified
  Next).
- **Actual exposure is low.** The CVEs fire when sharp processes a
  malicious image, and sharp only runs on Next's on-demand
  image-optimization path — which this app does **not** use: no
  `next/image` / `<Image>` anywhere in `src/` (the only match is an
  exclusion pattern in `proxy.ts`), no `images` config. The app's own
  image handling (LPO/sample uploads) uses Supabase Storage with
  magic-byte validation, not sharp. Sharp is installed but off any live
  code path.
- **Action:** revisit at the next planned Next.js upgrade (to
  `next@16.3.0`+, which carries `sharp ^0.35.3`), then re-run
  `npm audit` to confirm the advisory clears.

## What's NOT done yet

- **`job_orders` RLS is now enforced at the database** (Option A role
  allowlists — see "Security hardening pass"). The broader goal of
  translating every `nav-config.ts` `roles` array into Postgres RLS
  across *all* tables is still open; `job_orders` was done first because
  it was a confirmed live exposure. Other tables still rest on
  app-layer gating (session check + client-side nav) until their
  policies are written.
- Raise Job Order's quick-fill from past customer
  (`get_recent_customers()`) — the one remaining piece of that route,
  deliberately deferred (see "Routes migrated"); every write-path phase
  (1-5, including Modify & Resubmit) is done.
- **All seven deferred notifications are code-complete and live-tested
  (see "Backend service — deferred notifications"), but NOT fully
  operational in production yet — this is a configuration gap, not a
  code gap.**
  - Six (`_approval_recipients`, `_approval_cc_recipients`,
    `_scheduler_recipients`, `_warehouse_recipients`,
    `_finance_recipients`) fall back to real hardcoded addresses if
    their env var (`APPROVAL_NOTIFY_EMAILS`, `APPROVAL_CC_EMAILS`,
    `SCHEDULER_NOTIFY_EMAILS`, `WAREHOUSE_NOTIFY_EMAILS`,
    `FINANCE_NOTIFY_EMAILS`) is unset in Render — they work today
    either way, but whether they're currently sending to the real
    fallback addresses or to values actually configured in Render's
    Environment tab is **unknown from this side**: nothing in this
    codebase or its tooling has ever had access to Render's dashboard,
    so this has never been checked and can't be confirmed here — only
    checkable directly in Render.
  - The seventh, `send_departmental_alert`, has NO fallback by
    design — confirmed live: an unconfigured `DEPT_EMAILS_PRESS` /
    `DEPT_EMAILS_GARMENT` makes it silently do nothing (logged, not an
    error). This is the one notification that sends **zero** real
    email in production until those two are set in Render.
  - `APP_URL` (the departmental alert's optional "Open Appointed Time
    Hub" link) degrades gracefully if unset — the button is just
    omitted, not broken — but points nowhere real until set.
- **Deferred: a real `payment_transactions` ledger table, to replace
  `job_orders.deposit_amount` / `job_invoices.payment` as directly-
  written running totals.** Proposed and scoped 2026-08-31 (see
  "Deposit sync gap fix (Phase 1)" in Known gaps below, which this
  would fully subsume); deliberately scheduled as a future follow-up,
  not started, so the
  reasoning doesn't need re-investigating from scratch whenever it is
  picked up.

  Architecture: one new table —
  `payment_transactions(job_order_no nullable, job_invoice_id nullable,
  amount, date, recorded_by, receipt_no, source CHECK IN
  ('raise_deposit','dispatch','archive','invoice_entry'), created_at)`
  — append-only (no UPDATE/DELETE policy; a mistake gets a reversing
  transaction, never an edit). Every payment-recording write inserts a
  row here instead of incrementing a column; `deposit_amount` and
  `payment` (and, by extension, `job_invoices.balance`) become `SUM()`
  reads at query time, never independently writable again. Open design
  question worth deciding before writing any code: whether an Invoice
  Entry payment against a *linked* invoice also stamps `job_order_no`
  on the same row (recommended — lets both the order's and the
  invoice's totals come from one `SUM()` each, no join needed) versus
  only ever joining through `job_invoice_id`.

  Real scope, not a rough guess:
  - **6 write sites change**, not the 4 that looked obvious at a
    glance: `raise-order/actions.ts` (initial deposit), `dispatch/
    actions.ts:82`, `archive/actions.ts:96`, `invoice-entry/
    actions.ts:189` (initial payment) and `:356` (increment) — plus
    **`archive/actions.ts:200`**, which is NOT a payment at all (the
    Master Order Revision edit form's direct `deposit_amount` overwrite)
    and needs its own decision: disallow direct edits entirely once a
    ledger exists, or model it as a distinct `source='archive_correction'`
    transaction type. This is a real fork in the design, not a
    mechanical swap, and should be settled before implementation starts.
  - **~18-20 read-path files** need the same "substitute the derived
    value" treatment Phase 1 of the deposit-sync fix
    (`src/lib/effective-deposit.ts`) already gave `job_orders.
    deposit_amount` — except doubled, since `job_invoices.payment`/
    `balance` become derived too (13 files touch those fields today:
    Dispatch, Archive, My Sales Dashboard, Category Report, Invoice
    Entry, Revenue Analysis, Uninvoiced Orders). `effective-deposit.ts`
    itself would need rewriting to query `payment_transactions` instead
    of `job_invoices` directly.
  - **Historical backfill is a different kind of problem than a normal
    value-correction backfill** (like `backfill_deposit_amounts.py`):
    there's no real per-payment history before this table exists, only
    current cumulative totals, so the backfill fabricates one "opening"
    transaction per existing row (`recorded_by=created_by`,
    `date=order_date` — best-effort, not a real audit trail). One real
    side-benefit worth naming: seeding BOTH the order-side and
    invoice-side historical values as two separate opening transactions
    per already-disagreeing order would make all of them sum to the
    additive interpretation automatically, without Finance adjudicating
    each one — but only if additive is actually correct, which for
    P963191 and P481826 specifically is still genuinely unknown (see
    "Deposit sync gap fix (Phase 1)" in Known gaps below).
  - **Free side-fix, not the point of this but worth having:**
    `receipt_no` today is a single column on both tables, silently
    overwritten by every subsequent payment — a second partial payment
    erases the first one's receipt number. A row-per-payment ledger
    fixes this for free.
  - RLS is the well-precedented part, not the risky part — model
    directly on `supabase/migrations/20260811090000_job_orders_rls_
    policies.sql`'s drop-and-recreate-by-role-allowlist pattern.

  Recommendation stands as given at scoping time: treat as a deliberate
  scheduled follow-up, not something to fold into fast-moving work —
  the `archive/actions.ts:200` design fork and the backfill-seeding
  question both deserve a real decision, not a rushed one.

## Known gaps

- **Deposit sync gap fix (Phase 1) — `job_orders.deposit_amount` and
  `job_invoices.payment` were two completely independent fields for the
  same linked order's real collected-to-date figure, confirmed drifting
  apart in real data; fixed via a live-derived value. Built and
  verified well before this entry, but never actually committed until
  2026-08-31 — named plainly here, same as every other "committed
  late" incident already documented in this file.**

  The problem, confirmed before touching anything: three separate
  write paths (Dispatch's `recordPayment`, Archive's `recordPayment`,
  Invoice Entry's `recordInvoicePayment`) could each update one side of
  what should have been the same number, with no awareness of the
  other. Verified live: of 10 real linked invoices with `payment > 0`,
  6 disagreed with their own order's `deposit_amount` — one by close to
  GH₵340,000. `job_orders` <-> `job_invoices` is also genuinely
  one-to-many, not 1:1 (5 real orders had 2-4 linked invoices each), so
  any fix had to sum across every linked invoice, never assume "the"
  one.

  Fix (Phase 1, mechanism only — no historical data touched):
  `src/lib/effective-deposit.ts` exports `getInvoicePaymentSumsByOrderNo()`
  (one query, `job_invoices` grouped by `job_order_no`, summed) and
  `withEffectiveDeposits()`, which for any order with at least one
  linked invoice replaces `deposit_amount` with that real sum at read
  time — an unlinked order's own value passes through completely
  untouched. `hasLinkedInvoice()` additionally gates Dispatch's and
  Archive's Record Payment button for a linked order: disabled, with
  "This order has a linked invoice — record payment through Invoice
  Entry instead." instead of silently accepting a write that would be
  immediately overwritten the next time anything read that order.

  15 files across the app were confirmed (via grep, not assumed) to
  read `job_orders.deposit_amount`; 9 needed an actual code change —
  `command-center/page.tsx` (all three of its `job_orders` queries),
  `dispatch/page.tsx` + `dispatch-client.tsx`, `archive/page.tsx` +
  `archive-client.tsx`, `audit-log/page.tsx`, `authorization/page.tsx`,
  `my-orders/page.tsx`, `search/page.tsx`. The rest either needed
  nothing (read-only consumers of an already-corrected value passed
  down as props: `audit-log-client.tsx`, `my-orders/
  order-tracker-client.tsx`, `authorization-client.tsx`, `command-
  center/charts.tsx`) or were correctly left alone (`raise-order/
  actions.ts` — a brand-new order can never already have a linked
  invoice, since its `job_order_no` is DB-generated fresh on insert).
  Verified with a real synthetic linked order carrying two invoices
  (payments of 300 and 450), confirming the derived value was the sum
  (750), not a 1:1 mirror of either — and, separately, with a real
  click-through against a live production order (a disposable
  finance-role test account, a real login, Playwright driving the
  actual page): Dispatch's Record Payment button confirmed genuinely
  disabled, with the stated message, and a forced click produced no
  request and no state change.

  **The incident, named plainly:** this entire fix — `effective-
  deposit.ts` plus all 9 patched files — was built and verified
  (typecheck, lint, a full production build, and the real browser
  click-through above) well before Phase 2's backfill script, the
  payment-timeline investigation, and the `payment_transactions`
  proposal above were done on top of it. None of it was ever
  committed. `git log --all --oneline -- src/lib/effective-deposit.ts`
  returned zero results; a broader `git log --all --grep="deposit"` /
  `--grep="effective"` search turned up nothing either — this sat as
  pure uncommitted working-tree state through several subsequent
  tasks. It surfaced the same way the `ARCHIVE_STATUSES`/`jobOrders`
  incidents did: a later, unrelated commit (`cf17b8e`, the Command
  Center KPI redesign) captured `command-center/page.tsx` in its
  Phase-1-dependent form for the first time, without the lib file it
  imports (still untracked at that point), and broke the production
  build. Root-caused via the same git-history tracing as those two
  prior incidents, fixed by committing the missing file (`d5cb6e3`),
  then shipping the remaining 8 files (`ed1c5cb`), the Phase 2 script
  (`a0724f7`), and the `payment_transactions` documentation (`2e8162d`)
  as three separate, correctly-scoped commits rather than retroactively
  bundling them.

- **Operator Update's cascade compounds if the same stage is submitted
  twice in a row — mitigated at the UI layer, not database-enforced.**
  Discovered live while verifying the negative-delta path: a sibling's
  baseline is `revised_finish ?? planned_finish` (an exact port of the
  source), so a second submission reuses the first one's already-shifted
  sibling values as its new baseline and shifts them again on top — not
  a bug, the Python original has the identical baseline preference and
  would compound the same way.
  Closed the common case (deliberate improvement over the source, same
  category as Archive's delete-confirmation gate): `OperatorUpdatePanel`
  now guards `handleSubmit` with a `useRef` flag checked and set
  synchronously before `startTransition` fires, reset in a `finally`
  once the action settles. `isPending` alone (the convention every other
  write button in this app uses) wasn't enough — its disabled state
  lags the click by a render cycle, so two clicks close enough together
  can both fire before React commits it; a plain ref has no such window
  since it isn't gated by a render. Verified live twice: a **sequential**
  double-click (second click after the first's success message had
  already rendered) correctly still compounds — that's two deliberate
  separate actions, not a race, and is expected to apply the update
  twice. A **genuine simultaneous** double-click (both clicks landing
  before any response) produced clean single-run math on both siblings,
  confirming the second click was truly dropped, not just visually
  disabled while still submittable.
  This is a client-side re-entrancy guard, not idempotency at the write
  layer — `update_stage_status` itself is unchanged and has no
  protection against two independent requests that both reach the
  server essentially simultaneously (a fast enough machine-gun click
  past real network latency, or two separate browser tabs/devices
  acting on the same stage at once, could theoretically still race past
  this). It closes the realistic single-operator, single-tab case; real
  write-layer idempotency (e.g. a version/timestamp check in the update)
  would be a separate, larger fix if this ever needs to be airtight.
- `parseTimestamptz()` (`src/lib/parse-timestamptz.ts`, shared — now
  actually imported by four files: My Order Tracker's pipeline banner,
  Shop Floor Control's `shop-floor-client.tsx` and `actions.ts`, and
  Production Layout Builder's `scheduling.ts`) has a UTC-forcing
  fallback for values that arrive without a timezone offset. `jobs`
  is no longer the empty table this note originally described — it's
  had real rows multiple times since (Production Layout Builder's
  live scheduling test, several Shop Floor Operator Update cascade
  tests), and those rows flowed through this function without a
  crash. What's still open in the narrow, literal sense: nobody has
  explicitly watched a browser console during one of those loads to
  confirm the UTC-forcing `console.error` fallback path never fired
  — it's inferred from the absence of a crash, not directly observed.
  If it ever does fire — i.e. a real row is missing a timezone offset
  — that means the `timestamptz` column type is being violated
  somewhere upstream (e.g. the insert path writing a naive string).
  That's worth escalating and fixing at the source, not silently
  working around again in this function.
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
- **Command Center's `pendingApprovals` KPI never matched any real
  row — found during a doc audit, now fixed.**
  `src/app/command-center/page.tsx` queried `job_orders` filtered to
  `status = 'Pending'`, but every real/live status value confirmed
  this session is `'Pending Approval'` or `'Pending Revision
  Approval'` — the bare string `'Pending'` is never actually written
  by any path. Traced end-to-end via grep: `pendingRes.count` →
  `pendingApprovals` → `AppShell`'s `pendingApprovalsCount` prop →
  `Sidebar`'s badge next to Authorization Center in the nav
  (`item.badgeKey === "pendingApprovals" ? pendingApprovalsCount : 0`).
  So that badge had been silently showing 0 regardless of how many
  orders were actually awaiting approval. **Fixed** by switching the
  query to `.in("status", PENDING_STATUSES)` with the exact same
  `PENDING_STATUSES = ["Pending Approval", "Pending Revision
  Approval"]` list Authorization Center's own `page.tsx` already uses
  and has proven — not a new pattern. Verified live: 0 real rows
  matched the filter, so a throwaway `Pending Approval` test row
  (`id=94`, `TEST - DO NOT SHIP (pendingApprovals-badge-test)`) was
  inserted, the sidebar badge was confirmed to move off 0 to reflect
  it, and the test row was then deleted (confirmed gone via a
  follow-up query — 0 `TEST`-named rows remain in `job_orders`).

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
- **Every DDL change gets a migration file in `supabase/migrations/` at
  the same time it's applied to Supabase — applied-and-captured
  together, never applied-then-described.** DDL is still run in the
  Supabase SQL editor (this tooling has no Supabase DDL access), but the
  exact statement is committed as a dated, numbered `*.sql` file in that
  folder in the same change, so the live schema is never the only source
  of truth. The existing files there are a one-time back-capture of all
  DDL applied before this rule existed (see `supabase/migrations/README.md`);
  from now on the folder must not fall behind the database again.
- **Before any commit, still run `tsc --noEmit` and `eslint` by hand —
  but `npm run build` itself is no longer a manual step to remember.**
  A Vercel deploy broke (Uninvoiced Orders' `ARCHIVE_STATUSES` import)
  even though `tsc`/`eslint` were run and passed clean beforehand: both
  ran against the local working tree, which already had the fix
  (`export const ARCHIVE_STATUSES`) applied but *uncommitted* — the
  commit that shipped left that file's change out, so the pushed `HEAD`
  Vercel actually built from was still broken. `tsc`/`eslint` checking
  the working tree is not the same guarantee as `npm run build`
  succeeding against what's actually about to be pushed — and a second,
  separate production build failure after this rule was first written
  (never a landed hook, just a restated manual instruction) confirmed
  that "remember to run it" doesn't hold up on its own.
  **Now enforced by a Husky pre-push hook (`.husky/pre-push`, running
  `npm run build`), wired via package.json's `prepare` script so it
  reinstalls automatically on every fresh clone/`npm install` — not a
  local-only `.git/hooks` file that silently vanishes on re-clone.**
  Verified for real on 2026-08-30, not just assumed to work: a
  deliberately broken commit (an import of a non-existent named export,
  the same class of bug as `ARCHIVE_STATUSES`/`jobOrders`) was pushed —
  `npm run build` failed inside the hook and `git push` was rejected
  before anything reached GitHub; the breakage was then removed and a
  clean push of the same branch went through normally. A broken build
  can still reach GitHub only via `git push --no-verify`, which is why
  that flag is never used to route around a real failure.

## UI Conventions

Formalized 2026-08-31, following a full read-only UX audit across every
route (organized by the sidebar's three groups: Plant Operations,
Administrative Portal, Reporting & Oversight) that found each of the
five patterns below implemented two or more different ways across the
app, with no rule ever having decided which one was "right." Documented
here BEFORE any individual page from that audit gets fixed, specifically
so the dozen-plus fixes that follow don't each independently re-decide
these — every future page (new or fixed) follows the rule below, not
whichever nearby example it happens to copy from.

1. **Pill toggle sizing.** Every Weekly/Monthly, status-filter,
   category-filter, or view-switch pill toggle uses `rounded-full
   border px-4 py-1.5 text-sm font-semibold` (the active/inactive color
   classes already agree everywhere: `border-at-navy bg-at-navy
   text-at-white` active, `border-at-border bg-at-white text-at-slate
   hover:border-at-accent` inactive). This is Command Center's Trend/
   Departmental Performance toggle and Revenue Analysis's Weekly/Monthly
   toggle — the more recently built convention, chosen over the smaller
   `px-3 py-1 text-xs` variant currently on My Order Tracker, Category
   Report, Samples, and Audit Log. Those four get migrated to the larger
   size when their turn comes; nothing new should ever be built at the
   smaller size again.

2. **Amber callout / warning box.** `--at-warning-bg` (`#fef7e0`) and
   `--at-warning-text` (`#b06000`) (`src/app/globals.css`) are the ONLY
   sanctioned colors for a warning/callout box, full stop. Raw Tailwind
   `bg-amber-50`/`text-amber-800`/`border-amber-300` (and any gradient
   variant, e.g. Archive's Revision Lifecycle Notice) is deprecated
   everywhere it currently appears (Command Center's uncategorized-
   orders warning, Raise Job Order's duplicate-client warning, Material
   Receipts'/Material Issuances' `EditedBadge`, Archive). These are NOT
   the same shade as Tailwind's stock `amber-*` scale — a find/replace
   of class names alone would silently shift the actual color, so each
   fix needs the real token classes, not a renamed equivalent.

3. **Money formatting.** Tight `"GH₵1,234.00"` (no space after the
   currency symbol) is the app-wide standard, already the convention on
   the Finance/Revenue family (Invoice Entry, Category Report,
   Uninvoiced Orders, Revenue Analysis) — chosen over the spaced
   `"GH₵ 1,234.00"` variant on Raise Job Order, Authorization Center, My
   Order Tracker, and Dispatch, since tight is already standard on the
   pages that handle the most financial detail. Those four get migrated
   to tight when their turn comes.

4. **Scope disclosure: InfoPopover vs. permanent caption.** These are
   NOT interchangeable choices — each has a distinct, now-documented
   job:
   - **InfoPopover** (the small "(i)" hover/click icon — exported from
     `src/app/command-center/charts.tsx`) is the standard for a "what's
     included/excluded" scope fact: which statuses, which date window,
     which table a figure is drawn from. Default choice for any new
     figure that needs this kind of disclosure. Reference examples:
     Command Center's KPI cards, Trend chart, Departmental Performance,
     Revenue by Job, Order Intake Trend.
   - **Permanent, always-visible caption**
     (`<div className="text-xs text-at-slate">`) is reserved for
     exactly two cases, not a general-purpose alternative to the
     popover: (a) a plain "how this feature works" explanation with no
     scope caveat to hide behind a click — Material Receipts' "Record
     incoming stock. Stock Balance updates automatically — no separate
     sync step." is the reference example; and (b) a caveat serious
     enough that it must never be missed even by someone who doesn't
     think to click an icon — AR Aging's payment-timing limitation and
     My Sales Dashboard's attribution-gap warning are the two reference
     examples, the latter additionally using the amber callout box
     (rule 2) for extra visual weight given how consequential it is.

   A page choosing between these two for a NEW scope fact defaults to
   InfoPopover; permanent caption is the deliberate exception, not a
   coin flip. Pages that picked one arbitrarily (documented in the
   2026-08-31 audit) get reconciled to this rule when their turn comes —
   this entry is the rule they get reconciled against, not a
   retroactive rewrite of history.

5. **Expand/collapse.** `CollapsibleMonthGroup`
   (`src/components/ui/collapsible-month-group.tsx`) is the only
   sanctioned expand/collapse component. For a month-based grouping,
   use it as-is. For a non-time-based grouping, use the SAME component
   under its existing name rather than inventing a new one — Stock
   Balance's `section_group` reuse is the reference example (a
   deliberate, self-commented repurposing, not a violation of this
   rule). If its generic props ever genuinely stop fitting a new
   grouping shape, rename/generalize that ONE component rather than
   hand-rolling a second toggle-plus-local-state implementation next to
   it. Authorization Center's `GroupCard` and Shop Floor Control's two
   hand-rolled toggles (Machine Utilisation, Operator Update) are the
   known violations to reconcile when their turn comes.

## Implemented design decision — Die Cutter to Folder Gluer scheduling

Originally scoped to Production Layout Builder's scheduling engine
before that route existed. **Now implemented** — see
`dieCutterToFolderGluerStart()` in
`src/app/production-layout/scheduling.ts`, and the Production Layout
Builder entry under "Routes migrated" for how it was verified (a
standalone hand-checkable test harness before ever touching a real
order, then a live end-to-end synthetic-order test). Left in place
below as the historical record of the decision and why it was made,
not as an open question anymore.

**Current code** (`app.py`'s `_next_working_day_start()`, cited as
lines 1271-1284 — *not independently re-verified against source for
this entry, since `app.py` isn't present in the repo right now; taken
as given from the person who reported it*): every downstream stage,
including Die Cutter after any press stage *and* Folder Gluer after Die
Cutter, starts the next calendar working day after the upstream stage's
**start** time. One uniform rule applied to every transition.

**Final rule set** (confirmed directly by the business owner):

- **Printing → Die Cutter:** next working day after printing starts
  (sheets need to dry overnight). This **matches** the current code —
  `_next_working_day_start()` already gets this leg right, **no change
  needed** here.
- **Die Cutter → Folder Gluer, for EVERY job that goes through this
  transition** (not just skillet/packaging jobs — the earlier open
  question of "all jobs vs. `ups > 1` only" is resolved in favor of
  **all jobs**, regardless of type): 3 hours after Die Cutter's actual
  start time, **same day** — not next-day. If that 3-hour mark falls
  outside working hours or on a weekend, snap forward to the next
  working-shift start by reusing the existing `apply_calendar_bounds()`
  logic — no new mechanism needed for that part.

**How this was implemented:** the scheduling function branches by
transition, not one uniform offset rule for every stage —
Printing→Die Cutter still calls `nextWorkingDayStart()` (the
`_next_working_day_start()` port) unchanged, while Die Cutter→Folder
Gluer instead calls `dieCutterToFolderGluerStart()`, which computes
`dieCutterActualStart + 3 hours` and passes that through
`applyCalendarBounds()`. No branching on `ups`, `isGarment()`, or any
other job-type classification — it's uniform across all jobs, per the
resolved scope question above.

## Next up

- Write the RLS policies `nav-config.ts` implies, so access control
  doesn't rest solely on the app layer.
- **Configure the seven notifications' env vars with real addresses in
  Render's Environment tab** (this repo/tooling has no access to
  Render — this can only be done by whoever has dashboard access):
  `APPROVAL_NOTIFY_EMAILS`, `APPROVAL_CC_EMAILS`,
  `SCHEDULER_NOTIFY_EMAILS`, `WAREHOUSE_NOTIFY_EMAILS`,
  `FINANCE_NOTIFY_EMAILS` (these six work today via fallback either
  way, but whether Render currently has real values set or is still on
  the fallbacks is unverified — see "What's NOT done yet"),
  `DEPT_EMAILS_PRESS` + `DEPT_EMAILS_GARMENT` (send_departmental_alert
  sends nothing at all until these are set — no fallback, by design),
  and `APP_URL` (cosmetic — the departmental alert's link button).
