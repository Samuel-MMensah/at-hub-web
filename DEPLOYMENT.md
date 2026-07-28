# Deployment & Keys Setup

This walks through getting real keys in place and going live on subdomains,
without touching anything the current Streamlit app depends on.

**Rule for the whole process: never put a real key in a file that gets
committed.** Every `.env.example` / `render.yaml` in this repo is a
template with placeholder values on purpose. Real values only ever go
into: (a) your local `.env.local` / `backend/.env`, both git-ignored, or
(b) the hosting dashboard's environment-variable panel.

---

## 1. Supabase — reuse the existing project, don't create a new one

The new app should point at the **same** Supabase project the Streamlit
app already uses — same `job_orders`, `profiles`, same Auth users. There
is nothing to migrate.

Get the two keys the frontend needs:
- Supabase dashboard → your project → **Project Settings → API**
- Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- Copy **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Get the one key the backend needs (different key, more powerful):
- Same page → copy **service_role key (secret)** → `SUPABASE_SERVICE_ROLE_KEY`
- This key bypasses RLS. It belongs only in the Render backend's env vars.
  Never put it in the Next.js app, never put it in a `NEXT_PUBLIC_*` var
  (anything prefixed `NEXT_PUBLIC_` is shipped to the browser, visible to
  anyone).

Local dev:
```bash
cp .env.example .env.local        # fill in the two Supabase values
cp backend/.env.example backend/.env   # fill in service role key, etc.
```

---

## 2. Resend — same account, one new sender/domain if you want one

If the Streamlit app already sends via Resend, you can reuse the same
`RESEND_API_KEY` — copy it from **Resend dashboard → API Keys** into
`backend/.env`'s `RESEND_API_KEY`.

Optional but recommended before going live: verify a real sending domain
(e.g. `mail.appointedtime.com`) in **Resend → Domains** instead of using
the shared `onboarding@resend.dev` address, so departmental alerts don't
land in spam. That's a DNS step at Namecheap too — see §5.

---

## 3. Render — backend hosting

1. Push this repo to GitHub (private repo is fine).
2. Render dashboard → **New +** → **Blueprint** → connect the repo.
   Render reads `render.yaml` at the repo root and proposes the service.
3. When prompted, fill in the env vars (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_SENDER_EMAIL`,
   `ALLOWED_ORIGINS`) — these go directly into Render's dashboard, not
   into any file.
4. Deploy. Render gives you a URL like `appointed-time-backend.onrender.com`
   — that's your backend until §5's custom domain step.
5. Sanity check: `curl https://appointed-time-backend.onrender.com/health`
   should return `{"status": "ok"}`.

---

## 4. Vercel — frontend hosting

Next.js is built by the people who make Vercel, so it's the path of
least friction (though Render can host Next.js too, if you'd rather keep
everything on one platform — ask if you want that variant instead).

1. Vercel dashboard → **Add New → Project** → import the same GitHub repo.
2. Root directory: leave as repo root (Vercel auto-detects the Next.js
   app since `package.json` is at the top level; the `backend/` folder
   is simply ignored by the Next.js build).
3. Add env vars in **Project Settings → Environment Variables**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `NEXT_PUBLIC_BACKEND_URL` (your Render URL from §3).
4. Deploy. Vercel gives you a URL like `at-hub-web.vercel.app` immediately
   — usable as-is for internal testing before you touch DNS at all.

---

## 5. Namecheap — pointing a subdomain at each, without touching the rest

Your existing domain and whatever records the Streamlit app currently
uses (an A record, a CNAME to Streamlit Cloud, etc.) **stay exactly as
they are.** You're only *adding* new subdomains, not editing existing ones.

Namecheap dashboard → **Domain List** → your domain → **Manage** →
**Advanced DNS** → **Add New Record**:

**Frontend subdomain** (e.g. `beta.appointedtime.com`):
- Type: `CNAME Record`
- Host: `beta`
- Value: the target Vercel gives you when you add this domain in
  Vercel → Project Settings → Domains (usually `cname.vercel-dns.com`)
- TTL: Automatic

**Backend subdomain** (e.g. `api.appointedtime.com`) — optional, only if
you want a clean URL instead of the `.onrender.com` one:
- Type: `CNAME Record`
- Host: `api`
- Value: the target shown in Render → your service → **Settings → Custom
  Domain** after you add `api.appointedtime.com` there
- TTL: Automatic

**Resend sending domain** (if you did the optional step in §2):
- Resend will show you 2–3 DNS records to add (typically `TXT` for
  domain verification + `MX`/`TXT` for DKIM). Add exactly what Resend's
  dashboard shows, under whatever subdomain you chose (e.g. `mail`).

DNS propagation is usually minutes, occasionally a few hours. Nothing
here is destructive or reversible-with-difficulty — deleting a CNAME you
just added takes 10 seconds if anything looks wrong.

---

## Order of operations, start to finish

1. Fill in `.env.local` and `backend/.env` locally, confirm `npm run dev`
   and `uvicorn app.main:app --reload` both run against real Supabase data.
2. Deploy backend to Render (§3) — get the `.onrender.com` URL working first.
3. Deploy frontend to Vercel (§4), pointed at that Render URL — get the
   `.vercel.app` URL working, share it with just yourself/one admin.
4. Once that's solid, add the Namecheap subdomains (§5) so it has a real
   URL your team can bookmark — still just Command Center, still nobody
   else's workflow has changed.
5. Everything from here on is the route-by-route cutover from the
   earlier conversation — the infrastructure part is done at this point.
