"""
Outbound notification emails. Ports app.py's shared HTML letterhead
(_email_shell, line 293), _collection_alert_recipients (line 352), and
notify_collection_due (line 588) -- scoped to the OVERDUE case only
(days_remaining < 0). The source function's "due in N days" branch and
the sibling notify_warehouse_aging alert are intentionally not ported
here -- not requested, see MIGRATION_STATUS.md.

Also ports all seven deferred notify_* functions (send_resend_notification
as notify_new_order_submitted, notify_order_approved, notify_order_rejected,
notify_needs_scheduling, notify_sent_to_warehouse, notify_ready_for_finance,
and messaging.py's send_departmental_alert) -- see MIGRATION_STATUS.md for
the individual live-test results.

Unlike app.py's _send_resend_email, this doesn't need the
background-thread dodge -- that existed only to keep Streamlit's UI
thread responsive while st.secrets was read on the main thread first.
A FastAPI request handler has no such constraint: this sends
synchronously and the caller gets a real success/failure result back
instead of firing into a daemon thread and losing visibility.
"""
from __future__ import annotations

import html
import logging

import requests

from app.config import (
    APP_URL,
    APPROVAL_CC_EMAILS,
    APPROVAL_NOTIFY_EMAILS,
    DEPT_EMAILS_GARMENT,
    DEPT_EMAILS_PRESS,
    FINANCE_NOTIFY_EMAILS,
    NOTIFY_EMAIL_1,
    NOTIFY_EMAIL_2,
    RESEND_API_KEY,
    RESEND_SENDER_EMAIL,
    SCHEDULER_NOTIFY_EMAILS,
    WAREHOUSE_NOTIFY_EMAILS,
)
from app.supabase_client import get_supabase

logger = logging.getLogger(__name__)

CURRENCY = "GH₵"

# Ports app.py's SALES_REP_EMAILS (line 126) verbatim, PLUS "Elizabeth
# Addo Obeng": the frontend's SALES_REP_NAMES dropdown
# (raise-order-client.tsx) already added her as a real, selectable rep
# in an earlier task; her email was never stored anywhere at the time
# because nothing backend-side needed the lookup yet. Now that the CC
# logic here actually resolves a name to an address, leaving her out
# would silently drop the CC for any order she's tagged as rep on.
SALES_REP_EMAILS: dict[str, str] = {
    "Mabel Ampofo": "mabel.ampofo@appointedtime.com.gh",
    "Daphne Sarpong": "d.sarpong@appointedtime.com.gh",
    "Reginald Aidam": "reginald.aidam@appointedtime.com.gh",
    "Charles Adoo": "charles.adoo@appointedtime.com.gh",
    "Isaac Kum": "isaac.kum@appointedtime.com.gh",
    "Bertha Tackie": "bertha.tackie@appointedtime.com.gh",
    "Christian Mante": "christian.mante@appointedtime.com.gh",
    "Jacqueline Afful": "jacqueline.afful@appointedtime.com.gh",
    "Mohammed Seidu Bunyamin": "m.seidu@appointedtime.com.gh",
    "Elizabeth Addo Obeng": "ea.obeng@appointedtime.com.gh",
}


def _job_detail_rows(order_data: dict) -> list[tuple[str, str]]:
    """Ports app.py's _job_detail_rows (line 230) verbatim. Builds the
    job-spec rows (description, quantity, materials, delivery) shared
    across notification emails. Press and Garment orders store
    materials under different field names, so this branches on
    department. Only includes a row when the value is actually
    present."""
    d = order_data
    dept = str(d.get("department") or "").strip().upper()
    rows: list[tuple[str, str]] = []

    desc = d.get("job_description") or d.get("item_description")
    if desc:
        rows.append(("Job Description", str(desc)))

    qty = d.get("qty_to_print") or d.get("print_qty")
    if qty:
        rows.append(("Quantity", str(qty)))

    if dept == "GARMENT":
        ptype = d.get("print_type") or d.get("type_of_print")
        if ptype:
            rows.append(("Print Type", str(ptype)))
        matsrc = d.get("material_source")
        if matsrc:
            rows.append(("Material Source", str(matsrc)))
        matdesc = d.get("material_description")
        if matdesc:
            rows.append(("Material", str(matdesc)))
        pkg = d.get("packaging_mode")
        if pkg:
            rows.append(("Packaging", str(pkg)))
    else:
        ptype = d.get("type_of_print")
        if ptype:
            rows.append(("Print Category", str(ptype)))
        matsrc = d.get("material_source")
        if matsrc:
            rows.append(("Material Source", str(matsrc)))
        paper, gsm = d.get("paper_type"), d.get("gsm")
        if paper or gsm:
            rows.append(("Paper", f"{paper or '—'}{f' ({gsm}gsm)' if gsm else ''}"))
        binding = d.get("binding_type")
        if binding and str(binding).strip().lower() != "none":
            rows.append(("Binding", str(binding)))
        laminating = d.get("laminating_type")
        if laminating and str(laminating).strip().lower() != "none":
            rows.append(("Laminating", str(laminating)))

    delivery = d.get("delivery_mode")
    if delivery:
        rows.append(("Delivery Mode", str(delivery)))
    collection = d.get("date_of_collection")
    if collection:
        rows.append(("Collection Date", str(collection)))

    return rows


