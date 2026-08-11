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

// Mints a FRESH signed URL for an order attachment (LPO / sample photo) at the
// moment Archive's detail view needs it. The bucket is private and
// lpo_file_url/sample_file_url store the raw object PATH, so the URL is
// generated on demand through the caller's own (admin-gated) session rather
// than read from a stored value that would expire. A legacy value that is
// already a full URL (pre-migration rows) is returned unchanged.
export async function getAttachmentSignedUrl(
  pathOrUrl: string
): Promise<{ url?: string; error?: string }> {
  await requireArchiveAccess();
  if (!pathOrUrl) return { error: "No attachment on this order." };
  if (pathOrUrl.startsWith("http")) return { url: pathOrUrl };
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("job-attachments")
    .createSignedUrl(pathOrUrl, 60 * 60); // 1 hour, generated fresh each click
  if (error || !data) return { error: "Could not open this attachment." };
  return { url: data.signedUrl };
}

// FIXED — same vulnerability class just closed in Dispatch's
// recordPayment and job_invoices' recordInvoicePayment: this
// previously took a client-computed newDepositTotal (deposit + payAmt
// from archive-client.tsx) and wrote it as-is, no server-side re-fetch
// of the real current deposit, no cap check against total_amount.
// Fixed the identical way: take the INCREMENTAL payment amount only,
// re-fetch the real current deposit_amount/total_amount through the
// caller's own session, compute the new cumulative total from THAT,
// and reject outright (not clamp) if it would exceed total_amount.
//
// Still a genuinely separate, independently-duplicated function, not
// consolidated with Dispatch's copy — importing Dispatch's action
// would call revalidatePath("/dispatch"), leaving this page's own data
// stale after a payment (the reason this was replicated in the first
// place, per this file's original comment). Deliberately not merged
// into one shared function as part of this fix — that consolidation
// is a legitimate separate refactor, not something to blend into a
// correctness fix. Still gated to Archive's own ADMIN_ROLES-only
// access (not the ADMIN∪FINANCE union Dispatch uses), matching this
// route's existing access boundary.
export async function recordPayment(
  orderId: number,
  paymentAmount: number,
  receiptNo: string
): Promise<ActionResult> {
  await requireArchiveAccess();

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

  revalidatePath("/archive");
  return {};
}

interface RevisionInput {
  customerName: string;
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
//
// Customer name editing (added later, not in the original port):
// per confirmed decision, this is deliberately NOT a plain
// job_orders.customer_name edit when the order has a real client_id —
// it fixes the CANONICAL clients record, so the correction applies
// everywhere that client is referenced going forward (Sales Rep
// Dashboard, future orders, Global Search), not just this order.
// job_orders.customer_name for THIS order is still updated too (so the
// order's own snapshot matches), but no OTHER order's customer_name is
// ever touched — same "don't rewrite history" principle already
// established for job_invoices.customer_name. If the order has no
// client_id (pre-dates the client linkage work, or somehow unlinked),
// only this order's own customer_name is corrected; clients is never
// involved.
export async function reviseOrder(orderId: number, input: RevisionInput): Promise<ActionResult> {
  await requireArchiveAccess();

  const customerName = input.customerName.trim();
  if (!customerName) {
    return { error: "Customer name cannot be empty." };
  }

  const supabase = await createClient();

  const { data: current, error: fetchError } = await supabase
    .from("job_orders")
    .select("client_id")
    .eq("id", orderId)
    .single();

  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Order not found." };
  }

  if (current.client_id) {
    // Case-insensitive collision check, same "warn, don't silently
    // merge" pattern as Raise Job Order's new-client duplicate check
    // (raise-order/actions.ts's submitBatch). A match on THIS order's
    // own client_id (name unchanged, or only a case change) is not a
    // collision — only a DIFFERENT client already holding this exact
    // name stops the save.
    const { data: existingClient, error: lookupError } = await supabase
      .from("clients")
      .select("id, name, phone, email")
      .ilike("name", customerName)
      .maybeSingle();

    if (lookupError) {
      return { error: `Could not verify client name: ${lookupError.message}` };
    }
    if (existingClient && existingClient.id !== current.client_id) {
      return {
        error: `A different client named "${existingClient.name}" already exists (phone: ${
          existingClient.phone || "—"
        }, email: ${existingClient.email || "—"}). Renaming would collide with that client's record — use a more specific name if this is genuinely a different client, or resolve the duplicate deliberately before merging them.`,
      };
    }

    const { error: clientUpdateError } = await supabase
      .from("clients")
      .update({ name: customerName })
      .eq("id", current.client_id);

    if (clientUpdateError) {
      return { error: `Could not update client record: ${clientUpdateError.message}` };
    }
  }

  const { error } = await supabase
    .from("job_orders")
    .update({
      customer_name: customerName,
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
