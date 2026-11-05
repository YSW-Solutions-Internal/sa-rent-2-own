"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SearchableOption {
  id: string;
  /** Plain text: shown by default and searched. */
  label: string;
  /** Shown instead of the label when set (e.g. a name with a warning sign). */
  node?: React.ReactNode;
  /** Extra words that also match a search but aren't displayed. */
  keywords?: string;
}

/**
 * A select with a search box. The list opens inline under the field (not as a
 * floating layer) so it works inside side panels without being clipped. Every
 * word typed must appear somewhere in the option's label, in any order.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((o) => o.id === value);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = words.length
    ? options.filter((o) => {
        const label = `${o.label} ${o.keywords ?? ""}`.toLowerCase();
        return words.every((w) => label.includes(w));
      })
    : options;

  return (
    <div className="space-y-1">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
          !selected && "text-muted-foreground"
        )}
      >
        <span className="line-clamp-1 text-left">{selected ? (selected.node ?? selected.label) : placeholder}</span>
        <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="bg-popover text-popover-foreground rounded-md border shadow-sm">
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 opacity-50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) {
                    onChange(filtered[0].id);
                    setOpen(false);
                  }
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="placeholder:text-muted-foreground h-9 w-full bg-transparent text-sm outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="text-muted-foreground px-2 py-2 text-sm">{emptyText}</li>}
            {filtered.map((o) => (
              <li key={o.id} role="option" aria-selected={o.id === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className="hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                >
                  <span>{o.node ?? o.label}</span>
                  {o.id === value && <CheckIcon className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
