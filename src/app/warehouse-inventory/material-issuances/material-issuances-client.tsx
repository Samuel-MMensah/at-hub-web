"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { recordIssuance } from "./actions";

const CURRENCY = "GH₵";

export interface MaterialOption {
  id: number;
  material_description: string;
  uom: string | null;
  unit_cost_ghc: number;
}

export interface JobOrderOption {
  job_order_no: string;
  customer_name: string;
  status: string | null;
}

export interface IssuanceRow {
  id: number;
  date: string;
  job_order_no: string | null;
  customer_name: string | null;
  qty: number;
  unit_cost: number;
  total_cost: number;
  user_department: string | null;
  oracle_req_no: string | null;
  document: string | null;
  oracle_shipment_no: string | null;
  created_at: string;
  material_catalog: { material_description: string; uom: string | null } | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CSV_COLUMNS = [
  "Date",
  "Material",
  "Order No.",
  "Customer",
  "Qty",
  "Unit Cost",
  "Total Cost",
  "Dept",
  "Oracle Req #",
  "Document",
  "Oracle Shipment No.",
] as const;

// Same convention as Material Receipts' CSV export: plain decimals, no
// currency symbol. No search/filter exists on this tab's history
// either, so `issuances` (the full prop) already IS the current view.
function toRow(r: IssuanceRow): string[] {
  return [
    r.date,
    r.material_catalog?.material_description ?? "",
    r.job_order_no ?? "",
    r.customer_name ?? "",
    r.qty.toString(),
    r.unit_cost.toFixed(2),
    r.total_cost.toFixed(2),
    r.user_department ?? "",
    r.oracle_req_no ?? "",
    r.document ?? "",
    r.oracle_shipment_no ?? "",
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
  link.download = `ATP_material_issuance_${yyyy}${mm}${dd}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Same rationale as Phase 3: a plain DATE column string is
// unambiguously parsed as UTC midnight per the ECMAScript spec.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MaterialIssuancesClient({
  materials,
  jobOrders,
  issuances,
}: {
  materials: MaterialOption[];
  jobOrders: JobOrderOption[];
  issuances: IssuanceRow[];
}) {
  const monthGroups: MonthGroup<IssuanceRow>[] = useMemo(
    () => groupByMonth(issuances, (r) => parseDateOnly(r.date)),
    [issuances]
  );
  const currentKey = currentMonthKey();

  return (
    <div>
      <IssuanceForm materials={materials} jobOrders={jobOrders} />

      <div className="mb-3 mt-8 flex items-center justify-between border-t-2 border-slate-100 pt-6">
        <div className="text-base font-bold text-at-navy">Issuance History</div>
        {issuances.length > 0 && (
          <Button onClick={() => downloadCsv(issuances.map(toRow))} className="whitespace-nowrap">
            ⬇️ Download Issuance CSV
          </Button>
        )}
      </div>

      {issuances.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No issuances recorded yet.
        </div>
      ) : (
        monthGroups.map((month) => (
          <CollapsibleMonthGroup
            key={month.key}
            monthLabel={month.label}
            itemCount={month.items.length}
            itemLabel="issuances"
            defaultExpanded={month.key === currentKey}
          >
            <div className="-mx-4 -my-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-at-border bg-at-bg">
                    {[
                      "Date",
                      "Material",
                      "Order No.",
                      "Customer",
                      "Qty",
                      "Unit Cost",
                      "Total Cost",
                      "Dept",
                      "Oracle Req #",
                      "Document",
                      "Oracle Shipment No.",
                    ].map((col) => (
                      <th
                        key={col}
                        className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                          col === "Qty" || col === "Unit Cost" || col === "Total Cost" ? "text-right" : ""
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.job_order_no || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.customer_name || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {r.qty.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {money(r.unit_cost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold text-at-navy">
                        {money(r.total_cost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.user_department || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.oracle_req_no || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.document || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.oracle_shipment_no || "—"}</td>
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

function IssuanceForm({ materials, jobOrders }: { materials: MaterialOption[]; jobOrders: JobOrderOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [date, setDate] = useState(todayIso());

  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrderNo, setSelectedOrderNo] = useState("");
  const [customerName, setCustomerName] = useState("");

  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | "">("");

  const [qty, setQty] = useState<number | "">("");
  const [unitCost, setUnitCost] = useState<number | "">("");
  const [userDepartment, setUserDepartment] = useState("");
  const [oracleReqNo, setOracleReqNo] = useState("");
  const [document_, setDocument] = useState("");
  const [oracleShipmentNo, setOracleShipmentNo] = useState("");

  const orderCandidates = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return jobOrders;
    return jobOrders.filter(
      (o) => o.job_order_no.toLowerCase().includes(q) || (o.customer_name ?? "").toLowerCase().includes(q)
    );
  }, [jobOrders, orderSearch]);

  const materialCandidates = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => m.material_description.toLowerCase().includes(q));
  }, [materials, materialSearch]);

  const selectedMaterial =
    selectedMaterialId === "" ? null : materials.find((m) => m.id === selectedMaterialId) ?? null;

  function handleSelectOrder(orderNo: string) {
    setSelectedOrderNo(orderNo);
    const order = jobOrders.find((o) => o.job_order_no === orderNo);
    // Defaults from the picked order, but stays freeform/editable below —
    // a snapshot at issuance time, not a live join (see page.tsx's own
    // note on this).
    if (order) setCustomerName(order.customer_name ?? "");
  }

  function handleSelectMaterial(idStr: string) {
    const id = idStr === "" ? "" : Number(idStr);
    setSelectedMaterialId(id);
    const material = materials.find((m) => m.id === id);
    if (material) setUnitCost(material.unit_cost_ghc);
  }

  const canSubmit =
    date !== "" &&
    selectedOrderNo !== "" &&
    selectedMaterialId !== "" &&
    typeof qty === "number" &&
    qty > 0 &&
    typeof unitCost === "number" &&
    unitCost >= 0;

  function handleSubmit() {
    if (
      !canSubmit ||
      typeof selectedMaterialId !== "number" ||
      typeof qty !== "number" ||
      typeof unitCost !== "number"
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordIssuance({
        date,
        jobOrderNo: selectedOrderNo,
        customerName,
        materialId: selectedMaterialId,
        qty,
        unitCost,
        userDepartment,
        oracleReqNo,
        document: document_,
        oracleShipmentNo,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(
          `Issuance recorded: ${qty.toLocaleString()} × ${selectedMaterial?.material_description ?? "material"} against ${selectedOrderNo}.`
        );
        setSelectedOrderNo("");
        setOrderSearch("");
        setCustomerName("");
        setSelectedMaterialId("");
        setMaterialSearch("");
        setQty("");
        setUnitCost("");
        setUserDepartment("");
        setOracleReqNo("");
        setDocument("");
        setOracleShipmentNo("");
      }
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 text-base font-bold text-at-navy">Record an Issuance</div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full max-w-xs rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Order No.
        </label>
        <input
          type="text"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
          placeholder="Search by order number or customer name — any status"
          className="mb-2 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <select
          value={selectedOrderNo}
          onChange={(e) => handleSelectOrder(e.target.value)}
          className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        >
          <option value="">— Select an order —</option>
          {orderCandidates.map((o) => (
            <option key={o.job_order_no} value={o.job_order_no}>
              {o.job_order_no} — {o.customer_name || "—"} · {o.status || "—"}
            </option>
          ))}
        </select>
        {orderCandidates.length === 0 && (
          <div className="mt-2 text-sm text-at-slate">No orders match your search.</div>
        )}
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Customer Name
        </label>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Auto-filled from the selected order — editable"
          className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Material
        </label>
        <input
          type="text"
          value={materialSearch}
          onChange={(e) => setMaterialSearch(e.target.value)}
          placeholder="Search materials — e.g. A4 Copy Paper"
          className="mb-2 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <select
          value={selectedMaterialId}
          onChange={(e) => handleSelectMaterial(e.target.value)}
          className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        >
          <option value="">— Select a material —</option>
          {materialCandidates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.material_description}
              {m.uom ? ` (${m.uom})` : ""}
            </option>
          ))}
        </select>
        {materialCandidates.length === 0 && (
          <div className="mt-2 text-sm text-at-slate">No materials match your search.</div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Quantity{selectedMaterial?.uom ? ` (${selectedMaterial.uom})` : ""}
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            User Department
          </label>
          <input
            type="text"
            value={userDepartment}
            onChange={(e) => setUserDepartment(e.target.value)}
            placeholder="optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Oracle Req #
          </label>
          <input
            type="text"
            value={oracleReqNo}
            onChange={(e) => setOracleReqNo(e.target.value)}
            placeholder="optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Document
          </label>
          <input
            type="text"
            value={document_}
            onChange={(e) => setDocument(e.target.value)}
            placeholder="optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Oracle Shipment No.
          </label>
          <input
            type="text"
            value={oracleShipmentNo}
            onChange={(e) => setOracleShipmentNo(e.target.value)}
            placeholder="optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
      </div>

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}

      <Button disabled={!canSubmit || isPending} onClick={handleSubmit}>
        Record Issuance
      </Button>
    </div>
  );
}
