"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Factory,
  Warehouse,
  PackageCheck,
  Shirt,
  Printer,
  FileText,
  Package,
  Truck,
  Calendar,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { parseLifecycleTimestamp } from "@/lib/lifecycle-timestamp";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { StatusBadge } from "@/components/ui/status-badge";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";

const CURRENCY = "GH₵";

export interface JobOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  job_description: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  qty_to_print: number;
  delivery_mode: string | null;
  date_of_collection: string | null;
  balance_due_date: string | null;
  created_by: string;
  created_at: string | null;
  status: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_date: string | null;
  parent_group_id: string | null;
  rejection_note: string | null;
  is_sample: boolean;
  sample_reason: string | null;
}

export interface JobRow {
  job_order_no: string | null;
  machine: string;
  finish_time: string;
  revised_finish: string | null;
}

const STATUS_OPTIONS = [
  "Pending Approval",
  "Pending Revision Approval",
  "Approved",
  "In Production",
  "At Warehouse",
  "Delivered",
  "Rejected",
];

const PENDING_STATUSES = ["Pending Approval", "Pending Revision Approval"];

// Ports _status_map from my_order_tracker.py exactly — colors and labels
// must match the original 1:1. `icon` is a 2026-08-31 addition (Lucide,
// replacing an emoji prefix baked into `label` itself) — the label text
// is otherwise unchanged.
const STATUS_MAP: Record<string, { color: string; bg: string; label: string; icon?: LucideIcon }> = {
  Approved: { color: "#10b981", bg: "#d1fae5", label: "APPROVED", icon: CheckCircle2 },
  Rejected: { color: "#ef4444", bg: "#fee2e2", label: "REJECTED", icon: XCircle },
  "Pending Approval": { color: "#f59e0b", bg: "#fef3c7", label: "PENDING APPROVAL", icon: Clock },
  "Pending Revision Approval": {
    color: "#d97706",
    bg: "#fffbeb",
    label: "PENDING RE-APPROVAL",
    icon: AlertTriangle,
  },
  "In Production": { color: "#0369a1", bg: "#e0f2fe", label: "IN PRODUCTION", icon: Factory },
  "At Warehouse": { color: "#4f46e5", bg: "#eef2ff", label: "AT WAREHOUSE", icon: Warehouse },
  Delivered: { color: "#059669", bg: "#d1fae5", label: "DELIVERED", icon: PackageCheck },
};

function statusStyle(status: string) {
  return STATUS_MAP[status] ?? { color: "#64748b", bg: "#f1f5f9", label: status.toUpperCase() };
}

// Tight "GH₵1,234.00" — app-wide standard (MIGRATION_STATUS.md's UI
// Conventions, rule 3). This file originally split money formatting into
// moneyTight (KPI cards) and moneySpaced (order tiles/batch header/
// approved-tab summary) to match two distinct f-string conventions in
// the source; consolidated to one tight function everywhere, 2026-08-31.
function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function groupKey(row: JobOrderRow): string {
  const raw = (row.parent_group_id ?? "").trim();
  const isEmpty = !raw || raw.toLowerCase() === "nan" || raw.toLowerCase() === "none";
  return isEmpty ? `SOLO_${row.id}` : raw;
}

interface PipelineSummary {
  currentMachine: string | null;
  nextMachine: string | null;
  eta: Date | null;
  allDone: boolean;
}

// Ports _pipeline_summary() from app.py.
function pipelineSummary(orderNo: string, jobs: JobRow[]): PipelineSummary | null {
  const rows = jobs.filter((job) => job.job_order_no === orderNo);
  if (rows.length === 0) return null;

  const withFinish = rows.map((job) => {
    const revised = job.revised_finish ? parseTimestamptz(job.revised_finish) : null;
    const finish =
      revised && !Number.isNaN(revised.getTime()) ? revised : parseTimestamptz(job.finish_time);
    return { ...job, _finish: finish };
  });

  const now = Date.now();
  const pending = withFinish
    .filter((job) => job._finish.getTime() >= now)
    .sort((a, b) => a._finish.getTime() - b._finish.getTime());

  const current = pending[0] ?? null;
  const upcoming = pending[1] ?? null;

  const eta = withFinish.reduce<Date | null>((max, job) => {
    if (!max || job._finish.getTime() > max.getTime()) return job._finish;
    return max;
  }, null);

  return {
    currentMachine: current?.machine ?? null,
    nextMachine: upcoming?.machine ?? null,
    eta,
    allDone: pending.length === 0,
  };
}

