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
from app.pdf import (
    _is_garment,
    dispatch_pdf_manifest,
    generate_category_report_pdf,
    sanitize_customer_name_for_filename,
)
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


REVENUE_CATEGORIES = [
    "Large Format", "Screen Print", "Embroidery", "Digital Press",
    "Commercial Press", "Publishing", "Packaging",
]


class CategoryReportRequest(BaseModel):
    # Always a non-empty list from the real UI (Generate is disabled
    # client-side until at least one category is checked) — no more
    # None="All Categories" special case. Selecting all 7 individually
    # produces the same filtered set as the old unfiltered query, since
    # .in_() against every real category value matches everything.
    categories: list[str]
    from_date: str  # YYYY-MM-DD
    to_date: str  # YYYY-MM-DD


@app.post("/pdf/category-report")
def category_report_pdf(payload: CategoryReportRequest, user=Depends(require_user)):
    # Defense in depth — the real UI never sends an empty list (Generate
    # is disabled until >=1 category is picked), but this endpoint
    # doesn't trust the client for anything else either (see below).
    if not payload.categories:
        raise HTTPException(status_code=400, detail="Select at least one category.")

    # Re-queries job_invoices itself via the service-role client, rather
    # than trusting a client-supplied row list — same "DB truth, not
    # caller-supplied data" posture as /pdf/manifest above (a client
    # could otherwise hand this endpoint fabricated rows/totals to
    # produce a fraudulent-looking official report).
    supabase = get_supabase()
    rows = (
        supabase.table("job_invoices")
        .select(
            "date, job_order_no, customer_name, revenue_category, product_description, "
            "business_unit, quantity, amount, invoice_total, payment, balance, sales_rep"
        )
        .gte("date", payload.from_date)
        .lte("date", payload.to_date)
        .in_("revenue_category", payload.categories)
        .order("date")
        .execute()
        .data
        or []
    )

    # sales_rep is only stored directly on job_invoices for an UNLINKED
    # entry (job_order_no IS NULL) — the sales_rep_only_when_unlinked
    # CHECK constraint guarantees it's always null on a LINKED one,
    # where the real salesperson lives on the linked job_orders row
    # instead. Re-queried here (never trusting the client) for exactly
    # the order numbers this report's own rows reference, same "DB
    # truth, not caller-supplied data" posture as the rest of this
    # endpoint. Each row is then overwritten in place with its real
    # effective sales_rep, so generate_category_report_pdf can just
    # read row["sales_rep"] without knowing anything about the join.
    linked_order_nos = sorted({r["job_order_no"] for r in rows if r.get("job_order_no")})
    sales_rep_by_order_no: dict[str, str | None] = {}
    if linked_order_nos:
        order_rows = (
            supabase.table("job_orders")
            .select("job_order_no, sales_rep")
            .in_("job_order_no", linked_order_nos)
            .execute()
            .data
            or []
        )
        sales_rep_by_order_no = {o["job_order_no"]: o.get("sales_rep") for o in order_rows}

    for row in rows:
        job_order_no = row.get("job_order_no")
        row["sales_rep"] = sales_rep_by_order_no.get(job_order_no) if job_order_no else row.get("sales_rep")

    # Same equivalence the frontend's own label/filename use — all 7
    # selected reads and files identically to the old "All Categories".
    category_label = (
        "All Categories" if set(payload.categories) == set(REVENUE_CATEGORIES) else ", ".join(payload.categories)
    )
    pdf_buffer = generate_category_report_pdf(rows, category_label, payload.from_date, payload.to_date)

    safe_category = sanitize_customer_name_for_filename(category_label, max_length=30)
    filename = f"CategoryReport_{safe_category}_{payload.from_date}_to_{payload.to_date}.pdf"

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
