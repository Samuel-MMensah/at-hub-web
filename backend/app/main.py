"""
Appointed Time — support service.

Purpose: keep the three things that have no clean browser equivalent
running server-side, unchanged from their proven Python implementation:
  1. PDF manifest generation   (reportlab — ports generate_pdf_manifest,
     generate_garment_pdf_manifest, dispatch_pdf_manifest from app.py).
     DONE — see app/pdf.py, wired below.
  2. Departmental / lifecycle email alerts (resend — ports app.py's
     notify_* functions and messaging.py's send_departmental_alert into
     app/email.py). All seven deferred notifications are DONE — see
     app/email.py and the /email/* endpoints below.
  3. Production scheduling math (calculate_production_time,
     get_machine_next_available_time, working-day calendar logic).
     Not started (Production Layout Builder's scheduling.ts already
     covers this on the frontend instead — see MIGRATION_STATUS.md).

Everything else (data reads, RBAC, UI) lives in the Next.js app talking
directly to Supabase. This service is intentionally small — a handful of
endpoints, not a general API layer — so the migration surface stays
auditable.

Every endpoint here requires require_user() from day one — see
MIGRATION_STATUS.md's rules section for why that's a hard rule, not a
preference.
"""
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.auth import require_user
from app.config import ALLOWED_ORIGINS
from app.email import (
    handle_order_approved,
    handle_order_rejected,
    handle_order_submitted,
    handle_overdue_alert,
    handle_ready_for_finance,
    handle_sent_to_warehouse,
)
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


class OrderSubmittedRequest(BaseModel):
    # Every id from ONE raise event (a whole batch, or a single
    # resubmit's one row) — see handle_order_submitted's docstring for
    # why this takes ids, not a client-supplied payload, and why
    # order_ids[0] is significant (its row supplies every field except
    # total_amount, which is summed across all of them).
    order_ids: list[int]


@app.post("/email/order-submitted")
def order_submitted_alert(payload: OrderSubmittedRequest, user=Depends(require_user)):
    return handle_order_submitted(payload.order_ids)


class OrderApprovedRequest(BaseModel):
    order_id: int


@app.post("/email/order-approved")
def order_approved_alert(payload: OrderApprovedRequest, user=Depends(require_user)):
    """Fans out to notify_order_approved + notify_needs_scheduling +
    send_departmental_alert as independent attempts — see
    handle_order_approved's docstring for why."""
    return handle_order_approved(payload.order_id)


class OrderRejectedRequest(BaseModel):
    order_id: int


@app.post("/email/order-rejected")
def order_rejected_alert(payload: OrderRejectedRequest, user=Depends(require_user)):
    return handle_order_rejected(payload.order_id)


class SentToWarehouseRequest(BaseModel):
    order_id: int


@app.post("/email/sent-to-warehouse")
def sent_to_warehouse_alert(payload: SentToWarehouseRequest, user=Depends(require_user)):
    return handle_sent_to_warehouse(payload.order_id)


class ReadyForFinanceRequest(BaseModel):
    order_id: int


@app.post("/email/ready-for-finance")
def ready_for_finance_alert(payload: ReadyForFinanceRequest, user=Depends(require_user)):
    """Email only — the warehouse_notified_finance DB write already
    happened in warehouse/actions.ts before this is ever called. See
    handle_ready_for_finance's docstring."""
    return handle_ready_for_finance(payload.order_id)


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
