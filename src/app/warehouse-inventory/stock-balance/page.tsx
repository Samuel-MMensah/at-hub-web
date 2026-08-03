import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { StockBalanceClient, type StockBalanceRow } from "./stock-balance-client";

// Phase 2 — read-only report, standalone, NOT wired into Warehouse's
// nav/UI yet (that's Phase 5). No role gate beyond requireUser()'s
// baseline auth for now: this route isn't reachable from any nav item,
// and access control for the real, wired-in version is an open
// decision for Phase 5 (likely Warehouse's own ADMIN_ROLES|
// WAREHOUSE_ROLES gate, but not assumed here — flag before Phase 5,
// don't silently pick one now).
//
// Reads the `stock_balance` view (not material_catalog directly) — a
// real Postgres GROUP BY/SUM done server-side, not 479 separate
// queries or a client-side reduce over full material_receipts/
// material_issuances fetches. See the view's own SQL (provided
// alongside this page) for why LEFT JOIN + COALESCE(...,0) is what
// makes every material show receipts=0/issuances=0 right now, not
// NULL, while both source tables are still empty.
// Exported so Warehouse's tabbed page (src/app/warehouse/page.tsx) can
// reuse this exact query instead of duplicating it — Phase 5 wires this
// standalone route's content into a Warehouse tab without moving or
// rebuilding it. This route itself is untouched and still works at its
// own URL.
export async function getStockBalance() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("stock_balance")
    .select("*")
    .order("section_group", { ascending: true })
    .order("material_description", { ascending: true });

  return (data ?? []) as StockBalanceRow[];
}

export default async function StockBalancePage() {
  const user = await requireUser();
  const rows = await getStockBalance();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Stock Balance</div>
      <div className="mb-4 text-sm text-at-slate">
        On-Hand = Opening Inventory + Receipts − Issuances. Value = Unit Cost × On-Hand.
      </div>

      {rows.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No materials in the catalog yet.
        </div>
      ) : (
        <StockBalanceClient rows={rows} />
      )}
    </AppShell>
  );
}
