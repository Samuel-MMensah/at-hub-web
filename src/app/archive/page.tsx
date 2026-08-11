import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, hasRole } from "@/lib/nav-config";
import { ArchiveClient, type ArchiveOrderRow } from "./archive-client";

// get_archive_orders_cached (app.py:1057) — genuinely broader than
// Command Center's KPI query: includes 'Ready for Collection' and
// 'Delivered', which Command Center excludes. Do not reuse that query.
const ARCHIVE_STATUSES = ["Approved", "In Production", "At Warehouse", "Ready for Collection", "Delivered"];
const ARCHIVE_ROW_CAP = 2000;

async function getArchiveOrders() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select(
      "id, job_order_no, customer_name, client_id, status, department, type_of_print, print_type, total_amount, deposit_amount, qty_to_print, date_of_collection, approved_by, is_sample, sample_reason, lpo_file_url, sample_file_url"
    )
    .in("status", ARCHIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(ARCHIVE_ROW_CAP);

  return (data ?? []) as ArchiveOrderRow[];
}

export default async function ArchivePage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, ADMIN_ROLES);

  const orders = allowed ? await getArchiveOrders() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">
        Enterprise Ledger &amp; Approved Orders Vault
      </div>

      {!allowed ? (
        <RestrictedAccess
          icon="🔒"
          message="The Approved Orders Archive is accessible only to authorized managers and administrators. Your submitted orders are visible in the My Order Tracker module."
        />
      ) : orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No approved job contracts currently sitting in archives.
        </div>
      ) : (
        <div>
          {orders.length >= ARCHIVE_ROW_CAP && (
            <div className="mb-4 rounded-at border border-at-border bg-at-bg px-4 py-2.5 text-xs text-at-slate">
              Showing the most recent {ARCHIVE_ROW_CAP.toLocaleString()} orders — this list is
              capped so the page stays fast as history grows. If the order you need is older
              than that, search above, or use Global Search in the sidebar, which searches the
              full history, not just this cap.
            </div>
          )}
          <ArchiveClient orders={orders} />
        </div>
      )}
    </AppShell>
  );
}
