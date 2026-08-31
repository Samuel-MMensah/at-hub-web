import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Phase 1 of the deposit-sync fix (2026-08-31 investigation — see
// MIGRATION_STATUS.md, "Deposit sync gap"): job_orders.deposit_amount
// and job_invoices.payment were two completely independent fields for
// the same linked order's real collected-to-date figure, with THREE
// separate write paths (Dispatch's recordPayment, Archive's
// recordPayment, Invoice Entry's recordInvoicePayment) that could each
// drift the two apart — confirmed live, 6 of 10 real linked invoices
// with payment > 0 disagreed with their order's own deposit_amount, by
// as much as ~GH₵340,000 on one order.
//
// job_orders <-> job_invoices is genuinely one-to-many, not 1:1 — 5 real
// orders currently have 2-4 linked invoices each — so "the" linked
// invoice's payment is never enough; every consumer must sum across
// every invoice linked to that order_no.
export async function getInvoicePaymentSumsByOrderNo(
  supabase: SupabaseServerClient
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("job_invoices")
    .select("job_order_no, payment")
    .not("job_order_no", "is", null);

  const sums = new Map<string, number>();
  for (const row of (data ?? []) as { job_order_no: string | null; payment: number | null }[]) {
    if (!row.job_order_no) continue;
    sums.set(row.job_order_no, (sums.get(row.job_order_no) ?? 0) + Number(row.payment ?? 0));
  }
  return sums;
}

// The ONE place "what is this order's real collected-to-date deposit"
// is computed — every KPI/report/list reads through this rather than
// job_orders.deposit_amount directly, so the two fields can never
// silently drift apart again the way they did before this fix. Returns
// a NEW array (never mutates the input); an order with zero linked
// invoices passes through with its own deposit_amount completely
// unchanged — nothing about the unlinked path is touched.
export function withEffectiveDeposits<
  T extends { job_order_no: string | null; deposit_amount: number | null },
>(orders: T[], invoicePaymentSums: Map<string, number>): T[] {
  return orders.map((order) => {
    if (order.job_order_no && invoicePaymentSums.has(order.job_order_no)) {
      return { ...order, deposit_amount: invoicePaymentSums.get(order.job_order_no)! };
    }
    return order;
  });
}

// Whether an order has at least one linked invoice — gates Dispatch's
// and Archive's Record Payment UI, since writing job_orders.deposit_amount
// directly for such an order would now be silently overwritten (by
// withEffectiveDeposits above) the next time anything reads it.
export function hasLinkedInvoice(
  order: { job_order_no: string | null },
  invoicePaymentSums: Map<string, number>
): boolean {
  return Boolean(order.job_order_no && invoicePaymentSums.has(order.job_order_no));
}
