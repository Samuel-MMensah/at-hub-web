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

// Real document/image types the business actually attaches (LPOs, sample
// photos): PDF, JPEG, PNG — matching the UI's `accept` hint, but now actually
// enforced. Validated server-side two ways: here by sniffing the file's own
// magic bytes (NOT trusting the declared Content-Type, which a client can
// forge), and again at the Storage bucket level (allowed_mime_types +
// file_size_limit) so a direct-to-storage client can't bypass it either.
const ALLOWED_UPLOAD_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Detect the true content type from the leading bytes. Returns the canonical
// MIME only for the three allowed types; null for anything else — including a
// file whose declared type lies about what it really is (e.g. malware.exe
// sent as application/pdf).
function sniffAllowedMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf"; // "%PDF"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"; // JPEG SOI + marker
  }
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png"; // PNG signature
  }
  return null;
}

// Reusable upload helper — genuinely new infrastructure for this app
// (no prior route has written to Supabase Storage). Mirrors
// _upload_batch_file/_upload_g_batch_file (app.py): uploads to the
// 'job-attachments' bucket under `${pathPrefix}/${filename}`, now with
// server-side type/size validation. Returns the raw object PATH (stored in
// lpo_file_url/sample_file_url) — NOT a URL: the bucket is private, so every
// consumer (the approval email in backend/app/email.py, Archive's detail
// view) mints a FRESH signed URL at display/send time rather than relying on
// a stored one that would expire within 7 days.
// On ANY failure — including a rejected file — returns a warning instead of
// throwing, so an upload problem never blocks the rest of the batch
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
    // Size cap — enforced here and at the bucket (file_size_limit).
    if (file.size > MAX_UPLOAD_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return { url: null, warning: `${label} rejected (order still submitted without it): file is ${mb}MB, over the 10MB limit.` };
    }
    // Real content-type check by magic bytes — do NOT trust file.type.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const realMime = sniffAllowedMime(bytes);
    if (!realMime || !ALLOWED_UPLOAD_MIME.has(realMime)) {
      return { url: null, warning: `${label} rejected (order still submitted without it): only PDF, JPG or PNG files are allowed.` };
    }
    const path = `${pathPrefix}/${file.name}`;
    const { error } = await supabase.storage
      .from("job-attachments")
      .upload(path, file, { contentType: realMime });
    if (error) throw error;
    // Store the raw object PATH — consumers sign on demand (see docstring).
    return { url: path };
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
  const clientIdRaw = String(formData.get("clientId") ?? "").trim();
  const convertedFromSampleIdRaw = String(formData.get("convertedFromSampleId") ?? "").trim();
  const convertedFromSampleId =
    convertedFromSampleIdRaw && !Number.isNaN(Number(convertedFromSampleIdRaw))
      ? Number(convertedFromSampleIdRaw)
      : null;
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
  // Required going forward only (2026-08-30 revenue audit) — re-checked
  // here since the client-side guard in raise-order-client.tsx is only a
  // convenience, this is the real boundary.
  if (!salesRep) {
    return { error: 'Select a Sales Rep before submitting — choose "Walk-in / No Sales Rep" if no rep was involved.' };
  }
  // Phase 3: client_id is required either way — for an existing
  // selection it must come straight from the picker (never re-derived
  // from a name match), for "New Client" it's resolved below once that
  // row is actually created.
  if (!isNewClient && (!clientIdRaw || Number.isNaN(Number(clientIdRaw)))) {
    return { error: "Select a client before submitting the batch." };
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

  // Resolved below: either the picker's own selection (existing
  // client) or the id of the row created just under this, for "New
  // Client." Never re-derived from customer_name after the fact.
  let resolvedClientId: number = Number(clientIdRaw);

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
    resolvedClientId = newClient.id;
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
      client_id: resolvedClientId,
      converted_from_sample_id: convertedFromSampleId,
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
      // Guaranteed non-empty by the check above — either a real rep's
      // full_name or the literal "Walk-in / No Sales Rep" value.
      sales_rep: salesRep,
      // Sample / No Charge safety net — re-enforced here, not trusted
      // from the cart form alone: an is_sample item must have
      // total_amount and deposit_amount at exactly 0, forced
      // regardless of whatever the client actually sent. Same "never
      // trust a client-supplied value for a money invariant" posture
      // as every other write action in this app (recordInvoicePayment,
      // dispatch/archive's recordPayment, etc).
      ...(item.is_sample === true ? { total_amount: 0, deposit_amount: 0 } : {}),
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
  const salesRep = String(formData.get("salesRep") ?? "");
  const originalParentGroupId = String(formData.get("originalParentGroupId") ?? "");

  if (!clientName || !clientPhone) {
    return { error: "Client name and telephone must be set before submitting." };
  }
  if (sampleAttached === "Yes" && !sampleWith) {
    return { error: "Sample is marked attached — enter who has it before submitting." };
  }
  // Required going forward (2026-08-31) — a resubmit is a genuinely new
  // job_orders row (see this function's own doc comment below), so it
  // gets the same requirement as submitBatch's new-cart path. Re-checked
  // here since the client-side guard is only a convenience.
  if (!salesRep) {
    return { error: 'Select a Sales Rep before submitting — choose "Walk-in / No Sales Rep" if no rep was involved.' };
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
    // Guaranteed non-empty by the check above — either a real rep's
    // full_name or the literal "Walk-in / No Sales Rep" value. Added
    // 2026-08-31: the source's own resubmit payloads never included this
    // key, but a resubmit is a genuinely new job_orders row, so it was
    // silently bypassing the requirement new-cart submission enforces.
    sales_rep: salesRep,
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
