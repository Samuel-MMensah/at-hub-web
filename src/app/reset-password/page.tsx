"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// New page — no prior route/page in this app handled a Supabase
// recovery link landing. Required for the Guest-account invite-link
// onboarding flow (backend/scripts/create_guest_accounts.py): the
// welcome email's "Set Your Password" button is dead without this.
//
// Client-side by design, not a Server Action, matching Supabase's own
// documented pattern for this flow: the browser client
// (src/lib/supabase/client.ts) is created with detectSessionInUrl:true
// and flowType:"pkce" (@supabase/ssr defaults, confirmed in
// node_modules), so simply constructing it here auto-exchanges the
// `?code=` param Supabase's own /auth/v1/verify redirect appended and
// persists the resulting session via the same cookie storage
// src/lib/supabase/server.ts reads — proxy.ts and every server-rendered
// page see the user as signed in immediately after updateUser()
// succeeds, no separate sync step.
//
// Listens for the PASSWORD_RECOVERY auth event specifically (Supabase's
// documented signal for this exact flow) rather than assuming the
// session is synchronously ready on mount — the code exchange is
// asynchronous.
//
// proxy.ts must allow this route without an existing session (same
// exclusion as /login) — the very first request here has no session
// yet; that's what this page exists to establish.
type Status = "waiting" | "ready" | "invalid" | "submitting" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("waiting");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });

    // Fallback: if the PASSWORD_RECOVERY event already fired before this
    // listener attached (a real possible race — detectSessionInUrl runs
    // as part of client construction above), a session existing at all
    // on this page means the recovery link's exchange already succeeded.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus((s) => (s === "waiting" ? "ready" : s));
    });

    // If nothing establishes a session within a few seconds, the link
    // was invalid, expired, or already used — say so rather than leave
    // a blank form waiting forever.
    const timeout = setTimeout(() => {
      setStatus((s) => (s === "waiting" ? "invalid" : s));
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setStatus("submitting");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setStatus("ready");
      return;
    }

    setStatus("done");
    setTimeout(() => router.push("/command-center"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-at-bg px-4">
      <div className="w-full max-w-sm rounded-at-lg border border-at-border bg-at-white p-8 shadow-at-sm">
        <div className="mb-6 text-center">
          <div className="text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Appointed Time Printing Ltd.
          </div>
          <h1 className="mt-1 text-[1.5rem] font-extrabold tracking-tight text-at-navy">
            Set Your Password
          </h1>
        </div>

        {status === "waiting" && (
          <p className="text-center text-sm text-at-slate">Verifying your link…</p>
        )}

        {status === "invalid" && (
          <p className="text-center text-sm font-semibold text-at-danger">
            This link is invalid or has expired. Ask an administrator to send a new one.
          </p>
        )}

        {(status === "ready" || status === "submitting") && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
              >
                New Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              />
            </div>

            {error && <p className="text-sm font-semibold text-at-danger">{error}</p>}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-2 flex w-full items-center justify-center rounded-lg bg-at-navy px-3 py-2.5 text-sm font-bold text-at-white transition-colors hover:bg-at-navy-soft disabled:opacity-60"
            >
              {status === "submitting" ? "Saving…" : "Set Password"}
            </button>
          </form>
        )}

        {status === "done" && (
          <p className="text-center text-sm font-semibold text-emerald-600">
            Password set. Redirecting…
          </p>
        )}
      </div>
    </div>
  );
}
