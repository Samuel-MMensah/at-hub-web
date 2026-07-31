import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// Shared by every Server Action that fires a best-effort backend email
// notification (submitBatch, approveOrder, rejectOrder, sendToWarehouse,
// notifyReadyForFinance) — one call site for the "get the session token,
// POST to the backend, never let a failure surface to the caller"
// pattern, instead of five near-identical copies. Mirrors Command
// Center's triggerOverdueCollectionAlerts, generalized.
//
// Always swallows errors and never throws: every notify_* email is
// explicitly best-effort per this project's rules — a failed or
// unreachable backend must never fail the status write that already
// succeeded before this was called.
export async function triggerBackendEmail(
  supabase: SupabaseServerClient,
  path: string,
  body: Record<string, unknown>
): Promise<void> {
  if (!BACKEND_URL) return;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`triggerBackendEmail(${path}) failed:`, err);
  }
}
