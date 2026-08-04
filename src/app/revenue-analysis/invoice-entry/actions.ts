"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";

interface ActionResult {
  error?: string;
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

const BUSINESS_UNITS = ["WALK-IN", "PRIVATE", "GOVERNMENT", "SUBSIDIARY"] as const;

export interface RecordInvoiceInput {
  date: string;
  jobOrderNo: string | null;
  customerName: string;
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
  const { error } = await supabase.from("job_invoices").insert({
    job_order_no: input.jobOrderNo || null,
    date: input.date,
    customer_name: input.customerName.trim() || null,
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
