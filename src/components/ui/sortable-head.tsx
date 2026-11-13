"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function SortableHead<T extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
  width,
  onResizeStart,
}: {
  label: string;
  sortKey: T;
  activeKey: T | null;
  direction: "asc" | "desc";
  onSort: (key: T) => void;
  className?: string;
  width?: number;
  onResizeStart?: (e: React.PointerEvent) => void;
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead
      data-column-id={sortKey}
      style={{ width, minWidth: width }}
      className={cn("relative", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
      {onResizeStart && <ColumnResizeHandle label={label} onPointerDown={onResizeStart} />}
    </TableHead>
  );
}
