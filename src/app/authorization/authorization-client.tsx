"use client";

import { useMemo, useState, useTransition } from "react";
import { Shirt, Printer, AlertTriangle, ClipboardList, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { approveOrder, rejectOrder } from "./actions";

const CURRENCY = "GH₵";
const GROUPS_PER_PAGE = 40;

export interface PendingOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string | null;
  telephone_number: string | null;
  parent_group_id: string | null;
  status: string | null;
  is_sample: boolean;
  sample_reason: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  created_by: string | null;
  delivery_mode: string | null;
  date_of_collection: string | null;
  type_of_print: string | null;
  material_source: string | null;
  qty_to_print: number | null;
  print_type: string | null;
  yardage: string | null;
  print_size: string | null;
  finished_print_size: string | null;
  process_info: string | null;
  packaging_mode: string | null;
  paper_type: string | null;
  gsm: string | null;
  paper_size: string | null;
  paper_colour: string | null;
  impressions_colour: string | null;
  binding_type: string | null;
  laminating_type: string | null;
  job_description: string | null;
  created_at: string | null;
}

// Tight "GH₵1,234.00" — app-wide standard (MIGRATION_STATUS.md's UI
// Conventions, rule 3), migrated 2026-08-31 from this file's original
// spaced "GH₵ 1,234.00" convention.
function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Matches Raise Job Order's and Production Layout's own local SectionHeader
// byte-for-byte (2026-08-31) — same in-card form-section-group role as
// theirs, previously hand-rolled here at a smaller size/different color
// (text-[0.7rem] text-at-slate) with no top-margin rule. Kept as a separate
// per-file copy rather than a shared component, matching this codebase's
// existing convention for small presentational helpers (money/groupKey
// above are the same pattern) — the fix here is visual consistency, not
// deduplication.
function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-at-navy first:mt-0">{children}</div>;
}

// Same grouping convention as My Order Tracker's local groupKey — kept as
// a separate copy since the Python source doesn't factor this into a
// shared helper either.
function groupKey(row: PendingOrderRow): string {
  const raw = (row.parent_group_id ?? "").trim();
  const isEmpty = !raw || raw.toLowerCase() === "nan" || raw.toLowerCase() === "none";
  return isEmpty ? `SOLO_${row.id}` : raw;
}

interface AuthorizationClientProps {
  orders: PendingOrderRow[];
}

