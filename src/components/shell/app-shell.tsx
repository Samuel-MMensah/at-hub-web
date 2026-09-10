"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import type { Role } from "@/lib/nav-config";

interface AppShellProps {
  children: ReactNode;
  userName: string;
  userRole: string;
  role: Role | null;
  isSalesRep: boolean;
  // Optional, defaults to false (2026-09-01) — every existing caller
  // omits it and gets the prior behavior unchanged; only My Sales
  // Dashboard's page currently passes a real value.
  isSalesManager?: boolean;
  pendingApprovalsCount?: number;
}

export function AppShell({
  children,
  userName,
  userRole,
  role,
  isSalesRep,
  isSalesManager,
  pendingApprovalsCount,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar
        userName={userName}
        userRole={userRole}
        role={role}
        isSalesRep={isSalesRep}
        isSalesManager={isSalesManager}
        pendingApprovalsCount={pendingApprovalsCount}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile-only top bar — hidden at md+ where the sidebar is
            permanently visible and there's nothing for a hamburger to
            open. */}
        <header className="flex shrink-0 items-center gap-3 border-b border-at-border bg-at-white px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-at-navy hover:bg-slate-100"
          >
            <Menu size={20} strokeWidth={2.25} />
          </button>
          <span className="text-sm font-bold tracking-tight text-at-navy">Appointed Time</span>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
