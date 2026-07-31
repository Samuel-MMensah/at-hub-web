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
    _email_shell,
    _job_detail_rows,
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
    # Populates every optional _job_detail_rows field a PRESS order can
    # have (material_source, paper_type+gsm, binding_type,
    # laminating_type, delivery_mode, date_of_collection) -- a test-
    # coverage audit found these conditional rows had NEVER been
    # exercised with a real value in any prior test run, same class of
    # gap as the LPO-link bug (never caught because the field was never
    # populated). Individual tests can still override/omit via kwargs.
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
        "material_source": "Company Stock",
        "paper_type": "Art Card",
        "gsm": 300,
        "binding_type": "Perfect Binding",
        "laminating_type": "Gloss Laminating",
        "delivery_mode": "Client Pickup",
        "date_of_collection": "2026-08-15",
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
                        job_description="Batch item 1 - business cards",
                        lpo_file_url="https://example-test.internal/lpo/test-po-12345.pdf")
        item2 = insert(supabase, total_amount=175, sales_rep="Mabel Ampofo",
                        job_description="Batch item 2 - flyers",
                        parent_group_id=item1["parent_group_id"] or "PG-VERIFY-TEST")
        ids = [item1["id"], item2["id"]]
        print(f"Seeded batch: id={item1['id']} (total=250, lpo_file_url set) + "
              f"id={item2['id']} (total=175), sales_rep=Mabel Ampofo")

        result = handle_order_submitted(ids)
        print("Result:", result)
        assert result.get("sent") is True, f"expected sent=True, got {result}"
        print("PASS -- sent=True. Expect total_amount=425 (250+175, summed) in the email, "
              "recipients = _approval_recipients() + mabel.ampofo@appointedtime.com.gh (sales rep CC).")

        # LPO row was previously never tested with lpo_file_url actually
        # populated (that's exactly how the earlier <a>-tag escaping bug
        # shipped unnoticed). Reconstruct deterministically to confirm
        # the fix: plain URL text, safely escaped, not broken markup.
        html_out = _email_shell(
            accent_bg="#0f172a", heading="x", subheading="x", intro="x",
            rows=[("LPO:", item1["lpo_file_url"], None)], footer="x",
        )
        assert "https://example-test.internal/lpo/test-po-12345.pdf" in html_out
        assert "<a href" not in html_out
        print("PASS -- LPO row renders as plain, safely-escaped URL text, no broken/escaped markup.")

        results["1_order_submitted"] = {"ok": True, "detail": result}
    except Exception as e:
        print("FAIL:", e)
        results["1_order_submitted"] = {"ok": False, "detail": str(e)}
    finally:
        cleanup(supabase, ids)
        print(f"Cleaned up {len(ids)} test row(s).")


def test_order_approved(supabase):
    print("\n" + "=" * 70)
    print("TEST 2-4/6: notify_order_approved + notify_needs_scheduling + "
          "send_departmental_alert (approveOrder)")
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
        # departmental_alert_sent is expected False here, not a failure --
        # DEPT_EMAILS_PRESS isn't set in this local .env (by design, no
        # fallback). See scripts/verify_departmental_alert.py for the
        # real send-path test with it temporarily configured.
        print(f"departmental_alert_sent={result.get('departmental_alert_sent')} "
              "(expected False here -- DEPT_EMAILS_PRESS unset locally by design, "
              "not a failure; see verify_departmental_alert.py for the real send test).")
        assert result.get("departmental_alert_sent") is False
        print("PASS -- both configured attempts succeeded independently. "
              "notify_order_approved -> delivered@resend.dev (fake) + Finance/Warehouse CC + "
              "d.sarpong@appointedtime.com.gh (sales rep). "
              "notify_needs_scheduling -> s.mensah@appointedtime.com.gh (scheduler).")

        # Full _job_detail_rows content check -- material_source, Paper
        # (compound paper_type+gsm row), binding_type, laminating_type,
        # delivery_mode, date_of_collection were NEVER exercised with
        # real values before this audit. Confirm every one renders.
        rows = _job_detail_rows(order)
        row_labels = {label for label, _ in rows}
        print("_job_detail_rows labels produced:", sorted(row_labels))
        expected_labels = {
            "Job Description", "Quantity", "Print Category", "Material Source",
            "Paper", "Binding", "Laminating", "Delivery Mode", "Collection Date",
        }
        missing = expected_labels - row_labels
        assert not missing, f"expected labels missing from _job_detail_rows output: {missing}"
        paper_row = dict(rows)["Paper"]
        print("Paper row value:", repr(paper_row))
        assert paper_row == "Art Card (300gsm)", f"unexpected Paper row rendering: {paper_row!r}"
        print("PASS -- every PRESS-branch conditional row rendered, including the compound "
              "Paper row (paper_type + gsm combined correctly).")

        results["2_3_4_order_approved"] = {"ok": True, "detail": result}
    except Exception as e:
        print("FAIL:", e)
        results["2_3_4_order_approved"] = {"ok": False, "detail": str(e)}
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
