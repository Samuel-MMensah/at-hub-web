"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, hasRole } from "@/lib/nav-config";
import { formatLifecycleTimestamp } from "@/lib/lifecycle-timestamp";
import { triggerBackendEmail } from "@/lib/notify-backend";

interface ActionResult {
  error?: string;
}

const PENDING_STATUSES = ["Pending Approval", "Pending Revision Approval"];

async function requireAuthorizationAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, ADMIN_ROLES)) {
    throw new Error("The Authorization Center is reserved for administrators.");
  }
  return user;
}

// Mirrors the Approve branch of authorization_center.py: writes status +
// approved_by + approval_date. approval_date is a real, separately
// tracked TEXT column (confirmed live against 6 real Approved rows) —
// distinct from approved_at, which is also a real column but is null on
// every one of those rows, because no write path (old Streamlit route or
// this one) ever populates it. See MIGRATION_STATUS.md for the follow-up
// this implies for My Order Tracker's Avg Days to Approval metric.
//
// The .in("status", PENDING_STATUSES) guard prevents a stale/double
// submit from re-approving a row some other admin already actioned —
// same guard pattern as production-board/actions.ts's startProduction.
//
// Emails #2 (notify_order_approved), #3 (notify_needs_scheduling), and
// #4 (send_departmental_alert) all fire here, best-effort, via a
// single backend call (POST /email/order-approved) that attempts all
// three independently server-side — see handle_order_approved's
// docstring for why they're independent attempts, not one that can
// silently skip the others.
export async function approveOrder(orderId: number): Promise<ActionResult> {
  const user = await requireAuthorizationAccess();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({
      status: "Approved",
      approved_by: user.fullName,
      approval_date: formatLifecycleTimestamp(new Date()),
    })
    .eq("id", orderId)
    .in("status", PENDING_STATUSES);

  if (error) {
    return { error: error.message };
  }

  await triggerBackendEmail(supabase, "/email/order-approved", { order_id: orderId });

  revalidatePath("/authorization");
  return {};
}

// Mirrors the Reject branch: requires a non-empty rejection note before
// allowing submit, matching the source's own validation
// (`if not _li_notes.strip(): st.error(...)`). Validated here too, not
// just client-side, since a Server Action is a real network boundary.
export async function rejectOrder(orderId: number, rejectionNote: string): Promise<ActionResult> {
  await requireAuthorizationAccess();

  const note = rejectionNote.trim();
  if (!note) {
    return { error: "Please provide a rejection rationale before submitting." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({
      status: "Rejected",
      rejection_note: note,
    })
    .eq("id", orderId)
    .in("status", PENDING_STATUSES);

  if (error) {
    return { error: error.message };
  }

  // Email #5 (notify_order_rejected) — best-effort.
  await triggerBackendEmail(supabase, "/email/order-rejected", { order_id: orderId });

  revalidatePath("/authorization");
  return {};
}
