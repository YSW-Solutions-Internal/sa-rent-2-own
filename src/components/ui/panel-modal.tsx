"use client";

import * as React from "react";

import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Building blocks for the big record modals (contract, vehicle, client):
 * a centred, fixed-height dialog with a title, a single scrolling page made
 * of titled sections, a left-hand category rail that follows the scroll, and
 * an optional footer. Compose inside <Dialog>.
 */
export function PanelModalContent({ className, children, ...props }: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn("flex h-[85vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl", className)}
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

export function PanelModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 border-t px-6 py-3">{children}</div>;
}

const SECTION_ID_PREFIX = "panel-section-";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Smooth-scrolls the open panel modal to a section (e.g. the one holding an invalid field). */
export function scrollToPanelSection(id: string) {
  document
    .getElementById(SECTION_ID_PREFIX + id)
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

export interface PanelModalSectionInfo {
  id: string;
  label: string;
}

/**
 * The modal's body: a left rail listing `sections` next to one scrolling page.
 * The rail highlights the section currently in view (with a sliding marker) and
 * clicking an entry scrolls to it. Children are <PanelModalSection>s (they may
 * sit inside forms/fieldsets); every section stays mounted, so all fields are
 * always registered and validated.
 */
export function PanelModalSections({
  sections,
  children,
}: {
  sections: PanelModalSectionInfo[];
  children: React.ReactNode;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const locked = React.useRef(false);
  const lockTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const [activeId, setActiveId] = React.useState(sections[0]?.id ?? "");
  const [marker, setMarker] = React.useState<{ top: number; height: number } | null>(null);

  // Scroll-spy: the active section is the last one whose top has reached the
  // top of the page; at the very bottom it is always the last one.
  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    function update() {
      frame = 0;
      if (locked.current) return;
      const els = container!.querySelectorAll<HTMLElement>("[data-panel-section]");
      if (els.length === 0) return;
      const threshold = container!.getBoundingClientRect().top + 48;
      let current = els[0].dataset.panelSection!;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= threshold) current = el.dataset.panelSection!;
      }
      if (container!.scrollTop + container!.clientHeight >= container!.scrollHeight - 2) {
        current = els[els.length - 1].dataset.panelSection!;
      }
      setActiveId(current);
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(lockTimer.current);
    };
  }, [sections.length]);

  // Slide the rail's marker to the active entry.
  React.useLayoutEffect(() => {
    const el = itemRefs.current.get(activeId);
    if (el) setMarker({ top: el.offsetTop, height: el.offsetHeight });
  }, [activeId, sections.length]);

  function go(id: string) {
    setActiveId(id);
    // Don't flicker through the sections in between while the smooth scroll runs.
    locked.current = true;
    clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => {
      locked.current = false;
    }, 700);
    scrollToPanelSection(id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <nav
        aria-label="Sections"
        className="relative flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2 sm:w-52 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:px-3 sm:py-4"
      >
        {marker && (
          <span
            aria-hidden
            className="bg-muted pointer-events-none absolute right-3 left-3 hidden rounded-md transition-[top,height] duration-300 ease-out motion-reduce:transition-none sm:block"
            style={{ top: marker.top, height: marker.height }}
          >
            <span className="bg-primary absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full" />
          </span>
        )}
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              ref={(el) => {
                if (el) itemRefs.current.set(s.id, el);
                else itemRefs.current.delete(s.id);
              }}
              aria-current={active ? "true" : undefined}
              onClick={() => go(s.id)}
              className={cn(
                "relative rounded-md px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none max-sm:shrink-0",
                active
                  ? "text-foreground font-medium max-sm:bg-muted"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-4">
        {children}
      </div>
    </div>
  );
}

/** One titled section of the page. `id` must match an entry in <PanelModalSections sections>. */
export function PanelModalSection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={SECTION_ID_PREFIX + id}
      data-panel-section={id}
      className={cn("flex scroll-mt-2 flex-col gap-6 border-t pt-6 first:border-t-0 first:pt-0", className)}
    >
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}
