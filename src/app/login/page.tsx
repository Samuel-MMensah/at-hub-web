"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-at-bg px-4">
      <div className="w-full max-w-sm rounded-at-lg border border-at-border bg-at-white p-8 shadow-at-sm">
        <div className="mb-6 text-center">
          <div className="text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Appointed Time Printing Ltd.
          </div>
          <h1 className="mt-1 text-[1.5rem] font-extrabold tracking-tight text-at-navy">
            Sign in
          </h1>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </div>

          {state?.error && (
            <p className="text-sm font-semibold text-at-danger">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 flex w-full items-center justify-center rounded-lg bg-at-navy px-3 py-2.5 text-sm font-bold text-at-white transition-colors hover:bg-at-navy-soft disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
