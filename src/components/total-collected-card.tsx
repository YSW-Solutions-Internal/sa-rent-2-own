"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const rand = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 2 });

/**
 * "Total Collected" stat card. `load` resolves to the net amount collected,
 * or null when the viewer isn't allowed to see it (the card then renders nothing).
 */
export function TotalCollectedCard({ id, load }: { id: string; load: (id: string) => Promise<{ data?: number | null }> }) {
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    load(id).then((result) => {
      if (!cancelled) setTotal(result.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id, load]);

  if (total === null) return null;

  return (
    <div className="bg-card flex items-center gap-4 rounded-lg border p-4 shadow-xs">
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
        <Wallet className="size-5" />
      </div>
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Total Collected</span>
        {total === undefined ? (
          <Skeleton className="mt-1 h-7 w-32" />
        ) : (
          <span className="text-2xl font-semibold tracking-tight text-[var(--brand-blue-dark)] tabular-nums dark:text-[var(--brand-blue)]">{rand.format(total)}</span>
        )}
      </div>
    </div>
  );
}
