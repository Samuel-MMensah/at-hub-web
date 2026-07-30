"""
Deliberate live-content verification of _email_shell's html.escape()
fix. Seeds a synthetic overdue order with an adversarial customer_name
containing real HTML-special characters, triggers a genuine send, and
reconstructs the exact same HTML deterministically (same approach used
for the earlier content-verification pass, since the configured Resend
key is send-only and can't retrieve past sends) to confirm the output
shows the literal text, not broken markup or an injected tag.

Run from backend/: ./venv/Scripts/python.exe scripts/verify_email_escaping.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.email import _email_shell, handle_overdue_alert
from app.supabase_client import get_supabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

ADVERSARIAL_NAME = "A & B Enterprises <Test>"


def main() -> None:
    supabase = get_supabase()

    print("=== Seed a synthetic overdue order with an adversarial customer_name ===")
    insert_res = (
        supabase.table("job_orders")
        .insert({
            "customer_name": ADVERSARIAL_NAME,
            "status": "Approved",
            "total_amount": 900,
            "deposit_amount": 100,
            "qty_to_print": 2,
            "type_of_print": "OFFSET",
            "department": "PRESS",
            "telephone_number": "0000000000",
            "created_by": "test-harness@local",
            "job_description": "HTML-escaping verification (adversarial customer_name)",
            "date_of_collection": "2020-01-01",
        })
        .execute()
    )
    order = insert_res.data[0]
    order_id = order["id"]
    print(f"Inserted id={order_id}, job_order_no={order['job_order_no']}, "
          f"customer_name={order['customer_name']!r}")
    assert order["customer_name"] == ADVERSARIAL_NAME, "DB round-tripped the adversarial name unmodified"

    try:
        print("\n=== Trigger the real send path (handle_overdue_alert) ===")
        result = handle_overdue_alert(order_id)
        print("Result:", result)
        assert result["claimed"] is True
        assert result["sent"] is True

        print("\n=== Reconstruct the exact same HTML deterministically for inspection ===")
        balance = max(0.0, float(order.get("total_amount") or 0) - float(order.get("deposit_amount") or 0))
        accent = "#b91c1c"
        html_out = _email_shell(
            accent_bg=accent,
            heading="\U0001F4E6 COLLECTION ALERT — OVERDUE",
            subheading="",
            intro="",
            rows=[
                ("Order No", str(order.get("job_order_no", "—")), accent),
                ("Customer", str(order.get("customer_name", "—")), None),
                ("Collection Date", str(order.get("date_of_collection", "—")), accent),
                ("Balance Due", f"GH₵ {balance:,.2f}", None),
            ],
            footer="",
        )

        checks = {
            'Literal text "A &amp; B Enterprises &lt;Test&gt;" present (escaped)':
                "A &amp; B Enterprises &lt;Test&gt;" in html_out,
            "Raw unescaped '<Test>' tag NOT present":
                "<Test>" not in html_out,
            "Raw unescaped bare '&' (not part of an entity) NOT present in the customer cell":
                " & B" not in html_out,
        }
        for desc, ok in checks.items():
            print(f"{'PASS' if ok else 'FAIL'}: {desc}")
        assert all(checks.values()), "one or more escaping checks failed"

        out_path = Path(__file__).resolve().parent / "escaping_verification_output.html"
        out_path.write_text(
            '<!doctype html><html><head><meta charset="utf-8">'
            "<title>Escaping verification</title></head>"
            '<body style="background:#f1f5f9;padding:40px;">' + html_out + "</body></html>",
            encoding="utf-8",
        )
        print(f"\nWrote reconstructed HTML to {out_path}")
        print("\nALL CHECKS PASSED.")
    finally:
        print(f"\n=== Cleanup: deleting test row id={order_id} ===")
        supabase.table("job_orders").delete().eq("id", order_id).execute()
        remaining = (
            supabase.table("job_orders")
            .select("id")
            .eq("customer_name", ADVERSARIAL_NAME)
            .execute()
        )
        print("Remaining test rows after cleanup:", remaining.data)
        assert remaining.data == []


if __name__ == "__main__":
    main()
