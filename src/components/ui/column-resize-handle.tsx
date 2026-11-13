"use client";

/** Drag-to-resize grip on a table header cell's right edge. Rendered
 * inside a `relative`-positioned `<th>`; `onPointerDown` comes from
 * `useColumnResize`'s `startResize(id)`. */
export function ColumnResizeHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 bottom-0 z-10 w-2 cursor-col-resize touch-none select-none"
    >
      <div className="bg-border hover:bg-primary/60 mx-auto h-full w-px transition-colors" />
    </div>
  );
}