def _approval_recipients() -> list[str]:
    """Ports app.py's _approval_recipients. Same ametepe -> ametefe
    spelling correction already applied to _collection_alert_recipients
    (same real person, same real address, same source typo)."""
    raw = APPROVAL_NOTIFY_EMAILS
    emails = [e.strip() for e in raw.split(",") if e.strip()]
    return emails or [
        "jacqueline.afful@appointedtime.com.gh",
        "emmanuel.ametefe@appointedtime.com.gh",
        "enoch.obeng@appointedtime.com.gh",
    ]


def _approval_cc_recipients() -> list[str]:
    """Ports app.py's _approval_cc_recipients — Finance and Warehouse CC'd
    on every approval."""
    raw = APPROVAL_CC_EMAILS
    emails = [e.strip() for e in raw.split(",") if e.strip()]
    return emails or ["celestina.foli@appointedtime.com.gh", "appointedtime.supplychain@gmail.com"]


def _scheduler_recipients() -> list[str]:
    """Ports app.py's _scheduler_recipients — a distinct role from
    MD/FM approval, separate env var so it can be reassigned
    independently."""
    raw = SCHEDULER_NOTIFY_EMAILS
    emails = [e.strip() for e in raw.split(",") if e.strip()]
    return emails or ["s.mensah@appointedtime.com.gh"]


def _warehouse_recipients() -> list[str]:
    """Ports app.py's _warehouse_recipients."""
    return [e.strip() for e in WAREHOUSE_NOTIFY_EMAILS.split(",") if e.strip()] or [
        "appointedtime.supplychain@gmail.com"
    ]


def _finance_recipients() -> list[str]:
    """Ports app.py's _finance_recipients."""
    return [e.strip() for e in FINANCE_NOTIFY_EMAILS.split(",") if e.strip()] or [
        "celestina.foli@appointedtime.com.gh"
    ]


def _department_recipients(department: str) -> list[str]:
    """Ports messaging.py's _department_recipients. Deliberately
    DIFFERENT from every other recipient helper in this file: no
    hardcoded fallback address. messaging.py's own dynamic
    f"DEPT_EMAILS_{department.upper()}" env var lookup is replaced
    with explicit branching over the two real departments this app has
    (PRESS/GARMENT, see is-garment.ts) to match this file's
    named-constant config convention -- functionally identical to the
    dynamic lookup for both real departments, and for any other
    department string (returns empty, same as source's lookup of a
    nonexistent env var name would)."""
    dept = department.strip().upper()
    if dept == "PRESS":
        raw = DEPT_EMAILS_PRESS
    elif dept == "GARMENT":
        raw = DEPT_EMAILS_GARMENT
    else:
        raw = ""
    return [e.strip() for e in raw.split(",") if e.strip()]


def _collection_alert_recipients() -> list[str]:
    """Same convention as app.py's _collection_alert_recipients: each of
    the two NOTIFY_EMAIL_* env vars may itself be a comma-separated list.
    Falls back to MD/FM's real addresses if both are unset, so a dropped
    env var still lands somewhere real instead of a dead inbox.

    Deliberate deviation from app.py's hardcoded fallback here: the
    source spells the second address "emmanuel.ametepe@..." and omits
    enoch.obeng@... (app.py's sibling _approval_recipients() already
    includes him, this one didn't). Corrected per explicit instruction
    after a live test surfaced the wrong address."""
    raw = ",".join(filter(None, [NOTIFY_EMAIL_1, NOTIFY_EMAIL_2]))
    emails = [e.strip() for e in raw.split(",") if e.strip()]
    return emails or [
        "jacqueline.afful@appointedtime.com.gh",
        "emmanuel.ametefe@appointedtime.com.gh",
        "enoch.obeng@appointedtime.com.gh",
    ]


