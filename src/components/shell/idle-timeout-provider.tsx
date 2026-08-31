"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/login/actions";

// After 8 minutes of no activity, warn; at 10 minutes total, log out.
const WARN_AFTER_MS = 8 * 60 * 1000;
const LOGOUT_AFTER_MS = 10 * 60 * 1000;
const WARNING_WINDOW_SEC = (LOGOUT_AFTER_MS - WARN_AFTER_MS) / 1000; // 120

// Routes where nobody is "logged in" — no idle timer here (STEP 4).
const EXCLUDED_PREFIXES = ["/login", "/reset-password"];

// Genuine user activity. keydown is load-bearing for the "actively typing in a
// form during long pauses between keystrokes" case (STEP 3): every keystroke
// resets the timer, so a form-filler is never warned mid-work.
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "click", "keydown", "scroll", "touchstart"] as const;

function IdleWarningModal({ secondsLeft, onStay }: { secondsLeft: number; onStay: () => void }) {
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-timeout-title"
      aria-describedby="idle-timeout-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-at-lg border border-at-border bg-at-white p-6 shadow-xl">
        <div id="idle-timeout-title" className="mb-2 flex items-center gap-2 text-lg font-bold text-at-navy">
          <Clock size={18} /> Are you still there?
        </div>
        <p id="idle-timeout-desc" className="mb-1 text-sm text-at-slate">
          You&apos;ll be logged out in <strong>2 minutes</strong> due to inactivity.
        </p>
        <div className="mb-4 text-3xl font-extrabold tabular-nums text-red-600" aria-live="polite">
          {mm}:{ss}
        </div>
        <div className="flex justify-end">
          <Button onClick={onStay}>Stay logged in</Button>
        </div>
      </div>
    </div>
  );
}

export function IdleTimeoutProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const excluded = EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_WINDOW_SEC);

  const lastActivityRef = useRef<number>(0); // set to Date.now() in the effect
  const loggingOutRef = useRef(false);
  const showWarningRef = useRef(false);
  // Keep a ref copy of showWarning so the stable activity handler can read the
  // current value without re-subscribing. Synced in an effect, not during render.
  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);

  const doLogout = useCallback(() => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    // Reuse the SAME logout Server Action as the sidebar's Logout button —
    // it signs out server-side (invalidating the session) and redirects to
    // /login. No second logout path.
    void logout().catch(() => {
      loggingOutRef.current = false;
    });
  }, []);

  const registerActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    // Real activity dismisses the warning immediately (the interval would also
    // catch it within ~1s, but this feels instant).
    if (showWarningRef.current) setShowWarning(false);
  }, []);

  const stayLoggedIn = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
  }, []);

  useEffect(() => {
    if (excluded) return;

    // Fresh baseline whenever the timer becomes active on an authenticated
    // route. showWarning isn't reset here (that would cascade-render); the
    // interval below clears it within ~1s now that lastActivity is current.
    lastActivityRef.current = Date.now();
    loggingOutRef.current = false;

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, registerActivity, { passive: true });
    }

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= LOGOUT_AFTER_MS) {
        doLogout();
        return;
      }
      if (idle >= WARN_AFTER_MS) {
        setShowWarning(true);
        setSecondsLeft(Math.max(0, Math.ceil((LOGOUT_AFTER_MS - idle) / 1000)));
      } else if (showWarningRef.current) {
        setShowWarning(false);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, registerActivity);
      }
    };
  }, [excluded, registerActivity, doLogout]);

  return (
    <>
      {children}
      {!excluded && showWarning && <IdleWarningModal secondsLeft={secondsLeft} onStay={stayLoggedIn} />}
    </>
  );
}
