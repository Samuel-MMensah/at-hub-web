"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { recordReceipt } from "./actions";

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
  qty: number;
  unit_cost: number;
  total_cost: number;
  created_at: string;
  material_catalog: { material_description: string; uom: string | null } | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  return (
    <div>
      <ReceiptForm materials={materials} />

      <div className="mb-3 mt-8 border-t-2 border-slate-100 pt-6 text-base font-bold text-at-navy">
        Receipt History
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
                    {["Date", "Material", "Vendor", "Qty", "Unit Cost", "Total Cost"].map((col) => (
                      <th
                        key={col}
                        className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                          col === "Date" || col === "Material" || col === "Vendor" ? "" : "text-right"
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.date}</td>
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

function ReceiptForm({ materials }: { materials: MaterialOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [date, setDate] = useState(todayIso());
  const [vendorName, setVendorName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [qty, setQty] = useState<number | "">("");
  const [unitCost, setUnitCost] = useState<number | "">("");

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
    if (material) setUnitCost(material.unit_cost_ghc);
  }

  const canSubmit =
    date !== "" && selectedId !== "" && typeof qty === "number" && qty > 0 && typeof unitCost === "number" && unitCost >= 0;

  function handleSubmit() {
    if (!canSubmit || typeof selectedId !== "number" || typeof qty !== "number" || typeof unitCost !== "number") return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordReceipt({
        date,
        vendorName,
        materialId: selectedId,
        qty,
        unitCost,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Receipt recorded: ${qty.toLocaleString()} × ${selected?.material_description ?? "material"}.`);
        setSelectedId("");
        setSearch("");
        setQty("");
        setUnitCost("");
        setVendorName("");
      }
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 text-base font-bold text-at-navy">Record a Receipt</div>

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
        Record Receipt
      </Button>
    </div>
  );
}
