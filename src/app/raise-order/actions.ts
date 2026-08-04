"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { triggerBackendEmail } from "@/lib/notify-backend";

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
  const isNewClient = formData.get("isNewClient") === "true";
  const clientEmail = String(formData.get("clientEmail") ?? "").trim();
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

  // Phase 2 of the clients subsystem: the client picker's "+ New
  // Client" path lands here. Real gate against the duplicate-name
  // case (the client-side check in raise-order-client.tsx is only a
  // convenience — this is the actual boundary). ilike with no % wildcards
  // in the pattern is an exact, case-insensitive match — confirmed
  // decision: "ABC Ltd" and "abc ltd" are the same client, and
  // clients.name's real UNIQUE constraint is case-SENSITIVE, so an
  // exact-case duplicate can't reach this path anyway. Never silently
  // reused — a match here stops the whole batch before either the
  // client or any job_orders row is written.
  if (isNewClient) {
    const { data: existingClient, error: lookupError } = await supabase
      .from("clients")
      .select("id, name, phone, email")
      .ilike("name", clientName)
      .maybeSingle();

    if (lookupError) {
      return { error: `Could not verify client name: ${lookupError.message}` };
    }
    if (existingClient) {
      return {
        error: `A client named "${existingClient.name}" already exists (phone: ${
          existingClient.phone || "—"
        }, email: ${existingClient.email || "—"}). Select them from the client list instead of raising a new one, or use a more specific name if this is genuinely a different client.`,
      };
    }

    // Sequencing note (deliberate, not an oversight): this is a plain
    // INSERT followed by a separate bulk INSERT below — two round trips
    // to PostgREST, NOT one atomic DB transaction/RPC. Chosen over
    // building a transactional RPC because clients.name is not a
    // foreign key of job_orders (customer_name is plain text, no FK
    // constraint), so there is no referential-integrity requirement
    // forcing atomicity here — unlike the Phase 3 batch-insert fix,
    // where a partial multi-row insert was the actual risk being
    // eliminated.
    //
    // Real risk: if this INSERT succeeds but the job_orders insert
    // below then fails, the new clients row is left orphaned (a client
    // with no orders yet). This is self-healing, not silent data
    // corruption: the row is genuinely the name the user typed, it's
    // harmless sitting unused in the client list, and a retry of the
    // same submission will hit the ilike check above and correctly
    // offer to reuse it rather than erroring or double-creating.
    const { data: newClient, error: insertClientError } = await supabase
      .from("clients")
      .insert({ name: clientName, phone: clientPhone || null, email: clientEmail || null })
      .select()
      .single();

    if (insertClientError || !newClient) {
      return { error: `Could not create client: ${insertClientError?.message ?? "unknown error"}` };
    }
  }

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

  // Email #1 (new-order-submitted) — best-effort, matches source's own
  // try/except-wrapped notification call: never blocks the batch from
  // being reported as submitted. Passes every inserted row's id, not a
  // payload — the backend re-fetches and sums total_amount itself, see
  // handle_order_submitted's docstring.
  const insertedIds = (data ?? []).map((row) => row.id as number).filter((id) => typeof id === "number");
  if (insertedIds.length > 0) {
    await triggerBackendEmail(supabase, "/email/order-submitted", { order_ids: insertedIds });
  }

  revalidatePath("/raise-order");
  revalidatePath("/my-orders");
  revalidatePath("/authorization");

  return { submitted: data ?? [], warnings: warnings.length > 0 ? warnings : undefined };
}

