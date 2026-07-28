"""
Appointed Time — support service.

Purpose: keep the three things that have no clean browser equivalent
running server-side, unchanged from their proven Python implementation:
  1. PDF manifest generation   (reportlab — ports generate_pdf_manifest,
     generate_garment_pdf_manifest, dispatch_pdf_manifest from app.py)
  2. Departmental / lifecycle email alerts (resend — ports messaging.py's
     send_departmental_alert and app.py's notify_* functions)
  3. Production scheduling math (calculate_production_time,
     get_machine_next_available_time, working-day calendar logic)

Everything else (data reads, RBAC, UI) lives in the Next.js app talking
directly to Supabase. This service is intentionally small — a handful of
endpoints, not a general API layer — so the migration surface stays
auditable.

Next steps to fill in (kept as stubs here on purpose, so nothing runs
against production data until you've reviewed the port):
  - Port reportlab layout code from app.py lines ~1528-2189 into
    app/pdf.py, called from POST /pdf/manifest.
  - Port messaging.py's send_departmental_alert + app.py's notify_*
    functions into app/email.py, called from POST /email/*.
  - Port calculate_production_time + calendar helpers into
    app/scheduling.py, called from POST /scheduling/estimate.
  - Add auth: verify the caller holds a valid Supabase session/service
    role before generating a PDF or sending an email on someone's behalf.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS

app = FastAPI(title="Appointed Time — Support Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # set via ALLOWED_ORIGINS env var, see .env.example
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/pdf/manifest")
def generate_manifest():
    # TODO: port from app.py's generate_pdf_manifest / dispatch_pdf_manifest
    raise NotImplementedError("Port reportlab manifest logic from app.py here.")


@app.post("/email/departmental-alert")
def departmental_alert():
    # TODO: port from messaging.py's send_departmental_alert
    raise NotImplementedError("Port send_departmental_alert from messaging.py here.")
