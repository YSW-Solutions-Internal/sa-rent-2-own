"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** In-app viewer for a generated agreement PDF, used by both "Download
 * agreement" and "Preview with current data" so looking at the document
 * doesn't require leaving the panel for a new tab. url (plain, no forced
 * Content-Disposition) renders inline in the iframe; downloadUrl (same
 * object, Content-Disposition: attachment with a friendly filename) is
 * the "Download" link's target - the two can't be the same URL, since a
 * forced-download response won't display inline. */
export function AgreementViewerDialog({
  open,
  onOpenChange,
  url,
  downloadUrl,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  downloadUrl: string | null;
  title: string;
}) {
  const headerRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl"
        // Radix's default auto-focus picks the first focusable descendant,
        // which is the iframe - it then holds keyboard focus inside its
        // own document, where Escape never reaches this page's listeners.
        // Focus the header instead of the iframe from the very start.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          headerRef.current?.focus();
        }}
      >
        <div
          ref={headerRef}
          tabIndex={-1}
          className="flex items-center justify-between gap-2 border-b px-4 py-3 outline-none"
        >
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          {downloadUrl && (
            <Button asChild variant="link" size="sm" className="mr-8 h-auto shrink-0 p-0">
              <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                Download
              </a>
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 bg-neutral-100">
          {url && (
            <iframe
              src={url}
              title={title}
              className="h-full w-full"
              // The browser's built-in PDF viewer grabs keyboard focus once
              // it finishes loading, moving it into the iframe's own
              // document - key presses there never reach this page, so
              // Escape stops closing the dialog. Reclaim focus as soon as
              // it loads so the usual Escape-to-close keeps working.
              onLoad={() => headerRef.current?.focus()}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
