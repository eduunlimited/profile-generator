import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ResizableTableColumns } from "../hooks/useResizableTableColumns";

export function TableColGroup({ columns }: { columns: ResizableTableColumns }) {
  if (!columns.widths) return null;
  return (
    <colgroup>
      {columns.columnIds.map((id, index) => (
        <col key={id} style={{ width: columns.widths?.[index] }} />
      ))}
    </colgroup>
  );
}

interface ResizableThProps {
  columns: ResizableTableColumns;
  id: string;
  className?: string;
  children: ReactNode;
}

export function ResizableTh({ columns, id, className, children }: ResizableThProps) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  const frame = useRef(0);
  const index = columns.columnIds.indexOf(id);
  const width = columns.widths?.[index];
  const resizable = !columns.lockedIds.has(id);

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!resizable || width == null) return;
    event.preventDefault();
    event.stopPropagation();
    startX.current = event.clientX;
    startWidth.current = width;
    document.body.classList.add("is-col-resizing");
    const handle = event.currentTarget;
    handle.classList.add("is-dragging");

    const onMove = (moveEvent: PointerEvent) => {
      const next = startWidth.current + (moveEvent.clientX - startX.current);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        columns.resizeColumn(id, next);
      });
    };

    const onUp = () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      document.body.classList.remove("is-col-resizing");
      handle.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      columns.persist();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <th className={className} style={width != null ? { width } : undefined}>
      {children}
      {resizable ? (
        <span
          className="col-resizer"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </th>
  );
}