def _email_shell(accent_bg, heading, subheading, intro, rows, footer, accent_fg="#ffffff") -> str:
    """
    !!! WARNING -- READ BEFORE ADDING A NEW notify_* FUNCTION !!!
    heading/subheading/intro/footer are NOT auto-escaped. Only `rows`
    is auto-escaped. If you interpolate a DB value or any
    user-provided string directly into heading/subheading/intro/footer,
    YOU must wrap it in html.escape() yourself before passing it in.
    Getting this wrong reintroduces the exact HTML-injection bug fixed
    for the overdue-collection alert (see MIGRATION_STATUS.md's
    "Backend service -- overdue collection alert" section) -- a
    customer name or other DB field containing "&", "<", or ">" would
    inject raw markup into an email a real staff member opens. Prefer
    putting the value in a `rows` entry instead whenever possible --
    that's the one path that's safe by default.
    !!! END WARNING !!!

    One shared HTML letterhead -- ported from app.py's _email_shell,
    with ONE deliberate deviation from the source, refined while porting
    the seven deferred notifications:

    SECURITY MODEL -- `rows` (label/value pairs) are ALWAYS raw
    DB-sourced data (customer names, order numbers, rejection notes,
    etc.) with no caller ever needing literal markup inside a value --
    these are unconditionally run through html.escape() here, no
    exceptions. A customer name containing "&", "<", or ">" would
    otherwise either break the table's markup or inject raw HTML into
    an email a real staff member opens (caught live during the
    overdue-collection alert's verification).

    heading/subheading/intro/footer are handled differently on
    purpose: several notify_* callers deliberately embed literal inline
    HTML in these (e.g. "<strong>approved</strong>" for emphasis) --
    that's intentional markup authored by the function, not user data,
    so these four are passed through AS-IS, not auto-escaped. An
    earlier version of this fix blanket-escaped all four, which would
    have turned every such <strong> into visible "&lt;strong&gt;" text
    -- caught before it shipped, while porting notify_order_approved.
    Any caller that interpolates a DB-sourced value directly into one
    of these four (not through `rows`) is responsible for calling
    html.escape() on that value itself before interpolating.

    `rows` is a list of (label, value, value_color_or_None)."""
    row_html = "".join(
        f'<tr style="background:{"#f8fafc" if i % 2 == 0 else "#ffffff"};">'
        f'<td style="padding:9px 10px;font-weight:600;color:#64748b;'
        f'border-bottom:1px solid #e2e8f0;">{html.escape(str(label))}</td>'
        f'<td style="padding:9px 10px;font-weight:700;border-bottom:1px solid #e2e8f0;'
        f'color:{color or "#0f172a"};">{html.escape(str(value))}</td></tr>'
        for i, (label, value, color) in enumerate(rows)
    )
    return f"""<div style="font-family:'Segoe UI',Tahoma,sans-serif;color:#0f172a;max-width:600px;
        margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:{accent_bg};color:{accent_fg};padding:24px;text-align:center;">
        <h2 style="margin:0;font-size:19px;letter-spacing:0.03em;">{heading}</h2>
        <p style="margin:4px 0 0 0;color:#cbd5e1;font-size:13px;">{subheading}</p>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <p style="font-size:15px;">{intro}</p>
        <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;">
          {row_html}
        </table>
        <p style="font-size:13px;color:#64748b;text-align:center;">{footer}</p>
      </div>
    </div>"""


def _send_resend_email(recipients: list[str], subject: str, html_body: str, log_context: str) -> bool:
    """Returns True only if Resend actually accepted the email. A missing
    RESEND_API_KEY or empty recipient list is logged and treated as a
    no-op, not an error -- matches app.py's behavior exactly (an unset
    secret means "not configured yet", not "broken")."""
    if not RESEND_API_KEY or not recipients:
        logger.warning(
            "Resend email skipped (%s): api_key set=%s, recipients=%r",
            log_context, bool(RESEND_API_KEY), recipients,
        )
        return False
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": f"Appointed Time Hub <{RESEND_SENDER_EMAIL}>",
                "to": recipients,
                "subject": subject,
                "html": html_body,
            },
            timeout=10,
        )
        if resp.status_code >= 400:
            logger.error(
                "Resend rejected email (%s): status=%s body=%s subject=%r",
                log_context, resp.status_code, resp.text[:500], subject,
            )
            return False
        logger.info(
            "Resend accepted email (%s): id=%s to=%r subject=%r",
            log_context, resp.json().get("id"), recipients, subject,
        )
        return True
    except Exception:
        logger.exception("Resend email failed (%s): subject=%r", log_context, subject)
        return False


