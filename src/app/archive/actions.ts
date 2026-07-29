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

interface RevisionInput {
  qtyToPrint: number;
  totalAmount: number;
  depositAmount: number;
  typeOfPrint: string;
}

// Mirrors the Master Order Revision form's Save Changes branch
// (app.py:5194-5211) — an intentional re-route, not a plain edit: saving
// always sets status to "Pending Revision Approval" alongside the field
// changes, which moves the order out of every Archive tab and back into
// Authorization Center's pending queue for fresh sign-off. Always writes
// type_of_print specifically (never print_type) — matches the source's
// own write target exactly, even though the garment branch of the read
// side falls back to print_type for the *initial* dropdown value (see
// buildCategoryOptions in archive-client.tsx).
export async function reviseOrder(orderId: number, input: RevisionInput): Promise<ActionResult> {
  await requireArchiveAccess();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({
      qty_to_print: input.qtyToPrint,
      total_amount: input.totalAmount,
      deposit_amount: input.depositAmount,
      type_of_print: input.typeOfPrint,
      status: "Pending Revision Approval",
    })
    .eq("id", orderId);

  if (error) {
    return { error: error.message };
  }

  // Revalidate both routes: the order needs to disappear from Archive's
  // own tabs AND reappear in Authorization Center's pending queue.
  revalidatePath("/archive");
  revalidatePath("/authorization");
  return {};
}

// Deliberate deviation from the source, not a faithful port: the
// original deletes with zero confirmation (a single form-submit
// button). The caller (archive-client.tsx) already requires the admin
// to type the exact job_order_no before this is even callable; this
// re-checks that match against real DB state too, same "validate at the
// real network boundary" precedent as Authorization Center's
// reject-note check — a stale client reference to the wrong row
// shouldn't be enough to delete it. Hard delete otherwise, no
// soft-delete, matching the source's actual .delete() behavior.
export async function deleteMasterOrder(orderId: number, confirmOrderNo: string): Promise<ActionResult> {
  await requireArchiveAccess();

  const supabase = await createClient();

  const { data: rows, error: fetchError } = await supabase
    .from("job_orders")
    .select("job_order_no")
    .eq("id", orderId)
    .limit(1);

  if (fetchError) return { error: fetchError.message };
  const row = rows?.[0];
  if (!row) return { error: `No order found for id=${orderId}.` };
  if (row.job_order_no !== confirmOrderNo) {
    return { error: "Confirmation text does not match this order's number." };
  }

  const { error } = await supabase.from("job_orders").delete().eq("id", orderId);
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return {};
}

// Mirrors the Reopen Order button (app.py:5229-5235), which calls
// update_order_lifecycle_status(id, 'At Warehouse') — same status-only
// write as production-board/actions.ts's sendToWarehouse: no
// warehouse_date attempt, since that column was already confirmed live
// (via a real "42703: column does not exist" error, in that earlier
// task) not to exist — this doesn't reproduce a call already known to
// fail. Guarded to only fire from Delivered, matching the button's own
// visibility condition.
export async function reopenOrder(orderId: number): Promise<ActionResult> {
  await requireArchiveAccess();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({ status: "At Warehouse" })
    .eq("id", orderId)
    .eq("status", "Delivered");

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/archive");
  return {};
}
