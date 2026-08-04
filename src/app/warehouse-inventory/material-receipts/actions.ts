"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";

interface ActionResult {
  error?: string;
}

async function requireMaterialReceiptsAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, [...ADMIN_ROLES, ...WAREHOUSE_ROLES])) {
    throw new Error("Material Receipts is reserved for warehouse staff and administrators.");
  }
  return user;
}

export interface RecordReceiptInput {
  date: string;
  vendorName: string;
  materialId: number;
  qty: number;
  unitCost: number;
}

// The `authenticated`-role client (not service-role) is what makes the
// "warehouse and admin can insert receipts" RLS policy actually apply
// here — createClient() carries the caller's real session.
export async function recordReceipt(input: RecordReceiptInput): Promise<ActionResult> {
  await requireMaterialReceiptsAccess();

  if (!input.date) return { error: "Date is required." };
  if (!input.materialId) return { error: "Select a material." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { error: "Quantity must be greater than 0." };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { error: "Unit cost cannot be negative." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("material_receipts").insert({
    date: input.date,
    vendor_name: input.vendorName.trim() || null,
    material_id: input.materialId,
    qty: input.qty,
    unit_cost: input.unitCost,
  });

  if (error) {
    return { error: error.message };
  }

  // stock_balance is a live-computed view (SUM over material_receipts),
  // so revalidating its own path is what surfaces the new on_hand —
  // there's no separate balance row to sync.
  revalidatePath("/warehouse-inventory/material-receipts");
  revalidatePath("/warehouse-inventory/stock-balance");
  return {};
}

// Same input shape as recordReceipt, plus the row id being edited.
// edited_by/edited_at are set here from the real caller's own session
// (requireUser().email — never client-supplied), same "server is the
// one place that computes what actually gets written" discipline as
// recordInvoicePayment's balance math. stock_balance needs no separate
// sync step here either — verified live in this task's own test, not
// just assumed from "it's a view" the way the architecture note on
// recordReceipt/recordIssuance already claims.
export async function updateReceipt(id: number, input: RecordReceiptInput): Promise<ActionResult> {
  const user = await requireMaterialReceiptsAccess();

  if (!input.date) return { error: "Date is required." };
  if (!input.materialId) return { error: "Select a material." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { error: "Quantity must be greater than 0." };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { error: "Unit cost cannot be negative." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_receipts")
    .update({
      date: input.date,
      vendor_name: input.vendorName.trim() || null,
      material_id: input.materialId,
      qty: input.qty,
      unit_cost: input.unitCost,
      edited_by: user.email,
      edited_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/warehouse-inventory/material-receipts");
  revalidatePath("/warehouse-inventory/stock-balance");
  return {};
}
