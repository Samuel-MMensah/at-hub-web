"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, Phone, Mail } from "lucide-react";
import { matchesSearch } from "@/lib/text-search";

export interface ClientRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

// Small, bounded list (clients, not job_orders) — shows every client by
// default, narrowed live as the user types, same "browsable list +
// search narrows it" shape as Manage Archived Orders' own client-side
// picker (archive-client.tsx), not Global Search's "empty until you
// type" shape (that one guards against job_orders' much larger,
// effectively-unbounded size).
export function ClientPicker({ clients }: { clients: ClientRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => clients.filter((c) => matchesSearch(search, [c.name, c.phone, c.email])),
    [clients, search]
  );

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-at-slate-light" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients by name, phone, or email…"
          autoFocus
          className="w-full rounded-at border border-at-border bg-at-white py-2.5 pl-10 pr-4 text-sm text-at-navy outline-none focus:border-at-accent"
        />
      </div>

      <div className="mb-3 text-xs font-semibold text-at-slate">
        {filtered.length} of {clients.length} client(s)
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No clients match &quot;{search}&quot;.
        </div>
      ) : (
        <div className="overflow-hidden rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
          {filtered.map((client, i) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className={`flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-at-bg ${
                i !== filtered.length - 1 ? "border-b border-at-border" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-at-navy">{client.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-at-slate">
                  <span className="inline-flex items-center gap-1">
                    <Phone size={11} /> {client.phone || "—"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mail size={11} /> {client.email || "—"}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-at-slate-light" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