def notify_collection_overdue(ticket: dict) -> bool:
    """Ports app.py's notify_collection_due, scoped to the OVERDUE branch
    only. Returns whether Resend actually accepted the send -- the
    caller is responsible for the dedup flag (job_orders.overdue_alert_sent),
    which must be claimed BEFORE calling this, not based on this return
    value: a Resend outage shouldn't cause the same alert to be retried
    forever once the order has genuinely been flagged as handled."""
    balance = max(0.0, float(ticket.get("total_amount") or 0) - float(ticket.get("deposit_amount") or 0))
    accent = "#b91c1c"
    html = _email_shell(
        accent_bg=accent,
        heading="📦 COLLECTION ALERT — OVERDUE",
        subheading="",
        intro="",
        rows=[
            ("Order No", str(ticket.get("job_order_no", "—")), accent),
            ("Customer", str(ticket.get("customer_name", "—")), None),
            ("Collection Date", str(ticket.get("date_of_collection", "—")), accent),
            ("Balance Due", f"{CURRENCY} {balance:,.2f}", None),
        ],
        footer="",
    )
    return _send_resend_email(
        _collection_alert_recipients(),
        subject=f"Collection OVERDUE: {ticket.get('customer_name', '—')} — {ticket.get('job_order_no', '—')}",
        html_body=html,
        log_context="collection-overdue",
    )


def notify_new_order_submitted(payload: dict) -> bool:
    """Ports app.py's send_resend_notification (line 367). Fired once per
    RAISE event (a whole batch, or a single resubmit) -- for a batch,
    the caller passes a synthetic payload shaped like the first
    submitted item but with total_amount already summed across every
    item in the batch (matches the source's own
    `_notif = _submitted[0].copy(); _notif['total_amount'] = sum(...)`
    exactly -- this function itself doesn't know or care whether it's
    looking at one order or an aggregate). CCs the sales rep who
    brought the job, if one was selected and isn't already a recipient
    (case-insensitive)."""
    dept_label = payload.get("department", "PRESS")
    rows: list[tuple[str, str, str | None]] = [
        ("Job Order No:", str(payload.get("job_order_no", "PENDING")), "#0369a1"),
        ("Customer:", str(payload.get("customer_name", "—")), None),
        ("Contract Value:", f"{CURRENCY} {float(payload.get('total_amount', 0) or 0):,.2f}", None),
        ("Sales Rep:", str(payload.get("sales_rep") or "—"), None),
    ]
    for label, value in _job_detail_rows(payload):
        rows.append((f"{label}:", value, None))
    lpo_url = payload.get("lpo_file_url")
    if lpo_url:
        # Plain URL text, NOT an <a> tag -- caught while porting
        # send_departmental_alert's Sample Photo row: _email_shell's
        # `rows` values are ALWAYS html.escape()'d, unconditionally, no
        # opt-out (that's the whole point of the security model an
        # earlier fix established). An embedded <a href="..."> here
        # would itself get escaped into visible "&lt;a href=...&gt;"
        # text, not a clickable link -- this shipped broken in an
        # earlier task and was never caught because that test run
        # didn't happen to include an lpo_file_url. A plain URL string
        # is safe by construction (auto-escaped like any other row
        # value) and most email clients auto-linkify a bare URL anyway.
        rows.append(("LPO:", str(lpo_url), None))

    shell_html = _email_shell(
        accent_bg="#0f172a",
        heading="EXECUTIVE APPROVAL REQUIRED",
        subheading=f"Appointed Time Printing Enterprise Hub — {html.escape(str(dept_label))} DEPT",
        intro="A new order requires authorization sign-off.",
        rows=rows,
        footer="Access Authorization Center to proceed.",
    )

    recipients = list(_approval_recipients())
    rep_name = payload.get("sales_rep")
    rep_email = SALES_REP_EMAILS.get(rep_name) if rep_name else None
    if rep_email and rep_email.lower() not in [r.lower() for r in recipients]:
        recipients.append(rep_email)

    return _send_resend_email(
        recipients,
        subject=f"Executive Action: Order {payload.get('job_order_no', 'PENDING')} Submitted",
        html_body=shell_html,
        log_context="new-order-submitted",
    )


