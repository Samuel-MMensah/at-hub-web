"""
Appointed Time — support service.

Purpose: keep the three things that have no clean browser equivalent
running server-side, unchanged from their proven Python implementation:
  1. PDF manifest generation   (reportlab — ports generate_pdf_manifest,
     generate_garment_pdf_manifest, dispatch_pdf_manifest from app.py).
     DONE — see app/pdf.py, wired below.
  2. Departmental / lifecycle email alerts (resend — ports messaging.py's
     send_departmental_alert and app.py's notify_* functions). Still a
     stub.
  3. Production scheduling math (calculate_production_time,
     get_machine_next_available_time, working-day calendar logic).
     Not started.

Everything else (data reads, RBAC, UI) lives in the Next.js app talking
directly to Supabase. This service is intentionally small — a handful of
endpoints, not a general API layer — so the migration surface stays
auditable.

Next steps to fill in (kept as stubs here on purpose, so nothing runs
against production data until you've reviewed the port):
  - Port messaging.py's send_departmental_alert + app.py's notify_*
    functions into app/email.py, called from POST /email/*.
  - Port calculate_production_time + calendar helpers into
    app/scheduling.py, called from POST /scheduling/estimate.
  - Every endpoint added here needs require_user() (app/auth.py) from
    day one, not bolted on after the fact like POST /pdf/manifest was —
    see MIGRATION_STATUS.md's rules section.
"""
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.auth import require_user
from app.config import ALLOWED_ORIGINS
from app.email import handle_overdue_alert
from app.pdf import _is_garment, dispatch_pdf_manifest, sanitize_customer_name_for_filename
from app.supabase_client import get_supabase

app = FastAPI(title="Appointed Time — Support Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # set via ALLOWED_ORIGINS env var, see .env.example
    allow_methods=["*"],
    allow_headers=["*"],
    # Content-Disposition isn't on the browser's default CORS-safelisted
    # response headers — without this, fetch()'s Response.headers.get()
    # silently returns null for it cross-origin (curl doesn't enforce
    # this, so it's invisible to a plain curl test). The PDF preview
    # component reads this header to get the real filename (with the
    # Garment/ prefix), so it has to be explicitly exposed.
    expose_headers=["Content-Disposition"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


class ManifestRequest(BaseModel):
    # job_orders.id (bigint) — the same key already used throughout the
    # Next.js app's Server Actions. The backend fetches the row itself
    # from the service-role client rather than trusting a client-supplied
    # data blob, since this document is meant to reflect DB truth (a
    # caller-supplied total_amount/customer_name could otherwise be used
    # to produce a fraudulent-looking official manifest).
    order_id: int


@app.post("/pdf/manifest")
def generate_manifest(payload: ManifestRequest, user=Depends(require_user)):
    supabase = get_supabase()
    res = supabase.table("job_orders").select("*").eq("id", payload.order_id).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail=f"job_orders row not found for id={payload.order_id}")

    ticket = res.data[0]
    pdf_buffer = dispatch_pdf_manifest(ticket)

    order_no = ticket.get("job_order_no") or "PENDING"
    customer = sanitize_customer_name_for_filename(ticket.get("customer_name"))
    filename = f"{'Garment' if _is_garment(ticket) else ''}Manifest_{customer}_{order_no}.pdf"

    return Response(
        content=pdf_buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/email/departmental-alert")
def departmental_alert():
    # TODO: port from messaging.py's send_departmental_alert
    raise NotImplementedError("Port send_departmental_alert from messaging.py here.")


class CollectionOverdueRequest(BaseModel):
    order_id: int


@app.post("/email/collection-overdue")
def collection_overdue_alert(payload: CollectionOverdueRequest, user=Depends(require_user)):
    """
    Command Center (a Next.js Server Component) identifies candidate
    order ids from data it already has and calls this once per
    candidate on every page load -- the dedup claim and the send both
    happen here, backend-side, not as a write from the Server
    Component itself. See handle_overdue_alert for the atomicity
    argument.
    """
    return handle_overdue_alert(payload.order_id)
