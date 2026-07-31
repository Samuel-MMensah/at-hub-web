"""
Live verification for six of the seven deferred notify_* functions
(send_departmental_alert is excluded -- messaging.py isn't present in
this repo, see MIGRATION_STATUS.md). Each test seeds its own synthetic
"TEST - DO NOT SHIP" order(s), calls the ACTUAL handler function the
real endpoint calls (no HTTP layer, no auth token needed -- same
"verify the real logic" approach as every other standalone script in
this project), and cleans up after itself in a finally block regardless
of pass/fail.

RESEND_API_KEY is live and send-only (confirmed in an earlier task --
no dashboard/list API access from this key), so every "sent: True"
below is a REAL email to REAL configured recipients. Message ids are
logged (INFO) for cross-checking against Resend's dashboard directly,
since this script can't query delivery status itself.

Run from backend/: ./venv/Scripts/python.exe scripts/verify_deferred_notifications.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.email import (
    handle_order_approved,
    handle_order_rejected,
    handle_order_submitted,
    handle_ready_for_finance,
    handle_sent_to_warehouse,
)
from app.supabase_client import get_supabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

results: dict[str, dict] = {}


def insert(supabase, **fields):
    base = {
        "customer_name": "TEST - DO NOT SHIP (deferred-notif-verify)",
        "status": "Pending Approval",
        "total_amount": 100,
        "deposit_amount": 0,
        "qty_to_print": 1,
        "type_of_print": "OFFSET",
        "department": "PRESS",
        "telephone_number": "0000000000",
        "created_by": "delivered@resend.dev",
        "job_description": "Deferred notification verification",
    }
    base.update(fields)
    res = supabase.table("job_orders").insert(base).execute()
    return res.data[0]


def cleanup(supabase, ids: list[int]):
    for id_ in ids:
        supabase.table("job_orders").delete().eq("id", id_).execute()


def test_order_submitted(supabase):
    print("\n" + "=" * 70)
    print("TEST 1/6: notify_new_order_submitted (Raise Job Order batch submit)")
    print("=" * 70)
    ids = []
    try:
        item1 = insert(supabase, total_amount=250, sales_rep="Mabel Ampofo",
                        job_description="Batch item 1 - business cards")
        item2 = insert(supabase, total_amount=175, sales_rep="Mabel Ampofo",
                        job_description="Batch item 2 - flyers",
                        parent_group_id=item1["parent_group_id"] or "PG-VERIFY-TEST")
        ids = [item1["id"], item2["id"]]
        print(f"Seeded batch: id={item1['id']} (total=250) + id={item2['id']} (total=175), sales_rep=Mabel Ampofo")

        result = handle_order_submitted(ids)
        print("Result:", result)
        assert result.get("sent") is True, f"expected sent=True, got {result}"
        print("PASS -- sent=True. Expect total_amount=425 (250+175, summed) in the email, "
              "recipients = _approval_recipients() + mabel.ampofo@appointedtime.com.gh (sales rep CC).")
        results["1_order_submitted"] = {"ok": True, "detail": result}
    except Exception as e:
        print("FAIL:", e)
        results["1_order_submitted"] = {"ok": False, "detail": str(e)}
    finally:
        cleanup(supabase, ids)
        print(f"Cleaned up {len(ids)} test row(s).")


def test_order_approved(supabase):
    print("\n" + "=" * 70)
    print("TEST 2-3/6: notify_order_approved + notify_needs_scheduling (approveOrder)")
    print("=" * 70)
    ids = []
    try:
        order = insert(
            supabase, total_amount=500, sales_rep="Daphne Sarpong",
            created_by="delivered@resend.dev", approved_by="Test Approver",
            approval_date="2026-07-31 10:00:00 UTC",
        )
        ids = [order["id"]]
        print(f"Seeded order id={order['id']}, created_by=delivered@resend.dev, sales_rep=Daphne Sarpong")
        print("NOTE: created_by is a fake address (delivered@resend.dev) -- notify_order_approved's "
              "own '@' guard will let it PASS (it has an @), but the actual creator-facing send goes "
              "to a fake, unreachable address. This deliberately tests the CC list (Finance/Warehouse "
              "+ sales rep), not real delivery to the 'creator'.")

        result = handle_order_approved(order["id"])
        print("Result:", result)
        assert result.get("order_approved_sent") is True, f"expected order_approved_sent=True, got {result}"
        assert result.get("needs_scheduling_sent") is True, f"expected needs_scheduling_sent=True, got {result}"
        assert result.get("departmental_alert") == "not_implemented"
        print("PASS -- both independent attempts succeeded. "
              "notify_order_approved -> delivered@resend.dev (fake) + Finance/Warehouse CC + "
              "d.sarpong@appointedtime.com.gh (sales rep). "
              "notify_needs_scheduling -> s.mensah@appointedtime.com.gh (scheduler).")
        results["2_3_order_approved"] = {"ok": True, "detail": result}
    except Exception as e:
        print("FAIL:", e)
        results["2_3_order_approved"] = {"ok": False, "detail": str(e)}
    finally:
        cleanup(supabase, ids)
        print(f"Cleaned up {len(ids)} test row(s).")


def test_order_rejected(supabase):
    print("\n" + "=" * 70)
    print("TEST 5/6: notify_order_rejected (rejectOrder)")
    print("=" * 70)
    ids = []
    try:
        order = insert(
            supabase, created_by="delivered@resend.dev",
            rejection_note="TEST rejection note — please ignore.",
        )
        ids = [order["id"]]
        print(f"Seeded order id={order['id']}")

        result = handle_order_rejected(order["id"])
        print("Result:", result)
        assert result.get("sent") is True, f"expected sent=True, got {result}"
        print("PASS -- sent=True, to delivered@resend.dev (fake creator address; real usage always "
              "has a real created_by).")
        results["5_order_rejected"] = {"ok": True, "detail": result}
    except Exception as e:
        print("FAIL:", e)
        results["5_order_rejected"] = {"ok": False, "detail": str(e)}
    finally:
        cleanup(supabase, ids)
        print(f"Cleaned up {len(ids)} test row(s).")


def test_sent_to_warehouse(supabase):
    print("\n" + "=" * 70)
    print("TEST 6/6: notify_sent_to_warehouse (Production Board sendToWarehouse)")
    print("=" * 70)
    ids = []
    try:
        order = insert(supabase, status="At Warehouse", job_description="Warehouse test item", qty_to_print=42)
        ids = [order["id"]]
        print(f"Seeded order id={order['id']}")

        result = handle_sent_to_warehouse(order["id"])
        print("Result:", result)
        assert result.get("sent") is True, f"expected sent=True, got {result}"
        print("PASS -- sent=True, to appointedtime.supplychain@gmail.com (warehouse fallback).")
        results["6_sent_to_warehouse"] = {"ok": True, "detail": result}
    except Exception as e:
        print("FAIL:", e)
        results["6_sent_to_warehouse"] = {"ok": False, "detail": str(e)}
    finally:
        cleanup(supabase, ids)
        print(f"Cleaned up {len(ids)} test row(s).")


def test_ready_for_finance(supabase):
    print("\n" + "=" * 70)
    print("TEST 7/6 (labeled 7 to match source numbering): notify_ready_for_finance "
          "(Warehouse notifyReadyForFinance)")
    print("=" * 70)
    ids = []
    try:
        order = insert(
            supabase, status="At Warehouse", total_amount=1000, deposit_amount=400,
            job_description="Finance test item",
        )
        ids = [order["id"]]
        print(f"Seeded order id={order['id']}, total=1000, deposit=400 (expect Balance Due=600)")

        result = handle_ready_for_finance(order["id"])
        print("Result:", result)
        assert result.get("sent") is True, f"expected sent=True, got {result}"
        print("PASS -- sent=True, to celestina.foli@appointedtime.com.gh (finance fallback). "
              "This handler is EMAIL-ONLY -- the warehouse_notified_finance DB write is tested "
              "separately below via the actual Server Action logic (atomic guard).")
        results["7_ready_for_finance"] = {"ok": True, "detail": result}

        # Separately verify the atomic-guard UPDATE pattern that
        # warehouse/actions.ts's notifyReadyForFinance uses (the DB
        # write itself, not the email) -- same claim-then-act shape as
        # the overdue alert.
        print("\n--- Sub-test: atomic warehouse_notified_finance guard ---")
        claim1 = (
            supabase.table("job_orders")
            .update({"warehouse_notified_finance": True})
            .eq("id", order["id"])
            .eq("status", "At Warehouse")
            .eq("warehouse_notified_finance", False)
            .execute()
        )
        print("First claim (should affect 1 row):", len(claim1.data))
        assert len(claim1.data) == 1

        claim2 = (
            supabase.table("job_orders")
            .update({"warehouse_notified_finance": True})
            .eq("id", order["id"])
            .eq("status", "At Warehouse")
            .eq("warehouse_notified_finance", False)
            .execute()
        )
        print("Second claim / simulated re-click (should affect 0 rows):", len(claim2.data))
        assert len(claim2.data) == 0
        print("PASS -- flag flips exactly once; a second attempt correctly finds it already set "
              "and would not re-trigger the email (this is why the Server Action only calls the "
              "backend when the UPDATE actually affects a row).")
    except Exception as e:
        print("FAIL:", e)
        results.setdefault("7_ready_for_finance", {"ok": False, "detail": str(e)})
    finally:
        cleanup(supabase, ids)
        print(f"Cleaned up {len(ids)} test row(s).")


def main():
    supabase = get_supabase()
    test_order_submitted(supabase)
    test_order_approved(supabase)
    test_order_rejected(supabase)
    test_sent_to_warehouse(supabase)
    test_ready_for_finance(supabase)

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    for name, r in results.items():
        print(f"{'PASS' if r['ok'] else 'FAIL'}: {name}")

    # Final sweep -- confirm nothing was left behind regardless of any
    # individual test's outcome above.
    remaining = (
        supabase.table("job_orders")
        .select("id, customer_name")
        .ilike("customer_name", "%deferred-notif-verify%")
        .execute()
    )
    print(f"\nRemaining test rows after all tests: {remaining.data}")
    if remaining.data:
        raise SystemExit("CLEANUP FAILURE -- test rows remain, see above")


if __name__ == "__main__":
    main()
