import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ARCHIVE_STATUSES } from "@/app/archive/page";
import { getInvoicePaymentSumsByOrderNo, withEffectiveDeposits } from "@/lib/effective-deposit";
import { ClientProfileClient, type ClientOrderRow } from "./client-profile-client";

interface ClientInfo {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

async function getClientInfo(id: number): Promise<ClientInfo | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, phone, email")
    .eq("id", id)
    .maybeSingle();
  return (data as ClientInfo | null) ?? null;
}

// Approved-and-beyond only (ARCHIVE_STATUSES, imported — not redefined
// here, same reuse Uninvoiced Orders already established): this is a
// historical-record lookup, not a workflow tool, so Pending Approval /
// Pending Revision Approval / Rejected are deliberately excluded — those
// are transient states with no lasting meaning months or years later.
async function getClientOrders(clientId: number): Promise<ClientOrderRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select("id, job_order_no, status, department, type_of_print, print_type, total_amount, deposit_amount, order_date")
    .eq("client_id", clientId)
    .in("status", ARCHIVE_STATUSES)
    .order("order_date", { ascending: false });

  const rawOrders = (data ?? []) as ClientOrderRow[];

  // Same deposit-sync fix every other historical list applies (Archive,
  // Audit Log, Uninvoiced Orders) — job_orders.deposit_amount alone can
  // drift from a linked invoice's real payment total, so Balance here
  // reads through the same effective-deposit helper, not the raw column.
  const invoicePaymentSums = await getInvoicePaymentSumsByOrderNo(supabase);
  return withEffectiveDeposits(rawOrders, invoicePaymentSums);
}

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const clientId = Number(id);

  const client = Number.isFinite(clientId) ? await getClientInfo(clientId) : null;
  const orders = client ? await getClientOrders(client.id) : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-4">
        <Link
          href="/clients"
          className="flex items-center gap-1 text-sm font-semibold text-at-accent hover:underline"
        >
          <ArrowLeft size={14} /> Back to Client Search
        </Link>
      </div>

      {!client ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          Client not found. It may have been renamed or removed — go back and search again.
        </div>
      ) : (
        <ClientProfileClient client={client} orders={orders} />
      )}
    </AppShell>
  );
}
