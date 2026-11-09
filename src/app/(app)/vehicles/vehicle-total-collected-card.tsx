"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { getVehicleTotalCollected } from "./assignment-actions";

const rand = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 2 });

/** Net cash collected for this vehicle across all its contracts, to date. */
export function VehicleTotalCollectedCard({ vehicleId }: { vehicleId: string }) {
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getVehicleTotalCollected(vehicleId).then((result) => {
      if (!cancelled) setTotal(result.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (total === null) return null; // not allowed, or failed to load

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
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{rand.format(total)}</span>
        )}
      </div>
    </div>
  );
}
