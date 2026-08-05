"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, canSeeItem, type Role } from "@/lib/nav-config";
import { logout } from "@/app/login/actions";

interface SidebarProps {
  userName: string;
  userRole: string;
  role: Role | null;
  isSalesRep: boolean;
  pendingApprovalsCount?: number;
}

export function Sidebar({
  userName,
  userRole,
  role,
  isSalesRep,
  pendingApprovalsCount = 0,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchValue, setSearchValue] = useState("");

  function submitSearch() {
    const q = searchValue.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-at-border bg-at-white">
      <div className="flex-1 overflow-y-auto px-3 py-5">
        {/* Identity card — same info the Streamlit sidebar showed, real component now */}
        <div className="mb-6 rounded-at-lg border border-at-border bg-at-bg p-4">
          <div className="text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            {userRole}
          </div>
          <div className="mt-1 break-all text-sm font-bold text-at-navy">{userName}</div>
          <div className="mt-1 text-xs font-medium text-at-accent">Connected Portal</div>
        </div>

        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => canSeeItem(item, role, isSalesRep));
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.label} className="mb-6">
              <div className="mb-2 px-2 text-[0.7rem] font-bold uppercase tracking-wider text-at-slate">
                {group.label}
              </div>
              <nav className="flex flex-col gap-0.5">
                {visibleItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  const badgeCount =
                    item.badgeKey === "pendingApprovals" ? pendingApprovalsCount : 0;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all",
                        isActive
                          ? "bg-at-navy text-at-white"
                          : "text-slate-600 hover:translate-x-1 hover:bg-slate-100 hover:text-at-navy"
                      )}
                    >
                      <Icon
                        size={17}
                        strokeWidth={2.25}
                        className={cn(isActive ? "text-at-white" : "text-at-slate")}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {badgeCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-at-danger px-1.5 text-[0.65rem] font-extrabold text-at-white">
                          {badgeCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          );
        })}

        {/* Global search — same purpose as the sidebar text_input in
            app.py, wired to the real /search route. Fires on Enter, not
            per keystroke — a search per character would mean a page
            navigation per character. */}
        <div className="mb-6">
          <div className="mb-2 px-2 text-[0.7rem] font-bold uppercase tracking-wider text-at-slate">
            Global Search
          </div>
          <div className="flex items-center gap-2 rounded-at border border-at-border bg-at-bg px-3 py-2">
            <Search size={15} className="text-at-slate-light" />
            <input
              type="text"
              placeholder="Order No · Customer…"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch();
              }}
              className="w-full bg-transparent text-sm outline-none placeholder:text-at-slate-light"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-at-border p-3">
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-at-danger px-3 py-2.5 text-sm font-bold text-at-white transition-colors hover:bg-red-600"
          >
            <LogOut size={15} />
            Logout
          </button>
        </form>
        <div className="mt-4 text-center text-[0.7rem] tracking-wide text-at-slate-light">
          Version Aleph — Web
        </div>
      </div>
    </aside>
  );
}
