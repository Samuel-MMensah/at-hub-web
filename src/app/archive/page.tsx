import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { NotMigrated } from "@/components/shell/not-migrated";
import { requireUser } from "@/lib/auth";

const MODULE_NAME = "Approved Orders Archive";

export default async function ArchivePage() {
  const user = await requireUser();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">{MODULE_NAME}</div>

      <NotMigrated moduleName={MODULE_NAME} />
    </AppShell>
  );
}