// Matches f"RPPG-{datetime.now().strftime('%Y%m%d-%H%M%S')}" (Press) /
// the "RGPG-" equivalent (Garment) EXACTLY — deliberately NOT the same
// shape as generateParentGroupId's PG-/GPG- batch ids (no trailing
// random suffix). Computed server-side, same reasoning as
// combineDateWithNowAsUtc in this same file.
function generateResubmitPgid(prefix: "RPPG" | "RGPG"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${datePart}-${timePart}`;
}

// Mirrors both resubmit_press_form's and resubmit_garment_form's submit
// handlers (app.py) exactly — structurally identical once the item is
// already job_orders-row-shaped, so one action serves both.
//
// CRITICAL, and easy to get backwards: this INSERTS A NEW ROW. The
// original rejected row is never updated, never touched — it stays in
// the database exactly as it was, permanently, as its own record. This
// new row is a completely separate order that happens to reuse the
// original's parent_group_id (if it had one).
//
// job_order_no is never set here — same live-confirmed Postgres DEFAULT
// as submitBatch relies on.
export async function resubmitOrder(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const clientName = String(formData.get("clientName") ?? "").trim();
  const clientPhone = String(formData.get("clientPhone") ?? "").trim();
  const itemJson = String(formData.get("item") ?? "{}");
  const sampleAttached = String(formData.get("sampleAttached") ?? "No");
  const sampleWith = String(formData.get("sampleWith") ?? "").trim();
  const is30Day = formData.get("is30Day") === "true";
  const termsNotes = String(formData.get("termsNotes") ?? "").trim();
  const originalParentGroupId = String(formData.get("originalParentGroupId") ?? "");

  if (!clientName || !clientPhone) {
    return { error: "Client name and telephone must be set before submitting." };
  }
  if (sampleAttached === "Yes" && !sampleWith) {
    return { error: "Sample is marked attached — enter who has it before submitting." };
  }

  let item: Record<string, unknown>;
  try {
    item = JSON.parse(itemJson);
  } catch {
    return { error: "Malformed order payload." };
  }

  const supabase = await createClient();

  // Matches _rp_upload_pgid = _rp_orig_pgid or f"RPPG-{...}" exactly:
  // this fresh timestamp-based id is used ONLY for the storage upload
  // path when there's no original batch to reuse — see below, it is
  // NEVER written to the parent_group_id column in that case.
  const pgidPrefix = item.department === "GARMENT" ? "RGPG" : "RPPG";
  const uploadPgid = originalParentGroupId || generateResubmitPgid(pgidPrefix);

  const lpoFileEntry = formData.get("lpoFile");
  const sampleFileEntry = formData.get("sampleFile");
  const warnings: string[] = [];

  const lpoResult = await uploadBatchFile(
    supabase,
    lpoFileEntry instanceof File ? lpoFileEntry : null,
    uploadPgid,
    "LPO"
  );
  if (lpoResult.warning) warnings.push(lpoResult.warning);

  const sampleResult = await uploadBatchFile(
    supabase,
    sampleFileEntry instanceof File ? sampleFileEntry : null,
    uploadPgid,
    "Sample photo"
  );
  if (sampleResult.warning) warnings.push(sampleResult.warning);

  const termsParts: string[] = [];
  if (is30Day) termsParts.push("30-Day Credit Terms");
  if (termsNotes) termsParts.push(termsNotes);
  const paymentTerms = termsParts.length > 0 ? termsParts.join(" | ") : null;

  // Same strip as submitBatch — harmless no-op for a Press item, which
  // never has this key.
  const { material_description_rows: _omit, ...dbFields } = item;
  void _omit;

  const row: Record<string, unknown> = {
    ...dbFields,
    customer_name: clientName,
    telephone_number: clientPhone,
    status: "Pending Approval",
    created_by: user.email,
    order_date: todayLocalDateStr(),
    sample_attached: sampleAttached,
    sample_with: sampleAttached === "Yes" ? sampleWith : null,
    lpo_file_url: lpoResult.url,
    sample_file_url: sampleResult.url,
    payment_terms: paymentTerms,
    // No sales_rep here — the source's own resubmit payloads
    // (rp_payload/rg_payload) never include this key at all, unlike
    // the New-cart batch submit. Not carried over from the original
    // order either. Ported as-is, not "fixed."
  };

  // Matches `if _rp_orig_pgid: rp_payload["parent_group_id"] = _rp_orig_pgid`
  // exactly — the column is only ever set when reusing an ORIGINAL
  // group id. A resubmit with no original batch gets NO parent_group_id
  // at all (not the fresh RPPG-/RGPG- upload-path id above).
  if (originalParentGroupId) {
    row.parent_group_id = originalParentGroupId;
  }

  const { data, error } = await supabase.from("job_orders").insert([row]).select();

  if (error) {
    return { error: error.message, warnings: warnings.length > 0 ? warnings : undefined };
  }

  revalidatePath("/raise-order");
  revalidatePath("/my-orders");
  revalidatePath("/authorization");

  return { submitted: data ?? [], warnings: warnings.length > 0 ? warnings : undefined };
}
