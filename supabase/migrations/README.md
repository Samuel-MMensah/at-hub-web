# supabase/migrations

DDL history for this project, captured as dated, numbered SQL files in the
standard Supabase migrations layout (`<YYYYMMDDHHMMSS>_<name>.sql`).

## Read this first — these are BACK-CAPTURED

Every migration here was **already applied to production** (run directly in the
Supabase SQL editor) **before** this folder existed. They were written after the
fact, by reconstructing what actually ran from the project's build history, so
the live schema stops being the only source of truth. **Do not assume applying
these to the production database is a no-op or is needed** — production already
has all of this. Their purpose is version control, review, and reproducibility
(e.g. standing up a fresh/local database).

## Conventions

- **Timestamps:** the **date** in each filename is real (from git history); the
  **time** is synthetic — it exists only to preserve the correct replay order
  within a day. We never recorded exact application times.
- **Fidelity:** statements are copied **verbatim from the build transcript**
  wherever possible. Where a statement could not be recovered exactly, the file
  says so in a comment and gives a faithful reconstruction of the applied end
  state rather than presenting a guess as fact. Files carrying such notes today:
  - `20260803100000_materials_rls.sql` — the `ENABLE ROW LEVEL SECURITY`
    statements are reconstructed (required for the verbatim policies to work).
  - `20260806093000_sample_reason_constraints_revised.sql` — the transition from
    `sample_reason_only_when_sample` to the live `sample_reason_requires_flag` +
    `sample_reason_valid_values` is partially reconstructed; `valid_values` was
    noted in project history as a constraint this project did not author.
  - A few RLS policy **display names** were reconstructed where the transcript
    truncated them; predicates are verbatim.
- **Intermediate states are preserved, not collapsed.** Where an object was
  built and then corrected, both states are kept as separate files, because the
  correction is itself part of the real history:
  - `stock_balance`: `20260803093000` (initial, no `security_invoker` — the
    RLS-bypass bug) → `20260803120000` (`security_invoker` fix + cost columns).
  - sample constraints: `20260806090000` → `20260806093000` (see note above).
  - `sample_conversion_status`: `20260809090000` → `20260809093000` (extended).

## Deliberately NOT included

- **Baseline schema.** `job_orders`, `profiles`, and the original auth RLS
  (including profiles' self-scoped SELECT policy) predate this project's tracked
  DDL work; their exact original statements aren't recoverable, so they are not
  reconstructed here. Migrations reference these as pre-existing.
- **`valid_roles` CHECK on `profiles`.** Discovered via a live query, not
  authored by this project — pre-existing, so not captured.
- **Data, not DDL.** Seeds/imports/backfills (the 479-row material_catalog
  import, the clients seed, the client_id backfill, the attachment-path backfill)
  were run via backend service-role scripts in `backend/scripts/`, not as
  migrations.

## Going forward

Per MIGRATION_STATUS.md ("Rules to keep following"): every **new** DDL change
gets a migration file added here **at the same time** it's applied to Supabase —
applied-and-captured together, never applied-then-described.
