import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, hasRole } from "@/lib/nav-config";
import { ProductionLayoutClient, type ApprovedOrderRow } from "./production-layout-client";

// Mirrors get_db_job_orders("Approved") (app.py:925-936): a plain .eq()
// filter, no row cap — same as the source, which never limits this query
// either.
async function getApprovedOrders() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_orders")
    .select("id, job_order_no, customer_name, total_amount, qty_to_print, type_of_print, created_by")
    .eq("status", "Approved");
  return (data ?? []) as ApprovedOrderRow[];
}

export default async function ProductionLayoutPage() {
  // Matches app.py:5340's "and is_admin" gate exactly (same ADMIN_ROLES
  // set as Authorization Center / Archive / Audit Log).
  const user = await requireUser();
  const allowed = hasRole(user.role, ADMIN_ROLES);

  const orders = allowed ? await getApprovedOrders() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-4 text-lg font-bold text-at-navy-soft">
        Production Layout Builder — Machine Allocation Engine
      </div>

      {!allowed ? (
        <RestrictedAccess
          icon="🔒"
          message="The Production Layout Builder is reserved for plant administrators. Use the Raise Job Order module to submit orders for the production pipeline."
        />
      ) : (
        <ProductionLayoutClient orders={orders} />
      )}
    </AppShell>
  );
}
