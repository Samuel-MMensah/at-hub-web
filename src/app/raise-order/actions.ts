"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface ActionResult {
  error?: string;
  submitted?: Record<string, unknown>[];
  // Non-fatal — e.g. a file upload failure. Never blocks the DB insert,
  // matches the source's own "order will still submit without it" posture.
  warnings?: string[];
}

// Matches datetime.now().strftime('%Y-%m-%d') — computed server-side,
// same reasoning as Production Layout Builder's anchor_start: Streamlit's
// datetime.now() always evaluates on the server (the whole script
// re-runs server-side on every interaction), so the faithful equivalent
// location for "now" here is this Server Action, not the browser.
function todayLocalDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Reusable upload helper — genuinely new infrastructure for this app
// (no prior route has written to Supabase Storage). Mirrors
// _upload_batch_file/_upload_g_batch_file (app.py) exactly: uploads to
// the 'job-attachments' bucket under `${pathPrefix}/${filename}`,
// returns the public URL. On ANY failure, returns a warning instead of
// throwing — an upload failure must never block the rest of the batch
// submission, matching the source's own comment verbatim ("order will
// still submit without it").
async function uploadBatchFile(
  supabase: SupabaseServerClient,
  file: File | null,
  pathPrefix: string,
  label: string
): Promise<{ url: string | null; warning?: string }> {
  if (!file || file.size === 0) return { url: null };
  try {
    const path = `${pathPrefix}/${file.name}`;
    const { error } = await supabase.storage
      .from("job-attachments")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (error) throw error;
    const { data } = supabase.storage.from("job-attachments").getPublicUrl(path);
    return { url: data.publicUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url: null, warning: `${label} upload failed (order will still submit without it): ${message}` };
  }
}

// Mirrors both add_cart_item_form's and add_garment_cart_item_form's
// submit handlers (app.py) — structurally identical for both
// departments once each cart item is already shaped like a job_orders
// row (see PressCartItem/GarmentCartItem in raise-order-client.tsx), so
// one shared action serves both carts.
//
// DELIBERATE DEVIATION FROM SOURCE: the source loops one item at a time
// (`for item in cart_items: supabase.table('job_orders').insert(item).execute()`),
// which can leave a partial batch inserted if a later item fails. This
// replaces that with ONE bulk insert — every cart item becomes one row
// in a single array passed to a single .insert().select() call. Either
// the whole batch lands, or (per Postgres/PostgREST's own atomicity for
// a multi-row insert statement) none of it does — no partial-batch
// cleanup logic is needed as a result.
//
// job_order_no is never set here — job_orders.job_order_no has a real
// Postgres DEFAULT ('P' || lpad(floor(random()*1000000)::text, 6, '0')),
// confirmed live before writing this. Every row gets its own randomly
// generated value from that default; .select() reads the real
// post-insert values back, so the confirmation panel shows genuine DB
// state, not a reconstructed guess.
export async function submitBatch(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const pgid = String(formData.get("pgid") ?? "");
  const clientName = String(formData.get("clientName") ?? "").trim();
  const clientPhone = String(formData.get("clientPhone") ?? "").trim();
  const itemsJson = String(formData.get("items") ?? "[]");
  const sampleAttached = String(formData.get("sampleAttached") ?? "No");
  const sampleWith = String(formData.get("sampleWith") ?? "").trim();
  const is30Day = formData.get("is30Day") === "true";
  const termsNotes = String(formData.get("termsNotes") ?? "").trim();
  const salesRep = String(formData.get("salesRep") ?? "");

  // Same guard the source's submit button has, re-checked server-side
  // since a Server Action is a real network boundary.
  if (!clientName || !clientPhone) {
    return { error: "Client name and telephone must be set before submitting the batch." };
  }
  if (sampleAttached === "Yes" && !sampleWith) {
    return { error: "Sample is marked attached — enter who has it before submitting." };
  }

  let items: Record<string, unknown>[];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { error: "Malformed cart payload." };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Cart is empty." };
  }

  const supabase = await createClient();

  const lpoFileEntry = formData.get("lpoFile");
  const sampleFileEntry = formData.get("sampleFile");
  const warnings: string[] = [];

  const lpoResult = await uploadBatchFile(
    supabase,
    lpoFileEntry instanceof File ? lpoFileEntry : null,
    pgid,
    "LPO"
  );
  if (lpoResult.warning) warnings.push(lpoResult.warning);

  const sampleResult = await uploadBatchFile(
    supabase,
    sampleFileEntry instanceof File ? sampleFileEntry : null,
    pgid,
    "Sample photo"
  );
  if (sampleResult.warning) warnings.push(sampleResult.warning);

  // Matches _terms_parts / _final_payment_terms exactly.
  const termsParts: string[] = [];
  if (is30Day) termsParts.push("30-Day Credit Terms");
  if (termsNotes) termsParts.push(termsNotes);
  const paymentTerms = termsParts.length > 0 ? termsParts.join(" | ") : null;

  const orderDate = todayLocalDateStr();

  const rows = items.map((item) => {
    // material_description_rows is a Garment-only, in-memory-only field
    // (see GarmentCartItem's own doc comment) — not a real job_orders
    // column, so it must never reach the insert payload, matching the
    // source's explicit `_g_payload.pop("material_description_rows", [])`.
    // Harmless no-op for Press items, which never have this key.
    const { material_description_rows: _omit, ...dbFields } = item;
    void _omit;
    return {
      ...dbFields,
      customer_name: clientName,
      telephone_number: clientPhone,
      parent_group_id: pgid,
      status: "Pending Approval",
      // Matches My Order Tracker's created_by-by-email convention.
      created_by: user.email,
      order_date: orderDate,
      sample_attached: sampleAttached,
      sample_with: sampleAttached === "Yes" ? sampleWith : null,
      lpo_file_url: lpoResult.url,
      sample_file_url: sampleResult.url,
      payment_terms: paymentTerms,
      sales_rep: salesRep || null,
    };
  });

  const { data, error } = await supabase.from("job_orders").insert(rows).select();

  if (error) {
    return { error: error.message, warnings: warnings.length > 0 ? warnings : undefined };
  }

  revalidatePath("/raise-order");
  revalidatePath("/my-orders");
  revalidatePath("/authorization");

  return { submitted: data ?? [], warnings: warnings.length > 0 ? warnings : undefined };
}
