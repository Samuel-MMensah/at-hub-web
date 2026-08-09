import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { SamplesClient, type SampleRow } from "./samples-client";

// Reads sample_conversion_status — the reusable view that owns the
// "counts as converted" logic (Phase 1), NOT re-derived here. The view
// is security_invoker, so it runs under this admin/finance caller's own
// job_orders RLS (empirically verified, not just declared).
async function getSamples(): Promise<SampleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sample_conversion_status")
    .select(
      "sample_id, sample_job_order_no, customer_name, sample_reason, order_date, is_converted, converted_order_id, converted_job_order_no"
    )
    .order("order_date", { ascending: false });
  return (data ?? []) as SampleRow[];
}

export default async function SamplesPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  const samples = allowed ? await getSamples() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Samples</div>
      <div className="mb-4 text-sm text-at-slate">
        Every sample / no-charge order, its conversion state, and the samples-to-orders trend.
      </div>

      {!allowed ? (
        <RestrictedAccess message="Samples is reserved for finance staff and administrators." />
      ) : (
        <SamplesClient samples={samples} />
      )}
    </AppShell>
  );
}
