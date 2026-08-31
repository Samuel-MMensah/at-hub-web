"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notifyReadyForFinance } from "./actions";

export function NotifyFinanceButton({
  orderId,
  initiallyNotified,
}: {
  orderId: number;
  initiallyNotified: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notified, setNotified] = useState(initiallyNotified);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await notifyReadyForFinance(orderId);
      if (result.error) {
        setError(result.error);
      } else {
        setNotified(true);
      }
    });
  }

  if (notified) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-at-success bg-at-success-bg px-3 py-1.5 text-xs font-semibold text-at-success-text">
        <Check size={13} /> Finance Notified
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button disabled={isPending} onClick={handleClick}>
        {isPending ? "Notifying…" : "Notify Finance This Is Ready"}
      </Button>
      {error && <div className="text-xs font-semibold text-red-600">{error}</div>}
    </div>
  );
}
