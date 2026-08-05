import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import type { Role } from "@/lib/nav-config";

interface AppShellProps {
  children: ReactNode;
  userName: string;
  userRole: string;
  role: Role | null;
  isSalesRep: boolean;
  pendingApprovalsCount?: number;
}

export function AppShell({
  children,
  userName,
  userRole,
  role,
  isSalesRep,
  pendingApprovalsCount,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar
        userName={userName}
        userRole={userRole}
        role={role}
        isSalesRep={isSalesRep}
        pendingApprovalsCount={pendingApprovalsCount}
      />
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
