"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";

interface ActionResult {
  error?: string;
}

// Same helper as invoice-entry-client.tsx's round2() (duplicated
// per-file, matching this codebase's established convention). Needed
// here because raw invoice_total/balance carry float residue from
// amount/nhil/vat arithmetic (e.g. 1999.9997999999998 for a clean
// GH₵2,000 invoice — confirmed live on P927488/STEPHEN KABUTEY) — the
// display already rounds this away, so the validation comparison below
// must round identically or it rejects a payment the user was shown as
// exactly payable.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function requireInvoiceEntryAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES])) {
    throw new Error("Invoice Entry is reserved for finance staff and administrators.");
  }
  return user;
}

const REVENUE_CATEGORIES = [
  "Large Format",
  "Screen Print",
  "Embroidery",
  "Digital Press",
  "Commercial Press",
  "Publishing",
  "Packaging",
] as const;

// Matches the live job_invoices.business_unit CHECK constraint exactly
// (supabase/migrations/20260815090000_...) — SAMPLE/CSR/REPLACEMENT added
// 2026-08-15 alongside that migration; this was the real blocker (a stale
// copy of the old 4-value list here rejected the write server-side even
// once the DB and the UI dropdown allowed the new values).
const BUSINESS_UNITS = ["WALK-IN", "PRIVATE", "GOVERNMENT", "SUBSIDIARY", "SAMPLE", "CSR", "REPLACEMENT"] as const;

export interface RecordInvoiceInput {
  date: string;
  jobOrderNo: string | null;
  customerName: string;
  clientId: number | null;
  salesRep: string | null;
  productDescription: string;
  revenueCategory: string;
  businessUnit: string;
  quantity: number;
  unitPrice: number;
  exempt: boolean;
  payment: number;
  status: string | null;
  oracleNo: string;
}

