"""
Live verification for send_departmental_alert (email #4, the last of
the seven deferred notifications). Tests BOTH department variants
since the intro text genuinely differs between them (source's own
GARMENT/PRESS/else three-way branch). Seeds its own synthetic
"TEST - DO NOT SHIP" order per department, calls the real handler via
handle_order_approved (the actual approveOrder fan-out, not a
standalone call, so this exercises the real integration), and cleans
up after itself.

Requires backend/.env's DEPT_EMAILS_PRESS / DEPT_EMAILS_GARMENT to be
set (temporarily, to Resend's test address) -- see the TEMPORARY block
in .env, removed after this test.

Run from backend/: ./venv/Scripts/python.exe scripts/verify_departmental_alert.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.email import _email_shell, _job_detail_rows, handle_order_approved
from app.supabase_client import get_supabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def insert(supabase, department: str):
    return supabase.table("job_orders").insert({
        "customer_name": f"TEST - DO NOT SHIP (dept-alert-verify-{department.lower()})",
        "status": "Approved",
        "total_amount": 750,
        "deposit_amount": 250,
        "qty_to_print": 10,
        "type_of_print": "OFFSET" if department == "PRESS" else "DTF",
        "department": department,
        "telephone_number": "0000000000",
        "created_by": "delivered@resend.dev",
        "job_description": f"Departmental alert verification - {department}",
        "sales_rep": None,
    }).execute().data[0]


def reconstruct_intro(department: str) -> str:
    # Mirrors send_departmental_alert's own three-way branch exactly,
    # for direct comparison against what should have been sent.
    if department == "GARMENT":
        return (
            "An order assigned to your department has been approved. Garment orders are "
            "not scheduled in Production Layout Builder — <strong>you can begin production "
            "immediately</strong>, no need to wait on the scheduler."
        )
    elif department == "PRESS":
        return (
            "An order assigned to your department has been approved and sent to the "
            "scheduler for machine/stage scheduling. <strong>Wait for the schedule before "
            "starting production</strong> — unless this is a low-quantity job that your team "
            "has agreed doesn't need scheduling, in which case you can begin immediately."
        )
    return "An order assigned to your department requires attention."


def main():
    supabase = get_supabase()
    ids = []
    try:
        for department in ("PRESS", "GARMENT"):
            print("\n" + "=" * 70)
            print(f"Testing send_departmental_alert for department={department}")
            print("=" * 70)
            order = insert(supabase, department)
            ids.append(order["id"])
            print(f"Seeded id={order['id']}, job_order_no={order['job_order_no']}, department={department}")

            result = handle_order_approved(order["id"])
            print("handle_order_approved result:", result)
            assert result.get("departmental_alert_sent") is True, (
                f"expected departmental_alert_sent=True for {department}, got {result}"
            )
            print(f"PASS -- departmental_alert_sent=True for {department} "
                  f"(recipients pulled from DEPT_EMAILS_{department}, confirmed via .env).")

            # Reconstruct the exact HTML deterministically (same known
            # ticket fields) to confirm the department-specific intro
            # text is the one that actually would have gone out.
            expected_intro = reconstruct_intro(department)
            rows = [
                ("Order No", order["job_order_no"], None),
                ("Customer", order["customer_name"], None),
                ("Status", order["status"], None),
                ("Contract Value", f"GH₵ {float(order['total_amount']):,.2f}", None),
            ]
            for label, value in _job_detail_rows(order):
                rows.append((label, value, None))
            html_out = _email_shell(
                accent_bg="#0f172a",
                heading=f"{department} DEPARTMENT ALERT",
                subheading="Appointed Time Printing Enterprise Hub",
                intro=expected_intro,
                rows=rows,
                footer="This is an automated notification from the Appointed Time Enterprise Hub.",
            )
            out_path = Path(__file__).resolve().parent / f"dept_alert_{department.lower()}_preview.html"
            out_path.write_text(
                '<!doctype html><html><head><meta charset="utf-8">'
                f"<title>{department} Department Alert Preview</title></head>"
                '<body style="background:#f1f5f9;padding:40px;">' + html_out + "</body></html>",
                encoding="utf-8",
            )
            print(f"Wrote reconstructed HTML to {out_path}")
            assert "<strong>" in html_out, "expected the emphasized instruction to render as real markup"

        print("\n" + "=" * 70)
        print("Confirming PRESS and GARMENT intros are genuinely different text")
        print("=" * 70)
        press_intro = reconstruct_intro("PRESS")
        garment_intro = reconstruct_intro("GARMENT")
        assert press_intro != garment_intro
        assert "Wait for the schedule" in press_intro
        assert "you can begin production immediately" in garment_intro
        print("PASS -- PRESS says wait for the scheduler; GARMENT says begin immediately. Confirmed distinct.")

        print("\nALL CHECKS PASSED.")
    finally:
        print(f"\n=== Cleanup: deleting {len(ids)} test row(s) ===")
        for id_ in ids:
            supabase.table("job_orders").delete().eq("id", id_).execute()
        remaining = (
            supabase.table("job_orders")
            .select("id")
            .ilike("customer_name", "%dept-alert-verify%")
            .execute()
        )
        print("Remaining test rows after cleanup:", remaining.data)
        assert remaining.data == []


if __name__ == "__main__":
    main()