export function AuthorizationClient({ orders }: AuthorizationClientProps) {
  const [search, setSearch] = useState("");
  const [showPending, setShowPending] = useState(true);
  const [showRevision, setShowRevision] = useState(true);
  const [page, setPage] = useState(0);

  const statusFilter = useMemo(() => {
    const f: string[] = [];
    if (showPending) f.push("Pending Approval");
    if (showRevision) f.push("Pending Revision Approval");
    return f;
  }, [showPending, showRevision]);

  const filtered = useMemo(() => {
    let rows = orders;
    // Matches the source: an empty filter (both checkboxes off) means "no
    // status restriction applied" — it does NOT mean "show nothing".
    if (statusFilter.length > 0) {
      rows = rows.filter((o) => o.status && statusFilter.includes(o.status));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((o) => {
        const haystack = [o.customer_name, o.job_order_no, o.parent_group_id]
          .map((v) => (v ?? "").toLowerCase())
          .join(" ");
        return haystack.includes(q);
      });
    }
    return rows;
  }, [orders, statusFilter, search]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return at - bt; // ascending — matches fetch_pending_orders_cached's sort_values
      }),
    [filtered]
  );

  const groupKeys = useMemo(() => {
    const seen: string[] = [];
    for (const row of sorted) {
      const key = groupKey(row);
      if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [sorted]);

  const totalPages = Math.max(1, Math.ceil(groupKeys.length / GROUPS_PER_PAGE));
  const currentPage = page >= totalPages ? 0 : page;
  const pageGroups = groupKeys.slice(
    currentPage * GROUPS_PER_PAGE,
    currentPage * GROUPS_PER_PAGE + GROUPS_PER_PAGE
  );

  function goPrev() {
    setPage((p) => Math.max(0, p - 1));
  }
  function goNext() {
    setPage((p) => Math.min(totalPages - 1, p + 1));
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
        No pending orders yet.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[3fr_2fr]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Customer Name · Order No · Batch Ref…"
          className="w-full rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <div>
          <div className="mb-1 text-[0.7rem] text-at-slate">Filter by status</div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-at-slate">
              <input
                type="checkbox"
                checked={showPending}
                onChange={(e) => setShowPending(e.target.checked)}
              />
              Pending Approval
            </label>
            <label className="flex items-center gap-2 text-sm text-at-slate">
              <input
                type="checkbox"
                checked={showRevision}
                onChange={(e) => setShowRevision(e.target.checked)}
              />
              Pending Revision
            </label>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No orders match your search or filter.
        </div>
      ) : (
        <>
          <PaginationBar
            page={currentPage}
            totalPages={totalPages}
            totalGroups={groupKeys.length}
            onPrev={goPrev}
            onNext={goNext}
          />

          <div className="mt-3">
            {pageGroups.map((key, idx) => (
              <div key={key}>
                <GroupCard group={sorted.filter((o) => groupKey(o) === key)} groupKey={key} />
                {idx !== pageGroups.length - 1 && <hr className="my-7 border-t-2 border-slate-100" />}
              </div>
            ))}
          </div>

          <div className="mt-4">
            <PaginationBar
              page={currentPage}
              totalPages={totalPages}
              totalGroups={groupKeys.length}
              onPrev={goPrev}
              onNext={goNext}
              showCount={false}
            />
          </div>
        </>
      )}
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  totalGroups,
  onPrev,
  onNext,
  showCount = true,
}: {
  page: number;
  totalPages: number;
  totalGroups: number;
  onPrev: () => void;
  onNext: () => void;
  showCount?: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-4">
      <Button variant="secondary" size="sm" onClick={onPrev} disabled={page === 0}>
        <ChevronLeft size={14} /> Prev
      </Button>
      <div className="text-sm text-at-slate">
        Page <strong className="text-at-navy">{page + 1}</strong> / {totalPages}
        {showCount && (
          <>
            {" "}
            &nbsp;·&nbsp; <strong className="text-at-navy">{totalGroups}</strong> group(s)
          </>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={onNext} disabled={page >= totalPages - 1}>
        Next <ChevronRight size={14} />
      </Button>
    </div>
  );
}

function GroupCard({ group, groupKey: gk }: { group: PendingOrderRow[]; groupKey: string }) {
  const first = group[0];
  const customer = first.customer_name || "—";
  const telephone = first.telephone_number || "—";
  const isSolo = gk.startsWith("SOLO_");
  // Matches the source exactly: a group counts as "multi" if it has more
  // than one surviving row OR its key isn't a solo key — even a single
  // remaining row from a larger batch (the rest already actioned) still
  // gets the multi-item badge treatment.
  const isMulti = group.length > 1 || !isSolo;
  const hasRevision = group.some((o) => (o.status ?? "").trim() === "Pending Revision Approval");
  const batchRef = isSolo ? "Individual Submission" : gk;
  const totalValue = group.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0);
  const hasGarment = group.some((o) => isGarment(o));
  const allGarment = group.every((o) => isGarment(o));
  const deptLabel = hasGarment && !allGarment ? "GARMENT" : hasGarment ? "GARMENT DEPT" : "PRESS DEPT";
  const DeptIcon = hasGarment ? Shirt : Printer;
  const itemCount = group.length;
  const badge = isMulti ? `${itemCount} LINE ITEM(S)` : "INDIVIDUAL ORDER";

  return (
    <div className="mt-4">
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl bg-at-navy px-6 py-5 text-at-white sm:flex-row sm:items-center">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-1 text-[0.65rem] font-bold uppercase tracking-wide text-slate-400">
            <span>CLIENT SUBMISSION — {badge} —</span>
            <span className="inline-flex items-center gap-0.5">
              <DeptIcon size={11} /> {deptLabel}
            </span>
            {hasRevision && (
              <span className="inline-flex items-center gap-0.5 text-at-warning">
                <AlertTriangle size={11} /> REVISED
              </span>
            )}
          </div>
          <div className="text-[1.35rem] font-extrabold tracking-tight">{customer}</div>
          <div className="mt-0.5 text-sm text-slate-400">
            Tel: {telephone} &nbsp;·&nbsp; Batch Ref: <span className="text-sky-400">{batchRef}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1 text-[0.62rem] uppercase tracking-wide text-slate-400">
            Combined Contract Value
          </div>
          <div className="text-[1.35rem] font-extrabold text-emerald-400">{money(totalValue)}</div>
        </div>
      </div>

      {hasRevision && (
        <div className="mt-2 flex gap-3 rounded-at-lg border-2 border-l-[6px] border-at-warning bg-at-warning-bg px-5 py-3.5">
          <AlertTriangle size={26} className="shrink-0 text-at-warning-text" />
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-at-warning-text">
              Attention: Revised Contract
            </div>
            <div className="text-sm leading-relaxed text-at-warning-text">
              One or more line items in this submission were previously Approved and have since
              been modified by an administrator. Original Job Order references and Batch tracking
              IDs are preserved. Please review all amended specifications carefully before
              re-authorizing.
            </div>
          </div>
        </div>
      )}

      <div className="mt-2">
        <CollapsibleMonthGroup
          monthLabel={
            <span className="inline-flex items-center gap-1">
              <ClipboardList size={14} /> {customer}
              {hasRevision && (
                <span className="inline-flex items-center gap-0.5 text-at-warning-text">
                  · <AlertTriangle size={12} /> includes REVISED items
                </span>
              )}
            </span>
          }
          itemCount={itemCount}
          itemLabel="line item(s)"
          defaultExpanded={false}
        >
          <div className="flex flex-col gap-4">
            {group.map((order, i) => (
              <LineItemCard
                key={order.id}
                order={order}
                position={i + 1}
                total={itemCount}
                isMulti={isMulti}
              />
            ))}
          </div>
        </CollapsibleMonthGroup>
      </div>
    </div>
  );
}