function formatEta(eta: Date | null): string {
  if (!eta || Number.isNaN(eta.getTime())) return "—";
  return eta.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type TabKey = "all" | "pending" | "approved" | "rejected";

interface OrderTrackerClientProps {
  orders: JobOrderRow[];
  jobs: JobRow[];
}

export function OrderTrackerClient({ orders, jobs }: OrderTrackerClientProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const totalRaised = orders.length;
  const awaitingDecision = orders.filter((o) => o.status && PENDING_STATUSES.includes(o.status)).length;
  const approvedCount = orders.filter((o) => o.status === "Approved").length;
  const rejectedCount = orders.filter((o) => o.status === "Rejected").length;
  const totalContractValue = orders.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0);

  const approvalRate = (approvedCount / Math.max(totalRaised, 1)) * 100;
  const avgOrderValue = totalRaised > 0 ? totalContractValue / totalRaised : 0;

  // Reads approval_date, not approved_at: confirmed live (both against
  // real historical rows and a fresh test approval through Authorization
  // Center) that approved_at is never populated by any write path — it's
  // approval_date that actually carries the approval timestamp, as a
  // lifecycle-style TEXT column rather than a native timestamptz.
  const avgDaysToApproval = useMemo(() => {
    const durations = orders
      .filter((o) => o.status === "Approved" && o.approval_date && o.created_at)
      .map((o) => {
        const approvedAt = parseLifecycleTimestamp(o.approval_date as string).getTime();
        const createdAt = new Date(o.created_at as string).getTime();
        return (approvedAt - createdAt) / 86_400_000;
      })
      .filter((days) => Number.isFinite(days));
    if (durations.length === 0) return null;
    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter.length > 0 && (!order.status || !statusFilter.includes(order.status))) {
        return false;
      }
      if (!q) return true;
      const haystack = [order.customer_name, order.job_order_no, order.job_description]
        .map((v) => (v ?? "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [orders, search, statusFilter]);

  // Month grouping (inside OrderTab, per tab) happens AFTER this
  // filtering — every tab's list is already the fully-matching set, so
  // any month that ends up with content only ever contains matches.
  // isFiltering drives CollapsibleMonthGroup's auto-expand: while a
  // search/filter is active, every non-empty month is forced open so a
  // match can never end up hidden inside a collapsed section.
  const isFiltering = search.trim() !== "" || statusFilter.length > 0;

  const pendingOrders = filtered.filter((o) => o.status && PENDING_STATUSES.includes(o.status));
  const approvedOrders = filtered.filter((o) => o.status === "Approved");
  const rejectedOrders = filtered.filter((o) => o.status === "Rejected");

  const pipelineTotal = approvedOrders.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0);
  const pipelineDeposit = approvedOrders.reduce((sum, o) => sum + Number(o.deposit_amount ?? 0), 0);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "All Orders", count: filtered.length },
    { key: "pending", label: "Pending", count: pendingOrders.length },
    { key: "approved", label: "Approved", count: approvedOrders.length },
    { key: "rejected", label: "Rejected", count: rejectedOrders.length },
  ];

  function toggleStatus(status: string) {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total Raised" value={totalRaised} />
        <MetricCard
          label="Awaiting Decision"
          value={awaitingDecision}
          borderColor="#f59e0b"
          accentColor="#d97706"
        />
        <MetricCard label="Approved" value={approvedCount} borderColor="#10b981" accentColor="#059669" />
        <MetricCard
          label="Rejected / Returned"
          value={rejectedCount}
          borderColor="#ef4444"
          accentColor="#dc2626"
        />
        <MetricCard
          label="Total Contract Value"
          value={money(totalContractValue)}
          accentColor="#0369a1"
          valueClassName="text-[1.35rem]"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="My Approval Rate"
          value={`${approvalRate.toFixed(0)}%`}
          accentColor={approvalRate >= 80 ? "#10b981" : approvalRate >= 50 ? "#f59e0b" : "#ef4444"}
          valueClassName="text-[1.6rem]"
        />
        <MetricCard
          label="My Avg Order Value"
          value={money(avgOrderValue)}
          valueClassName="text-[1.35rem]"
        />
        <MetricCard
          label="Avg Days to Approval"
          value={avgDaysToApproval !== null ? `${avgDaysToApproval.toFixed(1)} days` : "—"}
          valueClassName="text-[1.6rem]"
        />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Customer · Order No · Description…"
          className="w-full rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => {
            const active = statusFilter.includes(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "border-at-navy bg-at-navy text-at-white"
                    : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
                }`}
              >
                {status}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 && (search.trim() || statusFilter.length > 0) && (
        <div className="mt-4 rounded-at-lg border border-at-border bg-at-white p-4 text-sm text-at-slate shadow-at-sm">
          No orders match your search or filter — clear the fields above to see all orders.
        </div>
      )}

      <div className="mt-6 flex gap-1 border-b border-at-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-bold transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-at-navy text-at-navy"
                : "text-at-slate hover:text-at-navy"
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === "all" && <OrderTab orders={filtered} jobs={jobs} isFiltering={isFiltering} />}

        {activeTab === "pending" && (
          <>
            <OrderTab orders={pendingOrders} jobs={jobs} isFiltering={isFiltering} />
            {pendingOrders.length > 0 && (
              <div className="mt-2 rounded-at border border-at-warning bg-at-warning-bg p-4">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-at-warning-text">
                  ℹ️ Awaiting Management Decision
                </div>
                <div className="text-sm text-at-warning-text">
                  These orders are currently in the authorization queue. You will see them move
                  to Approved or Rejected once management reviews them in the Authorization
                  Center.
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "approved" && (
          <>
            <OrderTab orders={approvedOrders} jobs={jobs} isFiltering={isFiltering} />
            {approvedOrders.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-8 rounded-at bg-gradient-to-br from-at-navy to-at-navy-soft p-4 text-at-white">
                <div>
                  <div className="mb-0.5 text-[0.6rem] uppercase tracking-wide text-slate-400">
                    Approved Orders
                  </div>
                  <div className="text-lg font-extrabold">{approvedOrders.length}</div>
                </div>
                <div>
                  <div className="mb-0.5 text-[0.6rem] uppercase tracking-wide text-slate-400">
                    Total Contract Value
                  </div>
                  <div className="text-lg font-extrabold text-emerald-400">
                    {money(pipelineTotal)}
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 text-[0.6rem] uppercase tracking-wide text-slate-400">
                    Deposits Collected
                  </div>
                  <div className="text-lg font-extrabold text-sky-300">
                    {money(pipelineDeposit)}
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 text-[0.6rem] uppercase tracking-wide text-slate-400">
                    Outstanding Balance
                  </div>
                  <div className="text-lg font-extrabold text-red-300">
                    {money(pipelineTotal - pipelineDeposit)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "rejected" && (
          <>
            <OrderTab orders={rejectedOrders} jobs={jobs} isFiltering={isFiltering} />
            {rejectedOrders.length > 0 && (
              <div className="mt-2 rounded-at border border-red-200 bg-red-50 p-4">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-red-800">
                  Next Steps for Rejected Orders
                </div>
                <div className="text-sm leading-relaxed text-red-900">
                  Rejected orders can be corrected and resubmitted through Raise Job Order — the
                  revised order re-enters the authorization queue automatically. Click
                  &quot;Modify &amp; Resubmit&quot; on the order below to get started.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface BatchGroup {
  key: string;
  orders: JobOrderRow[];
  // The batch's own created_at is the earliest of its line items' — in
  // practice every item in a real batch shares (near-)identical
  // created_at, since submitBatch() does one bulk insert, not a
  // per-item loop. Using the minimum is the deterministic choice for
  // the rare case that isn't exactly true, and it guarantees a batch is
  // never split across two month sections regardless of any drift.
  // null only if every item in the batch has a null created_at.
  representativeDate: Date | null;
}

function computeBatches(orders: JobOrderRow[]): BatchGroup[] {
  const sorted = [...orders].sort((a, b) => {
    const at = a.created_at ? parseTimestamptz(a.created_at).getTime() : 0;
    const bt = b.created_at ? parseTimestamptz(b.created_at).getTime() : 0;
    return bt - at;
  });

  const map = new Map<string, JobOrderRow[]>();
  for (const order of sorted) {
    const key = groupKey(order);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(order);
  }

  return Array.from(map.entries()).map(([key, group]) => {
    const times = group
      .map((o) => (o.created_at ? parseTimestamptz(o.created_at).getTime() : null))
      .filter((t): t is number => t !== null);
    return {
      key,
      orders: group,
      representativeDate: times.length > 0 ? new Date(Math.min(...times)) : null,
    };
  });
}

function OrderTab({
  orders,
  jobs,
  isFiltering,
}: {
  orders: JobOrderRow[];
  jobs: JobRow[];
  isFiltering: boolean;
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
        No orders in this category.
      </div>
    );
  }

  const batches = computeBatches(orders);
  // created_at is confirmed live to be populated on every real row
  // (checked directly against Supabase) — this fallback bucket exists
  // only so a genuinely unexpected null doesn't crash the page.
  const withDate = batches.filter((b) => b.representativeDate !== null);
  const withoutDate = batches.filter((b) => b.representativeDate === null);
  const monthGroups: MonthGroup<BatchGroup>[] = groupByMonth(
    withDate,
    (b) => b.representativeDate as Date
  );
  if (withoutDate.length > 0) {
    monthGroups.push({ key: "", label: "Unknown Date", items: withoutDate });
  }

  const currentKey = currentMonthKey();

  return (
    <div>
      {monthGroups.map((month) => (
        <CollapsibleMonthGroup
          key={month.key}
          monthLabel={month.label}
          itemCount={month.items.reduce((sum, batch) => sum + batch.orders.length, 0)}
          defaultExpanded={month.key === currentKey || isFiltering}
        >
          {month.items.map((batch, idx) => (
            <div key={batch.key}>
              <BatchBlock batch={batch} jobs={jobs} />
              {idx !== month.items.length - 1 && (
                <hr className="my-5 border-t-2 border-slate-100" />
              )}
            </div>
          ))}
        </CollapsibleMonthGroup>
      ))}
    </div>
  );
}

function BatchBlock({ batch, jobs }: { batch: BatchGroup; jobs: JobRow[] }) {
  const { key, orders: group } = batch;
  const isMulti = group.length > 1;

  return (
    <div>
      {isMulti && (
        <div className="mb-3 mt-2 flex items-center justify-between rounded-at-lg border border-at-border bg-gradient-to-br from-at-bg to-slate-100 p-4">
          <div>
            <div className="mb-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-at-slate">
              Batch Submission — {group.length} Line Items
            </div>
            <div className="text-lg font-extrabold text-at-navy">
              {group[0].customer_name || "—"}
            </div>
            <div className="mt-0.5 text-xs text-at-slate">
              Ref:{" "}
              <span className="text-at-accent">
                {key.startsWith("SOLO_") ? "Individual Submission" : key}
              </span>
              {" · "}Status:{" "}
              <strong>
                {Array.from(new Set(group.map((o) => (o.status ?? "").trim())))
                  .sort()
                  .join(", ")}
              </strong>
            </div>
          </div>
          <div className="text-right">
            <div className="mb-0.5 text-[0.62rem] uppercase tracking-wide text-at-slate-light">
              Batch Value
            </div>
            <div className="text-lg font-extrabold text-at-success">
              {money(group.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0))}
            </div>
          </div>
        </div>
      )}

      {group.map((order, itemIdx) => (
        <div key={order.id}>
          {isMulti && (
            <div className="mb-1.5 pl-1 text-[0.68rem] font-bold uppercase tracking-wide text-at-slate">
              Line Item {itemIdx + 1} of {group.length}
              {order.status?.trim() === "Pending Revision Approval" && (
                <span className="ml-2 rounded bg-at-warning-bg px-1.5 py-0.5 text-[0.6rem] font-bold text-at-warning-text">
                  REVISED
                </span>
              )}
            </div>
          )}
          <OrderCard order={order} jobs={jobs} />
        </div>
      ))}
    </div>
  );
}

function OrderCard({ order, jobs }: { order: JobOrderRow; jobs: JobRow[] }) {
  const orderNo = order.job_order_no || "PENDING";
  const customer = order.customer_name || "—";
  const desc = order.job_description || "—";
  const status = (order.status || "—").trim();
  const total = Number(order.total_amount ?? 0);
  const deposit = Number(order.deposit_amount ?? 0);
  const balance = total - deposit;
  const qty = order.qty_to_print ?? 0;
  const typePrint = order.type_of_print || "—";
  const collection = order.date_of_collection || "—";
  const approvedBy = order.approved_by || "—";
  const rejNote = order.rejection_note || "";
  const pgid = order.parent_group_id || "";
  const delivery = order.delivery_mode || "—";
  const balDue = order.balance_due_date || "—";
  const isRevised = status === "Pending Revision Approval";
  const garment = isGarment(order);

  const { color, bg, label, icon: StatusIcon } = statusStyle(status);
  const descShort = desc.length > 90 ? `${desc.slice(0, 90)}…` : desc;

  return (
    <div
      className="mb-4 rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm"
      style={{ borderLeft: `5px solid ${color}` }}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="mb-0.5 flex items-center gap-1 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            Job Order No
            {pgid && (
              <span className="ml-1 inline-block rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[0.65rem] font-bold text-at-accent">
                BATCH
              </span>
            )}
            <span
              className={`ml-1 inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[0.65rem] font-bold ${
                garment
                  ? "border-amber-200 bg-amber-100 text-amber-800"
                  : "border-sky-200 bg-sky-100 text-at-accent"
              }`}
            >
              {garment ? (
                <>
                  <Shirt size={11} /> GARMENT
                </>
              ) : (
                <>
                  <Printer size={11} /> PRESS
                </>
              )}
            </span>
          </div>
          <div className="text-[1.35rem] font-extrabold tracking-tight text-at-accent">{orderNo}</div>
          <div className="mt-0.5 text-sm font-semibold text-slate-600">{customer}</div>
        </div>
        <div className="flex items-center gap-2">
          {order.is_sample && (
            <StatusBadge label="SAMPLE" tone="sample" title={order.sample_reason ?? undefined} />
          )}
          <div
            className="inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-bold tracking-wide"
            style={{ color, backgroundColor: bg, borderColor: `${color}33` }}
          >
            {StatusIcon && <StatusIcon size={13} />}
            {label}
          </div>
        </div>
      </div>

      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-at-slate">
        Item Description
      </div>
      <div className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
        {descShort}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <InfoTile label="Contract Value" value={money(total)} />
        <InfoTile label="Deposit Paid" value={money(deposit)} valueColor="#059669" />
        <InfoTile
          label="Balance Outstanding"
          value={money(balance)}
          valueColor={balance > 0 ? "#ef4444" : "#10b981"}
        />
        <InfoTile label="Print Qty" value={qty.toLocaleString()} />
      </div>

      <div className="mb-3 flex flex-wrap gap-6 text-sm text-at-slate">
        <span className="inline-flex items-center gap-1">
          <Package size={14} /> <strong>{typePrint}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <Truck size={14} /> <strong>{delivery}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <Calendar size={14} /> Collection: <strong className="text-at-accent">{collection}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock size={14} /> Balance Deadline: <strong>{balDue}</strong>
        </span>
      </div>

      {status === "Approved" && approvedBy !== "—" && (
        <div className="mb-4 rounded-at border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <CheckCircle2 size={13} /> Authorized By
          </span>
          <span className="ml-3 text-sm font-semibold text-emerald-950">{approvedBy}</span>
        </div>
      )}

      {status === "Rejected" && rejNote && (
        <div className="mb-4 rounded-at border border-red-200 bg-red-50 px-4 py-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-red-800">
            Management Rejection Note
          </div>
          <div className="text-sm leading-relaxed text-red-900">{rejNote}</div>
        </div>
      )}

      {status === "Rejected" && (
        <div className="mb-4 flex justify-end">
          <Link
            href={`/raise-order?resubmit=${order.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-at-danger px-4 py-2.5 text-sm font-bold text-at-white transition-colors hover:bg-red-600"
          >
            <RefreshCw size={15} /> Modify &amp; Resubmit
          </Link>
        </div>
      )}

      {isRevised && (
        <div className="mb-4 flex items-start gap-1.5 rounded-at border border-at-warning bg-at-warning-bg px-4 py-2.5 text-sm text-at-warning-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong>Revised Contract:</strong> This order was edited after initial approval and is
            now awaiting fresh management sign-off. No action is required from you at this stage.
          </span>
        </div>
      )}

      {status === "At Warehouse" && (
        <div className="mb-4 rounded-at border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-indigo-700">
            <Warehouse size={13} /> At Warehouse — Awaiting Dispatch
          </div>
        </div>
      )}

      {status === "In Production" && <PipelineBanner orderNo={orderNo} jobs={jobs} />}

      <div className="flex justify-end">
        <PdfPreviewButton
          orderId={order.id}
          label={
            garment ? (
              <>
                <Shirt size={14} /> Preview Garment PDF
              </>
            ) : (
              <>
                <FileText size={14} /> Preview PDF
              </>
            )
          }
        />
      </div>
    </div>
  );
}

function InfoTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg border border-at-border bg-at-bg px-3.5 py-2.5">
      <div className="mb-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-at-slate-light">
        {label}
      </div>
      <div
        className="text-sm font-extrabold text-at-navy"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function PipelineBanner({ orderNo, jobs }: { orderNo: string; jobs: JobRow[] }) {
  const pipeline = pipelineSummary(orderNo, jobs);

  if (pipeline && !pipeline.allDone) {
    return (
      <div className="mb-4 rounded-at border border-sky-200 bg-sky-50 px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-at-accent">
          <Factory size={13} /> In Production
        </div>
        <div className="text-sm text-sky-950">
          Current stage: <strong>{pipeline.currentMachine}</strong>
          {pipeline.nextMachine && (
            <>
              {" "}
              · Next: <strong>{pipeline.nextMachine}</strong>
            </>
          )}{" "}
          · Est. completion: <strong>{formatEta(pipeline.eta)}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-1.5 rounded-at border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
      <Factory size={15} /> In production — detailed schedule not available for this order yet.
    </div>
  );
}
