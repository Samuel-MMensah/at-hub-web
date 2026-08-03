import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";
import { MaterialReceiptsClient, type MaterialOption, type ReceiptRow } from "./material-receipts-client";

// Gated to the same roles who can even read material_catalog /
// material_receipts under RLS (admin/manager/supervisor/md/fm +
// warehouse) — a Front Desk user landing here would get zero rows
// from every query anyway, so RestrictedAccess is shown instead of a
// confusingly empty form, matching Warehouse's own gate pattern.
//
// Exported: Warehouse's tabbed page (src/app/warehouse/page.tsx) reuses
// this exact query for both its Material Receipts and Material
// Issuance tabs (both need the same material_catalog list) instead of
// duplicating it a third time. This route is otherwise untouched and
// still works standalone at its own URL.
export async function getMaterialOptions(): Promise<MaterialOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_catalog")
    .select("id, material_description, uom, unit_cost_ghc")
    .order("material_description", { ascending: true });
  return (data ?? []) as MaterialOption[];
}

// Grouped by the receipt's own `date` column (business date, editable
// on the form), not `created_at` — unlike Audit Log/Warehouse/Dispatch,
// this table has a distinct user-entered business date that's the
// actually meaningful "when was this received" dimension, matching the
// source spreadsheet's own Receipt of Material sheet.
export async function getReceiptHistory(): Promise<ReceiptRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_receipts")
    .select("id, date, vendor_name, qty, unit_cost, total_cost, created_at, material_catalog(material_description, uom)")
    .order("date", { ascending: false });
  return (data ?? []) as unknown as ReceiptRow[];
}

export default async function MaterialReceiptsPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...WAREHOUSE_ROLES]);

  const [materials, receipts] = allowed
    ? await Promise.all([getMaterialOptions(), getReceiptHistory()])
    : [[], []];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Material Receipts</div>
      <div className="mb-4 text-sm text-at-slate">
        Record incoming stock. Stock Balance updates automatically — no separate sync step.
      </div>

      {!allowed ? (
        <RestrictedAccess message="Material Receipts is reserved for warehouse staff and administrators." />
      ) : (
        <MaterialReceiptsClient materials={materials} receipts={receipts} />
      )}
    </AppShell>
  );
}
