"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";
import { triggerBackendEmail } from "@/lib/notify-backend";

interface ActionResult {
  error?: string;
}

// Warehouse's one action, previously a disabled "coming soon" button —
// this is genuinely new, not a re-wire of something that already
// worked. Ports app.py's notify_ready_for_finance (line 514), split
// architecturally: the warehouse_notified_finance DB write happens
// HERE (matching every other status-changing write in this app —
// approveOrder, rejectOrder, sendToWarehouse — which all write via the
// session-bound client, never via the backend service), and the email
// send is a best-effort call to the backend afterward. Source combines
// both inside one Python function; this port doesn't, but the outcome
// (flag set to true on success, an email attempted) matches exactly.
//
// The UPDATE is conditioned on status='At Warehouse' AND
// warehouse_notified_finance=false, and only proceeds to attempt the
// email if that update actually affected a row — same atomic
// claim-before-send shape as the overdue-collection alert, so a
// double-click or two people acting on the same order can't both
// trigger the email, and a stale/already-notified order can't be
// re-notified.
export async function notifyReadyForFinance(orderId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!hasRole(user.role, [...ADMIN_ROLES, ...WAREHOUSE_ROLES])) {
    return { error: "Warehouse is reserved for warehouse staff and administrators." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_orders")
    .update({ warehouse_notified_finance: true })
    .eq("id", orderId)
    .eq("status", "At Warehouse")
    .eq("warehouse_notified_finance", false)
    .select();

  if (error) {
    return { error: error.message };
  }

  if (data && data.length > 0) {
    await triggerBackendEmail(supabase, "/email/ready-for-finance", { order_id: orderId });
  }

  revalidatePath("/warehouse");
  return {};
}
