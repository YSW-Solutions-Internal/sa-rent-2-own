import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/** Red warning sign shown next to a blacklisted client's name, wherever the name appears. */
export function BlacklistFlag({ className }: { className?: string }) {
  return (
    <span title="Blacklisted client" className={cn("inline-flex align-middle text-red-600", className)}>
      <TriangleAlert className="size-4" aria-hidden />
      <span className="sr-only">Blacklisted client</span>
    </span>
  );
}

/** A client name, followed by the warning sign when the client is blacklisted. */
export function ClientName({ name, blacklisted }: { name: string; blacklisted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      {blacklisted && <BlacklistFlag />}
    </span>
  );
}