def notify_order_approved(ticket: dict) -> bool:
    """Ports app.py's notify_order_approved (line 411). Emails the order
    creator; Finance and Warehouse are CC'd on every approval (see
    _approval_cc_recipients), and the sales rep (if selected at raise
    time) is CC'd too. A no-op (returns False, no send attempted) if
    created_by isn't a real email -- matches source's own
    `if "@" not in recipient: return` guard."""
    recipient = str(ticket.get("created_by", "") or "")
    if "@" not in recipient:
        return False

    rep_name = ticket.get("sales_rep")
    rep_email = SALES_REP_EMAILS.get(rep_name) if rep_name else None
    rows: list[tuple[str, str, str | None]] = [
        ("Order No", str(ticket.get("job_order_no", "—")), "#0369a1"),
        ("Customer", str(ticket.get("customer_name", "—")), None),
        ("Contract Value", f"{CURRENCY} {float(ticket.get('total_amount', 0) or 0):,.2f}", None),
        ("Sales Rep", str(rep_name or "—"), None),
    ]
    for label, value in _job_detail_rows(ticket):
        rows.append((label, value, None))

    dept = html.escape(str(ticket.get("department", "PRESS")))
    approved_by = html.escape(str(ticket.get("approved_by", "Management")))
    approval_date = html.escape(str(ticket.get("approval_date", "")))
    shell_html = _email_shell(
        accent_bg="#064e3b",
        heading="✅ ORDER APPROVED",
        subheading=f"Appointed Time Printing — {dept} Dept",
        intro="Your order has been <strong>approved</strong> and is now active in the production pipeline.",
        rows=rows,
        footer=f"Approved by: {approved_by} · Date: {approval_date}",
    )

    recipients = [recipient] + [e for e in _approval_cc_recipients() if e.lower() != recipient.lower()]
    if rep_email and rep_email.lower() not in [r.lower() for r in recipients]:
        recipients.append(rep_email)

    return _send_resend_email(
        recipients,
        subject=f"Approved: Order {ticket.get('job_order_no', '—')} is live",
        html_body=shell_html,
        log_context="order-approved",
    )


def notify_order_rejected(ticket: dict) -> bool:
    """Ports app.py's notify_order_rejected (line 439). Emails only the
    order creator -- no CC list, unlike approval. Same created_by
    email guard as notify_order_approved."""
    recipient = str(ticket.get("created_by", "") or "")
    if "@" not in recipient:
        return False

    shell_html = _email_shell(
        accent_bg="#7f1d1d",
        heading="⚠️ ORDER RETURNED FOR REVISION",
        subheading="Action Required",
        intro="Your order has been <strong>returned</strong> by management. "
        "Log in, review the note below, correct, and resubmit.",
        rows=[
            ("Order No", str(ticket.get("job_order_no", "—")), "#b91c1c"),
            ("Customer", str(ticket.get("customer_name", "—")), None),
            ("Management Note", str(ticket.get("rejection_note", "See system for details")), "#b91c1c"),
        ],
        footer="Use Modify & Resubmit in My Order Tracker.",
    )
    return _send_resend_email(
        [recipient],
        subject=f"Action Required: Order {ticket.get('job_order_no', '—')} returned",
        html_body=shell_html,
        log_context="order-rejected",
    )


def notify_needs_scheduling(ticket: dict) -> bool:
    """Ports app.py's notify_needs_scheduling (line 465). Goes to the
    actual scheduler, not the MD/FM approval list -- scheduling and
    approval are different people doing different jobs, even though
    both alerts fire off the same approval event."""
    dept = html.escape(str(ticket.get("department", "PRESS")))
    shell_html = _email_shell(
        accent_bg="#1e3a8a",
        heading="📋 READY TO SCHEDULE",
        subheading=f"Appointed Time Printing — {dept} Dept",
        intro="This order is approved and waiting in Production Layout Builder.",
        rows=[
            ("Order No", str(ticket.get("job_order_no", "—")), "#0369a1"),
            ("Customer", str(ticket.get("customer_name", "—")), None),
            ("Contract Value", f"{CURRENCY} {float(ticket.get('total_amount', 0) or 0):,.2f}", None),
        ],
        footer="Schedule it in Production Layout Builder.",
    )
    return _send_resend_email(
        _scheduler_recipients(),
        subject=f"Ready to Schedule: Order {ticket.get('job_order_no', '—')}",
        html_body=shell_html,
        log_context="needs-scheduling",
    )


def notify_sent_to_warehouse(ticket: dict) -> bool:
    """Ports app.py's notify_sent_to_warehouse (line 488). Only Job
    Description / Quantity from _job_detail_rows -- identity/quantity
    only, no money, matching warehouse.py's design (warehouse staff
    don't need to see contract value)."""
    rows: list[tuple[str, str, str | None]] = [
        ("Order No", str(ticket.get("job_order_no", "—")), "#4338ca"),
        ("Customer", str(ticket.get("customer_name", "—")), None),
    ]
    for label, value in _job_detail_rows(ticket):
        if label in ("Job Description", "Quantity"):
            rows.append((label, value, None))

    shell_html = _email_shell(
        accent_bg="#4f46e5",
        heading="📥 ORDER SENT TO WAREHOUSE",
        subheading="Appointed Time Printing — Warehouse Receiving",
        intro="Production has completed this order and marked it ready for pickup at the warehouse.",
        rows=rows,
        footer="Confirm receipt in the Warehouse module.",
    )
    return _send_resend_email(
        _warehouse_recipients(),
        subject=f"Warehouse: Order {ticket.get('job_order_no', '—')} arrived",
        html_body=shell_html,
        log_context="sent-to-warehouse",
    )


