"use client";

import * as React from "react";

import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TabsContent, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Building blocks for the big tabbed record modals (contract, vehicle, client):
 * a centred, fixed-height dialog with a title, a tab strip, a scrolling body
 * and an optional footer. Compose inside <Dialog> and <Tabs>.
 */
export function PanelModalContent({ className, children, ...props }: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn("flex h-[85vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl", className)}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

export function PanelModalHeader({ title }: { title: string }) {
  return (
    <div className="border-b px-6 py-4 pr-12">
      <DialogTitle>{title}</DialogTitle>
    </div>
  );
}

export function PanelModalTabsList({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b px-6 py-2">
      <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">{children}</TabsList>
    </div>
  );
}

export function PanelModalBody({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-4">{children}</div>;
}

/**
 * A tab inside a form. Kept mounted (just hidden) while another tab is showing, so
 * every field stays registered and validated and nothing typed is lost when switching.
 */
export function PanelModalFormTab({ className, ...props }: React.ComponentProps<typeof TabsContent>) {
  return (
    <TabsContent
      forceMount
      className={cn("flex flex-col gap-6 data-[state=inactive]:hidden", className)}
      {...props}
    />
  );
}

/** A tab with no form fields (loaded only while it is showing). */
export function PanelModalTab({ className, ...props }: React.ComponentProps<typeof TabsContent>) {
  return <TabsContent className={cn("flex flex-col gap-6", className)} {...props} />;
}

export function PanelModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 border-t px-6 py-3">{children}</div>;
}
