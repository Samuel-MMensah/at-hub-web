import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { requireUser } from "@/lib/auth";
import { RaiseOrderClient } from "./raise-order-client";

export default async function RaiseOrderPage() {
  // No role gate — matches app.py: any authenticated user (unlike
  // Authorization Center / Archive / Production Layout Builder, which
  // all check "and is_admin"). nav-config.ts's existing entry for this
  // route already has no `roles` restriction either.
  const user = await requireUser();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <RaiseOrderClient userEmail={user.email} />
    </AppShell>
  );
}
