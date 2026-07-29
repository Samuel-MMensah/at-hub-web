"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatLifecycleTimestamp } from "@/lib/lifecycle-timestamp";

interface ActionResult {
  error?: string;
}

// Production Board has no role gate (matches production.py: any
// authenticated user, same posture as Command Center/Shop Floor
// Control) — only requireUser() is needed here, no hasRole() check.

// Mirrors update_order_lifecycle_status() (app.py:1120): writes the
// transition's timestamp column alongside status, same mapping.
export async function startProduction(orderId: number): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({
      status: "In Production",
      production_start_date: formatLifecycleTimestamp(new Date()),
    })
    .eq("id", orderId)
    .eq("status", "Approved");

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/production-board");
  return {};
}

// notify_sent_to_warehouse() is skipped here — it depends on the backend
// service (still a NotImplementedError stub). The original itself treats
// this notification as best-effort (wrapped in try/except, failure
// doesn't block the status update), so omitting it entirely is a safe
// subset of that behavior, not a deviation from it.
//
// No warehouse_date write here — confirmed via a live "42703: column
// does not exist" error that this column genuinely doesn't exist on
// job_orders. The real update_order_lifecycle_status() attempts it too
// and silently falls back to a status-only update when that throws, so
// this intentionally skips attempting a call already known to fail,
// rather than reproducing that dead code path.
export async function sendToWarehouse(orderId: number): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({ status: "At Warehouse" })
    .eq("id", orderId)
    .eq("status", "In Production");

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/production-board");
  return {};
}
