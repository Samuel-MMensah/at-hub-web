"""
Operational data-hygiene script -- reconciles job_orders.deposit_amount
against the real SUM of payment across every linked job_invoices row,
for orders where the two disagree.

Context: job_orders.deposit_amount and job_invoices.payment were two
completely independent fields for the same linked order's real
collected-to-date figure -- three separate write paths (Dispatch's
recordPayment, Archive's recordPayment, Invoice Entry's
recordInvoicePayment) could each drift the two apart, and did (see
MIGRATION_STATUS.md, "Deposit sync gap"). Phase 1 of the fix
(src/lib/effective-deposit.ts) made deposit_amount a LIVE-DERIVED value
at read time for any linked order, so the app itself no longer shows a
stale number anywhere. This script is Phase 2: the raw column itself
still holds the old, wrong value until corrected, which matters for
anything that queries job_orders directly and does NOT go through
withEffectiveDeposits() -- an external report, a future feature, a
one-off SQL query run by someone who doesn't know this history.

job_orders <-> job_invoices is genuinely one-to-many (confirmed live,
2026-08-31 investigation: 5 real orders had 2-4 linked invoices each),
so this sums every linked invoice's payment per order_no -- never a
naive "the one linked invoice" assumption.

Safe by construction, matching backfill_attachment_paths.py exactly:
  - DRY-RUN by default: prints every before/after; only --apply writes.
  - IDEMPOTENT: a row whose deposit_amount already matches the summed
    invoice total (compared at 2-decimal precision, this app's own
    money-comparison convention -- see round2() throughout
    revenue-analysis/invoice-entry/actions.ts) is a silent no-op.
  - Nothing is EVER blanket-applied. Every disagreeing row is printed
    individually, categorized by direction, and --apply alone writes
    NOTHING for the "invoices are more complete" category -- each such
    order additionally requires being named via a repeatable
    --confirm ORDER_NO flag, so the exact set of orders being corrected
    is explicit in the command itself, not inferred from a blanket flag.
  - The other direction (an order's own deposit exceeds what any linked
    invoice shows paid) is never written under ANY flag combination --
    that pattern means the invoice side is the incomplete record, which
    this script has no way to safely resolve. Printed in its own loudly
    labeled section instead.
  - Two specific orders found during the original investigation
    (P963191, P481826) are hard-excluded from ever being written by
    this script, regardless of category or --confirm, pending a real
    Finance review of their actual receipt history (see the dry-run's
    own printed reasoning for each).

    ./venv/Scripts/python.exe scripts/backfill_deposit_amounts.py                                   # dry-run
    ./venv/Scripts/python.exe scripts/backfill_deposit_amounts.py --apply --confirm P545650 --confirm P352905   # write only the named, confirmed rows
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

# Windows' default console codepage (cp1252) can't encode the ⚠ used
# below in the loudly-labeled "do not auto-resolve" section header --
# force UTF-8 stdout so this script runs the same on every platform.
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.supabase_client import get_supabase

# Pending real Finance confirmation of their actual receipt/payment
# history -- the numbers alone can't disambiguate these two (see the
# investigation this script's docstring references). Never written by
# this script under any flag combination, even if named via --confirm.
PERMANENTLY_SKIPPED = {
    "P963191": (
        "invoice shows fully paid (490,000.00) at more than 3x the order's "
        "own tracked deposit (150,000.00) -- unclear whether the invoice "
        "payment already subsumes the earlier deposit (correct=490,000.00) "
        "or the two are separate real payments that should add (640,000.00)."
    ),
    "P481826": (
        "the ONE case where the order's own deposit (12,900.00) exceeds "
        "what its linked invoice shows paid (11,900.00) -- see the "
        "ORDER EXCEEDS INVOICE section below for why this direction is "
        "never auto-resolved; this order is additionally hard-excluded by "
        "name pending a real Finance check."
    ),
}


def round2(n: float) -> float:
    # Same convention as round2() in revenue-analysis/invoice-entry/actions.ts
    # -- comparing raw floats directly reproduces the exact false-rejection
    # class of bug that convention was already introduced to avoid.
    return round(n, 2)


def get_invoice_payment_sums(supabase) -> dict[str, float]:
    res = (
        supabase.table("job_invoices")
        .select("job_order_no,payment")
        .not_.is_("job_order_no", "null")
        .execute()
    )
    sums: dict[str, float] = defaultdict(float)
    for row in res.data:
        order_no = row["job_order_no"]
        if not order_no:
            continue
        sums[order_no] += float(row["payment"] or 0)
    return dict(sums)


def main(apply: bool, confirmed: set[str]) -> None:
    supabase = get_supabase()

    invoice_sums = get_invoice_payment_sums(supabase)
    linked_order_nos = list(invoice_sums.keys())
    print(f"Live count: {len(linked_order_nos)} distinct job_order_no values have at least one linked invoice.\n")

    orders_res = (
        supabase.table("job_orders")
        .select("id,job_order_no,deposit_amount")
        .in_("job_order_no", linked_order_nos)
        .execute()
    )

    matching = 0
    invoice_more_complete: list[dict] = []
    order_exceeds_invoice: list[dict] = []

    for row in orders_res.data:
        order_no = row["job_order_no"]
        raw_deposit = round2(float(row["deposit_amount"] or 0))
        summed = round2(invoice_sums[order_no])

        if raw_deposit == summed:
            matching += 1
            continue

        item = {
            "id": row["id"],
            "job_order_no": order_no,
            "raw_deposit": raw_deposit,
            "summed_invoices": summed,
            "delta": round2(summed - raw_deposit),
        }
        if summed > raw_deposit:
            invoice_more_complete.append(item)
        else:
            order_exceeds_invoice.append(item)

    total_disagreeing = len(invoice_more_complete) + len(order_exceeds_invoice)
    print(f"Linked orders already matching (no-op): {matching}")
    print(f"Linked orders disagreeing: {total_disagreeing}")
    print(f"  - invoice(s) more complete (SUM > raw deposit): {len(invoice_more_complete)}")
    print(f"  - order exceeds invoice(s) (SUM < raw deposit):  {len(order_exceeds_invoice)}")
    print()

    # --- Category A: invoice(s) more complete -----------------------------
    print("=" * 78)
    print("CATEGORY A -- invoice(s) more complete (SUM(payment) > raw deposit_amount)")
    print("Requires --apply AND --confirm <job_order_no> (per row) to write.")
    print("=" * 78)
    applied_a = 0
    for item in sorted(invoice_more_complete, key=lambda r: -r["delta"]):
        order_no = item["job_order_no"]
        print(f"\nid={item['id']} job_order_no={order_no}")
        print(f"  BEFORE (raw deposit_amount): {item['raw_deposit']:.2f}")
        print(f"  AFTER  (sum of linked invoice payments): {item['summed_invoices']:.2f}")
        print(f"  delta: +{item['delta']:.2f}")

        if order_no in PERMANENTLY_SKIPPED:
            print(f"  -> PERMANENTLY SKIPPED: {PERMANENTLY_SKIPPED[order_no]}")
            continue

        if not apply:
            print("  -> DRY-RUN, not written.")
            continue

        if order_no not in confirmed:
            print(f"  -> NOT CONFIRMED: pass --confirm {order_no} to write this specific row.")
            continue

        supabase.table("job_orders").update({"deposit_amount": item["summed_invoices"]}).eq("id", item["id"]).execute()
        print("  -> PATCHED.")
        applied_a += 1

    # --- Category B: order exceeds invoice(s) ------------------------------
    print()
    print("=" * 78)
    print("⚠ ORDER EXCEEDS INVOICE -- DO NOT AUTO-RESOLVE")
    print("(SUM(payment) < raw deposit_amount -- the order's own ledger shows MORE")
    print(" collected than any linked invoice reflects. Trusting the invoice here")
    print(" would UNDERSTATE real collected revenue. Never written by this script")
    print(" under any flag combination -- these need a human to check the actual")
    print(" receipt trail, not an automated rule.)")
    print("=" * 78)
    for item in sorted(order_exceeds_invoice, key=lambda r: r["delta"]):
        order_no = item["job_order_no"]
        print(f"\nid={item['id']} job_order_no={order_no}")
        print(f"  Order's own deposit_amount:      {item['raw_deposit']:.2f}")
        print(f"  Sum of linked invoice payments:  {item['summed_invoices']:.2f}")
        print(f"  delta: {item['delta']:.2f}  (order exceeds invoice by {-item['delta']:.2f})")
        if order_no in PERMANENTLY_SKIPPED:
            print(f"  -> Also on the permanently-skipped list: {PERMANENTLY_SKIPPED[order_no]}")
        print("  -> NOT WRITTEN. Needs a real Finance/receipt-history check.")

    print()
    mode = "APPLIED" if apply else "DRY-RUN"
    print("=" * 78)
    print(f"{mode} SUMMARY")
    print(f"  already matching (no-op): {matching}")
    print(f"  category A (invoice more complete): {len(invoice_more_complete)} found, {applied_a} written")
    print(f"  category B (order exceeds invoice): {len(order_exceeds_invoice)} found, 0 written (never auto-resolved)")
    print(f"  permanently skipped by name: {sorted(PERMANENTLY_SKIPPED)}")
    print("=" * 78)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Reconcile job_orders.deposit_amount against SUM(job_invoices.payment) for linked orders."
    )
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run).")
    parser.add_argument(
        "--confirm",
        action="append",
        default=[],
        metavar="JOB_ORDER_NO",
        help="Explicitly confirm ONE Category-A order_no to write. Repeatable. "
        "Required per-row even with --apply -- a blanket --apply writes nothing on its own.",
    )
    args = parser.parse_args()
    main(apply=args.apply, confirmed=set(args.confirm))
