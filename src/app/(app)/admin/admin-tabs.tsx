"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** Link-based tabs (each tab is its own route) styled like the Tabs primitive. Add future admin sections here. */
const ADMIN_TABS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/contract-clauses", label: "Contract clauses" },
] as const;

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className="bg-muted inline-flex h-9 w-fit items-center gap-1 rounded-lg p-1" aria-label="Admin sections">
      {ADMIN_TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-muted-foreground inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,box-shadow]",
              isActive && "bg-background text-foreground shadow-sm"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
