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

// Shared by recordInvoice and updateInvoice — the field-level validation
// is identical for both (the only real difference between create and
// edit is what happens to payment/balance/receipt_no afterward, handled
// separately in each function below), so this exists once rather than
// as two copies that could quietly drift apart.
function validateInvoiceFields(input: {
  date: string;
  revenueCategory: string;
  businessUnit: string;
  quantity: number;
  unitPrice: number;
  status: string | null;
}): string | null {
  if (!input.date) return "Date is required.";
  if (!REVENUE_CATEGORIES.includes(input.revenueCategory as (typeof REVENUE_CATEGORIES)[number])) {
    return "Select a valid revenue category.";
  }
  if (!BUSINESS_UNITS.includes(input.businessUnit as (typeof BUSINESS_UNITS)[number])) {
    return "Select a valid business unit.";
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return "Quantity must be greater than 0.";
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return "Unit price cannot be negative.";
  }
  if (input.status !== null && input.status !== "DELIVERED" && input.status !== "IN PRODUCTION") {
    return "Invalid status.";
  }
  return null;
}

// Server-side is the one place amount/nhil/vat/invoice_total are
// actually computed — the client-side preview mirrors this exact
// formula (see invoice-entry-client.tsx) but this is the value that
// actually gets written, not whatever the client happened to display.
// Formula confirmed against all 172 real imported rows before writing
// this: amount = quantity * unit_price (0 mismatches), nhil/vat = 5%/
// 15% of amount for 164 rows, exactly 0/0 (exempt) for the other 8 —
// hence the exempt flag rather than a hardcoded 5%/15% with no way to
// represent those 8 real cases. Shared by recordInvoice and
// updateInvoice — an edit that changes quantity/unit_price/exempt
// recomputes through this exact same formula, never a second copy.
function computeInvoiceAmounts(quantity: number, unitPrice: number, exempt: boolean) {
  const amount = quantity * unitPrice;
  const nhil = exempt ? 0 : amount * 0.05;
  const vat = exempt ? 0 : amount * 0.15;
  const invoiceTotal = amount + nhil + vat;
  return { amount, nhil, vat, invoiceTotal };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Phase 3: client_id / sales_rep. When a job order is linked, both
// values are re-derived server-side from that order's own row rather
// than trusted from the client — client_id because the browser's copy
// of job_orders could be stale (another tab/session relinked the
// order's client in between), and sales_rep because it must be null
// whenever job_order_no is set regardless of what the form sent
// (sales_rep_only_when_unlinked enforces this at the DB level too —
// this is defense in depth, not the only gate). Shared by recordInvoice
// and updateInvoice, including for RE-linking on edit (attaching or
// swapping a job_order_no on an existing invoice goes through this
// exact same re-derivation, not a forked copy).
async function resolveClientAndSalesRep(
  supabase: SupabaseServerClient,
  jobOrderNo: string | null,
  clientId: number | null,
  salesRep: string | null
): Promise<{ clientId: number | null; salesRep: string | null; error?: string }> {
  if (!jobOrderNo) return { clientId, salesRep };
  const { data: order, error } = await supabase
    .from("job_orders")
    .select("client_id")
    .eq("job_order_no", jobOrderNo)
    .single();
  if (error || !order) {
    return { clientId, salesRep, error: error?.message ?? "Linked job order not found." };
  }
  return { clientId: order.client_id, salesRep: null };
}

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

export async function recordInvoice(input: RecordInvoiceInput): Promise<ActionResult> {
  await requireInvoiceEntryAccess();

  const fieldError = validateInvoiceFields(input);
  if (fieldError) return { error: fieldError };
  if (!Number.isFinite(input.payment) || input.payment < 0) {
    return { error: "Payment cannot be negative." };
  }
  // Required for a standalone entry (2026-08-30 revenue audit) — a
  // linked invoice is exempt, since attribution there comes from the
  // order, not this field. Re-checked here since the client-side guard
  // is only a convenience. updateInvoice enforces the identical rule
  // below (2026-08-31: closed the edit-time loophole this comment used
  // to describe) — same check, not a forked copy.
  if (!input.jobOrderNo && !input.salesRep) {
    return { error: 'Select a Sales Rep before submitting — choose "Walk-in / No Sales Rep" if no rep was involved.' };
  }

  const { amount, nhil, vat, invoiceTotal } = computeInvoiceAmounts(input.quantity, input.unitPrice, input.exempt);
  const balance = invoiceTotal - input.payment;

  const supabase = await createClient();

  const resolved = await resolveClientAndSalesRep(supabase, input.jobOrderNo, input.clientId, input.salesRep);
  if (resolved.error) return { error: resolved.error };

  const { error } = await supabase.from("job_invoices").insert({
    job_order_no: input.jobOrderNo || null,
    date: input.date,
    customer_name: input.customerName.trim() || null,
    client_id: resolved.clientId,
    sales_rep: resolved.salesRep,
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

// Same field set as RecordInvoiceInput minus `payment` — editing never
// touches payment/balance/receipt_no, which stay exclusively under
// Record Payment's control (confirmed decision). balance is still
// RECOMPUTED here (see below) because it's a derived value like
// invoice_total, not something typed — but payment itself is never
// read from this input at all.
export type UpdateInvoiceInput = Omit<RecordInvoiceInput, "payment">;

// Edit capability: date, customer_name, product_description,
// revenue_category, business_unit, quantity, unit_price, oracle_no,
// status, job_order_no (re-linking), client_id, sales_rep — reusing
// validateInvoiceFields/computeInvoiceAmounts/resolveClientAndSalesRep
// exactly as recordInvoice does above, not a forked copy.
//
// payment is never read from `input` and is never written here —
// Record Payment (recordInvoicePayment) remains the only place that
// changes it. balance IS written, but as a recomputed value: the real
// current payment is re-fetched fresh (never trusted from the client,
// same discipline as recordInvoicePayment's own re-fetch), and
// balance = new invoice_total - that real current payment. This is the
// actual mechanics behind the UI's warning — if quantity/unit_price
// change on an invoice that already has payment > 0, the stored
// balance moves to match the new total while the payment itself stays
// exactly what it was, which is precisely the "may make the payment
// inconsistent with the new total" the warning names.
export async function updateInvoice(id: number, input: UpdateInvoiceInput): Promise<ActionResult> {
  const user = await requireInvoiceEntryAccess();

  const fieldError = validateInvoiceFields(input);
  if (fieldError) return { error: fieldError };
  // Required on every save, not just creation (2026-08-31) — closes the
  // loophole where re-saving an existing standalone invoice could keep
  // (or silently blank out) its Sales Rep with no forced choice. Same
  // rule recordInvoice enforces above, not a forked copy of the check.
  if (!input.jobOrderNo && !input.salesRep) {
    return { error: 'Select a Sales Rep before submitting — choose "Walk-in / No Sales Rep" if no rep was involved.' };
  }

  const { amount, nhil, vat, invoiceTotal } = computeInvoiceAmounts(input.quantity, input.unitPrice, input.exempt);

  const supabase = await createClient();

  const { data: current, error: fetchError } = await supabase
    .from("job_invoices")
    .select("payment")
    .eq("id", id)
    .single();
  if (fetchError || !current) {
    return { error: fetchError?.message ?? "Invoice not found." };
  }
  const balance = invoiceTotal - current.payment;

  const resolved = await resolveClientAndSalesRep(supabase, input.jobOrderNo, input.clientId, input.salesRep);
  if (resolved.error) return { error: resolved.error };

  const { error } = await supabase
    .from("job_invoices")
    .update({
      job_order_no: input.jobOrderNo || null,
      date: input.date,
      customer_name: input.customerName.trim() || null,
      client_id: resolved.clientId,
      sales_rep: resolved.salesRep,
      product_description: input.productDescription.trim() || null,
      revenue_category: input.revenueCategory,
      business_unit: input.businessUnit,
      quantity: input.quantity,
      unit_price: input.unitPrice,
      amount,
      nhil,
      vat,
      invoice_total: invoiceTotal,
      balance,
      status: input.status,
      oracle_no: input.oracleNo.trim() || null,
      edited_by: user.email,
      edited_at: new Date().toISOString(),
    })
    .eq("id", id);

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