def notify_ready_for_finance(ticket: dict) -> bool:
    """Ports the EMAIL half of app.py's notify_ready_for_finance (line
    514) only. Source combines the send AND the warehouse_notified_finance
    DB flip in one function; this port deliberately splits them --
    every other status-changing write in this app (approveOrder,
    rejectOrder, sendToWarehouse, ...) happens in the Next.js Server
    Action via the session-bound client, never in this backend service,
    which is scoped to PDF/email/scheduling only (see backend/app/
    main.py's module docstring). The DB flip lives in
    warehouse/actions.ts's notifyReadyForFinance instead, and happens
    BEFORE this is even called (and independently of whether this
    send succeeds), per this task's explicit best-effort requirement --
    the outcome (flag set to true on success) matches source, the
    mechanism doesn't."""
    total = float(ticket.get("total_amount", 0) or 0)
    deposit = float(ticket.get("deposit_amount", 0) or 0)
    rows: list[tuple[str, str, str | None]] = [
        ("Order No", str(ticket.get("job_order_no", "—")), "#065f46"),
        ("Customer", str(ticket.get("customer_name", "—")), None),
        ("Contract Value", f"{CURRENCY} {total:,.2f}", None),
        ("Balance Due", f"{CURRENCY} {max(0.0, total - deposit):,.2f}", None),
    ]
    for label, value in _job_detail_rows(ticket):
        if label in ("Job Description", "Quantity"):
            rows.append((label, value, None))

    shell_html = _email_shell(
        accent_bg="#065f46",
        heading="📦 READY FOR DISPATCH",
        subheading="Appointed Time Printing — Finance",
        intro="Warehouse has prepared this order for delivery. Collect any outstanding balance and finalize dispatch.",
        rows=rows,
        footer="Finalize in the Dispatch module.",
    )
    return _send_resend_email(
        _finance_recipients(),
        subject=f"Ready for Dispatch: Order {ticket.get('job_order_no', '—')}",
        html_body=shell_html,
        log_context="ready-for-finance",
    )


def send_departmental_alert(order_data: dict) -> bool:
    """Ports messaging.py's send_departmental_alert. Routes to whoever
    is configured for order_data['department'] via
    _department_recipients -- returns False (and logs why) without
    sending if department is missing/unmapped or nobody's configured
    for it, same "a silent send-to-nobody is worse than a visible
    False" posture as source.

    Reuses THIS module's _email_shell -- NOT a second _alert_shell
    template. messaging.py's own _alert_shell is nearly identical in
    shape (accent_bg/heading/subheading/intro/rows/footer) but
    duplicates the HTML rather than importing it (by messaging.py's own
    design, see its module docstring: it can't import from app.py, so
    it doesn't import anything). Since this port lives in the same
    module as _email_shell, that constraint doesn't apply -- and
    _email_shell now carries a load-bearing escaping contract (see its
    own !!! WARNING !!! docstring) that's only correct to maintain in
    one place. Two real adaptations from _alert_shell's exact template,
    both accepted consequences of reusing the shared shell rather than
    forking it:
      1. _alert_shell's optional "Open Appointed Time Hub" button
         (linking to APP_URL) has no equivalent slot in _email_shell --
         folded into `footer` instead (footer is caller-trusted, not
         auto-escaped, same as every other shell-level text field).
      2. Minor cosmetic differences (_email_shell's heading is 19px vs
         _alert_shell's 18px, etc.) -- not preserved pixel-for-pixel,
         an accepted consequence of "one shell, not two."

    _job_detail_rows here is THIS module's existing one (ported from
    app.py, already used by every other notify_* function above) --
    diffed messaging.py's own copy against it line by line before
    reusing: identical branching, identical field names, only
    superficial differences (quote style, docstring wording). Reusing
    it, not duplicating an identically-behaving second copy."""
    department = str(order_data.get("department", "")).strip()
    if not department:
        logger.warning("send_departmental_alert: order_data has no department; nothing sent.")
        return False
    recipients = _department_recipients(department)
    if not recipients:
        logger.warning(
            "send_departmental_alert: no recipients configured for department=%r "
            "(expected env var DEPT_EMAILS_%s).",
            department, department.strip().upper(),
        )
        return False

    order_no = str(order_data.get("job_order_no", "—"))
    dept_upper = department.strip().upper()
    if dept_upper == "GARMENT":
        intro = (
            "An order assigned to your department has been approved. Garment orders are "
            "not scheduled in Production Layout Builder — <strong>you can begin production "
            "immediately</strong>, no need to wait on the scheduler."
        )
    elif dept_upper == "PRESS":
        intro = (
            "An order assigned to your department has been approved and sent to the "
            "scheduler for machine/stage scheduling. <strong>Wait for the schedule before "
            "starting production</strong> — unless this is a low-quantity job that your team "
            "has agreed doesn't need scheduling, in which case you can begin immediately."
        )
    else:
        intro = "An order assigned to your department requires attention."

    rows: list[tuple[str, str, str | None]] = [
        ("Order No", order_no, None),
        ("Customer", str(order_data.get("customer_name", "—")), None),
        ("Status", str(order_data.get("status", "—")), None),
        ("Contract Value", f"{CURRENCY} {float(order_data.get('total_amount', 0) or 0):,.2f}", None),
    ]
    for label, value in _job_detail_rows(order_data):
        rows.append((label, value, None))
    sample_url = order_data.get("sample_file_url")
    if sample_url:
        # Plain URL text, not an <a> tag -- see notify_new_order_submitted's
        # LPO row comment for why (rows are always auto-escaped, no
        # exceptions; an embedded tag here would render as visible
        # escaped text, not a link).
        rows.append(("Sample Photo", str(sample_url), None))

    footer = "This is an automated notification from the Appointed Time Enterprise Hub."
    if APP_URL:
        footer = (
            f'<a href="{html.escape(APP_URL)}" style="display:inline-block;background:#0f172a;'
            f'color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;'
            f'padding:0.6rem 1.4rem;border-radius:6px;">Open Appointed Time Hub</a>'
            f'<br><br>{footer}'
        )

    shell_html = _email_shell(
        accent_bg="#0f172a",
        heading=f"{department.upper()} DEPARTMENT ALERT",
        subheading="Appointed Time Printing Enterprise Hub",
        intro=intro,
        rows=rows,
        footer=footer,
    )
    return _send_resend_email(
        recipients,
        subject=f"{department.upper()} Alert: Order {order_no}",
        html_body=shell_html,
        log_context=f"departmental-alert-{department.lower()}",
    )


