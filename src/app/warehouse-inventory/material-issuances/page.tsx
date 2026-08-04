import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";
import {
  MaterialIssuancesClient,
  type MaterialOption,
  type JobOrderOption,
  type IssuanceRow,
} from "./material-issuances-client";

async function getMaterialOptions(): Promise<MaterialOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_catalog")
    .select("id, material_description, uom, unit_cost_ghc")
    .order("material_description", { ascending: true });
  return (data ?? []) as MaterialOption[];
}

// Deliberately no .eq("status", ...) filter — every job order is
// selectable regardless of status (confirmed decision: orders move
// through statuses over time, e.g. a Rejected order can be resubmitted
// and later Approved, so restricting the picker now would just need
// revisiting later).
//
// Exported: reused by Warehouse's tabbed page (Phase 5) — this route
// is otherwise untouched and still works standalone at its own URL.
// (This file's own getMaterialOptions is NOT exported — Warehouse's
// tab reuses material-receipts/page.tsx's identical query instead of
// this duplicate, so there's only one copy to keep in sync.)
export async function getJobOrderOptions(): Promise<JobOrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_orders")
    .select("job_order_no, customer_name, status")
    .order("job_order_no", { ascending: true });
  return (data ?? []) as JobOrderOption[];
}

// Grouped by the issuance's own `date` column, same reasoning as Phase
// 3's material_receipts — not re-litigated here.
export async function getIssuanceHistory(): Promise<IssuanceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_issuances")
    .select(
      "id, date, job_order_no, customer_name, material_id, qty, unit_cost, total_cost, user_department, oracle_req_no, document, oracle_shipment_no, created_at, edited_by, edited_at, material_catalog(material_description, uom)"
    )
    .order("date", { ascending: false });
  return (data ?? []) as unknown as IssuanceRow[];
}

export default async function MaterialIssuancesPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...WAREHOUSE_ROLES]);

  const [materials, jobOrders, issuances] = allowed
    ? await Promise.all([getMaterialOptions(), getJobOrderOptions(), getIssuanceHistory()])
    : [[], [], []];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Material Issuance</div>
      <div className="mb-4 text-sm text-at-slate">
        Record stock issued against a job order. Stock Balance updates automatically.
      </div>

      {!allowed ? (
        <RestrictedAccess message="Material Issuance is reserved for warehouse staff and administrators." />
      ) : (
        <MaterialIssuancesClient materials={materials} jobOrders={jobOrders} issuances={issuances} />
      )}
    </AppShell>
  );
}
