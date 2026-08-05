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
//
// CODE-ENTRY FALLBACK: the link-based path above (detectSessionInUrl
// auto-exchanging a token embedded in the URL) turned out to be
// unreliable in production — generate_link()'s `redirect_to` was found
// to be silently truncated by Supabase, landing the recovery link's
// redirect on the site root instead of here, where proxy.ts's
// unauthenticated-redirect-to-login logic discarded the token before
// this page's own code ever ran. See MIGRATION_STATUS.md for the full
// diagnostic. Rather than gate this fallback behind a timeout (the
// original "invalid" state, now removed), the code form is shown
// immediately alongside the automatic check — no arbitrary wait for
// the (now known-unreliable) link path, and a real link, if one ever
// does establish a session, simply wins the race and this form becomes
// moot. `token_hash` is generate_link()'s own value, emailed via
// send_account_welcome_with_code (backend/app/email.py) — verifyOtp
// only needs { token_hash, type }, no email: confirmed against the
// real @supabase/auth-js VerifyTokenHashParams type, which has no
// email field at all (the task's own suggested call signature
// included one; corrected here to match the real API, not copied
// as-given).
type Status = "waiting" | "ready" | "submitting" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("waiting");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifyingCode, setVerifyingCode] = useState(false);

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

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleVerifyCode(e: React.SubmitEvent) {
    e.preventDefault();
    setCodeError(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setCodeError("Enter the code from your welcome email.");
      return;
    }

    setVerifyingCode(true);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: trimmed,
      type: "recovery",
    });
    setVerifyingCode(false);

    if (verifyError) {
      setCodeError(verifyError.message);
      return;
    }
    setStatus("ready");
  }

  async function handleSubmit(e: React.SubmitEvent) {
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
    setTimeout(() => router.push("/login"), 1500);
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
          <div>
            <p className="text-center text-sm text-at-slate">
              Checking your link automatically… or enter the code from your welcome email below.
            </p>
            <form onSubmit={handleVerifyCode} className="mt-4 flex flex-col gap-3">
              <div>
                <label
                  htmlFor="code"
                  className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
                >
                  Sign-In Code
                </label>
                <input
                  id="code"
                  type="text"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste your code here"
                  className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
                />
              </div>

              {codeError && <p className="text-sm font-semibold text-at-danger">{codeError}</p>}

              <button
                type="submit"
                disabled={verifyingCode}
                className="flex w-full items-center justify-center rounded-lg bg-at-navy px-3 py-2.5 text-sm font-bold text-at-white transition-colors hover:bg-at-navy-soft disabled:opacity-60"
              >
                {verifyingCode ? "Verifying…" : "Verify Code"}
              </button>
            </form>
          </div>
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