def send_account_welcome(recipient_email: str, recipient_name: str, reset_link: str) -> bool:
    """
    NEW function, not a port -- onboarding email for a freshly created
    Supabase Auth account, carrying a one-time password-recovery link
    (invite-link onboarding, not a shared/typed password).

    SAFETY OF `reset_link`: this is a server-generated one-time token
    URL from `supabase.auth.admin.generate_link(type="recovery", ...)`
    -- never user-typed, never DB-sourced free text -- so it carries
    the same "caller is responsible, trusted input" contract already
    established for _email_shell's heading/subheading/intro/footer
    (see that function's own !!! WARNING !!!). It's still run through
    html.escape() below anyway, matching how send_departmental_alert
    treats APP_URL (also a trusted, non-attacker-controlled value) --
    defensive consistency, not because this value is actually risky.

    No dedicated button/link slot exists on _email_shell to reuse or
    adapt -- checked send_departmental_alert's own "Open Appointed Time
    Hub" button first, and per ITS docstring that isn't a shell
    parameter either: it's built ad hoc by that caller and folded into
    the `footer` argument (_email_shell has no `link_html` slot at
    all). Same pattern reused here rather than adding a new shell
    parameter for what would still be its only caller.

    recipient_name goes into `intro`, which _email_shell does NOT
    auto-escape (unlike `rows`) -- html.escape()'d here per that same
    contract.
    """
    button_html = (
        f'<a href="{html.escape(reset_link)}" style="display:inline-block;background:#0f172a;'
        f'color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;'
        f'padding:0.6rem 1.4rem;border-radius:6px;">Set Your Password</a>'
    )
    footer = f"{button_html}<br><br>This link is one-time use and expires soon — set your password as soon as possible."

    shell_html = _email_shell(
        accent_bg="#0f172a",
        heading="WELCOME TO THE JOB ORDER HUB",
        subheading="Appointed Time Printing Enterprise Hub",
        intro=(
            f"Hi {html.escape(recipient_name)}, you now have access to the Job Order Hub to "
            "track the orders and revenue you bring in — live job performance and revenue "
            "figures tied to your work. Set your password below to get started."
        ),
        rows=[("Account Email", recipient_email, None)],
        footer=footer,
    )
    return _send_resend_email(
        [recipient_email],
        subject="Welcome to the Appointed Time Job Order Hub",
        html_body=shell_html,
        log_context="account-welcome",
    )


