"""
Outbound notification emails. Ports app.py's shared HTML letterhead
(_email_shell, line 293), _collection_alert_recipients (line 352), and
notify_collection_due (line 588) -- scoped to the OVERDUE case only
(days_remaining < 0). The source function's "due in N days" branch and
the sibling notify_warehouse_aging alert are intentionally not ported
here -- not requested, see MIGRATION_STATUS.md.

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

from app.config import NOTIFY_EMAIL_1, NOTIFY_EMAIL_2, RESEND_API_KEY, RESEND_SENDER_EMAIL
from app.supabase_client import get_supabase

logger = logging.getLogger(__name__)

CURRENCY = "GH₵"


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
    """One shared HTML letterhead -- ported from app.py's _email_shell,
    with ONE deliberate deviation from the source: every interpolated
    text value is run through html.escape() before it goes into the
    f-string. The original builds this HTML with raw, unescaped
    f-string interpolation of DB-sourced fields (customer_name,
    job_order_no, etc.) -- a customer name containing "&", "<", or ">"
    would either break the table's markup or inject raw HTML into an
    email a real staff member opens. Caught during live verification of
    the overdue-collection alert (see MIGRATION_STATUS.md) and fixed
    here rather than carried forward, since every current and future
    notify_* port funnels its content through this one shared shell.
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
        <h2 style="margin:0;font-size:19px;letter-spacing:0.03em;">{html.escape(str(heading))}</h2>
        <p style="margin:4px 0 0 0;color:#cbd5e1;font-size:13px;">{html.escape(str(subheading))}</p>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <p style="font-size:15px;">{html.escape(str(intro))}</p>
        <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;">
          {row_html}
        </table>
        <p style="font-size:13px;color:#64748b;text-align:center;">{html.escape(str(footer))}</p>
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
