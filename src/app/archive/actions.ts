"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, hasRole } from "@/lib/nav-config";

interface ActionResult {
  error?: string;
}

async function requireArchiveAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, ADMIN_ROLES)) {
    throw new Error("The Approved Orders Archive is reserved for administrators.");
  }
  return user;
}

// Same cumulative-deposit contract as dispatch/actions.ts's recordPayment
// (mirrors record_balance_payment(id, new_deposit_total) — newDepositTotal
// is the NEW CUMULATIVE deposit, not the incremental payment; the caller
// computes deposit + payAmt before calling this). Replicated rather than
// imported: importing dispatch's action would call revalidatePath("/dispatch"),
// leaving this page's own data stale after a payment. Same logic, gated to
// Archive's own ADMIN_ROLES-only access (not the ADMIN∪FINANCE union
// Dispatch uses) since that's this route's existing access boundary.
export async function recordPayment(
  orderId: number,
  newDepositTotal: number,
  receiptNo: string
): Promise<ActionResult> {
  await requireArchiveAccess();

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

  revalidatePath("/archive");
  return {};
}