def handle_overdue_alert(order_id: int) -> dict:
    """
    Claim-then-send, extracted out of the FastAPI route so it's directly
    callable (no HTTP layer, no auth token) from a standalone test
    script -- same "verify the real logic before wiring it broadly"
    approach already used for the scheduling engine.

    Fires at most once per order, ever: the UPDATE below only matches a
    row for whichever caller gets there first, because it's conditioned
    on the flag still being false. Two callers racing on the same order
    can't both win -- the loser's UPDATE matches zero rows and it
    returns without sending anything.
    """
    supabase = get_supabase()

    claim = (
        supabase.table("job_orders")
        .update({"overdue_alert_sent": True})
        .eq("id", order_id)
        .eq("overdue_alert_sent", False)
        .execute()
    )
    if not claim.data:
        return {"claimed": False, "sent": False}

    res = supabase.table("job_orders").select("*").eq("id", order_id).execute()
    if not res.data:
        return {"claimed": True, "sent": False, "error": f"job_orders row not found for id={order_id}"}

    ticket = res.data[0]
    sent = notify_collection_overdue(ticket)
    return {"claimed": True, "sent": sent}


def handle_order_submitted(order_ids: list[int]) -> dict:
    """Extracted out of the FastAPI route, same "directly callable, no
    HTTP layer" pattern as handle_overdue_alert -- used by both the
    endpoint and the standalone test scripts.

    Takes ids, not a client-supplied payload -- every field re-fetched
    via service-role, matching every other endpoint's "never trust
    caller-supplied data" posture (see /pdf/manifest's docstring). The
    only thing genuinely computed here (not read from a single row) is
    total_amount, which is intentionally the SUM across every id, not
    any one row's own value -- see notify_new_order_submitted's
    docstring for why. order_ids[0]'s row supplies every other field
    (job_order_no, customer_name, sales_rep, department, job spec
    details, ...), matching source's `_submitted[0].copy()`."""
    if not order_ids:
        return {"sent": False, "error": "no order_ids provided"}

    supabase = get_supabase()
    res = supabase.table("job_orders").select("*").in_("id", order_ids).execute()
    if not res.data:
        return {"sent": False, "error": f"no job_orders rows found for ids={order_ids}"}

    rows_by_id = {row["id"]: row for row in res.data}
    first = rows_by_id.get(order_ids[0])
    if first is None:
        return {"sent": False, "error": f"order_ids[0]={order_ids[0]} not found among fetched rows"}

    payload = dict(first)
    payload["total_amount"] = sum(float(row.get("total_amount") or 0) for row in res.data)

    sent = notify_new_order_submitted(payload)
    return {"sent": sent}


def handle_order_approved(order_id: int) -> dict:
    """Fans out to all three approval-triggered notifications as
    INDEPENDENT attempts -- a failure in one must never block the
    others, unlike source's app.py:4888-4890, which fires all three
    inside a single try block where an early exception skips the rest
    silently. Each result is reported separately so a partial failure
    is visible, not swallowed into one boolean."""
    supabase = get_supabase()
    res = supabase.table("job_orders").select("*").eq("id", order_id).execute()
    if not res.data:
        return {"error": f"job_orders row not found for id={order_id}"}

    ticket = res.data[0]

    try:
        approved_sent = notify_order_approved(ticket)
    except Exception:
        logger.exception("notify_order_approved failed for order id=%s.", order_id)
        approved_sent = False

    try:
        scheduling_sent = notify_needs_scheduling(ticket)
    except Exception:
        logger.exception("notify_needs_scheduling failed for order id=%s.", order_id)
        scheduling_sent = False

    try:
        departmental_sent = send_departmental_alert(ticket)
    except Exception:
        logger.exception("send_departmental_alert failed for order id=%s.", order_id)
        departmental_sent = False

    return {
        "order_approved_sent": approved_sent,
        "needs_scheduling_sent": scheduling_sent,
        "departmental_alert_sent": departmental_sent,
    }


def handle_order_rejected(order_id: int) -> dict:
    supabase = get_supabase()
    res = supabase.table("job_orders").select("*").eq("id", order_id).execute()
    if not res.data:
        return {"sent": False, "error": f"job_orders row not found for id={order_id}"}

    sent = notify_order_rejected(res.data[0])
    return {"sent": sent}


def handle_sent_to_warehouse(order_id: int) -> dict:
    supabase = get_supabase()
    res = supabase.table("job_orders").select("*").eq("id", order_id).execute()
    if not res.data:
        return {"sent": False, "error": f"job_orders row not found for id={order_id}"}

    sent = notify_sent_to_warehouse(res.data[0])
    return {"sent": sent}


def handle_ready_for_finance(order_id: int) -> dict:
    """Email only -- the warehouse_notified_finance DB write already
    happened in the Next.js Server Action before this was ever called.
    See notify_ready_for_finance's docstring."""
    supabase = get_supabase()
    res = supabase.table("job_orders").select("*").eq("id", order_id).execute()
    if not res.data:
        return {"sent": False, "error": f"job_orders row not found for id={order_id}"}

    sent = notify_ready_for_finance(res.data[0])
    return {"sent": sent}
