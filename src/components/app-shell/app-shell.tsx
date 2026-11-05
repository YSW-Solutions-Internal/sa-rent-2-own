"use client";

import { useEffect, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";

import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

const COLLAPSE_STORAGE_KEY = "sar2o:sidebar-collapsed";

export function AppShell({
  profile,
  children,
}: {
  profile: { fullName: string; role: UserRole };
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    // Reads localStorage (unavailable during SSR) to sync the persisted
    // preference after mount; a lazy useState initializer would run during
    // hydration too and could mismatch the server-rendered (expanded) markup.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // Private browsing / blocked storage — default to expanded.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore — collapse state just won't persist this session.
      }
      return next;
    });
  }

  return (
    <div className="flex h-screen flex-1 overflow-hidden">
      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground hidden shrink-0 flex-col border-r transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b",
            collapsed ? "justify-center px-2" : "justify-between px-4"
          )}
        >
          {!collapsed && <span className="font-semibold tracking-tight">SAR2O Fleet</span>}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>
        <SidebarNav role={profile.role} collapsed={collapsed} />
        <div className={cn("mt-auto border-t border-white/10 p-2", collapsed && "flex justify-center")}>
          <UserMenu fullName={profile.fullName} role={profile.role} variant="sidebar" collapsed={collapsed} />
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 md:hidden">
          <div className="flex items-center gap-2">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Open navigation menu">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="bg-sidebar text-sidebar-foreground w-72 border-r-0 p-0"
              >
                <SheetHeader className="border-white/10">
                  <SheetTitle className="text-sidebar-foreground">SAR2O Fleet</SheetTitle>
                </SheetHeader>
                <SidebarNav
                  role={profile.role}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <div className="font-semibold tracking-tight">SAR2O Fleet</div>
          </div>
          <UserMenu fullName={profile.fullName} role={profile.role} />
        </header>
        <main className="bg-surface-sunken flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
