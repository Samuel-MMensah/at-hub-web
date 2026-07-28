"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

interface ActionResult {
  error?: string;
}

// Production Board has no role gate (matches production.py: any
// authenticated user, same posture as Command Center/Shop Floor
// Control) — only requireUser() is needed here, no hasRole() check.

export async function startProduction(orderId: number): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_orders")
    .update({ status: "In Production" })
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
