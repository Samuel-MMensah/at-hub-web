import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Route Handler Supabase client. Reads the session
 * from cookies so a signed-in user's role/session is available on the
 * server for RSC data fetches — this is what the Command Center
 * TODO(supabase) marker will call once wired up.
 *
 * Still uses the public anon key, not the service role key. The service
 * role key (full-access, bypasses RLS) has no reason to ever run in the
 * Next.js app — that belongs only in the backend service, for the
 * specific PDF/email jobs that need it, and never in anything reachable
 * from a browser request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — safe to ignore if
            // you have middleware refreshing sessions (add later).
          }
        },
      },
    }
  );
}
