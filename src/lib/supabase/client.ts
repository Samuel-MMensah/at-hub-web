import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Component Supabase client. Uses the public anon key — safe to
 * ship to the browser, RLS policies are what actually enforce access,
 * the same way rbac.py's checks did at the app layer in Streamlit.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
