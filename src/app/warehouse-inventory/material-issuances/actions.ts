"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";

interface ActionResult {
  error?: string;
}

async function requireMaterialIssuancesAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, [...ADMIN_ROLES, ...WAREHOUSE_ROLES])) {
    throw new Error("Material Issuance is reserved for warehouse staff and administrators.");
  }
  return user;
}

export interface RecordIssuanceInput {
  date: string;
  jobOrderNo: string;
  customerName: string;
  materialId: number;
  qty: number;
  unitCost: number;
  userDepartment: string;
  oracleReqNo: string;
  document: string;
  oracleShipmentNo: string;
}

// Inserts through the caller's own session client — the "warehouse and
// admin can insert issuances" RLS policy is what actually gates this,
// not this function's own role check (that's just a fast UI-level
// short-circuit; RLS is the real enforcement, verified separately).
export async function recordIssuance(input: RecordIssuanceInput): Promise<ActionResult> {
  await requireMaterialIssuancesAccess();

  if (!input.date) return { error: "Date is required." };
  if (!input.jobOrderNo) return { error: "Select an order." };
  if (!input.materialId) return { error: "Select a material." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { error: "Quantity must be greater than 0." };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { error: "Unit cost cannot be negative." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("material_issuances").insert({
    date: input.date,
    job_order_no: input.jobOrderNo,
    customer_name: input.customerName.trim() || null,
    material_id: input.materialId,
    qty: input.qty,
    unit_cost: input.unitCost,
    user_department: input.userDepartment.trim() || null,
    oracle_req_no: input.oracleReqNo.trim() || null,
    document: input.document.trim() || null,
    oracle_shipment_no: input.oracleShipmentNo.trim() || null,
  });

  if (error) {
    return { error: error.message };
  }

  // stock_balance recomputes issuances live, same as Phase 3's receipts —
  // no separate sync step.
  revalidatePath("/warehouse-inventory/material-issuances");
  revalidatePath("/warehouse-inventory/stock-balance");
  return {};
}

// Same input shape as recordIssuance, plus the row id being edited.
// edited_by/edited_at come from the real caller's own session
// (requireUser().email), never client-supplied. stock_balance needs no
// separate sync step — verified live in this task's own test.
export async function updateIssuance(id: number, input: RecordIssuanceInput): Promise<ActionResult> {
  const user = await requireMaterialIssuancesAccess();

  if (!input.date) return { error: "Date is required." };
  if (!input.jobOrderNo) return { error: "Select an order." };
  if (!input.materialId) return { error: "Select a material." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { error: "Quantity must be greater than 0." };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { error: "Unit cost cannot be negative." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_issuances")
    .update({
      date: input.date,
      job_order_no: input.jobOrderNo,
      customer_name: input.customerName.trim() || null,
      material_id: input.materialId,
      qty: input.qty,
      unit_cost: input.unitCost,
      user_department: input.userDepartment.trim() || null,
      oracle_req_no: input.oracleReqNo.trim() || null,
      document: input.document.trim() || null,
      oracle_shipment_no: input.oracleShipmentNo.trim() || null,
      edited_by: user.email,
      edited_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/warehouse-inventory/material-issuances");
  revalidatePath("/warehouse-inventory/stock-balance");
  return {};
}
