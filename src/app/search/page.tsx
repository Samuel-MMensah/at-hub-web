import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { sanitizeSearchTerm } from "@/lib/sanitize-search-term";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { getInvoicePaymentSumsByOrderNo, withEffectiveDeposits } from "@/lib/effective-deposit";

const CURRENCY = "GH₵";

// Ports app.py's _GS_SC exactly — a deliberately separate, narrower
// color map from My Order Tracker's STATUS_MAP (e.g. this one colors
// "Pending Revision Approval" the same amber as "Pending Approval",
// where STATUS_MAP gives it its own darker shade; "At Warehouse" has
// no entry here at all, falling to the grey fallback — both match
// source exactly, not something to "fix" into consistency with the
// other map).
const SEARCH_STATUS_COLORS: Record<string, string> = {
  Approved: "#10b981",
  Rejected: "#ef4444",
  "Pending Approval": "#f59e0b",
  "Pending Revision Approval": "#f59e0b",
  "In Production": "#0369a1",
  "Ready for Collection": "#7c3aed",
  Delivered: "#64748b",
};
const FALLBACK_STATUS_COLOR = "#94a3b8";

interface SearchResultRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string | null;
  status: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  date_of_collection: string | null;
}

// Ports app.py's Global Search query (lines 5265-5336), with one
// deliberate deviation: the source OR-matches against
// `item_description`, a column that doesn't exist on job_orders
// (confirmed live — the real column is `job_description`). Confirmed
// live that PostgREST's .or() referencing a nonexistent column is a
// hard 400, not a no-op — caught by the source's bare
// `except Exception: pass`, meaning the real deployed Global Search
// silently returns zero results for every search, always. That's not
// something to faithfully reproduce (a search feature that never finds
// anything has no value), so this matches against `job_description`
// instead — the obvious real analogue, not a guess.
async function searchOrders(term: string): Promise<SearchResultRow[]> {
  const supabase = await createClient();
  const safe = sanitizeSearchTerm(term);
  if (!safe) return [];

  const { data } = await supabase
    .from("job_orders")
    .select(
      "id, job_order_no, customer_name, status, total_amount, deposit_amount, date_of_collection, department, type_of_print, print_type"
    )
    .or(
      `job_order_no.ilike.%${safe}%,customer_name.ilike.%${safe}%,job_description.ilike.%${safe}%`
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const results = (data ?? []) as SearchResultRow[];

  // Deposit-sync fix, Phase 1 (2026-08-31): deposit_amount becomes the
  // real SUM of linked invoice payment(s) for a linked order.
  const invoicePaymentSums = await getInvoicePaymentSumsByOrderNo(supabase);
  return withEffectiveDeposits(results, invoicePaymentSums);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // No role gate — matches app.py: any authenticated user.
  const user = await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const results = query ? await searchOrders(query) : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-4 flex items-center justify-between">
        <div className="text-lg font-bold text-at-navy-soft">
          🔍 Search Results{query ? ` — ${query}` : ""}
        </div>
        <Link href="/command-center" className="text-sm font-semibold text-at-accent hover:underline">
          ← Back to Command Center
        </Link>
      </div>

      {!query ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          Enter a search term in the sidebar search bar.
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-at-lg border border-at-warning bg-at-warning-bg p-6 text-sm text-at-warning-text shadow-at-sm">
          No orders found matching <strong>{query}</strong>.
        </div>
      ) : (
        <div>
          <div className="mb-3 text-sm font-bold text-at-navy">{results.length} order(s) found.</div>
          {results.length >= 100 && (
            <div className="mb-3 text-xs text-at-slate">
              Showing the top 100 matches, most recent first. Narrow your search (e.g. add more
              of the order number or customer name) to see others.
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {results.map((order) => {
              const status = order.status ?? "";
              const color = SEARCH_STATUS_COLORS[status] ?? FALLBACK_STATUS_COLOR;
              // Not clamped to >= 0 — matches source exactly (My Order
              // Tracker's balance IS clamped elsewhere; this route isn't).
              const balance = Number(order.total_amount ?? 0) - Number(order.deposit_amount ?? 0);
              const garment = isGarment(order);

              return (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded-at-lg border border-at-border bg-at-white p-5 shadow-at-sm"
                  style={{ borderLeft: `5px solid ${color}` }}
                >
                  <div>
                    <div className="text-[1.05rem] font-extrabold text-at-navy">
                      {order.job_order_no || "—"}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-600">{order.customer_name || "—"}</div>
                    <div className="mt-1 text-xs font-bold" style={{ color }}>
                      {status || "—"}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-at-navy">
                      {CURRENCY}
                      {Number(order.total_amount ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-sm font-semibold text-red-600">
                      Bal: {CURRENCY}
                      {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[0.72rem] text-at-slate-light">
                      Collect: {order.date_of_collection || "—"}
                    </div>
                    {/* Deliberate enhancement beyond source, which has no
                        PDF action on this route at all. */}
                    <div className="mt-2">
                      <PdfPreviewButton
                        orderId={order.id}
                        label={garment ? "🧵 Preview Garment PDF" : "📄 Preview PDF"}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}
