"""
Deliberate, one-off live-content verification for the overdue-collection
alert -- goes beyond "did handle_overdue_alert() return sent=True" and
actually fetches back the real email Resend sent (subject, recipients,
rendered HTML) via Resend's GET /emails/:id, so a human doesn't have to
rely solely on a script's boolean signal for the one part of this
feature (an HTML email a real staff member reads) that a script can't
fully judge on its own.

Uses a genuine NEW synthetic test order, not any of the 4 real orders
already backfilled as overdue_alert_sent=true.

Run from backend/: ./venv/Scripts/python.exe scripts/verify_overdue_alert_email_content.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from app.config import RESEND_API_KEY
from app.email import handle_overdue_alert
from app.supabase_client import get_supabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def main() -> None:
    supabase = get_supabase()

    print("=== Seed a genuine NEW synthetic overdue order (not one of the 4 backfilled ones) ===")
    insert_res = (
        supabase.table("job_orders")
        .insert({
            "customer_name": "TEST - DO NOT SHIP (email-content-verify)",
            "status": "Approved",
            "total_amount": 1250.50,
            "deposit_amount": 250,
            "qty_to_print": 3,
            "type_of_print": "OFFSET",
            "department": "PRESS",
            "telephone_number": "0000000000",
            "created_by": "test-harness@local",
            "job_description": "Overdue-alert live email content verification",
            "date_of_collection": "2020-01-01",
        })
        .execute()
    )
    order = insert_res.data[0]
    order_id = order["id"]
    print(f"Inserted id={order_id}, job_order_no={order['job_order_no']}")

    try:
        print("\n=== Trigger the real send path (handle_overdue_alert) ===")
        result = handle_overdue_alert(order_id)
        print("Result:", result)
        assert result["claimed"] is True
        assert result["sent"] is True, "expected a real send given RESEND_API_KEY is live"

        # The message id was only logged (INFO), not returned by
        # handle_overdue_alert's dict -- that return contract is for
        # Command Center's fetch(), which doesn't need it. Ask Resend
        # directly for the most recent email sent to this run's
        # recipients instead of parsing our own log output.
        print("\n=== Ask Resend for the actual sent email content ===")
        list_resp = requests.get(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            timeout=10,
        )
        print("List status:", list_resp.status_code)
        if list_resp.status_code != 200:
            print("Resend has no list endpoint on this plan/version -- body:", list_resp.text[:300])
            print("Falling back: check the recipient inboxes directly for the subject line printed above.")
            return

        emails = list_resp.json().get("data", [])
        job_order_no = order["job_order_no"]
        match = next((e for e in emails if job_order_no in (e.get("subject") or "")), None)
        if not match:
            print("Could not find the sent email in Resend's recent list by subject match.")
            return

        detail_resp = requests.get(
            f"https://api.resend.com/emails/{match['id']}",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            timeout=10,
        )
        detail = detail_resp.json()
        print("\n--- ACTUAL SENT EMAIL ---")
        print("Subject:", detail.get("subject"))
        print("To:", detail.get("to"))
        print("From:", detail.get("from"))
        print("Last event:", detail.get("last_event"))
        html = detail.get("html", "")
        print(f"\nHTML length: {len(html)} chars")
        print("\n--- HTML BODY ---")
        print(html)
    finally:
        print(f"\n=== Cleanup: deleting test row id={order_id} ===")
        supabase.table("job_orders").delete().eq("id", order_id).execute()
        remaining = (
            supabase.table("job_orders")
            .select("id")
            .ilike("customer_name", "%email-content-verify%")
            .execute()
        )
        print("Remaining test rows after cleanup:", remaining.data)


if __name__ == "__main__":
    main()
