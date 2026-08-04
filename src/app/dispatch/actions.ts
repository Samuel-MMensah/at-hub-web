"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { formatLifecycleTimestamp } from "@/lib/lifecycle-timestamp";

interface ActionResult {
  error?: string;
}

async function requireDispatchAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES])) {
    throw new Error("Dispatch is reserved for managers and administrators.");
  }
  return user;
}

// FIXED — previously took a client-computed newDepositTotal (deposit +
// payAmt from dispatch-client.tsx) and wrote it as-is: no server-side
// re-fetch of the real current deposit, no cap check against
// total_amount. A live vulnerability in a page already in production
// use, closed here the same way job_invoices' recordInvoicePayment was
// fixed: take the INCREMENTAL payment amount only, re-fetch the real
// current deposit_amount/total_amount through the caller's own
// session, compute the new cumulative total from THAT (never from
// anything the client sent), and reject outright — not silently
// clamp — if it would push deposit_amount past total_amount. A second
// payment recorded moments after the first can no longer be computed
// from a stale client-held deposit value, and an overpayment can no
// longer be written at all.
export async function recordPayment(
  orderId: number,
  paymentAmount: number,
  receiptNo: string
): Promise<ActionResult> {
  await requireDispatchAccess();

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return { error: "Payment amount must be greater than 0." };
  }

  const supabase = await createClient();

  const { data: current, error: fetchError } = await supabase
    .from("job_orders")
    .select("deposit_amount, total_amount")
    .eq("id", orderId)
    .single();

  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Order not found." };
  }

  const currentDeposit = Number(current.deposit_amount ?? 0);
  const totalAmount = Number(current.total_amount ?? 0);
  const newDepositTotal = currentDeposit + paymentAmount;

  if (newDepositTotal > totalAmount) {
    return {
      error: `Payment of ${paymentAmount.toFixed(2)} exceeds the outstanding balance of ${(totalAmount - currentDeposit).toFixed(2)}.`,
    };
  }

  const { error } = await supabase
    .from("job_orders")
    .update({
      deposit_amount: newDepositTotal,
      receipt_no: receiptNo || null,
    })
    .eq("id", orderId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dispatch");
  return {};
}

// Mirrors dispatch.py's update_order_lifecycle_status(id, 'Delivered') —
// 'Delivered' is the real terminal status the rest of the app already
// filters on (My Order Tracker's status list, Command Center excluding
// it from "active"). Not a new "Dispatched" status. Also writes
// delivered_date, matching update_order_lifecycle_status()'s real
// timestamp-column behavior (app.py:1120).
export async function finalizeDispatch(orderId: number): Promise<ActionResult> {
  await requireDispatchAccess();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({
      status: "Delivered",
      delivered_date: formatLifecycleTimestamp(new Date()),
    })
    .eq("id", orderId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dispatch");
  return {};
}