// Server-side is the one place amount/nhil/vat/invoice_total/balance
// are actually computed — the client-side preview mirrors this exact
// formula (see invoice-entry-client.tsx) but this is the value that
// actually gets written, not whatever the client happened to display.
// Formula confirmed against all 172 real imported rows before writing
// this: amount = quantity * unit_price (0 mismatches), nhil/vat = 5%/
// 15% of amount for 164 rows, exactly 0/0 (exempt) for the other 8 —
// hence the exempt flag rather than a hardcoded 5%/15% with no way to
// represent those 8 real cases. balance = invoice_total - payment
// (0 mismatches across all 172).
export async function recordInvoice(input: RecordInvoiceInput): Promise<ActionResult> {
  await requireInvoiceEntryAccess();

  if (!input.date) return { error: "Date is required." };
  if (!REVENUE_CATEGORIES.includes(input.revenueCategory as (typeof REVENUE_CATEGORIES)[number])) {
    return { error: "Select a valid revenue category." };
  }
  if (!BUSINESS_UNITS.includes(input.businessUnit as (typeof BUSINESS_UNITS)[number])) {
    return { error: "Select a valid business unit." };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { error: "Quantity must be greater than 0." };
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return { error: "Unit price cannot be negative." };
  }
  if (!Number.isFinite(input.payment) || input.payment < 0) {
    return { error: "Payment cannot be negative." };
  }
  if (input.status !== null && input.status !== "DELIVERED" && input.status !== "IN PRODUCTION") {
    return { error: "Invalid status." };
  }

  const amount = input.quantity * input.unitPrice;
  const nhil = input.exempt ? 0 : amount * 0.05;
  const vat = input.exempt ? 0 : amount * 0.15;
  const invoiceTotal = amount + nhil + vat;
  const balance = invoiceTotal - input.payment;

  const supabase = await createClient();

  // Phase 3: client_id / sales_rep. When a job order is linked, both
  // values are re-derived server-side from that order's own row
  // rather than trusted from the client — client_id because the
  // browser's copy of job_orders could be stale (another tab/session
  // relinked the order's client in between), and sales_rep because it
  // must be null whenever job_order_no is set regardless of what the
  // form sent (sales_rep_only_when_unlinked enforces this at the DB
  // level too — this is defense in depth, not the only gate).
  let clientId = input.clientId;
  let salesRep = input.salesRep;
  if (input.jobOrderNo) {
    const { data: order, error: orderLookupError } = await supabase
      .from("job_orders")
      .select("client_id")
      .eq("job_order_no", input.jobOrderNo)
      .single();
    if (orderLookupError || !order) {
      return { error: orderLookupError?.message ?? "Linked job order not found." };
    }
    clientId = order.client_id;
    salesRep = null;
  }

  const { error } = await supabase.from("job_invoices").insert({
    job_order_no: input.jobOrderNo || null,
    date: input.date,
    customer_name: input.customerName.trim() || null,
    client_id: clientId,
    sales_rep: salesRep,
    product_description: input.productDescription.trim() || null,
    revenue_category: input.revenueCategory,
    business_unit: input.businessUnit,
    quantity: input.quantity,
    unit_price: input.unitPrice,
    amount,
    nhil,
    vat,
    invoice_total: invoiceTotal,
    payment: input.payment,
    balance,
    status: input.status,
    oracle_no: input.oracleNo.trim() || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/revenue-analysis/invoice-entry");
  revalidatePath("/revenue-analysis");
  return {};
}

// Deliberately does NOT take the caller's idea of "current payment" or
// a pre-computed new balance — unlike Dispatch's recordPayment (which
// trusts the client's deposit + payAmt sum with NO server-side re-fetch
// or cap check at all — confirmed the same class of gap exists there
// too, see MIGRATION_STATUS.md / the task this shipped in for the
// explicit flag), this re-fetches the real current row through the
// caller's own session first and computes the new cumulative
// payment/balance from THAT, per explicit instruction ("recomputed
// server-side, never client-trusted"). A second payment recorded
// moments after the first can't be computed from a stale client-held
// balance this way.
//
// The re-fetch alone isn't the safety boundary — an overpayment
// submitted against a real, freshly-fetched balance would still be
// accepted without this explicit check. Rejected outright, not
// clamped: this app's own convention (job_orders/job_invoices' balance
// is deliberately never clamped to zero at read time — see Dispatch's
// `balance = total - deposit`, unclamped) means a silent server-side
// clamp here would be the one place balance math got force-corrected
// instead of surfaced, inconsistent with that convention.
export async function recordInvoicePayment(
  invoiceId: number,
  paymentAmount: number,
  receiptNo: string
): Promise<ActionResult> {
  await requireInvoiceEntryAccess();

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return { error: "Payment amount must be greater than 0." };
  }

  const supabase = await createClient();

  const { data: current, error: fetchError } = await supabase
    .from("job_invoices")
    .select("payment, invoice_total")
    .eq("id", invoiceId)
    .single();

  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Invoice not found." };
  }

  const currentBalance = current.invoice_total - current.payment;
  // Rounded on BOTH sides — comparing a rounded paymentAmount against a
  // raw currentBalance (or vice versa) is exactly what produced the
  // false rejection: display showed "GH₵2,000.00" (rounded) while this
  // check compared against 1999.9997999999998 (raw), so a real,
  // exact-to-the-display payment was reported as "exceeding" a balance
  // it was actually equal to.
  if (round2(paymentAmount) > round2(currentBalance)) {
    return {
      error: `Payment of ${paymentAmount.toFixed(2)} exceeds the outstanding balance of ${currentBalance.toFixed(2)}.`,
    };
  }

  const newPayment = current.payment + paymentAmount;
  const newBalance = current.invoice_total - newPayment;

  const { error } = await supabase
    .from("job_invoices")
    // Same "empty string -> null" convention as Dispatch's own
    // recordPayment (src/app/dispatch/actions.ts) for this exact field.
    .update({ payment: newPayment, balance: newBalance, receipt_no: receiptNo || null })
    .eq("id", invoiceId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/revenue-analysis/invoice-entry");
  revalidatePath("/revenue-analysis");
  return {};
}
