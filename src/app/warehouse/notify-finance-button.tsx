"use client";

import { useState, useTransition } from "react";
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
      <div className="w-full rounded-at border border-emerald-200 bg-at-success-bg px-4 py-2.5 text-sm font-semibold text-at-success-text">
        Finance already notified — awaiting dispatch finalization.
      </div>
    );
  }

  return (
    <div className="w-full">
      <Button disabled={isPending} onClick={handleClick} className="w-full">
        {isPending ? "Notifying…" : "Notify Finance This Is Ready"}
      </Button>
      {error && <div className="mt-2 text-sm font-semibold text-red-600">{error}</div>}
    </div>
  );
}
