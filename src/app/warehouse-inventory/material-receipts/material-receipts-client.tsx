"use client";

import { useMemo, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { recordReceipt, updateReceipt } from "./actions";

const CURRENCY = "GH₵";

export interface MaterialOption {
  id: number;
  material_description: string;
  uom: string | null;
  unit_cost_ghc: number;
}

export interface ReceiptRow {
  id: number;
  date: string;
  vendor_name: string | null;
  material_id: number;
  qty: number;
  unit_cost: number;
  total_cost: number;
  created_at: string;
  edited_by: string | null;
  edited_at: string | null;
  material_catalog: { material_description: string; uom: string | null } | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CSV_COLUMNS = ["Date", "Material", "Vendor", "Qty", "Unit Cost", "Total Cost"] as const;

// CSV numeric fields are plain decimals (.toFixed(2)/.toString()), no
// currency symbol — matches Archive's own CSV export convention, not
// the on-screen money() display formatting. This tab has no
// search/filter on its history table, so exporting `receipts` (the
// full prop) already IS "the current view" — there's no separate
// filtered subset to diverge from.
function toRow(r: ReceiptRow): string[] {
  return [
    r.date,
    r.material_catalog?.material_description ?? "",
    r.vendor_name ?? "",
    r.qty.toString(),
    r.unit_cost.toFixed(2),
    r.total_cost.toFixed(2),
  ];
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(rows: string[][]) {
  const lines = [CSV_COLUMNS.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  link.href = url;
  link.download = `ATP_material_receipts_${yyyy}${mm}${dd}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// `date` is a plain Postgres DATE (e.g. "2026-08-03"), not timestamptz —
// a bare YYYY-MM-DD string is unambiguously parsed as UTC midnight per
// the ECMAScript Date spec (unlike a date-time string with no offset,
// which is local) — so this doesn't need parseTimestamptz's
// offset-checking, and matches month-groups.ts's own UTC convention.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function todayIso(): string {
  // UTC, matching this app's established "Ghana = UTC, always" convention
  // (see month-groups.ts) rather than the viewer's arbitrary local clock.
  return new Date().toISOString().slice(0, 10);
}

// Small, subtle indicator that a row isn't in its original state —
// title attribute carries the full precision (who + exact timestamp)
// since the visible badge itself only has room for a short date.
function EditedBadge({ editedBy, editedAt }: { editedBy: string | null; editedAt: string | null }) {
  if (!editedAt) return null;
  const d = new Date(editedAt);
  const short = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <span
      title={`Edited by ${editedBy ?? "unknown"} on ${d.toLocaleString()}`}
      className="ml-2 inline-block whitespace-nowrap rounded-full bg-at-warning-bg px-2 py-0.5 text-[0.65rem] font-semibold text-at-warning-text"
    >
      edited {short}
    </span>
  );
}

export function MaterialReceiptsClient({
  materials,
  receipts,
}: {
  materials: MaterialOption[];
  receipts: ReceiptRow[];
}) {
  const monthGroups: MonthGroup<ReceiptRow>[] = useMemo(
    () => groupByMonth(receipts, (r) => parseDateOnly(r.date)),
    [receipts]
  );
  const currentKey = currentMonthKey();

  const [editingId, setEditingId] = useState<number | null>(null);
  const editingReceipt = receipts.find((r) => r.id === editingId) ?? null;

  function handleEditClick(id: number) {
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div>
      <ReceiptForm
        key={editingReceipt?.id ?? "new"}
        materials={materials}
        editingReceipt={editingReceipt}
        onCancelEdit={() => setEditingId(null)}
        onSaved={() => setEditingId(null)}
      />

      <div className="mb-3 mt-8 flex items-center justify-between border-t-2 border-slate-100 pt-6">
        <div className="text-base font-bold text-at-navy">Receipt History</div>
        {receipts.length > 0 && (
          <Button onClick={() => downloadCsv(receipts.map(toRow))} className="whitespace-nowrap">
<Download size={14} /> Download Receipts CSV
          </Button>
        )}
      </div>

      {receipts.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No receipts recorded yet.
        </div>
      ) : (
        monthGroups.map((month) => (
          <CollapsibleMonthGroup
            key={month.key}
            monthLabel={month.label}
            itemCount={month.items.length}
            itemLabel="receipts"
            defaultExpanded={month.key === currentKey}
          >
            <div className="-mx-4 -my-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-at-border bg-at-bg">
                    {["Date", "Material", "Vendor", "Qty", "Unit Cost", "Total Cost", ""].map((col) => (
                      <th
                        key={col}
                        className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                          col === "Date" || col === "Material" || col === "Vendor" || col === "" ? "" : "text-right"
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {month.items.map((r) => (
                    <tr key={r.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {r.date}
                        <EditedBadge editedBy={r.edited_by} editedAt={r.edited_at} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                        {r.material_catalog?.material_description ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.vendor_name || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {r.qty.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {money(r.unit_cost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold text-at-navy">
                        {money(r.total_cost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleEditClick(r.id)}
                          className="text-xs font-semibold text-at-accent hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleMonthGroup>
        ))
      )}
    </div>
  );
}

interface ReceiptFormProps {
  materials: MaterialOption[];
  editingReceipt?: ReceiptRow | null;
  onCancelEdit?: () => void;
  onSaved?: () => void;
}

// Reused for both create and edit — not a second form component.
// editingReceipt drives the pre-filled initial state; the parent
// forces a remount (key={editingReceipt?.id ?? "new"}) whenever the
// selected row changes, so this component's own useState initializers
// only need to run once per "which row" rather than reacting to prop
// changes themselves — same pattern already established for Archive's
// OrderOperationsPanel and Phase 3.5's InvoicePaymentPanel.
function ReceiptForm({ materials, editingReceipt = null, onCancelEdit, onSaved }: ReceiptFormProps) {
  const isEditing = editingReceipt !== null;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [date, setDate] = useState(editingReceipt?.date ?? todayIso());
  const [vendorName, setVendorName] = useState(editingReceipt?.vendor_name ?? "");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">(editingReceipt?.material_id ?? "");
  const [qty, setQty] = useState<number | "">(editingReceipt?.qty ?? "");
  const [unitCost, setUnitCost] = useState<number | "">(editingReceipt?.unit_cost ?? "");

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => m.material_description.toLowerCase().includes(q));
  }, [materials, search]);

  const selected = selectedId === "" ? null : materials.find((m) => m.id === selectedId) ?? null;

  function handleSelectMaterial(idStr: string) {
    const id = idStr === "" ? "" : Number(idStr);
    setSelectedId(id);
    const material = materials.find((m) => m.id === id);
    // Default to the catalog's cost, but this is a starting point, not a
    // hard rule — purchase costs fluctuate, so it stays editable below.
    // Only auto-fills on a fresh pick here, not on initial mount in edit
    // mode — the row's own real unit_cost (set above) is what should
    // show first, not silently reset to today's catalog price.
    if (material) setUnitCost(material.unit_cost_ghc);
  }

  const canSubmit =
    date !== "" && selectedId !== "" && typeof qty === "number" && qty > 0 && typeof unitCost === "number" && unitCost >= 0;

  function resetForm() {
    setSelectedId("");
    setSearch("");
    setQty("");
    setUnitCost("");
    setVendorName("");
    setDate(todayIso());
  }

  function handleSubmit() {
    if (!canSubmit || typeof selectedId !== "number" || typeof qty !== "number" || typeof unitCost !== "number") return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = isEditing
        ? await updateReceipt(editingReceipt.id, { date, vendorName, materialId: selectedId, qty, unitCost })
        : await recordReceipt({ date, vendorName, materialId: selectedId, qty, unitCost });
      if (result.error) {
        setError(result.error);
      } else if (isEditing) {
        onSaved?.();
      } else {
        setSuccess(`Receipt recorded: ${qty.toLocaleString()} × ${selected?.material_description ?? "material"}.`);
        resetForm();
      }
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-base font-bold text-at-navy">
          {isEditing ? "Edit Receipt" : "Record a Receipt"}
        </div>
        {isEditing && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-xs font-semibold text-at-slate hover:text-at-navy"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Vendor Name
          </label>
          <input
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="e.g. Ghana Paper Supplies — optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Material
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search materials — e.g. A4 Copy Paper"
          className="mb-2 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <select
          value={selectedId}
          onChange={(e) => handleSelectMaterial(e.target.value)}
          className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        >
          <option value="">— Select a material —</option>
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.material_description}
              {m.uom ? ` (${m.uom})` : ""}
            </option>
          ))}
        </select>
        {candidates.length === 0 && (
          <div className="mt-2 text-sm text-at-slate">No materials match your search.</div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Quantity{selected?.uom ? ` (${selected.uom})` : ""}
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Unit Cost ({CURRENCY})
          </label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
      </div>

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}

      <Button disabled={!canSubmit || isPending} onClick={handleSubmit}>
        {isEditing ? "Save Changes" : "Record Receipt"}
      </Button>
    </div>
  );
}
