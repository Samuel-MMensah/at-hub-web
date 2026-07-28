# Appointed Time — Web Foundation

Foundation scaffold for migrating the Streamlit app to Next.js + Supabase,
per the strangler-fig plan: this runs *alongside* the existing Streamlit
app, one route at a time, until every module has moved over.

## What's here

```
src/
  app/
    globals.css        ← design tokens ported 1:1 from app.py's --at-* CSS vars
    layout.tsx          ← Inter font, matches original typography
    page.tsx             ← redirects to /command-center
    login/
      page.tsx           ← email/password sign-in form (useActionState)
      actions.ts         ← login() / logout() server actions
    command-center/
      page.tsx           ← first migrated route, real Supabase KPI queries
                            against job_orders / jobs (no more mock data)
  components/
    shell/
      sidebar.tsx        ← real icon nav w/ role-gated groups + active state
                            (the thing Streamlit's st.button-as-nav couldn't do);
                            logout button posts to login/actions.ts's logout()
      topbar.tsx         ← page title/subtitle, matches .main-title/.main-subtitle
      app-shell.tsx      ← combines sidebar + content area
    ui/
      metric-card.tsx    ← matches .metric-card exactly (hover lift, accent border)
      status-badge.tsx   ← matches .sf-status-badge variants
  lib/
    auth.ts              ← requireUser(): session check + profiles lookup,
                            redirects to /login if unauthenticated
    supabase/
      server.ts          ← Server Component / Server Action Supabase client
      client.ts           ← browser Supabase client
    nav-config.ts        ← nav structure + RBAC gating, mirrors app.py's
                            ops_modules / admin_modules construction and
                            rbac.py's ADMIN_ROLES / WAREHOUSE_ROLES / FINANCE_ROLES
    utils.ts              ← cn() class-merge helper
  proxy.ts             ← runs on every request: refreshes the Supabase
                          session cookie, gates unauthenticated routes to
                          /login (named `proxy` not `middleware` — this
                          Next.js version's renamed convention)

backend/
  app/main.py             ← FastAPI stub for PDF generation + email (see its
                            docstring for exactly what still needs porting)
  requirements.txt
```

## Design tokens — 1:1 port, not a redesign

Every color in `globals.css` is the *exact* hex value from app.py's
`:root { --at-navy: #0f172a; ... }` block. This is deliberate: the brand
already exists and is specific to this business, not a generic default —
this migration formalizes it into Tailwind theme variables (`bg-at-navy`,
`text-at-accent`, `shadow-at-sm`, etc.) instead of copy-pasting hex codes
into ~130 inline style strings the way the Streamlit version had to.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
```

You'll need real Google Fonts network access for the Inter import to
resolve (blocked in the sandbox this was built in — works fine on
Vercel/any normal host).

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## What's NOT done yet (by design — foundation phase only)

- No RLS policies written yet — `nav-config.ts`'s `roles` arrays are the
  intended source of truth to translate into Postgres RLS. Right now
  `job_orders`/`jobs` reads work because the signed-in user's session is
  present, not because row-level policies scope what they can see.
- PDF generation and email sending are stubs in `backend/app/main.py`
  with docstrings pointing at the exact app.py line ranges to port.
- Only two routes (`/login`, `/command-center`) exist. Every other module
  (Raise Job Order, Authorization Center, Warehouse, Dispatch,
  Production Board, Shop Floor Control, My Order Tracker, Archive,
  Audit Log) still lives in Streamlit until migrated one at a time.

## What's done

- Auth is real and committed: `src/proxy.ts` gates every route, `src/lib/auth.ts`'s
  `requireUser()` loads the session + `profiles` row, `src/app/login/` handles
  sign-in/sign-out. `AppShell`'s `userName`/`userRole`/`role` props now come
  from the real session, not mock values.
- Command Center's KPIs are real Supabase queries against `job_orders` and
  `jobs` (see `src/app/command-center/page.tsx`), not mock data.

## Suggested next PR

Write the RLS policies that `nav-config.ts`'s `roles` arrays imply, so
access control isn't resting solely on client-side nav gating — then pick
the next Streamlit module to migrate (Raise Job Order is the next
dependency-free one; Authorization Center depends on it existing first).
