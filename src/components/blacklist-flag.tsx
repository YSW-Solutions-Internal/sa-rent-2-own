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

/**
 * A client name, followed by the warning sign when the client is blacklisted.
 * `flex`, not `inline-flex`, and `min-w-0` on both the row and the name
 * itself: a plain inline-flex span won't shrink below its content width, so
 * a long name just overflows past a narrow (e.g. sticky, fixed-width) column
 * instead of truncating — this makes it an ordinary shrinkable flex child.
 */
export function ClientName({ name, blacklisted }: { name: string; blacklisted?: boolean }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      <span className="min-w-0 truncate">{name}</span>
      {blacklisted && <BlacklistFlag className="shrink-0" />}
    </span>
  );
}
