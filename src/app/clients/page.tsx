import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ClientPicker, type ClientRow } from "./client-picker";

// clients is a small table (141 rows as of this task) — fetched whole,
// filtered client-side as the user types, same "small dataset -> fetch
// all, filter in JS" convention this codebase already uses elsewhere
// (Uninvoiced Orders, Manage Archived Orders' own client-side order
// picker in archive-client.tsx). No per-keystroke round trip.
async function getClients(): Promise<ClientRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, phone, email")
    .order("name", { ascending: true });
  return (data ?? []) as ClientRow[];
}

export default async function ClientsPage() {
  // No role gate — same "any authenticated user" access as Global
  // Search (this is the same "find something" category of tool), and
  // matches clients' own RLS SELECT policy.
  const user = await requireUser();
  const clients = await getClients();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Client Profile</div>
      <div className="mb-6 text-sm text-at-slate">
        Look up a client to see their full confirmed order history — every Approved-and-beyond
        order they&apos;ve ever had, with one-click PDF access. This is a historical record, not a
        workflow tool: pending and rejected orders don&apos;t appear here.
      </div>

      <ClientPicker clients={clients} />
    </AppShell>
  );
}
