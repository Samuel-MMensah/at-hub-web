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
    command-center/
      page.tsx           ← first migrated route (mock data — see TODO inside)
  components/
    shell/
      sidebar.tsx        ← real icon nav w/ role-gated groups + active state
                            (the thing Streamlit's st.button-as-nav couldn't do)
      topbar.tsx         ← page title/subtitle, matches .main-title/.main-subtitle
      app-shell.tsx      ← combines sidebar + content area
    ui/
      metric-card.tsx    ← matches .metric-card exactly (hover lift, accent border)
      status-badge.tsx   ← matches .sf-status-badge variants
  lib/
    nav-config.ts        ← nav structure + RBAC gating, mirrors app.py's
                            ops_modules / admin_modules construction and
                            rbac.py's ADMIN_ROLES / WAREHOUSE_ROLES / FINANCE_ROLES
    utils.ts              ← cn() class-merge helper

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

- No Supabase client wired up — Command Center renders mock data with a
  `TODO(supabase)` marking exactly where the real fetch goes.
- No auth flow / login page yet.
- No RLS policies written yet — `nav-config.ts`'s `roles` arrays are the
  intended source of truth to translate into Postgres RLS.
- PDF generation and email sending are stubs in `backend/app/main.py`
  with docstrings pointing at the exact app.py line ranges to port.
- Only one route (`/command-center`) exists. Every other module
  (Raise Job Order, Authorization Center, Warehouse, Dispatch,
  Production Board, Shop Floor Control, My Order Tracker, Archive,
  Audit Log) still lives in Streamlit until migrated one at a time.

## Suggested next PR

Auth: a login page + Supabase session check wrapping `AppShell`, replacing
mock `role`/`userName` props with real session data. That unblocks every
subsequent route migration, since they all assume a logged-in user.
