"use client";

import { TotalCollectedCard } from "@/components/total-collected-card";

import { getVehicleTotalCollected } from "./assignment-actions";

/** Net cash collected for this vehicle across all its contracts, to date. */
export function VehicleTotalCollectedCard({ vehicleId }: { vehicleId: string }) {
  return <TotalCollectedCard id={vehicleId} load={getVehicleTotalCollected} />;
}
