"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";

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

// Mirrors dispatch.py's record_balance_payment(id, new_deposit_total):
// newDepositTotal is the NEW CUMULATIVE deposit, not the incremental
// payment — the caller (dispatch-client.tsx) computes deposit + payAmt
// before calling this. Passing the raw payment amount here would
// overwrite the deposit total instead of adding to it.
export async function recordPayment(
  orderId: number,
  newDepositTotal: number,
  receiptNo: string
): Promise<ActionResult> {
  await requireDispatchAccess();

  const supabase = await createClient();
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
// it from "active"). Not a new "Dispatched" status.
export async function finalizeDispatch(orderId: number): Promise<ActionResult> {
  await requireDispatchAccess();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({ status: "Delivered" })
    .eq("id", orderId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dispatch");
  return {};
}
