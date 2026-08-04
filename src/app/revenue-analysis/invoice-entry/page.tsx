import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import {
  InvoiceEntryClient,
  type JobOrderOption,
  type InvoiceRow,
} from "./invoice-entry-client";

// Deliberately no .eq("status", ...) filter — same confirmed decision
// as Material Issuance's order picker: orders move through statuses
// over time, restricting the picker now would just need revisiting
// later.
async function getJobOrderOptions(): Promise<JobOrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_orders")
    .select("job_order_no, customer_name, status, qty_to_print, total_amount")
    .order("job_order_no", { ascending: true });
  return (data ?? []) as JobOrderOption[];
}

async function getInvoiceHistory(): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_invoices")
    .select(
      "id, date, job_order_no, customer_name, product_description, revenue_category, business_unit, quantity, unit_price, amount, nhil, vat, invoice_total, payment, balance, status, oracle_no"
    )
    .order("date", { ascending: false });
  return (data ?? []) as InvoiceRow[];
}

export default async function InvoiceEntryPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  const [jobOrders, invoices] = allowed
    ? await Promise.all([getJobOrderOptions(), getInvoiceHistory()])
    : [[], []];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Invoice Entry</div>
      <div className="mb-4 text-sm text-at-slate">
        Record a new revenue invoice, linked to a job order or standalone.
      </div>

      {!allowed ? (
        <RestrictedAccess message="Invoice Entry is reserved for finance staff and administrators." />
      ) : (
        <InvoiceEntryClient jobOrders={jobOrders} invoices={invoices} />
      )}
    </AppShell>
  );
}
