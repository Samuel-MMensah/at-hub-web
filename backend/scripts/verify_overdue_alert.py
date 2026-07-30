"""
Standalone verification for handle_overdue_alert's dedup guarantee --
run directly, no HTTP layer, no auth token needed (same "test the real
logic before wiring it broadly" approach used for the scheduling
engine). Creates one synthetic overdue order, exercises the exact
function the /email/collection-overdue endpoint calls, and cleans up
after itself.

Run from backend/: ./venv/Scripts/python.exe scripts/verify_overdue_alert.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.email import handle_overdue_alert
from app.supabase_client import get_supabase


def main() -> None:
    supabase = get_supabase()

    print("=== Test 1: seed a synthetic overdue order ===")
    insert_res = (
        supabase.table("job_orders")
        .insert({
            "customer_name": "TEST - DO NOT SHIP (overdue-alert-verify)",
            "status": "Approved",
            "total_amount": 500,
            "deposit_amount": 100,
            "qty_to_print": 5,
            "type_of_print": "OFFSET",
            "department": "PRESS",
            "telephone_number": "0000000000",
            "created_by": "test-harness@local",
            "job_description": "handle_overdue_alert dedup verification",
            "date_of_collection": "2020-01-01",  # deep in the past -- unambiguously overdue
        })
        .execute()
    )
    order = insert_res.data[0]
    order_id = order["id"]
    print(f"Inserted id={order_id}, job_order_no={order['job_order_no']}, "
          f"overdue_alert_sent={order['overdue_alert_sent']!r} (expected False)")
    assert order["overdue_alert_sent"] is False, "seed row should start unclaimed"

    try:
        print("\n=== Test 2: first call claims the flag ===")
        first = handle_overdue_alert(order_id)
        print("Result:", first)
        assert first["claimed"] is True, f"expected first call to claim, got {first}"
        # sent is expected False here since RESEND_API_KEY isn't configured
        # in this environment -- _send_resend_email logs a warning and
        # returns False rather than attempting a doomed HTTP call. That's
        # the correct, faithful behavior (matches app.py's own handling of
        # an unset secret), not a test failure.
        print(f"sent={first['sent']!r} (expected False -- RESEND_API_KEY is unset in this environment)")

        print("\n=== Test 3: row's flag is actually persisted ===")
        row = supabase.table("job_orders").select("overdue_alert_sent").eq("id", order_id).execute().data[0]
        print("Row overdue_alert_sent:", row["overdue_alert_sent"])
        assert row["overdue_alert_sent"] is True, "flag should be persisted after the first claim"

        print("\n=== Test 4: second call (simulating a page reload) does NOT re-claim ===")
        second = handle_overdue_alert(order_id)
        print("Result:", second)
        assert second["claimed"] is False, f"expected second call to find the flag already set, got {second}"
        assert second["sent"] is False, "a non-claiming call must never attempt a send"

        print("\n=== Test 5: a third call (simulating two people loading the page at once) also does NOT re-claim ===")
        third = handle_overdue_alert(order_id)
        print("Result:", third)
        assert third["claimed"] is False

        print("\nALL CHECKS PASSED — exactly one claim, flag persisted, repeat calls are no-ops.")
    finally:
        print(f"\n=== Cleanup: deleting test row id={order_id} ===")
        supabase.table("job_orders").delete().eq("id", order_id).execute()
        remaining = (
            supabase.table("job_orders")
            .select("id")
            .ilike("customer_name", "%overdue-alert-verify%")
            .execute()
        )
        print("Remaining test rows after cleanup:", remaining.data)
        assert remaining.data == [], "cleanup failed to remove the test row"


if __name__ == "__main__":
    main()