function LineItemCard({
  order,
  position,
  total,
  isMulti,
}: {
  order: PendingOrderRow;
  position: number;
  total: number;
  isMulti: boolean;
}) {
  const totalAmt = Number(order.total_amount ?? 0);
  const deposit = Number(order.deposit_amount ?? 0);
  const outstanding = totalAmt - deposit; // not clamped — matches the source
  const customer = order.customer_name || "—";
  const orderNo = order.job_order_no || "PENDING";
  const description = order.job_description || "—";
  const createdBy = order.created_by || "—";
  const delivery = order.delivery_mode || "—";
  const collection = order.date_of_collection || "—";
  const typePrint = order.type_of_print || "—";
  const materialSource = order.material_source || "—";
  const qty = order.qty_to_print ?? 0;
  const status = (order.status || "").trim();
  const isRevised = status === "Pending Revision Approval";
  const garment = isGarment(order);
  const balColor = outstanding > 0 ? "#ef4444" : "#10b981";
  const balLabel = outstanding > 0 ? "Outstanding Debt Balance" : "Fully Settled";

  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveOrder(order.id);
      if (result.error) setError(result.error);
    });
  }

  function handleReject() {
    setError(null);
    if (!note.trim()) {
      setError("Please provide a rejection rationale before submitting.");
      return;
    }
    startTransition(async () => {
      const result = await rejectOrder(order.id, note);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div
      className="rounded-xl bg-at-white p-6 shadow-at-sm sm:p-8"
      style={{ borderLeft: isRevised ? "4px solid #f59e0b" : "1px solid #e2e8f0" }}
    >
      {isMulti && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.68rem] font-bold uppercase tracking-wide text-at-slate">
          LINE ITEM {position} OF {total}
          {isRevised && (
            <span className="rounded border border-at-warning bg-at-warning-bg px-1.5 py-0.5 text-[0.6rem] font-bold text-at-warning-text">
              REVISED
            </span>
          )}
          <span
            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[0.6rem] font-bold ${
              garment ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-at-accent"
            }`}
          >
            {garment ? (
              <>
                <Shirt size={10} /> GARMENT
              </>
            ) : (
              <>
                <Printer size={10} /> PRESS
              </>
            )}
          </span>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 border-b-2 border-at-navy pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate-light">
            Pending Authorization
            {order.is_sample && (
              <StatusBadge label="SAMPLE" tone="sample" title={order.sample_reason ?? undefined} />
            )}
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-at-navy">{customer}</div>
          <div className="mt-0.5 text-sm font-semibold text-at-slate">
            Order Ref: <span className="text-at-accent">{orderNo}</span>
          </div>
        </div>
        <div className="sm:text-right">
          <div className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate-light">
            Print Category
          </div>
          <div className="inline-block rounded-lg border border-at-border bg-at-bg px-3 py-1.5 text-sm font-bold text-at-navy">
            {typePrint}
          </div>
          <div
            className={`mt-1.5 flex w-fit items-center gap-1 rounded-lg border px-3 py-1 text-xs font-bold sm:ml-auto ${
              garment
                ? "border-amber-200 bg-amber-100 text-amber-800"
                : "border-sky-200 bg-sky-100 text-at-accent"
            }`}
          >
            {garment ? (
              <>
                <Shirt size={13} /> GARMENT
              </>
            ) : (
              <>
                <Printer size={13} /> PRESS
              </>
            )}
          </div>
        </div>
      </div>

      <FinancialMatrix
        total={totalAmt}
        deposit={deposit}
        outstanding={outstanding}
        balColor={balColor}
        balLabel={balLabel}
      />

      {garment ? <GarmentSpecSection order={order} /> : <PressSpecSection order={order} />}

      <LogisticsGrid
        createdBy={createdBy}
        delivery={delivery}
        collection={collection}
        qty={qty}
        materialSource={materialSource}
      />

      <SectionHeader>Job Description</SectionHeader>
      <div className="mb-5 whitespace-pre-wrap rounded-lg border border-at-border bg-at-bg px-4 py-3.5 text-sm leading-relaxed text-slate-800">
        {description}
      </div>

      <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3.5">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isPending}
          placeholder="Reason for Rejection (required to reject)"
          className="mb-3 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent disabled:opacity-60"
        />
        {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
        <div className="flex gap-3">
          <Button variant="primary" size="sm" disabled={isPending} onClick={handleApprove}>
            <Check size={14} /> Approve Order
          </Button>
          <Button variant="danger" size="sm" disabled={isPending} onClick={handleReject}>
            <X size={14} /> Reject / Return
          </Button>
        </div>
      </div>
    </div>
  );
}

function FinancialMatrix({
  total,
  deposit,
  outstanding,
  balColor,
  balLabel,
}: {
  total: number;
  deposit: number;
  outstanding: number;
  balColor: string;
  balLabel: string;
}) {
  return (
    <div className="mb-5">
      <SectionHeader>Financial Matrix</SectionHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 px-4 py-3.5">
          <div className="mb-1 text-[0.68rem] font-bold uppercase tracking-wide text-blue-700">
            Aggregate Contract Value
          </div>
          <div className="text-xl font-extrabold text-blue-900">{money(total)}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-gradient-to-br from-green-50 to-green-100 px-4 py-3.5">
          <div className="mb-1 text-[0.68rem] font-bold uppercase tracking-wide text-green-700">
            Cash Deposit Paid
          </div>
          <div className="text-xl font-extrabold text-green-900">{money(deposit)}</div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100 px-4 py-3.5">
          <div className="mb-1 text-[0.68rem] font-bold uppercase tracking-wide" style={{ color: balColor }}>
            {balLabel}
          </div>
          <div className="text-xl font-extrabold" style={{ color: balColor }}>
            {money(outstanding)}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogisticsGrid({
  createdBy,
  delivery,
  collection,
  qty,
  materialSource,
}: {
  createdBy: string;
  delivery: string;
  collection: string;
  qty: number;
  materialSource: string;
}) {
  const tiles: { label: string; value: string; accent?: string }[] = [
    { label: "Account Executive", value: createdBy },
    { label: "Delivery Mode", value: delivery },
    { label: "Collection Date", value: collection, accent: "#0369a1" },
    { label: "Print Qty / Source", value: `${qty.toLocaleString()} — ${materialSource}` },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            {t.label}
          </div>
          <div className="text-sm font-semibold" style={{ color: t.accent ?? "#1e293b" }}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function GarmentSpecSection({ order }: { order: PendingOrderRow }) {
  const printType = order.print_type || order.type_of_print || "—";
  const yardageOrFinished = order.yardage || order.finished_print_size || "—";
  const printSize = order.print_size || "—";
  const packaging = order.packaging_mode || "—";
  const process = order.process_info || "—";

  const tiles = [
    { label: "Print Type", value: printType },
    { label: "Yardage / Fin. Size", value: yardageOrFinished },
    { label: "Print Size", value: printSize },
    { label: "Packaging Mode", value: packaging },
  ];

  return (
    <div className="mb-5">
      <SectionHeader>
        <span className="flex items-center gap-1.5">
          <Shirt size={13} /> Garment Specifications
        </span>
      </SectionHeader>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-amber-800">
              {t.label}
            </div>
            <div className="text-sm font-semibold text-slate-800">{t.value}</div>
          </div>
        ))}
      </div>
      <SectionHeader>Process / Technical Info</SectionHeader>
      <div className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm leading-relaxed text-slate-800">
        {process}
      </div>
    </div>
  );
}

function PressSpecSection({ order }: { order: PendingOrderRow }) {
  const paperType = order.paper_type || "—";
  const gsm = order.gsm || "—";
  const paperSize = order.paper_size || "—";
  const colourImpression = `${order.paper_colour || "—"} — ${order.impressions_colour || "—"}`;
  const binding = order.binding_type || "None";
  const laminating = order.laminating_type || "None";

  return (
    <div className="mb-5">
      <SectionHeader>
        <span className="flex items-center gap-1.5">
          <Printer size={13} /> Material &amp; Substrate Properties
        </span>
      </SectionHeader>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            Stock Paper Type
          </div>
          <div className="text-sm font-semibold text-slate-800">{paperType}</div>
        </div>
        <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">GSM</div>
          <div className="text-sm font-semibold text-slate-800">{gsm}</div>
        </div>
        <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            Paper Size
          </div>
          <div className="text-sm font-semibold text-slate-800">{paperSize}</div>
        </div>
        <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            Colour / Impression
          </div>
          <div className="text-sm font-semibold text-slate-800">{colourImpression}</div>
        </div>
      </div>
      <SectionHeader>Post-Press &amp; Finishing</SectionHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            Binding
          </div>
          <Chips value={binding} />
        </div>
        <div className="rounded-lg border border-at-border bg-at-bg px-4 py-3">
          <div className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
            Laminating
          </div>
          <Chips value={laminating} />
        </div>
      </div>
    </div>
  );
}

function Chips({ value }: { value: string | null }) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || ["none", "-", ""].includes(trimmed.toLowerCase())) {
    return <span className="text-sm italic text-at-slate-light">None selected</span>;
  }
  const items = trimmed
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-block rounded-full bg-at-navy px-2.5 py-1 text-[0.72rem] font-semibold text-at-white"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
