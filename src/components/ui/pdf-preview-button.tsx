"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "./button";
import { createClient } from "@/lib/supabase/client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

interface PdfPreviewButtonProps {
  orderId: number;
  /** Full button label, including any icon prefix the caller wants
   * (e.g. <><Shirt size={14} /> Preview Garment PDF</>) — this component
   * doesn't know about department classification, callers already do.
   * React.ReactNode, not just string, so a caller's icon+text pair
   * renders as real sibling elements rather than being flattened into
   * plain text (2026-08-31, same "widen rather than fork" precedent as
   * MetricCard's label). */
  label?: React.ReactNode;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; url: string; filename: string };

const DEFAULT_LABEL = (
  <>
    <FileText size={14} /> Preview PDF
  </>
);

export function PdfPreviewButton({ orderId, label = DEFAULT_LABEL }: PdfPreviewButtonProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const activeUrlRef = useRef<string | null>(null);

  // Revoke whatever blob URL is still active if this component unmounts
  // while a preview is open (e.g. the order leaves a filtered list).
  useEffect(() => {
    return () => {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
      }
    };
  }, []);

  async function handleOpen() {
    setState({ status: "loading" });

    if (!BACKEND_URL) {
      setState({
        status: "error",
        message: "Backend URL is not configured (NEXT_PUBLIC_BACKEND_URL).",
      });
      return;
    }

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setState({
          status: "error",
          message: "Your session has expired — please sign in again.",
        });
        return;
      }

      const res = await fetch(`${BACKEND_URL}/pdf/manifest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ order_id: orderId }),
      });

      if (!res.ok) {
        let detail = `PDF generation failed (${res.status}).`;
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
          // response body wasn't JSON — keep the generic status message
        }
        setState({ status: "error", message: detail });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      activeUrlRef.current = url;

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `Manifest_${orderId}.pdf`;

      setState({ status: "ready", url, filename });
    } catch {
      setState({
        status: "error",
        message: "Could not reach the PDF service — is the backend running?",
      });
    }
  }

  function handleClose() {
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }
    setState({ status: "idle" });
  }

  function handleDownload() {
    if (state.status !== "ready") return;
    const link = document.createElement("a");
    link.href = state.url;
    link.download = state.filename;
    link.click();
  }

  return (
    <>
      <Button variant="secondary" onClick={handleOpen} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Generating PDF…" : label}
      </Button>

      {state.status === "error" && (
        <div className="mt-2 text-sm font-semibold text-red-600">{state.message}</div>
      )}

      {state.status === "ready" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-at-lg bg-at-white shadow-at-md">
            <div className="flex items-center justify-between border-b border-at-border px-5 py-3">
              <div className="truncate text-sm font-bold text-at-navy">{state.filename}</div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" onClick={handleDownload}>
                  Download
                </Button>
                <Button size="sm" variant="secondary" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
            <iframe
              src={state.url}
              title={state.filename}
              className="w-full flex-1 rounded-b-lg border-0"
            />
          </div>
        </div>
      )}
    </>
  );
}
