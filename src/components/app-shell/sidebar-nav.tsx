"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, LayoutDashboard, Users, FileText, Receipt, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "manager", "technician"] },
  { href: "/vehicles", label: "Vehicles", icon: Car, roles: ["admin", "manager", "technician"] },
  { href: "/clients", label: "Clients", icon: Users, roles: ["admin", "manager"] },
  { href: "/contracts", label: "Contracts", icon: FileText, roles: ["admin", "manager"] },
  { href: "/payments", label: "Payments", icon: Receipt, roles: ["admin", "manager"] },
  { href: "/admin", label: "Admin", icon: ShieldCheck, roles: ["admin"] },
] as const;

export function SidebarNav({
  role,
  collapsed,
  onNavigate,
}: {
  role: UserRole;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.filter((item) => (item.roles as readonly string[]).includes(role)).map(
        (item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/70 transition-colors",
                collapsed && "justify-center px-2",
                isActive ? "bg-sidebar-accent text-white" : "hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        }
      )}
    </nav>
  );
}
